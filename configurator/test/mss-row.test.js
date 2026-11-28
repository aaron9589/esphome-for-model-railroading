// MSS Logic from the standard nodes (docs/mss-patterns-spec.md; work item
// MP 1): mss-row.js turns a row of nodes into the MSS description. The
// behaviour of a row is in its hand-worked cases (test/cases/mss/mss-row-*),
// replayed by mss-builder.test.js and engine-diff.test.js; here, the row
// itself: names, joining, problems, the description, and the parts it adds.
import assert from "node:assert/strict";
import { loadModules, test } from "./harness.js";
import { MSS_FILES, readMssCase } from "./mss-cases.js";

const context = loadModules(...MSS_FILES);
const { EsphomeMr: M, EsphomeMrMssRow: R, EsphomeMrMssBuilder: B, EsphomeMrLogicYaml: L } = context;
const plain = (value) => JSON.parse(JSON.stringify(value));
const same = (actual, expected, ...message) => assert.deepEqual(plain(actual), plain(expected), ...message);

test("the presets are named as the cases name them, numbered along the row", () => {
  same(R.preset("passing"), readMssCase("mss-row-passing-siding.json").module.mss.row);
  same(R.named([{ node: "cascade" }, { node: "cascade" }]), readMssCase("mss-row-cascades.json").module.mss.row);
  same(R.preset("crossover"), [{ node: "crossover", names: { block: "Block 1 current" } }]);
  same(R.preset("nothing"), null);
});

test("names a node has are kept; new ones skip numbers in use; a node no longer first loses its left side", () => {
  const row = R.named([{ node: "cascade", names: { ir: "IR 1", signals: { toA: "West", toB: "Block 1 current" } } }, { node: "cascade", names: { left: ["Old"] } }]);
  same(row[0].names.signals, { toA: "West", toB: "Block 1 current" });
  same(row[0].names.left, ["Block 2 current"], "Block 1 current is a signal's name here");
  assert.equal(row[1].names.left, undefined);
  same(row[1].names.ir, "IR 2");
});

test("the passing siding's description: two ends, the main and the siding between two junctions", () => {
  const d = R.describe(R.preset("passing"));
  same(d.ends, [{ name: "A", tracks: 1 }, { name: "B", tracks: 1 }]);
  same(d.tracks.map((t) => [t.from, t.to, t.blocks.map((b) => b.sensors), t.boundaries.length]), [
    [{ end: "A", track: 1 }, { junction: "J1", leg: 1 }, [["Block 1 current"]], 0],
    [{ junction: "J1", leg: 2 }, { junction: "J2", leg: 2 }, [["Block 2 current"]], 0],
    [{ junction: "J1", leg: 3 }, { junction: "J2", leg: 3 }, [["Siding 1 current"]], 0],
    [{ junction: "J2", leg: 1 }, { end: "B", track: 1 }, [["Block 3 current"]], 0],
  ]);
  same(d.junctions.map((j) => [j.name, j.node, j.sensors, j.masts, j.routes.map((r) => [r.legs, r.turnouts, !!r.diverging])]), [
    ["J1", 0, ["IR 1"], { 1: "Signal 1 to B", 2: "Signal 1 to A main", 3: "Signal 1 to A siding" },
      [[[1, 2], [{ turnout: "Points 1", position: "closed" }], false], [[1, 3], [{ turnout: "Points 1", position: "thrown" }], true]]],
    ["J2", 1, ["IR 2"], { 1: "Signal 2 to A", 2: "Signal 2 to B main", 3: "Signal 2 to B siding" },
      [[[1, 2], [{ turnout: "Points 2", position: "closed" }], false], [[1, 3], [{ turnout: "Points 2", position: "thrown" }], true]]],
  ]);
});

test("a two-track end is numbered from the left looking out: A is 1 main, 2 siding; B is 1 siding, 2 main", () => {
  const lone = R.describe(R.preset("complex"));
  same(lone.ends, [{ name: "A", tracks: 1 }, { name: "B", tracks: 2 }]);
  same(lone.tracks.slice(1).map((t) => [t.blocks[0].sensors[0], t.to]), [["Block 2 current", { end: "B", track: 2 }], ["Siding 1 current", { end: "B", track: 1 }]]);
  const turned = R.describe(R.named([{ node: "complex", turned: true }]));
  same(turned.ends.map((e) => e.tracks), [2, 1]);
  same(turned.tracks.slice(0, 2).map((t) => [t.blocks[0].sensors[0], t.from]), [["Block 1 current", { end: "A", track: 1 }], ["Siding 1 current", { end: "A", track: 2 }]]);
  // A lone Complex cascade meets a lone Complex cascade flipped: main to main (2 meets 2 + 1 - 2 = 1).
  assert.equal(R.endTrack("B", "main", 2), 2 + 1 - R.endTrack("A", "main", 2));
  // A Crossover between two ends is a pass-through.
  same(R.describe(R.preset("crossover")).tracks, [{ from: { end: "A", track: 1 }, to: { end: "B", track: 1 }, blocks: [{ sensors: ["Block 1 current"], turnouts: [] }], boundaries: [] }]);
});

test("the parts a row adds, in wiring order, and how many pins its signals need", () => {
  const config = M.myFirstBoardPreset();
  config.blocks = [{ name: "IR 1" }];
  const want = R.needs(config, R.preset("passing"));
  same(want.sensors, ["Block 1 current", "Block 2 current", "Siding 1 current", "Block 3 current", "IR 2"]);
  same(want.kept, ["IR 1"]);
  same(want.turnouts, ["Points 1", "Points 2"]);
  same(want.masts.map((m) => [m.name, m.lamps.length]), [
    ["Signal 1 to B", 6], ["Signal 1 to A main", 3], ["Signal 1 to A siding", 3],
    ["Signal 2 to A", 6], ["Signal 2 to B main", 3], ["Signal 2 to B siding", 3],
  ]);
  assert.equal(want.pins, 24);
  assert.equal(R.needs(config, R.preset("passing"), { style: "strip" }).pins, 6);
  // The siding's own signal can show a diverging route; the main's cannot.
  const labels = (name) => want.masts.find((m) => m.name === name).aspects.map((a) => a.label);
  assert.ok(labels("Signal 1 to A siding").includes("Diverging Clear"));
  assert.ok(!labels("Signal 1 to A main").includes("Diverging Clear"));
  assert.ok(labels("Signal 1 to B").includes("Diverging Approach"));
});

test("starting from a row keeps the ticks and the ends' pins, drops a hand-written description, and builds a board", () => {
  const config = M.myFirstBoardPreset();
  config.board.name = "passing-k7m4x2";
  config.board.nameSuffix = "k7m4x2";
  config.blocks = [];
  config.points = [];
  config.signals = { mode: "addressable", masts: [] };
  config.logic = { mode: "mss", mss: { advanceApproach: false, ends: [{ name: "A", tracks: 1, pairPin: "GPIO4" }, { name: "Z", tracks: 1 }], tracks: [{ from: { end: "A", track: 1 }, to: null, blocks: [] }] } };
  const sensorPins = ["GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO32"];
  const mastPins = ["GPIO16", "GPIO17", "GPIO19", "GPIO23", "GPIO18", "GPIO13"];
  R.use(config, R.PRESETS.passing, ({ sensors, turnouts, masts }) => {
    config.blocks.push(...sensors.map((name, i) => ({ name, topic: M.topicFor("block", name), topicCustom: false, gpio: sensorPins[i], inverted: true, debounce: "500ms" })));
    config.points.push(...turnouts.map((name, i) => ({ name, topic: M.topicFor("point", name), channel: i })));
    config.signals.masts.push(...masts.map((m, i) => ({ ...m, topic: M.topicFor("signal", m.name), topicCustom: false, pin: mastPins[i] })));
  }, { style: "strip" });
  same(Object.keys(config.logic.mss), ["row", "advanceApproach", "ends"]);
  same(config.logic.mss.ends, [{ name: "A", pairPin: "GPIO4" }]);
  same(B.problems(config), []);
  same(M.validateConfig(config).errors, []);
  const built = B.build(config);
  same(built.ends.map((e) => [e.name, e.tracks.length]), [["A", 1], ["B", 1]]);
  assert.equal(built.ends[0].pairPin, "GPIO4");
  // It generates, and reads back with the row it was made from.
  const yaml = M.generateYaml(config);
  same(M.parseConfigFromYaml(yaml).logic.mss.row, config.logic.mss.row);
  assert.match(yaml, /mr_logic:/);
  same(plain(L.logicTable(M.parseConfigFromYaml(yaml))), plain(L.logicTable(config)));
});

test("renaming a part renames it in the row", () => {
  const row = R.preset("passing");
  R.rename(row, "Signal 1 to B", "West Home");
  R.rename(row, "Block 1 current", "West current");
  same(row[0].names.signals.single, "West Home");
  same(row[0].names.left, ["West current"]);
});

test("removing a node: what is left must join; the first gone, the next takes the block it shared", () => {
  const passing = R.preset("passing");
  assert.equal(R.canRemove(passing, 0), true);
  assert.equal(R.canRemove(R.preset("cascade"), 0), false, "a module keeps one node");
  const three = R.addNode(R.preset("cascade"), { node: "complex" });
  const four = R.addNode(three, { node: "complex", turned: true });
  assert.equal(R.canRemove(four, 1), false, "the Cascade's one track would meet the turned Siding end's two");
  assert.equal(R.canRemove(four, 0), true);
  const rest = R.removeNode(passing, 0);
  same(rest, [{ node: "complex", turned: true, names: { ir: "IR 2", right: ["Block 3 current"], points: "Points 2",
    signals: { single: "Signal 2 to A", main: "Signal 2 to B main", siding: "Signal 2 to B siding" }, left: ["Block 2 current", "Siding 1 current"] } }]);
  same(R.removeNode(passing, 1), R.preset("complex"));
});

test("lines: a board goes on a line; a Complex cascade splits one, or flipped joins two; a line must be there", () => {
  const complex = R.preset("complex");
  assert.equal(R.fits([], 0, { node: "crossover" }), true);
  assert.equal(R.fits(complex, 1, { node: "cascade", line: 0 }), true, "on the main line");
  assert.equal(R.fits(complex, 1, { node: "cascade", line: 1 }), true, "on the diverging line");
  assert.equal(R.fits(complex, 1, { node: "crossover", line: 1 }), true);
  assert.equal(R.fits(complex, 1, { node: "cascade", line: 2 }), false, "no third line there");
  assert.equal(R.fits(complex, 1, { node: "complex", turned: true, line: 0 }), true, "joins the two");
  assert.equal(R.fits(complex, 1, { node: "complex", turned: true, line: 1 }), false, "no line above the diverging one");
  assert.equal(R.fits(complex, 1, { node: "complex", line: 1 }), true, "splits the diverging line again");
  same([0, 1, 2].map((at) => R.linesAt(R.preset("passing"), at)), [1, 2, 1]);
  same(R.linesAt([], 0), 1);
});

test("a row's own problems: empty, an unknown board, a board on a line that is not there", () => {
  same(R.problems([]).map((p) => p.text), [R.TEXT.empty]);
  same(R.problems([{ node: "wye" }]).map((p) => p.where), [{ node: 0 }]);
  same(R.problems([{ node: "cascade" }, { node: "cascade", line: 1 }]).map((p) => [p.text, p.where]), [[R.TEXT.noLine(2, 2), { node: 1 }]]);
  same(R.problems([{ node: "complex", turned: true, line: 1 }]).map((p) => p.where), [{ node: 0 }]);
  same(R.problems([{ node: "crossover" }, { node: "cascade" }, { node: "crossover" }]), [], "a Crossover anywhere on a line");
  same(R.problems(R.preset("passing")), []);
  // The builder reports them against the row, and nothing else.
  const config = M.myFirstBoardPreset();
  config.logic = { mode: "mss", mss: { row: [{ node: "cascade" }, { node: "cascade", line: 1 }] } };
  same(B.problems(config).map((p) => [p.level, p.where]), [["error", { view: "logic", part: B.PARTS.row, row: true, node: 1 }]]);
});

test("a Cascade on the loop of a passing siding: the loop is two blocks, with a signal each way between them", () => {
  const row = R.named([{ node: "complex" }, { node: "cascade", line: 1 }, { node: "complex", turned: true }]);
  same(row[1].names, { ir: "IR 2", right: ["Siding 2 current"], signals: { toA: "Signal 2 to A", toB: "Signal 2 to B" } });
  same(row[2].names.right, ["Block 3 current"]);
  const d = R.describe(row);
  same(d.ends.map((e) => e.tracks), [1, 1]);
  same(d.tracks.map((t) => [t.from, t.to, t.blocks.map((b) => b.sensors), t.boundaries.map((b) => [b.sensors, b.towardsFrom, b.towardsTo])]), [
    [{ end: "A", track: 1 }, { junction: "J1", leg: 1 }, [["Block 1 current"]], []],
    [{ junction: "J1", leg: 2 }, { junction: "J2", leg: 2 }, [["Block 2 current"]], []],
    [{ junction: "J1", leg: 3 }, { junction: "J2", leg: 3 }, [["Siding 1 current"], ["Siding 2 current"]], [[["IR 2"], "Signal 2 to A", "Signal 2 to B"]]],
    [{ junction: "J2", leg: 1 }, { end: "B", track: 1 }, [["Block 3 current"]], []],
  ]);
  same(d.junctions.map((j) => [j.name, j.node]), [["J1", 0], ["J2", 2]]);
});

test("a Crossover on a line adds its detector to the block it stands in", () => {
  const row = R.named([{ node: "complex" }, { node: "crossover" }, { node: "complex", turned: true }]);
  same(row[1].names, { block: "Block 3 current" });
  same(R.describe(row).tracks[1].blocks, [{ sensors: ["Block 2 current", "Block 3 current"], turnouts: [] }]);
  // On its own, a Crossover is a block from end to end.
  same(R.describe(R.preset("crossover")).tracks, [{ from: { end: "A", track: 1 }, to: { end: "B", track: 1 }, blocks: [{ sensors: ["Block 1 current"], turnouts: [] }], boundaries: [] }]);
});

test("a diverging line split again: three lines at end B, numbered from the top", () => {
  const row = R.named([{ node: "complex" }, { node: "complex", line: 1 }]);
  same(row[1].names.right, ["Siding 2 current", "Siding 3 current"]);
  const d = R.describe(row);
  same(d.ends.map((e) => e.tracks), [1, 3]);
  same(d.tracks.filter((t) => t.to?.end === "B").map((t) => [t.blocks[0].sensors[0], t.to.track]), [["Block 2 current", 3], ["Siding 2 current", 2], ["Siding 3 current", 1]]);
});

test("adding, inserting and moving on lines; the first board's blocks are handed on", () => {
  const complex = R.preset("complex");
  same(R.addNode(complex, { node: "complex", turned: true }), R.preset("passing"));
  same(R.insertNode(complex, 1, { node: "complex", turned: true }), R.preset("passing"));
  same(R.addNode(R.preset("cascade"), { node: "cascade" }), readMssCase("mss-row-cascades.json").module.mss.row);
  // Put first, a board takes the old first one's first block as the block it hands on.
  const two = R.insertNode(R.preset("cascade"), 0, { node: "cascade" });
  same(two[0].names.right, ["Block 1 current"]);
  assert.equal(two[1].names.left, undefined);
  same(R.describe(two).tracks[0].blocks.map((b) => b.sensors[0]), ["Block 3 current", "Block 1 current", "Block 2 current"]);
  // Moving the Cascade of a passing siding from the loop to the main line.
  const loop = R.named([{ node: "complex" }, { node: "cascade", line: 1 }, { node: "complex", turned: true }]);
  assert.equal(R.canMove(loop, 1, 1, 0), true);
  const onMain = R.moveNode(loop, 1, 1, 0);
  same(onMain.map((n) => [n.node, R.lineOf(n)]), [["complex", 0], ["cascade", 0], ["complex", 0]]);
  same(R.problems(onMain), []);
  assert.equal(R.canMove(loop, 1, 0, 1), false, "before the split there is no loop");
});

test("removing a board: what is left must have its lines; the first gone, the next takes the blocks it handed on", () => {
  const passing = R.preset("passing");
  assert.equal(R.canRemove(passing, 0), true);
  assert.equal(R.canRemove(R.preset("cascade"), 0), false, "a module keeps one board");
  const loop = R.named([{ node: "complex" }, { node: "cascade", line: 1 }, { node: "complex", turned: true }]);
  assert.equal(R.canRemove(loop, 0), false, "the Cascade on the loop would have no line");
  assert.equal(R.canRemove(loop, 1), true);
  same(R.removeNode(passing, 0), [{ node: "complex", turned: true, names: { ir: "IR 2", right: ["Block 3 current"], points: "Points 2",
    signals: { single: "Signal 2 to A", main: "Signal 2 to B main", siding: "Signal 2 to B siding" }, left: ["Block 2 current", "Siding 1 current"] } }]);
  same(R.removeNode(passing, 1), R.preset("complex"));
});

test("flipping a Complex cascade: a split joins, a join splits, where the lines are there; first in the module its blocks swap sides", () => {
  const { row, renames } = R.turnNode(R.preset("complex"), 0);
  same(renames, [["Signal 1 to B", "Signal 1 to A"], ["Signal 1 to A main", "Signal 1 to B main"], ["Signal 1 to A siding", "Signal 1 to B siding"]]);
  same(row[0].names.left, ["Block 2 current", "Siding 1 current"]);
  same(row[0].names.right, ["Block 1 current"]);
  assert.equal(row[0].turned, true);
  same(R.describe(row).ends.map((e) => e.tracks), [2, 1]);
  same(R.turnNode(row, 0).row, R.preset("complex"), "and back again");
  // A signal with a name of its own keeps it.
  const own = R.preset("complex");
  own[0].names.signals.single = "West Home";
  same(R.turnNode(own, 0).renames.map(([from]) => from), ["Signal 1 to A main", "Signal 1 to A siding"]);
  // The join of a passing siding can split instead: three lines at end B.
  assert.equal(R.canTurn(R.preset("passing"), 1), true);
  same(R.describe(R.turnNode(R.preset("passing"), 1).row).ends.map((e) => e.tracks), [1, 3]);
  // A split with no line above it to join cannot flip there.
  assert.equal(R.canTurn(R.named([{ node: "cascade" }, { node: "complex" }]), 1), false);
  assert.equal(R.canTurn(R.preset("cascade"), 0), false, "a Cascade is the same either way round");
});

test("a sensor, turnout or signal renamed on its page is renamed in the row", () => {
  const config = M.myFirstBoardPreset();
  config.logic = { mode: "mss", mss: { row: R.preset("passing") } };
  assert.equal(L.renameReferences(config, "sensor", "IR 2", "East IR"), 1);
  assert.equal(L.renameReferences(config, "turnout", "Points 1", "West points"), 1);
  assert.equal(L.renameReferences(config, "mast", "Signal 2 to A", "East Home"), 1);
  same([config.logic.mss.row[1].names.ir, config.logic.mss.row[0].names.points, config.logic.mss.row[1].names.signals.single], ["East IR", "West points", "East Home"]);
  assert.equal(L.renameReferences(config, "mast", "Block 1 current", "X"), 0, "a sensor's name is not a signal's");
});

test("columns: boards on different lines after a split stand side by side", () => {
  const plain = (value) => JSON.parse(JSON.stringify(value));
  // A Crossover, a split, then a Crossover on the loop and one on the main: the last two share a column.
  const row = R.named([{ node: "crossover" }, { node: "complex" }, { node: "crossover", line: 1 }, { node: "crossover" }]);
  assert.deepEqual(plain(R.columns(row)), { col: [0, 1, 2, 2], count: 3 });
  // A board waits for the last board on each of its lines: a join stands after both.
  const loop = R.named([{ node: "complex" }, { node: "crossover", line: 1 }, { node: "cascade", line: 1 }, { node: "crossover" }, { node: "complex", turned: true }]);
  assert.deepEqual(plain(R.columns(loop)), { col: [0, 1, 2, 1, 3], count: 4 });
  // On one line, one board after another.
  assert.deepEqual(plain(R.columns(R.preset("cascades"))).col, [0, 1]);
});

test("pack: the row in column order, the bottom line first in a column, the module the same", () => {
  const plain = (value) => JSON.parse(JSON.stringify(value));
  const loop = R.named([{ node: "complex" }, { node: "crossover", line: 1 }, { node: "cascade", line: 1 }, { node: "crossover" }, { node: "complex", turned: true }]);
  const packed = plain(R.pack(loop));
  assert.deepEqual(packed.map((n) => [n.node, n.line ?? 0, n.names.block || n.names.ir]), [
    ["complex", 0, "IR 1"], ["crossover", 0, "Block 3 current"], ["crossover", 1, "Siding 2 current"], ["cascade", 1, "IR 2"], ["complex", 0, "IR 3"],
  ]);
  // The same module: every line keeps its boards in order.
  assert.deepEqual(plain(R.describe(packed)), plain(R.describe(loop)));
  assert.deepEqual(plain(R.pack(packed)), packed, "packing again changes nothing");
  // Whichever was dropped first, side by side they come bottom line first.
  const other = R.named([{ node: "complex" }, { node: "crossover" }, { node: "crossover", line: 1 }]);
  const swapped = R.named([{ node: "complex" }, { node: "crossover", line: 1 }, { node: "crossover" }]);
  assert.deepEqual(plain(R.pack(swapped)).map((n) => [n.node, n.line ?? 0]), plain(R.pack(other)).map((n) => [n.node, n.line ?? 0]));
  // A row with a problem comes back as it is.
  const bad = [{ node: "crossover", line: 3 }];
  assert.deepEqual(plain(R.pack(bad)), bad);
});

test("pack never changes the module: random rows", () => {
  let seed = 11;
  const rnd = (n) => { seed = (seed * 48271) % 2147483647; return seed % n; };
  // The same module, up to how its junctions are numbered and where each board is in the row.
  const canon = (d) => {
    const ir = new Map(d.junctions.map((j) => [j.name, j.sensors[0]]));
    const c = JSON.parse(JSON.stringify(d, (k, v) => (k === "node" ? undefined : k === "junction" ? ir.get(v) : k === "name" && ir.has(v) ? ir.get(v) : v)));
    return JSON.stringify([c.ends, c.tracks.map((t) => JSON.stringify(t)).sort(), c.junctions.map((j) => JSON.stringify(j)).sort()]);
  };
  let moved = 0;
  for (let t = 0; t < 1500; t += 1) {
    let row = [];
    for (let k = 0; k < 2 + rnd(7); k += 1) {
      const at = rnd(row.length + 1);
      const lanes = R.walk(row.slice(0, at)).right.length;
      const join = rnd(4) === 0;
      const node = join ? { node: "complex", turned: true, line: rnd(Math.max(1, lanes - 1)) } : { node: ["crossover", "cascade", "complex"][rnd(3)], line: rnd(lanes) };
      if (R.fits(row, at, node)) row = R.insertNode(row, at, node);
    }
    if (!row.length || R.problems(row).length) continue;
    const packed = R.pack(row);
    if (JSON.stringify(packed) !== JSON.stringify(row)) moved += 1;
    assert.deepEqual(R.problems(packed).length, 0);
    assert.equal(canon(R.describe(packed)), canon(R.describe(row)), JSON.stringify(row));
  }
  assert.ok(moved > 20, `only ${moved} rows were reordered`);
});

if (!process.exitCode) console.log("\nAll MSS row tests passed.");
