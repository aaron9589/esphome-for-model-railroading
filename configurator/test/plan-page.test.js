// The new Field Logic page's frame (work item TP 6): the steps, what each one
// asks for and what comes next, the problems marked on the drawing, and the
// old page's cards no longer shown in Field Logic. Pure, without a DOM; the
// page itself is driven in Chromium by test/browser/plan-editor.mjs.
import assert from "node:assert/strict";
import { loadModules, test } from "./harness.js";
import { planBoard, planCaseNames, readPlanCase } from "./plan-cases.js";
import { LOGIC_UI_FILES } from "./logic-page.test.js";

const ctx = loadModules(...LOGIC_UI_FILES);
const { EsphomeMrLogicUiField: F, EsphomeMrLogicUiPlan: U, EsphomeMrPlanBuilder: B, EsphomeMrLogicUi: Ui, EsphomeMrPlanEdit: E } = ctx;
const plain = (value) => JSON.parse(JSON.stringify(value));
const board = (name) => planBoard(ctx, readPlanCase(name).module);
const steps = (config) => Object.fromEntries(plain(F.stepsOf(config)).map((s) => [s.id, s]));

test("an empty Field Logic page has one thing to do: draw", () => {
  const config = board("gauntlet");
  config.logic.plan = {};
  const s = steps(config);
  assert.deepEqual(Object.keys(s), ["draw", "sensors", "signals", "behaviour", "try", "download"]);
  assert.deepEqual(Object.values(s).filter((step) => step.open).map((step) => step.id), ["draw"]);
  assert.equal(F.currentStep(config), "draw");
  const g = plain(F.guidance(config, "draw"));
  assert.equal(g.doing, "Draw your track. Start at one end and drag to the other.");
  assert.equal(g.ready, false);
  assert.deepEqual(plain(U.marks(config, U.layout(config))), []);
});

test("each step opens once the one before has something in it, and counts its problems", () => {
  const config = board("gauntlet");
  config.logic.plan = {};
  // Track with two joins not yet settled: Sensors opens; Draw has two problems.
  for (const [a, b] of [[[0, 0], [3, 0]], [[3, 0], [4, 1]], [[4, 1], [8, 1]], [[8, 1], [9, 0]], [[9, 0], [12, 0]], [[0, 2], [3, 2]], [[3, 2], [4, 1]], [[8, 1], [9, 2]], [[9, 2], [12, 2]]]) E.draw(config, a, b);
  let s = steps(config);
  assert.equal(s.draw.errors, 2);
  assert.equal(s.draw.done, false);
  assert.equal(s.sensors.open, true);
  assert.equal(s.signals.open, false);
  assert.equal(plain(F.guidance(config, "sensors")).waiting, "Name at least one block first: the signals stand between blocks.");
  // Each unsettled join is ringed on the drawing, as a Draw problem.
  const ringed = plain(U.marks(config, U.layout(config))).filter((m) => m.step === "draw").map((m) => m.at);
  assert.deepEqual(ringed.sort(), [[4, 1], [8, 1]]);
  for (const x of [4, 8]) E.setPoint(config, [x, 1], { turnout: null });
  // A named block opens Signals; a signal opens the rest.
  E.setBlock(config, [5, 1], [6, 1], { name: "Bridge", sensors: ["Bridge current"] });
  s = steps(config);
  assert.equal(s.draw.errors, 0);
  assert.equal(s.signals.open, true);
  assert.equal(s.behaviour.open, false);
  E.setSignal(config, [2, 0], [3, 0], "Left Bridge");
  s = steps(config);
  assert.deepEqual(Object.values(s).filter((step) => step.open).map((step) => step.id), ["draw", "sensors", "signals", "behaviour", "try", "download"]);
});

test("the drawings the plan cases give open every step, and their problems are none", () => {
  for (const name of planCaseNames()) {
    const config = board(name);
    const s = steps(config);
    assert.ok(Object.values(s).every((step) => step.open), name);
    assert.ok(Object.values(s).every((step) => !step.errors), `${name}: ${JSON.stringify(s)}`);
    assert.equal(plain(F.guidance(config, "download")).ready, true, name);
  }
});

test("every problem the drawing can have belongs to a step, and is marked where it is", () => {
  const config = board("passing-siding");
  // A turnout taken off the Turnouts page, a block's sensor removed, a signal's mast removed.
  config.points = config.points.filter((p) => p.name !== "PW");
  config.blocks = config.blocks.filter((b) => b.name !== "Far current");
  config.signals.masts = config.signals.masts.filter((m) => m.name !== "Main West");
  const found = plain(B.problems(config));
  assert.ok(found.length >= 3);
  for (const p of found) assert.ok(F.ORDER.includes(p.step), JSON.stringify(p));
  const marks = plain(U.marks(config, U.layout(config)));
  assert.ok(marks.some((m) => m.step === "draw" && m.level === "error" && JSON.stringify(m.at) === "[4,1]"), JSON.stringify(marks));
  assert.ok(marks.some((m) => m.step === "sensors" && m.level === "error" && m.pieces?.length), JSON.stringify(marks));
});

test("Field Logic shows the new page; the old page's cards are gone from it, the settings fold away", () => {
  for (const id of ["logic-field", "logic-plan", "logic-try", "logic-mode", "logic-settings", "logic-linked"]) assert.ok(Ui.hasPart(id, "field"), id);
  for (const id of ["logic-steps", "logic-blocks", "logic-masts", "logic-buttons", "logic-sections", "logic-groups", "logic-starters", "logic-layers-view", "logic-control-table"]) {
    assert.ok(!Ui.hasPart(id, "field"), id);
  }
  // MSS Logic keeps its views, and a board with no logic its checklist.
  for (const id of ["logic-layers-view", "logic-control-table", "logic-try"]) assert.ok(Ui.hasPart(id, "mss"), id);
  assert.ok(Ui.hasPart("logic-steps", "none"));
  assert.equal(F.settingsOpen(board("gauntlet")), false);
});

if (!process.exitCode) console.log("\nAll plan page tests passed.");
