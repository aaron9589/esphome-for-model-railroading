// The track plan's builder (docs/field-logic-plan-spec.md; work item TP 2). The
// cases in test/cases/plan are hand-worked from the spec: each gives a drawing
// (`logic.plan`) and a timeline. Each becomes a configurator board, its rule
// table is built the way the YAML does it (logicTable), and the JS engine
// replays the timeline. Then the builder's own checks.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";
import { runCase } from "./engine-runner.js";

const context = loadModules("generator.js", "logic-yaml.js", "logic.js", "logic-checker.js", "logic-try.js", "logic-ui.js", "logic-ui-masts.js", "logic-ui-rules.js", "logic-ui-views.js", "logic-ui-start.js", "logic-ui-try.js", "logic-starters.js", "logic-starters-sections.js", "logic-starters-signals.js", "mss-builder.js", "plan-builder.js", "logic-summary.js");
const { EsphomeMr, EsphomeMrLogicYaml: L, EsphomeMrPlanBuilder: B } = context;
const { generateYaml, myFirstBoardPreset, parseConfigFromYaml, topicFor, validateConfig } = EsphomeMr;

const plain = (value) => JSON.parse(JSON.stringify(value));
const casesDir = path.join(configuratorDir, "test", "cases", "plan");
const readCase = (name) => JSON.parse(fs.readFileSync(path.join(casesDir, `${name}.json`), "utf8"));

const CATS = ["R292", "R285", "ADV_NORM", "R281", "R282", "R283", "R286"];
const SENSOR_PINS = ["GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO32", "GPIO35", "GPIO34", "GPIO39"];
const MAST_PINS = ["GPIO16", "GPIO17", "GPIO19", "GPIO23", "GPIO18", "GPIO13", "GPIO4"];

const mast = (name, pin) => ({
  name, topic: topicFor("signal", name), topicCustom: false, mode: "addressable", pin,
  lamps: [{ name: "Head", count: 1 }],
  aspects: CATS.map((label, i) => ({ label, states: [`${label}; Lit; Unheld`], ...(i === 0 ? { startup: true } : {}), lamps: [{ color: i === 0 ? "red" : "green", mode: "steady" }] })),
});

function board(module) {
  const config = myFirstBoardPreset();
  config.board.name = "plan-k7m4x2";
  config.board.nameSuffix = "k7m4x2";
  config.blocks = module.sensors.map((s, i) => ({ name: s, topic: topicFor("block", s), topicCustom: false, gpio: SENSOR_PINS[i], inverted: true, debounce: "500ms" }));
  config.points = (module.turnouts || []).map((t, i) => ({ name: t, topic: topicFor("point", t), channel: i }));
  config.signals = { mode: "addressable", masts: module.masts.map((m, i) => mast(m, MAST_PINS[i])) };
  config.logic = { mode: "field", plan: plain(module.plan) };
  return config;
}
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
  assert.deepEqual(names, ["Left Bridge", "Right Bridge", "Bridge section entrances", "Mine"]);
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
  has(broken("gauntlet", (p) => { p.blocks.splice(1, 1); p.sections = []; }), "error", T.unproved("Left Bridge"));
  has(broken("gauntlet", (p) => { p.blocks.splice(0, 1); }), "error", T.sectionWaiting("Bridge section", "Left Bridge"));
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

test("a crossing or a single line with no section is warned about; with one, it is not", () => {
  const words = B.TEXT.headOn("West signal", "North signal");
  has(broken("diamond", (p) => { p.sections = []; }), "warning", words);
  assert.ok(!texts(of("diamond"), "warning").includes(words));
  assert.ok(!texts(of("passing-siding"), "warning").includes(B.TEXT.headOn("Main East", "East Home")));
});

test("track with no sensor is warned about", () => {
  has(of("gauntlet"), "warning", B.TEXT.undetected("Left Bridge"));
});

test("a block with only a boundary sensor is still checked, but warned about, and no train can wait in it", () => {
  const config = broken("junction", (p) => { p.breaks[1].sensors = ["Junction current"]; p.blocks[2].sensors = []; });
  has(config, "warning", B.TEXT.undetected("Main exit"));
  const group = plain(B.build(config).layers).find((g) => g.name === "Main exit");
  assert.equal(group.rules[0].trigger.while.block, "Main");
  has(broken("gauntlet", (p) => { p.breaks[0].sensors = ["Left current"]; p.blocks[0].sensors = []; }), "error", B.TEXT.sectionWaiting("Bridge section", "Left Bridge"));
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
  for (const name of ["gauntlet", "junction", "passing-siding", "diamond"]) {
    const config = of(name);
    for (const block of config.logic.plan.blocks) assert.ok(!texts(config, "warning").includes(B.TEXT.unwatched(block.name)), `${name}: ${block.name}`);
  }
  // With no signals left on it, the drawing checks none of its blocks.
  const bare = broken("gauntlet", (p) => { for (const brk of p.breaks) brk.signals = []; p.sections = []; });
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
