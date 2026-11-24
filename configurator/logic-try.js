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
  const readsAs = (info) => (info.remote ? TEXT.readsAs[info.kind] : "");

  function valueLabel(info, value) {
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
   */
  function createSession(source, options = {}) {
    const board = boardOf(source);
    if (!board || !list(board.logic?.layers).length) return null;
    const baseInputs = C().inputsOf(board).map((input) => ({ ...input }));
    const start = options.start || startOf(board, baseInputs);
    const extras = [];
    const infos = new Map();
    let engine;
    let values;
    let log;
    let version = 0;
    const online = new Map();

    const allInputs = () => [...baseInputs, ...extras];
    const byKey = (key) => allInputs().find((input) => input.key === key);
    const infoOf = (input) => {
      if (!infos.has(input.key)) infos.set(input.key, describeInput(input, board));
      return infos.get(input.key);
    };

    let lastScan = null;
    const scanOnce = () => {
      lastScan = engine.scan();
      noteLog(lastScan);
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

    function inputs() {
      return allInputs().map((input) => ({ ...infoOf(input), value: values.get(input.key) }));
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
          : member.board !== undefined
            ? { board: member.board, kind: member.block !== undefined ? "block" : "sensor", name: member.block ?? member.sensor }
            : { kind: "sensor", name: member.sensor ?? member.block }));
      }
      return [{ kind: "sensor", name: ref }];
    }

    const keyOfMember = (m) => find(m.kind, m.name, m.board);
    const isOn = (m) => {
      const value = values.get(keyOfMember(m));
      return value === "occupied" || value === "unknown";
    };

    // A train in a block: its first detector (usually its own current sensor).
    function setBlock(ref, occupied, { scan = false } = {}) {
      const [primary] = members(ref);
      if (!primary) return;
      setInput(keyOfMember(primary), occupied ? "occupied" : "clear", { scan });
    }

    const blockOccupied = (ref) => members(ref).some(isOn);

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
        waiting: engine.checkerView().order.map(ruleWords),
        log: log.map((entry) => ({ ...entry })),
        version,
      };
    }

    bootFresh();
    const session = {
      board, inputs, find, setInput, setBoardOnline, boards: () => [...online].map(([name, up]) => ({ name, online: up })), event, step, advance, play, reset, view,
      setBlock, blockOccupied, setTurnout, turnoutPosition, members,
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

  const refName = (ref) => (isObject(ref) ? TEXT.fromBoard(ref.block ?? ref.sensor ?? ref.turnout ?? ref.mast ?? "", ref.board) : String(ref ?? ""));
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

  function oneTrainSectionShape(layer, resources) {
    const rules = list(layer.rules).filter(isObject);
    const entrances = rules.map((rule) => ({ block: refOf(rule.trigger?.while), mast: rule.then?.mast, section: rule.then?.reserve })).filter((e) => e.block !== undefined && e.mast);
    if (entrances.length < 2) return null;
    const section = list(resources).find((r) => r?.name === entrances[0].section);
    const blocks = list(section?.blocks);
    if (!blocks.length) return null;
    const key = (ref) => JSON.stringify(ref);
    const inside = new Set(blocks.map(key));
    const middle = blocks.map((ref) => blockItem(ref));
    const rows = [];
    const entrance = (e) => (inside.has(key(e.block)) ? [] : [blockItem(e.block)]);
    if (entrances.length === 2) {
      const [a, b] = entrances;
      rows.push({ items: [...entrance(a), mastItem(a.mast, 1), ...middle, mastItem(b.mast, -1), ...entrance(b).reverse()] });
    } else {
      for (const e of entrances) rows.push({ items: [...entrance(e), mastItem(e.mast, 1), ...middle] });
    }
    return rows;
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
      } else if (layer.starter === "one-train-section") rows = oneTrainSectionShape(layer, logic.resources);
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
    return session.longestFor() + (masts + 2) * E().SCAN_MS;
  }

  /**
   * Step a train along `path` (block refs, in the direction of travel), `length`
   * blocks long. It occupies its next block, then clears its tail, with a
   * pause after each. Returns the steps, from the way things were before it:
   *   { label, time, blocks: [{ name, occupied }], masts: [{ name, aspect, meaning, tag }] }
   * The train is gone at the end. Options: length (1), pause (ms; default
   * defaultPause), masts (names to record; default every signal).
   */
  function runTrain(session, { path, length = 1, pause, masts } = {}) {
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

  global.EsphomeMrLogicTry = {
    TEXT, createSession, shapesOf, stripLayout, trainPath, runTrain, defaultPause, readsAs, valueLabel, refName,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
