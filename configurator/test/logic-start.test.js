// The Logic page: starters first, Write a rule from scratch, remote masts in
// Linked boards, and the Download page's Logic version. Work item 2.7d.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

// Every Logic page file, in index.html's order (as test/logic-page.test.js).
const LOGIC_UI_FILES = ["generator.js", "logic-yaml.js", "logic.js", "logic-ui.js", "logic-ui-masts.js", "logic-ui-rules.js", "logic-ui-views.js", "logic-ui-start.js"];
const context = loadModules(...LOGIC_UI_FILES);
const { generateYaml, normalizeConfig, parseConfigFromYaml, validateConfig } = context.EsphomeMr;
const L = context.EsphomeMrLogicYaml;
const UI = context.EsphomeMrLogicUi;
const S = context.EsphomeMrLogicUiStart;

const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "fixtures", `${name}.json`), "utf8"));
}

function fieldBoard(logic = {}) {
  const config = fixture("my-first-board");
  config.logic = { mode: "field", ...logic };
  return normalizeConfig(config);
}

// ===== Starters ============================================================

test("the starter cards follow the spec's list, with Write a rule from scratch last", () => {
  const { cards } = S.starterCards(fieldBoard());
  assert.deepEqual(plain(cards.map((card) => card.key)), [
    "one-train-section", "lock-turnouts", "block-signals", "route-signal", "level-crossing",
    "approach-lighting", "scratch",
  ]);
  assert.deepEqual(plain(cards.map((card) => card.title)), [
    "One-train section", "Lock turnouts under a train", "Block signals", "Route signal", "Level crossing",
    "Approach lighting", "Write a rule from scratch",
  ]);
  for (const card of cards) assert.ok(card.about.length > 0, card.key);
});

test("until work item 2.8, the starters say they are coming; scratch and approach lighting work", () => {
  const { cards } = S.starterCards(fieldBoard());
  const ready = Object.fromEntries(cards.map((card) => [card.key, card.ready]));
  for (const key of S.STARTERS) assert.equal(ready[key], false, key);
  assert.equal(ready.scratch, true);
  assert.equal(ready["approach-lighting"], true);
  const byKey = Object.fromEntries(cards.map((card) => [card.key, card]));
  assert.equal(byKey.scratch.target, "logic-groups");
  assert.equal(byKey["approach-lighting"].action, "goto");
  assert.equal(byKey["approach-lighting"].target, "logic-masts", "approach lighting is set under Masts, not a starter");
  assert.equal(S.startStarter("block-signals", fieldBoard(), {}, UI.UI), false);
});

test("an empty page shows the starters as the page; once there are groups they fold away", () => {
  assert.equal(S.starterCards(fieldBoard()).layout, "empty");
  assert.equal(S.starterCards(fieldBoard({ layers: [] })).layout, "empty");
  assert.equal(S.starterCards(fieldBoard({ layers: [null, "x"] })).layout, "empty", "a hand-edited file's junk is not a group");
  assert.equal(S.starterCards(fieldBoard({ layers: [{ name: "Bridge", rules: [] }] })).layout, "compact");
});

test("Write a rule from scratch adds a group with one blank rule", () => {
  const config = fieldBoard();
  const group = S.writeRuleFromScratch(config);
  assert.deepEqual(plain(config.logic.layers), [{ name: "Group 1", rules: [plain(UI.newRule())] }]);
  assert.equal(config.logic.layers[0], group);
  S.writeRuleFromScratch(config);
  assert.deepEqual(plain(config.logic.layers.map((g) => g.name)), ["Group 1", "Group 2"]);
  // A name already taken is skipped.
  const taken = fieldBoard({ layers: [{ name: "Group 2", rules: [] }] });
  S.writeRuleFromScratch(taken);
  assert.deepEqual(plain(taken.logic.layers.map((g) => g.name)), ["Group 2", "Group 3"]);
  // A board with no logic key yet gets one.
  const bare = fixture("my-first-board");
  S.writeRuleFromScratch(bare);
  assert.equal(bare.logic.layers.length, 1);
  assert.equal(S.starterCards(taken).layout, "compact");
});

test("every card has a picture, and the pictures have no words", () => {
  for (const key of S.CARD_KEYS) {
    const svg = S.starterPicture(key);
    assert.match(svg, /^<svg [^>]*viewBox="0 0 120 48"[^>]*>.*<\/svg>$/, key);
    assert.doesNotMatch(svg, /<text|<title|undefined|NaN/, key);
  }
  assert.equal(S.starterPicture("nope"), "");
});

test("a starter 2.8 registers is ready, opens, and its words are linted", () => {
  const own = loadModules(...LOGIC_UI_FILES);
  const start = own.EsphomeMrLogicUiStart;
  const opened = [];
  start.registerStarter("block-signals", { open: (config, ctx, ui) => opened.push([config, ctx, ui]), text: { title: "Block signals form" } });
  const cards = start.starterCards(fieldBoard()).cards;
  assert.equal(cards.find((card) => card.key === "block-signals").ready, true);
  assert.equal(cards.find((card) => card.key === "route-signal").ready, false);
  const config = fieldBoard();
  assert.equal(start.startStarter("block-signals", config, "ctx", "ui"), true);
  assert.equal(opened.length, 1);
  assert.equal(opened[0][0], config);
  const linted = JSON.stringify(plain([...own.EsphomeMrLogicUi.allText()]));
  assert.match(linted, /Block signals form/);
  assert.throws(() => start.registerStarter("approach-lighting", { open() {} }), /no starter called/);
  assert.throws(() => start.registerStarter("route-signal", {}), /open function/);
});

test("the starters part is registered for Field Logic, after Groups", () => {
  const html = fs.readFileSync(path.join(configuratorDir, "logic-ui-start.js"), "utf8");
  assert.match(html, /registerPart\(\{ id: "logic-starters", order: 85, modes: \["field"\], text: TEXT/);
});

// ===== Remote masts in Linked boards =======================================

test("a typed mast has the standard topic and no aspects, so it reads as stop", () => {
  assert.deepEqual(plain(L.typedItem("mast", " Up Home ")), {
    name: "Up Home", topic: "trains/track/signalmast/Up Home", aspects: [], tags: {}, diverging: [],
  });
  const config = fieldBoard();
  const typed = L.typedLinkedBoard("yard-ab12cd");
  typed.signals.masts = [L.typedItem("mast", "Up Home")];
  config.logic.remoteBoards = [typed];
  const found = L.resolveRemote(config, { board: "yard-ab12cd", mast: "Up Home" });
  assert.equal(found.kind, "mast");
  assert.equal(found.item.name, "Up Home");
  // Picked in a dropdown like a linked board's mast.
  const groups = plain(UI.itemChoices(config, "mast", { remote: true }));
  assert.deepEqual(groups.find((group) => group.label === "yard-ab12cd").options, [
    { value: { board: "yard-ab12cd", mast: "Up Home" }, text: "Up Home" },
  ]);
});

test("Linked boards count signals, and signals with no lights", () => {
  assert.equal(UI.TEXT.linkedCounts(2, 1, 0, 3), "2 sensors, 1 turnout, 3 signals");
  assert.equal(UI.TEXT.linkedCounts(1, 0, 2, 1), "1 sensor, 0 turnouts, 2 blocks, 1 signal");
});

test("Refresh says which signals are new, gone, or changed", () => {
  const north = fixture("masts-addressable");
  north.board.name = "kiama-north-k7m4x2";
  north.logic = { mode: "field" };
  const before = L.linkedBoardFromConfig(parseConfigFromYaml(generateYaml(north)));
  assert.ok(before.signals.masts.length >= 1, "the fixture has a mast");
  const first = before.signals.masts[0].name;
  assert.deepEqual(plain(L.linkedBoardChanges(before, plain(before))), []);

  const after = plain(before);
  after.signals.masts.push({ name: "Down Home", topic: "trains/track/signalmast/Down Home", aspects: ["Stop"], tags: { Stop: "stop" }, diverging: [] });
  after.logic.masts = [{ name: "Up Int 2", topic: "trains/track/signalmast/Up Int 2", aspects: ["Stop", "Clear"], tags: { Stop: "stop", Clear: "clear" }, diverging: [] }];
  after.signals.masts[0].tags = { ...after.signals.masts[0].tags, [after.signals.masts[0].aspects[0]]: "clear" };
  assert.deepEqual(plain(L.linkedBoardChanges(before, after)), [
    `signal mast "${first}" has different aspects or meanings`,
    'new signal mast "Down Home"',
    'new signal with no lights "Up Int 2"',
  ]);

  const moved = plain(before);
  moved.signals.masts[0].topic = "trains/elsewhere";
  assert.deepEqual(plain(L.linkedBoardChanges(before, moved)), [`signal mast "${first}" has a new topic`]);

  const gone = plain(before);
  gone.signals.masts = [];
  assert.deepEqual(plain(L.linkedBoardChanges(before, gone)), plain(before.signals.masts.map((mast) => `signal mast "${mast.name}" is gone`)));
});

test("linking a typed board's file says what its typed masts now read", () => {
  const typed = L.typedLinkedBoard("kiama-north-k7m4x2");
  typed.signals.masts = [L.typedItem("mast", "Nowhere")];
  const north = fixture("masts-addressable");
  north.board.name = "kiama-north-k7m4x2";
  const fromFile = L.linkedBoardFromConfig(parseConfigFromYaml(generateYaml(north)));
  const changes = [...L.linkedBoardChanges(typed, fromFile)];
  assert.ok(changes.includes('signal mast "Nowhere" is gone'));
  assert.ok(changes.some((change) => change.startsWith("new signal mast")));
});

test("a hand-edited linked board with odd masts does not stop Refresh", () => {
  const before = { name: "x", blocks: [], points: [], signals: { masts: [null, { name: "A", topic: "t", aspects: "no" }] }, logic: { masts: "no" } };
  const after = { name: "x", blocks: [], points: [], signals: "no", logic: {} };
  assert.deepEqual(plain(L.linkedBoardChanges(before, after)), ['signal mast "A" is gone']);
});

// ===== The Download page ===================================================

test("the Download page shows the Logic version in Field Logic only", () => {
  assert.equal(S.downloadLogic(normalizeConfig(fixture("my-first-board"))), null);
  const config = fieldBoard();
  const info = S.downloadLogic(config);
  assert.equal(info.title, "Logic version");
  assert.equal(info.hint.startsWith("Matches the board when it is running what you checked"), true);
  assert.equal(info.version, L.versionCode(config));
  assert.match(info.version, /^[0-9a-f]{8}$/);
  assert.equal(info.errorsNote, "");
});

test("beside it: the warnings about the logic, with their links; errors are only pointed to", () => {
  const config = fixture("my-first-board");
  const sensor = config.blocks[0].name;
  config.logic = { mode: "field", blocks: [1, 2, 3].map((n) => ({ name: `B${n}`, sensors: [sensor] })) };
  normalizeConfig(config);
  const validation = validateConfig(config);
  const info = plain(S.downloadLogic(config, validation));
  assert.ok(validation.warnings.length > info.warnings.length, "warnings about other pages stay in the box at the top");
  assert.equal(info.warnings.length, 1);
  assert.match(info.warnings[0].text, /is in 3 blocks/);
  assert.deepEqual(info.warnings[0].link, { view: "logic", part: "logic-blocks" });

  config.logic.blocks.push({ name: "", sensors: [] });
  const broken = S.downloadLogic(config);
  const errors = validateConfig(config).errors.length;
  assert.ok(errors > 0);
  assert.match(broken.errorsNote, new RegExp(`^${errors} problems? must be fixed before you can download`));
});

test("the Download page has the Logic version box; its words are in TEXT", () => {
  const html = fs.readFileSync(path.join(configuratorDir, "index.html"), "utf8");
  const from = html.indexOf('data-panel="yaml"');
  const page = html.slice(from, html.indexOf("</section>", from));
  assert.match(page, /<div class="card logic-download" id="logic-download" hidden><\/div>/);
});

test("typed masts add nothing to the YAML until a rule reads them", () => {
  const config = fieldBoard({ share: false });
  const without = generateYaml(config);
  const typed = L.typedLinkedBoard("yard-ab12cd");
  typed.signals.masts = [L.typedItem("mast", "Up Home")];
  config.logic.remoteBoards = [typed];
  assert.equal(generateYaml(config).split("\n").slice(2).join("\n"), without.split("\n").slice(2).join("\n"));
  assert.deepEqual([...validateConfig(config).errors], []);
});

if (!process.exitCode) console.log("\nAll Logic page start tests passed.");
