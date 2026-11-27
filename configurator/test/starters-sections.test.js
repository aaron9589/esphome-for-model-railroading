// The Lock turnouts under a train starter (spec, Starters; work item 2.8):
// its answers, the rules it writes, and that those rules pass the engine
// case. (The One-train section starter went in TP 9.)
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

function answersAll() {
  return {
    "lock-turnouts": { name: "Turnout locks", rows: [{ turnout: "P1", block: "Bridge" }, { turnout: "P2", block: "Siding" }] },
  };
}

const checkOf = (config) => {
  const result = validateConfig(normalizeConfig(plain(config)));
  return { errors: [...result.errors], warnings: [...result.warnings] };
};

test("a board built by the starters has no errors and no warnings", () => {
  const config = realBoard();
  for (const [key, answers] of Object.entries(answersAll())) Starters.apply(key, config, answers);
  assert.deepEqual(plain(config.logic.layers.map((g) => g.starter)), ["lock-turnouts"]);
  assert.deepEqual(plain(checkOf(config)).errors, []);
});

// ===== Starter rules =========================================================

test("problems names what is missing, in plain words", () => {
  const config = realBoard();
  assert.ok(Starters.problems("lock-turnouts", config, Starters.defaults("lock-turnouts", config)).includes(Sections.TEXT.needRowTurnout(1)));
});

test("the defaults' names stay clear of what the board has", () => {
  const config = realBoard();
  Starters.apply("lock-turnouts", config, answersAll()["lock-turnouts"]);
  assert.equal(Starters.defaults("lock-turnouts", config).name, "Turnout locks 2");
});

test("build does not change what it is given", () => {
  const config = realBoard();
  for (const [key, answers] of Object.entries(answersAll())) {
    const before = [JSON.stringify(config), JSON.stringify(answers)];
    Starters.build(key, config, answers);
    Starters.problems(key, config, answers);
    assert.deepEqual([JSON.stringify(config), JSON.stringify(answers)], before);
  }
});

test("every word the forms show is in the starters' TEXT", () => {
  assert.ok(Object.keys(Sections.TEXT).length >= 8);
});
