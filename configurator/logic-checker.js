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
    deadlock: (rule, section) => `${rule} can be left waiting for section "${section}" forever, with its train still there. Use Show me to see how, then check what has to happen for the section to be free.`,
    starved: (rule, section) => `${rule} can be passed over forever: other trains keep getting section "${section}" while it waits. Use Show me to see how.`,
    neverActive: (rule) => `${rule} can never apply: no mix of trains, turnouts and signals makes its When and Only if true together. Look for a block that must be both occupied and clear.`,
    stuck: (mast) => `Signal "${mast}" can never show anything but Stop: no rule that sets it can apply. Check the rules that set it.`,
    tooMany: (runs) => `This board has too many combinations to check every one, so the checker tried ${runs} random runs. It may not have found every problem.`,
    neverSeen: (rule, runs) => `${rule} did not apply in ${runs} random runs. It may never apply: look for a block that must be both occupied and clear.`,
    stuckSeen: (mast, runs) => `Signal "${mast}" showed only Stop in ${runs} random runs. Check the rules that set it.`,
  });

  // "Gauntlet/2" -> rule 2 in group "Gauntlet".
  function ruleWords(ref) {
    const at = String(ref).lastIndexOf("/");
    return `Rule ${ref.slice(at + 1)} in group "${ref.slice(0, at)}"`;
  }

  // ===== The model: which inputs the rules read, and their values ==========

  const KINDS = ["block", "sensor", "turnout", "mast", "button"];

  function conditionsIn(value, out = []) {
    if (Array.isArray(value)) {
      value.forEach((item) => conditionsIn(item, out));
    } else if (isObject(value)) {
      if (KINDS.some((kind) => value[kind] !== undefined)) out.push(value);
      Object.values(value).forEach((inner) => conditionsIn(inner, out));
    }
    return out;
  }

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
      }
    };
    const resources = list(logic.resources);
    for (const cond of conditionsIn([list(logic.layers).map((l) => list(l.rules)), resources.map((r) => r.release)])) {
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
      }
    }
    for (const mast of Object.values(board.masts || {})) if (typeof mast.approachLight === "string") block(mast.approachLight);
    // An event setting a value it already has is not a step, so "none" and
    // "unknown" are only ever start values.
    return [...inputs.values()];
  }

  // The inputs a rule's request depends on: its When and its Cancel.
  function requestInputs(rule, board, inputs) {
    const keys = new Set();
    const logic = board.logic || {};
    const blocks = new Map(list(logic.blocks).map((b) => [b.name, list(b.sensors)]));
    const add = (cond) => {
      if (cond.board !== undefined) {
        const kind = ["sensor", "block", "turnout", "mast"].find((k) => cond[k] !== undefined);
        keys.add(`${cond.board}\u0000${kind}\u0000${cond[kind]}`);
      } else if (cond.block !== undefined && blocks.has(cond.block)) {
        for (const m of blocks.get(cond.block)) add(typeof m === "string" ? { sensor: m } : m);
      } else if (cond.block !== undefined || cond.sensor !== undefined) keys.add(`sensor\u0000${cond.block ?? cond.sensor}`);
      else if (cond.turnout !== undefined) keys.add(`turnout\u0000${cond.turnout}`);
      else if (cond.button !== undefined) keys.add(`button\u0000${cond.button}`);
      else if (cond.mast !== undefined) keys.add(`jmri\u0000${cond.mast}`);
    };
    conditionsIn([rule.trigger, rule.cancel]).forEach(add);
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
    return { logic: "on", broker: "connected", remote };
  }

  function longestTimerScans(board) {
    const ms = (value) => E().ms(value) || 0;
    let longest = 0;
    for (const layer of list(board.logic?.layers)) for (const rule of list(layer.rules)) longest = Math.max(longest, ms(rule?.trigger?.for));
    for (const res of list(board.logic?.resources)) longest = Math.max(longest, ms(res.release?.for), ms(res.approachLock));
    return Math.ceil(longest / E().SCAN_MS) + 2;
  }

  // ===== Exploring ==========================================================

  function keyOf(engine, values) {
    const { logic, ...state } = engine.state();
    return JSON.stringify([state, engine.checkerView(), values]);
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

  /**
   * Check a board in the engine cases' format (EsphomeMrLogicYaml.logicTable).
   * Options: maxStates (default 3000), maxMs (default none), runs and steps
   * for the random fallback (default 200 x 40), seed (default 1).
   * Returns { complete, states, problems: [{ level, kind, text, rule?, mast?,
   * sequence? }] }.
   */
  function checkBoard(board, options = {}) {
    const { maxStates = 3000, maxMs = Infinity, runs = 200, steps = 40, seed = 1 } = options;
    const engineOf = () => E().createEngine(board, start);
    const inputs = inputsOf(board);
    const start = startOf(board, inputs);
    const waitLimit = longestTimerScans(board);
    const started = Date.now();

    const replay = (path) => {
      const engine = engineOf();
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

    const nodes = [];
    const byKey = new Map();
    const record = (engine, values, path) => {
      const key = keyOf(engine, values);
      if (byKey.has(key)) return byKey.get(key);
      const { logic, ...state } = engine.state();
      const node = { id: nodes.length, key, path, values, state, view: engine.checkerView(), edges: [] };
      nodes.push(node);
      byKey.set(key, node);
      return node;
    };

    const startValues = inputs.map((input) => input.start);
    record(replay([]), startValues, []);
    let complete = true;
    for (let at = 0; at < nodes.length; at += 1) {
      if (nodes.length > maxStates || Date.now() - started > maxMs) {
        complete = false;
        break;
      }
      const node = nodes[at];
      for (const move of moves(node.values)) {
        let engine;
        let path;
        if (move.step) {
          path = [...node.path, move.step];
          engine = replay(path);
        } else {
          // Wait until something changes, or every timer has had its time.
          engine = replay(node.path);
          let waited = 0;
          while (waited < waitLimit && keyOf(engine, node.values) === node.key) {
            engine.scan();
            waited += 1;
          }
          if (keyOf(engine, node.values) === node.key) continue;
          path = [...node.path, { wait: waited }];
        }
        const to = record(engine, move.values, path);
        node.edges.push({ to: to.id, input: move.input });
      }
    }

    // What was seen, from every state reached (and the random runs).
    const activeSeen = new Set();
    const leftStop = new Set();
    const tagOf = (mast, aspect) => board.masts?.[mast]?.aspects?.[aspect];
    const see = (state, view) => {
      view.active.forEach((ref) => activeSeen.add(ref));
      for (const [mast, aspect] of Object.entries(state.masts)) {
        if (aspect && aspect !== "dark" && tagOf(mast, aspect) && tagOf(mast, aspect) !== "stop") leftStop.add(mast);
      }
    };
    nodes.forEach((node) => see(node.state, node.view));

    let tried = 0;
    if (!complete) {
      const next = random(seed);
      for (let run = 0; run < runs && Date.now() - started <= Math.max(maxMs, 0) * 2 + 1; run += 1) {
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

    const logic = board.logic || {};
    const rules = list(logic.layers).flatMap((layer) => list(layer.rules).map((rule, i) => ({ ref: `${layer.name}/${i + 1}`, rule })));
    const problems = [];

    // Deadlock and starvation need every state, so only on a complete check.
    const deadlocked = new Set();
    if (complete) {
      const reverse = nodes.map(() => []);
      nodes.forEach((node) => node.edges.forEach((edge) => reverse[edge.to].push({ from: node.id, input: edge.input })));
      for (const { ref, rule } of rules) {
        const section = rule?.then?.reserve;
        if (section === undefined) continue;
        const frozen = requestInputs(rule, board, inputs);
        const waiting = (node) => node.state.rules[ref] === "waiting";
        // States from which the rule can still be granted, its train waiting.
        const canGrant = new Set(nodes.filter((node) => node.view.active.includes(ref)).map((node) => node.id));
        const queue = [...canGrant];
        while (queue.length) {
          const id = queue.pop();
          for (const { from, input } of reverse[id]) {
            if (frozen.has(input) || canGrant.has(from)) continue;
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
        const stuck = nodes.find((node) => settled(node) && !canGrant.has(node.id));
        if (stuck) {
          deadlocked.add(ref);
          problems.push({ level: "error", kind: "deadlock", rule: ref, text: TEXT.deadlock(ruleWords(ref), section), sequence: stuck.path });
          continue;
        }
        // Starvation: a loop of states, the rule waiting throughout and its
        // train still there, in which another rule is granted the section.
        const inLoop = starvedLoop(nodes, ref, frozen, section);
        if (inLoop) problems.push({ level: "warning", kind: "starvation", rule: ref, text: TEXT.starved(ruleWords(ref), section), sequence: inLoop.path });
      }
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
      const text = complete ? TEXT.neverActive(ruleWords(ref)) : TEXT.neverSeen(ruleWords(ref), tried);
      problems.push({ level: "warning", kind: "never-active", rule: ref, text });
    }
    const fieldMasts = [...new Set(rules.map(({ rule }) => rule?.then?.mast).filter(Boolean))];
    for (const mast of fieldMasts) {
      if (leftStop.has(mast)) continue;
      problems.push({ level: "warning", kind: "stuck", mast, text: complete ? TEXT.stuck(mast) : TEXT.stuckSeen(mast, tried) });
    }
    if (!complete) problems.push({ level: "warning", kind: "partial", text: TEXT.tooMany(tried) });
    return { complete, states: nodes.length, runs: tried, problems };
  }

  // A loop of states where `ref` waits throughout (and its request's inputs
  // do not change) and some other rule takes the section: the node to show.
  function starvedLoop(nodes, ref, frozen, section) {
    const inSet = (node) => node.state.rules[ref] === "waiting";
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
        if (!member.has(to) || frozen.has(input)) continue;
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
          if (!inComp.has(to) || frozen.has(input)) continue;
          const before = nodes[v].state.holders[section];
          const after = nodes[to].state.holders[section];
          if (after && after !== ref && after !== before) return nodes[v];
        }
      }
    }
    return null;
  }

  // ===== For validation =====================================================

  // The last check, by the rule table it ran on: the page asks on every draw.
  let last = { json: null, result: null };

  /**
   * Check a configurator board (Field Logic). Memoised on the rule table, and
   * bounded so the page stays quick: what it cannot finish, it says.
   */
  function checkConfig(config, options = { maxStates: 2000, maxMs: 250, runs: 100, steps: 40 }) {
    const Y = global.EsphomeMrLogicYaml;
    const table = Y?.logicTable(config);
    if (!table || !list(table.logic?.layers).length) return null;
    const json = JSON.stringify(table);
    if (last.json === json) return last.result;
    const result = checkBoard(table, options);
    last = { json, result };
    return result;
  }

  global.EsphomeMrLogicChecker = { TEXT, checkBoard, checkConfig, inputsOf, ruleWords };
})(typeof globalThis !== "undefined" ? globalThis : window);
