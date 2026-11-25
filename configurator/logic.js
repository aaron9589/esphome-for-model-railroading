// The logic engine (docs/field-logic-spec.md): one scan every 100 ms over a
// board's rules, kept as data. The browser runs it for Try it and the checker;
// the board runs the C++ core (engine-tests/), which mirrors this file and
// replays the same cases (test/cases/*.json). test/cases/README.md gives the
// scan's rules exactly; the numbers in the comments below (rule 12, ...) are
// its numbered rules.
//
// Plain JS, no DOM and no ESPHome: kept simple so the C++ can follow it.
(function (global) {
  const SCAN_MS = 100;
  const RELEASE_WINDOW_MS = 5000; // rule 16: a release this soon after connecting was waiting on the broker
  const PAIR_MS = 30000; // rule 28: how long an end is pairing after a press
  const TAGS = Object.freeze(["stop", "restricting", "approach", "advance", "clear"]);
  const HELD_NAMES = ["R292", "Stop"];

  // "0.5s" or "500ms" in milliseconds; none is 0. Anything else is NaN, so a
  // typo is never read as "no delay".
  function ms(text) {
    if (text === undefined || text === null || text === "") return 0;
    const m = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(String(text).trim());
    return m ? Math.round(parseFloat(m[1]) * (m[2] === "s" ? 1000 : 1)) : NaN;
  }

  // --- Masts ---------------------------------------------------------------

  function aspectNames(mast) {
    return Object.keys(mast.aspects || {});
  }

  function tagOf(mast, aspect) {
    return (mast.aspects || {})[aspect];
  }

  // The stop aspect: set, else R292 or Stop, else the first stop aspect.
  function stopAspect(mast) {
    if (mast.stop && tagOf(mast, mast.stop)) return mast.stop;
    for (const name of HELD_NAMES) if (tagOf(mast, name) === "stop") return name;
    return aspectNames(mast).find((name) => tagOf(mast, name) === "stop") || aspectNames(mast)[0];
  }

  function statesOf(mast, aspect) {
    const custom = (mast.states || {})[aspect];
    return (custom || [`${aspect}; Lit; Unheld`]).map((s) => String(s).trim()).filter(Boolean);
  }

  // Rule 18, today's handler: the aspect a JMRI message picks, "dark", or
  // undefined when the message is ignored.
  function pickAspect(mast, message) {
    const x = String(message);
    const byName = new Map();
    for (const aspect of aspectNames(mast)) {
      for (const state of statesOf(mast, aspect)) {
        if (x === state) return aspect;
        const name = state.split(";")[0].trim();
        if (name && !byName.has(name)) byName.set(name, aspect);
      }
    }
    if (x.includes("; Unlit")) return "dark";
    if (x.includes("; Held")) {
      const held = HELD_NAMES.find((name) => byName.has(name));
      return held ? byName.get(held) : "dark";
    }
    const at = x.indexOf(";");
    const name = (at < 0 ? x : x.slice(0, at)).replace(/ +$/, "");
    return byName.has(name) ? byName.get(name) : undefined;
  }

  function isHeldMessage(message) {
    return String(message).includes("; Held");
  }

  // A condition's value: `is` may be a list (a mast's tags); elsewhere its first value counts.
  // (Not [].concat(c.is)[0]: the checker calls this millions of times.)
  const first = (c) => (Array.isArray(c.is) ? c.is[0] : c.is);

  // --- The engine ----------------------------------------------------------

  /**
   * An engine for one board (the case format's `board`), with the field at
   * power-on (`start`). Feed it events with `event()`, call `scan()` every
   * 100 ms, and read `state()`. `scan()` returns { events, writes, publishes }.
   */
  function createEngine(board, start = {}) {
    const masts = board.masts || {};
    const mastOrder = Object.keys(masts);
    const turnoutOrder = board.turnouts || [];
    const logic = board.logic || {};
    // Names are unique once validated; if not, the first one wins, as in the C++ core.
    const logicBlocks = new Map();
    for (const b of logic.blocks || []) if (!logicBlocks.has(b.name)) logicBlocks.set(b.name, b.sensors || []);
    const remoteBoards = board.remote || {};

    const rules = [];
    const layers = (logic.layers || []).map((layer) => {
      const list = (layer.rules || []).map((def, i) => {
        const rule = {
          def,
          ref: `${layer.name}/${i + 1}`,
          index: rules.length,
          then: def.then || {},
          forMs: ms(def.trigger?.for),
          trig: null,
          phase: "idle",
          cancelAt: 0,
          trueNow: false,
          checksNow: false,
        };
        rules.push(rule);
        return rule;
      });
      return { name: layer.name, rules: list };
    });
    const resources = (logic.resources || []).map((def) => ({
      def,
      name: def.name,
      lockMs: ms(def.approachLock),
      releaseMs: ms(def.release?.for),
      rules: [],
      holder: null,
      startupHeld: false,
      rel: null,
      releaseNow: false,
    }));
    const resourceByName = new Map();
    for (const r of resources) if (!resourceByName.has(r.name)) resourceByName.set(r.name, r);
    for (const rule of rules) {
      rule.resource = rule.then.reserve ? resourceByName.get(rule.then.reserve) || null : null;
      if (rule.resource) rule.resource.rules.push(rule);
    }
    for (const [what, value] of [...rules.map((r) => [r.ref, r.forMs]), ...resources.flatMap((r) => [[r.name, r.lockMs], [r.name, r.releaseMs]])]) {
      if (Number.isNaN(value)) throw new Error(`${what}: a time the engine cannot read. Use a time such as 0.5s or 500ms.`);
    }
    const fieldMasts = mastOrder.filter((m) => rules.some((r) => r.then.mast === m));
    const isField = (m) => fieldMasts.includes(m);

    // Plant ends (rules 23-29): each end's link and what it has heard through
    // it, indexed by this board's track (0 is track 1). Names are unique once
    // validated; if not, the first one wins, as in the C++ core.
    const me = start.board === undefined ? "" : String(start.board);
    const ends = (logic.ends || []).map((def, index) => ({
      index,
      name: def.name,
      tracks: def.tracks || [],
      link: "",
      theirLink: undefined,
      online: undefined,
      block: [],
      mast: [],
      announce: false,
      prevState: undefined,
    }));
    const endByName = (name) => ends.find((end) => end.name === name);
    let pairGroup = []; // rule 28: { who, tracks, until }
    const closedGroups = [];

    // Inputs (rule 2): a value and two latches for this board's sensors and buttons.
    // A map per kind, so a lookup builds no key (the checker runs many scans).
    const latched = new Map();
    const latchedBy = { sensor: new Map(), button: new Map() };
    const input = (kind, name) => {
      const byName = latchedBy[kind];
      let v = byName.get(name);
      if (v === undefined) {
        v = { value: false, on: false, off: false };
        byName.set(name, v);
        latched.set(`${kind}\u0000${name}`, v);
      }
      return v;
    };
    const turnouts = new Map(turnoutOrder.map((t) => [t, "closed"]));
    const remoteLocks = new Map(turnoutOrder.map((t) => [t, false]));
    const remote = {};
    for (const b of Object.keys(remoteBoards)) remote[b] = { online: undefined, items: new Map() };

    let n = 0;
    let broker = start.broker !== "disconnected";
    let connectAt = broker ? 0 : null;
    let publishAll = broker;
    let endsPublishAll = broker; // rule 29: ends publish with logic on or off
    let logicOn = start.logic !== "off";
    let startupNext = logicOn;
    let pendingLogic = null;
    const pendingReleases = [];

    const jmriShown = new Map(); // rule 17: what today's handler shows from JMRI's messages
    const holds = new Map(); // rule 15: the board's copy of each field mast's hold
    const display = new Map(); // what each mast shows now
    let prevOut = new Map(); // rule 13: field masts as the previous scan wrote them
    let fieldLocks = new Map(turnoutOrder.map((t) => [t, false]));
    let prevLocked = new Map();
    const published = new Map();
    const endPublished = new Map();
    const edges = new Map(); // rule-read moments that need the previous scan's value

    for (const m of mastOrder) {
      display.set(m, masts[m].startup && tagOf(masts[m], masts[m].startup) ? masts[m].startup : null);
      if (isField(m)) {
        jmriShown.set(m, null);
        holds.set(m, false);
        prevOut.set(m, stopAspect(masts[m]));
        if (logicOn) display.set(m, stopAspect(masts[m]));
      }
    }

    // --- reading inputs ---

    function known(b, value) {
      return broker && remote[b]?.online === true && value !== undefined;
    }
    // Another board's sensor or block: its kind comes from that board's lists.
    const remoteKind = (b, name) => ((remoteBoards[b]?.blocks || []).includes(name) ? "block" : "sensor");
    function remoteItem(b, kind, name) {
      return remote[b]?.items.get(`${kind}\u0000${name}`);
    }

    // Rule 14: occupied, and an item from another board that is not known reads occupied.
    function occupied(name, b) {
      if (b !== undefined) {
        const value = remoteItem(b, remoteKind(b, name), name);
        return known(b, value) ? value === "occupied" : true;
      }
      if (logicBlocks.has(name)) {
        // A member on this board is one of its sensors; another board's is read
        // there; { end, track } is what that end track hears.
        return logicBlocks.get(name).some((member) => {
          if (typeof member === "string") return input("sensor", member).value;
          if (member.end !== undefined) return endHears(member.end, member.track).occupied;
          if (member.board === undefined) return input("sensor", member.sensor ?? member.block).value;
          return occupied(member.sensor ?? member.block, member.board);
        });
      }
      return input("sensor", name).value;
    }

    // Went occupied, or went clear, since the last scan. A sensor: its latch.
    // A block: its own value against the last scan's; a member's pulse counts
    // only when the block was clear before and after (it went occupied, then
    // clear). One member changing while another holds the block is no change.
    const prevBlock = new Map();
    const localMembers = (name) => logicBlocks.get(name)
      .filter((m) => typeof m === "string" || (m.board === undefined && m.end === undefined))
      .map((m) => (typeof m === "string" ? m : m.sensor ?? m.block));
    function went(name, on) {
      if (!logicBlocks.has(name)) return on ? input("sensor", name).on : input("sensor", name).off;
      const prev = prevBlock.get(name) === true;
      const now = occupied(name);
      const pulsed = localMembers(name).some((s) => input("sensor", s).on);
      return on ? !prev && (now || pulsed) : !now && (prev || pulsed);
    }

    function turnoutState(name, b) {
      if (b === undefined) return turnouts.get(name);
      const value = remoteItem(b, "turnout", name);
      return known(b, value) ? value : undefined;
    }

    // Rule 13: the aspect a rule reads for a mast, or null for none / dark.
    function mastReading(name, b) {
      let aspect;
      let def;
      if (b !== undefined) {
        def = remoteBoards[b]?.masts?.[name] || {};
        const value = remoteItem(b, "mast", name);
        aspect = known(b, value) && value !== "" ? value : null;
      } else {
        def = masts[name] || {};
        aspect = isField(name) ? prevOut.get(name) : display.get(name);
      }
      if (!aspect || aspect === "dark" || !tagOf(def, aspect)) return { def, aspect: null, tag: "stop" };
      return { def, aspect, tag: tagOf(def, aspect) };
    }

    function condition(c) {
      if (!c) return false;
      if (c.all) return c.all.every(condition);
      if (c.any) return c.any.some(condition);
      if (c.not) return !condition(c.not);
      if (c.end !== undefined) {
        // What a plant end hears: its Block, or its Mast, which is a tag only.
        const heard = endHears(c.end, c.track);
        if (c.hears === "mast") return first(c) !== "diverging" && [].concat(c.is).includes(heard.tag);
        return first(c) === "clear" ? !heard.occupied : heard.occupied;
      }
      if (c.block !== undefined || c.sensor !== undefined) {
        const occ = occupied(c.block ?? c.sensor, c.board);
        return first(c) === "clear" ? !occ : occ;
      }
      if (c.turnout !== undefined) return turnoutState(c.turnout, c.board) === first(c);
      if (c.mast !== undefined) {
        const r = mastReading(c.mast, c.board);
        if (first(c) === "diverging") return r.aspect !== null && (r.def.diverging || []).includes(r.aspect);
        return [].concat(c.is).includes(r.tag);
      }
      if (c.button !== undefined) return input("button", c.button).value;
      return false;
    }

    // A moment's key, made once per moment: rule definitions do not change
    // while an engine runs, and the checker runs many short engines.
    const momentKeys = new WeakMap();
    const momentKey = (m) => {
      if (!momentKeys.has(m)) momentKeys.set(m, JSON.stringify(m));
      return momentKeys.get(m);
    };
    // A moment: this board's sensors and buttons by their latches; anything
    // else by its condition becoming true since the last scan.
    function moment(m) {
      const local = m.board === undefined && (m.block !== undefined || m.sensor !== undefined || m.button !== undefined);
      if (local && m.button !== undefined) return first(m) === "pressed" && input("button", m.button).on;
      if (local) return went(m.block ?? m.sensor, first(m) !== "clear");
      return condition(m) && edges.get(momentKey(m)) === false;
    }
    const trackedMoments = [];
    const track = (m) => m && trackedMoments.push(m);

    // Two moments on the same input in one scan, in the order the latches
    // and the value prove (rule 2). Moments on different inputs advance one
    // per scan, since their order within a scan cannot be known.
    // { sensor: X } and { block: X } name the same input.
    function sameInputInOrder(prev, next) {
      if (prev.board !== undefined || next.board !== undefined) return false;
      const name = prev.block ?? prev.sensor;
      if (name === undefined || name !== (next.block ?? next.sensor) || logicBlocks.has(name)) return false;
      const s = input("sensor", name);
      if (first(prev) === "occupied" && first(next) === "clear") return s.on && s.off && !s.value;
      if (first(prev) === "clear" && first(next) === "occupied") return s.on && s.off && s.value;
      return false;
    }

    // A when / then sequence: { p } progress. True when it completes.
    function advance(seq, st) {
      let moved = false;
      while (st.p < seq.length) {
        const m = seq[st.p];
        if (!moment(m)) break;
        if (moved && !sameInputInOrder(seq[st.p - 1], m)) break;
        st.p += 1;
        moved = true;
      }
      if (st.p === seq.length) {
        st.p = 0;
        return true;
      }
      return false;
    }

    // --- plant ends (rules 24-29) ---

    // Rule 24: "end", "board" for <board>/<end>, or "empty".
    function linkKind(end) {
      const link = end.link;
      if (link === "end") return "end";
      const at = link.lastIndexOf("/");
      if (at <= 0 || at === link.length - 1 || link === `${me}/${end.name}`) return "empty";
      return "board";
    }

    function setLink(end, link) {
      if (end.link === link) return;
      end.link = link;
      end.theirLink = undefined;
      end.online = undefined;
      end.block = [];
      end.mast = [];
    }

    // Rule 25: what an end's track hears, by this board's track number.
    const ready = (end) => broker && end.online === true && end.theirLink === `${me}/${end.name}`;
    function endHears(name, track) {
      const end = endByName(name);
      if (!end || !Number.isInteger(track) || track < 1 || track > end.tracks.length) return { occupied: true, tag: "stop" };
      const kind = linkKind(end);
      if (kind === "end") return { occupied: false, tag: "stop" };
      if (kind === "empty" || !ready(end)) return { occupied: true, tag: "stop" };
      const block = end.block[track - 1];
      const tag = end.mast[track - 1];
      return { occupied: block === undefined ? true : block, tag: tag === undefined ? "stop" : tag };
    }

    // Rule 26.
    const inPairing = (end) => [pairGroup, ...closedGroups].some((g) => g.some((x) => x.who === `${me}/${end.name}`));
    function endState(end) {
      if (inPairing(end)) return "pairing";
      const kind = linkKind(end);
      if (kind !== "board") return kind;
      if (!broker) return "unheard";
      if (end.theirLink !== undefined && end.theirLink !== `${me}/${end.name}`) return "disagrees";
      if (end.online !== true || end.theirLink === undefined) return "unheard";
      return "heard";
    }

    // Rule 27: what track i (0 is track 1) of an end offers.
    function endOffer(end, i) {
      const track = end.tracks[i] || {};
      const own = (track.sensors || []).some((s) => input("sensor", s).value);
      const through = track.through;
      if (through) {
        if (through.end === end.name) return { occupied: own, tag: "stop" };
        const far = endHears(through.end, through.track);
        return { occupied: own || far.occupied, tag: far.tag };
      }
      if (track.mast !== undefined) {
        const def = masts[track.mast];
        const aspect = display.get(track.mast);
        const tag = def && aspect && aspect !== "dark" ? tagOf(def, aspect) : undefined;
        return { occupied: own, tag: tag || "stop" };
      }
      return { occupied: own, tag: "stop" };
    }

    // Rule 28: an end joins the pairing group, or is renewed in it.
    function joinPairing(who, tracks, t) {
      if (pairGroup.length && pairGroup.every((x) => x.until <= t)) {
        closedGroups.push(pairGroup);
        pairGroup = [];
      }
      const entry = pairGroup.find((x) => x.who === who);
      if (entry) {
        entry.until = t + PAIR_MS;
        entry.tracks = tracks;
      } else pairGroup.push({ who, tracks, until: t + PAIR_MS });
    }

    // An announcement, <board>/<end>/<tracks>. This board's own is ignored.
    function heardPairing(text, t) {
      const s = String(text);
      const a = s.lastIndexOf("/");
      const b = a > 0 ? s.lastIndexOf("/", a - 1) : -1;
      if (b <= 0 || a - b < 2 || !/^\d{1,4}$/.test(s.slice(a + 1))) return;
      if (s.slice(0, b) === me) return;
      joinPairing(s.slice(0, a), parseInt(s.slice(a + 1), 10), t);
    }

    function decidePairing(out) {
      if (pairGroup.length && pairGroup.every((x) => x.until <= n * SCAN_MS)) {
        closedGroups.push(pairGroup);
        pairGroup = [];
      }
      for (const g of closedGroups) {
        for (const end of ends) {
          const who = `${me}/${end.name}`;
          if (!g.some((x) => x.who === who)) continue;
          const others = g.filter((x) => x.who !== who);
          if (others.length === 1 && others[0].tracks === end.tracks.length) {
            setLink(end, others[0].who);
            out.events.push({ pairing: end.name, result: "paired", with: others[0].who });
          } else {
            out.events.push({ pairing: end.name, result: !others.length ? "alone" : others.length > 1 ? "crowded" : "tracks" });
          }
        }
      }
      closedGroups.length = 0;
    }

    // Rules 23 and 29: the last part of every scan, logic on or off.
    function finishEnds(out) {
      decidePairing(out);
      for (const end of ends) {
        const st = endState(end);
        if (st === "disagrees" && end.prevState !== "disagrees") out.events.push({ disagrees: end.name, link: end.link, theirs: end.theirLink });
        end.prevState = st;
      }
      if (broker) {
        const pub = (key, value, p) => {
          if (!endsPublishAll && endPublished.get(key) === value) return;
          out.publishes.push(p);
          endPublished.set(key, value);
        };
        for (const end of ends) {
          if (end.announce) out.publishes.push({ pairing: `${me}/${end.name}/${end.tracks.length}` });
          pub(`${end.index}\u0000link`, end.link, { end: end.name, link: end.link });
          end.tracks.forEach((_, i) => {
            const offer = endOffer(end, i);
            const block = offer.occupied ? "ACTIVE" : "INACTIVE";
            pub(`${end.index}\u0000${i}\u0000block`, block, { end: end.name, track: i + 1, block });
            pub(`${end.index}\u0000${i}\u0000mast`, offer.tag, { end: end.name, track: i + 1, mast: offer.tag });
          });
        }
        endsPublishAll = false;
      }
      for (const end of ends) end.announce = false;
    }

    // An event on an end: its link, or what its subscriptions bring.
    function endEvent(e, t) {
      const end = endByName(e.end);
      if (!end) return;
      if (e.pair !== undefined) {
        if (e.pair !== "pressed") return;
        joinPairing(`${me}/${end.name}`, end.tracks.length, t);
        end.announce = true;
      } else if (e.link !== undefined) setLink(end, String(e.link));
      else if (e.theirLink !== undefined) end.theirLink = e.theirLink === "" ? undefined : String(e.theirLink);
      else if (e.online !== undefined) end.online = e.online === true;
      else if (e.track !== undefined) {
        // Rule 25: their track j is this board's track count + 1 - j.
        const count = end.tracks.length;
        if (!Number.isInteger(e.track) || e.track < 1 || e.track > count) return;
        const i = count - e.track;
        if (e.block !== undefined) end.block[i] = e.block === "occupied" ? true : e.block === "clear" ? false : undefined;
        else if (e.mast !== undefined) end.mast[i] = TAGS.includes(e.mast) ? e.mast : undefined;
      }
    }

    // --- triggers (rules 3, 5, 20) ---

    const sequenceOf = (t) => [t.when, ...(t.then || [])];
    for (const rule of rules) {
      const t = rule.def.trigger || {};
      if (t.when) sequenceOf(t).forEach(track);
      else track(t.while);
      track(rule.def.cancel?.when);
    }
    for (const res of resources) {
      const t = res.def.release || {};
      if (t.when) sequenceOf(t).forEach(track);
    }

    function resetTrigger(rule) {
      rule.trig = { runTrue: null, runFalse: null, eff: false, guard: false, prevRaw: null, request: false, seq: { p: 0 }, since: null };
      rule.phase = "idle";
    }
    function resetRelease(res) {
      res.rel = { runTrue: null, seq: { p: 0 } };
    }
    rules.forEach(resetTrigger);
    resources.forEach(resetRelease);

    const heldRes = (res) => res.holder !== null || res.startupHeld;

    function evalTrigger(rule, ctx) {
      const t = rule.def.trigger || {};
      const st = rule.trig;
      let isTrue;
      if (t.when) {
        if (advance(sequenceOf(t), st.seq)) {
          st.request = true;
          if (!rule.resource) st.fired = true;
        }
        isTrue = rule.resource ? st.request : Boolean(st.fired);
        st.fired = false;
      } else {
        const raw = condition(t.while);
        if (t.leavingGuard) {
          if (!raw) st.guard = false;
          else if (!ctx.startup && st.prevRaw === false && rule.resource && ctx.heldAtStart.has(rule.resource)) st.guard = true;
        }
        st.prevRaw = raw;
        if (raw) {
          if (st.runTrue === null) st.runTrue = n;
          st.runFalse = null;
          if (!st.eff && (n - st.runTrue) * SCAN_MS >= rule.forMs) st.eff = true;
        } else {
          if (st.runFalse === null) st.runFalse = n;
          st.runTrue = null;
          if (st.eff && (n - st.runFalse) * SCAN_MS >= rule.forMs) st.eff = false;
        }
        isTrue = st.eff && !st.guard;
      }
      if (isTrue && st.since === null) st.since = n;
      if (!isTrue) st.since = null;
      rule.trueNow = isTrue;
      rule.checksNow = (rule.def.checks || []).every(condition);
    }

    // Rule 9: a release is true when its while has held for its for, or its
    // then sequence has completed since the grant.
    function evalRelease(res) {
      const t = res.def.release || {};
      if (t.when) {
        res.releaseNow = heldRes(res) ? advance(sequenceOf(t), res.rel.seq) || res.rel.done === true : false;
        if (res.releaseNow) res.rel.done = true;
        return;
      }
      const raw = condition(t.while);
      if (raw) {
        if (res.rel.runTrue === null) res.rel.runTrue = n;
      } else res.rel.runTrue = null;
      res.releaseNow = raw && (n - res.rel.runTrue) * SCAN_MS >= res.releaseMs;
    }

    function free(res) {
      if (res.holder) {
        res.holder.phase = "idle";
        res.holder = null;
      }
      res.startupHeld = false;
      res.rel.seq = { p: 0 };
      res.rel.done = false;
    }

    const blockOccupiedOrWent = (res) => (res.def.blocks || []).some((b) => occupied(b) || went(b, true));
    const blocksClear = (res) => (res.def.blocks || []).every((b) => !occupied(b));
    const mastHeld = (rule) => rule.then.mast !== undefined && holds.get(rule.then.mast) === true;
    const isActive = (rule) => (rule.resource ? rule.phase === "active" : rule.trueNow && rule.checksNow);
    const locksHeld = (rule) => (rule.resource ? ["active", "passed", "cancelling"].includes(rule.phase) : rule.trueNow && rule.checksNow);

    function resourceState(res) {
      if (res.startupHeld) return "PASSED";
      if (!res.holder) return "IDLE";
      return { active: "ACTIVE", passed: "PASSED", cancelling: "CANCELLING" }[res.holder.phase];
    }

    // --- writes and publishes (rule 22) ---

    function finish(out, newOut, newLocks) {
      for (const m of fieldMasts) {
        if (!newOut.has(m)) continue;
        const aspect = newOut.get(m);
        if (display.get(m) !== aspect) out.writes.push({ mast: m, aspect });
        display.set(m, aspect);
      }
      for (const t of turnoutOrder) {
        if (fieldLocks.get(t) !== newLocks.get(t)) out.writes.push({ lock: t, on: newLocks.get(t) });
      }
      fieldLocks = newLocks;
      // Rule 21: the re-sync, when a turnout goes from locked to unlocked.
      for (const t of turnoutOrder) {
        const locked = fieldLocks.get(t) || remoteLocks.get(t);
        if (prevLocked.get(t) === true && !locked) out.events.push({ resync: t });
        prevLocked.set(t, locked);
      }
    }

    function publishResources(out, echoes) {
      if (!broker) return;
      for (const res of resources) {
        const values = [["held", heldRes(res) ? "ACTIVE" : "INACTIVE"], ["state", resourceState(res)]];
        for (const [key, value] of values) {
          const id = `${res.name}\u0000${key}`;
          if (publishAll || published.get(id) !== value) {
            out.publishes.push({ resource: res.name, [key]: value });
            published.set(id, value);
          }
        }
      }
      for (const name of echoes) out.publishes.push({ release: name, value: "CLOSED" });
      publishAll = false;
    }

    // What this scan read, for the next scan's moments. Taken before the
    // field masts' new outputs become what rules read.
    function recordEdges() {
      for (const m of trackedMoments) edges.set(momentKey(m), condition(m));
      for (const name of logicBlocks.keys()) prevBlock.set(name, occupied(name));
    }

    function endScan() {
      for (const v of latched.values()) {
        v.on = false;
        v.off = false;
      }
      n += 1;
    }

    // Rule 17: the last scan before logic goes off.
    function switchOff(out, echoes) {
      for (const res of resources) {
        if (heldRes(res)) {
          out.events.push({ release: res.name, by: "switch" });
          free(res);
        }
      }
      rules.forEach(resetTrigger);
      const newOut = new Map();
      for (const m of fieldMasts) newOut.set(m, jmriShown.get(m) ?? stopAspect(masts[m]));
      finish(out, newOut, new Map(turnoutOrder.map((t) => [t, false])));
      publishResources(out, echoes);
      logicOn = false;
    }

    function scan() {
      const out = { events: [], writes: [], publishes: [] };
      if (pendingLogic === "on" && !logicOn) {
        logicOn = true;
        startupNext = true;
      }
      const switchingOff = pendingLogic === "off" && logicOn;
      pendingLogic = null;
      if (switchingOff || !logicOn) {
        // No section to release while logic is off, but the press is answered.
        const echoes = broker ? pendingReleases.map((p) => p.resource) : [];
        pendingReleases.length = 0;
        if (switchingOff) switchOff(out, echoes);
        else {
          finish(out, new Map(), new Map(turnoutOrder.map((t) => [t, false])));
          for (const name of echoes) out.publishes.push({ release: name, value: "CLOSED" });
        }
        recordEdges();
        finishEnds(out);
        endScan();
        return out;
      }

      const ctx = { startup: startupNext, heldAtStart: new Set(resources.filter(heldRes)) };
      startupNext = false;
      const forceStop = new Set();
      const releasedNow = new Set();
      const echoes = [];

      // 6.1: start-up, then manual releases.
      if (ctx.startup) {
        out.events.push({ startup: true });
        rules.forEach(resetTrigger);
        resources.forEach((res) => {
          free(res);
          resetRelease(res);
        });
        for (const m of fieldMasts) prevOut.set(m, stopAspect(masts[m]));
        for (const res of resources) {
          if ((res.def.blocks || []).some((b) => occupied(b))) {
            res.startupHeld = true;
            out.events.push({ pass: res.name, rule: null });
          }
        }
      }
      for (const res of resources) {
        for (const press of pendingReleases.filter((p) => p.resource === res.name)) {
          if (broker) echoes.push(res.name);
          if (press.ignored) {
            out.events.push({ ignored: "release", resource: res.name });
            continue;
          }
          out.events.push({ release: res.name, by: "manual" });
          free(res);
          releasedNow.add(res);
          for (const rule of res.rules) {
            if (rule.then.mast === undefined) continue;
            holds.set(rule.then.mast, false);
            forceStop.add(rule.then.mast);
          }
        }
      }
      pendingReleases.length = 0;

      // 6.2: releases read this scan, a start-up hold's release, then each rule.
      resources.forEach(evalRelease);
      for (const res of resources) {
        if (res.startupHeld && res.releaseNow) {
          out.events.push({ release: res.name, by: "release" });
          free(res);
        }
      }
      for (const rule of rules) {
        evalTrigger(rule, ctx);
        const res = rule.resource;
        if (!res || res.holder !== rule) continue;
        if (rule.phase === "active") {
          const t = rule.def.trigger || {};
          let cancel = false;
          if (t.when) {
            if (rule.def.cancel?.when && moment(rule.def.cancel.when)) {
              cancel = true;
              rule.trig.request = false;
            }
          } else if (!rule.trueNow) cancel = true;
          if (!cancel && mastHeld(rule)) {
            cancel = true;
            if (t.when) rule.trig.request = true;
          }
          if (cancel) {
            out.events.push({ cancel: res.name, rule: rule.ref });
            if (res.lockMs > 0) {
              rule.phase = "cancelling";
              rule.cancelAt = n;
            } else {
              out.events.push({ release: res.name, by: "cancel" });
              free(res);
              continue;
            }
          }
        }
        if ((rule.phase === "active" || rule.phase === "cancelling") && blockOccupiedOrWent(res)) {
          rule.phase = "passed";
          out.events.push({ pass: res.name, rule: rule.ref });
        }
        if (rule.phase === "cancelling" && (n - rule.cancelAt) * SCAN_MS >= res.lockMs) {
          out.events.push({ release: res.name, by: "time" });
          free(res);
          continue;
        }
        if (rule.phase === "passed" && res.releaseNow) {
          out.events.push({ release: res.name, by: "release" });
          free(res);
        }
      }

      // 6.3: grants, longest waiting first, then list order.
      for (const res of resources) {
        if (heldRes(res) || releasedNow.has(res) || !blocksClear(res)) continue;
        const waiting = res.rules.filter((r) => r.phase === "idle" && r.trueNow && r.checksNow && !mastHeld(r));
        if (!waiting.length) continue;
        waiting.sort((a, b) => a.trig.since - b.trig.since || a.index - b.index);
        const rule = waiting[0];
        rule.phase = "active";
        res.holder = rule;
        res.rel.seq = { p: 0 };
        res.rel.done = false;
        if (rule.def.trigger?.when) {
          rule.trig.request = false;
          rule.trig.since = null;
        }
        out.events.push({ grant: res.name, rule: rule.ref });
      }

      // 6.4: who wins each mast (rule 12), approach lighting, then the locks.
      const newOut = new Map();
      for (const m of fieldMasts) {
        const def = masts[m];
        const stop = stopAspect(def);
        const answers = [];
        for (const layer of layers) {
          const setters = layer.rules.filter((r) => r.then.mast === m);
          if (!setters.length) continue;
          const winner = setters.find(isActive);
          // Fail safe: an aspect the mast does not have is its stop aspect.
          answers.push(winner && tagOf(def, winner.then.aspect) ? winner.then.aspect : stop);
        }
        if (holds.get(m) || forceStop.has(m)) answers.push(stop);
        let pick = answers[0] ?? stop;
        for (const a of answers) if (TAGS.indexOf(tagOf(def, a)) < TAGS.indexOf(tagOf(def, pick))) pick = a;
        if (def.approachLight !== undefined && !occupied(def.approachLight)) pick = "dark";
        newOut.set(m, pick);
      }
      const newLocks = new Map(turnoutOrder.map((t) => [t, false]));
      for (const rule of rules) {
        if (!locksHeld(rule)) continue;
        for (const t of rule.then.lock || []) newLocks.set(t, true);
      }
      finish(out, newOut, newLocks);
      recordEdges();
      prevOut = newOut;
      publishResources(out, echoes);
      finishEnds(out);
      endScan();
      return out;
    }

    // --- events ---

    function setLatched(kind, name, value) {
      const v = input(kind, name);
      if (v.value === value) return;
      v.value = value;
      if (value) v.on = true;
      else v.off = true;
    }

    function event(e) {
      const t = n * SCAN_MS;
      if (e.board !== undefined) {
        const r = remote[e.board];
        if (!r) return;
        if (e.online !== undefined) r.online = e.online;
        else if (e.mast !== undefined) r.items.set(`mast\u0000${e.mast}`, e.aspect);
        else {
          const name = e.turnout ?? e.block ?? e.sensor;
          const kind = e.turnout !== undefined ? "turnout" : remoteKind(e.board, name);
          r.items.set(`${kind}\u0000${name}`, e.is === "unknown" ? undefined : e.is);
        }
        return;
      }
      if (e.end !== undefined) return endEvent(e, t);
      if (e.pairing !== undefined) return heardPairing(e.pairing, t);
      if (e.sensor !== undefined) return setLatched("sensor", e.sensor, e.is === "occupied");
      if (e.button !== undefined) return setLatched("button", e.button, e.is === "pressed");
      if (e.turnout !== undefined) return void turnouts.set(e.turnout, e.is);
      if (e.remoteLock !== undefined) return void remoteLocks.set(e.remoteLock, e.is === "locked");
      if (e.jmri !== undefined) return jmriMessage(e.jmri, e.message);
      if (e.release !== undefined) {
        const ignored = e.via === "mqtt" && connectAt !== null && t - connectAt < RELEASE_WINDOW_MS;
        return void pendingReleases.push({ resource: e.release, ignored });
      }
      if (e.logic !== undefined) return void (pendingLogic = e.logic);
      if (e.broker === "connected") {
        broker = true;
        connectAt = t;
        publishAll = true;
        endsPublishAll = true;
      } else if (e.broker === "disconnected") broker = false;
    }

    // Rules 15 and 17: the board records every message. With logic on, a field
    // mast reads only the hold; otherwise the message shows as today.
    function jmriMessage(m, message) {
      const def = masts[m];
      if (!def) return;
      const pick = pickAspect(def, message);
      if (isField(m)) {
        holds.set(m, isHeldMessage(message));
        if (pick !== undefined) jmriShown.set(m, pick);
        if (!logicOn && pick !== undefined) display.set(m, pick);
      } else if (pick !== undefined) display.set(m, pick);
    }

    for (const [s, v] of Object.entries(start.sensors || {})) input("sensor", s).value = v === "occupied";
    for (const [t, v] of Object.entries(start.turnouts || {})) turnouts.set(t, v);
    for (const [t, v] of Object.entries(start.remoteLocks || {})) remoteLocks.set(t, v === "locked");
    for (const [b, s] of Object.entries(start.remote || {})) {
      const r = remote[b];
      if (!r) continue;
      if (s.online !== undefined) r.online = s.online;
      for (const [name, v] of Object.entries(s.sensors || {})) r.items.set(`${remoteKind(b, name)}\u0000${name}`, v);
      for (const [name, v] of Object.entries(s.turnouts || {})) r.items.set(`turnout\u0000${name}`, v);
      for (const [name, v] of Object.entries(s.masts || {})) r.items.set(`mast\u0000${name}`, v);
    }
    for (const [m, message] of Object.entries(start.jmri || {})) jmriMessage(m, message);
    for (const [name, link] of Object.entries(start.links || {})) {
      const end = endByName(name);
      if (end) end.link = String(link);
    }
    for (const t of turnoutOrder) prevLocked.set(t, remoteLocks.get(t));
    recordEdges();

    function state() {
      const rulePhases = {};
      for (const rule of rules) {
        let phase = rule.phase;
        if (!logicOn) phase = "idle";
        else if (phase === "idle" && rule.resource && rule.trueNow && rule.checksNow) phase = "waiting";
        rulePhases[rule.ref] = phase;
      }
      return {
        logic: logicOn ? "on" : "off",
        masts: Object.fromEntries(mastOrder.map((m) => [m, display.get(m) ?? null])),
        rules: rulePhases,
        resources: Object.fromEntries(resources.map((r) => [r.name, resourceState(r)])),
        holders: Object.fromEntries(resources.map((r) => [r.name, r.holder ? r.holder.ref : null])),
        locks: Object.fromEntries(turnoutOrder.map((t) => [t, fieldLocks.get(t)])),
        locked: Object.fromEntries(turnoutOrder.map((t) => [t, fieldLocks.get(t) || remoteLocks.get(t)])),
        ends: Object.fromEntries(ends.map((end) => [end.name, endState(end)])),
        links: Object.fromEntries(ends.map((end) => [end.name, end.link])),
      };
    }

    // For the checker (logic-checker.js) and Try it only, so it has no C++
    // counterpart: which rules are active (plain rules included, which state()
    // reports as idle), and the requests in waiting order (`order`, which Try
    // it shows). The checker keys a state on `asked` in place of `order`:
    // `since` only decides grants (6.3), and those compare the rules of one
    // section, so each section's order is kept, with the set of plain rules
    // whose When is true, but not how requests for different sections, or
    // plain rules, interleave (work item 4.5). Two states that differ only in
    // that behave the same from then on.
    function checkerView() {
      const byAsk = (a, b) => a.trig.since - b.trig.since || a.index - b.index;
      const asking = (list) => list.filter((rule) => rule.trig.since !== null);
      return {
        active: rules.filter((rule) => logicOn && isActive(rule)).map((rule) => rule.ref),
        order: asking(rules).sort(byAsk).map((rule) => rule.ref),
        asked: [
          asking(rules.filter((rule) => !rule.resource)).map((rule) => rule.ref),
          ...resources.map((res) => asking(res.rules).sort(byAsk).map((rule) => rule.ref)),
        ],
      };
    }

    return { event, scan, state, checkerView, time: () => n * SCAN_MS };
  }

  // --- Explain (spec, Show, don't describe) -------------------------------
  // One sentence per rule that sets a mast, worked out from the same rules
  // the engine runs, in plain words. Aspects use the mast's `labels`
  // ({ aspect: "Clear" }) when it has them.

  const TAG_WORDS = Object.freeze({
    stop: "Stop", restricting: "Restricting", approach: "Approach", advance: "Advance Approach", clear: "Clear",
  });

  function duration(text) {
    const value = ms(text);
    if (Number.isNaN(value)) return String(text);
    if (value === 500) return "half a second";
    if (value === 1000) return "a second";
    return `${value / 1000} seconds`;
  }

  const where = (name, b) => (b === undefined ? name : `${name} on ${b}`);
  const orList = (words) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`);

  // A state, and how long it must have held: blocks and sensors say it in
  // their own words; anything else has the time added after it.
  function sayCondition(c, forText) {
    const said = sayState(c, forText);
    const own = c.block !== undefined || c.sensor !== undefined;
    if (!forText || own || !said) return said;
    return c.all || c.any || c.not ? `${said}, for ${duration(forText)}` : `${said} for ${duration(forText)}`;
  }

  function sayState(c, forText) {
    if (c.all) return sayAll(c.all);
    if (c.any) return `either ${c.any.map((x) => sayCondition(x)).join(c.any.some((x) => x.all) ? ", or " : " or ")}`;
    if (c.not) {
      const inner = c.not;
      if (inner.mast !== undefined && inner.is !== "diverging") return `${where(inner.mast, inner.board)} does not show ${orList([].concat(inner.is).map((t) => TAG_WORDS[t]))}`;
      if (inner.mast !== undefined) return `${where(inner.mast, inner.board)} does not show a diverging aspect`;
      if (inner.block !== undefined || inner.sensor !== undefined) return sayCondition({ ...inner, is: inner.is === "clear" ? "occupied" : "clear" });
      return `it is not the case that ${sayCondition(inner)}`;
    }
    const lasting = forText ? ` for ${duration(forText)}` : "";
    if (c.block !== undefined || c.sensor !== undefined) {
      const name = where(c.block ?? c.sensor, c.board);
      if (c.is === "clear") return forText ? `${name} has been clear${lasting}` : `${name} is clear`;
      return forText ? `a train has been in ${name}${lasting}` : `a train is in ${name}`;
    }
    if (c.turnout !== undefined) return `${where(c.turnout, c.board)} is ${c.is}`;
    if (c.mast !== undefined) {
      if (c.is === "diverging") return `${where(c.mast, c.board)} shows a diverging aspect`;
      return `${where(c.mast, c.board)} shows ${orList([].concat(c.is).map((t) => TAG_WORDS[t]))}`;
    }
    if (c.button !== undefined) return `${c.button} is pressed`;
    return "";
  }

  // A moment, said as having happened: a when trigger's request stays until
  // it is granted.
  // "a and b", with commas when a part is an either-or, so the grouping is clear.
  function sayAll(conds, extra = []) {
    const parts = [...conds.map((x) => sayCondition(x)), ...extra].filter(Boolean);
    return parts.join(conds.some((x) => x.any) ? ", and " : " and ");
  }

  function sayMoment(m) {
    if (m.button !== undefined) return `${m.button} has been pressed`;
    if (m.block !== undefined || m.sensor !== undefined) {
      const name = where(m.block ?? m.sensor, m.board);
      return m.is === "clear" ? `${name} has cleared` : `a train has entered ${name}`;
    }
    return sayCondition(m);
  }

  /** The conditions of one rule, as a phrase: "a train has been in Left for half a second and ...". */
  function explainRule(rule) {
    const t = rule.trigger || {};
    const lead = [];
    const conds = [];
    if (t.when) lead.push([t.when, ...(t.then || [])].map(sayMoment).join(", then "));
    else if (t.while) {
      lead.push(sayCondition(t.while, t.for));
      conds.push(t.while);
      if (t.leavingGuard) lead.push("that train did not arrive while the section was in use");
    }
    const checks = rule.checks || [];
    const tail = rule.then?.reserve ? [`the ${rule.then.reserve} section is free`] : [];
    const parts = [...lead, ...checks.map((c) => sayCondition(c)), ...tail].filter(Boolean);
    return parts.join([...conds, ...checks].some((c) => c.any) ? ", and " : " and ");
  }

  /** Explain one mast that rules set: a list of sentences. */
  function explainMast(board, mastName) {
    const mast = (board.masts || {})[mastName] || {};
    const label = (aspect) => (mast.labels || {})[aspect] || aspect;
    const layers = ((board.logic || {}).layers || [])
      .map((layer) => ({ name: layer.name, rules: (layer.rules || []).filter((r) => r.then?.mast === mastName) }))
      .filter((layer) => layer.rules.length);
    const sentences = [];
    const many = layers.length > 1;
    for (const layer of layers) {
      const lead = many ? `In ${layer.name}, ` : "";
      layer.rules.forEach((rule, i) => {
        const shows = `shows ${label(rule.then.aspect)} when ${explainRule(rule)}.`;
        if (i === 0) sentences.push(`${lead}${mastName} ${shows}`);
        else sentences.push(`Otherwise, it ${shows}`);
      });
      sentences.push(`Otherwise it shows ${label(stopAspect(mast))}.`);
    }
    if (many) sentences.push(`${mastName} shows the most restrictive of what these groups say.`);
    if (layers.length && mast.approachLight !== undefined) sentences.push(`It is dark unless a train is in ${mast.approachLight}.`);
    if (layers.length) sentences.push(`If JMRI or CATS holds it, it shows ${label(stopAspect(mast))}.`);
    return sentences;
  }

  global.EsphomeMrLogic = { SCAN_MS, TAGS, ms, stopAspect, pickAspect, createEngine, explainRule, explainMast };
})(typeof globalThis !== "undefined" ? globalThis : window);
