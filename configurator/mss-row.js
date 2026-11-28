// MSS Logic from the standard nodes (docs/mss-patterns-spec.md; work item
// MP 1). A module is a row of MSS nodes, left to right, on one board:
//
//   crossover  MSS Crossover (ISE MSS-CROSSOVER): one block, no signals. A
//              whole module on its own: in a row it would add nothing.
//   cascade    MSS Cascade (ISE MSS-CASCADE-BASIC): a block each side of an
//              IR sensor, and a signal facing each way at it.
//   siding     MSS Complex Cascade (ISE MSS-SWITCH), a siding end: a block to
//              the points, then the main line and the siding. An IR sensor at
//              the points, a two-head signal facing the points from the
//              single track, and one head facing back from each of the main
//              and the siding. Turned round, its points face the other way.
//
// Nodes join where the sides have the same number of tracks, and the blocks
// either side of a joint are one block. The row is stored (`logic.mss.row`);
// the MSS description (ends, tracks, junctions) is built from it, so the
// builder and everything after it work as for a hand-written one.
//
// Each node keeps the names of its parts. A block belongs to the node it
// starts in: a node's left-side blocks are named only when it is first in the
// row. Two-track sides are a main line and a siding, the siding drawn on the
// far side; an end's tracks are numbered from the left looking out of it
// (engine rule 25), so end A is 1 main, 2 siding, and end B 1 siding, 2 main.
//
// Pure: no DOM.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const T = () => global.EsphomeMrMssTemplates;

  const TEXT = Object.freeze({
    nodes: Object.freeze({
      crossover: Object.freeze({ title: "Crossover", board: "ISE MSS-CROSSOVER", about: "One block right across the module, with one current detector and no signals." }),
      cascade: Object.freeze({ title: "Cascade", board: "ISE MSS-CASCADE-BASIC", about: "A block each side of an IR sensor, and a signal facing each way at it." }),
      siding: Object.freeze({ title: "Siding end", board: "ISE MSS-SWITCH", about: "A block to the points, then the main line and the siding. A two-head signal faces the points from the single track, and one head faces back from each of the main and the siding." }),
    }),
    presets: Object.freeze({
      crossover: Object.freeze({ title: "Crossover", about: "One block, no signals." }),
      cascade: Object.freeze({ title: "Cascade", about: "Two blocks, a signal each way between them." }),
      siding: Object.freeze({ title: "Siding end", about: "The points of a siding, with the main line and the siding going on to the next module." }),
      passing: Object.freeze({ title: "Passing siding", about: "A siding end at each end of a passing siding: two blocks either side, the main line and the siding between." }),
    }),
    // Names, numbered along the row.
    block: (n) => `Block ${n} current`,
    sidingBlock: (n) => `Siding ${n} current`,
    ir: (n) => `IR ${n}`,
    points: (n) => `Points ${n}`,
    signal: (n, end) => `Signal ${n} to ${end}`,
    signalOn: (n, end, road) => `Signal ${n} to ${end} ${road}`,
    main: "main",
    siding: "siding",
    junction: (n) => `J${n}`,
    // Problems.
    empty: "Pick your module: the row has no nodes yet.",
    unknown: (n, node) => `Node ${n} is "${node}", which is not an MSS node. Remove it and add a Crossover, Cascade or Siding end.`,
    crossoverAlone: "A Crossover is a whole module on its own: on one board with other nodes it adds nothing. Remove it, or make the board a Crossover only.",
    notThere: Object.freeze({
      sensor: (name) => `Sensor "${name}" is not on the Sensors page. Add it there with that name, or start the module again.`,
      turnout: (name) => `Turnout "${name}" is not on the Turnouts page. Add it there with that name, or start the module again.`,
      mast: (name) => `Signal "${name}" is not on the Signal Masts page. Add it there with that name, or start the module again.`,
    }),
    sides: (n, left, right) => `Node ${n} has ${left} track${left === 1 ? "" : "s"} on its right side, and node ${n + 1} has ${right} on its left. Joined nodes need the same number: turn one round, or put another node between them.`,
  });

  // Each node's sides: how many tracks on the left and on the right, and
  // which roads they are. A turned node's sides swap.
  const SIDES = Object.freeze({ crossover: [1, 1], cascade: [1, 1], siding: [1, 2] });
  const NODE_IDS = Object.freeze(Object.keys(SIDES));
  const roads = (count) => (count === 2 ? ["main", "siding"] : ["main"]);

  function sidesOf(node) {
    const sides = SIDES[node?.node];
    if (!sides) return null;
    return node.turned === true ? [sides[1], sides[0]] : [...sides];
  }

  // An end's track number for a road (see the head of the file).
  function endTrack(end, road, count) {
    if (count !== 2) return 1;
    if (end === "A") return road === "main" ? 1 : 2;
    return road === "main" ? 2 : 1;
  }

  const PRESETS = Object.freeze({
    crossover: Object.freeze([{ node: "crossover" }]),
    cascade: Object.freeze([{ node: "cascade" }]),
    siding: Object.freeze([{ node: "siding" }]),
    passing: Object.freeze([{ node: "siding" }, { node: "siding", turned: true }]),
  });
  const PRESET_IDS = Object.freeze(Object.keys(PRESETS));

  // ===== Names ===============================================================

  // Every part name a node gives, in wiring order: [{ key, kind, name, role }].
  // kind: sensor | turnout | mast. role: block | ir | points | signal (and for
  // a signal, `heads`: plain | twoHeads | diverging).
  function partsOf(node, first) {
    const n = isObject(node?.names) ? node.names : {};
    const out = [];
    const add = (key, kind, name, role, extra = {}) => { if (typeof name === "string" && name) out.push({ key, kind, name, role, ...extra }); };
    if (node?.node === "crossover") {
      add("block", "sensor", n.block, "block");
      return out;
    }
    if (first) list(n.left).forEach((name, i) => add(`left.${i}`, "sensor", name, "block"));
    list(n.right).forEach((name, i) => add(`right.${i}`, "sensor", name, "block"));
    add("ir", "sensor", n.ir, "ir");
    if (node?.node === "cascade") {
      add("toA", "mast", n.signals?.toA, "signal", { heads: "plain" });
      add("toB", "mast", n.signals?.toB, "signal", { heads: "plain" });
    }
    if (node?.node === "siding") {
      add("points", "turnout", n.points, "points");
      add("single", "mast", n.signals?.single, "signal", { heads: "twoHeads" });
      add("main", "mast", n.signals?.main, "signal", { heads: "plain" });
      add("siding", "mast", n.signals?.siding, "signal", { heads: "diverging" });
    }
    return out;
  }

  /**
   * The row with every part named: names a node already has are kept, the
   * rest are numbered along the row (blocks along the main line, sidings,
   * IR sensors, points and signals by the IR sensor they stand at), skipping
   * a number another part of the row already uses. A node no longer first
   * loses its left-side names. Returns a new row.
   */
  function named(row) {
    const nodes = list(row).map((node) => (isObject(node) ? JSON.parse(JSON.stringify(node)) : node));
    const used = new Set(nodes.flatMap((node, i) => partsOf(node, i === 0).map((p) => p.name)));
    const counters = { block: 0, siding: 0, ir: 0 };
    const next = (kind, make) => {
      let name;
      do { counters[kind] += 1; name = make(counters[kind]); } while (used.has(name));
      used.add(name);
      return name;
    };
    const keep = (value, make) => (typeof value === "string" && value ? value : make());
    nodes.forEach((node, i) => {
      if (!isObject(node) || !SIDES[node.node]) return;
      const n = isObject(node.names) ? node.names : {};
      node.names = n;
      if (node.node === "crossover") {
        n.block = keep(n.block, () => next("block", TEXT.block));
        return;
      }
      const [leftCount, rightCount] = sidesOf(node);
      const blockFor = (road) => (road === "siding" ? next("siding", TEXT.sidingBlock) : next("block", TEXT.block));
      if (i === 0) n.left = roads(leftCount).map((road, k) => keep(list(n.left)[k], () => blockFor(road)));
      else delete n.left;
      // The IR sensor's number is the node's: its signals and points share it.
      const irName = keep(n.ir, () => next("ir", TEXT.ir));
      n.ir = irName;
      const number = /(\d+)$/.exec(irName)?.[1] || String(counters.ir);
      n.right = roads(rightCount).map((road, k) => keep(list(n.right)[k], () => blockFor(road)));
      n.signals = isObject(n.signals) ? n.signals : {};
      const unused = (make) => {
        const name = make();
        if (!used.has(name)) { used.add(name); return name; }
        let k = 2;
        while (used.has(`${name} ${k}`)) k += 1;
        used.add(`${name} ${k}`);
        return `${name} ${k}`;
      };
      if (node.node === "cascade") {
        n.signals.toA = keep(n.signals.toA, () => unused(() => TEXT.signal(number, "A")));
        n.signals.toB = keep(n.signals.toB, () => unused(() => TEXT.signal(number, "B")));
      } else {
        // The single track faces the points; the main and siding face back.
        const towards = node.turned === true ? "A" : "B";
        const back = node.turned === true ? "B" : "A";
        n.points = keep(n.points, () => unused(() => TEXT.points(number)));
        n.signals.single = keep(n.signals.single, () => unused(() => TEXT.signal(number, towards)));
        n.signals.main = keep(n.signals.main, () => unused(() => TEXT.signalOn(number, back, TEXT.main)));
        n.signals.siding = keep(n.signals.siding, () => unused(() => TEXT.signalOn(number, back, TEXT.siding)));
      }
    });
    return nodes;
  }

  /** A preset's row, named. Null for an unknown id. */
  function preset(id) {
    return PRESETS[id] ? named(PRESETS[id]) : null;
  }

  // ===== Joining and problems ================================================

  /** Can `node` go at index `at` of the row (inserted there)? */
  function fits(row, at, node) {
    const nodes = list(row);
    const sides = sidesOf(node);
    if (!sides) return false;
    if (node.node === "crossover") return nodes.length === 0;
    if (nodes.some((n) => n?.node === "crossover")) return false;
    const before = at > 0 ? sidesOf(nodes[at - 1]) : null;
    const after = at < nodes.length ? sidesOf(nodes[at]) : null;
    return (!before || before[1] === sides[0]) && (!after || after[0] === sides[1]);
  }

  /** The row's own problems: [{ level, text, where: { node } }]. */
  function problems(row) {
    const nodes = list(row);
    const out = [];
    const error = (node, text) => out.push({ level: "error", text, where: node === null ? {} : { node } });
    if (!nodes.length) error(null, TEXT.empty);
    nodes.forEach((node, i) => { if (!SIDES[node?.node]) error(i, TEXT.unknown(i + 1, isObject(node) ? String(node.node ?? "") : "")); });
    if (out.length) return out;
    if (nodes.length > 1 && nodes.some((n) => n.node === "crossover")) error(nodes.findIndex((n) => n.node === "crossover"), TEXT.crossoverAlone);
    for (let i = 0; i + 1 < nodes.length; i += 1) {
      const left = sidesOf(nodes[i])[1];
      const right = sidesOf(nodes[i + 1])[0];
      if (left !== right) error(i + 1, TEXT.sides(i + 1, left, right));
    }
    return out;
  }

  /**
   * Each part the row names that is not on its page: [{ level, text, where:
   * { node, name, kind, mast? } }] (`mast` for a signal, so it counts as a
   * Signals problem).
   */
  function missing(config, row) {
    const have = {
      sensor: new Set(list(config?.blocks).map((b) => b?.name)),
      turnout: new Set(list(config?.points).map((p) => p?.name)),
      mast: new Set(list(config?.signals?.masts).map((m) => m?.name)),
    };
    return parts(row).filter((p) => !have[p.kind].has(p.name)).map((p) => ({
      level: "error",
      text: TEXT.notThere[p.kind](p.name),
      where: { node: p.node, name: p.name, kind: p.kind, ...(p.kind === "mast" ? { mast: p.name } : {}) },
    }));
  }

  // ===== The description =====================================================

  /**
   * The MSS description a row builds: { ends, tracks, junctions } as the
   * builder reads them (docs/mss-emulation-spec.md, Stored format), with
   * `pins` (each end's pairPin and ledPin, by end name) kept. Each track,
   * junction and end says which node it came from (`node`), for the page.
   * A row with problems describes nothing.
   */
  function describe(row, pins = []) {
    const nodes = list(row);
    if (problems(nodes).length) return { ends: [], tracks: [], junctions: [] };
    const pinsOf = new Map(list(pins).filter(isObject).map((e) => [e.name, e]));
    const leftCount = sidesOf(nodes[0])[0];
    const rightCount = sidesOf(nodes[nodes.length - 1])[1];
    const endDef = (name, tracks) => {
      const p = pinsOf.get(name) || {};
      return { name, tracks, ...(p.pairPin ? { pairPin: p.pairPin } : {}), ...(p.ledPin ? { ledPin: p.ledPin } : {}) };
    };
    const ends = [endDef("A", leftCount), endDef("B", rightCount)];
    const tracks = [];
    const junctions = [];
    let open = {};
    const block = (sensor) => ({ sensors: sensor ? [sensor] : [], turnouts: [] });
    const close = (road, to) => {
      const t = open[road];
      tracks.push({ from: t.from, to, blocks: t.blocks, boundaries: t.boundaries });
      delete open[road];
    };
    nodes.forEach((node, i) => {
      const n = node.names || {};
      const [leftN] = sidesOf(node);
      if (i === 0) {
        roads(leftN).forEach((road, k) => {
          const sensor = node.node === "crossover" ? n.block : list(n.left)[k];
          open[road] = { from: { end: "A", track: endTrack("A", road, leftN) }, blocks: [block(sensor)], boundaries: [] };
        });
      }
      if (node.node === "crossover") return;
      if (node.node === "cascade") {
        const t = open.main;
        t.boundaries.push({ sensors: n.ir ? [n.ir] : [], towardsFrom: n.signals?.toA || null, towardsTo: n.signals?.toB || null });
        t.blocks.push(block(list(n.right)[0]));
        return;
      }
      // A siding end: leg 1 the single track, leg 2 the main, leg 3 the siding.
      const name = TEXT.junction(junctions.length + 1);
      const leg = { single: 1, main: 2, siding: 3 };
      const at = (l) => ({ junction: name, leg: l });
      if (node.turned === true) {
        close("main", at(leg.main));
        close("siding", at(leg.siding));
        open = { main: { from: at(leg.single), blocks: [block(list(n.right)[0])], boundaries: [] } };
      } else {
        close("main", at(leg.single));
        open = {
          main: { from: at(leg.main), blocks: [block(list(n.right)[0])], boundaries: [] },
          siding: { from: at(leg.siding), blocks: [block(list(n.right)[1])], boundaries: [] },
        };
      }
      junctions.push({
        name,
        node: i,
        shape: node.turned === true ? "turnout-left" : "turnout-right",
        sensors: n.ir ? [n.ir] : [],
        masts: { 1: n.signals?.single || null, 2: n.signals?.main || null, 3: n.signals?.siding || null },
        routes: [
          { legs: [1, 2], turnouts: n.points ? [{ turnout: n.points, position: "closed" }] : [] },
          { legs: [1, 3], turnouts: n.points ? [{ turnout: n.points, position: "thrown" }] : [], diverging: true },
        ],
      });
    });
    for (const road of roads(rightCount)) if (open[road]) close(road, { end: "B", track: endTrack("B", road, rightCount) });
    return { ends, tracks, junctions };
  }

  /**
   * The MSS description MSS Logic builds from: `logic.mss` itself, or, when
   * it has a row, the row's description with the indication ticks and the
   * ends' pins kept.
   */
  function descriptionOf(mss) {
    if (!isObject(mss) || !Array.isArray(mss.row)) return mss;
    const out = { ...describe(mss.row, mss.ends) };
    for (const key of ["advanceApproach", "approachDiverging", "masts"]) if (mss[key] !== undefined) out[key] = mss[key];
    return out;
  }

  // ===== Parts on the foundation pages ======================================

  /**
   * Everything the row names, in wiring order: [{ node, key, kind, name,
   * role, heads? }]. Every block left to right, then the IR sensors, the
   * points, and the signals.
   */
  const ROLE_ORDER = ["block", "ir", "points", "signal"];
  function parts(row) {
    const all = list(row).flatMap((node, i) => partsOf(node, i === 0).map((p) => ({ node: i, ...p })));
    return ROLE_ORDER.flatMap((role) => all.filter((p) => p.role === role));
  }

  // A signal's Signal Masts entry, without pins, as the templates make it.
  function mastFor(part, style) {
    const t = T();
    const heads = part.heads === "twoHeads" ? t.HEADS.twoHeads : t.HEADS.oneHead;
    const rows = t.MSS_ROWS[part.heads];
    return t.mast(part.name, rows, heads, style);
  }

  /**
   * What the board needs for the row and does not have yet: { sensors,
   * turnouts (names), masts (Signal Masts entries without pins), pins (how
   * many pins the new signals need), kept (names already there, used as they
   * are) }. `style`: "leds" (three to a head) or "strip" (one WS2812B LED a
   * head, one data pin a signal).
   */
  function needs(config, row, { style = "leds" } = {}) {
    const have = {
      sensor: new Set(list(config?.blocks).map((b) => b?.name)),
      turnout: new Set(list(config?.points).map((p) => p?.name)),
      mast: new Set(list(config?.signals?.masts).map((m) => m?.name)),
    };
    const out = { sensors: [], turnouts: [], masts: [], pins: 0, kept: [] };
    for (const part of parts(row)) {
      if (have[part.kind].has(part.name)) { out.kept.push(part.name); continue; }
      have[part.kind].add(part.name);
      if (part.kind === "sensor") out.sensors.push(part.name);
      else if (part.kind === "turnout") out.turnouts.push(part.name);
      else {
        const m = mastFor(part, style);
        out.masts.push(m);
        out.pins += style === "strip" ? 1 : m.lamps.length;
      }
    }
    return out;
  }

  /**
   * Start the module as `row` (named first): writes `logic.mss.row`, keeping
   * the indication ticks and the ends' pins, drops a hand-written
   * description, and hands `add({ sensors, turnouts, masts })` what the board
   * does not have yet (the page gives them free pins). Returns needs().
   */
  function use(config, row, add, { style = "leds" } = {}) {
    const nodes = named(row);
    const want = needs(config, nodes, { style });
    if (typeof add === "function") add({ sensors: want.sensors, turnouts: want.turnouts, masts: want.masts });
    if (!isObject(config.logic)) config.logic = {};
    const before = isObject(config.logic.mss) ? config.logic.mss : {};
    const mss = { row: nodes };
    for (const key of ["advanceApproach", "approachDiverging"]) if (before[key] !== undefined) mss[key] = before[key];
    const pins = list(before.ends).filter((e) => isObject(e) && (e.pairPin || e.ledPin) && ["A", "B"].includes(e.name))
      .map((e) => ({ name: e.name, ...(e.pairPin ? { pairPin: e.pairPin } : {}), ...(e.ledPin ? { ledPin: e.ledPin } : {}) }));
    if (pins.length) mss.ends = pins;
    config.logic.mss = mss;
    return want;
  }

  // ===== Changing the row ====================================================

  const copy = (row) => JSON.parse(JSON.stringify(list(row)));

  /** Can `node` be added on the right of the row? */
  const canAdd = (row, node) => fits(row, list(row).length, node);

  /**
   * The row with `node` added on the right, named: its left block is the
   * last node's right one (a joint is one block), and its parts are numbered
   * on from the row's.
   */
  function addNode(row, node) {
    const nodes = copy(row);
    nodes.push({ node: node.node, ...(node.turned === true ? { turned: true } : {}) });
    return named(nodes);
  }

  /** Can node `i` be removed: what is left has no problems of its own? */
  function canRemove(row, i) {
    const nodes = list(row);
    if (i < 0 || i >= nodes.length || nodes.length < 2) return false;
    return problems(nodes.filter((_, k) => k !== i)).length === 0;
  }

  /**
   * The row without node `i`, named. The first node gone, the block it
   * shared with the next becomes the next one's left block, keeping its name.
   */
  function removeNode(row, i) {
    const nodes = copy(row);
    const [gone] = nodes.splice(i, 1);
    if (i === 0 && nodes.length && gone?.names) {
      nodes[0].names = isObject(nodes[0].names) ? nodes[0].names : {};
      nodes[0].names.left = list(gone.names.right);
    }
    return named(nodes);
  }

  /** Can node `i` be turned round: a Siding end, still fitting beside its neighbours? */
  function canTurn(row, i) {
    const nodes = list(row);
    if (nodes[i]?.node !== "siding") return false;
    const turned = nodes.map((n, k) => (k === i ? { ...n, turned: n.turned !== true } : n));
    return problems(turned).length === 0;
  }

  /**
   * The row with node `i` turned round: { row, renames: [[from, to]] }. Its
   * blocks keep their names and swap sides (the single track's block, the
   * main's and the siding's). Each signal named as the pattern names it is
   * renamed for the way it now faces; one named otherwise keeps its name.
   */
  function turnNode(row, i) {
    const nodes = copy(row);
    const node = nodes[i];
    const n = isObject(node.names) ? node.names : {};
    const wasTurned = node.turned === true;
    node.turned = !wasTurned;
    if (!node.turned) delete node.turned;
    // Not turned: left [single], right [main, siding]; turned: left [main, siding], right [single].
    const single = wasTurned ? list(n.right)[0] : list(n.left)[0];
    const roads = wasTurned ? list(n.left) : list(n.right);
    if (i === 0) {
      n.left = wasTurned ? [single] : roads;
      n.right = wasTurned ? roads : [single];
    }
    const number = /(\d+)$/.exec(n.ir || "")?.[1] || String(i + 1);
    const [was, now] = wasTurned ? ["A", "B"] : ["B", "A"];
    const [wasBack, nowBack] = [now, was];
    const renames = [];
    const swap = (key, before, after) => {
      if (n.signals?.[key] === before) {
        renames.push([before, after]);
        n.signals[key] = after;
      }
    };
    if (isObject(n.signals)) {
      swap("single", TEXT.signal(number, was), TEXT.signal(number, now));
      swap("main", TEXT.signalOn(number, wasBack, TEXT.main), TEXT.signalOn(number, nowBack, TEXT.main));
      swap("siding", TEXT.signalOn(number, wasBack, TEXT.siding), TEXT.signalOn(number, nowBack, TEXT.siding));
    }
    return { row: named(nodes), renames };
  }

  /**
   * Rename a part everywhere in the row: a sensor, turnout or mast renamed on
   * its page (`kind`: sensor | turnout | mast; any kind when left out).
   * Returns how many names moved.
   */
  function rename(row, from, to, kind) {
    let count = 0;
    const swap = (value) => {
      if (value !== from) return value;
      count += 1;
      return to;
    };
    const is = (k) => kind === undefined || kind === k;
    for (const node of list(row)) {
      const n = node?.names;
      if (!isObject(n)) continue;
      if (is("sensor")) {
        for (const key of ["block", "ir"]) if (n[key] !== undefined) n[key] = swap(n[key]);
        for (const key of ["left", "right"]) if (Array.isArray(n[key])) n[key] = n[key].map(swap);
      }
      if (is("turnout") && n.points !== undefined) n.points = swap(n.points);
      if (is("mast") && isObject(n.signals)) for (const key of Object.keys(n.signals)) n.signals[key] = swap(n.signals[key]);
    }
    return count;
  }

  global.EsphomeMrMssRow = {
    TEXT, NODE_IDS, PRESET_IDS, PRESETS, sidesOf, endTrack, partsOf, named, preset, fits, problems, missing, describe, descriptionOf, parts, needs, use, rename,
    canAdd, addNode, canRemove, removeNode, canTurn, turnNode,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
