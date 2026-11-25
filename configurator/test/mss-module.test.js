// The MSS page's picture of the whole module (logic-ui-mss-module.js): where
// the ends, tracks and junctions go. The layout is pure; no DOM here.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

const html = fs.readFileSync(path.join(configuratorDir, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script src="\.\/([^"]+)"><\/script>/g)].map((m) => m[1]);
const context = loadModules(...scripts.slice(scripts.indexOf("generator.js"), scripts.indexOf("app.js")));
const { EsphomeMrLogicUiMssModule: Module } = context;
const plain = (value) => JSON.parse(JSON.stringify(value));
const S = Module.SIZES;

const end = (name, track = 1) => ({ end: name, track });
const leg = (junction, n) => ({ junction, leg: n });
const blocks = (n) => Array.from({ length: n }, () => ({ sensors: [], turnouts: [] }));
const boundaries = (n, signals = {}) => Array.from({ length: n }, () => ({ sensors: [], towardsFrom: signals.from ?? null, towardsTo: signals.to ?? null }));
const track = (from, to, n = 1, signals) => ({ from, to, blocks: blocks(n), boundaries: boundaries(n - 1, signals) });
const turnout = (legs, position, diverging) => ({ legs, turnouts: [{ turnout: "P1", position }], ...(diverging ? { diverging: true } : {}) });
const turnoutLeft = (name = "J1") => ({ name, shape: "turnout-left", sensors: [], masts: { 1: "Home", 2: null, 3: null },
  routes: [turnout([1, 2], "closed"), turnout([1, 3], "thrown", true)] });
const board = (mss) => ({ logic: { mode: "mss", mss } });
const picture = (mss) => plain(Module.layout(board(mss)));
const endAt = (shape, name, n = 1) => shape.ends.find((e) => e.name === name && e.track === n);
const legAt = (shape, n, junction = 0) => shape.junctions[junction].legs.find((l) => l.leg === n);

test("plain track: End A on the left, End B on the right, blocks and the block boundary left to right", () => {
  const shape = picture({ ends: [{ name: "A", tracks: 1 }, { name: "B", tracks: 1 }], tracks: [track(end("A"), end("B"), 2, { from: "W west", to: "W east" })] });
  assert.equal(shape.rows, false);
  const a = endAt(shape, "A");
  const b = endAt(shape, "B");
  assert.equal(a.x, S.left);
  assert.equal(a.faces, 1);
  assert.equal(b.faces, -1);
  assert.equal(a.y, b.y);
  assert.ok(b.x > a.x);
  assert.equal(shape.width, b.x + S.right);
  const items = shape.tracks[0].items;
  assert.deepEqual(items.map((i) => `${i.kind} ${i.index}`), ["block 0", "boundary 0", "block 1"]);
  assert.ok(items[0].x < items[1].x && items[1].x < items[2].x);
  // The signal for trains heading towards From (End A, on the left) points left.
  assert.equal(items[1].left, "W west");
  assert.equal(items[1].right, "W east");
});

test("a turnout, left: the diverging leg goes up a row, and the ends past it line up at the right edge", () => {
  const shape = picture({
    ends: [{ name: "A", tracks: 1 }, { name: "B", tracks: 1 }, { name: "C", tracks: 1 }],
    junctions: [turnoutLeft()],
    tracks: [track(end("A"), leg("J1", 1), 2), track(leg("J1", 2), end("B"), 1), track(leg("J1", 3), end("C"), 2)],
  });
  const [l1, l2, l3] = [1, 2, 3].map((n) => legAt(shape, n));
  assert.equal(l1.side, -1);
  assert.equal(l2.side, 1);
  assert.equal(l1.y, l2.y);
  assert.equal(l3.y, l1.y - S.lane);
  assert.equal(l2.x - l1.x, S.junction);
  assert.equal(l1.signal, "Home");
  assert.equal(endAt(shape, "A").y, l1.y);
  assert.equal(endAt(shape, "B").y, l2.y);
  assert.equal(endAt(shape, "C").y, l3.y);
  assert.equal(endAt(shape, "B").x, endAt(shape, "C").x);
  assert.equal(shape.junctions[0].paths.length, 2);
  assert.ok(shape.junctions[0].paths[1].diverging);
  assert.equal(shape.junctions[0].label, "Junction J1");
});

test("a junction met by a leg on its right side is turned round to face the track", () => {
  const shape = picture({
    ends: [{ name: "A", tracks: 1 }, { name: "B", tracks: 1 }],
    junctions: [turnoutLeft()],
    tracks: [track(end("A"), leg("J1", 2), 1), track(leg("J1", 1), end("B"), 1)],
  });
  assert.equal(legAt(shape, 2).side, -1);
  assert.equal(legAt(shape, 1).side, 1);
  assert.ok(legAt(shape, 1).x > legAt(shape, 2).x);
  assert.ok(endAt(shape, "B").x > legAt(shape, 1).x);
});

test("a track drawn right to left: its blocks are mirrored and its signals swap sides", () => {
  const shape = picture({
    ends: [{ name: "A", tracks: 1 }, { name: "B", tracks: 1 }],
    junctions: [turnoutLeft()],
    tracks: [track(leg("J1", 1), end("A"), 2, { from: "W", to: "E" }), track(leg("J1", 2), end("B"), 1)],
  });
  const t = shape.tracks.find((x) => x.index === 0);
  const [first, boundary, last] = t.items.slice().sort((p, q) => p.x - q.x);
  assert.equal(first.index, 1, "block 2 is on the left");
  assert.equal(last.index, 0);
  // From is the junction, on the right: trains heading towards it go right.
  assert.equal(boundary.right, "W");
  assert.equal(boundary.left, "E");
});

test("an end's other tracks sit on the rows beside its first", () => {
  const shape = picture({
    ends: [{ name: "A", tracks: 2 }, { name: "B", tracks: 2 }],
    tracks: [track(end("A", 1), end("B", 1), 2), track(end("A", 2), end("B", 2), 1)],
  });
  assert.equal(shape.rows, false);
  assert.equal(endAt(shape, "A", 2).x, endAt(shape, "A", 1).x);
  assert.equal(endAt(shape, "A", 2).y, endAt(shape, "A", 1).y + S.lane);
  assert.equal(endAt(shape, "B", 2).y, endAt(shape, "B", 1).y + S.lane);
  assert.equal(endAt(shape, "B", 2).x, endAt(shape, "B", 1).x, "lined up at the right edge");
  assert.equal(endAt(shape, "A", 1).label, "End A, track 1");
});

test("a crossover between two tracks: legs 1 and 2 on one row, 3 and 4 on the next", () => {
  const shape = picture({
    ends: [{ name: "A", tracks: 2 }, { name: "B", tracks: 2 }],
    junctions: [{ name: "X", shape: "crossover", masts: {}, routes: [
      { legs: [1, 2], turnouts: [] }, { legs: [3, 4], turnouts: [] }, { legs: [1, 4], turnouts: [], diverging: true }, { legs: [3, 2], turnouts: [], diverging: true }] }],
    tracks: [track(end("A", 1), leg("X", 1)), track(end("A", 2), leg("X", 3)), track(leg("X", 2), end("B", 1)), track(leg("X", 4), end("B", 2))],
  });
  assert.equal(shape.rows, false);
  assert.equal(legAt(shape, 1).y, legAt(shape, 2).y);
  assert.equal(legAt(shape, 3).y, legAt(shape, 1).y + S.lane);
  assert.equal(endAt(shape, "A", 2).y, legAt(shape, 3).y);
  assert.equal(endAt(shape, "B", 2).y, legAt(shape, 4).y);
  assert.equal(shape.tracks.length, 4);
});

test("tracks not joined to the rest start a row underneath; dead ends and places not picked show", () => {
  const shape = picture({
    ends: [{ name: "A", tracks: 1 }, { name: "B", tracks: 1 }],
    tracks: [track(end("A"), null), track(null, null)],
  });
  assert.equal(shape.tracks.length, 2);
  const [first, second] = shape.tracks;
  assert.equal(second.y1, first.y1 + S.lane);
  assert.equal(second.x1, first.x1);
  assert.deepEqual(shape.places.map((p) => p.kind).sort(), ["dead", "dead", "none"]);
  assert.ok(shape.places.some((p) => p.label === "Pick a place"));
});

test("a junction with no tracks yet still shows; an empty module draws nothing", () => {
  const shape = picture({ ends: [], junctions: [turnoutLeft()], tracks: [] });
  assert.equal(shape.junctions.length, 1);
  const empty = picture({});
  assert.deepEqual([empty.tracks.length, empty.junctions.length, empty.ends.length], [0, 0, 0]);
});

test("two tracks over each other: one track to a row instead", () => {
  const shape = picture({
    ends: [{ name: "A", tracks: 1 }, { name: "B", tracks: 1 }],
    tracks: [track(end("A"), end("B"), 2), track(end("A"), end("B"), 1)],
  });
  assert.equal(shape.rows, true);
  assert.equal(shape.tracks.length, 2);
  assert.equal(shape.tracks[1].y1, shape.tracks[0].y1 + S.lane);
  assert.deepEqual(shape.junctions, []);
});

// ===== Try it: the built names, a train's path, and a train run =============

const { EsphomeMr: M, EsphomeMrMssBuilder: Builder, EsphomeMrLogicTry: Try } = context;
const CATS = ["R292", "R285", "ADV_NORM", "R281", "R282", "R283", "R286"];
const junctionCase = JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "cases", "mss", "mss-junction-turnout.json"), "utf8")).module;

// A full board for the case's module: its sensors, turnout and masts (with the CATS aspects), in MSS Logic.
function junctionBoard() {
  const config = M.myFirstBoardPreset();
  const pins = ["GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO32", "GPIO35", "GPIO34"];
  config.blocks = junctionCase.sensors.map((s, i) => ({ name: s, topic: M.topicFor("block", s), topicCustom: false, gpio: pins[i], inverted: true, debounce: "500ms" }));
  config.points = junctionCase.turnouts.map((t, i) => ({ name: t, topic: M.topicFor("point", t), channel: i }));
  config.signals = { mode: "addressable", masts: junctionCase.masts.map((name, i) => ({
    name, topic: M.topicFor("signal", name), topicCustom: false, mode: "addressable", pin: ["GPIO16", "GPIO17", "GPIO19"][i],
    lamps: [{ name: "Head", count: 1 }],
    aspects: CATS.map((label, k) => ({ label, states: [`${label}; Lit; Unheld`], ...(k === 0 ? { startup: true } : {}), lamps: [{ color: k === 0 ? "red" : "green", mode: "steady" }] })),
  })) };
  config.logic = { mode: "mss", mss: plain(junctionCase.mss) };
  return config;
}

test("namesOf: each block's and each signal's built name, by where it is in the description", () => {
  const names = plain(Builder.namesOf(junctionBoard()));
  assert.deepEqual(Object.keys(names.blocks), ["0:0", "0:1", "0:2", "1:0", "2:0"]);
  const real = names.signals.filter((s) => !s.virtual);
  assert.deepEqual(real, [
    { name: "Outer", virtual: false, track: 0, boundary: 0, key: "towardsTo" },
    { name: "Dist", virtual: false, track: 0, boundary: 1, key: "towardsTo" },
    { name: "Home", virtual: false, junction: 0, leg: 1 },
  ]);
  // A boundary side with no signal gets one with no lights; it is listed too.
  assert.ok(names.signals.some((s) => s.virtual && s.track === 0 && s.boundary === 0 && s.key === "towardsFrom"));
});

test("trainRoute: in at End A, along the route the turnout sets, out at End B or End C", () => {
  const config = junctionBoard();
  const names = Builder.namesOf(config).blocks;
  const main = plain(Module.trainRoute(config, { end: "A", track: 1 }, () => "closed"));
  assert.deepEqual(main.blocks, [names["0:0"], names["0:1"], names["0:2"], names["1:0"]]);
  assert.deepEqual(main.masts, ["Outer", "Dist", "Home"]);
  assert.deepEqual(main.exit, { end: "B", track: 1 });
  const branch = plain(Module.trainRoute(config, { end: "A", track: 1 }, () => "thrown"));
  assert.deepEqual(branch.blocks.slice(-1), [names["2:0"]]);
  assert.deepEqual(branch.exit, { end: "C", track: 1 });
  // The other way: from End B, back through the junction to End A. Those
  // signals have no lights here, so none is met.
  const back = plain(Module.trainRoute(config, { end: "B", track: 1 }, () => "closed"));
  assert.deepEqual(back.blocks, [names["1:0"], names["0:2"], names["0:1"], names["0:0"]]);
  assert.deepEqual(back.masts, []);
  assert.deepEqual(back.exit, { end: "A", track: 1 });
  // From End C with the turnout set for the main line: no route, so it stops at the junction.
  const stuck = plain(Module.trainRoute(config, { end: "C", track: 1 }, () => "closed"));
  assert.equal(stuck.stop, "route");
  assert.deepEqual(stuck.blocks, [names["2:0"]]);
  assert.equal(stuck.exit, null);
});

test("trainStarts: every end track a track uses", () => {
  assert.deepEqual(plain(Module.trainStarts(junctionBoard())).map((s) => s.label), ["End A", "End B", "End C"]);
});

test("Try it runs an MSS board: a train from End A gives the tumbledown behind it", () => {
  const config = junctionBoard();
  const session = Try.createSession(config);
  assert.ok(session, "an MSS board has rules to run");
  const route = Module.trainRoute(config, { end: "A", track: 1 }, (name) => session.turnoutPosition(name) || "closed");
  const steps = Try.runTrain(session, { path: route.blocks, masts: route.masts });
  const tagOf = (step, name) => step.masts.find((m) => m.name === name)?.tag;
  const names = Builder.namesOf(config).blocks;
  const before = steps[0];
  const occupied = (step) => step.blocks.filter((b) => b.occupied).map((b) => b.name);
  const inBlock2 = steps.find((step) => JSON.stringify(occupied(step)) === JSON.stringify([names["0:1"]]));
  assert.ok(inBlock2, "a step with the train in block 2 alone");
  assert.notEqual(tagOf(before, "Outer"), "stop");
  assert.equal(tagOf(inBlock2, "Outer"), "stop", "Outer, behind the train, is at Stop");
  assert.notEqual(tagOf(inBlock2, "Dist"), "stop", "Dist, ahead of it, protects a clear block");
  assert.equal(occupied(steps[steps.length - 1]).length, 0, "the train is gone at the end");
});
