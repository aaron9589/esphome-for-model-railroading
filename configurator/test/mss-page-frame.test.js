// The MSS Logic page's frame (docs/mss-patterns-spec.md, The page; work item
// MP 2): the steps, what each asks for and what comes next, the module's
// picture for a row of nodes, a module described by hand, and the old cards
// no longer on the page. Pure, without a DOM; the page itself is driven in
// Chromium by test/browser/mss-page.mjs.
import assert from "node:assert/strict";
import { loadModules, test } from "./harness.js";
import { LOGIC_UI_FILES } from "./logic-page.test.js";
import { mssBoard, readMssCase } from "./mss-cases.js";

const ctx = loadModules(...LOGIC_UI_FILES);
const { EsphomeMr: M, EsphomeMrLogicUiMss: F, EsphomeMrLogicUiMssRow: P, EsphomeMrMssRow: R, EsphomeMrLogicUi: Ui } = ctx;
const plain = (value) => JSON.parse(JSON.stringify(value));
const steps = (config) => Object.fromEntries(plain(F.stepsOf(config)).map((s) => [s.id, s]));

function emptyBoard() {
  const config = M.myFirstBoardPreset();
  config.board.name = "module-k7m4x2";
  config.blocks = [];
  config.points = [];
  config.signals = { mode: "addressable", masts: [] };
  config.logic = { mode: "mss", mss: {} };
  return config;
}

test("an empty MSS page has one thing to do: pick your module", () => {
  const config = emptyBoard();
  const s = steps(config);
  assert.deepEqual(Object.keys(s), ["pick", "wire", "signals", "try", "download", "pair"]);
  assert.deepEqual(Object.values(s).filter((step) => step.open).map((step) => step.id), ["pick"]);
  assert.equal(F.currentStep(config), "pick");
  const g = plain(F.guidance(config, "pick"));
  assert.equal(g.doing, F.TEXT.doing.pickEmpty);
  assert.equal(g.ready, false);
  assert.equal(g.waiting, F.TEXT.stillToDo);
});

test("a module picked opens every step; wiring and signals are done once their parts are on their pages", () => {
  const config = emptyBoard();
  R.use(config, R.PRESETS.passing, ({ sensors, turnouts, masts }) => {
    config.blocks.push(...sensors.map((name, i) => ({ name, topic: M.topicFor("block", name), topicCustom: false, gpio: ["GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO32"][i], inverted: true, debounce: "500ms" })));
    config.points.push(...turnouts.map((name, i) => ({ name, topic: M.topicFor("point", name), channel: i })));
  }, { style: "strip" });
  let s = steps(config);
  assert.ok(Object.values(s).every((step) => step.open));
  assert.equal(s.pick.done, true);
  assert.equal(s.wire.done, true);
  assert.equal(s.signals.done, false, "no signals on the Signal Masts page yet");
  assert.equal(s.signals.errors > 0, true, "each missing signal is a Signals problem");
  assert.equal(s.wire.errors, 0);
  assert.equal(F.currentStep(config), "signals");
  // The parts each step lights on the picture.
  assert.deepEqual([...F.litFor(config, "wire")], ["Block 1 current", "Block 2 current", "Siding 1 current", "Block 3 current", "IR 1", "IR 2", "Points 1", "Points 2"]);
  assert.deepEqual([...F.litFor(config, "signals")].length, 6);
  // A sensor taken off its page: Wire it is not done, and says why.
  config.blocks = config.blocks.filter((b) => b.name !== "IR 2");
  s = steps(config);
  assert.equal(s.wire.done, false);
  assert.ok(s.wire.errors > 0);
  assert.equal(plain(F.partsOf(config)).find((p) => p.name === "IR 2").there, false);
});

test("Wire it: every block, then IR sensors, points and the ends' pins; a missing or shared pin is a problem", () => {
  const config = emptyBoard();
  const pins = ["GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO32"];
  R.use(config, R.PRESETS.passing, ({ sensors, turnouts }) => {
    config.blocks.push(...sensors.map((name, i) => ({ name, topic: M.topicFor("block", name), topicCustom: false, gpio: pins[i], inverted: true, debounce: "500ms" })));
    config.points.push(...turnouts.map((name, i) => ({ name, topic: M.topicFor("point", name), pcaBoard: 0, channel: i })));
  });
  const wire = () => plain(F.wireList(config));
  assert.deepEqual(wire().map((w) => [w.key, w.role]), [
    ["Block 1 current", "block"], ["Block 2 current", "block"], ["Siding 1 current", "block"], ["Block 3 current", "block"],
    ["IR 1", "ir"], ["IR 2", "ir"], ["Points 1", "points"], ["Points 2", "points"],
    ["end:A:pair", "pair"], ["end:A:led", "led"], ["end:B:pair", "pair"], ["end:B:led", "led"],
  ]);
  assert.ok(wire().every((w) => w.done), "every sensor on its pin, the points on channels, no end pins (optional)");
  assert.deepEqual(wire().find((w) => w.key === "Points 2").place, { board: 0, channel: 1 });
  assert.equal(steps(config).wire.done, true);
  // A pin taken twice, and one missing.
  config.logic.mss.ends = [{ name: "A", pairPin: "GPIO27" }];
  config.blocks.find((b) => b.name === "Block 3 current").gpio = "";
  const now = Object.fromEntries(wire().map((w) => [w.key, w.problem]));
  assert.equal(now["Block 2 current"], "shared");
  assert.equal(now["end:A:pair"], "shared");
  assert.equal(now["Block 3 current"], "missing");
  assert.equal(steps(config).wire.done, false);
  // Without a PCA9685, the points are on ESP pins.
  config.pca9685 = false;
  assert.deepEqual(wire().find((w) => w.key === "Points 1"), { key: "Points 1", name: "Points 1", role: "points", kind: "turnout", pin: "", place: null, done: false, problem: "missing" });
});

test("Signals: each signal with its lamps' pins; what it shows follows the two ticks", () => {
  const config = emptyBoard();
  const pins = ["GPIO14", "GPIO27", "GPIO26", "GPIO16", "GPIO17"];
  let k = 0;
  R.use(config, R.PRESETS.cascade, ({ sensors, masts }) => {
    config.blocks.push(...sensors.map((name) => ({ name, gpio: pins[k++] })));
    config.signals.masts.push(...masts.map((m) => ({ ...m, pin: pins[k++] })));
  }, { style: "strip" });
  assert.deepEqual(plain(F.signalList(config)).map((x) => [x.name, x.style, x.pins.map((p) => p.pin), x.done]), [
    ["Signal 1 to A", "strip", ["GPIO16"], true], ["Signal 1 to B", "strip", ["GPIO17"], true],
  ]);
  assert.equal(steps(config).signals.done, true);
  config.signals.masts[1].pin = "GPIO16";
  assert.deepEqual(plain(F.signalList(config)).map((x) => x.problem), ["shared", "shared"]);
  assert.equal(steps(config).signals.done, false);
  const keys = () => plain(F.indicationsFor(config, "twoHeads")).map((x) => x.key);
  assert.deepEqual(keys(), ["stop", "approach", "clear", "divergingClear", "divergingApproach"]);
  config.logic.mss.advanceApproach = true;
  config.logic.mss.approachDiverging = true;
  assert.deepEqual(keys(), ["stop", "approach", "advance", "clear", "approachDiverging", "divergingClear", "divergingApproach"]);
  // Upper head first: Advance Approach is flashing yellow over red; Approach Diverging yellow over yellow.
  const two = Object.fromEntries(plain(F.indicationsFor(config, "twoHeads")).map((x) => [x.key, x.heads]));
  assert.deepEqual(two.advance, [{ color: "amber", blink: true }, { color: "red", blink: false }]);
  assert.deepEqual(two.approachDiverging, [{ color: "amber", blink: false }, { color: "amber", blink: false }]);
  assert.deepEqual(plain(F.indicationsFor(config, "plain")).find((x) => x.key === "approachDiverging").heads, [{ color: "amber", blink: true }]);
});

test("a row's own problem counts on Pick your module, and closes the steps after it", () => {
  const config = emptyBoard();
  config.logic.mss.row = [{ node: "siding" }, { node: "cascade" }];
  const s = steps(config);
  assert.equal(s.pick.errors, 1);
  assert.equal(s.pick.done, false);
  assert.equal(s.wire.open, false);
});

test("a module described by hand still builds, and offers to start from a pattern", () => {
  const data = readMssCase("mss-junction-turnout.json");
  const config = mssBoard(ctx, "hand", data.module);
  assert.equal(F.handWritten(config), true);
  assert.equal(F.currentStep(config), "pick");
  assert.equal(steps(config).wire.open, false);
  assert.ok(ctx.EsphomeMrMssBuilder.build(config).blocks.length > 0, "it is still built");
  config.logic.mss = { row: R.preset("cascade") };
  assert.equal(F.handWritten(config), false);
  // A row started again keeps its ends' pins: that is not a module described by hand.
  config.logic.mss = { ends: [{ name: "A", pairPin: "GPIO4" }] };
  assert.equal(F.handWritten(config), false);
  assert.equal(F.currentStep(config), "pick");
});

test("the picture of a passing siding: the main along the bottom, the siding above, each part named", () => {
  const shape = plain(P.layout(R.preset("passing")));
  assert.equal(shape.rows, 2);
  assert.equal(shape.width, 2 * P.W);
  assert.deepEqual(shape.blocks.map((b) => [b.name, b.road, b.path]), [
    ["Block 1 current", "main", [[0, 1], [3, 1]]],
    ["Block 2 current", "main", [[3, 1], [9, 1]]],
    ["Siding 1 current", "siding", [[3, 1], [4, 0], [8, 0], [9, 1]]],
    ["Block 3 current", "main", [[9, 1], [12, 1]]],
  ]);
  assert.deepEqual(shape.irs.map((x) => [x.name, x.at]), [["IR 1", [3, 1]], ["IR 2", [9, 1]]]);
  assert.deepEqual(shape.points.map((x) => [x.name, x.at]), [["Points 1", [3, 1]], ["Points 2", [9, 1]]]);
  // Each signal on the right of the trains it faces, just before the points they head for.
  assert.deepEqual(shape.signals.map((x) => [x.name, x.at, x.facing, x.side, x.heads]), [
    ["Signal 1 to B", [2.25, 1], "right", "below", 2],
    ["Signal 1 to A main", [4.75, 1], "left", "above", 1],
    ["Signal 1 to A siding", [4.75, 0], "left", "above", 1],
    ["Signal 2 to A", [9.75, 1], "left", "above", 2],
    ["Signal 2 to B main", [7.25, 1], "right", "below", 1],
    ["Signal 2 to B siding", [7.25, 0], "right", "below", 1],
  ]);
  assert.deepEqual(shape.ends.map((e) => [e.name, e.at, e.roads]), [["A", [0, 1], 1], ["B", [12, 1], 1]]);
});

test("the picture of a Cascade is one line; a lone Siding end runs both roads to end B; a row with problems has none", () => {
  const cascade = plain(P.layout(R.preset("cascade")));
  assert.equal(cascade.rows, 1);
  assert.deepEqual(cascade.blocks.map((b) => b.path), [[[0, 1], [3, 1]], [[3, 1], [6, 1]]]);
  assert.deepEqual(cascade.signals.map((x) => [x.name, x.at, x.side]), [["Signal 1 to B", [2.25, 1], "below"], ["Signal 1 to A", [3.75, 1], "above"]]);
  const lone = plain(P.layout(R.preset("siding")));
  assert.deepEqual(lone.ends.map((e) => e.roads), [1, 2]);
  assert.deepEqual(lone.blocks.find((b) => b.road === "siding").path, [[3, 1], [4, 0], [6, 0]]);
  assert.equal(P.layout([{ node: "siding" }, { node: "cascade" }]), null);
  assert.equal(P.layout([]), null);
});

test("the old MSS cards are off the page: the frame, Try it and the views are what MSS Logic shows", () => {
  const ids = Ui.allText().map(([id]) => id);
  assert.ok(ids.includes(F.PART));
  for (const old of ["logic-mss-steps", "logic-mss-ends", "logic-mss-tracks", "logic-mss-junctions", "logic-mss-signals", "logic-mss-module"]) assert.ok(!ids.includes(old), old);
  assert.ok(!("EsphomeMrLogicUiMssSteps" in ctx));
});

if (!process.exitCode) console.log("\nAll MSS page frame tests passed.");
