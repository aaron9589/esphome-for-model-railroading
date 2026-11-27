// Try it, the pure core (docs/field-logic-spec.md, Checking in the browser and
// Show, don't describe; work item 2.10). No DOM: logic-ui-try.js draws it.
//
// A session runs a board's rules in the JS engine (logic.js) with the inputs
// the person sets, and reports what the signals, sections and turnouts do. A
// track shape works out the strip diagram from a group a starter wrote. Run a
// train steps a train through a path of blocks and records every signal.
//
// Boards: a configurator config (Field Logic), or a board in the engine
// cases' format (what EsphomeMrLogicYaml.logicTable gives).
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const E = () => global.EsphomeMrLogic;
  const C = () => global.EsphomeMrLogicChecker;
  const Y = () => global.EsphomeMrLogicYaml;
  const SEP = "\u0000";

  // Every word the page shows from here. The page's lint reads it.
  const TEXT = Object.freeze({
    values: Object.freeze({
      clear: "Clear", occupied: "Occupied", closed: "Closed", thrown: "Thrown",
      pressed: "Pressed", released: "Released", unknown: "Not known", none: "No message yet",
    }),
    // What a remote input reads as while it is not known (spec, Fail safe).
    readsAs: Object.freeze({
      sensor: "Not known: counts as occupied",
      block: "Not known: counts as occupied",
      turnout: "Not known: counts as neither closed nor thrown",
      mast: "Not known: counts as Stop",
    }),
    endReadsAs: Object.freeze({
      block: "Not known: counts as occupied",
      mast: "Not known: counts as Stop",
      none: "Not paired: the track beyond counts as occupied, and its signal as Stop",
      unheard: "Paired but not heard: the track beyond counts as occupied, and its signal as Stop",
    }),
    endLink: (end) => `End ${end}: the board beyond`,
    endBlock: (end, track) => `End ${end}, track ${track}: the block beyond`,
    endMast: (end, track) => `End ${end}, track ${track}: the signal beyond`,
    endLinkValues: Object.freeze({
      none: "Not paired",
      end: "End of the line",
      heard: "Paired and heard",
      unheard: "Paired, not heard",
    }),
    endStates: Object.freeze({
      pairing: "Pairing",
      empty: "Not paired",
      end: "End of the line",
      unheard: "Paired, not heard",
      disagrees: "The other end names a different end",
      heard: "Paired and heard",
    }),
    drivenByNeighbour: (end) => `End ${end} has a pretend neighbour. Turn it off to set this by hand.`,
    pretendBlock: (end, track, at) => `Pretend neighbour at end ${end}, track ${track}, block ${at}`,
    pretendSignal: (end, track, at) => `Pretend neighbour signal ${at} at end ${end}, track ${track}`,
    fromBoard: (name, board) => `${name} (from ${board})`,
    setByJmri: (name) => `${name} (what JMRI or CATS sends)`,
    meanings: Object.freeze({ stop: "Stop", restricting: "Restricting", approach: "Approach", advance: "Advance Approach", clear: "Clear" }),
    dark: "Dark",
    nothingShown: "Nothing shown yet",
    phases: Object.freeze({
      idle: "Not in use",
      waiting: "Waiting for its section",
      active: "Has its section",
      passed: "The train is in the section",
      cancelling: "Gave up, section still held",
    }),
    sectionStates: Object.freeze({
      IDLE: "Free",
      ACTIVE: "Taken, waiting for the train",
      PASSED: "A train is in it",
      CANCELLING: "Held a while after the request stopped",
    }),
    heldAtStart: "Held since start-up",
    turnoutFree: "Free to throw",
    turnoutLockedByRules: "Locked by the rules",
    turnoutLockedByJmri: "Locked by JMRI or CATS",
    ruleWords: (group, n) => `Rule ${n} in group "${group}"`,
    log: Object.freeze({
      startup: "Started up",
      grant: (rule, section) => `${rule} took section "${section}"`,
      cancel: (rule, section) => `${rule} stopped asking for section "${section}"`,
      pass: (section, rule) => (rule ? `A train went into section "${section}" (${rule})` : `A train was already in section "${section}" at start-up`),
      release: (section, by) => `Section "${section}" is free again ${TEXT_BY[by] || ""}`.trim(),
      ignored: (section) => `A release of section "${section}" just after connecting was ignored`,
      resync: (turnout) => `Turnout "${turnout}" can move to match its switch again`,
    }),
    trainBefore: "Before the train",
    trainEnters: (block) => `Train enters ${block}`,
    trainLeaves: (block) => `Train leaves ${block}`,
    unnamed: "(no name)",
  });
  const TEXT_BY = Object.freeze({
    release: "when its release condition held",
    cancel: "because the request stopped",
    time: "when the hold time ran out",
    manual: "by hand",
    switch: "because logic was switched off",
  });

  // ===== Boards =============================================================

  function boardOf(source) {
    if (!isObject(source)) return null;
    const isConfig = source.signals !== undefined || source.board !== undefined || source.points !== undefined;
    return isConfig ? Y().logicTable(source) : source;
  }

  // The field at power-on, as the checker starts it: other boards online, their
  // sensors clear and turnouts closed, their masts not known.
  function startOf(board, inputs) {
    const remote = {};
    for (const name of Object.keys(board.remote || {})) remote[name] = { online: true, sensors: {}, turnouts: {}, masts: {} };
    for (const input of inputs) {
      const [b, kind, name] = input.key.split(SEP);
      if (!remote[b] || name === undefined) continue;
      if (kind === "turnout") remote[b].turnouts[name] = "closed";
      else if (kind !== "mast") remote[b].sensors[name] = "clear";
    }
    return { logic: "on", broker: "connected", remote };
  }

  // The longest time any rule or section waits, in milliseconds.
  function longestFor(board) {
    const ms = (value) => E().ms(value) || 0;
    let longest = 0;
    for (const layer of list(board.logic?.layers)) for (const rule of list(layer.rules)) longest = Math.max(longest, ms(rule?.trigger?.for));
    for (const res of list(board.logic?.resources)) longest = Math.max(longest, ms(res.release?.for), ms(res.approachLock));
    return longest;
  }

  // ===== Inputs =============================================================

  const KINDS = ["turnout", "button", "block", "sensor"];

  // A label and settable values for one of the checker's inputs.
  function describeInput(input, board) {
    const parts = input.key.split(SEP);
    let info;
    if (input.info) return { key: input.key, ...input.info };
    if (parts.length === 3) {
      const [b, kind, name] = parts;
      const values = kind === "mast" ? [...input.values] : [...input.values, "unknown"];
      info = { kind, board: b, name, label: TEXT.fromBoard(name, b), remote: true, values };
    } else {
      const [kind, name] = parts;
      if (kind === "jmri") info = { kind: "mast", name, label: TEXT.setByJmri(name), remote: false, jmri: true, values: input.values.filter((v) => v !== "none") };
      else info = { kind, name, label: name, remote: false, values: [...input.values] };
    }
    return { key: input.key, ...info };
  }

  // "Not known" in words, for a remote input.
  function readsAs(info, value = info.value) {
    if (info.kind === "end") {
      if (info.what === "link") return value === "none" || value === "unheard" ? TEXT.endReadsAs[value] : "";
      return value === "unknown" ? TEXT.endReadsAs[info.what] : "";
    }
    return info.remote ? TEXT.readsAs[info.kind] : "";
  }

  function valueLabel(info, value) {
    if (info.kind === "end") {
      if (info.what === "link") return TEXT.endLinkValues[value] || String(value);
      if (info.what === "mast") return value === "unknown" ? TEXT.values.unknown : TEXT.meanings[value] || String(value);
      return TEXT.values[value] || String(value);
    }
    if (TEXT.values[value] && !(info.kind === "mast" && value !== "unknown" && value !== "none")) return TEXT.values[value];
    return String(value);
  }

  // ===== The session ========================================================

  /**
   * A Try it session for a configurator config or an engine board. Returns
   * null when the config has no rules to run (not Field Logic).
   *
   *   inputs()               [{ key, kind, name, board?, label, remote, jmri?, values, value }]
   *   find(kind, name, board?)  the input's key (made when no rule reads it)
   *   setInput(key, value, { scan })  set it, then one scan (scan: false to skip)
   *   setBoardOnline(board, online)   another board's Online topic
   *   event(e, { scan })     any engine event; the checker's { do } step
   *   step()                 one scan
   *   advance(ms)            scans for that long, timers skipped forward
   *   play(sequence)         reset, then a Show me sequence
   *   reset()                power-on again
   *   view()                 masts, rules, sections, turnouts, time, waiting order, log
   *   setBlock(ref, occupied), blockOccupied(ref)   a train in a block, or not
   *   shapes                 the track shapes of the groups a starter wrote
   *   board                  the engine board
   *
   * Plant ends (work item 3.4, spec: "Try it treats each end's two values as
   * remote inputs"). Each end the rules read is an input for its link (not
   * paired, end of the line, paired and heard, paired but not heard) and, per
   * track, the block beyond (clear, occupied, not known) and the signal beyond
   * (a meaning, or not known). It starts as the checker does: paired, heard,
   * clear, Stop. A pretend neighbour (setNeighbour) takes those inputs over:
   *
   *   neighbours()           [{ end, on, tracks: [{ track, direction: "into" | "away",
   *                          blocks: [{ at, ref, occupied }], signals: [{ at, tag, meaning }],
   *                          offers: { block, mast }, hears: { occupied, tag } }] }]
   *   setNeighbour(end, on, { scan })     the pretend neighbour on or off
   *   turnNeighbour(end, track, { scan }) which way its trains run
   *   neighbourPath(end, track)           its blocks, in the order a train runs
   *   setBlock / blockOccupied also take { pretend: end, track, at } for its blocks
   */
  function createSession(source, options = {}) {
    const board = boardOf(source);
    if (!board || !list(board.logic?.layers).length) return null;
    const checkerInputs = C().inputsOf(board);
    const baseInputs = checkerInputs.filter((input) => !C().isEndKey(input.key)).map((input) => ({ ...input }));
    const readEnds = new Set(checkerInputs.filter((input) => C().isEndKey(input.key)).map((input) => input.key));
    const start = options.start ? { ...options.start } : startOf(board, baseInputs);
    const endDefs = list(board.logic?.ends).filter((end) => isObject(end) && typeof end.name === "string" && end.name);
    if (endDefs.length && start.board === undefined) start.board = C().SELF;
    const me = String(start.board ?? "");
    const endInputs = [];
    const hidden = new Set();
    for (const end of endDefs) {
      const tracks = list(end.tracks);
      const linkKey = ["~end", end.name, "link"].join(SEP);
      const linkValues = ["none", "end", "heard", "unheard"];
      endInputs.push({ key: linkKey, values: linkValues, start: "heard", endName: end.name, info: { kind: "end", what: "link", end: end.name, label: TEXT.endLink(end.name), remote: true, values: linkValues } });
      let anyRead = false;
      tracks.forEach((_, i) => {
        const k = i + 1;
        for (const what of ["block", "mast"]) {
          const key = C().endKey(end.name, k, what);
          const vals = what === "block" ? ["clear", "occupied", "unknown"] : ["unknown", ...E().TAGS];
          endInputs.push({
            key, values: vals, start: what === "block" ? "clear" : "stop", endName: end.name,
            info: { kind: "end", what, end: end.name, track: k, label: what === "block" ? TEXT.endBlock(end.name, k) : TEXT.endMast(end.name, k), remote: true, values: vals },
          });
          if (readEnds.has(key)) anyRead = true;
          else hidden.add(key);
        }
      });
      if (!anyRead) hidden.add(linkKey);
    }
    const endDef = (name) => endDefs.find((end) => end.name === name);
    const linkKeyOf = (name) => ["~end", name, "link"].join(SEP);
    const extras = [];
    const infos = new Map();
    let engine;
    let values;
    let log;
    let version = 0;
    const online = new Map();

    const allInputs = () => [...baseInputs, ...endInputs, ...extras];
    const byKey = (key) => allInputs().find((input) => input.key === key);
    const infoOf = (input) => {
      if (!infos.has(input.key)) infos.set(input.key, describeInput(input, board));
      return infos.get(input.key);
    };

    // ----- the pretend neighbours -----
    // Per end, per track of it: three blocks in a row away from the joint
    // (at 1 is the nearest), each with a signal that guards a train entering
    // it. Plain block signals: a signal shows Stop while its block is
    // occupied, and otherwise one step more permissive than the signal ahead
    // (Stop gives Approach, Approach gives Advance Approach, Advance Approach
    // and Clear give Clear). A track the board signals itself (it has a mast
    // or passes through) carries trains "into" this board: they run from
    // block 3 to block 1, and the signal ahead of block 1 is what the board
    // offers. Any other track carries them "away": from block 1 to block 3,
    // with an open line past it. The neighbour offers this board its nearest
    // block and that block's signal.
    const NEXT = { stop: "approach", restricting: "approach", approach: "advance", advance: "clear", clear: "clear" };
    const neighbourState = new Map(endDefs.map((end) => [end.name, {
      on: false,
      dir: list(end.tracks).map((track) => (isObject(track) && (track.mast !== undefined || track.through) ? "into" : "away")),
      blocks: list(end.tracks).map(() => [false, false, false]),
    }]));
    const heard = new Map(); // "<end>\0<track>" -> what this board offers the neighbour
    const shown = new Map(); // an end input's key -> what the engine was last told
    const lastSignature = new Map();
    const heardBy = (name, k) => heard.get(`${name}${SEP}${k}`) || { occupied: true, tag: "stop" };

    function neighbourSignals(name, k) {
      const nb = neighbourState.get(name);
      const occ = nb.blocks[k - 1];
      const tags = [null, null, null];
      if (nb.dir[k - 1] === "away") {
        let ahead = "clear";
        for (let i = 2; i >= 0; i -= 1) {
          tags[i] = occ[i] ? "stop" : NEXT[ahead];
          ahead = tags[i];
        }
      } else {
        const us = heardBy(name, k);
        let ahead = us.occupied ? "stop" : us.tag;
        for (let i = 0; i < 3; i += 1) {
          tags[i] = occ[i] ? "stop" : NEXT[ahead];
          ahead = tags[i];
        }
      }
      return tags;
    }
    const neighbourOffer = (name, k) => ({ block: neighbourState.get(name).blocks[k - 1][0] ? "occupied" : "clear", mast: neighbourSignals(name, k)[0] });

    // Tell the engine everything an end hears: its link, and for a heard link each track's block and signal.
    function deliver(end) {
      const nb = neighbourState.get(end.name);
      const link = nb.on ? "heard" : values.get(linkKeyOf(end.name));
      const events = [];
      if (link === "none") events.push({ end: end.name, link: "" });
      else if (link === "end") events.push({ end: end.name, link: "end" });
      else {
        events.push({ end: end.name, link: `neighbour/${end.name}` });
        if (link === "heard") events.push({ end: end.name, theirLink: `${me}/${end.name}` }, { end: end.name, online: true });
        else events.push({ end: end.name, online: false });
      }
      shown.set(linkKeyOf(end.name), link);
      const count = list(end.tracks).length;
      for (let k = 1; k <= count; k += 1) {
        const blockKey = C().endKey(end.name, k, "block");
        const mastKey = C().endKey(end.name, k, "mast");
        const offer = nb.on ? neighbourOffer(end.name, k) : { block: values.get(blockKey), mast: values.get(mastKey) };
        shown.set(blockKey, offer.block);
        shown.set(mastKey, offer.mast);
        if (link === "heard") events.push({ end: end.name, track: count + 1 - k, block: offer.block }, { end: end.name, track: count + 1 - k, mast: offer.mast });
      }
      for (const e of events) engine.event(e);
    }

    function pushNeighbours() {
      for (const end of endDefs) {
        if (!neighbourState.get(end.name).on) continue;
        const signature = JSON.stringify(list(end.tracks).map((_, i) => neighbourOffer(end.name, i + 1)));
        if (lastSignature.get(end.name) === signature) continue;
        lastSignature.set(end.name, signature);
        deliver(end);
      }
    }

    function noteHeard(result) {
      for (const p of list(result?.publishes)) {
        if (p.end === undefined || p.track === undefined) continue;
        const key = `${p.end}${SEP}${p.track}`;
        const entry = heard.get(key) || { occupied: true, tag: "stop" };
        if (p.block !== undefined) entry.occupied = p.block === "ACTIVE";
        if (p.mast !== undefined) entry.tag = p.mast;
        heard.set(key, entry);
      }
    }

    let lastScan = null;
    const scanOnce = () => {
      pushNeighbours();
      lastScan = engine.scan();
      noteLog(lastScan);
      noteHeard(lastScan);
      pushNeighbours();
      return lastScan;
    };
    function noteLog(result) {
      for (const e of list(result?.events)) {
        const rule = e.rule ? ruleWords(e.rule) : "";
        let text = "";
        if (e.startup) text = TEXT.log.startup;
        else if (e.grant !== undefined) text = TEXT.log.grant(rule, e.grant);
        else if (e.cancel !== undefined) text = TEXT.log.cancel(rule, e.cancel);
        else if (e.pass !== undefined) text = TEXT.log.pass(e.pass, rule);
        else if (e.release !== undefined && e.by) text = TEXT.log.release(e.release, e.by);
        else if (e.ignored !== undefined) text = TEXT.log.ignored(e.resource);
        else if (e.resync !== undefined) text = TEXT.log.resync(e.resync);
        if (text) log.push({ time: engine.time(), text });
      }
      if (log.length > 40) log.splice(0, log.length - 40);
    }
    // The first scan is the start-up scan.
    function bootFresh() {
      engine = E().createEngine(board, start);
      values = new Map(allInputs().map((input) => [input.key, input.start]));
      shown.clear();
      lastSignature.clear();
      heard.clear();
      for (const nb of neighbourState.values()) nb.blocks = nb.blocks.map(() => [false, false, false]);
      for (const end of endDefs) deliver(end);
      log = [];
      online.clear();
      for (const [name, other] of Object.entries(start.remote || {})) online.set(name, other.online !== false);
      scanOnce();
      version += 1;
    }

    function ruleWords(ref) {
      const at = String(ref).lastIndexOf("/");
      return TEXT.ruleWords(ref.slice(0, at), ref.slice(at + 1));
    }

    // ----- inputs -----

    const drivenBy = (input) => (input.endName !== undefined && neighbourState.get(input.endName).on ? input.endName : null);
    function inputs() {
      return allInputs().filter((input) => !hidden.has(input.key)).map((input) => {
        const driven = drivenBy(input);
        return { ...infoOf(input), value: driven ? shown.get(input.key) : values.get(input.key), ...(driven ? { driven: true } : {}) };
      });
    }

    function makeInput(kind, name, b) {
      let input;
      if (b !== undefined) {
        const key = [b, kind, name].join(SEP);
        if (kind === "turnout") input = { key, values: ["closed", "thrown"], start: "closed", event: (is) => ({ board: b, turnout: name, is }) };
        else if (kind === "mast") {
          const aspects = Object.keys(board.remote?.[b]?.masts?.[name]?.aspects || {});
          input = { key, values: ["unknown", ...aspects], start: "unknown", event: (aspect) => ({ board: b, mast: name, aspect: aspect === "unknown" ? "" : aspect }) };
        } else input = { key, values: ["clear", "occupied"], start: "clear", event: (is) => ({ board: b, [kind]: name, is }) };
      } else if (kind === "turnout") input = { key: `turnout${SEP}${name}`, values: ["closed", "thrown"], start: "closed", event: (is) => ({ turnout: name, is }) };
      else if (kind === "button") input = { key: `button${SEP}${name}`, values: ["released", "pressed"], start: "released", event: (is) => ({ button: name, is }) };
      else if (kind === "mast") {
        const mast = board.masts?.[name] || {};
        const aspects = Object.keys(mast.aspects || {});
        input = {
          key: `jmri${SEP}${name}`, values: ["none", ...aspects], start: "none",
          event: (aspect) => ({ jmri: name, message: aspect === "none" ? "" : (mast.states?.[aspect]?.[0] ?? `${aspect}; Lit; Unheld`) }),
        };
      } else input = { key: `sensor${SEP}${name}`, values: ["clear", "occupied"], start: "clear", event: (is) => ({ sensor: name, is }) };
      return input;
    }

    // The key of an input; made (and added to the panel) when no rule reads it.
    function find(kind, name, b) {
      const k = kind === "mast" && b === undefined ? "jmri" : kind;
      const key = b !== undefined ? [b, kind, name].join(SEP) : `${k}${SEP}${name}`;
      if (!byKey(key)) {
        const input = makeInput(kind, name, b);
        extras.push(input);
        values.set(key, input.start);
      }
      return key;
    }

    function setValue(input, value) {
      values.set(input.key, value);
    }

    function setInput(key, value, { scan = true } = {}) {
      const input = byKey(key);
      if (!input) throw new Error(`There is no input ${key.replace(SEP, " ")}.`);
      const info = infoOf(input);
      if (!info.values.includes(value)) throw new Error(`${info.label} cannot be ${value}.`);
      if (input.endName !== undefined) {
        if (drivenBy(input)) throw new Error(TEXT.drivenByNeighbour(input.endName));
        values.set(key, value);
        deliver(endDef(input.endName));
        version += 1;
        if (scan) scanOnce();
        return;
      }
      if (info.jmri && value === "none") return;
      engine.event(input.event(value));
      setValue(input, value);
      version += 1;
      if (scan) scanOnce();
    }

    function setBoardOnline(name, isOnline, { scan = true } = {}) {
      engine.event({ board: name, online: isOnline });
      online.set(name, isOnline === true);
      version += 1;
      if (scan) scanOnce();
    }

    // Any engine event, keeping the inputs' values in step.
    function event(e, { scan = false } = {}) {
      engine.event(e);
      noteEvent(e);
      version += 1;
      if (scan) scanOnce();
    }

    function noteEvent(e) {
      let key;
      let value;
      if (e.end !== undefined) {
        const count = list(endDef(e.end)?.tracks).length;
        if (e.track === undefined || !count) return;
        const what = e.block !== undefined ? "block" : e.mast !== undefined ? "mast" : null;
        const endKey = what ? C().endKey(e.end, count + 1 - e.track, what) : null;
        if (endKey && byKey(endKey)) values.set(endKey, what === "block" ? e.block : e.mast === "" ? "unknown" : e.mast);
        return;
      }
      if (e.board !== undefined) {
        if (e.online !== undefined) online.set(e.board, e.online === true);
        else if (e.mast !== undefined) { key = [e.board, "mast", e.mast].join(SEP); value = e.aspect === "" ? "unknown" : e.aspect; }
        else if (e.turnout !== undefined) { key = [e.board, "turnout", e.turnout].join(SEP); value = e.is; }
        else if (e.block !== undefined) { key = [e.board, "block", e.block].join(SEP); value = e.is; }
        else if (e.sensor !== undefined) {
          const kind = list(board.remote?.[e.board]?.blocks).includes(e.sensor) ? "block" : "sensor";
          key = [e.board, kind, e.sensor].join(SEP);
          value = e.is;
        }
      } else if (e.sensor !== undefined) { key = `sensor${SEP}${e.sensor}`; value = e.is; }
      else if (e.turnout !== undefined) { key = `turnout${SEP}${e.turnout}`; value = e.is; }
      else if (e.button !== undefined) { key = `button${SEP}${e.button}`; value = e.is; }
      else if (e.jmri !== undefined) {
        key = `jmri${SEP}${e.jmri}`;
        const picked = board.masts?.[e.jmri] ? E().pickAspect(board.masts[e.jmri], e.message) : undefined;
        if (picked !== undefined) value = picked;
      }
      if (key === undefined || value === undefined) return;
      if (!byKey(key)) {
        const [a, b, c] = key.split(SEP);
        extras.push(c === undefined ? makeInput(a === "jmri" ? "mast" : a, b) : makeInput(b, c, a));
      }
      values.set(key, value);
    }

    // ----- time -----

    const step = () => {
      version += 1;
      return scanOnce();
    };

    function advance(ms) {
      const scans = Math.max(1, Math.ceil(ms / E().SCAN_MS));
      for (let i = 0; i < scans; i += 1) step();
    }

    // The checker's Show me sequence: [{ do: event } | { wait: scans }], after
    // the start-up scan, one scan after each event.
    function play(sequence) {
      reset();
      for (const item of list(sequence)) {
        if (item?.do) event(item.do, { scan: true });
        else if (item?.wait) for (let i = 0; i < item.wait; i += 1) step();
      }
    }

    function reset() {
      bootFresh();
    }

    // ----- blocks and turnouts for the strip -----

    const logicBlocks = new Map(list(board.logic?.blocks).map((b) => [b.name, list(b.sensors)]));

    // A block's detectors: members of a block on this board, a sensor as itself.
    function members(ref) {
      if (isObject(ref)) {
        const name = ref.block ?? ref.sensor;
        const kind = ref.block !== undefined ? "block" : "sensor";
        return [{ board: ref.board, kind, name }];
      }
      if (logicBlocks.has(ref)) {
        return logicBlocks.get(ref).map((member) => (typeof member === "string"
          ? { kind: "sensor", name: member }
          : member.end !== undefined
            ? { kind: "end", end: member.end, track: member.track }
          : member.board !== undefined
            ? { board: member.board, kind: member.block !== undefined ? "block" : "sensor", name: member.block ?? member.sensor }
            : { kind: "sensor", name: member.sensor ?? member.block }));
      }
      return [{ kind: "sensor", name: ref }];
    }

    const keyOfMember = (m) => (m.kind === "end" ? C().endKey(m.end, m.track, "block") : find(m.kind, m.name, m.board));
    // What an end track's block reads to the rules: the safe way unless paired and heard.
    function endOccupied(name, k) {
      if (!endDef(name) || !byKey(C().endKey(name, k, "block"))) return true;
      const link = neighbourState.get(name).on ? "heard" : values.get(linkKeyOf(name));
      if (link === "end") return false;
      if (link !== "heard") return true;
      const value = neighbourState.get(name).on ? shown.get(C().endKey(name, k, "block")) : values.get(C().endKey(name, k, "block"));
      return value !== "clear";
    }
    const isOn = (m) => {
      if (m.kind === "end") return endOccupied(m.end, m.track);
      const value = values.get(keyOfMember(m));
      return value === "occupied" || value === "unknown";
    };

    const isPretend = (ref) => isObject(ref) && ref.pretend !== undefined;

    // A train in a block: its first detector on this board (usually its own current sensor), or a pretend neighbour's block.
    function setBlock(ref, occupied, { scan = false } = {}) {
      if (isPretend(ref)) {
        const nb = neighbourState.get(ref.pretend);
        if (nb?.blocks[ref.track - 1]?.[ref.at - 1] === undefined) return;
        nb.blocks[ref.track - 1][ref.at - 1] = occupied === true;
        version += 1;
        if (scan) scanOnce();
        return;
      }
      const primary = members(ref).find((m) => m.kind !== "end");
      if (!primary) return;
      setInput(keyOfMember(primary), occupied ? "occupied" : "clear", { scan });
    }

    const blockOccupied = (ref) => (isPretend(ref)
      ? neighbourState.get(ref.pretend)?.blocks[ref.track - 1]?.[ref.at - 1] === true
      : members(ref).some(isOn));

    // ----- the pretend neighbours, for the page -----

    function neighbours() {
      return endDefs.map((end) => {
        const nb = neighbourState.get(end.name);
        return {
          end: end.name,
          on: nb.on,
          tracks: list(end.tracks).map((_, i) => {
            const k = i + 1;
            const tags = neighbourSignals(end.name, k);
            return {
              track: k,
              direction: nb.dir[i],
              blocks: nb.blocks[i].map((occupied, j) => ({ at: j + 1, ref: { pretend: end.name, track: k, at: j + 1 }, occupied })),
              signals: tags.map((tag, j) => ({ at: j + 1, tag, meaning: TEXT.meanings[tag] || tag })),
              offers: neighbourOffer(end.name, k),
              hears: heardBy(end.name, k),
            };
          }),
        };
      });
    }

    function setNeighbour(name, on, { scan = true } = {}) {
      const nb = neighbourState.get(name);
      if (!nb) throw new Error(`There is no end ${name}.`);
      if (nb.on === (on === true)) return;
      nb.on = on === true;
      lastSignature.delete(name);
      deliver(endDef(name));
      version += 1;
      if (scan) scanOnce();
    }

    function turnNeighbour(name, track, { scan = true } = {}) {
      const nb = neighbourState.get(name);
      if (!nb?.dir[track - 1]) return;
      nb.dir[track - 1] = nb.dir[track - 1] === "into" ? "away" : "into";
      version += 1;
      if (scan) scanOnce();
    }

    // Its blocks in the order a train runs through them.
    function neighbourPath(name, track) {
      const nb = neighbourState.get(name);
      const refs = [1, 2, 3].map((at) => ({ pretend: name, track, at }));
      return nb?.dir[track - 1] === "into" ? refs.reverse() : refs;
    }

    function setTurnout(ref, position, { scan = true } = {}) {
      const name = isObject(ref) ? ref.turnout : ref;
      setInput(find("turnout", name, isObject(ref) ? ref.board : undefined), position, { scan });
    }

    const turnoutPosition = (ref) => {
      const name = isObject(ref) ? ref.turnout : ref;
      return values.get(find("turnout", name, isObject(ref) ? ref.board : undefined));
    };

    // ----- what it shows -----

    function view() {
      const state = engine.state();
      const masts = Object.keys(board.masts || {}).map((name) => {
        const def = board.masts[name];
        const aspect = state.masts[name];
        const tag = aspect && aspect !== "dark" ? def.aspects?.[aspect] : undefined;
        const fieldControlled = list(board.logic?.layers).some((layer) => list(layer.rules).some((rule) => rule?.then?.mast === name));
        let meaning;
        if (aspect === "dark") meaning = TEXT.dark;
        else if (!aspect) meaning = TEXT.nothingShown;
        else meaning = tag ? TEXT.meanings[tag] || tag : "";
        return { name, aspect: aspect ?? null, tag: tag ?? null, meaning, fieldControlled };
      });
      const rules = Object.entries(state.rules).map(([ref, phase]) => {
        const at = ref.lastIndexOf("/");
        return { ref, group: ref.slice(0, at), n: Number(ref.slice(at + 1)), words: ruleWords(ref), phase, text: TEXT.phases[phase] || phase };
      });
      const sections = Object.entries(state.resources).map(([name, st]) => {
        const holder = state.holders[name];
        let held = "";
        if (holder) held = ruleWords(holder);
        else if (st === "PASSED") held = TEXT.heldAtStart;
        return { name, state: st, text: TEXT.sectionStates[st] || st, holder, heldBy: held };
      });
      const turnouts = list(board.turnouts).map((name) => {
        const byRules = state.locks[name] === true;
        const locked = state.locked[name] === true;
        const text = byRules ? TEXT.turnoutLockedByRules : locked ? TEXT.turnoutLockedByJmri : TEXT.turnoutFree;
        return { name, position: values.get(`turnout${SEP}${name}`) || "closed", locked, byRules, text };
      });
      return {
        time: engine.time(),
        masts, rules, sections, turnouts,
        ends: endDefs.map((end) => ({ name: end.name, state: state.ends?.[end.name], text: TEXT.endStates[state.ends?.[end.name]] || "" })),
        neighbours: neighbours(),
        waiting: engine.checkerView().order.map(ruleWords),
        // TP 8: the Auto/Manual switch, lamps and panel locks, for the drawing.
        auto: state.auto,
        lamps: { ...(state.lamps || {}) },
        panel: { ...(state.panel || {}) },
        log: log.map((entry) => ({ ...entry })),
        version,
      };
    }

    bootFresh();
    const session = {
      board, inputs, find, setInput, setBoardOnline, boards: () => [...online].map(([name, up]) => ({ name, online: up })), event, step, advance, play, reset, view,
      setBlock, blockOccupied, setTurnout, turnoutPosition, members,
      neighbours, setNeighbour, turnNeighbour, neighbourPath,
      get shapes() { return shapesOf(source); },
      get time() { return engine.time(); },
      state: () => engine.state(),
      longestFor: () => longestFor(board),
    };
    return session;
  }

  // ===== Track shapes =======================================================
  // The strip diagram for a group a starter wrote (`starter` on the group):
  //   { group, kind, rows: [{ items }], masts: [name], blocks: [name] }
  // An item is { type: "block", name, ref, turnouts: [{ name, ref, through }] }
  // or { type: "mast", name, dir: 1 | -1, external?: true }. A block is a
  // string or { board, sensor | block }. Groups with no known shape give none.

  const refName = (ref) => (isObject(ref) && ref.pretend !== undefined ? TEXT.pretendBlock(ref.pretend, ref.track, ref.at) : isObject(ref) ? TEXT.fromBoard(ref.block ?? ref.sensor ?? ref.turnout ?? ref.mast ?? "", ref.board) : String(ref ?? ""));
  const refOf = (cond) => {
    if (!isObject(cond)) return cond;
    const kind = ["block", "sensor", "turnout", "mast"].find((k) => cond[k] !== undefined);
    return cond.board !== undefined ? { board: cond.board, [kind]: cond[kind] } : cond[kind];
  };
  const blockItem = (ref, turnouts = []) => ({ type: "block", name: refName(isObject(ref) ? ref : ref), ref, turnouts });
  const mastItem = (name, dir, extra = {}) => ({ type: "mast", name, dir, ...extra });

  // Conditions in a list of checks, without looking inside not / any / all.
  const topChecks = (rule) => list(rule?.checks).filter(isObject);

  function blockSignalsShape(layer) {
    const rules = list(layer.rules).filter(isObject);
    const order = [];
    for (const rule of rules) {
      const mast = rule.then?.mast;
      if (!mast) continue;
      if (order.some((entry) => entry.mast === mast)) continue;
      const while_ = rule.trigger?.while;
      if (!isObject(while_) || (while_.block === undefined && while_.sensor === undefined)) return null;
      const turnouts = topChecks(rule).filter((c) => c.turnout !== undefined).map((c) => ({ name: refName(refOf(c)), ref: refOf(c), through: c.is }));
      order.push({ mast, block: refOf(while_), turnouts, rules: rules.filter((r) => r.then?.mast === mast) });
    }
    if (!order.length) return null;
    const items = [];
    for (const entry of order) {
      items.push(mastItem(entry.mast, 1));
      items.push(blockItem(entry.block, entry.turnouts));
    }
    // Beyond the last block: the next signal its rules read, if there is one.
    const last = order[order.length - 1];
    const next = last.rules.flatMap((r) => topChecks(r)).find((c) => c.mast !== undefined);
    if (next) items.push(mastItem(refName(refOf(next)), 1, { external: true, ref: refOf(next) }));
    return items;
  }


  /** The shapes of the groups in a config or engine board that a starter wrote. */
  function shapesOf(source) {
    const logic = isObject(source?.logic) ? source.logic : {};
    const shapes = [];
    for (const layer of list(logic.layers).filter(isObject)) {
      let rows = null;
      if (layer.starter === "block-signals") {
        const items = blockSignalsShape(layer);
        if (items) rows = [{ items }];
      }
      if (!rows) continue;
      const everything = rows.flatMap((row) => row.items);
      shapes.push({
        group: String(layer.name ?? ""),
        kind: layer.starter,
        rows,
        masts: [...new Set(everything.filter((i) => i.type === "mast").map((i) => i.name))],
        blocks: [...new Set(everything.filter((i) => i.type === "block").map((i) => i.name))],
      });
    }
    return shapes;
  }

  /**
   * Where the strip's items sit: { width, height, items: [{ ...item, x, w }] }.
   * A block is a box, a signal a post between boxes.
   */
  function stripLayout(row, { blockWidth = 104, gap = 56, margin = 10 } = {}) {
    let x = margin;
    const items = [];
    for (const item of list(row?.items)) {
      const w = item.type === "block" ? blockWidth : gap;
      items.push({ ...item, x, w });
      x += w;
    }
    return { width: x + margin, height: 150, items };
  }

  // The blocks of a row, in the order a train runs along it: `direction` is
  // "forward" (as drawn, left to right) or "back". From `start` (a block name).
  function trainPath(row, start, direction = "forward") {
    const blocks = list(row?.items).filter((item) => item.type === "block");
    const ordered = direction === "back" ? [...blocks].reverse() : blocks;
    const at = start === undefined ? 0 : ordered.findIndex((b) => b.name === start);
    return at < 0 ? [] : ordered.slice(at).map((b) => b.ref);
  }

  // ===== Run a train ========================================================

  /**
   * A pause long enough for the rules' times and for the signals to settle
   * back along the line: the longest wait plus a scan for each signal and two
   * more.
   */
  function defaultPause(session) {
    const masts = Object.keys(session.board.masts || {}).length;
    const pretend = session.neighbours().reduce((n, end) => n + (end.on ? end.tracks.length * 4 : 0), 0);
    return session.longestFor() + (masts + 2 + pretend) * E().SCAN_MS;
  }

  /**
   * Step a train along `path` (block refs, in the direction of travel), `length`
   * blocks long. It occupies its next block, then clears its tail, with a
   * pause after each. Returns the steps, from the way things were before it:
   *   { label, time, blocks: [{ name, occupied }], masts: [{ name, aspect, meaning, tag }] }
   * The train is gone at the end. Options: length (1), pause (ms; default
   * defaultPause), masts (names to record; default every signal), neighbours
   * (which pretend neighbours' signals to record, [{ end, track }]; each step
   * then has `neighbours: [{ end, track, signals: [{ at, tag, meaning }] }]`).
   */
  function runTrain(session, { path, length = 1, pause, masts, neighbours } = {}) {
    const route = list(path);
    const wait = Number.isFinite(pause) ? pause : defaultPause(session);
    const size = Math.max(1, Math.floor(length) || 1);
    const names = route.map(refName);
    const steps = [];
    const record = (label) => {
      const shown = session.view();
      steps.push({
        label,
        time: shown.time,
        blocks: route.map((ref, i) => ({ name: names[i], occupied: session.blockOccupied(ref) })),
        masts: shown.masts.filter((m) => !masts || masts.includes(m.name)).map(({ name, aspect, meaning, tag }) => ({ name, aspect, meaning, tag })),
        ...(neighbours ? { neighbours: shown.neighbours.flatMap((n) => n.tracks.filter((t) => neighbours.some((x) => x.end === n.end && x.track === t.track)).map((t) => ({ end: n.end, track: t.track, signals: t.signals }))) } : {}),
      });
    };
    const settle = (label) => {
      session.advance(wait);
      record(label);
    };
    settle(TEXT.trainBefore);
    route.forEach((ref, i) => {
      session.setBlock(ref, true);
      settle(TEXT.trainEnters(names[i]));
      if (i - size >= 0) {
        session.setBlock(route[i - size], false);
        settle(TEXT.trainLeaves(names[i - size]));
      }
    });
    for (let i = Math.max(0, route.length - size); i < route.length; i += 1) {
      session.setBlock(route[i], false);
      settle(TEXT.trainLeaves(names[i]));
    }
    return steps;
  }

  /**
   * `ownPath` (block refs, in the direction of travel) carried across the
   * joint of an end's track into the pretend neighbour, or the neighbour's
   * blocks first when its trains run into this board.
   */
  function crossPath(session, ownPath, { end, track }) {
    const there = session.neighbours().find((n) => n.end === end)?.tracks.find((t) => t.track === track);
    if (!there) return list(ownPath);
    const refs = session.neighbourPath(end, track);
    return there.direction === "into" ? [...refs, ...list(ownPath)] : [...list(ownPath), ...refs];
  }

  global.EsphomeMrLogicTry = {
    crossPath, TEXT, createSession, shapesOf, stripLayout, trainPath, runTrain, defaultPause, readsAs, valueLabel, refName,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
