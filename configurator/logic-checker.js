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
    tooMany: (runs, quick) => `This board has too many combinations to check every one${quick ? " quickly" : ""}, so the checker tried ${runs} random runs. It may not have found every problem.${quick ? " Use Check every combination on the Download page to check them all: it can take a few seconds." : ""}`,
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
  // The inputs a rule's request depends on: its When and its Cancel.
  function requestInputs(rule, board, inputs) {
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
    const out = { logic: "on", broker: "connected", remote };
    if (list(board.logic?.ends).length) out.board = SELF;
    return out;
  }

  function longestTimerScans(board) {
    const ms = (value) => E().ms(value) || 0;
    let longest = 0;
    for (const layer of list(board.logic?.layers)) for (const rule of list(layer.rules)) longest = Math.max(longest, ms(rule?.trigger?.for));
    for (const res of list(board.logic?.resources)) longest = Math.max(longest, ms(res.release?.for), ms(res.approachLock));
    return Math.ceil(longest / E().SCAN_MS) + 2;
  }

  // ===== Exploring ==========================================================

  // A state: what state() shows, the active rules, each section's waiting
  // order and the inputs. Not how requests for different sections interleave,
  // which nothing reads (logic.js checkerView), so a board with many plain
  // rules, such as an MSS module, has far fewer states.
  function keyOf(engine, values) {
    const { logic, ...state } = engine.state();
    const { active, asked } = engine.checkerView();
    return JSON.stringify([state, active, asked, values]);
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

  // ===== Parts: what each mast and section depends on ======================

  // A board splits into parts that are checked one at a time (work item 4.5).
  // Rules that set the same mast, or reserve the same section, belong
  // together. A group's part is it and every group whose mast it reads, and
  // so on: nothing outside it can change what its rules see, because rules
  // reach each other only through the masts they set and the sections they
  // reserve (a turnout lock is written, never read). Each part has only the
  // inputs its own rules read, so two tracks through a module, or the two
  // directions on one, are checked side by side, not multiplied together.
  // A part inside another is not checked again. Returns [{ board, refOf }]:
  // refOf maps the part's rule refs back to the board's.
  function partsOf(board) {
    const logic = board.logic || {};
    const rules = list(logic.layers).flatMap((layer) => list(layer.rules).map((rule, i) => ({ layer: layer.name, i, rule })));
    const whole = [{ board, refOf: (ref) => ref }];
    if (rules.length < 2) return whole;
    const parent = rules.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const firstOf = new Map();
    rules.forEach(({ rule }, i) => {
      for (const [what, name] of [["mast", rule?.then?.mast], ["reserve", rule?.then?.reserve]]) {
        if (name === undefined) continue;
        const key = `${what}${SEP}${name}`;
        if (firstOf.has(key)) parent[find(i)] = find(firstOf.get(key));
        else firstOf.set(key, i);
      }
    });
    const setterOf = new Map();
    rules.forEach(({ rule }, i) => { if (rule?.then?.mast !== undefined) setterOf.set(rule.then.mast, find(i)); });
    const releaseOf = new Map(list(logic.resources).map((res) => [res?.name, res?.release]));
    const reads = new Map(rules.map((_, i) => [find(i), new Set()]));
    rules.forEach(({ rule }, i) => {
      for (const cond of conditionsIn([rule?.trigger, rule?.checks, rule?.cancel, releaseOf.get(rule?.then?.reserve)])) {
        if (cond.board === undefined && cond.end === undefined && cond.mast !== undefined && setterOf.has(cond.mast)) reads.get(find(i)).add(setterOf.get(cond.mast));
      }
    });
    const cones = [...reads.keys()].map((group) => {
      const cone = new Set([group]);
      const queue = [group];
      while (queue.length) for (const next of reads.get(queue.pop())) if (!cone.has(next)) { cone.add(next); queue.push(next); }
      return cone;
    });
    if (cones.some((cone) => cone.size === reads.size)) return whole;
    const inside = (a, b) => a.size <= b.size && [...a].every((g) => b.has(g));
    const kept = cones.filter((cone, i) => !cones.some((other, j) => j !== i && inside(cone, other) && (other.size > cone.size || j < i)));
    return kept.map((cone) => {
      const refs = new Map();
      const layers = list(logic.layers).map((layer) => {
        const own = rules.filter((r) => r.layer === layer.name && cone.has(find(rules.indexOf(r))));
        own.forEach((r, j) => refs.set(`${layer.name}/${j + 1}`, `${layer.name}/${r.i + 1}`));
        return { ...layer, rules: own.map((r) => r.rule) };
      }).filter((layer) => layer.rules.length);
      const reserved = new Set(layers.flatMap((layer) => layer.rules.map((rule) => rule?.then?.reserve)).filter((name) => name !== undefined));
      const set = new Set(layers.flatMap((layer) => layer.rules.map((rule) => rule?.then?.mast)).filter((name) => name !== undefined));
      // Approach lighting only matters on a mast this part sets.
      const masts = Object.fromEntries(Object.entries(board.masts || {}).map(([name, mast]) => {
        if (set.has(name) || !isObject(mast) || mast.approachLight === undefined) return [name, mast];
        const { approachLight, ...rest } = mast;
        return [name, rest];
      }));
      const part = { ...board, masts, logic: { ...logic, layers, resources: list(logic.resources).filter((res) => reserved.has(res?.name)) } };
      return { board: part, refOf: (ref) => refs.get(ref) ?? ref };
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
      if (nodes.length > maxStates || Date.now() > deadline) {
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
      for (let run = 0; run < runs && Date.now() <= runsUntil; run += 1) {
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
          const section = rule?.then?.reserve;
          if (section === undefined) return;
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
          if (stuck) return void found.push({ kind: "deadlock", rule: ref, section, sequence: stuck.path });
          // Starvation: a loop of states, the rule waiting throughout and its
          // train still there, in which another rule is granted the section.
          const inLoop = starvedLoop(nodes, ref, frozen, section);
          if (inLoop) found.push({ kind: "starvation", rule: ref, section, sequence: inLoop.path });
        });
      }
    }
    return { complete, states: nodes.length, tried, active, leftStop, found };
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
    const started = Date.now();
    const deadline = started + maxMs;
    const runsUntil = deadline + runsMs;

    const parts = split ? partsOf(board) : [{ board, refOf: (ref) => ref }];
    let states = 0;
    let tried = 0;
    let complete = true;
    const activeSeen = new Set();
    const leftStop = new Set();
    const provenRules = new Set(); // rules in a part that finished
    const provenMasts = new Set();
    const found = new Map();
    for (const part of parts) {
      const seen = explore(part.board, { maxStates: Math.max(maxStates - states, 0), deadline, runs, steps, seed, runsUntil, allInputs });
      states += seen.states;
      tried += seen.tried;
      if (!seen.complete) complete = false;
      seen.active.forEach((ref) => activeSeen.add(part.refOf(ref)));
      seen.leftStop.forEach((mast) => leftStop.add(mast));
      if (seen.complete) {
        for (const layer of list(part.board.logic?.layers)) {
          list(layer.rules).forEach((rule, i) => {
            provenRules.add(part.refOf(`${layer.name}/${i + 1}`));
            if (rule?.then?.mast !== undefined) provenMasts.add(rule.then.mast);
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
      if (f.kind === "deadlock") {
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
    if (!complete) problems.push({ level: "warning", kind: "partial", text: TEXT.tooMany(tried, quick) });
    return { complete, states, runs: tried, parts: parts.length, problems };
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
    const result = checkBoard(table, options);
    last = { json, result };
    return mine(config, result);
  }

  // A rule the track plan made that never applies is the drawing's own
  // spare row, not something to change: no warning for it. Deadlocks and
  // waiting forever are still reported.
  function mine(config, result) {
    if (!result) return result;
    const made = new Set(list(global.EsphomeMrLogicYaml?.logicItems(config)?.layers)
      .filter((layer) => String(layer?.starter || "").startsWith("plan-")).map((layer) => String(layer.name)));
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
    const result = checkBoard(table, BUDGETS.full);
    last = { json, result };
    return mine(config, result);
  }

  /** Whether the last check of these rules gave up: the Download page offers a full one. */
  function needsFullCheck(config) {
    const table = tableOf(config);
    return !!table && last.json === JSON.stringify(table) && last.result?.complete === false;
  }

  global.EsphomeMrLogicChecker = { TEXT, SELF, BUDGETS, checkBoard, checkConfig, checkFully, needsFullCheck, partsOf, checkerInputs, inputsOf, endSetup, endKey, isEndKey, ruleWords };
})(typeof globalThis !== "undefined" ? globalThis : window);
