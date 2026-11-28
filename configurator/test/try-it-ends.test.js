// Try it with plant ends (spec, Plant ends: "Try it treats each end's two
// values as remote inputs"; Checking in the browser). Work item 3.4: ends are
// inputs, and a pretend neighbour stands in for the board next door.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

const LOGIC_UI_FILES = ["generator.js", "logic-yaml.js", "logic.js", "logic-checker.js", "logic-try.js", "logic-ui.js", "logic-ui-masts.js", "logic-ui-ends.js", "logic-ui-views.js", "logic-ui-start.js"];
const context = loadModules(...LOGIC_UI_FILES);
const { EsphomeMrLogicTry: Try, EsphomeMrLogicChecker: Checker } = context;

const plain = (value) => JSON.parse(JSON.stringify(value));
const readCase = (name) => JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "cases", `${name}.json`), "utf8"));

// The west board of "three boards in a row": two ends A and B of two tracks each.
// North Home reads what end B track 1 hears (its block, and its mast) and North
// block holds that block too; South Home likewise with end A track 1.
const west = () => readCase("ends-three-boards-turned").boards.west;
const key = (session, label) => session.inputs().find((input) => input.label === label)?.key;
const input = (session, label) => session.inputs().find((input) => input.label === label);
const mast = (session, name) => session.view().masts.find((m) => m.name === name);
const tags = (session, end, track) => session.neighbours().find((n) => n.end === end).tracks.find((t) => t.track === track).signals.map((s) => s.tag);

const BLOCK_B1 = "End B, track 1: the block beyond";
const MAST_B1 = "End B, track 1: the signal beyond";
const LINK_B = "End B: the board beyond";

test("a board with ends has end inputs, which start paired, heard, clear and Stop", () => {
  const session = Try.createSession(west());
  const labels = session.inputs().map((i) => i.label);
  for (const label of [LINK_B, BLOCK_B1, MAST_B1, "End A: the board beyond"]) assert.ok(labels.includes(label), label);
  assert.equal(input(session, LINK_B).value, "heard");
  assert.equal(input(session, BLOCK_B1).value, "clear");
  assert.equal(input(session, MAST_B1).value, "stop");
  // Track 2 of each end is not read by any rule, so it is not offered.
  assert.ok(!labels.includes("End B, track 2: the block beyond"));
  assert.deepEqual(plain(session.view().ends.map((e) => e.state)), ["heard", "heard"]);
});

test("not known, not paired and not heard all read safe: occupied, and Stop", () => {
  const session = Try.createSession(west());
  session.advance(500);
  assert.equal(mast(session, "North Home").meaning, "Approach");
  session.setInput(key(session, MAST_B1), "clear");
  session.advance(500);
  assert.equal(mast(session, "North Home").meaning, "Clear");
  // The block beyond not known reads occupied: the block is occupied, the signal Stop.
  session.setInput(key(session, BLOCK_B1), "unknown");
  session.advance(500);
  assert.equal(session.blockOccupied("North block"), true);
  assert.equal(mast(session, "North Home").meaning, "Stop");
  session.setInput(key(session, BLOCK_B1), "clear");
  session.advance(500);
  assert.equal(mast(session, "North Home").meaning, "Clear");
  // The signal beyond not known reads Stop, as a stop does.
  session.setInput(key(session, MAST_B1), "unknown");
  session.advance(500);
  assert.equal(mast(session, "North Home").meaning, "Approach");
  session.setInput(key(session, MAST_B1), "clear");
  // Not paired, and paired but not heard, hide a clear block and a clear signal.
  for (const link of ["none", "unheard"]) {
    session.setInput(key(session, LINK_B), "heard");
    session.advance(500);
    assert.equal(mast(session, "North Home").meaning, "Clear", link);
    session.setInput(key(session, LINK_B), link);
    session.advance(500);
    assert.equal(session.blockOccupied("North block"), true, link);
    assert.equal(mast(session, "North Home").meaning, "Stop", link);
    assert.equal(session.view().ends.find((e) => e.name === "B").state, link === "none" ? "empty" : "unheard");
  }
  // The end of the line is clear, and its signal Stop.
  session.setInput(key(session, LINK_B), "end");
  session.advance(500);
  assert.equal(session.blockOccupied("North block"), false);
  assert.equal(mast(session, "North Home").meaning, "Approach");
  assert.equal(session.view().ends.find((e) => e.name === "B").text, "End of the line");
});

test("the end inputs say what not known reads as, in plain words", () => {
  const session = Try.createSession(west());
  session.setInput(key(session, BLOCK_B1), "unknown");
  assert.match(Try.readsAs(input(session, BLOCK_B1)), /occupied/);
  assert.match(Try.readsAs(input(session, MAST_B1), "unknown"), /Stop/);
  assert.match(Try.readsAs(input(session, LINK_B), "none"), /occupied/);
  assert.equal(Try.valueLabel(input(session, LINK_B), "unheard"), "Paired, not heard");
  assert.equal(Try.valueLabel(input(session, MAST_B1), "advance"), "Advance Approach");
});

test("a pretend neighbour's blocks drive what this board hears", () => {
  const session = Try.createSession(west());
  session.setNeighbour("B", true);
  session.advance(500);
  // Its inputs are its to set now.
  assert.equal(input(session, BLOCK_B1).driven, true);
  assert.throws(() => session.setInput(key(session, BLOCK_B1), "occupied"), /pretend neighbour/);
  assert.equal(mast(session, "North Home").meaning, "Clear");
  assert.equal(session.blockOccupied("North block"), false);
  // A train in its nearest block holds this board's block, and its signal Stop.
  session.setBlock({ pretend: "B", track: 1, at: 1 }, true, { scan: true });
  session.advance(500);
  assert.equal(input(session, BLOCK_B1).value, "occupied");
  assert.equal(session.blockOccupied("North block"), true);
  assert.equal(mast(session, "North Home").meaning, "Stop");
  // A train further out only changes the signal this board reads.
  session.setBlock({ pretend: "B", track: 1, at: 1 }, false);
  session.setBlock({ pretend: "B", track: 1, at: 2 }, true, { scan: true });
  session.advance(500);
  assert.equal(input(session, MAST_B1).value, "approach");
  assert.equal(session.blockOccupied("North block"), false);
  assert.equal(mast(session, "North Home").meaning, "Clear");
  // Switched off, the hand-set inputs are back as they were.
  session.setNeighbour("B", false);
  session.advance(500);
  assert.equal(input(session, BLOCK_B1).driven, undefined);
  assert.equal(input(session, BLOCK_B1).value, "clear");
  assert.equal(input(session, MAST_B1).value, "stop");
  assert.equal(mast(session, "North Home").meaning, "Approach");
});

test("what this board offers reaches the pretend neighbour", () => {
  const session = Try.createSession(west());
  session.setNeighbour("B", true);
  session.advance(500);
  // Track 2 of end B is the one this board signals (South Home), so trains run into this board.
  const [one, two] = session.neighbours().find((n) => n.end === "B").tracks;
  assert.equal(one.direction, "away");
  assert.equal(two.direction, "into");
  assert.equal(two.hears.occupied, false);
  session.setInput(key(session, "South in"), "occupied");
  session.advance(500);
  assert.equal(two.hears.occupied, true);
  assert.equal(session.neighbours().find((n) => n.end === "B").tracks[1].hears.occupied, true);
  // Its signal facing this board's block shows Approach: one step on from Stop.
  assert.equal(tags(session, "B", 2)[0], "approach");
  session.setInput(key(session, "South in"), "clear");
  session.advance(500);
  assert.equal(session.neighbours().find((n) => n.end === "B").tracks[1].hears.occupied, false);
});

test("a train crosses the joint and the signals tumble down across it", () => {
  const session = Try.createSession(west());
  session.setNeighbour("B", true);
  session.advance(500);
  // Away from this board: through North block, then the neighbour's blocks 1, 2 and 3.
  const path = Try.crossPath(session, ["North block"], { end: "B", track: 1 });
  assert.deepEqual(plain(path.slice(1).map((ref) => ref.at)), [1, 2, 3]);
  assert.equal(Try.refName(path[1]), "Pretend neighbour at end B, track 1, block 1");
  const steps = Try.runTrain(session, { path, masts: ["North Home"], neighbours: [{ end: "B", track: 1 }] });
  const by = (label) => steps.find((step) => step.label === label);
  const signals = (label) => plain(by(label).neighbours[0].signals.map((s) => s.tag));
  const home = (label) => by(label).masts[0].meaning;
  assert.deepEqual(signals("Before the train"), ["clear", "clear", "clear"]);
  assert.equal(home("Before the train"), "Clear");
  // On this board, the train in North block stops the signal behind it.
  assert.equal(home("Train enters North block"), "Stop");
  const N = (n) => `Pretend neighbour at end B, track 1, block ${n}`;
  // Crossing: a train in block 1 holds this board's block, and block 1's signal.
  assert.deepEqual(signals(`Train enters ${N(1)}`), ["stop", "clear", "clear"]);
  assert.equal(home(`Train enters ${N(1)}`), "Stop");
  // Then the signal behind the train steps down in turn: stop, approach, advance, clear.
  assert.deepEqual(signals(`Train enters ${N(2)}`), ["stop", "stop", "clear"]);
  assert.deepEqual(signals(`Train leaves ${N(1)}`), ["approach", "stop", "clear"]);
  assert.deepEqual(signals(`Train leaves ${N(2)}`), ["advance", "approach", "stop"]);
  // Behind the train, this board is released once the joint is clear.
  assert.equal(home(`Train leaves ${N(1)}`), "Clear");
  assert.deepEqual(signals(`Train leaves ${N(3)}`), ["clear", "clear", "clear"]);
  assert.equal(home(`Train leaves ${N(3)}`), "Clear");
});

test("a train coming from the neighbour crosses the joint into this board", () => {
  const session = Try.createSession(west());
  session.setNeighbour("B", true);
  session.advance(500);
  const path = Try.crossPath(session, ["South block"], { end: "B", track: 2 });
  assert.deepEqual(plain(path.slice(0, 3).map((ref) => ref.at)), [3, 2, 1]);
  assert.equal(Try.refName(path[3]), "South block");
  const steps = Try.runTrain(session, { path, masts: ["South Home"], neighbours: [{ end: "B", track: 2 }] });
  const signals = (label) => plain(steps.find((step) => step.label === label).neighbours[0].signals.map((s) => s.tag));
  const N = (n) => `Pretend neighbour at end B, track 2, block ${n}`;
  assert.deepEqual(signals("Before the train"), ["advance", "clear", "clear"]);
  // The signals behind the train step down towards the joint: stop, approach, advance.
  assert.deepEqual(signals(`Train leaves ${N(3)}`), ["advance", "stop", "approach"]);
  assert.deepEqual(signals(`Train leaves ${N(2)}`), ["stop", "approach", "advance"]);
  // Once it is on this board, its block shows occupied to the neighbour: Stop ahead of block 1 as well.
  assert.equal(steps.find((step) => step.label === "Train enters South block").masts[0].meaning, "Stop");
  // After the train: all back as they were.
  assert.deepEqual(signals("Train leaves South block"), signals("Before the train"));
});

test("a pretend neighbour can be turned round, and start again keeps it but clears its trains", () => {
  const session = Try.createSession(west());
  session.setNeighbour("B", true);
  session.turnNeighbour("B", 1);
  assert.equal(session.neighbours().find((n) => n.end === "B").tracks[0].direction, "into");
  assert.equal(session.neighbourPath("B", 1)[0].at, 3);
  session.setBlock({ pretend: "B", track: 1, at: 2 }, true);
  assert.equal(session.blockOccupied({ pretend: "B", track: 1, at: 2 }), true);
  session.reset();
  assert.equal(session.neighbours().find((n) => n.end === "B").on, true);
  assert.equal(session.blockOccupied({ pretend: "B", track: 1, at: 2 }), false);
});

test("a board without ends has none of it", () => {
  const data = readCase("blocksig-worked-example");
  const session = Try.createSession(data.board);
  assert.deepEqual(plain(session.neighbours()), []);
  assert.deepEqual(plain(session.view().ends), []);
  assert.ok(!session.inputs().some((i) => i.kind === "end"));
});

test("the checker reads end inputs, so a board with ends is checked", () => {
  const board = west();
  const inputs = Checker.inputsOf(board);
  const ends = inputs.filter((i) => Checker.isEndKey(i.key));
  assert.deepEqual(plain(ends.map((i) => i.key.split("\u0000").slice(1).join(" "))).sort(), ["A 1 block", "A 1 mast", "B 1 block", "B 1 mast"]);
  // The event names the far track: track 1 of two meets their track 2.
  assert.deepEqual(plain(ends.find((i) => i.key === Checker.endKey("A", 1, "block")).event("occupied")), { end: "A", track: 2, block: "occupied" });
  // A signal input offers Stop and the meanings the rules compare it with.
  assert.deepEqual(plain(ends.find((i) => i.key === Checker.endKey("B", 1, "mast")).values), ["stop", "approach", "advance", "clear"]);
  const result = Checker.checkBoard(board, { maxStates: 3000 });
  assert.equal(result.complete, true);
  assert.ok(result.states > 1 && result.states <= 3000, `${result.states} states`);
  assert.deepEqual(plain(result.problems.filter((p) => p.level === "error")), []);
});

test("every word the page shows for ends is plain", () => {
  const SPEC_ONLY = /\b(scans?|scanning|latch(es|ed)?|interpreters?|rule tables?|phases?|resources?|layers?|tags?|tagged)\b/i;
  const strings = (value, where) => {
    if (typeof value === "string") return [[where, value]];
    if (typeof value === "function") return strings(value("Sample", "Sample", 2), `${where}()`);
    return Object.entries(value).flatMap(([k, inner]) => strings(inner, `${where}.${k}`));
  };
  const all = strings(Try.TEXT, "core");
  assert.deepEqual(all.filter(([, text]) => SPEC_ONLY.test(text)), []);
});
