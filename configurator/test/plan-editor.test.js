// The track plan's grid editor (docs/field-logic-plan-spec.md; work item TP 3).
// Each drawing in test/cases/plan is made again from an empty page with the
// editor's own changes, and must build the same as the hand-written one. Then
// the editing rules, a block's Timing, the picture's layout and picking.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

const context = loadModules("generator.js", "logic-yaml.js", "logic.js", "logic-checker.js", "logic-try.js", "logic-ui.js", "logic-starters.js", "logic-starters-sections.js", "logic-starters-signals.js", "mss-builder.js", "plan-builder.js", "plan-edit.js", "logic-ui-plan.js");
const { myFirstBoardPreset, topicFor } = context.EsphomeMr;
const { EsphomeMrPlanEdit: E, EsphomeMrPlanBuilder: B, EsphomeMrLogicUiPlan: P } = context;

const plain = (value) => JSON.parse(JSON.stringify(value));
const readCase = (name) => JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "cases", "plan", `${name}.json`), "utf8"));
const NAMES = ["gauntlet", "junction", "passing-siding", "diamond", "scissors", "merge"];

const CATS = ["R292", "R285", "ADV_NORM", "R281", "R282", "R283", "R286"];

// A board with a case's sensors, turnouts and signals, and nothing drawn.
function boardFor(data) {
  const config = myFirstBoardPreset();
  config.blocks = (data.module.sensors || []).map((name) => ({ name, topic: topicFor("block", name) }));
  config.points = (data.module.turnouts || []).map((name) => ({ name }));
  config.signals = { masts: (data.module.masts || []).map((name) => ({ name, aspects: CATS.map((label) => ({ label })) })) };
  config.logic = { mode: "field" };
  return config;
}

// Draw a case's plan the way a person would: track, turnouts, breaks and
// signals, blocks with their Timing, arrows and ends.
function redraw(data) {
  const wanted = data.module.plan;
  const config = boardFor(data);
  for (const [a, b] of wanted.track) assert.ok(E.draw(config, a, b));
  for (const point of wanted.points || []) {
    const { at, ...values } = point;
    E.setPoint(config, at, values);
  }
  for (const brk of wanted.breaks || []) {
    assert.ok(E.addBreak(config, brk.at), `break at ${brk.at}`);
    for (const signal of brk.signals || []) E.setSignal(config, brk.at, signal.facing, signal.mast);
    if (brk.sensors?.length) E.setBreakSensors(config, brk.at, brk.sensors);
  }
  const unit = ([a, b]) => [a, [a[0] + Math.sign(b[0] - a[0]), a[1] + Math.sign(b[1] - a[1])]];
  for (const block of wanted.blocks || []) {
    const [a, b] = unit(block.at);
    const { at, ...values } = block;
    E.setBlock(config, a, b, values);
  }
  for (const arrow of wanted.arrows || []) {
    const [a, b] = unit([arrow.from, arrow.to]);
    E.setDirection(config, a, b, b);
  }
  for (const end of wanted.ends || []) E.setEnd(config, end.at, end.beyond);
  return config;
}

// What was built, in an order that does not depend on the order of drawing.
function builtOf(config) {
  const items = plain(B.build(config));
  const sorted = (list) => list.map((item) => JSON.stringify(item)).sort();
  return {
    blocks: sorted(items.blocks),
    masts: sorted(items.masts),
    resources: sorted(items.resources),
    layers: sorted(items.layers.map((layer) => ({ ...layer, rules: sorted(layer.rules) }))),
    pairs: sorted(items.pairs),
    problems: B.problems(config).map((p) => `${p.level}: ${p.text}`).sort(),
  };
}

for (const name of NAMES) {
  test(`${name}: drawn from an empty page, it builds as the hand-written plan does`, () => {
    const data = readCase(name);
    const written = boardFor(data);
    written.logic.plan = plain(data.module.plan);
    assert.deepEqual(builtOf(redraw(data)), builtOf(written));
  });
}

const empty = () => boardFor({ module: { sensors: ["S1", "S2"], turnouts: ["P1"], masts: ["Home", "Away"] } });
const plan = (config) => plain(config.logic.plan ?? null);
const line = () => { const config = empty(); E.draw(config, [0, 0], [6, 0]); return config; };

test("track drawn in pieces is kept as one straight line, and drawing over it adds nothing", () => {
  const config = empty();
  E.draw(config, [0, 0], [2, 0]);
  E.draw(config, [4, 0], [2, 0]);
  E.draw(config, [1, 0], [3, 0]);
  assert.deepEqual(plan(config).track, [[[0, 0], [4, 0]]]);
  assert.equal(E.draw(config, [1, 1], [1, 1]), false);
});

test("a drag that is not straight bends at 45 degrees: from track first on the slant, onto track last", () => {
  const config = line();
  assert.deepEqual(plain(E.path(config, [2, 0], [5, 1])), [[2, 0], [3, 1], [5, 1]]);
  // Onto track: straight first, then the slant into it.
  assert.deepEqual(plain(E.path(config, [10, 2], [6, 0])), [[10, 2], [8, 2], [6, 0]]);
});

test("erasing takes the pieces away, and an empty drawing is not kept", () => {
  const config = line();
  assert.ok(E.erase(config, [2, 0], [3, 0]));
  assert.deepEqual(plan(config).track, [[[0, 0], [2, 0]], [[3, 0], [6, 0]]]);
  assert.equal(E.erase(config, [2, 0], [3, 0]), false);
  E.erase(config, [0, 0], [2, 0]);
  E.erase(config, [3, 0], [6, 0]);
  assert.equal(config.logic.plan, undefined);
});

test("a block stays with the track that is left, and goes with the last of it", () => {
  const config = line();
  E.setBlock(config, [0, 0], [1, 0], { name: "Main", sensors: ["S1"] });
  E.erase(config, [0, 0], [1, 0]);
  assert.equal(E.blockAt(config, [3, 0], [4, 0]).name, "Main");
  E.draw(config, [0, 3], [2, 3]);
  E.erase(config, [1, 0], [6, 0]);
  assert.deepEqual(plan(config).blocks, []);
});

test("a block break splits a block; taking it away joins the two and their sensors, keeping the first one's Timing", () => {
  const config = line();
  E.setSignal(config, [3, 0], [4, 0], "Home");
  assert.equal(plan(config).breaks.length, 1);
  E.setBlock(config, [0, 0], [1, 0], { name: "West", sensors: ["S1"], release: "5s" });
  E.setBlock(config, [5, 0], [6, 0], { name: "East", sensors: ["S2", "S1"], approachLock: "10s" });
  E.removeBreak(config, [3, 0]);
  assert.deepEqual(plan(config).breaks, []);
  assert.deepEqual(plan(config).blocks.map((b) => [b.name, b.sensors, b.release, b.approachLock]), [["West", ["S1", "S2"], "5s", undefined]]);
});

test("a break goes only on plain track, and is dropped when its track ends there", () => {
  const config = line();
  assert.equal(E.addBreak(config, [0, 0]), null);
  assert.equal(E.addBreak(config, [3, 3]), null);
  E.addBreak(config, [3, 0]);
  E.erase(config, [3, 0], [4, 0]);
  assert.deepEqual(plan(config).breaks, []);
});

test("changing a signal drops the old one's aspects; choosing none removes it", () => {
  const config = line();
  E.setSignal(config, [3, 0], [4, 0], "Home");
  config.logic.plan.breaks[0].signals[0].aspects = { clear: "R281" };
  E.setSignal(config, [3, 0], [4, 0], "Home");
  assert.deepEqual(plan(config).breaks[0].signals[0].aspects, { clear: "R281" });
  E.setSignal(config, [3, 0], [4, 0], "Away");
  assert.deepEqual(plan(config).breaks[0].signals, [{ mast: "Away", facing: [4, 0] }]);
  E.setSignal(config, [3, 0], [4, 0], "");
  assert.deepEqual(plan(config).breaks[0].signals, []);
});

test("one way applies to the whole stretch, replaces what was there, and survives erasing part of it", () => {
  const config = line();
  E.setDirection(config, [0, 0], [1, 0], [1, 0]);
  assert.deepEqual(plain(E.directionAt(config, [4, 0], [5, 0])), [5, 0]);
  E.setDirection(config, [4, 0], [5, 0], [4, 0]);
  assert.equal(plan(config).arrows.length, 1);
  E.erase(config, [4, 0], [5, 0]);
  assert.deepEqual(plain(E.directionAt(config, [0, 0], [1, 0])), [0, 0]);
  E.setDirection(config, [0, 0], [1, 0], null);
  assert.deepEqual(plan(config).arrows, []);
});

test("point and end settings go when the point stops being one", () => {
  const config = line();
  E.draw(config, [3, 0], [5, 2]);
  E.setPoint(config, [3, 0], { turnout: "P1" });
  E.setEnd(config, [6, 0], "plain");
  E.erase(config, [3, 0], [5, 2]);
  assert.deepEqual(plan(config).points, []);
  E.draw(config, [6, 0], [7, 0]);
  assert.deepEqual(plan(config).ends, []);
});

test("a block keeps its name, and its Timing is stored only when it is not the usual", () => {
  const config = line();
  E.setBlock(config, [0, 0], [1, 0], { name: "Main", sensors: ["S1"] });
  E.setBlock(config, [0, 0], [1, 0], { name: "Up" });
  E.setBlock(config, [0, 0], [1, 0], { name: "" });
  assert.equal(plan(config).blocks[0].name, "Up");
  E.setBlock(config, [0, 0], [1, 0], { release: "5s", approachLock: "10s" });
  assert.deepEqual(plan(config).blocks[0], { name: "Up", at: [[0, 0], [1, 0]], sensors: ["S1"], release: "5s", approachLock: "10s" });
  E.setBlock(config, [0, 0], [1, 0], { release: "", approachLock: "" });
  assert.deepEqual(plan(config).blocks[0], { name: "Up", at: [[0, 0], [1, 0]], sensors: ["S1"] });
});

test("a plan saved with one-train sections loses them on the next change", () => {
  const config = line();
  config.logic.plan.sections = [{ name: "Sec", blocks: ["Main"] }];
  E.setBlock(config, [0, 0], [1, 0], { name: "Main", sensors: ["S1"] });
  assert.equal(plan(config).sections, undefined);
});

test("a new block's name is one nothing else uses", () => {
  const config = line();
  config.blocks.push({ name: "Track 1" });
  assert.equal(E.freeBlockName(config, (n) => `Track ${n}`), "Track 2");
});

test("a block shared by signals that clash says what protects it", () => {
  assert.deepEqual(plain(B.look(redraw(readCase("gauntlet"))).protects), [{ block: "Bridge", masts: ["Left Bridge", "Right Bridge"] }]);
  assert.deepEqual(plain(B.look(redraw(readCase("junction"))).protects), []);
  const loop = plain(B.look(redraw(readCase("passing-siding"))).protects);
  assert.deepEqual(loop.find((p) => p.block === "Main loop").masts, ["West Home", "East Home"]);
});

test("a crossover drawn on the page moves together, and the turnout's panel can change it", () => {
  const config = redraw(readCase("scissors"));
  assert.deepEqual(plain(B.build(config).pairs), [{ turnout: "P1", with: "P4", same: true }, { turnout: "P3", with: "P2", same: true }]);
  E.setPoint(config, [5, 0], { pairedWith: "" });
  assert.deepEqual(plain(B.build(config).pairs), [{ turnout: "P3", with: "P2", same: true }]);
  // Choosing no turnout there takes the choice away with it.
  E.setPoint(config, [5, 0], { turnout: null });
  assert.equal(plan(config).points.find((p) => p.at[0] === 5 && p.at[1] === 0).pairedWith, undefined);
});

test("the picture: detected track, a signal on the train's left, and what picking finds", () => {
  const config = redraw(readCase("gauntlet"));
  const shape = plain(P.layout(config));
  assert.ok(shape.view.x <= -1 && shape.view.y <= -2);
  const piece = (a, b) => shape.pieces.find((p) => String([p.a, p.b].sort()) === String([a, b].sort()));
  assert.equal(piece([0, 0], [1, 0]).detected, true);
  assert.equal(piece([10, 0], [11, 0]).detected, false);
  assert.equal(piece([5, 1], [6, 1]).block, "Bridge");
  const [left, right] = ["Left Bridge", "Right Bridge"].map((mast) => shape.signals.find((s) => s.mast === mast));
  assert.ok(left.head[1] < left.at[1]);
  assert.ok(right.head[1] > right.at[1]);
  // Right Bridge sits under the Right block, so that name goes above the track.
  assert.deepEqual(shape.blocks.map((b) => [b.name, b.above]), [["Left", false], ["Bridge", false], ["Right", true]]);
  assert.deepEqual(plain(P.pick(shape, ...left.head)), { kind: "point", at: [2, 0] });
  assert.deepEqual(plain(P.pick(shape, 4.1, 1.05)), { kind: "point", at: [4, 1] });
  assert.equal(P.pick(shape, 5.5, 1.2).kind, "piece");
  assert.equal(P.pick(shape, 5.5, 4), null);
});

test("a point with no turnout chosen is marked", () => {
  const config = line();
  E.draw(config, [3, 0], [5, 2]);
  assert.equal(P.layout(config).points[0].unset, true);
  E.setPoint(config, [3, 0], { turnout: null });
  assert.equal(P.layout(config).points[0].unset, false);
});

if (!process.exitCode) console.log("\nAll track plan editor tests passed.");
