// The Logic page shell: stored settings, the checklist, and plain words.
// Work item 1.3.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

// Every Logic page file, in index.html's order.
export const LOGIC_UI_FILES = ["generator.js", "logic-yaml.js", "logic.js", "logic-checker.js", "logic-try.js", "logic-ui.js", "logic-ui-masts.js", "logic-ui-ends.js", "logic-ui-views.js", "logic-ui-start.js", "logic-ui-try.js", "logic-starters.js", "logic-starters-sections.js", "logic-starters-signals.js", "mss-builder.js", "plan-builder.js", "plan-edit.js", "logic-ui-field.js", "logic-ui-own.js", "logic-ui-plan.js", "logic-ui-plan-try.js", "mss-templates.js", "mss-row.js", "logic-ui-mss-marks.js", "logic-ui-mss-row.js", "logic-ui-mss-page.js", "logic-ui-mss-tracks.js", "logic-ui-mss-junctions.js", "logic-ui-mss-module.js", "logic-summary.js", "mss-card.js"];
const context = loadModules(...LOGIC_UI_FILES);
const { generateYaml, logicMode, myFirstBoardPreset, normalizeConfig, parseConfigFromYaml, sharesWithOtherBoards } =
  context.EsphomeMr;
const { FEATURES, TEXT, allText, checklistSteps, logicNavHint, modeChoices } = context.EsphomeMrLogicUi;

function board() {
  const config = myFirstBoardPreset();
  config.board.wifiSsid = "layout-wifi";
  config.board.wifiPassword = "not-a-real-password";
  config.board.apPassword = "GoldenFixtureHotspot";
  config.board.apiKey = "Z29sZGVuLWZpeHR1cmUta2V5LW5vdC1hLXNlY3JldCE=";
  return config;
}

// Spec, Ease of use: "no page label uses a spec-only term".
const SPEC_ONLY = /\b(scans?|scanning|latch(es|ed)?|interpreters?|rule tables?|phases?|resources?|layers?|tags?|tagged)\b/i;

// Every string in TEXT, and what each sentence-building function says when
// called with sample values.
function strings(value, where = "TEXT") {
  if (typeof value === "string") return [[where, value]];
  if (typeof value === "function") return strings(value("Sample", ["a change", "another"], 2), `${where}()`);
  return Object.entries(value).flatMap(([key, inner]) => strings(inner, `${where}.${key}`));
}

test("no Logic page label uses a spec-only term, in any part", () => {
  // Files with no card of their own: the Masts helpers MSS Logic and the
  // starters use, and the Download page's Logic version card.
  const texts = [...allText(), ...["EsphomeMrLogicStarters", "EsphomeMrLogicUiMasts", "EsphomeMrLogicUiStart"].map((name) => [`${name}.TEXT`, context[name].TEXT])];
  const found = texts.flatMap(([where, text]) => strings(text, where)).filter(([, text]) => SPEC_ONLY.test(text));
  assert.deepEqual(found, []);
});

test("every part file hands its TEXT to the lint", () => {
  const linted = new Set([...allText()].map(([, text]) => text));
  // The old MSS cards (Tracks, Junctions, the module picture) are off the
  // page since MP 2; Try it draws with them until MP 6.
  for (const name of ["Ends", "Plan", "Views", "Mss"]) {
    const { TEXT: own } = context[`EsphomeMrLogicUi${name}`];
    assert.ok(Object.keys(own).length === 0 || linted.has(own), `EsphomeMrLogicUi${name}.TEXT is not registered with a part`);
  }
});

test("index.html loads every Logic page file, in order, before app.js", () => {
  const html = fs.readFileSync(path.join(configuratorDir, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script src="\.\/([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(scripts, [...LOGIC_UI_FILES, "app.js"]);
});

test("the Logic section in index.html uses plain words too", () => {
  const html = fs.readFileSync(path.join(configuratorDir, "index.html"), "utf8");
  const section = html.slice(html.indexOf('data-panel="logic"'), html.indexOf('data-panel="yaml"'));
  assert.ok(section.length > 0);
  const text = section.replace(/<[^>]+>/g, " ");
  assert.equal(SPEC_ONLY.exec(text), null);
  const nav = html.slice(html.indexOf('data-view="logic"'), html.indexOf('data-view="yaml"')).replace(/<[^>]+>/g, " ");
  assert.equal(SPEC_ONLY.exec(nav), null);
});

test("the lint would catch a spec-only term", () => {
  for (const bad of ["Add a layer", "Release the resource", "Each scan", "Meaning (tag)", "Rule table"]) {
    assert.ok(SPEC_ONLY.test(bad), bad);
  }
  for (const fine of ["Advantage", "Stage", "Last train", "Taggart"]) assert.ok(!SPEC_ONLY.test(fine), fine);
});

test("logic mode None with Share unticked writes no logic key", () => {
  const plain = generateYaml(board());
  for (const logic of [undefined, {}, { share: false }, { mode: "none" }, { share: "yes" }, { mode: "" }, []]) {
    const config = board();
    if (logic !== undefined) config.logic = logic;
    assert.equal(generateYaml(config), plain, JSON.stringify(logic));
  }
});

test("mode and Share are stored, and survive import", () => {
  const config = board();
  config.logic = { mode: "field", share: true };
  const yaml = generateYaml(config);
  assert.match(yaml, /"logic":\{"mode":"field","share":true\}/);
  const restored = normalizeConfig(parseConfigFromYaml(yaml));
  assert.equal(logicMode(restored), "field");
  assert.equal(sharesWithOtherBoards(restored), true);
  assert.equal(generateYaml(restored), yaml);

  const shareOnly = board();
  shareOnly.logic = { share: true };
  assert.match(generateYaml(shareOnly), /"logic":\{"share":true\}/);
  assert.equal(logicMode(normalizeConfig(shareOnly)), "none");
});

test("Share follows the mode until it is ticked or unticked", () => {
  const config = board();
  config.logic = {};
  assert.equal(sharesWithOtherBoards(config), false);
  config.logic.mode = "field";
  assert.equal(sharesWithOtherBoards(config), true, "on by default in Field Logic");
  delete config.logic.mode;
  assert.equal(sharesWithOtherBoards(config), false, "back to None: off again");
  assert.equal(generateYaml(config), generateYaml(board()));

  config.logic = { mode: "field", share: false };
  delete config.logic.mode;
  config.logic.mode = "field";
  assert.equal(sharesWithOtherBoards(config), false, "an untick is kept across mode changes");
  const blob = JSON.parse(generateYaml(config).split("\n")[1].slice(2));
  assert.deepEqual(blob.logic, { mode: "field", share: false });

  config.logic = { share: true };
  assert.equal(sharesWithOtherBoards(config), true, "ticked with mode None");
});

test("keys and modes a later configurator adds are kept on import", () => {
  const config = board();
  config.logic = { mode: "field", share: true, layers: [{ name: "Bridge" }] };
  const restored = normalizeConfig(parseConfigFromYaml(generateYaml(config)));
  assert.equal(restored.logic.layers[0].name, "Bridge");

  const newer = board();
  newer.logic = { mode: "future-mode" };
  const back = normalizeConfig(parseConfigFromYaml(generateYaml(newer)));
  assert.equal(back.logic.mode, "future-mode");
  assert.equal(logicMode(back), "none");
});

test("MSS Logic always shares, and is offered", () => {
  const config = board();
  config.logic = { mode: "mss", share: false };
  assert.equal(sharesWithOtherBoards(normalizeConfig(config)), true);
  assert.equal(FEATURES.mss, true);
  assert.deepEqual([...modeChoices()], ["none", "field", "mss"]);
});

test("the checklist leads with choosing a mode, and ends with Download", () => {
  const config = board();
  const keys = (steps) => [...steps].map((step) => `${step.key}${step.done ? "+" : ""}`);
  assert.deepEqual(keys(checklistSteps(config, { blocks: false })), ["mode", "download"]);
  config.logic = { mode: "field" };
  assert.deepEqual(keys(checklistSteps(config, { blocks: true })), ["mode+", "blocks", "tryIt", "download"]);
  config.logic.blocks = [{ name: "Int 2" }];
  // Blocks and signals: done once there are blocks and a group of rules.
  assert.deepEqual(keys(checklistSteps(config, { blocks: true })), ["mode+", "blocks", "tryIt", "download"]);
  config.logic.layers = [{ name: "Group 1", rules: [] }];
  assert.deepEqual(keys(checklistSteps(config, { blocks: true })), ["mode+", "blocks+", "tryIt", "download"]);
  // A drawing with a signal on it is blocks and signals too.
  config.logic = { mode: "field", plan: { breaks: [{ at: [1, 0], signals: [] }] } };
  assert.deepEqual(keys(checklistSteps(config, { blocks: true })), ["mode+", "blocks", "tryIt", "download"]);
  config.logic.plan.breaks[0].signals = [{ mast: "Home", facing: [2, 0] }];
  assert.deepEqual(keys(checklistSteps(config, { blocks: true })), ["mode+", "blocks+", "tryIt", "download"]);
  assert.equal(FEATURES.tryIt, true);
});

test("Starts on stays hidden until Release 2", () => {
  assert.equal(FEATURES.startsOn, false);
});

test("the nav says the mode in plain words", () => {
  const config = board();
  assert.equal(logicNavHint(config), "None");
  config.logic = { mode: "field" };
  assert.equal(logicNavHint(config), "Field Logic");
});

if (!process.exitCode) console.log("\nAll Logic page tests passed.");
