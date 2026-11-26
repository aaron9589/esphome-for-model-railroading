// The track plan's grid editor (docs/field-logic-plan-spec.md; work item TP 3).
// Each drawing in test/cases/plan is made again from an empty page with the
// editor's own changes, and must build the same as the hand-written one. Then
// the editing rules, one train at a time, the picture's layout and picking.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

const context = loadModules("generator.js", "logic-yaml.js", "logic.js", "logic-checker.js", "logic-try.js", "logic-ui.js", "logic-starters.js", "logic-starters-sections.js", "logic-starters-signals.js", "mss-builder.js", "plan-builder.js", "plan-edit.js", "logic-ui-plan.js");
const { myFirstBoardPreset, topicFor } = context.EsphomeMr;
const { EsphomeMrPlanEdit: E, EsphomeMrPlanBuilder: B, EsphomeMrLogicUiPlan: P } = context;

const plain = (value) => JSON.parse(JSON.stringify(value));
const readCase = (name) => JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "cases", "plan", `${name}.json`), "utf8"));
const NAMES = ["gauntlet", "junction", "passing-siding", "diamond"];

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
// signals, blocks, arrows, ends, then one train at a time.
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
    E.setBlock(config, a, b, { name: block.name, sensors: block.sensors });
  }
  for (const arrow of wanted.arrows || []) {
    const [a, b] = unit([arrow.from, arrow.to]);
    E.setDirection(config, a, b, b);
  }
  for (const end of wanted.ends || []) E.setEnd(config, end.at, end.beyond);
  for (const section of wanted.sections || []) {
    const name = E.addSection(config, section.blocks, (block) => `${block} section`);
    E.setSection(config, name, { ...section });
  }
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
  config.logic.plan.sections = [{ name: "Sec", blocks: ["Main"] }];
  E.draw(config, [0, 3], [2, 3]);
  E.erase(config, [1, 0], [6, 0]);
  assert.deepEqual(plan(config).blocks, []);
  assert.deepEqual(plan(config).sections, []);
});

test("a block break splits a block; taking it away joins the two and their sensors", () => {
  const config = line();
  E.setSignal(config, [3, 0], [4, 0], "Home");
  assert.equal(plan(config).breaks.length, 1);
  E.setBlock(config, [0, 0], [1, 0], { name: "West", sensors: ["S1"] });
  E.setBlock(config, [5, 0], [6, 0], { name: "East", sensors: ["S2", "S1"] });
  config.logic.plan.sections = [{ name: "Sec", blocks: ["East"] }];
  E.removeBreak(config, [3, 0]);
  assert.deepEqual(plan(config).breaks, []);
  assert.deepEqual(plan(config).blocks.map((b) => [b.name, b.sensors]), [["West", ["S1", "S2"]]]);
  assert.deepEqual(plan(config).sections[0].blocks, ["West"]);
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

test("renaming a block takes its sections along", () => {
  const config = line();
  E.setBlock(config, [0, 0], [1, 0], { name: "Main", sensors: ["S1"] });
  config.logic.plan.sections = [{ name: "Sec", blocks: ["Main"] }];
  E.setBlock(config, [0, 0], [1, 0], { name: "Up" });
  assert.deepEqual(plan(config).sections[0].blocks, ["Up"]);
  E.setBlock(config, [0, 0], [1, 0], { name: "" });
  assert.equal(plan(config).blocks[0].name, "Up");
});

test("a new block's name is one nothing else uses", () => {
  const config = line();
  config.blocks.push({ name: "Track 1" });
  assert.equal(E.freeBlockName(config, (n) => `Track ${n}`), "Track 2");
});

const headOns = (config) => B.problems(config).filter((p) => Array.isArray(p.where.blocks));

test("two signals that can meet say which blocks to take one train at a time, and that settles it", () => {
  const expected = { gauntlet: ["Bridge"], diamond: ["Diamond"] };
  for (const name of ["gauntlet", "passing-siding", "diamond"]) {
    const config = redraw(readCase(name));
    delete config.logic.plan.sections;
    assert.ok(headOns(config).length, name);
    if (expected[name]) assert.deepEqual(plain(headOns(config)[0].where.blocks), expected[name]);
    // As the page's buttons would: take the first offered until none is left.
    for (let n = 0; n < 5 && headOns(config).length; n += 1) {
      E.addSection(config, headOns(config)[0].where.blocks, (block) => `${block} section`);
    }
    assert.deepEqual(plain(headOns(config)), [], name);
    assert.deepEqual(plain(B.problems(config).filter((p) => p.level === "error")), [], name);
  }
});

test("the gauntlet's ways in are found on the drawing", () => {
  const found = plain(B.look(redraw(readCase("gauntlet"))).sections);
  assert.deepEqual(found, [{ name: "Bridge section", blocks: ["Bridge"], entrances: [
    { mast: "Left Bridge", waiting: "Left" }, { mast: "Right Bridge", waiting: "Right" }] }]);
});

test("sections that come to share a block become one, and your rules follow", () => {
  const config = line();
  config.logic.layers = [{ name: "Mine", rules: [{ then: { reserve: "B section" } }] }];
  const make = (block, n) => (n > 1 ? `${block} section ${n}` : `${block} section`);
  assert.equal(E.addSection(config, ["A"], make), "A section");
  assert.equal(E.addSection(config, ["B"], make), "B section");
  assert.equal(E.addSection(config, ["A", "B"], make), "A section");
  assert.deepEqual(plan(config).sections, [{ name: "A section", blocks: ["A", "B"] }]);
  assert.equal(config.logic.layers[0].rules[0].then.reserve, "A section");
  assert.equal(E.addSection(config, [], make), null);
});

test("a section's settings: the usual ones are not stored, a taken name is refused, no blocks removes it", () => {
  const config = line();
  config.logic.resources = [{ name: "Mine" }];
  config.logic.layers = [{ name: "G", rules: [{ then: { reserve: "A section" } }] }];
  E.addSection(config, ["A"], (block) => `${block} section`);
  E.setSection(config, "A section", { release: "5s", approachLock: "10s" });
  assert.deepEqual(plan(config).sections[0], { name: "A section", blocks: ["A"], release: "5s", approachLock: "10s" });
  E.setSection(config, "A section", { release: "", approachLock: "", name: "Mine" });
  assert.deepEqual(plan(config).sections[0], { name: "A section", blocks: ["A"] });
  E.setSection(config, "A section", { name: "Bridge" });
  assert.equal(config.logic.layers[0].rules[0].then.reserve, "Bridge");
  E.setSection(config, "Bridge", { blocks: [] });
  assert.deepEqual(plan(config).sections, []);
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
  assert.deepEqual(shape.sections.map((s) => [s.name, s.label]), [["Bridge section", [6, -0.55]]]);
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
