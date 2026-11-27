// The checker (docs/field-logic-spec.md, Checking in the browser; work item
// 2.9). It runs the board's rules in the JS engine (logic.js) through every
// state it can reach and reports:
//   - a waiting rule that can never be granted (deadlock)            error
//   - a waiting rule that can be passed over forever (starvation)    warning
//   - a rule that can never become active                            warning
//   - a mast that can never leave Stop                               warning
// Each timer is an "elapsed" event that can happen at any point: a wait step
// runs scans until something changes. When there are too many states, it
// says so and falls back to random runs, which can only show what they saw.
//
// The engine has no snapshot, so a state is reached by replaying the shortest
// path to it from a fresh engine. A path is the Show me sequence: steps of
// { do: <event> } (the event, then one scan) or { wait: <scans> }, after the
// start-up scan, as Try it (2.10) replays them.
//
// The checker only proves what the model expresses: resources make "one train
// on this track" true by construction, but it cannot tell that two masts lead
// onto the same track unless a resource says so.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const E = () => global.EsphomeMrLogic;

  const TEXT = Object.freeze({
    deadlockFound: (rule, section) => `${rule} can be left waiting for section "${section}" forever, with its train still there: a train that takes the section can never be seen through it, or a train that asks first can never go. Check what has to happen for the section to be free.`,
    deadlock: (rule, section) => `${rule} can be left waiting for section "${section}" forever, with its train still there. Use Show me to see how, then check what has to happen for the section to be free.`,
    starved: (rule, section) => `${rule} can be passed over forever: other trains keep getting section "${section}" while it waits. Use Show me to see how.`,
    neverActive: (rule) => `${rule} can never apply: no mix of trains, turnouts and signals makes its When and Only if true together. Look for a block that must be both occupied and clear.`,
    stuck: (mast) => `Signal "${mast}" can never show anything but Stop: no rule that sets it can apply. Check the rules that set it.`,
    tooMany: (runs, quick) => `This board has too many combinations to check every one${quick ? " quickly" : ""}${runs ? `, so the checker tried ${runs} random runs` : ""}. It may not have found every problem.${quick ? " Use Check every combination on the Download page to check them all: it can take a few seconds." : ""}`,
    neverSeen: (rule, runs) => `${rule} did not apply in ${runs} random runs. It may never apply: look for a block that must be both occupied and clear.`,
    stuckSeen: (mast, runs) => `Signal "${mast}" showed only Stop in ${runs} random runs. Check the rules that set it.`,
  });

  // "Gauntlet/2" -> rule 2 in group "Gauntlet".
  function ruleWords(ref) {
    const at = String(ref).lastIndexOf("/");
    return `Rule ${ref.slice(at + 1)} in group "${ref.slice(0, at)}"`;
  }

  // ===== The model: which inputs the rules read, and their values ==========

  const KINDS = ["block", "sensor", "turnout", "mast", "button", "end"];
  const SEP = "\u0000";

  // A plant end's track, as the rules read it (work item 3.4). The key names
  // this board's track; the event names the linked end's track (spec, Plant
  // ends: track k meets the far track N + 1 - k). Another end is modelled as
  // paired, heard and answering: its Block clear, its Mast Stop. Only the
  // tracks the rules read are inputs, and a Mast takes Stop and the meanings
  // the rules compare it with, so the end adds a few states, not a power of
  // five. "Not paired" and "not heard" are not explored: they read like
  // occupied and Stop, which the inputs already reach.
  const endKey = (end, track, what) => ["~end", end, String(track), what].join(SEP);
  const isEndKey = (key) => String(key).startsWith(`~end${SEP}`);
  const endTracks = (board, end) => list(list(board.logic?.ends).find((e) => e?.name === end)?.tracks).length;
  // The board name the checker and Try it give a board that has ends.
  const SELF = "this-board";

  function conditionsIn(value, out = []) {
    if (Array.isArray(value)) {
      value.forEach((item) => conditionsIn(item, out));
    } else if (isObject(value)) {
      if (KINDS.some((kind) => value[kind] !== undefined)) out.push(value);
      Object.values(value).forEach((inner) => conditionsIn(inner, out));
    }
    return out;
  }

  // The conditions in a value that apply in one position of the Auto/Manual
  // switch: a moment whose `if` names the other position is left out (TP 5b).
  function conditionsFor(value, mode, out = []) {
    if (Array.isArray(value)) value.forEach((item) => conditionsFor(item, mode, out));
    else if (isObject(value)) {
      if (mode !== undefined && isObject(value.if) && value.if.auto !== undefined && value.if.auto !== mode) return out;
      if (KINDS.some((kind) => value[kind] !== undefined)) out.push(value);
      Object.values(value).forEach((inner) => conditionsFor(inner, mode, out));
    }
    return out;
  }
  // Whether anything in the rules reads the Auto/Manual switch.
  const readsAuto = (logic) => JSON.stringify([list(logic?.layers), list(logic?.resources)]).includes('"auto":');
  const isHold = (c) => c.board === undefined && c.mast !== undefined && (c.is === "held" || c.is === "unheld");

  /**
   * The inputs that can change: each { key, values, start, event(value) }.
   * Only what the rules, releases and approach lighting read, so a board's
   * unrelated sensors do not multiply the states. Remote boards are online
   * with their items clear, closed and not known (masts); JMRI's masts have
   * had no message.
   */
  function inputsOf(board) {
    const logic = board.logic || {};
    const blocks = new Map(list(logic.blocks).map((b) => [b.name, list(b.sensors)]));
    const fieldMasts = new Set(list(logic.layers).flatMap((l) => list(l.rules)).map((r) => r?.then?.mast).filter(Boolean));
    const inputs = new Map();
    const add = (key, values, start, event) => { if (!inputs.has(key)) inputs.set(key, { key, values, start, event }); };
    const sensor = (name) => add(`sensor\u0000${name}`, ["clear", "occupied"], "clear", (is) => ({ sensor: name, is }));
    const mastMeanings = new Map(); // end key -> the meanings rules compare it with
    const endItem = (end, track, what, meanings) => {
      const count = endTracks(board, end);
      if (!Number.isInteger(track) || track < 1 || track > count) return;
      const their = count + 1 - track;
      const key = endKey(end, track, what);
      if (what === "block") return add(key, ["clear", "occupied"], "clear", (is) => ({ end, track: their, block: is }));
      if (!mastMeanings.has(key)) mastMeanings.set(key, new Set());
      for (const m of meanings) mastMeanings.get(key).add(m);
      add(key, ["stop"], "stop", (tag) => ({ end, track: their, mast: tag }));
    };
    const remoteItem = (ref) => {
      const kind = ["sensor", "block", "turnout", "mast"].find((k) => ref[k] !== undefined);
      const name = ref[kind];
      const key = `${ref.board}\u0000${kind}\u0000${name}`;
      if (kind === "turnout") add(key, ["closed", "thrown"], "closed", (is) => ({ board: ref.board, turnout: name, is }));
      else if (kind === "mast") {
        const aspects = Object.keys(board.remote?.[ref.board]?.masts?.[name]?.aspects || {});
        add(key, ["unknown", ...aspects], "unknown", (aspect) => ({ board: ref.board, mast: name, aspect: aspect === "unknown" ? "" : aspect }));
      } else add(key, ["clear", "occupied"], "clear", (is) => ({ board: ref.board, [kind]: name, is }));
    };
    const block = (name, seen = new Set()) => {
      if (seen.has(name)) return;
      seen.add(name);
      if (!blocks.has(name)) return sensor(name);
      for (const member of blocks.get(name)) {
        if (typeof member === "string") sensor(member);
        else if (isObject(member) && member.board) remoteItem(member);
        else if (isObject(member) && member.end !== undefined) endItem(member.end, member.track, "block", []);
      }
    };
    const resources = list(logic.resources);
    for (const cond of conditionsIn([list(logic.layers).map((l) => list(l.rules)), resources.map((r) => r.release)])) {
      if (cond.end !== undefined && cond.board === undefined) {
        if (cond.hears === "mast") endItem(cond.end, cond.track, "mast", [].concat(cond.is).filter((m) => typeof m === "string"));
        else endItem(cond.end, cond.track, "block", []);
        continue;
      }
      if (cond.board !== undefined) { remoteItem(cond); continue; }
      if (cond.block !== undefined) block(cond.block);
      else if (cond.sensor !== undefined) sensor(cond.sensor);
      else if (cond.turnout !== undefined) add(`turnout\u0000${cond.turnout}`, ["closed", "thrown"], "closed", (is) => ({ turnout: cond.turnout, is }));
      else if (cond.button !== undefined) add(`button\u0000${cond.button}`, ["released", "pressed"], "released", (is) => ({ button: cond.button, is }));
      else if (cond.mast !== undefined && !fieldMasts.has(cond.mast) && board.masts?.[cond.mast]) {
        const mast = board.masts[cond.mast];
        const aspects = Object.keys(mast.aspects || {});
        add(`jmri\u0000${cond.mast}`, ["none", ...aspects], "none", (aspect) => ({
          jmri: cond.mast,
          message: aspect === "none" ? "" : (mast.states?.[aspect]?.[0] ?? `${aspect}; Lit; Unheld`),
        }));
      }
    }
    for (const res of resources) {
      for (const member of list(res.blocks)) {
        if (typeof member === "string") block(member);
        else if (isObject(member) && member.board) remoteItem(member);
        else if (isObject(member) && member.end !== undefined) endItem(member.end, member.track, "block", []);
      }
    }
    for (const mast of Object.values(board.masts || {})) if (typeof mast.approachLight === "string") block(mast.approachLight);
    // JMRI's hold on a mast the rules set (TP 5b): read by a route's rule
    // (a held mast is not granted, and a hold cancels its route), or by a
    // Held or Unheld condition. No message yet is only ever the start. The
    // old page's sections are left as they were checked before.
    const holdMasts = new Set();
    for (const layer of list(logic.layers)) {
      for (const rule of list(layer.rules)) {
        if (layer.routes === true && reservesOf(rule).length && rule?.then?.mast !== undefined) holdMasts.add(rule.then.mast);
        for (const cond of conditionsIn([rule?.trigger, rule?.checks, rule?.cancel, rule?.withdraw])) if (isHold(cond)) holdMasts.add(cond.mast);
      }
    }
    for (const name of holdMasts) {
      if (!fieldMasts.has(name) || !board.masts?.[name]) continue;
      add(`hold${SEP}${name}`, ["none", "unheld", "held"], "none", (is) => ({ jmri: name, message: `R292; Lit; ${is === "held" ? "Held" : "Unheld"}` }));
    }
    // The Auto/Manual switch, when the rules read it (TP 5b).
    if (readsAuto(logic)) add("auto", ["on", "off"], "on", (is) => ({ auto: is }));
    // An event setting a value it already has is not a step, so "none" and
    // "unknown" are only ever start values.
    for (const [key, meanings] of mastMeanings) inputs.get(key).values = ["stop", ...E().TAGS.filter((t) => t !== "stop" && meanings.has(t))];
    return [...inputs.values()];
  }

  // The events that bring a board's ends to the checker's start: each paired
  // with another board, which is on and answering, its blocks clear (as the
  // end inputs start; a block not yet heard reads occupied) and its signals
  // at Stop (not heard reads Stop already).
  function endSetup(board) {
    const events = [];
    for (const end of list(board.logic?.ends)) {
      if (!end?.name) continue;
      events.push({ end: end.name, link: `neighbour/${end.name}` }, { end: end.name, theirLink: `${SELF}/${end.name}` }, { end: end.name, online: true });
      list(end.tracks).forEach((_, i) => events.push({ end: end.name, track: i + 1, block: "clear" }));
    }
    return events;
  }
  // The inputs a rule's request depends on: its When and its Cancel, as
  // they read in one position of the switch (`mode`), and the switch itself.
  // A request in Auto stands with its train in the block behind; one made
  // in Manual stands with its hold and its button, whatever is behind.
  function requestInputs(rule, board, inputs, mode) {
    const keys = new Set();
    const logic = board.logic || {};
    const blocks = new Map(list(logic.blocks).map((b) => [b.name, list(b.sensors)]));
    const add = (cond) => {
      if (cond.end !== undefined && cond.board === undefined) {
        keys.add(endKey(cond.end, cond.track, cond.hears === "mast" ? "mast" : "block"));
      } else if (cond.board !== undefined) {
        const kind = ["sensor", "block", "turnout", "mast"].find((k) => cond[k] !== undefined);
        keys.add(`${cond.board}\u0000${kind}\u0000${cond[kind]}`);
      } else if (cond.block !== undefined && blocks.has(cond.block)) {
        for (const m of blocks.get(cond.block)) add(typeof m === "string" ? { sensor: m } : m);
      } else if (cond.block !== undefined || cond.sensor !== undefined) keys.add(`sensor\u0000${cond.block ?? cond.sensor}`);
      else if (cond.turnout !== undefined) keys.add(`turnout\u0000${cond.turnout}`);
      else if (cond.button !== undefined) keys.add(`button\u0000${cond.button}`);
      else if (isHold(cond)) keys.add(`hold${SEP}${cond.mast}`);
      else if (cond.mast !== undefined) keys.add(`jmri\u0000${cond.mast}`);
    };
    conditionsFor([rule.trigger, rule.cancel], mode).forEach(add);
    // The switch stays where it is, and so does JMRI's hold on its own mast:
    // CATS holding the signal it waits at is the dispatcher's choice.
    keys.add("auto");
    if (rule?.then?.mast !== undefined) keys.add(`hold${SEP}${rule.then.mast}`);
    return new Set(inputs.map((input, i) => (keys.has(input.key) ? i : -1)).filter((i) => i >= 0));
  }

  function startOf(board, inputs) {
    const remote = {};
    for (const name of Object.keys(board.remote || {})) remote[name] = { online: true, sensors: {}, turnouts: {}, masts: {} };
    for (const input of inputs) {
      const [b, kind, name] = input.key.split("\u0000");
      if (!remote[b] || name === undefined) continue;
      if (kind === "turnout") remote[b].turnouts[name] = "closed";
      else if (kind !== "mast") remote[b].sensors[name] = "clear";
    }
    const out = { logic: "on", broker: "connected", remote };
    if (list(board.logic?.ends).length) out.board = SELF;
    return out;
  }

  // Every time in the rules and sections, a moment's in a request or a
  // cancel included (before TP 5 only a trigger's and a section's counted,
  // so a wait could stop short of a 3 s cancel and call the request stuck).
  function longestTimerScans(board) {
    const ms = (value) => E().ms(value) || 0;
    let longest = 0;
    const walk = (value) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (isObject(value)) {
        for (const [key, inner] of Object.entries(value)) {
          if ((key === "for" || key === "approachLock") && typeof inner === "string") longest = Math.max(longest, ms(inner));
          else if (key === "approachLock" && isObject(inner)) longest = Math.max(longest, ms(inner.for));
          else walk(inner);
        }
      }
    };
    walk([list(board.logic?.layers), list(board.logic?.resources)]);
    return Math.ceil(longest / E().SCAN_MS) + 2;
  }

  // ===== Exploring ==========================================================

  // A state: what state() shows, the active rules, each section's waiting
  // order and the inputs. Not how requests for different sections interleave,
  // which nothing reads (logic.js checkerView), so a board with many plain
  // rules, such as an MSS module, has far fewer states.
  function keyOf(engine, values) {
    const { logic, ...state } = engine.state();
    const { active, asked, more } = engine.checkerView();
    return JSON.stringify([state, active, asked, more, values]);
  }

  // A seeded random number generator (mulberry32), so random runs repeat.
  function random(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ===== Parts: what each rule and mast depends on ==========================

  // A board splits into parts that are checked one at a time (work items 4.5
  // and TP 5). Rules reach each other in only two ways: through the sections
  // they reserve (with a leaving guard's, and a routes group's one request),
  // and through the aspects of the masts they read. Rules joined the first
  // way are one *group* (a rule with neither is a group of its own); setting
  // the same mast does not join them, since what a mast shows changes none
  // of its setters. A rule's part is its group and the groups that set every
  // mast it reads (all of a mast's setters decide what it shows), and so on:
  // nothing outside it changes what its rules do, so the part finds exactly
  // what the whole board does about them. A hold (Held or Unheld) is JMRI's
  // message, not what the mast shows, so reading one reads no setter. A
  // turnout lock is written, never read.
  // Whether a mast can leave Stop is decided only in a part with all of its
  // setters. A part inside another is not checked again, and a group nothing
  // reads (such as a turnout lock) joins a part that already has everything
  // it reads. Each part has only the inputs its own rules read, so two
  // tracks through a module, or the two directions on one, are checked side
  // by side, not multiplied together.
  // Returns [{ board, refOf, masts }]: refOf maps the part's rule refs back
  // to the board's; masts are those whose setters are all in the part.
  // The sections a rule takes: one, or several at once (a track plan's move).
  function reservesOf(rule) {
    const value = rule?.then?.reserve;
    return value === undefined ? [] : [].concat(value);
  }

  // The masts a condition list reads the aspect of, on this board.
  const aspectReads = (value) => conditionsIn(value)
    .filter((c) => c.board === undefined && c.end === undefined && c.mast !== undefined && c.is !== "held" && c.is !== "unheld")
    .map((c) => c.mast);

  // The names of the plain inputs a condition list reads (blocks, sensors,
  // turnouts, buttons): enough to tell whether a rule reads anything new.
  const namesIn = (value) => conditionsIn(value).flatMap((c) => ["block", "sensor", "turnout", "button"].filter((k) => c[k] !== undefined && c.board === undefined).map((k) => `${k === "sensor" ? "block" : k}${SEP}${c[k]}`));

  function partsOf(board) {
    const logic = board.logic || {};
    const rules = list(logic.layers).flatMap((layer) => list(layer.rules).map((rule, i) => ({ layer: layer.name, routes: layer.routes === true, i, rule })));
    const whole = (all) => [{ board, refOf: (ref) => ref, masts: all }];
    const fieldMasts = new Set(rules.map(({ rule }) => rule?.then?.mast).filter((m) => m !== undefined));
    if (rules.length < 2) return whole(fieldMasts);
    const releaseOf = new Map(list(logic.resources).map((res) => [res?.name, res?.release]));

    // Groups: rules joined by a section, a leaving guard or a shared request.
    const parent = rules.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const firstOf = new Map();
    const join = (i, key) => {
      if (firstOf.has(key)) parent[find(i)] = find(firstOf.get(key));
      else firstOf.set(key, i);
    };
    rules.forEach(({ layer, routes, rule }, i) => {
      const reserves = reservesOf(rule);
      for (const res of reserves) join(i, `res${SEP}${res}`);
      const guard = rule?.trigger?.leavingGuard;
      for (const res of Array.isArray(guard) ? guard : []) join(i, `res${SEP}${res}`);
      if (routes && reserves.length && rule?.trigger?.when) join(i, `ask${SEP}${layer}`);
    });
    const groups = [...new Set(rules.map((_, i) => find(i)))];
    const membersOf = new Map(groups.map((g) => [g, []]));
    rules.forEach((_, i) => membersOf.get(find(i)).push(i));

    // What each group reads, and who sets each mast.
    const settersOf = new Map();
    rules.forEach(({ rule }, i) => {
      const mast = rule?.then?.mast;
      if (mast === undefined) return;
      if (!settersOf.has(mast)) settersOf.set(mast, new Set());
      settersOf.get(mast).add(find(i));
    });
    const reads = new Map(groups.map((g) => [g, new Set()]));
    rules.forEach(({ rule }, i) => {
      const read = aspectReads([rule?.trigger, rule?.checks, rule?.cancel, rule?.withdraw, ...reservesOf(rule).map((res) => releaseOf.get(res))]);
      for (const mast of read) for (const g of settersOf.get(mast) || []) reads.get(find(i)).add(g);
    });
    const coneOf = (start) => {
      const cone = new Set(start);
      const queue = [...start];
      while (queue.length) for (const next of reads.get(queue.pop())) if (!cone.has(next)) { cone.add(next); queue.push(next); }
      return cone;
    };
    const readBySomeone = new Set(groups.filter((g) => [...reads.values()].some((r) => r.has(g))));
    const sinks = new Set(groups.filter((g) => !readBySomeone.has(g) && membersOf.get(g).every((i) => rules[i].rule?.then?.mast === undefined)));
    const targets = [
      ...groups.filter((g) => !sinks.has(g)).map((g) => coneOf([g])),
      ...[...settersOf.values()].map((setters) => coneOf([...setters])),
    ];
    if (targets.some((cone) => cone.size === groups.length)) return whole(fieldMasts);
    const inside = (a, b) => a.size <= b.size && [...a].every((g) => b.has(g));
    const kept = targets.filter((cone, i) => !targets.some((other, j) => j !== i && inside(cone, other) && (other.size > cone.size || j < i)));
    // A group nothing reads joins a part that has all it reads, when it
    // reads no input that part does not; otherwise it is a part of its own.
    // The inputs each group reads, worked out once; a part's are its groups'.
    const resourceBlocks = new Map(list(logic.resources).map((r) => [r?.name, list(r?.blocks).map((b) => (typeof b === "string" ? { block: b } : {}))]));
    const groupNames = new Map(groups.map((g) => [g, new Set(membersOf.get(g).flatMap((i) => {
      const { rule } = rules[i];
      return namesIn([rule?.trigger, rule?.checks, rule?.cancel, rule?.withdraw, ...reservesOf(rule).map((res) => [releaseOf.get(res), resourceBlocks.get(res)])]);
    }))]));
    const namesCache = new Map();
    const namesOf = (cone) => {
      if (!namesCache.has(cone)) {
        const names = new Set();
        for (const g of cone) for (const name of groupNames.get(g)) names.add(name);
        namesCache.set(cone, names);
      }
      return namesCache.get(cone);
    };
    const within = (a, b) => [...a].every((name) => b.has(name));
    for (const sink of sinks) {
      const own = coneOf([sink]);
      const rest = new Set([...own].filter((g) => g !== sink));
      const into = rest.size ? kept.find((cone) => inside(rest, cone) && within(groupNames.get(sink), namesOf(cone))) : null;
      if (into) {
        into.add(sink);
        namesCache.delete(into);
      } else if (!kept.some((cone) => inside(own, cone))) kept.push(own);
    }
    // A part that reads no input another does not is checked with it: its
    // rules add few states to the other's, and none of the other's inputs.
    for (let merged = true; merged; ) {
      merged = false;
      for (let a = 0; a < kept.length && !merged; a += 1) {
        for (let b = 0; b < kept.length && !merged; b += 1) {
          if (a === b || !within(namesOf(kept[a]), namesOf(kept[b]))) continue;
          for (const g of kept[a]) kept[b].add(g);
          namesCache.delete(kept[b]);
          kept.splice(a, 1);
          merged = true;
        }
      }
    }
    if (kept.length === 1) return whole(fieldMasts);

    return kept.map((cone) => {
      const inCone = (r) => cone.has(find(rules.indexOf(r)));
      const refs = new Map();
      const layers = list(logic.layers).map((layer) => {
        const own = rules.filter((r) => r.layer === layer.name && inCone(r));
        own.forEach((r, j) => refs.set(`${layer.name}/${j + 1}`, `${layer.name}/${r.i + 1}`));
        return { ...layer, rules: own.map((r) => r.rule) };
      }).filter((layer) => layer.rules.length);
      const reserved = new Set(layers.flatMap((layer) => layer.rules.flatMap(reservesOf)));
      const set = new Set(layers.flatMap((layer) => layer.rules.map((rule) => rule?.then?.mast)).filter((name) => name !== undefined));
      // Approach lighting only matters on a mast this part sets.
      const masts = Object.fromEntries(Object.entries(board.masts || {}).map(([name, mast]) => {
        if (set.has(name) || !isObject(mast) || mast.approachLight === undefined) return [name, mast];
        const { approachLight, ...rest } = mast;
        return [name, rest];
      }));
      const part = { ...board, masts, logic: { ...logic, layers, resources: list(logic.resources).filter((res) => reserved.has(res?.name)) } };
      const whole = new Set([...settersOf].filter(([, setters]) => [...setters].every((g) => cone.has(g))).map(([mast]) => mast));
      return { board: part, refOf: (ref) => refs.get(ref) ?? ref, masts: whole };
    });
  }

  // ===== Fewer inputs, the same behaviour ===================================

  // What the checker explores of a board's inputs (work item 4.5). Inputs the
  // rules cannot tell apart are explored once, so no behaviour is lost:
  //  - an input the rules read only through blocks (a sensor, an end's block,
  //    another board's item) counts only through those blocks. Two that sit
  //    in the same blocks the rules read are one: a check changes one input
  //    per scan, so the engine sees only whether either is occupied (a block's
  //    "went" is its own value against the last scan's). The first is kept.
  //  - values of what an end hears from its signal that every rule compares
  //    the same way (such as Stop and Restricting, where rules ask "Stop or
  //    Restricting") are one. The first is kept, so Stop stays the start.
  // Try it keeps every input (inputsOf), so this is the checker's only.
  function checkerInputs(board, inputs) {
    const logic = board.logic || {};
    const blocks = new Map(list(logic.blocks).map((b) => [b.name, list(b.sensors)]));
    const direct = new Set();
    const readBlocks = new Set();
    const memberKey = (m) => {
      if (typeof m === "string") return `sensor${SEP}${m}`;
      if (!isObject(m)) return null;
      if (m.end !== undefined) return endKey(m.end, m.track, "block");
      const kind = ["sensor", "block", "turnout", "mast"].find((k) => m[k] !== undefined);
      return m.board === undefined ? `sensor${SEP}${m.sensor ?? m.block}` : `${m.board}${SEP}${kind}${SEP}${m[kind]}`;
    };
    const readBlock = (name) => (blocks.has(name) ? readBlocks.add(name) : direct.add(`sensor${SEP}${name}`));
    const heard = new Map(); // end mast key -> the lists of meanings rules compare it with
    const resources = list(logic.resources);
    for (const cond of conditionsIn([list(logic.layers).map((l) => list(l.rules).map((r) => [r?.trigger, r?.checks, r?.cancel])), resources.map((r) => r.release)])) {
      if (cond.end !== undefined && cond.board === undefined) {
        if (cond.hears !== "mast") direct.add(endKey(cond.end, cond.track, "block"));
        else {
          const key = endKey(cond.end, cond.track, "mast");
          const is = [].concat(cond.is);
          if (!heard.has(key)) heard.set(key, []);
          if (is[0] !== "diverging") heard.get(key).push(is);
        }
      } else if (cond.board !== undefined) direct.add(memberKey(cond));
      else if (cond.block !== undefined) readBlock(cond.block);
      else if (cond.sensor !== undefined) direct.add(`sensor${SEP}${cond.sensor}`);
    }
    for (const res of resources) {
      for (const m of list(res.blocks)) (typeof m === "string" ? readBlock(m) : direct.add(memberKey(m)));
    }
    for (const mast of Object.values(board.masts || {})) if (typeof mast?.approachLight === "string") readBlock(mast.approachLight);

    const where = new Map(); // input key -> the read blocks it is in
    for (const name of readBlocks) {
      for (const m of blocks.get(name)) {
        const key = memberKey(m);
        if (key === null) continue;
        if (!where.has(key)) where.set(key, new Set());
        where.get(key).add(name);
      }
    }
    const seen = new Set();
    const out = [];
    for (const input of inputs) {
      const twoWay = input.values.length === 2 && input.values[0] === "clear" && input.values[1] === "occupied" && input.start === "clear";
      if (twoWay && !direct.has(input.key) && where.has(input.key)) {
        const sign = `block${SEP}${[...where.get(input.key)].sort().join(SEP)}`;
        if (seen.has(sign)) continue;
        seen.add(sign);
      }
      if (heard.has(input.key)) {
        const lists = heard.get(input.key);
        const kept = new Set();
        const values = input.values.filter((v) => {
          const sign = lists.map((is) => is.includes(v)).join();
          if (kept.has(sign)) return false;
          kept.add(sign);
          return true;
        });
        out.push({ ...input, values });
        continue;
      }
      out.push(input);
    }
    return out;
  }

  // ===== Exploring one part =================================================

  // Every state of one part, within the budget, or random runs past it.
  // Returns what it saw: { complete, states, tried, active (rule refs),
  // leftStop (masts), found (deadlocks and starvation, on a complete check) }.
  function explore(board, budget) {
    const { maxStates, deadline, runs, steps, seed, runsUntil } = budget;
    const engineOf = () => E().createEngine(board, start);
    const all = inputsOf(board);
    const inputs = budget.allInputs ? all : checkerInputs(board, all);
    const start = startOf(board, all);
    const waitLimit = longestTimerScans(board);
    const blockSensors = new Map(list(board.logic?.blocks).map((b) => [b.name, list(b.sensors).filter((m) => typeof m === "string")]));
    const endSensors = new Set(list(budget.endBlocks).flatMap((b) => blockSensors.get(b) || [b]));
    const nextOf = new Map(list(board.logic?.layers).flatMap((layer) => list(layer.rules).map((rule, i) => [`${layer.name}/${i + 1}`, rule?.then?.next || {}])));
    const sensorsOfResource = (name) => new Set(list(list(board.logic?.resources).find((r) => r?.name === name)?.blocks)
      .filter((b) => typeof b === "string").flatMap((b) => blockSensors.get(b) || [b]));

    const replay = (path) => {
      const engine = engineOf();
      for (const e of endSetup(board)) engine.event(e);
      engine.scan();
      for (const step of path) {
        if (step.do) {
          engine.event(step.do);
          engine.scan();
        } else for (let i = 0; i < step.wait; i += 1) engine.scan();
      }
      return engine;
    };

    // Successors of a node: one per input value it does not have, and a wait.
    // Each is { step, input (index, or -1 for a wait), values }.
    const moves = (values) => {
      const out = [];
      inputs.forEach((input, i) => {
        for (const value of input.values) {
          if (value === values[i] || value === "none" || value === "unknown") continue;
          out.push({ step: { do: input.event(value) }, input: i, values: values.map((v, j) => (j === i ? value : v)) });
        }
      });
      out.push({ step: null, input: -1, values });
      return out;
    };

    // Each state keeps a copy of the engine (logic.js snapshot) until its
    // successors have been explored: one engine branches from it, where
    // replaying the path from power-on cost a scan per step of the path.
    const nodes = [];
    const byKey = new Map();
    const record = (engine, values, path) => {
      const key = keyOf(engine, values);
      if (byKey.has(key)) return byKey.get(key);
      const { logic, ...state } = engine.state();
      const node = { id: nodes.length, key, path, values, state, view: engine.checkerView(), edges: [], saved: engine.snapshot() };
      nodes.push(node);
      byKey.set(key, node);
      return node;
    };

    const startValues = inputs.map((input) => input.start);
    const engine = replay([]);
    record(engine, startValues, []);
    let complete = true;
    // Past MAX_EXPLORE_INPUTS there are more states than any budget: straight to runs.
    const wide = inputs.length > MAX_EXPLORE_INPUTS;
    for (let at = 0; at < nodes.length; at += 1) {
      if (wide || nodes.length > maxStates || Date.now() > deadline) {
        complete = false;
        break;
      }
      const node = nodes[at];
      for (const move of moves(node.values)) {
        engine.restore(node.saved);
        let path;
        if (move.step) {
          path = [...node.path, move.step];
          engine.event(move.step.do);
          engine.scan();
        } else {
          // Wait until something changes, or every timer has had its time.
          // After a scan that changes nothing, the scans until the next timer
          // runs out are the same as it, so they are skipped; with no timer
          // running, nothing more happens.
          let waited = 0;
          while (waited < waitLimit && keyOf(engine, node.values) === node.key) {
            engine.scan();
            waited += 1;
            if (keyOf(engine, node.values) !== node.key) break;
            const idle = engine.idleScans();
            if (idle === Infinity) break;
            const skip = Math.min(idle, waitLimit - waited);
            engine.skip(skip);
            waited += skip;
          }
          if (keyOf(engine, node.values) === node.key) continue;
          path = [...node.path, { wait: waited }];
        }
        const to = record(engine, move.values, path);
        node.edges.push({ to: to.id, input: move.input });
      }
      node.saved = null;
    }
    for (const node of nodes) node.saved = null;

    // What was seen, from every state reached (and the random runs).
    const active = new Set();
    const leftStop = new Set();
    const tagOf = (mast, aspect) => board.masts?.[mast]?.aspects?.[aspect];
    const see = (state, view) => {
      view.active.forEach((ref) => active.add(ref));
      for (const [mast, aspect] of Object.entries(state.masts)) {
        if (aspect && aspect !== "dark" && tagOf(mast, aspect) && tagOf(mast, aspect) !== "stop") leftStop.add(mast);
      }
    };
    nodes.forEach((node) => see(node.state, node.view));

    let tried = 0;
    if (!complete) {
      const next = random(seed);
      // Runs stop once they have seen everything they are needed for.
      const need = budget.need;
      const allSeen = () => need && [...need.rules].every((ref) => active.has(ref)) && [...need.masts].every((m) => leftStop.has(m));
      for (let run = 0; run < runs && Date.now() <= runsUntil && !allSeen(); run += 1) {
        const engine = replay([]);
        let values = startValues;
        for (let s = 0; s < steps; s += 1) {
          const options2 = moves(values);
          const move = options2[Math.floor(next() * options2.length)];
          if (move.step) {
            engine.event(move.step.do);
            engine.scan();
            values = move.values;
          } else {
            const wait = 1 + Math.floor(next() * waitLimit);
            for (let i = 0; i < wait; i += 1) engine.scan();
          }
          const { logic, ...state } = engine.state();
          see(state, engine.checkerView());
        }
        tried += 1;
      }
    }

    // Deadlock and starvation need every state, so only on a complete check.
    const found = [];
    if (complete) {
      const reverse = nodes.map(() => []);
      nodes.forEach((node) => node.edges.forEach((edge) => reverse[edge.to].push({ from: node.id, input: edge.input })));
      for (const layer of list(board.logic?.layers)) {
        list(layer.rules).forEach((rule, i) => {
          const ref = `${layer.name}/${i + 1}`;
          const sections = reservesOf(rule);
          if (!sections.length) return;
          const section = sections[0];
          const frozenBy = { on: requestInputs(rule, board, inputs, "on"), off: requestInputs(rule, board, inputs, "off") };
          const autoAt = inputs.findIndex((input) => input.key === "auto");
          const frozenAt = (id) => frozenBy[autoAt < 0 ? "on" : nodes[id].values[autoAt]];
          // Waiting, and not held by JMRI or CATS: a held signal is not passed over.
          const own = rule?.then?.mast;
          const waiting = (node) => node.state.rules[ref] === "waiting" && !list(node.view.more?.[2]).some(([m, held]) => m === own && held === true);
          // States from which the rule can still be granted, its train waiting.
          const canGrant = new Set(nodes.filter((node) => node.view.active.includes(ref)).map((node) => node.id));
          const queue = [...canGrant];
          while (queue.length) {
            const id = queue.pop();
            for (const { from, input } of reverse[id]) {
              if (frozenAt(from).has(input) || canGrant.has(from)) continue;
              canGrant.add(from);
              queue.push(from);
            }
          }
          // Only a state where it stays waiting as time passes: just after its
          // train left, its When's *for* keeps it waiting for a moment, and
          // that request then lapses rather than being stuck.
          // Time alone is a chain of wait steps (one per state): follow it until
          // nothing more changes.
          const settled = (node) => {
            const seen = new Set();
            for (let at = node; at && !seen.has(at.id); ) {
              if (!waiting(at)) return false;
              seen.add(at.id);
              const wait = at.edges.find((edge) => edge.input === -1);
              at = wait ? nodes[wait.to] : null;
            }
            return true;
          };
          // A train standing on track another route holds came on against
          // that route: inside the drawing a signal stops it, and at an open
          // end the layout beyond does (TP 5, decided 2026-11-27). Such a
          // state is not counted.
          const onHeld = (node) => [...frozenAt(node.id)].some((i) => {
            if (!inputs[i].values.includes("occupied") || node.values[i] !== "occupied") return false;
            const sensor = inputs[i].key.split(SEP)[1];
            return Object.entries(node.state.holders).some(([res, holder]) => holder && holder !== ref
              && (sensorsOfResource(res).has(sensor) || (endSensors.has(sensor) && list(nextOf.get(holder)?.[res]).some((b) => (blockSensors.get(b) || [b]).includes(sensor)))));
          });
          const stuck = nodes.find((node) => settled(node) && !canGrant.has(node.id) && !onHeld(node));
          if (stuck) return void found.push({ kind: "deadlock", rule: ref, section, sequence: stuck.path });
          // Starvation: a loop of states, the rule waiting throughout and its
          // train still there, in which another rule is granted the section.
          const inLoop = starvedLoop(nodes, ref, frozenAt, sections, waiting);
          if (inLoop) found.push({ kind: "starvation", rule: ref, section, sequence: inLoop.path });
        });
      }
    }
    return { complete, states: nodes.length, tried, active, leftStop, found };
  }

  // ===== Routes in a part too big to explore (work item TP 5) ==============

  // A station's routes all share track with the next, so they are one part,
  // and with a sensor for every block it has far too many states to explore
  // (2 to the power of its inputs, before the rules). Such a part is checked
  // from its rules instead, for what only every state can show: a rule that
  // waits for good. The engine takes a rule's sections all at once, so a
  // rule that waits holds nothing, and grants go longest waiting first, so
  // a rule that waits is passed over only while rules that asked before it
  // go. It waits for good, its train standing at the signal (what it asks
  // and cancels with does not change), only if:
  //  1. its Only if and its sections clear can never be true together; or
  //  2. a rule that holds one of its sections can never run its train
  //     through it and free it: the train must be seen in a block, then in
  //     the next block along, then the section must be clear for its
  //     release, and a block where the waiting train stands cannot change;
  //  3. or a rule that may ask before it, for a section it needs, can then
  //     neither go and free its sections, as in 2, nor be kept from asking
  //     while it can go itself.
  // No rule is ever passed over for good (starvation). That a rule applies
  // and a signal leaves Stop is still seen in runs of the engine. Each check
  // tries every value of the few inputs it reads; what a signal shows, and
  // anything from another board, may be anything.
  // A part whose sections release on a sequence, with a leaving guard, or
  // taken by a rule that asks *while* something holds, is not one this
  // covers: it gets random runs only.
  const MAX_EXPLORE_INPUTS = 20;
  const ANALYSED_STATES = 5000;

  function analysable(board) {
    const logic = board.logic || {};
    if (list(logic.resources).some((res) => res?.release?.when !== undefined)) return false;
    // A rule that asks *while* something holds keeps its place in the queue
    // after it is granted, so with its train still there it can go first
    // again and again (rules-several-resources): only rules that ask *when*
    // something happens, as routes do, wait their turn after each grant.
    return list(logic.layers).every((layer) => list(layer.rules).every((rule) => !rule?.trigger?.leavingGuard && (reservesOf(rule).length === 0 || rule?.trigger?.when !== undefined)));
  }

  function routeProblems(board, auto = "on", endBlocks = []) {
    const logic = board.logic || {};
    const blocks = new Map(list(logic.blocks).map((b) => [b.name, list(b.sensors)]));
    const resources = new Map(list(logic.resources).map((res) => [res.name, res]));
    const memberVar = (m) => (typeof m === "string" ? `s${SEP}${m}` : isObject(m) && m.board === undefined && m.end === undefined ? `s${SEP}${m.sensor ?? m.block}` : `x${SEP}${JSON.stringify(m)}`);
    const blockVars = (name) => (blocks.has(name) ? blocks.get(name).map(memberVar) : [`s${SEP}${name}`]);
    const atom = (c) => `a${SEP}${JSON.stringify(c)}`;
    // The variables a condition reads: sensors (true: occupied), turnouts
    // ("closed" or "thrown"), and anything else as a free yes-or-no.
    const varsOf = (c, out = new Set()) => {
      if (Array.isArray(c)) c.forEach((x) => varsOf(x, out));
      else if (!isObject(c)) return out;
      else if (c.all || c.any) varsOf(c.all || c.any, out);
      else if (c.not) varsOf(c.not, out);
      else if (c.board === undefined && c.end === undefined && (c.block !== undefined || c.sensor !== undefined)) blockVars(c.block ?? c.sensor).forEach((v) => out.add(v));
      else if (c.board === undefined && c.end === undefined && c.turnout !== undefined) out.add(`t${SEP}${c.turnout}`);
      else if (c.auto === undefined) out.add(atom(c));
      return out;
    };
    const holds = (c, a) => {
      if (Array.isArray(c)) return c.every((x) => holds(x, a));
      if (!isObject(c)) return true;
      if (c.all) return c.all.every((x) => holds(x, a));
      if (c.any) return c.any.some((x) => holds(x, a));
      if (c.not) return !holds(c.not, a);
      const is = Array.isArray(c.is) ? c.is[0] : c.is;
      if (c.board === undefined && c.end === undefined && (c.block !== undefined || c.sensor !== undefined)) {
        const occ = blockVars(c.block ?? c.sensor).some((v) => a.get(v) === true);
        return is === "clear" ? !occ : occ;
      }
      if (c.board === undefined && c.end === undefined && c.turnout !== undefined) return a.get(`t${SEP}${c.turnout}`) === is;
      if (c.auto !== undefined) return c.auto === auto;
      return a.get(atom(c)) === true;
    };
    const valuesOf = (v) => (v.startsWith(`t${SEP}`) ? ["closed", "thrown"] : [false, true]);
    // A condition with some variables not yet given: true, false, or
    // undefined while it could still go either way.
    const maybe = (c, a) => {
      if (Array.isArray(c)) return all3(c.map((x) => maybe(x, a)));
      if (!isObject(c)) return true;
      if (c.all) return all3(c.all.map((x) => maybe(x, a)));
      if (c.any) return any3(c.any.map((x) => maybe(x, a)));
      if (c.not) { const v = maybe(c.not, a); return v === undefined ? undefined : !v; }
      const vars = [...varsOf(c)];
      if (vars.some((v) => !a.has(v))) {
        // A block is occupied once any of its sensors is.
        if (c.block !== undefined || c.sensor !== undefined) {
          if (vars.some((v) => a.get(v) === true)) return (Array.isArray(c.is) ? c.is[0] : c.is) !== "clear";
        }
        return undefined;
      }
      return holds(c, a);
    };
    const all3 = (vs) => (vs.includes(false) ? false : vs.includes(undefined) ? undefined : true);
    const any3 = (vs) => (vs.includes(true) ? true : vs.includes(undefined) ? undefined : false);
    // Some values of the free variables make every condition true, with
    // `fixed` as given: tried one variable at a time, giving up on a branch
    // as soon as a condition is false.
    const sat = (conds, fixed) => {
      const free = [...varsOf(conds)].filter((v) => !fixed.has(v));
      const a = new Map(fixed);
      const go = (i) => {
        const now = maybe(conds, a);
        if (now !== undefined) return now;
        if (i === free.length) return false;
        const ok = valuesOf(free[i]).some((value) => { a.set(free[i], value); return go(i + 1); });
        a.delete(free[i]);
        return ok;
      };
      return go(0);
    };
    const clearOf = (names) => names.flatMap((name) => (resources.get(name) ? list(resources.get(name).blocks) : []))
      .filter((b) => typeof b === "string").map((block) => ({ block, is: "clear" }));
    const rules = list(logic.layers).flatMap((layer) => list(layer.rules).map((rule, i) => ({ ref: `${layer.name}/${i + 1}`, rule, takes: reservesOf(rule).filter((name) => resources.has(name)) })))
      .filter((r) => r.takes.length);
    // A train can be seen going into a block, then leave it, with `fixed`.
    const canEnter = (name, fixed) => {
      const vars = blockVars(name);
      return vars.every((v) => !fixed.has(v) || fixed.get(v) === false) && vars.some((v) => !fixed.has(v));
    };
    // Rule q, holding section `name`, can run its train through and free it.
    const through = (q, name, fixed) => {
      const res = resources.get(name);
      const own = list(res.blocks).filter((b) => typeof b === "string");
      const vars = own.flatMap(blockVars);
      const occupy = vars.some((v) => !fixed.has(v) || fixed.get(v) === true);
      const clear = vars.every((v) => !fixed.has(v) || fixed.get(v) === false);
      const release = res.release?.while !== undefined && sat([res.release.while], fixed);
      const next = q.rule?.then?.next && typeof q.rule.then.next === "object" ? list(q.rule.then.next[name]) : [];
      return occupy && clear && release && (!next.length || next.some((b) => canEnter(b, fixed)));
    };
    // What a rule asks with, each way it can ask, as states its inputs are in.
    const asksOf = (rule) => {
      const t = rule?.trigger || {};
      if (!t.when) return [[t.while]];
      const ways = isObject(t.when) && t.when.any ? t.when.any : [t.when];
      return ways.map((m) => {
        const is = Array.isArray(m.is) ? m.is[0] : m.is;
        const { if: when, for: _f, notFrom: _n, ...core } = m;
        const own = core.button !== undefined || (core.mast !== undefined && (is === "held" || is === "unheld")) ? [] : [core];
        return when === undefined ? own : [...own, when];
      }).filter((conds) => conds.every((c) => !isObject(c) || c.auto === undefined || c.auto === auto));
    };
    // A rule whose Only if can never be true never asks, and one that can
    // never have its sections clear with it never takes them.
    const canAsk = (q) => sat(q.rule.checks || [], new Map());
    const canTake = (q) => sat([...q.rule.checks || [], ...clearOf(q.takes)], new Map());
    const found = [];
    for (const r of rules) {
      const frozen = [...varsOf(conditionsFor([r.rule.trigger, r.rule.cancel], auto).map(({ if: _i, for: _f, notFrom: _n, ...c }) => c))];
      if (frozen.length > 12) continue;
      const mine = [...r.rule.checks || [], ...clearOf(r.takes)];
      let why = null;
      for (const asked of asksOf(r.rule)) {
        // Every value of what it asks with that asks, with its train waiting.
        const tries = [new Map()];
        for (const v of frozen) {
          const next = [];
          for (const a of tries) for (const value of valuesOf(v)) next.push(new Map(a).set(v, value));
          tries.splice(0, tries.length, ...next);
        }
        for (const fixed of tries) {
          if (!holds(asked, fixed)) continue;
          if (!sat([...asked, ...(r.rule.checks || [])], fixed)) continue;
          if (!sat(mine, fixed)) { why = { section: r.takes[0], reason: "own" }; break; }
          for (const q of rules) {
            if (q === r || !canAsk(q)) continue;
            const shared = q.takes.filter((name) => r.takes.includes(name));
            if (!shared.length) continue;
            // Its train cannot be standing on track q holds: it would have
            // come on against q's route (see onHeld in explore).
            // Nor, at an end of the drawing, in a block q's route leads into:
            // the layout beyond holds a train coming the other way (decided
            // 2026-11-27: a head-on meeting there is released by hand).
            const heldVars = new Set(q.takes.flatMap((name) => list(resources.get(name).blocks).filter((b) => typeof b === "string").flatMap(blockVars)));
            const nextVars = new Set(q.takes.flatMap((name) => list(q.rule?.then?.next?.[name])).filter((b) => endBlocks.includes(b)).flatMap(blockVars));
            if ([...fixed].some(([v, value]) => value === true && (heldVars.has(v) || nextVars.has(v)))) continue;
            const stuck = canTake(q) && shared.find((name) => !through(q, name, fixed));
            if (stuck) { why = { section: stuck, reason: `held by ${q.ref}` }; break; }
            const goes = sat([...q.rule.checks || [], ...clearOf(q.takes)], fixed) && q.takes.every((name) => through(q, name, fixed));
            if (!goes && !sat([...mine, { not: { all: q.rule.checks || [] } }], fixed)) { why = { section: shared[0], reason: `asked first by ${q.ref}` }; break; }
          }
          if (why) break;
        }
        if (why) break;
      }
      if (why) found.push({ kind: "deadlock", rule: r.ref, section: why.section, reason: why.reason, fromRules: true });
    }
    return found;
  }

  // The budgets (spec, Checking in the browser; measured in work item 4.5
  // with test/bench/checker-limits.mjs). Validation runs on every change to
  // the rules, so it must stay quick: what it cannot finish it tries in
  // random runs, and says so. A full check is asked for on the Download page.
  const BUDGETS = Object.freeze({
    validation: Object.freeze({ maxStates: 2000, maxMs: 400, runs: 100, steps: 40, runsMs: 200, quick: true }),
    full: Object.freeze({ maxStates: 30000, maxMs: 20000, runs: 1000, steps: 60, runsMs: 5000 }),
  });

  /**
   * Check a board in the engine cases' format (EsphomeMrLogicYaml.logicTable).
   * Options (default BUDGETS.full): maxStates and maxMs, shared by its parts;
   * runs and steps for the random fallback of each part that does not finish,
   * for at most runsMs more; quick (the partial warning then points at the
   * full check); seed (default 1). split: false checks the board
   * as one part, and allInputs: true explores every input inputsOf gives: the
   * tests compare them with the defaults.
   * Returns { complete, states, runs, parts, problems: [{ level, kind, text,
   * rule?, mast?, sequence? }] }.
   */
  function checkBoard(board, options = {}) {
    const { maxStates, maxMs, runs, steps, runsMs } = { ...BUDGETS.full, ...options };
    const { seed = 1, split = true, allInputs = false, quick = false } = options;
    const ignore = new Set(list(options.ignore));
    const fromRules = options.fromRules !== false;
    const endBlocks = list(options.endBlocks);
    const started = Date.now();
    const deadline = started + maxMs;
    const runsUntil = deadline + runsMs;

    const allMasts = new Set(list(board.logic?.layers).flatMap((l) => list(l.rules).map((r) => r?.then?.mast)).filter((m) => m !== undefined));
    const parts = split ? partsOf(board) : [{ board, refOf: (ref) => ref, masts: allMasts }];
    let states = 0;
    let tried = 0;
    let complete = true;
    const activeSeen = new Set();
    const leftStop = new Set();
    const provenRules = new Set(); // rules in a part that finished
    const provenMasts = new Set();
    const found = new Map();
    const analysed = []; // parts checked from their rules: what runs must still see
    for (const part of parts) {
      const need = {
        rules: new Set(list(part.board.logic?.layers).filter((layer) => !ignore.has(layer.name)).flatMap((layer) => list(layer.rules).map((_, i) => `${layer.name}/${i + 1}`))),
        masts: part.masts,
      };
      // A part the routes' rules can check need not be explored to the end
      // of the budget: past ANALYSED_STATES its rules decide.
      const share = Math.max(maxStates - states, 0);
      const byRules = fromRules && analysable(part.board);
      const seen = explore(part.board, { maxStates: byRules ? Math.min(share, ANALYSED_STATES) : share, deadline, runs, steps, seed, runsUntil, allInputs, endBlocks, need });
      states += seen.states;
      tried += seen.tried;
      if (!seen.complete && byRules) {
        // In each position of the switch the rules read (TP 5b).
        for (const mode of readsAuto(part.board.logic) ? ["on", "off"] : ["on"]) {
          for (const f of routeProblems(part.board, mode, endBlocks)) if (!seen.found.some((g) => g.rule === f.rule)) seen.found.push(f);
        }
        analysed.push(part);
      } else if (!seen.complete) complete = false;
      seen.active.forEach((ref) => activeSeen.add(part.refOf(ref)));
      seen.leftStop.forEach((mast) => { if (part.masts.has(mast)) leftStop.add(mast); });
      if (seen.complete) {
        for (const layer of list(part.board.logic?.layers)) {
          list(layer.rules).forEach((rule, i) => {
            provenRules.add(part.refOf(`${layer.name}/${i + 1}`));
            if (part.masts.has(rule?.then?.mast)) provenMasts.add(rule.then.mast);
          });
        }
      }
      for (const f of seen.found) {
        const ref = part.refOf(f.rule);
        if (!found.has(ref)) found.set(ref, { ...f, rule: ref });
      }
    }

    const logic = board.logic || {};
    const rules = list(logic.layers).flatMap((layer) => list(layer.rules).map((rule, i) => ({ ref: `${layer.name}/${i + 1}`, rule })));
    const problems = [];
    const deadlocked = new Set();
    for (const { ref } of rules) {
      const f = found.get(ref);
      if (!f) continue;
      if (f.kind === "deadlock" && f.fromRules) {
        deadlocked.add(ref);
        problems.push({ level: "error", kind: "deadlock", rule: ref, text: TEXT.deadlockFound(ruleWords(ref), f.section) });
      } else if (f.kind === "deadlock") {
        deadlocked.add(ref);
        problems.push({ level: "error", kind: "deadlock", rule: ref, text: TEXT.deadlock(ruleWords(ref), f.section), sequence: f.sequence });
      } else problems.push({ level: "warning", kind: "starvation", rule: ref, text: TEXT.starved(ruleWords(ref), f.section), sequence: f.sequence });
    }

    // A block signals or route signal rule 1 ("the next mast is diverging")
    // is always written (spec, Block signals), so it never applies when the
    // next mast has no diverging aspect. That is by design: no warning.
    const divergingOf = (cond) => {
      const mast = cond.board !== undefined ? board.remote?.[cond.board]?.masts?.[cond.mast] : board.masts?.[cond.mast];
      return list(mast?.diverging).length > 0;
    };
    const fallback = (rule) => conditionsIn([rule?.trigger, rule?.checks]).some((cond) => cond.mast !== undefined && cond.is === "diverging" && !divergingOf(cond));
    for (const { ref, rule } of rules) {
      if (deadlocked.has(ref) || activeSeen.has(ref) || fallback(rule)) continue;
      const text = provenRules.has(ref) ? TEXT.neverActive(ruleWords(ref)) : TEXT.neverSeen(ruleWords(ref), tried);
      problems.push({ level: "warning", kind: "never-active", rule: ref, text });
    }
    const fieldMasts = [...new Set(rules.map(({ rule }) => rule?.then?.mast).filter(Boolean))];
    for (const mast of fieldMasts) {
      if (leftStop.has(mast)) continue;
      problems.push({ level: "warning", kind: "stuck", mast, text: provenMasts.has(mast) ? TEXT.stuck(mast) : TEXT.stuckSeen(mast, tried) });
    }
    // A part checked from its rules is complete once runs have seen each of
    // its rules apply (but those `ignore` names, and rule 1 above) and each
    // of its masts leave Stop.
    for (const part of analysed) {
      const layers = list(part.board.logic?.layers);
      const unseen = layers.some((layer) => !ignore.has(layer.name) && list(layer.rules).some((rule, i) => {
        const ref = part.refOf(`${layer.name}/${i + 1}`);
        return !activeSeen.has(ref) && !deadlocked.has(ref) && !fallback(rule);
      }));
      if (unseen || [...part.masts].some((mast) => !leftStop.has(mast))) complete = false;
    }
    if (!complete) problems.push({ level: "warning", kind: "partial", text: TEXT.tooMany(tried, quick) });
    return { complete, states, runs: tried, parts: parts.length, problems };
  }

  // A loop of states where `ref` waits throughout (and its request's inputs
  // do not change) and some other rule takes one of its sections: the node
  // to show.
  function starvedLoop(nodes, ref, frozenAt, sections, waiting) {
    const inSet = waiting;
    const ids = nodes.filter(inSet).map((node) => node.id);
    const member = new Set(ids);
    // Tarjan's strongly connected components over the waiting states.
    let index = 0;
    const idx = new Map();
    const low = new Map();
    const stack = [];
    const on = new Set();
    const found = [];
    const strong = (v) => {
      idx.set(v, index);
      low.set(v, index);
      index += 1;
      stack.push(v);
      on.add(v);
      for (const { to, input } of nodes[v].edges) {
        if (!member.has(to) || frozenAt(v).has(input)) continue;
        if (!idx.has(to)) {
          strong(to);
          low.set(v, Math.min(low.get(v), low.get(to)));
        } else if (on.has(to)) low.set(v, Math.min(low.get(v), idx.get(to)));
      }
      if (low.get(v) === idx.get(v)) {
        const comp = [];
        let w;
        do {
          w = stack.pop();
          on.delete(w);
          comp.push(w);
        } while (w !== v);
        found.push(comp);
      }
    };
    for (const id of ids) if (!idx.has(id)) strong(id);
    for (const comp of found) {
      const inComp = new Set(comp);
      // A grant inside the loop: an edge into a state where another rule
      // holds the section that it did not hold before.
      for (const v of comp) {
        for (const { to, input } of nodes[v].edges) {
          if (!inComp.has(to) || frozenAt(v).has(input)) continue;
          for (const section of sections) {
            const before = nodes[v].state.holders[section];
            const after = nodes[to].state.holders[section];
            if (after && after !== ref && after !== before) return nodes[v];
          }
        }
      }
    }
    return null;
  }

  // ===== For validation =====================================================

  // The last check, by the rule table it ran on: the page asks on every draw.
  let last = { json: null, result: null };
  const tableOf = (config) => {
    const table = global.EsphomeMrLogicYaml?.logicTable(config);
    return table && list(table.logic?.layers).length ? table : null;
  };

  /**
   * Check a configurator board (Field Logic or MSS Logic). Memoised on the
   * rule table, and bounded so the page stays quick (BUDGETS.validation):
   * what it cannot finish, it says. A full check of the same rules, once
   * made, is what it returns until they change.
   */
  function checkConfig(config, options = BUDGETS.validation) {
    const table = tableOf(config);
    if (!table) return null;
    const json = JSON.stringify(table);
    if (last.json === json) return mine(config, last.result);
    const result = checkBoard(table, { ...options, ...planOptions(config) });
    last = { json, result };
    return mine(config, result);
  }

  // A rule the track plan made that never applies is the drawing's own
  // spare row, not something to change: no warning for it. Deadlocks and
  // waiting forever are still reported.
  const madeLayers = (config) => list(global.EsphomeMrLogicYaml?.logicItems(config)?.layers)
    .filter((layer) => String(layer?.starter || "").startsWith("plan-")).map((layer) => String(layer.name));
  // What a track plan tells the checker beyond its rules: its own layers,
  // and the blocks at the ends of the drawing.
  const planOptions = (config) => ({ ignore: madeLayers(config), endBlocks: list(global.EsphomeMrLogicYaml?.logicItems(config)?.endBlocks) });
  function mine(config, result) {
    if (!result) return result;
    const made = new Set(madeLayers(config));
    if (!made.size) return result;
    const ofPlan = (p) => p.kind === "never-active" && made.has(String(p.rule).slice(0, String(p.rule).lastIndexOf("/")));
    return { ...result, problems: result.problems.filter((p) => !ofPlan(p)) };
  }

  /** Check every combination (BUDGETS.full), for the Download page's button. */
  function checkFully(config) {
    const table = tableOf(config);
    if (!table) return null;
    const json = JSON.stringify(table);
    if (last.json === json && last.result?.complete) return mine(config, last.result);
    const result = checkBoard(table, { ...BUDGETS.full, ...planOptions(config) });
    last = { json, result };
    return mine(config, result);
  }

  /** Whether the last check of these rules gave up: the Download page offers a full one. */
  function needsFullCheck(config) {
    const table = tableOf(config);
    return !!table && last.json === JSON.stringify(table) && last.result?.complete === false;
  }

  global.EsphomeMrLogicChecker = { TEXT, SELF, BUDGETS, checkBoard, routeProblems, analysable, checkConfig, checkFully, needsFullCheck, partsOf, checkerInputs, inputsOf, endSetup, endKey, isEndKey, ruleWords };
})(typeof globalThis !== "undefined" ? globalThis : window);
