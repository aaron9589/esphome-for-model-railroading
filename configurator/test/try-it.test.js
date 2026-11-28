// Try it (spec, Checking in the browser; Tests: "Run a train steps through the
// Block signals worked example and shows each row of its table"). Work item
// 2.10: the pure core (logic-try.js) without a DOM, and its plain words. The
// pages that draw it are logic-ui-plan-try.js and logic-ui-mss-try.js.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

// Every Logic page file, in index.html's order (as in logic-page.test.js).
const LOGIC_UI_FILES = ["generator.js", "logic-yaml.js", "logic.js", "logic-checker.js", "logic-try.js", "logic-ui.js", "logic-ui-masts.js", "logic-ui-views.js", "logic-ui-start.js", "logic-starters.js", "logic-starters-sections.js", "logic-starters-signals.js"];
const context = loadModules(...LOGIC_UI_FILES);
const { EsphomeMr, EsphomeMrLogicTry: Try, EsphomeMrLogicChecker: Checker, EsphomeMrLogicStarters: Starters } = context;
const { myFirstBoardPreset, topicFor } = EsphomeMr;

const plain = (value) => JSON.parse(JSON.stringify(value));
const readCase = (name) => JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "cases", `${name}.json`), "utf8"));

// ===== A configurator board for a case's board (as starters-signals.test.js) ==

const lamp = (color) => ({ color, mode: "steady" });

function mast(name, aspects, pin = "GPIO16") {
  return {
    name, topic: topicFor("signal", name), topicCustom: false, mode: "addressable", pin,
    lamps: [{ name: "Head", count: 1 }],
    aspects: aspects.map((label, i) => ({ label, states: [`${label}; Lit; Unheld`], ...(i === 0 ? { startup: true } : {}), lamps: [lamp(i === 0 ? "red" : "green")] })),
  };
}

// The starters write its logic keys, so the board runs them (see useOwnItems).
function boardFor(data) {
  const config = context.EsphomeMrLogicYaml.useOwnItems(myFirstBoardPreset());
  config.blocks = (data.board.sensors || []).map((name) => ({ name, topic: topicFor("block", name) }));
  config.points = (data.board.turnouts || []).map((name) => ({ name, topic: topicFor("point", name) }));
  config.signals = { mode: "addressable", masts: Object.entries(data.board.masts || {}).map(([name, m]) => mast(name, Object.keys(m.aspects))) };
  config.logic = { mode: "field" };
  return config;
}

function apply(config, key, answers) {
  const full = { ...Starters.defaults(key, config), ...answers };
  assert.deepEqual(plain(Starters.problems(key, config, full)), [], key);
  Starters.apply(key, config, full);
}

// The worked example (blocks Int 1-3, East Home driven by CATS), written by the starters.
function workedExampleConfig() {
  const data = readCase("blocksig-worked-example");
  const config = boardFor(data);
  apply(config, "block-signals", {
    name: "Up",
    rows: [{ mast: "Int 1/2", block: "Int 2", turnouts: [] }, { mast: "Int 2/3", block: "Int 3", turnouts: [] }],
    beyond: "mast", nextMast: "East Home", useAdvance: true,
  });
  apply(config, "route-signal", {
    name: "West Exit", mast: "West Exit",
    rows: [{ turnouts: [], blocks: ["Int 1"], follow: true, next: "Int 1/2" }],
    useAdvance: true,
  });
  return config;
}

// The spec's table: East Home, Int 3, Int 2, Int 2/3, Int 1/2, West Exit.
const STOP = "R292";
const APPROACH = "R285";
const ADVANCE = "ADV_NORM";
const CLEAR = "R281";
const ROW1 = { "Int 2/3": APPROACH, "Int 1/2": ADVANCE, "West Exit": CLEAR };
const ROW2 = { "Int 2/3": CLEAR, "Int 1/2": CLEAR, "West Exit": CLEAR };
const ROW3 = { "Int 2/3": STOP, "Int 1/2": APPROACH, "West Exit": ADVANCE };
const ROW4 = { "Int 2/3": CLEAR, "Int 1/2": STOP, "West Exit": APPROACH };

const shown = (view) => Object.fromEntries(view.masts.filter((m) => m.name !== "East Home").map((m) => [m.name, m.aspect]));
const stepShown = (step) => Object.fromEntries(step.masts.filter((m) => m.name !== "East Home").map((m) => [m.name, m.aspect]));
const occupiedIn = (step) => step.blocks.filter((b) => b.occupied).map((b) => b.name);

// ===== Run a train ===========================================================

for (const [how, make] of [
  ["the case's board", () => readCase("blocksig-worked-example").board],
  ["a board made by the starters", () => workedExampleConfig()],
]) {
  test(`Run a train shows each row of the tumbledown example (${how})`, () => {
    const session = Try.createSession(make());
    const eastHome = session.find("mast", "East Home");

    // Rows 1 and 2: no train, East Home at Stop, then Clear.
    session.setInput(eastHome, STOP);
    session.advance(1000);
    assert.deepEqual(plain(shown(session.view())), ROW1);
    session.setInput(eastHome, CLEAR);
    session.advance(1000);
    assert.deepEqual(plain(shown(session.view())), ROW2);

    // Rows 3 and 4: a train eastbound, one block long.
    const steps = Try.runTrain(session, { path: ["Int 1", "Int 2", "Int 3"], length: 1 });
    assert.deepEqual(plain(steps.map((s) => [s.label, occupiedIn(s)])), [
      ["Before the train", []],
      ["Train enters Int 1", ["Int 1"]],
      ["Train enters Int 2", ["Int 1", "Int 2"]],
      ["Train leaves Int 1", ["Int 2"]],
      ["Train enters Int 3", ["Int 2", "Int 3"]],
      ["Train leaves Int 2", ["Int 3"]],
      ["Train leaves Int 3", []],
    ]);
    const at = (label) => plain(stepShown(steps.find((s) => s.label === label)));
    assert.deepEqual(at("Before the train"), ROW2);
    assert.deepEqual(at("Train leaves Int 1"), ROW4, "the train in Int 2");
    assert.deepEqual(at("Train leaves Int 2"), ROW3, "the train in Int 3");
    assert.deepEqual(at("Train leaves Int 3"), ROW2, "gone again");
    // Every step records the signals' meanings too, and the time moves on.
    const row3 = steps.find((s) => s.label === "Train leaves Int 2");
    assert.equal(row3.masts.find((m) => m.name === "Int 2/3").meaning, "Stop");
    assert.equal(row3.masts.find((m) => m.name === "West Exit").meaning, "Advance Approach");
    assert.ok(steps.every((s, i) => i === 0 || s.time > steps[i - 1].time));
    // The train is gone and the inputs are as they were.
    assert.deepEqual(plain(session.inputs().filter((i) => i.value === "occupied")), []);
  });
}

test("a longer train occupies several blocks, and the pause covers the longest wait", () => {
  const session = Try.createSession(readCase("blocksig-worked-example").board);
  session.setInput(session.find("mast", "East Home"), CLEAR);
  const steps = Try.runTrain(session, { path: ["Int 1", "Int 2", "Int 3"], length: 2 });
  assert.deepEqual(plain(steps.map(occupiedIn)), [[], ["Int 1"], ["Int 1", "Int 2"], ["Int 1", "Int 2", "Int 3"], ["Int 2", "Int 3"], ["Int 3"], []]);
  // A section with a 3 second release: the pause is at least that, plus time to settle.
  const gauntlet = Try.createSession(readCase("rules-waiting-order").board);
  assert.ok(Try.defaultPause(gauntlet) >= 3000 + 2 * context.EsphomeMrLogic.SCAN_MS);
});

// ===== The session ===========================================================

test("a session steps, skips time forward, resets, and keeps the inputs", () => {
  const session = Try.createSession(readCase("blocksig-worked-example").board);
  assert.equal(session.time, 100, "the start-up scan has run");
  const before = session.view().time;
  session.step();
  assert.equal(session.view().time, before + 100);
  session.advance(1000);
  assert.equal(session.view().time, before + 1100);
  session.setInput(session.find("sensor", "Int 3"), "occupied");
  assert.equal(session.inputs().find((i) => i.name === "Int 3").value, "occupied");
  session.reset();
  assert.equal(session.inputs().find((i) => i.name === "Int 3").value, "clear");
  assert.equal(session.time, 100);
  assert.throws(() => session.setInput(session.find("sensor", "Int 3"), "thrown"));
});

test("a session says what the rules are doing, in plain words", () => {
  const board = readCase("rules-waiting-order").board;
  const session = Try.createSession(board);
  const [first] = board.logic.layers[0].rules;
  session.setInput(session.find("sensor", first.trigger.while.block), "occupied");
  session.advance(1000);
  const view = session.view();
  const section = view.sections[0];
  assert.equal(section.text, "Taken, waiting for the train");
  assert.match(section.heldBy, /^Rule 1 in group "/);
  assert.equal(view.rules[0].text, "Has its section");
  assert.ok(view.log.some((entry) => /took section/.test(entry.text)));
  assert.equal(view.masts.find((m) => m.fieldControlled && m.aspect !== null && m.tag === "clear").meaning, "Clear");
});

// ===== Not known ==============================================================

function remoteBoard() {
  const two = { aspects: { R292: "stop", R281: "clear" } };
  const rule = (mastName, cond) => ({ trigger: { while: cond }, checks: [], then: { mast: mastName, aspect: "R281" } });
  return {
    sensors: [],
    turnouts: [],
    masts: { Sensor: two, Closed: two, Thrown: two, Clear: two, Stopped: two },
    remote: { south: { sensors: ["S1"], blocks: [], turnouts: ["T1"], masts: { Far: two } } },
    logic: {
      layers: [{
        name: "Remote",
        rules: [
          rule("Sensor", { board: "south", sensor: "S1", is: "clear" }),
          rule("Closed", { board: "south", turnout: "T1", is: "closed" }),
          rule("Thrown", { board: "south", turnout: "T1", is: "thrown" }),
          rule("Clear", { board: "south", mast: "Far", is: "clear" }),
          rule("Stopped", { board: "south", mast: "Far", is: "stop" }),
        ],
      }],
    },
  };
}

test("Not known on a remote input reads as occupied, neither position, and Stop", () => {
  const session = Try.createSession(remoteBoard());
  const aspects = () => plain(Object.fromEntries(session.view().masts.map((m) => [m.name, m.aspect])));
  const settle = () => session.advance(500);
  const sensor = session.find("sensor", "S1", "south");
  const turnout = session.find("turnout", "T1", "south");
  const far = session.find("mast", "Far", "south");
  const info = (key) => session.inputs().find((i) => i.key === key);

  // Everything is offered Not known, and the page says what it reads as.
  for (const key of [sensor, turnout, far]) assert.ok(info(key).values.includes("unknown"), key);
  assert.equal(info(far).value, "unknown");

  settle();
  // The remote mast is not known: it reads Stop.
  assert.deepEqual(aspects(), { Sensor: CLEAR, Closed: CLEAR, Thrown: STOP, Clear: STOP, Stopped: CLEAR });

  session.setInput(sensor, "unknown");
  session.setInput(turnout, "unknown");
  settle();
  assert.equal(aspects().Sensor, STOP, "a sensor that is not known is occupied");
  assert.equal(aspects().Closed, STOP, "a turnout that is not known is not closed");
  assert.equal(aspects().Thrown, STOP, "and not thrown");
  assert.equal(aspects().Stopped, CLEAR, "a mast that is not known is Stop");
  assert.match(Try.readsAs(info(sensor)), /occupied/);
  assert.match(Try.readsAs(info(turnout)), /neither closed nor thrown/);
  assert.match(Try.readsAs(info(far)), /Stop/);

  // Known again: a clear sensor, a thrown turnout, a Clear signal.
  session.setInput(sensor, "clear");
  session.setInput(turnout, "thrown");
  session.setInput(far, "R281");
  settle();
  assert.deepEqual(aspects(), { Sensor: CLEAR, Closed: STOP, Thrown: CLEAR, Clear: CLEAR, Stopped: STOP });

  // The other board switched off: everything of it is not known again.
  assert.deepEqual(plain(session.boards()), [{ name: "south", online: true }]);
  session.setBoardOnline("south", false);
  settle();
  assert.equal(session.boards()[0].online, false);
  assert.deepEqual(aspects(), { Sensor: STOP, Closed: STOP, Thrown: STOP, Clear: STOP, Stopped: CLEAR });
});

// ===== Show me ================================================================

function gauntlet() {
  const two = { aspects: { R292: "stop", R281: "clear" } };
  const entrance = (block) => ({
    trigger: { while: { block, is: "occupied" }, for: "0.5s" },
    checks: [],
    then: { mast: `${block} Bridge`, aspect: "R281", reserve: "Bridge" },
  });
  return {
    sensors: ["Left", "Bridge", "Right"],
    turnouts: [],
    masts: { "Left Bridge": two, "Right Bridge": two },
    logic: {
      resources: [{ name: "Bridge", blocks: ["Bridge"], release: { while: { block: "Bridge", is: "clear" }, for: "3s" } }],
      layers: [{ name: "Gauntlet", rules: [entrance("Left"), entrance("Right")] }],
    },
  };
}

test("Show me: the checker's sequence for its deadlock ends with the rule waiting", () => {
  const board = gauntlet();
  board.logic.layers[0].rules[0].checks = [{ block: "Bridge", is: "occupied" }];
  const result = Checker.checkBoard(board);
  const deadlock = result.problems.find((p) => p.kind === "deadlock");
  assert.ok(deadlock?.sequence?.length > 0);
  const session = Try.createSession(board);
  session.play(deadlock.sequence);
  const view = session.view();
  assert.equal(view.rules.find((r) => r.ref === deadlock.rule).phase, "waiting");
  assert.equal(view.rules.find((r) => r.ref === deadlock.rule).text, "Waiting for its section");
  // The section never frees up, however long it waits.
  session.advance(20000);
  assert.equal(session.view().rules.find((r) => r.ref === deadlock.rule).phase, "waiting");
  assert.deepEqual(plain(session.view().waiting), [`Rule 1 in group "Gauntlet"`]);
  // And the inputs show what the sequence set.
  assert.ok(session.inputs().some((i) => i.value === "occupied"));
});

test("play starts from power-on each time", () => {
  const session = Try.createSession(gauntlet());
  session.play([{ do: { sensor: "Left", is: "occupied" } }, { wait: 10 }]);
  assert.equal(session.view().sections[0].state, "ACTIVE");
  session.play([]);
  assert.equal(session.view().sections[0].state, "IDLE");
});

// ===== Track shapes ===========================================================

test("the track shape of a Block signals group, turnouts included", () => {
  const config = workedExampleConfig();
  config.points = [{ name: "P1", topic: topicFor("point", "P1") }];
  config.logic.layers = [];
  apply(config, "block-signals", {
    name: "Up",
    rows: [{ mast: "Int 1/2", block: "Int 2", turnouts: [{ turnout: "P1", position: "closed" }] }, { mast: "Int 2/3", block: "Int 3", turnouts: [] }],
    beyond: "mast", nextMast: "East Home", useAdvance: true,
  });
  const [shape, ...more] = Try.shapesOf(config);
  assert.equal(more.length, 0);
  assert.equal(shape.group, "Up");
  assert.equal(shape.kind, "block-signals");
  assert.deepEqual(plain(shape.rows[0].items.map((i) => [i.type, i.name])), [
    ["mast", "Int 1/2"], ["block", "Int 2"], ["mast", "Int 2/3"], ["block", "Int 3"], ["mast", "East Home"],
  ]);
  assert.equal(shape.rows[0].items[4].external, true);
  assert.deepEqual(plain(shape.rows[0].items[1].turnouts), [{ name: "P1", ref: "P1", through: "closed" }]);
  assert.deepEqual(plain(shape.rows[0].items.filter((i) => i.type === "mast").map((i) => i.dir)), [1, 1, 1]);

  // Throw the turnout in the block: the signal behind it falls to Stop.
  const session = Try.createSession(config);
  session.setInput(session.find("mast", "East Home"), CLEAR);
  session.advance(1000);
  assert.equal(session.view().masts.find((m) => m.name === "Int 1/2").aspect, CLEAR);
  session.setTurnout("P1", "thrown");
  session.advance(1000);
  assert.equal(session.view().masts.find((m) => m.name === "Int 1/2").aspect, STOP);
  assert.equal(session.turnoutPosition("P1"), "thrown");
});

test("groups with no starter, or no known shape, give none", () => {
  assert.deepEqual(plain(Try.shapesOf(readCase("blocksig-worked-example").board)), []);
  // A route signal group, and a One-train section's (that starter went in TP 9), have no shape.
  assert.deepEqual(plain(Try.shapesOf({ logic: { layers: [{ name: "R", starter: "route-signal", rules: [] }, { name: "B", starter: "one-train-section", rules: [] }] } })), []);
  assert.deepEqual(plain(Try.shapesOf({})), []);
  assert.equal(Try.createSession({ logic: { layers: [] }, masts: {} }), null, "no rules, no session");
});

test("a block with several sensors: a train takes its first, and clicking it again takes it out", () => {
  const board = readCase("rules-waiting-order").board;
  board.logic.blocks = [{ name: "Wide", sensors: ["Left", "Right"] }];
  const session = Try.createSession(board);
  assert.equal(session.blockOccupied("Wide"), false);
  session.setBlock("Wide", true);
  assert.equal(session.blockOccupied("Wide"), true);
  assert.equal(session.inputs().find((i) => i.name === "Left").value, "occupied");
  session.setBlock("Wide", false);
  assert.equal(session.blockOccupied("Wide"), false);
});

// ===== The page part ===========================================================

const SPEC_ONLY = /\b(scans?|scanning|latch(es|ed)?|interpreters?|rule tables?|phases?|resources?|layers?|tags?|tagged)\b/i;

function strings(value, where = "TEXT") {
  if (typeof value === "string") return [[where, value]];
  if (typeof value === "function") return strings(value("Sample", ["a change", "another"], 2), `${where}()`);
  return Object.entries(value).flatMap(([key, inner]) => strings(inner, `${where}.${key}`));
}

test("the words the core gives Try it are plain", () => {
  assert.deepEqual(strings(Try.TEXT, "core").filter(([, text]) => SPEC_ONLY.test(text)), []);
  // The session's own sentences, as Try it shows them.
  const session = Try.createSession(gauntlet());
  session.play([{ do: { sensor: "Left", is: "occupied" } }, { wait: 6 }]);
  const view = session.view();
  const said = [...view.rules.flatMap((r) => [r.words, r.text]), ...view.sections.flatMap((s) => [s.text, s.heldBy]), ...view.log.map((l) => l.text), ...view.masts.map((m) => m.meaning)];
  assert.ok(said.length > 4);
  assert.deepEqual(said.filter((text) => SPEC_ONLY.test(text)), []);
});

if (!process.exitCode) console.log("\nAll Try it tests passed.");
