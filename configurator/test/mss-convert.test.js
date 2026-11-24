// Convert to Field Logic (docs/mss-emulation-spec.md; work item 4.3): the same
// YAML and version code before and after, editable items with plant ends, and a
// plain sentence when names clash. The boards are the MSS cases the builder's
// tests use (test/cases/mss).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

const LOGIC_UI_FILES = ["generator.js", "logic-yaml.js", "logic.js", "logic-checker.js", "logic-try.js", "logic-ui.js", "logic-ui-masts.js", "logic-ui-ends.js", "logic-ui-rules.js", "logic-ui-views.js", "logic-ui-start.js", "logic-ui-try.js", "logic-starters.js", "logic-starters-sections.js", "logic-starters-signals.js", "mss-builder.js", "logic-summary.js", "mss-convert.js"];
const context = loadModules(...LOGIC_UI_FILES);
const { EsphomeMr, EsphomeMrLogicYaml: L, EsphomeMrMssBuilder: B, EsphomeMrMssConvert: C, EsphomeMrLogicUi: Ui } = context;
const { generateYaml, myFirstBoardPreset, normalizeConfig, parseConfigFromYaml, topicFor, validateConfig } = EsphomeMr;

const plain = (value) => JSON.parse(JSON.stringify(value));
const same = (actual, expected, ...message) => assert.deepEqual(plain(actual), plain(expected), ...message);

// The YAML without its `# {...}` line, which is the stored board (the only part that
// names the mode).
const body = (yaml) => yaml.split("\n").filter((line) => !line.startsWith("# {")).join("\n");

const casesDir = path.join(configuratorDir, "test", "cases", "mss");
const caseFiles = fs.readdirSync(casesDir).filter((file) => file.endsWith(".json")).sort();
const readCase = (file) => JSON.parse(fs.readFileSync(path.join(casesDir, file), "utf8"));

const CATS = ["R292", "R285", "ADV_NORM", "R281", "R282", "R283", "R286"];
const SENSOR_PINS = ["GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO32", "GPIO35", "GPIO34", "GPIO39"];
const MAST_PINS = ["GPIO16", "GPIO17", "GPIO19", "GPIO23", "GPIO18", "GPIO13"];

function mast(name, pin) {
  return {
    name, topic: topicFor("signal", name), topicCustom: false, mode: "addressable", pin,
    lamps: [{ name: "Head", count: 1 }],
    aspects: CATS.map((label, i) => ({ label, states: [`${label}; Lit; Unheld`], ...(i === 0 ? { startup: true } : {}), lamps: [{ color: i === 0 ? "red" : "green", mode: "steady" }] })),
  };
}

function moduleBoard(name, module) {
  const config = myFirstBoardPreset();
  config.board.name = name;
  config.board.wifiSsid = "layout-wifi";
  config.board.wifiPassword = "not-a-real-password";
  config.board.apPassword = "GoldenFixtureHotspot";
  config.board.apiKey = "Z29sZGVuLWZpeHR1cmUta2V5LW5vdC1hLXNlY3JldCE=";
  config.blocks = (module.sensors || []).map((s, i) => ({ name: s, topic: topicFor("block", s), topicCustom: false, gpio: SENSOR_PINS[i], inverted: true, debounce: "500ms" }));
  config.points = (module.turnouts || []).map((t, i) => ({ name: t, topic: topicFor("point", t), channel: i }));
  config.signals = { mode: "addressable", masts: (module.masts || []).map((m, i) => mast(m, MAST_PINS[i])) };
  config.logic = { mode: "mss", mss: plain(module.mss) };
  return config;
}

// Every module of every case: a case has `module` or a `modules` map.
const boards = [];
for (const file of caseFiles) {
  const data = readCase(file);
  const modules = data.modules || { [data.start?.board || "module"]: data.module };
  for (const [name, module] of Object.entries(modules)) boards.push([`${file.replace(/\.json$/, "")} / ${name}`, () => moduleBoard(name, module)]);
}

for (const [label, make] of boards) {
  test(`${label}: converting keeps the YAML and version code, and the board still validates`, () => {
    const config = make();
    const yaml = body(generateYaml(config));
    const code = L.versionCode(config);
    const table = plain(L.logicTable(config));
    const result = C.convertToFieldLogic(config);
    assert.equal(result.ok, true, result.text);
    assert.equal(config.logic.mode, "field");
    assert.equal(config.logic.mss, undefined, "the description is dropped");
    assert.equal(body(generateYaml(config)), yaml, "same YAML");
    assert.equal(L.versionCode(config), code, "same version code");
    same(L.logicTable(config), table, "same rule table");
    same(validateConfig(config).errors, [], "no validation errors");
    // An exported and imported file still gives the same board.
    const blob = normalizeConfig(parseConfigFromYaml(generateYaml(config)));
    assert.equal(L.versionCode(blob), code);
    same(blob.logic.ends, config.logic.ends, "plant ends are in the file");
  });
}

test("the converted items are the built ones, without origins, and are ordinary editable data", () => {
  const config = moduleBoard("jm", readCase("mss-junction-turnout.json").module);
  const built = B.build(config);
  assert.equal(C.convertToFieldLogic(config).ok, true);
  for (const key of ["blocks", "masts", "layers", "ends"]) same(config.logic[key], built[key], key);
  assert.equal(config.logic.origins, undefined);
  assert.ok(config.logic.ends.length > 0, "plant ends came with it");
  // Editing a copy does not touch anything else.
  config.logic.blocks[0].name = "Renamed";
  assert.notEqual(B.build(moduleBoard("jm", readCase("mss-junction-turnout.json").module)).blocks[0].name, "Renamed");
});

test("it merges with Field Logic items already there, and refuses a name clash with a plain sentence", () => {
  const config = moduleBoard("jm", readCase("mss-junction-turnout.json").module);
  config.logic.blocks = [{ name: "My own block", sensors: [] }];
  assert.equal(C.convertToFieldLogic(config).ok, true);
  assert.equal(config.logic.blocks[0].name, "My own block");
  assert.ok(config.logic.blocks.length > 1);

  const clash = moduleBoard("jm", readCase("mss-junction-turnout.json").module);
  const name = B.build(clash).blocks[0].name;
  clash.logic.blocks = [{ name, sensors: [] }];
  const before = plain(clash);
  const result = C.convertToFieldLogic(clash);
  assert.equal(result.ok, false);
  assert.match(result.text, /already has the same name/);
  assert.ok(result.text.includes(name));
  same(clash, before, "a refused conversion changes nothing");
});

test("it only works on an MSS board", () => {
  const config = myFirstBoardPreset();
  config.logic = { mode: "field" };
  const result = C.convertToFieldLogic(config);
  assert.equal(result.ok, false);
  assert.match(result.text, /not in MSS Logic/);
});

test("the button is a part for MSS mode only, with plain words", () => {
  const part = Ui.allText().find(([id]) => id === "logic-mss-convert");
  assert.ok(part, "registered");
  assert.equal(part[1].button, "Convert to Field Logic");
  const SPEC_ONLY = /\b(scans?|scanning|latch(es|ed)?|interpreters?|rule tables?|phases?|resources?|layers?|tags?|tagged)\b/i;
  for (const value of Object.values(part[1])) {
    const text = typeof value === "function" ? value("block", "Sample") : value;
    assert.equal(SPEC_ONLY.exec(text), null, text);
  }
});
