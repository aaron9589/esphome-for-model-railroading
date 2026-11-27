// The MSS page's strip editor for tracks (work item 4.2b): its pure functions,
// and that a track edited with them builds without problems.
import assert from "node:assert/strict";
import { loadModules, test } from "./harness.js";

// Every Logic page file, in index.html's order (as in logic-page.test.js).
const LOGIC_UI_FILES = ["generator.js", "logic-yaml.js", "logic.js", "logic-checker.js", "logic-try.js", "logic-ui.js", "logic-ui-masts.js", "logic-ui-ends.js", "logic-ui-views.js", "logic-ui-start.js", "logic-ui-try.js", "logic-starters.js", "logic-starters-sections.js", "logic-starters-signals.js", "mss-builder.js", "plan-builder.js", "plan-edit.js", "logic-ui-mss-steps.js", "logic-ui-mss-tracks.js", "logic-ui-mss-junctions.js", "logic-summary.js"];
const context = loadModules(...LOGIC_UI_FILES);
const { EsphomeMr, EsphomeMrMssBuilder: B, EsphomeMrLogicUiMssTracks: T } = context;
const { myFirstBoardPreset, topicFor } = EsphomeMr;

const plain = (value) => JSON.parse(JSON.stringify(value));
const same = (actual, expected, ...message) => assert.deepEqual(plain(actual), plain(expected), ...message);
const CATS = ["R292", "R285", "ADV_NORM", "R281", "R282", "R283", "R286"];

function mast(name, pin) {
  return {
    name, topic: topicFor("signal", name), topicCustom: false, mode: "addressable", pin,
    lamps: [{ name: "Head", count: 1 }],
    aspects: CATS.map((label, i) => ({ label, states: [`${label}; Lit; Unheld`], ...(i === 0 ? { startup: true } : {}), lamps: [{ color: i === 0 ? "red" : "green", mode: "steady" }] })),
  };
}

// A module with ends A and B (one track each), three sensors, a turnout and a signal, and no tracks.
function board() {
  const config = myFirstBoardPreset();
  config.blocks = ["S1", "S2", "S3", "S1/S2 optical"].map((name, i) => ({ name, topic: topicFor("block", name), topicCustom: false, gpio: ["GPIO14", "GPIO27", "GPIO26", "GPIO25"][i], inverted: true, debounce: "500ms" }));
  config.points = [{ name: "P1", topic: topicFor("point", "P1"), channel: 0 }];
  config.signals = { mode: "addressable", masts: [mast("West", "GPIO16")] };
  config.logic = { mode: "mss", mss: { ends: [{ name: "A", tracks: 1 }, { name: "B", tracks: 1 }], tracks: [], junctions: [] } };
  return config;
}

const tracksProblems = (config) => B.problems(config).filter((p) => p.where.part === B.PARTS.tracks);

test("a new track starts at the first free end track and has one block", () => {
  const config = board();
  const track = T.addTrack(config);
  same(track, { from: { end: "A", track: 1 }, to: { end: "B", track: 1 }, blocks: [{ sensors: [], turnouts: [] }], boundaries: [] });
  same(T.tracksOf(config).length, 1);
  same(T.freePlaces(config), []);
  const second = T.addTrack(config);
  same([second.from, second.to], [null, null]);
});

test("place choices list end tracks and junction legs, and the dead end for To", () => {
  const config = board();
  config.logic.mss.junctions = [{ name: "J1", routes: [{ legs: [1, 2] }, { legs: [1, 3] }] }];
  const texts = (groups) => groups.flatMap((g) => g.options.map((o) => o.text));
  same(texts(T.placeChoices(config)), ["End A, track 1", "End B, track 1", "Junction J1, leg 1", "Junction J1, leg 2", "Junction J1, leg 3"]);
  same(T.placeChoices(config, { to: true })[0].options, [{ value: null, text: T.TEXT.deadEnd }]);
  same(T.placeText(null), T.TEXT.deadEnd);
});

test("splitting adds a block and a boundary; removing takes a block and its boundary", () => {
  const config = board();
  const track = T.addTrack(config);
  T.splitBlock(track, 0);
  assert.equal(track.blocks.length, 2);
  assert.equal(track.boundaries.length, 1);
  assert.equal(T.addBoundary(track), 1);
  assert.equal(track.blocks.length, 3);
  assert.equal(track.boundaries.length, 2);
  track.boundaries[0].towardsFrom = "West";
  track.boundaries[1].towardsTo = "West";
  assert.equal(T.removeBlock(track, 1), true);
  same(track.boundaries.map((b) => [b.towardsFrom, b.towardsTo]), [["West", null]]);
  assert.equal(track.blocks.length, 2);
  assert.equal(T.removeBlock(track, 1), true);
  assert.equal(T.removeBlock(track, 0), false, "the last block stays");
  assert.equal(track.boundaries.length, 0);
});

test("moving a block swaps it with its neighbour and keeps one boundary between each two", () => {
  const track = { blocks: [{ sensors: ["S1"] }, { sensors: ["S2"] }, { sensors: ["S3"] }], boundaries: [{}, {}] };
  assert.equal(T.moveBlock(track, 0, 1), 1);
  same(track.blocks.map((b) => b.sensors[0]), ["S2", "S1", "S3"]);
  assert.equal(T.moveBlock(track, 0, -1), -1);
  assert.equal(T.moveBlock(track, 2, 1), -1);
  assert.equal(track.boundaries.length, 2);
});

test("sensors, turnouts and signals are edited in place", () => {
  const block = {};
  assert.equal(T.addSensor(block, "S1"), true);
  assert.equal(T.addSensor(block, "S1"), false);
  assert.equal(T.addSensor(block, ""), false);
  T.removeSensor(block, "S1");
  same(block.sensors, []);
  const entry = T.addTurnout(block);
  same(entry, { turnout: "", position: "closed" });
  T.removeTurnout(block, 0);
  same(block.turnouts, []);
  const boundary = {};
  T.setSignal(boundary, "from", "West");
  T.setSignal(boundary, "to", "");
  same(boundary, { towardsFrom: "West", towardsTo: null });
  const track = { from: { end: "A", track: 1 } };
  T.setPlace(track, "to", { junction: "J1", leg: 2 });
  T.setPlace(track, "from", null);
  same([track.from, track.to], [null, { junction: "J1", leg: 2 }]);
});

test("a through track is drawn as one, and a strip has a block and a boundary item each", () => {
  const config = board();
  const track = T.addTrack(config);
  const shape = T.stripShape(track);
  assert.equal(shape.through, true);
  same([shape.from, shape.to], ["End A, track 1", "End B, track 1"]);
  T.splitBlock(track, 0);
  const split = T.stripShape(track);
  assert.equal(split.through, false);
  same(split.items.map((i) => `${i.kind}${i.index}`), ["block0", "boundary0", "block1"]);
  assert.ok(split.width > shape.width);
});

test("a track edited with these functions builds with no problems, and problems come back by block and boundary", () => {
  const config = board();
  const track = T.addTrack(config);
  const before = T.trackProblems(B.problems(config), 0);
  assert.ok(before.blocks[0].length >= 1, "block 1 has no sensor");
  T.addSensor(track.blocks[0], "S1");
  T.splitBlock(track, 0);
  T.addSensor(track.blocks[1], "S2");
  T.addSensor(track.boundaries[0], "S1/S2 optical");
  T.setSignal(track.boundaries[0], "from", "West");
  T.addTurnout(track.blocks[1]);
  const open = T.trackProblems(B.problems(config), 0);
  assert.equal(open.blocks[1].length, 1, "a turnout with nothing picked is named at its block");
  track.blocks[1].turnouts[0].turnout = "P1";
  same(tracksProblems(config).filter((p) => p.level === "error"), []);
  assert.equal(T.problemTotal(T.trackProblems(B.problems(config), 0)), 0);
  T.removeSensor(track.boundaries[0], "S1/S2 optical");
  const warned = T.trackProblems(B.problems(config), 0);
  assert.equal(warned.boundaries[0].length, 1);
  const built = B.build(config);
  assert.ok(built.blocks.length >= 2);
});

test("the selection stays inside the track", () => {
  const track = { blocks: [{}, {}], boundaries: [{}] };
  same(T.fixSelection(track, { kind: "boundary", index: 0 }), { kind: "boundary", index: 0 });
  same(T.fixSelection(track, { kind: "boundary", index: 3 }), { kind: "block", index: 0 });
  same(T.fixSelection(track, { kind: "block", index: 5 }), { kind: "block", index: 0 });
  same(T.fixSelection(track, undefined), { kind: "block", index: 0 });
});

test("the part is registered for MSS mode only", () => {
  const parts = context.EsphomeMrLogicUi.allText().map(([id]) => id);
  assert.ok(parts.includes(B.PARTS.tracks));
});
