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

test("nodes join where their sides have the same number of tracks; a Crossover only on its own", () => {
  const siding = { node: "siding" };
  const turned = { node: "siding", turned: true };
  const cascade = { node: "cascade" };
  same(R.sidesOf(siding), [1, 2]);
  same(R.sidesOf(turned), [2, 1]);
  assert.equal(R.fits([], 0, { node: "crossover" }), true);
  assert.equal(R.fits([cascade], 1, { node: "crossover" }), false);
  assert.equal(R.fits([{ node: "crossover" }], 1, cascade), false);
  assert.equal(R.fits([cascade], 1, siding), true);
  assert.equal(R.fits([siding], 1, cascade), false, "two tracks meet one");
  assert.equal(R.fits([siding], 1, turned), true);
  assert.equal(R.fits([siding, turned], 1, cascade), false);
  assert.equal(R.fits([cascade, turned], 1, siding), true, "between: 1 meets 1, 2 meets 2");
});

test("a row's own problems: empty, an unknown node, a Crossover with others, sides that do not meet", () => {
  same(R.problems([]).map((p) => p.text), [R.TEXT.empty]);
  same(R.problems([{ node: "wye" }]).map((p) => p.where), [{ node: 0 }]);
  same(R.problems([{ node: "crossover" }, { node: "cascade" }]).map((p) => p.text), [R.TEXT.crossoverAlone]);
  same(R.problems([{ node: "siding" }, { node: "cascade" }]).map((p) => [p.text, p.where]), [[R.TEXT.sides(1, 2, 1), { node: 1 }]]);
  same(R.problems(R.preset("passing")), []);
  // The builder reports them against the row, and nothing else.
  const config = M.myFirstBoardPreset();
  config.logic = { mode: "mss", mss: { row: [{ node: "siding" }, { node: "cascade" }] } };
  same(B.problems(config).map((p) => [p.level, p.where]), [["error", { view: "logic", part: B.PARTS.row, row: true, node: 1 }]]);
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
  const lone = R.describe(R.preset("siding"));
  same(lone.ends, [{ name: "A", tracks: 1 }, { name: "B", tracks: 2 }]);
  same(lone.tracks.slice(1).map((t) => [t.blocks[0].sensors[0], t.to]), [["Block 2 current", { end: "B", track: 2 }], ["Siding 1 current", { end: "B", track: 1 }]]);
  const turned = R.describe(R.named([{ node: "siding", turned: true }]));
  same(turned.ends.map((e) => e.tracks), [2, 1]);
  same(turned.tracks.slice(0, 2).map((t) => [t.blocks[0].sensors[0], t.from]), [["Block 1 current", { end: "A", track: 1 }], ["Siding 1 current", { end: "A", track: 2 }]]);
  // A lone Siding end meets a lone Siding end turned round: main to main (2 meets 2 + 1 - 2 = 1).
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

test("adding a Siding end turned round to a Siding end makes the Passing siding, names and all", () => {
  const siding = R.preset("siding");
  assert.equal(R.canAdd(siding, { node: "cascade" }), false, "two tracks meet one");
  assert.equal(R.canAdd(siding, { node: "siding", turned: true }), true);
  same(R.addNode(siding, { node: "siding", turned: true }), R.preset("passing"));
  // Cascade on Cascade: the new node's left block is the old one's right block.
  same(R.addNode(R.preset("cascade"), { node: "cascade" }), readMssCase("mss-row-cascades.json").module.mss.row);
  assert.equal(R.canAdd(R.preset("crossover"), { node: "cascade" }), false);
});

test("removing a node: what is left must join; the first gone, the next takes the block it shared", () => {
  const passing = R.preset("passing");
  assert.equal(R.canRemove(passing, 0), true);
  assert.equal(R.canRemove(R.preset("cascade"), 0), false, "a module keeps one node");
  const three = R.addNode(R.preset("cascade"), { node: "siding" });
  const four = R.addNode(three, { node: "siding", turned: true });
  assert.equal(R.canRemove(four, 1), false, "the Cascade's one track would meet the turned Siding end's two");
  assert.equal(R.canRemove(four, 0), true);
  const rest = R.removeNode(passing, 0);
  same(rest, [{ node: "siding", turned: true, names: { ir: "IR 2", right: ["Block 3 current"], points: "Points 2",
    signals: { single: "Signal 2 to A", main: "Signal 2 to B main", siding: "Signal 2 to B siding" }, left: ["Block 2 current", "Siding 1 current"] } }]);
  same(R.removeNode(passing, 1), R.preset("siding"));
});

test("turning a Siding end round swaps its sides and renames the signals named as the pattern names them", () => {
  const { row, renames } = R.turnNode(R.preset("siding"), 0);
  same(renames, [["Signal 1 to B", "Signal 1 to A"], ["Signal 1 to A main", "Signal 1 to B main"], ["Signal 1 to A siding", "Signal 1 to B siding"]]);
  same(row[0].names.left, ["Block 2 current", "Siding 1 current"]);
  same(row[0].names.right, ["Block 1 current"]);
  assert.equal(row[0].turned, true);
  same(R.describe(row).ends.map((e) => e.tracks), [2, 1]);
  // And back again, as it was.
  same(R.turnNode(row, 0).row, R.preset("siding"));
  // A signal with a name of its own keeps it.
  const own = R.preset("siding");
  own[0].names.signals.single = "West Home";
  same(R.turnNode(own, 0).renames.map(([from]) => from), ["Signal 1 to A main", "Signal 1 to A siding"]);
  // Only where it still joins: not the turned end of a passing siding.
  assert.equal(R.canTurn(R.preset("passing"), 1), false);
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

if (!process.exitCode) console.log("\nAll MSS row tests passed.");
