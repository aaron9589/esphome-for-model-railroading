// The track plan's builder (docs/field-logic-plan-spec.md; work items TP 2 and
// TP 4). The cases in test/cases/plan are hand-worked from the spec: each gives
// a drawing (`logic.plan`) and a timeline. Each becomes a configurator board
// (plan-cases.js), its rule table is built the way the YAML does it
// (logicTable), and the JS engine replays the timeline; engine-diff.test.js
// replays them in the C++ core too. Then the builder's own checks.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";
import { runCase } from "./engine-runner.js";
import { planBoard, planCasesDir, readPlanCase } from "./plan-cases.js";

const context = loadModules("generator.js", "logic-yaml.js", "logic.js", "logic-checker.js", "logic-try.js", "logic-ui.js", "logic-ui-masts.js", "logic-ui-rules.js", "logic-ui-views.js", "logic-ui-start.js", "logic-ui-try.js", "logic-starters.js", "logic-starters-sections.js", "logic-starters-signals.js", "mss-builder.js", "plan-builder.js", "logic-summary.js");
const { EsphomeMr, EsphomeMrLogicYaml: L, EsphomeMrPlanBuilder: B } = context;
const { generateYaml, myFirstBoardPreset, parseConfigFromYaml, topicFor, validateConfig } = EsphomeMr;

const plain = (value) => JSON.parse(JSON.stringify(value));
const casesDir = planCasesDir;
const readCase = readPlanCase;
const board = (module) => planBoard(context, module);
const of = (name) => board(readCase(name).module);
const texts = (config, level) => plain(B.problems(config)).filter((p) => p.level === level).map((p) => p.text);

// ===== 1. The hand-worked cases ============================================

for (const file of fs.readdirSync(casesDir).filter((f) => f.endsWith(".json")).sort()) {
  const data = readCase(file.replace(/\.json$/, ""));
  test(`${file.replace(/\.json$/, "")}: ${data.name}`, () => {
    const config = board(data.module);
    assert.deepEqual(texts(config, "error"), [], "no plan problems");
    assert.deepEqual(plain(validateConfig(config).errors), [], "no validation errors");
    assert.deepEqual(runCase({ ...data, module: undefined, board: plain(L.logicTable(config)) }), []);
  });
}

// ===== 2. What is built, and what is kept =================================

test("building does not change the board, and the file keeps the drawing, not the built items", () => {
  const config = of("gauntlet");
  const before = JSON.stringify(config);
  B.build(config);
  assert.equal(JSON.stringify(config), before);
  const yaml = generateYaml(config);
  const back = parseConfigFromYaml(yaml);
  assert.deepEqual(plain(back.logic.plan), plain(config.logic.plan));
  assert.equal(back.logic.layers, undefined);
  assert.equal(L.versionCode(back), L.versionCode(config));
});

test("your own rules run beside the plan, after its groups", () => {
  const config = of("gauntlet");
  config.logic.layers = [{ name: "Mine", rules: [{ trigger: { while: { block: "Bridge", is: "clear" } }, checks: [], then: { mast: "Left Bridge", aspect: "R281" } }] }];
  const names = plain(L.logicTable(config).logic.layers).map((g) => g.name);
  assert.deepEqual(names, ["Left Bridge", "Right Bridge", "Left Bridge moves", "Right Bridge moves", "Mine"]);
});

test("a renamed signal aspect, sensor and mast follow into the drawing", () => {
  const config = of("gauntlet");
  config.logic.plan.breaks[0].signals[0].aspects = { clear: "R281" };
  L.renameAspect(config, "Left Bridge", "R281", "Go");
  assert.equal(config.logic.plan.breaks[0].signals[0].aspects.clear, "Go");
  L.renameReferences(config, "sensor", "Left current", "L");
  assert.deepEqual(plain(config.logic.plan.blocks[0].sensors), ["L"]);
  L.renameReferences(config, "mast", "Left Bridge", "LB");
  assert.equal(config.logic.plan.breaks[0].signals[0].mast, "LB");
});

test("a boundary sensor holds the blocks on both sides", () => {
  const config = of("junction");
  config.logic.plan.breaks[1].sensors = ["Junction current"];
  const blocks = plain(B.build(config).blocks);
  assert.deepEqual(blocks.find((b) => b.name === "Main").sensors, ["Main current", "Junction current"]);
});

test("an end can name another board's block and signal, which are checked and followed", () => {
  const config = of("junction");
  config.logic.remoteBoards = [{
    name: "south-a3f9qp", share: true, blocks: [], points: [],
    signals: { masts: [{ name: "Home south", topic: "trains/track/signalmast/Home south", aspects: ["R292", "R281"], tags: { R292: "stop", R281: "clear" } }] },
    logic: { blocks: [{ name: "Up", topic: "trains/track/sensor/Up" }], masts: [] },
  }];
  config.logic.plan.ends.push({ at: [10, 1], beyond: { board: "south-a3f9qp", mast: "Home south", blocks: ["Up"] } });
  assert.deepEqual(texts(config, "error"), []);
  assert.deepEqual(plain(validateConfig(config).errors), []);
  const group = plain(L.logicTable(config).logic.layers).find((g) => g.name === "Main exit");
  assert.ok(group.rules.every((rule) => rule.checks.some((c) => c.board === "south-a3f9qp" && c.block === "Up" && c.is === "clear")));
  assert.ok(group.rules.some((rule) => rule.checks.some((c) => c.board === "south-a3f9qp" && c.mast === "Home south")));
});

// ===== 3. Problems ==========================================================

const broken = (name, change) => { const config = of(name); change(config.logic.plan, config); return config; };
const has = (config, level, words) => assert.ok(texts(config, level).includes(words), `${words}\n${texts(config, level).join("\n")}`);

test("drawing mistakes are errors that stop the download", () => {
  const T = B.TEXT;
  has(broken("junction", (p) => { p.points = []; }), "error", T.needTurnout("the point at 5, 1"));
  has(broken("junction", (p) => { p.track.push([[0, 5], [3, 6]]); }), "error", T.badSegment(p0(broken("junction", () => {})) + 1));
  has(broken("junction", (p) => { p.track.push([[0, 1], [0, 3]]); }), "error", T.sharp("the point at 0, 1"));
  has(broken("junction", (p) => { p.breaks[0].at = [5, 1]; }), "error", T.badBreak("the point at 5, 1"));
  has(broken("junction", (p) => { p.points[0].turnout = "P9"; }), "error", T.noTurnout("P9"));
  has(broken("gauntlet", (p) => { p.arrows = []; }), "error", T.ambiguous("Left Bridge"));
  has(broken("gauntlet", (p) => { p.blocks.splice(1, 1); }), "error", T.unproved("Left Bridge"));
  has(broken("gauntlet", (p) => { p.blocks.splice(0, 1); }), "error", T.clashWaiting("Left Bridge", "Right Bridge"));
  has(broken("gauntlet", (p) => { p.blocks[1].release = "soon"; }), "error", T.badTime("Bridge", "free-after time"));
  has(broken("gauntlet", (p) => { p.blocks[1].approachLock = "10 s"; }), "error", T.badTime("Bridge", "hold time"));
  const bad = broken("gauntlet", (p) => { p.arrows = []; });
  assert.ok(validateConfig(bad).errors.includes(T.ambiguous("Left Bridge")));
});
function p0(config) { return config.logic.plan.track.length; }

test("a file of the wrong shape is reported, not thrown", () => {
  for (const plan of [{}, { track: "no" }, { track: [[1, 2]], points: [null], breaks: [7], blocks: [{}], ends: [3], sections: [{}] }, { track: [[[0, 0], [1e9, 0]]] }]) {
    const config = of("gauntlet");
    config.logic.plan = plan;
    validateConfig(config);
    B.build(config);
  }
});

// What a signal's moves take, by rule: { reserve, guard }.
const movesOf = (config, mast) => plain(B.build(config)).layers.find((g) => g.name === `${mast} moves`)?.rules
  .map((r) => ({ reserve: r.then.reserve, guard: r.trigger.leavingGuard })) ?? null;

test("moves that clash take their pieces of track: a crossing is one piece, and track no sensor sees is an error", () => {
  // The diamond's lines share only the crossing.
  assert.deepEqual(plain(B.build(of("diamond")).resources).map((r) => [r.name, r.blocks]), [["Diamond", ["Diamond"]]]);
  assert.deepEqual(movesOf(of("diamond"), "West signal"), [{ reserve: ["Diamond"], guard: undefined }]);
  has(broken("diamond", (p) => { p.blocks = p.blocks.filter((b) => b.name !== "Diamond"); }), "error", B.TEXT.clashUnseen("West signal", "North signal"));
  // A junction's signals never share track: nothing is taken.
  assert.deepEqual(plain(B.build(of("junction")).resources), []);
  assert.equal(movesOf(of("junction"), "Home"), null);
});

test("a crossing loop: each road, the points and the single line are taken in pieces, and a train is taken for one leaving only by the piece it came through", () => {
  const config = of("passing-siding");
  assert.deepEqual(plain(B.build(config).resources).map((r) => r.name), ["West points 1", "West points 2", "West points 3", "Main loop", "Siding", "East points 1", "East points 2", "East points 3", "Single"]);
  assert.deepEqual(movesOf(config, "West Home"), [
    { reserve: ["West points 1", "West points 2", "Main loop"], guard: ["West points 1"] },
    { reserve: ["West points 1", "West points 3", "Siding"], guard: ["West points 1"] },
  ]);
  assert.deepEqual(movesOf(config, "Main East"), [{ reserve: ["East points 1", "East points 2", "Single"], guard: ["East points 1"] }]);
  assert.deepEqual(movesOf(config, "East Home"), [
    { reserve: ["Single", "East points 2", "East points 1", "Main loop"], guard: ["Single"] },
    { reserve: ["Single", "East points 2", "East points 3", "Siding"], guard: ["Single"] },
  ]);
  // East Advance runs off the drawing on track no other signal uses.
  assert.equal(movesOf(config, "East Advance"), null);
  // Each piece is freed after its block's Timing.
  config.logic.plan.blocks.find((b) => b.name === "East points").release = "5s";
  config.logic.plan.blocks.find((b) => b.name === "East points").approachLock = "10s";
  const east = plain(B.build(config).resources).filter((r) => r.blocks[0] === "East points");
  assert.ok(east.length === 3 && east.every((r) => r.release.for === "5s" && r.approachLock === "10s"));
  assert.deepEqual(plain(validateConfig(config).errors), []);
});

test("a scissors crossover: each line's moves take only their own line, and the crossovers clash only on the crossing", () => {
  const config = of("scissors");
  assert.deepEqual(movesOf(config, "NW signal"), [
    { reserve: ["North scissors 1", "North scissors 2", "North scissors 3"], guard: ["North scissors 1"] },
    { reserve: ["North scissors 1", "North scissors 4", "Diamond 1", "Diamond 2", "South scissors 1", "South scissors 2"], guard: ["North scissors 1"] },
  ]);
  assert.deepEqual(movesOf(config, "SE signal")[0].reserve, ["South scissors 2", "South scissors 5", "South scissors 4"]);
});

test("crossovers move together; a passing loop's turnouts do not; a point's pairedWith changes it", () => {
  const pairs = (config) => plain(B.build(config).pairs);
  assert.deepEqual(pairs(of("scissors")), [{ turnout: "P1", with: "P4", same: true }, { turnout: "P3", with: "P2", same: true }]);
  assert.deepEqual(pairs(of("passing-siding")), []);
  assert.deepEqual(pairs(of("junction")), []);
  // Unpaired by hand, then paired with another; a reversed turnout moves the other way.
  assert.deepEqual(pairs(broken("scissors", (p) => { p.points[0].pairedWith = ""; })), [{ turnout: "P3", with: "P2", same: true }]);
  assert.deepEqual(pairs(broken("passing-siding", (p) => { p.points[0].pairedWith = "PE"; p.points[1].straightIs = "thrown"; })), [{ turnout: "PW", with: "PE", same: false }]);
  has(broken("scissors", (p) => { p.points[0].pairedWith = "P9"; }), "error", B.TEXT.pairMissing("P1", "P9"));
  has(broken("scissors", (p) => { p.points[0].pairedWith = "P2"; }), "error", B.TEXT.pairTwice("P2"));
});

test("a crossover's turnouts move together on the board: a command for one throws both, unless the other is locked or moving", () => {
  const yaml = generateYaml(of("scissors"));
  const script = (id) => yaml.slice(yaml.indexOf(`  - id: ${id}\n`), yaml.indexOf("  - id: ", yaml.indexOf(`  - id: ${id}\n`) + 5));
  for (const [mine, other] of [["p1", "p4"], ["p4", "p1"], ["p2", "p3"], ["p3", "p2"]]) {
    for (const way of ["thrown", "closed"]) {
      const body = script(`${mine}_throw_${way}`);
      assert.ok(body.includes(`lambda: 'return announce && id(${other}_thrown) != ${way === "thrown"} && !id(${other}_throw_closed).is_running() && !id(${other}_throw_thrown).is_running() && !id(${other}_field_locked);'`), `${mine} ${way}`);
      assert.ok(body.includes(`id: ${other}_throw_${way}\n                announce: true`), `${mine} ${way}`);
    }
  }
  // A reversed turnout goes the other way; a board with no pairs writes none.
  const reversed = generateYaml(broken("scissors", (p) => { p.points[3].straightIs = "thrown"; }));
  assert.ok(reversed.slice(reversed.indexOf("  - id: p1_throw_thrown\n")).split("  - id: ")[1].includes("id: p4_throw_closed"));
  assert.ok(!generateYaml(of("passing-siding")).includes("A crossover"));
});

test("fail safe: two tracks that join with no turnout cannot both clear onto it, unless a turnout keeps them apart", () => {
  assert.deepEqual(movesOf(of("merge"), "Upper"), [{ reserve: ["Merge", "Out"], guard: undefined }]);
  assert.deepEqual(movesOf(of("merge"), "Lower"), [{ reserve: ["Merge", "Out"], guard: undefined }]);
  // Through a turnout they cannot both be set: nothing is taken.
  const turnout = broken("merge", (p, config) => { config.points = [{ name: "P1", topic: topicFor("point", "P1"), channel: 0 }]; p.points = [{ at: [4, 1], turnout: "P1", straight: [3, 0] }]; });
  assert.deepEqual(texts(turnout, "error"), []);
  assert.deepEqual(plain(B.build(turnout).resources), []);
  // With no sensor where they meet, the page says to add one.
  has(broken("merge", (p) => { p.blocks = p.blocks.filter((b) => b.name !== "Merge"); }), "error", B.TEXT.clashUnseen("Upper", "Lower"));
});

test("fail safe: turnouts lock as a train comes up to a cleared signal, past it, and over them; moves do not hold them", () => {
  const built = plain(B.build(of("passing-siding")));
  const locks = built.layers.find((g) => g.name === "Turnout locks").rules;
  const has1 = (block, checks, turnout) => locks.some((r) => r.trigger.while.block === block && r.then.lock.includes(turnout)
    && JSON.stringify(r.checks) === JSON.stringify(checks));
  assert.ok(has1("East points", [], "PE"), "under the train");
  assert.ok(has1("Single", [], "PE"), "past East Home, short of the points");
  assert.ok(has1("Far", [{ turnout: "PE", is: "closed" }, { not: { mast: "East Home", is: "stop" } }], "PE"), "coming up to East Home");
  for (const group of built.layers.filter((g) => g.starter === "plan-moves")) {
    assert.ok(group.rules.every((r) => r.then.lock === undefined), group.name);
  }
  // With nothing to see a train coming, the page says so.
  const blind = broken("passing-siding", (p) => { p.blocks = p.blocks.filter((b) => b.name !== "Far"); });
  has(blind, "warning", B.TEXT.noApproach("East Home"));
});

test("a row waiting for an aspect the next signal never shows is left out, and the checker says nothing about the plan's own rules", () => {
  const config = of("junction");
  const home = plain(B.build(config)).layers.find((g) => g.name === "Home");
  // Main exit is capped at Approach; Branch exit shows only Clear.
  assert.ok(!home.rules.some((r) => r.checks.some((c) => c.mast === "Main exit" && [c.is].flat().includes("clear"))));
  assert.ok(!home.rules.some((r) => r.checks.some((c) => c.mast === "Branch exit" && c.is === "approach")));
  assert.deepEqual(plain(validateConfig(config).warnings).filter((w) => /never apply|did not apply/.test(w)), []);
  // Your own rule can hold Branch exit at Approach: that row comes back.
  config.logic.masts = [{ mast: "Branch exit", tags: { R285: "approach" } }];
  config.logic.layers = [{ name: "Mine", rules: [{ trigger: { while: { block: "Branch", is: "occupied" } }, checks: [], then: { mast: "Branch exit", aspect: "R285" } }] }];
  assert.ok(plain(B.build(config)).layers.find((g) => g.name === "Home").rules.some((r) => r.checks.some((c) => c.mast === "Branch exit" && c.is === "approach")));
});

test("track with no sensor is warned about", () => {
  has(of("gauntlet"), "warning", B.TEXT.undetected("Left Bridge"));
});

test("a block with only a boundary sensor is still checked, but warned about, and no train can wait in it", () => {
  const config = broken("junction", (p) => { p.breaks[1].sensors = ["Junction current"]; p.blocks[2].sensors = []; });
  has(config, "warning", B.TEXT.undetected("Main exit"));
  const group = plain(B.build(config).layers).find((g) => g.name === "Main exit");
  assert.equal(group.rules[0].trigger.while.block, "Main");
  has(broken("gauntlet", (p) => { p.breaks[0].sensors = ["Left current"]; p.blocks[0].sensors = []; }), "error", B.TEXT.clashWaiting("Left Bridge", "Right Bridge"));
});

// ===== 4. The continuous run ===============================================

const loopBoard = () => board({
  sensors: ["B1 current", "B2 current", "B3 current"],
  masts: ["S1", "S2", "S3"],
  plan: {
    track: [[[1, 0], [7, 0]], [[7, 0], [8, 1]], [[8, 1], [8, 3]], [[8, 3], [7, 4]], [[7, 4], [1, 4]], [[1, 4], [0, 3]], [[0, 3], [0, 1]], [[0, 1], [1, 0]]],
    breaks: [
      { at: [2, 0], signals: [{ mast: "S1", facing: [3, 0] }] },
      { at: [8, 2], signals: [{ mast: "S2", facing: [8, 3] }] },
      { at: [2, 4], signals: [{ mast: "S3", facing: [1, 4] }] },
    ],
    blocks: [["B1", [[3, 0], [4, 0]]], ["B2", [[5, 4], [4, 4]]], ["B3", [[0, 1], [0, 3]]]].map(([name, at]) => ({ name, at, sensors: [`${name} current`] })),
  },
});

test("a block with a sensor that no signal checks is warned about", () => {
  // The worked drawings have none: a block behind a signal counts as watched.
  for (const name of ["gauntlet", "junction", "passing-siding", "diamond", "scissors", "merge"]) {
    const config = of(name);
    for (const block of config.logic.plan.blocks) assert.ok(!texts(config, "warning").includes(B.TEXT.unwatched(block.name)), `${name}: ${block.name}`);
  }
  // With no signals left on it, the drawing checks none of its blocks.
  const bare = broken("gauntlet", (p) => { for (const brk of p.breaks) brk.signals = []; });
  for (const name of ["Left", "Bridge", "Right"]) has(bare, "warning", B.TEXT.unwatched(name));
});

test("signals round a loop drawn on the plan are allowed", () => {
  const config = loopBoard();
  assert.deepEqual(texts(config, "error"), []);
  assert.deepEqual(plain(validateConfig(config).errors), []);
  assert.deepEqual(plain(L.logicTable(config).logic.layers).map((g) => g.rules.at(-1).checks[0].mast), ["S2", "S3", "S1"]);
});

test("a loop with one of your own rules in it is still an error", () => {
  const config = loopBoard();
  config.logic.layers = [{ name: "Mine", rules: [{ trigger: { while: { mast: "S2", is: "clear" } }, checks: [], then: { mast: "S1", aspect: "R281" } }] }];
  assert.ok(validateConfig(config).errors.some((e) => e.includes("read each other in a loop")));
});

test("a loop with a single signal is refused", () => {
  const config = loopBoard();
  config.logic.plan.breaks.splice(1, 2);
  has(config, "error", B.TEXT.loopSelf("S1"));
});
