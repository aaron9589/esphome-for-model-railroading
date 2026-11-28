// MSS Logic from the standard nodes (docs/mss-patterns-spec.md; work item
// MP 1). A module is a row of MSS nodes, left to right, on one board:
//
//   crossover  MSS Crossover: one block, no signals. A
//              whole module on its own: in a row it would add nothing.
//   cascade    MSS Cascade: a block each side of an
//              IR sensor, and a signal facing each way at it.
//   complex    MSS Complex Cascade, where the track divides
//              at a turnout: a block to the points, then the main line and
//              the diverging track (drawn as a siding). An IR sensor at the
//              points, a two-head signal facing the points from the single
//              track, and one head facing back from each of the main and the
//              diverging track. Flipped (`turned`), its points face the other
//              way. Two, the second flipped, make a passing siding.
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
      crossover: Object.freeze({ title: "Crossover", about: "One block right across the module, with one current detector and no signals." }),
      cascade: Object.freeze({ title: "Cascade", about: "A block each side of an IR sensor, and a signal facing each way at it." }),
      complex: Object.freeze({ title: "Complex cascade", about: "Where the track divides at a turnout: a block to the points, then the main line and the diverging track. A two-head signal faces the points from the single track, and one head faces back from each of the others." }),
    }),
    // One-click starting points: a board on its own, or a sample of boards stitched together.
    presets: Object.freeze({
      crossover: Object.freeze({ title: "Crossover", about: "One block, no signals." }),
      cascade: Object.freeze({ title: "Cascade", about: "Two blocks, a signal each way between them." }),
      complex: Object.freeze({ title: "Complex cascade", about: "The points of a junction or siding, with the main line and the diverging track going on to the next module." }),
      passing: Object.freeze({ title: "Passing siding", about: "A Complex cascade, then one flipped: two blocks either side, the main line and the siding between." }),
      cascades: Object.freeze({ title: "Two cascades", about: "Two Cascades in a row: three blocks, with a signal each way at each IR sensor." }),
    }),
    flipped: "flipped",
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
    empty: "Pick your module: it has no MSS boards yet.",
    unknown: (n, node) => `Board ${n} is "${node}", which is not an MSS board. Remove it and add a Crossover, Cascade or Complex cascade.`,
    notMade: "The module's sensors, turnouts and signals are not made yet: click Make the module on Pick your module, and they are made with free pins.",
    notAllMade: (names) => `Not made yet: ${names}. Click Make the module on Pick your module to add them with free pins, or add them on their pages with these names.`,
    notThere: Object.freeze({
      sensor: (name) => `Sensor "${name}" is not on the Sensors page. Add it there with that name, or start the module again.`,
      turnout: (name) => `Turnout "${name}" is not on the Turnouts page. Add it there with that name, or start the module again.`,
      mast: (name) => `Signal "${name}" is not on the Signal Masts page. Add it there with that name, or start the module again.`,
    }),
    noLine: (n, line) => `Board ${n} is on line ${line}, which is not there at that point of the module. Drag it onto a line, or put a Complex cascade before it to split one.`,
  });

  // Each node's sides: how many tracks on the left and on the right, and
  // which roads they are. A turned node's sides swap.
  const SIDES = Object.freeze({ crossover: [1, 1], cascade: [1, 1], complex: [1, 2] });
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
    complex: Object.freeze([{ node: "complex" }]),
    passing: Object.freeze([{ node: "complex" }, { node: "complex", turned: true }]),
    cascades: Object.freeze([{ node: "cascade" }, { node: "cascade" }]),
  });
  // The three MSS boards, and the samples made of them.
  const BOARD_IDS = Object.freeze(["crossover", "cascade", "complex"]);
  const SAMPLE_IDS = Object.freeze(["passing", "cascades"]);

  // ===== Lines ===============================================================

  // A board's line (`line`, from 0, the bottom line at that point).
  const lineOf = (node) => (Number.isInteger(node?.line) && node.line >= 0 ? node.line : 0);
  const isJoin = (node) => node?.node === "complex" && node.turned === true;

  /**
   * The module walked board by board, left to right, as lines: each line is
   * a lane (`id`), carried past the boards not on it. The left edge has one
   * line, or two when the first board joins two. A Complex cascade splits
   * its line (its main line carries on, the diverging line is new, just
   * above it) or, flipped, joins its line and the one above. Returns
   * { steps: [{ index, node, line, inputs: [{ lane, fresh }], out }],
   *   lanes: Map(id -> { road, fromLeft }), order (every lane, bottom to
   *   top, for drawing), left, right (the lanes at each edge, bottom to
   *   top), missing (indexes of boards on a line that is not there) }.
   * `fresh`: no board has touched that lane yet (its first block is the
   * board's to name). `out`: the lanes the board hands on (a split's main
   * and new lane; a join's one).
   */
  function walk(row) {
    const nodes = list(row);
    const lanes = new Map();
    const order = [];
    let active = [];
    let nextId = 0;
    const touched = new Set();
    const add = (road, fromLeft, after) => {
      const id = nextId++;
      lanes.set(id, { road, fromLeft });
      if (after === undefined) order.push(id);
      else order.splice(order.indexOf(after) + 1, 0, id);
      return id;
    };
    active.push(add("main", true));
    if (isJoin(nodes[0])) active.push(add("siding", true));
    const left = [...active];
    const steps = [];
    const missing = [];
    nodes.forEach((node, index) => {
      if (!SIDES[node?.node]) return;
      const line = lineOf(node);
      const top = isJoin(node) ? line + 1 : line;
      if (top >= active.length) {
        missing.push(index);
        return;
      }
      const ins = isJoin(node) ? [active[line], active[line + 1]] : [active[line]];
      const inputs = ins.map((lane) => ({ lane, fresh: !touched.has(lane) }));
      for (const lane of ins) touched.add(lane);
      let out = [active[line]];
      if (node.node === "complex" && !isJoin(node)) {
        const branch = add("siding", false, active[line]);
        active.splice(line + 1, 0, branch);
        touched.add(branch);
        out = [active[line], branch];
      } else if (isJoin(node)) {
        active.splice(line + 1, 1);
      }
      steps.push({ index, node, line, inputs, out });
    });
    return { steps, lanes, order, left, right: [...active], missing };
  }

  // ===== Columns ===========================================================

  /**
   * Where each board stands along the module. Boards on different lines stand
   * side by side: a board goes in the column after the last board on each of
   * its lines (a Complex cascade on both of its). { col: [column by row
   * index], count }, for a row with no problems.
   */
  function columns(row) {
    const nodes = list(row);
    const w = walk(nodes);
    const next = new Map(); // line -> its next free column
    const col = nodes.map(() => 0);
    let count = 0;
    for (const step of w.steps) {
      const lanes = [...new Set([...step.inputs.map((x) => x.lane), ...step.out])];
      const c = Math.max(0, ...lanes.map((lane) => next.get(lane) ?? 0));
      col[step.index] = c;
      for (const lane of lanes) next.set(lane, c + 1);
      count = Math.max(count, c + 1);
    }
    return { col, count };
  }

  /**
   * The row in column order (boards on different lines that stand side by
   * side next to each other, the bottom line's first), with each board's line counted again for its
   * new place. Every line keeps its boards in the same order, so the module
   * is the same. A row with problems comes back as it is.
   */
  function pack(row) {
    const nodes = list(row);
    if (!nodes.length || problems(nodes).length) return nodes;
    const { col } = columns(nodes);
    const w = walk(nodes);
    const stepOf = new Map(w.steps.map((step) => [step.index, step]));
    // Side by side in a column: the bottom line's board first.
    const rank = new Map(w.order.map((lane, k) => [lane, k]));
    const lowest = (i) => rank.get(stepOf.get(i).inputs[0].lane);
    const order = nodes.map((_, i) => i).sort((a, b) => col[a] - col[b] || lowest(a) - lowest(b) || a - b);
    if (order.every((at, i) => at === i)) return nodes;
    const active = [...w.left];
    return order.map((i) => {
      const node = JSON.parse(JSON.stringify(nodes[i]));
      const step = stepOf.get(i);
      const line = active.indexOf(step.inputs[0].lane);
      if (line > 0) node.line = line;
      else delete node.line;
      if (isJoin(node)) active.splice(line + 1, 1);
      else if (step.out.length > 1) active.splice(line + 1, 0, step.out[1]);
      return node;
    });
  }

  // ===== Names ===============================================================

  // Every part name a board gives, in wiring order: [{ key, kind, name, role }].
  // kind: sensor | turnout | mast. role: block | ir | points | signal (and for
  // a signal, `heads`: plain | twoHeads | diverging). `fresh`: for each of its
  // lines, whether its block there is this board's to name (`left`).
  function partsOf(node, fresh = []) {
    const n = isObject(node?.names) ? node.names : {};
    const out = [];
    const add = (key, kind, name, role, extra = {}) => { if (typeof name === "string" && name) out.push({ key, kind, name, role, ...extra }); };
    if (node?.node === "crossover") {
      add("block", "sensor", n.block, "block");
      return out;
    }
    fresh.forEach((isFresh, i) => { if (isFresh) add(`left.${i}`, "sensor", list(n.left)[i], "block"); });
    list(n.right).forEach((name, i) => add(`right.${i}`, "sensor", name, "block"));
    add("ir", "sensor", n.ir, "ir");
    if (node?.node === "cascade") {
      add("toA", "mast", n.signals?.toA, "signal", { heads: "plain" });
      add("toB", "mast", n.signals?.toB, "signal", { heads: "plain" });
    }
    if (node?.node === "complex") {
      add("points", "turnout", n.points, "points");
      add("single", "mast", n.signals?.single, "signal", { heads: "twoHeads" });
      add("main", "mast", n.signals?.main, "signal", { heads: "plain" });
      add("siding", "mast", n.signals?.siding, "signal", { heads: "diverging" });
    }
    return out;
  }

  /**
   * The row with every part named: names a board already has are kept, the
   * rest are numbered along the module (blocks on main lines, blocks on
   * diverging lines, IR sensors, points and signals by the IR sensor they
   * stand at), skipping a number another part already uses. A board names a
   * line's first block (`left`) only where no board before it is on that
   * line. Returns a new row.
   */
  function named(row) {
    const nodes = list(row).map((node) => (isObject(node) ? JSON.parse(JSON.stringify(node)) : node));
    const w = walk(nodes);
    const freshOf = new Map(w.steps.map((step) => [step.index, step.inputs.map((x) => x.fresh)]));
    const used = new Set(nodes.flatMap((node, i) => partsOf(node, freshOf.get(i) || []).map((p) => p.name)));
    const counters = { block: 0, siding: 0, ir: 0 };
    const next = (kind, make) => {
      let name;
      do { counters[kind] += 1; name = make(counters[kind]); } while (used.has(name));
      used.add(name);
      return name;
    };
    const keep = (value, make) => (typeof value === "string" && value ? value : make());
    const blockFor = (road) => (road === "siding" ? next("siding", TEXT.sidingBlock) : next("block", TEXT.block));
    const roadOf = (lane) => w.lanes.get(lane)?.road || "main";
    for (const step of w.steps) {
      const node = nodes[step.index];
      const n = isObject(node.names) ? node.names : {};
      node.names = n;
      if (node.node === "crossover") {
        n.block = keep(n.block, () => blockFor(roadOf(step.inputs[0].lane)));
        continue;
      }
      if (step.inputs.some((x) => x.fresh)) n.left = step.inputs.map((x, k) => (x.fresh ? keep(list(n.left)[k], () => blockFor(roadOf(x.lane))) : null));
      else delete n.left;
      // The IR sensor's number is the board's: its signals and points share it.
      const irName = keep(n.ir, () => next("ir", TEXT.ir));
      n.ir = irName;
      const number = /(\d+)$/.exec(irName)?.[1] || String(counters.ir);
      n.right = step.out.map((lane, k) => keep(list(n.right)[k], () => blockFor(roadOf(lane))));
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
    }
    return nodes;
  }

  /** A preset's row, named. Null for an unknown id. */
  function preset(id) {
    return PRESETS[id] ? named(PRESETS[id]) : null;
  }

  // ===== Problems =============================================================

  /** The row's own problems: [{ level, text, where: { node } }]. */
  function problems(row) {
    const nodes = list(row);
    const out = [];
    const error = (node, text) => out.push({ level: "error", text, where: node === null ? {} : { node } });
    if (!nodes.length) error(null, TEXT.empty);
    nodes.forEach((node, i) => { if (!SIDES[node?.node]) error(i, TEXT.unknown(i + 1, isObject(node) ? String(node.node ?? "") : "")); });
    if (out.length) return out;
    for (const i of walk(nodes).missing) error(i, TEXT.noLine(i + 1, lineOf(nodes[i]) + 1));
    return out;
  }

  /** Can `node` (with its `line`) go at index `at` of the row (inserted there)? */
  function fits(row, at, node) {
    if (!SIDES[node?.node]) return false;
    const nodes = copy(row);
    nodes.splice(Math.max(0, Math.min(at, nodes.length)), 0, { node: node.node, ...(node.turned === true ? { turned: true } : {}), line: lineOf(node) });
    return problems(nodes).length === 0;
  }

  /** The lines at index `at` of the row (before the board there): how many. */
  function linesAt(row, at) {
    const nodes = list(row).slice(0, Math.max(0, at));
    const w = walk(nodes);
    // An empty row starts with one line.
    return w.right.length;
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
    const all = parts(row);
    // None of them there: the module is not made yet, one problem for it.
    if (all.length && all.every((p) => !have[p.kind].has(p.name))) return [{ level: "error", text: TEXT.notMade, where: { row: true, notMade: true } }];
    // Some missing (boards added since it was made, or a part deleted): one problem naming them.
    const absent = all.filter((p) => !have[p.kind].has(p.name));
    if (!absent.length) return [];
    return [{ level: "error", text: TEXT.notAllMade(absent.map((p) => p.name).join(", ")), where: { row: true, notMade: true, names: absent.map((p) => p.name) } }];
  }

  // ===== The description =====================================================

  /**
   * The MSS description a row builds: { ends, tracks, junctions } as the
   * builder reads them (docs/mss-emulation-spec.md, Stored format), with
   * `pins` (each end's pairPin and ledPin, by end name) kept. Each junction
   * says which board it came from (`node`), for the page. A row with
   * problems describes nothing. The lines at the left edge are end A's
   * tracks, those at the right edge end B's, numbered from the left looking
   * out (end A from the bottom line, end B from the top).
   */
  function describe(row, pins = []) {
    const nodes = list(row);
    if (problems(nodes).length) return { ends: [], tracks: [], junctions: [] };
    const pinsOf = new Map(list(pins).filter(isObject).map((e) => [e.name, e]));
    const w = walk(nodes);
    const endDef = (name, tracks) => {
      const p = pinsOf.get(name) || {};
      return { name, tracks, ...(p.pairPin ? { pairPin: p.pairPin } : {}), ...(p.ledPin ? { ledPin: p.ledPin } : {}) };
    };
    const ends = [endDef("A", w.left.length), endDef("B", w.right.length)];
    const tracks = [];
    const junctions = [];
    const open = new Map(); // lane -> the track being built along it
    w.left.forEach((lane, k) => open.set(lane, { from: { end: "A", track: k + 1 }, blocks: [], boundaries: [] }));
    const block = (sensor) => ({ sensors: sensor ? [sensor] : [], turnouts: [] });
    const close = (lane, to) => {
      const t = open.get(lane);
      tracks.push({ from: t.from, to, blocks: t.blocks, boundaries: t.boundaries });
      open.delete(lane);
    };
    for (const step of w.steps) {
      const node = step.node;
      const n = node.names || {};
      // A line's first block is the first board's on it to name.
      step.inputs.forEach((x, k) => {
        const t = open.get(x.lane);
        if (x.fresh && node.node !== "crossover") t.blocks.push(block(list(n.left)[k]));
      });
      if (node.node === "crossover") {
        const t = open.get(step.inputs[0].lane);
        if (!t.blocks.length) t.blocks.push(block(n.block));
        else if (n.block && !t.blocks[t.blocks.length - 1].sensors.includes(n.block)) t.blocks[t.blocks.length - 1].sensors.push(n.block);
        continue;
      }
      if (node.node === "cascade") {
        const t = open.get(step.inputs[0].lane);
        t.boundaries.push({ sensors: n.ir ? [n.ir] : [], towardsFrom: n.signals?.toA || null, towardsTo: n.signals?.toB || null });
        t.blocks.push(block(list(n.right)[0]));
        continue;
      }
      // A Complex cascade: leg 1 the single track, leg 2 the main, leg 3 the diverging track.
      const name = TEXT.junction(junctions.length + 1);
      const at = (leg) => ({ junction: name, leg });
      if (isJoin(node)) {
        close(step.inputs[0].lane, at(2));
        close(step.inputs[1].lane, at(3));
        open.set(step.out[0], { from: at(1), blocks: [block(list(n.right)[0])], boundaries: [] });
      } else {
        close(step.inputs[0].lane, at(1));
        open.set(step.out[0], { from: at(2), blocks: [block(list(n.right)[0])], boundaries: [] });
        open.set(step.out[1], { from: at(3), blocks: [block(list(n.right)[1])], boundaries: [] });
      }
      junctions.push({
        name,
        node: step.index,
        shape: isJoin(node) ? "turnout-left" : "turnout-right",
        sensors: n.ir ? [n.ir] : [],
        masts: { 1: n.signals?.single || null, 2: n.signals?.main || null, 3: n.signals?.siding || null },
        routes: [
          { legs: [1, 2], turnouts: n.points ? [{ turnout: n.points, position: "closed" }] : [] },
          { legs: [1, 3], turnouts: n.points ? [{ turnout: n.points, position: "thrown" }] : [], diverging: true },
        ],
      });
    }
    const count = w.right.length;
    w.right.forEach((lane, k) => close(lane, { end: "B", track: count - k }));
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
    const w = walk(row);
    const all = w.steps.flatMap((step) => partsOf(step.node, step.inputs.map((x) => x.fresh)).map((p) => ({ node: step.index, ...p })));
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

  /** Can `node` (with its `line`) be added on the right of the row? */
  const canAdd = (row, node) => fits(row, list(row).length, node);

  /** The row with `node` added on the right, named. */
  function addNode(row, node) {
    return insertNode(row, list(row).length, node);
  }

  // The board as stored: its type, flipped, and its line when not the bottom one.
  const placed = (node) => ({ node: node.node, ...(node.turned === true ? { turned: true } : {}), ...(lineOf(node) ? { line: lineOf(node) } : {}) });

  // The block names a board hands on, by the line they run on: { line: name }.
  function handedOn(step) {
    const right = list(step.node.names?.right);
    const out = {};
    step.out.forEach((lane, k) => { out[k === 0 ? step.line : step.line + 1] = right[k]; });
    if (step.node.node === "crossover") out[step.line] = step.node.names?.block;
    return out;
  }

  /**
   * The row with `node` (on its `line`) inserted at index `at`, named. Put
   * first, it hands the old first board the blocks that board named (a
   * joint is one block, and its detector keeps its name).
   */
  function insertNode(row, at, node) {
    const nodes = copy(row);
    const fresh = placed(node);
    if (isObject(node.names)) fresh.names = JSON.parse(JSON.stringify(node.names));
    const where = Math.max(0, Math.min(at, nodes.length));
    nodes.splice(where, 0, fresh);
    if (where === 0 && nodes.length > 1 && fresh.node !== "crossover") {
      const old = nodes[1];
      const oldLeft = list(old.names?.left);
      const w = walk(nodes);
      const first = w.steps.find((s) => s.index === 0);
      if (first && oldLeft.length) {
        fresh.names = isObject(fresh.names) ? fresh.names : {};
        fresh.names.right = list(fresh.names.right);
        const lines = isJoin(old) ? [lineOf(old), lineOf(old) + 1] : [lineOf(old)];
        lines.forEach((line, k) => {
          const outIndex = line === first.line ? 0 : line === first.line + 1 && first.out.length > 1 ? 1 : -1;
          if (outIndex >= 0 && oldLeft[k]) fresh.names.right[outIndex] = oldLeft[k];
        });
        delete old.names.left;
      }
    }
    return named(nodes);
  }

  /** Can node `i` be removed: what is left has no problems of its own? */
  function canRemove(row, i) {
    const nodes = list(row);
    if (i < 0 || i >= nodes.length || nodes.length < 2) return false;
    return problems(nodes.filter((_, k) => k !== i)).length === 0;
  }

  /**
   * The row without node `i`, named. The first board gone, the blocks it
   * handed on become the next board's first blocks, keeping their names.
   */
  function removeNode(row, i) {
    const nodes = copy(row);
    const w = walk(nodes);
    const step = w.steps.find((s) => s.index === i);
    const [gone] = nodes.splice(i, 1);
    if (i === 0 && nodes.length && gone && step) {
      const given = handedOn(step);
      const next = nodes[0];
      next.names = isObject(next.names) ? next.names : {};
      const lines = isJoin(next) ? [lineOf(next), lineOf(next) + 1] : [lineOf(next)];
      const left = lines.map((line) => given[line] || null);
      if (left.some(Boolean)) next.names.left = left;
    }
    return named(nodes);
  }

  /** The row with node `from` moved to index `to` (counted in the row without it), on line `line` (else its own), named. */
  function moveNode(row, from, to, line) {
    const nodes = copy(row);
    const node = nodes[from];
    if (!node) return named(nodes);
    const rest = removeNode(nodes, from);
    const moved = { ...placed(node), ...(line !== undefined ? { line } : {}), names: isObject(node.names) ? { ...node.names } : {} };
    if (!moved.line) delete moved.line;
    delete moved.names.left;
    delete moved.names.right;
    return insertNode(rest, to, moved);
  }

  /** Can node `from` move to index `to` (in the row without it), on line `line`? */
  const canMove = (row, from, to, line) => problems(moveNode(row, from, to, line)).length === 0;

  /** Can node `i` be flipped: a Complex cascade, splitting where it joined or joining where it split, with the lines there? */
  function canTurn(row, i) {
    const nodes = list(row);
    if (nodes[i]?.node !== "complex") return false;
    const turned = nodes.map((n, k) => (k === i ? { ...n, turned: n.turned !== true } : n));
    return problems(turned).length === 0;
  }

  /**
   * The row with node `i` flipped: { row, renames: [[from, to]] }. First on
   * its lines, its blocks keep their names and swap sides (the single
   * track's block, the main's and the diverging track's); elsewhere its own
   * blocks are named again. Each signal named as the pattern names it is
   * renamed for the way it now faces; one named otherwise keeps its name.
   */
  function turnNode(row, i) {
    const nodes = copy(row);
    const node = nodes[i];
    const n = isObject(node.names) ? node.names : {};
    node.names = n;
    const wasTurned = node.turned === true;
    node.turned = !wasTurned;
    if (!node.turned) delete node.turned;
    // Not turned: left [single], right [main, siding]; turned: left [main, siding], right [single].
    const single = wasTurned ? list(n.right)[0] : list(n.left)[0];
    const roadsOf = wasTurned ? list(n.left) : list(n.right);
    if (i === 0 && single && roadsOf.every(Boolean)) {
      n.left = wasTurned ? [single] : roadsOf;
      n.right = wasTurned ? roadsOf : [single];
    } else {
      delete n.left;
      delete n.right;
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
    TEXT, NODE_IDS, BOARD_IDS, SAMPLE_IDS, PRESETS, sidesOf, endTrack, lineOf, isJoin, walk, columns, pack, linesAt, partsOf, named, preset, fits, problems, missing, describe, descriptionOf, parts, needs, use, rename,
    canAdd, addNode, canRemove, removeNode, canTurn, turnNode, insertNode, moveNode, canMove,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
