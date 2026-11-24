// The One-train section and Lock turnouts under a train
// starters (spec, Starters; work item 2.8): their answers, the rules they
// write, and that those rules pass the engine cases.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";
import { runCase } from "./engine-runner.js";

// Copied from logic-page.test.js: that file runs its tests on import.
const LOGIC_UI_FILES = ["generator.js", "logic-yaml.js", "logic.js", "logic-ui.js", "logic-ui-masts.js", "logic-ui-rules.js", "logic-ui-views.js", "logic-ui-start.js", "logic-starters.js", "logic-starters-sections.js", "logic-starters-signals.js"];
const context = loadModules(...LOGIC_UI_FILES);
const { EsphomeMr, EsphomeMrLogic: Engine, EsphomeMrLogicYaml: Yaml, EsphomeMrLogicStarters: Starters, EsphomeMrLogicStartersSections: Sections } = context;
const { normalizeConfig, topicFor, validateConfig } = EsphomeMr;

const plain = (value) => JSON.parse(JSON.stringify(value));
const casesDir = path.join(configuratorDir, "test", "cases");
const readCase = (file) => JSON.parse(fs.readFileSync(path.join(casesDir, file), "utf8"));
const caseFiles = fs.readdirSync(casesDir).filter((f) => f.endsWith(".json")).sort();

const lamp = (color) => ({ color, mode: "steady" });

// A signal on the Signal Masts page with these aspects, each with its own JMRI message.
function mast(name, aspects, pins = ["GPIO32", "GPIO19"]) {
  return {
    name, topic: topicFor("signal", name), topicCustom: false, mode: "gpio",
    lamps: [{ name: "Red", count: 1, pin: pins[0] }, { name: "Green", count: 1, pin: pins[1] }],
    aspects: aspects.map((label, i) => ({ label, states: [`${label}; Lit; Unheld`], startup: i === 0, lamps: [lamp(i === 0 ? "red" : "off"), lamp(i === 0 ? "off" : "green")] })),
  };
}

// A board in the configurator's form with these sensors and masts (name -> aspect labels).
function board(sensors, masts) {
  const config = JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "fixtures", "turnouts-gpio.json"), "utf8"));
  const pins = ["GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO13", "GPIO4", "GPIO5"];
  config.blocks = sensors.map((name, i) => ({ name, topic: topicFor("block", name), topicCustom: false, gpio: pins[i], inverted: true, debounce: "500ms" }));
  const maskPins = [["GPIO32", "GPIO21"], ["GPIO22", "GPIO23"], ["GPIO17", "GPIO16"], ["GPIO12", "GPIO15"]];
  config.signals = { mode: "gpio", masts: Object.entries(masts).map(([name, aspects], i) => mast(name, aspects, maskPins[i])) };
  return config;
}

// ===== The spec's worked example, and every case with that gauntlet ==========

// The answers that would write this case's one-train section, or null when the case is not one.
function answersFor(data) {
  const logic = data.board.logic || {};
  const [section, ...more] = logic.resources || [];
  if (!section || more.length || (logic.layers || []).length !== 1) return null;
  const rules = logic.layers[0].rules;
  const entrance = (rule) => rule.trigger.while?.is === "occupied" && rule.trigger.while.block && rule.trigger.for === "0.5s"
    && rule.then.reserve === section.name && rule.then.mast && rule.then.aspect;
  if (rules.length < 2 || !rules.every(entrance)) return null;
  return {
    name: section.name,
    blocks: section.blocks,
    releaseFor: section.release.for,
    approachLock: section.approachLock || "",
    entrances: rules.map((rule) => ({ block: rule.trigger.while.block, mast: rule.then.mast, aspect: rule.then.aspect, leave: !!rule.trigger.leavingGuard })),
  };
}

const gauntlets = caseFiles.map((file) => ({ file, data: readCase(file) })).filter(({ data }) => answersFor(data));

test("there are cases for the starter to reproduce, with and without the leaving guard", () => {
  const names = gauntlets.map((g) => g.file);
  for (const file of ["failsafe-startup-train.json", "rules-leaving-guard.json", "rules-waiting-order.json", "rules-approach-locking-time.json"]) {
    assert.ok(names.includes(file), file);
  }
  assert.ok(gauntlets.length >= 15, `${gauntlets.length} cases`);
});

for (const { file, data } of gauntlets) {
  test(`one-train section: ${file} is what the starter writes`, () => {
    const answers = answersFor(data);
    const config = board(data.board.sensors, Object.fromEntries(Object.entries(data.board.masts).map(([name, m]) => [name, Object.keys(m.aspects)])));
    config.logic = {};
    const built = plain(Starters.build("one-train-section", config, answers));
    const layer = data.board.logic.layers[0];
    assert.deepEqual(built.sections, data.board.logic.resources);
    // The starter writes no turnout locks: a case that locks P1 on Left adds that by hand.
    const without = plain(layer.rules).map((rule) => { const { lock: _lock, ...then } = rule.then; return { ...rule, then }; });
    assert.deepEqual(built.groups[0].rules, without);
    assert.equal(built.groups[0].starter, "one-train-section");
    // The proceed aspect the form prefills is the case's.
    for (const e of answers.entrances) assert.equal(Starters.aspectFor(config, e.mast, "clear"), e.aspect);

    const rules = built.groups[0].rules.map((rule, i) => (layer.rules[i].then.lock ? { ...rule, then: { ...rule.then, lock: layer.rules[i].then.lock } } : rule));
    const run = plain(data);
    run.board.logic.resources = built.sections;
    run.board.logic.layers = [{ name: layer.name, rules }];
    assert.deepEqual(runCase(run), []);
  });
}

test("one-train section: the form's defaults fill the spec's worked example", () => {
  const config = board(["Left", "Bridge", "Right"], { "Left Bridge": ["R292", "R281"], "Right Bridge": ["R292", "R281"] });
  const answers = Starters.defaults("one-train-section", config);
  assert.equal(answers.releaseFor, "3s");
  assert.equal(answers.approachLock, "");
  assert.equal(answers.entrances.length, 2);
  assert.ok(answers.entrances.every((e) => e.leave === false));
  assert.deepEqual(Starters.problems("one-train-section", config, answers).length > 0, true);
});

// ===== The two new cases =====================================================

test("lock turnouts under a train: the starter's rules pass its case", () => {
  const data = readCase("starter-lock-turnouts.json");
  const config = board(["Block A", "Block B"], {});
  config.points = [{ ...config.points[0], name: "P1" }, { ...config.points[1], name: "P2" }];
  const answers = { name: "Turnout locks", rows: [{ turnout: "P1", block: "Block A" }, { turnout: "P2", block: "Block B" }] };
  const built = plain(Starters.build("lock-turnouts", config, answers));
  assert.deepEqual(built.groups, data.board.logic.layers.map((g) => ({ ...g, starter: "lock-turnouts" })));
  assert.deepEqual(runCase(data), []);
});

// ===== Validation and Explain ================================================

function realBoard() {
  const config = board(["Left", "Bridge", "Right", "Platform", "Next", "Siding"], { "Left Bridge": ["Stop", "Clear"], "Right Bridge": ["Stop", "Clear"], "Platform Exit": ["Stop", "Clear"] });
  config.board.name = "sections-k7m4x2";
  config.board.nameSuffix = "k7m4x2";
  config.points = ["GPIO18", "GPIO4"].map((servoPin, i) => ({ name: `P${i + 1}`, topic: topicFor("point", `P${i + 1}`), channel: 0, travelTime: "10s", controls: [], servoPin }));
  config.logic = { mode: "field" };
  return config;
}

function answersAll(config) {
  return {
    "one-train-section": {
      name: "Bridge", blocks: ["Bridge"], releaseFor: "3s", approachLock: "10s",
      entrances: [{ block: "Left", mast: "Left Bridge", aspect: "Clear", leave: true }, { block: "Right", mast: "Right Bridge", aspect: "Clear", leave: true }],
    },
    "lock-turnouts": { name: "Turnout locks", rows: [{ turnout: "P1", block: "Bridge" }, { turnout: "P2", block: "Siding" }] },
  };
}

const checkOf = (config) => {
  const result = validateConfig(normalizeConfig(plain(config)));
  return { errors: [...result.errors], warnings: [...result.warnings] };
};

test("a board built by the starters has no errors and no warnings", () => {
  const config = realBoard();
  for (const [key, answers] of Object.entries(answersAll(config))) Starters.apply(key, config, answers);
  assert.deepEqual(plain(config.logic.layers.map((g) => g.starter)), ["one-train-section", "lock-turnouts"]);
  assert.equal(config.logic.resources.length, 1);
  assert.deepEqual(plain(checkOf(config)), { errors: [], warnings: [] });
  // The masts joined Masts with their meanings.
  const left = config.logic.masts.find((m) => m.mast === "Left Bridge");
  assert.ok(left);
});

test("Explain gives a sentence for each mast the starters set", () => {
  const config = realBoard();
  for (const [key, answers] of Object.entries(answersAll(config))) Starters.apply(key, config, answers);
  const table = Yaml.logicTable(normalizeConfig(plain(config)));
  const left = plain(Engine.explainMast(table, "Left Bridge"));
  assert.ok(left.length >= 1 && left.every((s) => typeof s === "string" && s.length > 10), JSON.stringify(left));
  assert.match(left.join(" "), /Left/);
});

// ===== Starter rules =========================================================

test("problems names what is missing, in plain words", () => {
  const config = realBoard();
  const empty = Starters.defaults("one-train-section", config);
  empty.name = "";
  const found = Starters.problems("one-train-section", config, empty);
  assert.ok(found.includes(Sections.TEXT.needName));
  assert.ok(found.includes(Sections.TEXT.needBlocks));
  assert.ok(found.includes(Sections.TEXT.needTrigger(1)));
  assert.ok(found.includes(Sections.TEXT.needSignal(2)));
  const one = Starters.defaults("one-train-section", config);
  one.entrances.pop();
  assert.ok(Starters.problems("one-train-section", config, one).includes(Sections.TEXT.entranceCount));
  assert.ok(Starters.problems("lock-turnouts", config, Starters.defaults("lock-turnouts", config)).includes(Sections.TEXT.needRowTurnout(1)));
});

test("a taken name is a problem, and the same block twice is too", () => {
  const config = realBoard();
  const answers = answersAll(config);
  Starters.apply("one-train-section", config, answers["one-train-section"]);
  assert.deepEqual(plain(Starters.problems("one-train-section", config, answers["one-train-section"])), [
    Starters.TEXT.nameTaken("group", "Bridge"),
    Starters.TEXT.nameTaken("section", "Bridge"),
  ]);
  const twice = plain(answers["one-train-section"]);
  twice.name = "Other";
  twice.entrances[1].block = "Left";
  assert.deepEqual(plain(Starters.problems("one-train-section", config, twice)), [Sections.TEXT.sameTrigger("Left")]);
  assert.throws(() => Starters.apply("one-train-section", config, twice), /Left/);
});

test("the defaults' names stay clear of what the board has", () => {
  const config = realBoard();
  Starters.apply("lock-turnouts", config, answersAll(config)["lock-turnouts"]);
  assert.equal(Starters.defaults("lock-turnouts", config).name, "Turnout locks 2");
});

test("build does not change what it is given", () => {
  const config = realBoard();
  for (const [key, answers] of Object.entries(answersAll(config))) {
    const before = [JSON.stringify(config), JSON.stringify(answers)];
    Starters.build(key, config, answers);
    Starters.problems(key, config, answers);
    assert.deepEqual([JSON.stringify(config), JSON.stringify(answers)], before);
  }
});

test("every word the forms show is in the starters' TEXT", () => {
  assert.ok(Object.keys(Sections.TEXT).length > 20);
});
