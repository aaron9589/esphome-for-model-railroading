// The MSS page's guided steps, Ends and Signals grid (work item 4.2a): their
// pure functions, the problems they show, and that the builder reads what they store.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

// Every Logic page file, in index.html's order (as in logic-page.test.js).
const LOGIC_UI_FILES = ["generator.js", "logic-yaml.js", "logic.js", "logic-checker.js", "logic-try.js", "logic-ui.js", "logic-ui-masts.js", "logic-ui-ends.js", "logic-ui-views.js", "logic-ui-start.js", "logic-ui-try.js", "logic-starters.js", "logic-starters-sections.js", "logic-starters-signals.js", "mss-builder.js", "plan-builder.js", "plan-edit.js", "logic-ui-mss-steps.js", "logic-ui-mss-tracks.js", "logic-ui-mss-junctions.js", "logic-summary.js"];
const context = loadModules(...LOGIC_UI_FILES);
const { EsphomeMr, EsphomeMrMssBuilder: B, EsphomeMrLogicUiMssSteps: S } = context;
const { myFirstBoardPreset, topicFor } = EsphomeMr;

const plain = (value) => JSON.parse(JSON.stringify(value));
const same = (actual, expected, ...message) => assert.deepEqual(plain(actual), plain(expected), ...message);

const CATS = ["R292", "R285", "ADV_NORM", "R281", "R282", "R283", "R286"];
const SENSOR_PINS = ["GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO32", "GPIO35", "GPIO34", "GPIO39"];
const MAST_PINS = ["GPIO16", "GPIO17", "GPIO19", "GPIO23", "GPIO18", "GPIO13"];

function mast(name, aspects = CATS, pin = "GPIO16") {
  return {
    name, topic: topicFor("signal", name), topicCustom: false, mode: "addressable", pin,
    lamps: [{ name: "Head", count: 1 }],
    aspects: aspects.map((label, i) => ({ label, states: [`${label}; Lit; Unheld`], ...(i === 0 ? { startup: true } : {}), lamps: [{ color: i === 0 ? "red" : "green", mode: "steady" }] })),
  };
}

// The turnout junction case's module, as a board.
const module = JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "cases", "mss", "mss-junction-turnout.json"), "utf8")).module;
function board() {
  const config = myFirstBoardPreset();
  config.board.name = "steps";
  config.blocks = module.sensors.map((s, i) => ({ name: s, topic: topicFor("block", s), topicCustom: false, gpio: SENSOR_PINS[i], inverted: true, debounce: "500ms" }));
  config.points = module.turnouts.map((t, i) => ({ name: t, topic: topicFor("point", t), channel: i }));
  config.signals = { mode: "addressable", masts: module.masts.map((m, i) => mast(m, CATS, MAST_PINS[i])) };
  config.logic = { mode: "mss", mss: plain(module.mss) };
  return config;
}
const empty = () => {
  const config = board();
  config.logic = { mode: "mss" };
  return config;
};

test("the page parts are registered for MSS mode only, in order, under the builder's ids", () => {
  const ids = [...context.EsphomeMrLogicUi.allText()].map(([id]) => id);
  for (const id of ["logic-mss-steps", B.PARTS.ends, B.PARTS.signals]) assert.ok(ids.includes(id), id);
  assert.ok(ids.indexOf("logic-mss-steps") < ids.indexOf(B.PARTS.ends));
  assert.ok(ids.indexOf(B.PARTS.ends) < ids.indexOf(B.PARTS.signals));
});

test("Try it is registered for both modes, so MSS Logic's steps link to it", () => {
  assert.equal(context.EsphomeMrLogicUi.hasPart("logic-try", "field"), true);
  assert.equal(context.EsphomeMrLogicUi.hasPart("logic-try", "mss"), true);
});

test("guided steps: empty module has nothing done; a described one has ends, tracks and signals done", () => {
  const none = S.guidedSteps(empty());
  same(none.map((s) => s.key), ["ends", "tracks", "junctions", "signals", "tryIt", "download"]);
  assert.ok(none.every((s) => !s.done));
  assert.equal(S.nextStep(none).key, "ends");
  const done = S.guidedSteps(board());
  same(done.filter((s) => s.done).map((s) => s.key), ["ends", "tracks", "junctions", "signals"]);
  assert.equal(S.nextStep(done).key, "tryIt");
  same(S.guidedSteps(board(), { tryIt: false }).map((s) => s.key).includes("tryIt"), false);
  assert.equal(S.guidedSteps(board())[0].part, "logic-mss-ends");
  assert.equal(S.guidedSteps(board()).at(-1).view, "yaml");
});

test("guided steps: a step with a problem is not done and counts it; the junctions step can be skipped", () => {
  const config = board();
  config.logic.mss.ends[2].tracks = 0;
  const ends = S.guidedSteps(config)[0];
  assert.equal(ends.done, false);
  assert.ok(ends.problems >= 1);
  const plain2 = board();
  plain2.logic.mss.junctions = [];
  plain2.logic.mss.tracks = plain2.logic.mss.tracks.slice(0, 1);
  const junctions = S.guidedSteps(empty()).find((s) => s.key === "junctions");
  assert.equal(junctions.optional, true);
  assert.notEqual(S.nextStep(S.guidedSteps(empty())).key, "junctions");
});

test("ends: add, name, count tracks, remove", () => {
  const config = empty();
  same(S.addEnd(config), { name: "A", tracks: 1 });
  S.addEnd(config);
  same(config.logic.mss.ends.map((e) => e.name), ["A", "B"]);
  S.removeEnd(config, 0);
  assert.equal(S.freeEndName(config), "A");
  const end = config.logic.mss.ends[0];
  assert.equal(S.setEndTracks(end, "2"), true);
  assert.equal(end.tracks, 2);
  for (const bad of ["", "0", "-1", "1.5", "x", null]) assert.equal(S.setEndTracks(end, bad), false, String(bad));
  assert.equal(end.tracks, 2);
});

test("ends: renaming follows the tracks, once, and not when the name is ambiguous", () => {
  const config = board();
  const [first] = config.logic.mss.ends;
  first.name = "Z";
  const moved = S.renameEnd(config, "A", "Z");
  assert.equal(moved, 1);
  same(config.logic.mss.tracks[0].from, { end: "Z", track: 1 });
  assert.equal(S.renameEnd(config, "A", "Z"), 0);
  config.logic.mss.ends[1].name = "Z";
  assert.equal(S.renameEnd(config, "B", "Z"), 0, "two ends now called Z");
  assert.equal(S.renameEnd(config, "Q", ""), 0);
});

test("ends: pin choices list free ESP pins and expander pins, and keep the end's own", () => {
  const config = board();
  config.expanders = [{ name: "MCP 1", address: "0x20", sda: "GPIO21", scl: "GPIO22" }];
  const end = config.logic.mss.ends[0];
  const esp = [{ value: "GPIO4", label: "GPIO4" }, { value: "GPIO2", label: "GPIO2" }];
  const choices = S.pinChoices(config, end, "pair", esp);
  same(choices.slice(0, 3).map((c) => c.value), ["", "GPIO4", "GPIO2"]);
  assert.ok(choices.some((c) => c.value === "mcp:0:0"));
  S.setPin(config, end, "pair", "GPIO4");
  assert.equal(end.pairPin, "GPIO4");
  assert.equal(S.pinValue(config, end, "pair"), "GPIO4");
  assert.ok(S.pinChoices(config, end, "pair", esp).some((c) => c.value === "GPIO4"), "own pin stays");
  assert.ok(!S.pinChoices(config, end, "led", esp).some((c) => c.value === "GPIO4"), "taken by the Pair button");
  S.setPin(config, end, "led", "mcp:0:3");
  same([end.ledExpander, end.ledPin], ["MCP 1", 3]);
  S.setPin(config, end, "led", "");
  assert.equal(end.ledPin, undefined);
  assert.equal(end.ledExpander, undefined);
});

test("signals: one row for each signal in order; diverging only on a leg with a diverging route", () => {
  const config = board();
  const rows = S.signalList(config);
  same(rows.map((r) => r.mast), ["Outer", "Dist", "Home"]);
  same(rows.map((r) => r.diverging), [false, false, true]);
  same(S.signalList(empty()), []);
});

test("signals: columns follow the optional indications, and Diverging ones come with a diverging leg", () => {
  const config = board();
  config.logic.mss.advanceApproach = false;
  config.logic.mss.approachDiverging = false;
  same(S.gridColumns(config), ["stop", "approach", "clear", "divergingClear", "divergingApproach"]);
  S.setIndication(config, "advance", true);
  S.setIndication(config, "approachDiverging", true);
  same(S.gridColumns(config), ["stop", "approach", "advance", "clear", "approachDiverging", "divergingClear", "divergingApproach"]);
  const grid = S.signalsGrid(config);
  same(Object.keys(grid.rows[0].cells), ["stop", "approach", "advance", "clear", "approachDiverging"]);
  same(Object.keys(grid.rows[2].cells), grid.columns);
});

test("signals: cells are prefilled from CATS, a pick is stored, and blank goes back to the prefill", () => {
  const config = board();
  delete config.logic.mss.masts;
  assert.equal(S.cellValue(config, "Home", "clear"), "R281");
  assert.equal(S.cellValue(config, "Home", "divergingClear"), "R283");
  S.setCell(config, "Home", "clear", "R285");
  same(config.logic.mss.masts, [{ mast: "Home", aspects: { clear: "R285" } }]);
  assert.equal(S.cellValue(config, "Home", "clear"), "R285");
  S.setCell(config, "Home", "clear", "");
  same(config.logic.mss.masts, [], "an empty row goes");
  S.setCell(config, "Home", "clear", "");
  same(config.logic.mss.masts, []);
});

test("signals: a mast with no CATS aspects has empty cells, and the builder reports each", () => {
  const config = board();
  delete config.logic.mss.masts;
  config.signals.masts.find((m) => m.name === "Outer").aspects = [{ label: "Red", states: ["Red"], lamps: [{ color: "red", mode: "steady" }] }, { label: "Green", states: ["Green"], lamps: [{ color: "green", mode: "steady" }] }];
  const outer = S.signalsGrid(config).rows.find((r) => r.mast === "Outer");
  assert.equal(outer.cells.stop.value, "");
  same(outer.cells.stop.aspects, ["Red", "Green"]);
  assert.ok(outer.problems.length >= 1);
  assert.ok(outer.problems.every((p) => p.where.part === B.PARTS.signals && p.where.mast === "Outer"));
  S.setCell(config, "Outer", "stop", "Red");
  S.setCell(config, "Outer", "approach", "Green");
  S.setCell(config, "Outer", "clear", "Green");
  assert.ok(S.problemsFor(config, B.PARTS.signals, { mast: "Outer" }).length >= 1, "Green means two things");
});

test("signals: Same as above copies the aspects the row above shares, where the mast has them", () => {
  const config = board();
  delete config.logic.mss.masts;
  S.setCell(config, "Outer", "clear", "R283");
  assert.equal(S.copyRowAbove(config, 1), 1);
  assert.equal(S.cellValue(config, "Dist", "clear"), "R283");
  assert.equal(S.copyRowAbove(config, 1), 0, "nothing more to copy");
  assert.equal(S.copyRowAbove(config, 0), 0, "no row above the first");
  config.signals.masts.find((m) => m.name === "Home").aspects.splice(5, 1);
  assert.equal(S.copyRowAbove(config, 2), 0, "Home has no R283, so it keeps its own");
  assert.equal(S.cellValue(config, "Home", "clear"), "R281");
});

test("signals: approach lighting is stored on the signal's row and the builder reads it", () => {
  const config = board();
  delete config.logic.mss.masts;
  const choices = S.approachChoices(config);
  assert.equal(choices[0].label, "Blocks");
  const block = choices[0].options[0].value;
  S.setApproachLight(config, "Outer", block);
  assert.equal(S.approachLight(config, "Outer"), block);
  same(config.logic.mss.masts, [{ mast: "Outer", approachLight: block }]);
  assert.equal(B.build(config).masts.find((m) => m.mast === "Outer").approachLight, block);
  S.setCell(config, "Outer", "clear", "R281");
  S.setApproachLight(config, "Outer", "");
  same(config.logic.mss.masts, [{ mast: "Outer", aspects: { clear: "R281" } }]);
  S.setCell(config, "Outer", "clear", "");
  same(config.logic.mss.masts, []);
});

test("problems are found by part and item", () => {
  const config = board();
  config.logic.mss.ends[0].name = "";
  same(S.problemsFor(config, B.PARTS.ends, { end: 0 }).map((p) => p.where.end), [0]);
  same(S.problemsFor(config, B.PARTS.ends, { end: 1 }), []);
});

test("every word the part shows is plain: no spec-only terms", () => {
  const SPEC_ONLY = /\b(scans?|scanning|latch(es|ed)?|interpreters?|rule tables?|phases?|resources?|layers?|tags?|tagged)\b/i;
  const found = [];
  const walk = (value, where) => {
    if (typeof value === "string") { if (SPEC_ONLY.test(value)) found.push(where); } else if (typeof value === "function") walk(value(2), where);
    else Object.entries(value).forEach(([k, v]) => walk(v, `${where}.${k}`));
  };
  walk(S.TEXT, "TEXT");
  same(found, []);
  same(S.TEXT.indications, B.TEXT.indications);
});
