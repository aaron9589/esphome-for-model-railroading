// The checker (spec, Checking in the browser; Tests: "Checker: finds a
// deliberate deadlock, and passes the one-train section starter"). Work item
// 2.9. Boards are in the engine cases' format, or configurator boards checked
// through validation.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

const ctx = loadModules("generator.js", "logic-yaml.js", "logic.js", "logic-checker.js");
const { EsphomeMrLogicChecker: C, EsphomeMrLogic: Engine } = ctx;
const plain = (value) => JSON.parse(JSON.stringify(value));
const readCase = (name) => JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "cases", name), "utf8"));
const kinds = (result) => plain(result.problems.map((p) => `${p.level}:${p.kind}:${p.rule ?? p.mast ?? ""}`));

// The gauntlet over a bridge, as the One-train section starter writes it.
function gauntlet() {
  const mast = { aspects: { R292: "stop", R281: "clear" } };
  const entrance = (block, other) => ({
    trigger: { while: { block, is: "occupied" }, for: "0.5s" },
    checks: [],
    then: { mast: `${block} Bridge`, aspect: "R281", reserve: "Bridge" },
  });
  return {
    sensors: ["Left", "Bridge", "Right"],
    turnouts: [],
    masts: { "Left Bridge": mast, "Right Bridge": mast },
    logic: {
      resources: [{ name: "Bridge", blocks: ["Bridge"], release: { while: { block: "Bridge", is: "clear" }, for: "3s" } }],
      layers: [{ name: "Gauntlet", rules: [entrance("Left", "Right"), entrance("Right", "Left")] }],
    },
  };
}

test("passes the one-train section: a gauntlet, and a single-line bridge", () => {
  {
    const result = C.checkBoard(gauntlet());
    assert.equal(result.complete, true, `${result.states} states`);
    assert.deepEqual(kinds(result), []);
  }
});

test("passes the gauntlet cases' own boards, three entrances included", () => {
  for (const file of ["rules-waiting-order.json", "rules-approach-locking-time.json"]) {
    const result = C.checkBoard(readCase(file).board);
    assert.equal(result.complete, true, file);
    assert.deepEqual(kinds(result), [], file);
  }
});

test("finds the deliberate deadlock: a rule that needs its own section's block occupied", () => {
  // The section is only free while Bridge is clear, but the rule only asks
  // while Bridge is occupied: it waits forever.
  const board = gauntlet();
  board.logic.layers[0].rules[0].checks = [{ block: "Bridge", is: "occupied" }];
  const result = C.checkBoard(board);
  assert.equal(result.complete, true);
  const deadlock = result.problems.find((p) => p.kind === "deadlock");
  assert.ok(deadlock, JSON.stringify(kinds(result)));
  assert.equal(deadlock.level, "error");
  assert.equal(deadlock.rule, "Gauntlet/1");
  assert.match(deadlock.text, /Rule 1 in group "Gauntlet" can be left waiting for section "Bridge" forever/);
  // Show me: replaying the sequence leaves the rule waiting.
  const engine = Engine.createEngine(board, { logic: "on", broker: "connected" });
  engine.scan();
  for (const step of deadlock.sequence) {
    if (step.do) {
      engine.event(step.do);
      engine.scan();
    } else for (let i = 0; i < step.wait; i += 1) engine.scan();
  }
  assert.equal(engine.state().rules["Gauntlet/1"], "waiting");
  // The other entrance still works.
  assert.ok(!result.problems.some((p) => p.rule === "Gauntlet/2"));
});

test("a rule that can never apply, and a signal that can never leave Stop", () => {
  const board = gauntlet();
  // Bridge occupied and Bridge clear at once: never.
  board.logic.layers[0].rules[0].checks = [{ block: "Bridge", is: "occupied" }, { block: "Bridge", is: "clear" }];
  const result = C.checkBoard(board);
  assert.deepEqual(kinds(result), ["warning:never-active:Gauntlet/1", "warning:stuck:Left Bridge"]);
  assert.match(result.problems[0].text, /Rule 1 in group "Gauntlet" can never apply/);
  assert.match(result.problems[1].text, /Signal "Left Bridge" can never show anything but Stop/);
});

test("block signals: the worked example's board passes; rule 1 with no diverging aspect ahead is not a warning", () => {
  const result = C.checkBoard(readCase("blocksig-worked-example.json").board);
  assert.equal(result.complete, true, `${result.states} states`);
  assert.deepEqual(kinds(result), []);
});

test("too many states: random runs, said so, and the same every time", () => {
  // Sections asked for *while* a train stands are not checked from the rules
  // (TP 5), so with too small a budget this stays a partial check.
  const board = gauntlet();
  const a = C.checkBoard(board, { maxStates: 5, runs: 20, steps: 10, seed: 7 });
  const b = C.checkBoard(board, { maxStates: 5, runs: 20, steps: 10, seed: 7 });
  assert.equal(a.complete, false);
  // Runs stop once they have seen every rule apply and every mast leave Stop.
  assert.ok(a.runs >= 1 && a.runs <= 20, `${a.runs} runs`);
  assert.deepEqual(kinds(a), kinds(b));
  assert.ok(a.problems.some((p) => p.kind === "partial" && p.text.includes(`${a.runs} random runs`)));
  // Without every state, deadlock and starvation are not claimed.
  assert.ok(!a.problems.some((p) => p.kind === "deadlock" || p.kind === "starvation"));
});

test("only what the rules read are inputs", () => {
  const board = gauntlet();
  board.sensors.push("Yard 1", "Yard 2");
  const keys = plain(C.inputsOf(board).map((input) => input.key.replace("\u0000", ":")));
  assert.deepEqual(keys, ["sensor:Left", "sensor:Right", "sensor:Bridge"]);
});

// ===== Limits (work item 4.5): parts, and the waiting order per section =====

const replayOn = (board, sequence) => {
  const engine = Engine.createEngine(board, { logic: "on", broker: "connected" });
  engine.scan();
  for (const step of sequence) {
    if (step.do) {
      engine.event(step.do);
      engine.scan();
    } else for (let i = 0; i < step.wait; i += 1) engine.scan();
  }
  return engine;
};

// The gauntlet, and beside it a layer whose masts read nothing of the
// gauntlet's: rule 1 sets Yard Exit, rule 2 sets Yard Home and can never apply.
function gauntletAndYard() {
  const board = gauntlet();
  board.sensors.push("Yard");
  board.masts["Yard Exit"] = { aspects: { R292: "stop", R281: "clear" } };
  board.masts["Yard Home"] = { aspects: { R292: "stop", R281: "clear" } };
  board.logic.layers.push({ name: "Yard", rules: [
    { trigger: { while: { block: "Yard", is: "clear" } }, checks: [], then: { mast: "Yard Exit", aspect: "R281" } },
    { trigger: { while: { block: "Yard", is: "clear" } }, checks: [{ block: "Yard", is: "occupied" }], then: { mast: "Yard Home", aspect: "R281" } },
  ] });
  return board;
}

test("parts: masts that do not read each other are checked apart, and find what the whole board finds", () => {
  const board = gauntletAndYard();
  const parts = C.partsOf(board);
  // The two Yard rules read only Yard, so they are checked together (TP 5).
  assert.equal(parts.length, 2);
  // Each part has only its own inputs.
  assert.deepEqual(plain(parts.map((p) => C.inputsOf(p.board).map((i) => i.key.split("\u0000")[1]))), [["Left", "Right", "Bridge"], ["Yard"]]);
  const split = C.checkBoard(board);
  const whole = C.checkBoard(board, { split: false });
  assert.equal(split.complete, true);
  assert.equal(whole.complete, true);
  assert.equal(split.parts, 2);
  assert.deepEqual(kinds(split), ["warning:never-active:Yard/2", "warning:stuck:Yard Home"]);
  assert.deepEqual(kinds(split), kinds(whole));
  assert.ok(split.states < whole.states, `${split.states} < ${whole.states}`);
  // The rule keeps its own name, though its part has only one rule in Yard.
  assert.match(split.problems[0].text, /Rule 2 in group "Yard" can never apply/);
});

test("parts: a deadlock in one part is found, and Show me plays it on the whole board", () => {
  const board = gauntletAndYard();
  board.logic.layers[0].rules[0].checks = [{ block: "Bridge", is: "occupied" }];
  const result = C.checkBoard(board);
  const deadlock = result.problems.find((p) => p.kind === "deadlock");
  assert.equal(deadlock?.rule, "Gauntlet/1");
  assert.deepEqual(kinds(result).filter((k) => k.startsWith("error")), ["error:deadlock:Gauntlet/1"]);
  assert.equal(replayOn(board, deadlock.sequence).state().rules["Gauntlet/1"], "waiting");
});

test("parts: block signals read the next mast along the line, so the worked example stays one part", () => {
  assert.equal(C.partsOf(readCase("blocksig-worked-example.json").board).length, 1);
  // Two directions on a plant-end board read nothing of each other.
  const west = readCase("ends-three-boards-turned.json").boards.west;
  assert.equal(C.partsOf(west).length, 2);
  const split = C.checkBoard(west);
  const whole = C.checkBoard(west, { split: false });
  assert.equal(split.complete && whole.complete, true);
  assert.deepEqual(kinds(split), kinds(whole));
  assert.ok(split.states < whole.states, `${split.states} against ${whole.states}`);
});

test("parts: a section's rules, and the masts its release reads, stay together", () => {
  const board = gauntletAndYard();
  // The section's release now waits for Yard Exit to show Stop.
  board.logic.resources[0].release = { while: { all: [{ block: "Bridge", is: "clear" }, { mast: "Yard Exit", is: "stop" }] }, for: "3s" };
  const parts = C.partsOf(board);
  const withBridge = parts.find((p) => p.board.logic.resources.length);
  assert.deepEqual(plain(withBridge.board.logic.layers.map((l) => [l.name, l.rules.length])), [["Gauntlet", 2], ["Yard", 2]]);
  assert.equal(withBridge.refOf("Yard/1"), "Yard/1");
});

test("inputs the rules cannot tell apart are explored once", () => {
  const west = readCase("ends-three-boards-turned.json").boards.west;
  const show = (inputs) => plain(inputs.map((i) => `${i.key.split("\u0000").filter(Boolean).join(" ")}: ${i.values.join(",")}`));
  // North block is North in, North and what end B track 1 hears: one input.
  // Its signal is read as Approach or better, or not: Stop and Approach.
  assert.deepEqual(show(C.checkerInputs(west, C.inputsOf(west))), [
    "sensor North in: clear,occupied",
    "~end B 1 mast: stop,approach",
    "sensor South in: clear,occupied",
    "~end A 1 mast: stop,approach",
  ]);
  // A sensor a rule reads by itself stays an input of its own.
  const board = plain(west);
  board.logic.layers[0].rules[1].checks = [{ sensor: "North", is: "clear" }];
  assert.ok(show(C.checkerInputs(board, C.inputsOf(board))).includes("sensor North: clear,occupied"));
  // Try it still offers every one.
  assert.equal(C.inputsOf(west).length, 8);
});

test("parts and merged inputs find exactly what the whole board, every input, finds", () => {
  const boards = {
    gauntlet: gauntlet(),
    "gauntlet and yard": gauntletAndYard(),
    "worked example": readCase("blocksig-worked-example.json").board,
    ...Object.fromEntries(["rules-waiting-order.json", "rules-approach-locking-time.json", "starter-lock-turnouts.json", "starter-route-signal.json"].map((f) => [f, readCase(f).board])),
    ...readCase("ends-three-boards-turned.json").boards,
  };
  const deadlock = gauntletAndYard();
  deadlock.logic.layers[0].rules[0].checks = [{ block: "Bridge", is: "occupied" }];
  boards.deadlock = deadlock;
  const direct = plain(boards.west);
  direct.logic.layers[0].rules[1].checks = [{ sensor: "North", is: "clear" }];
  boards["west, a sensor read by itself"] = direct;
  for (const [name, board] of Object.entries(boards)) {
    const quick = C.checkBoard(board);
    const slow = C.checkBoard(board, { split: false, allInputs: true, maxStates: 20000 });
    assert.equal(quick.complete && slow.complete, true, name);
    assert.deepEqual(kinds(quick), kinds(slow), name);
    assert.ok(quick.states <= slow.states, `${name}: ${quick.states} against ${slow.states}`);
  }
});

test("the checker keeps each section's waiting order, and drops how plain rules interleave", () => {
  const board = gauntletAndYard();
  const ask = (first, second) => {
    const engine = Engine.createEngine(board, { logic: "on", broker: "connected" });
    engine.scan();
    // Bridge occupied, so both entrances wait; then the yard clears.
    for (const e of [{ sensor: "Bridge", is: "occupied" }, { sensor: "Yard", is: "occupied" }, { sensor: first, is: "occupied" }]) {
      engine.event(e);
      engine.scan();
    }
    for (let i = 0; i < 6; i += 1) engine.scan();
    engine.event({ sensor: second, is: "occupied" });
    for (let i = 0; i < 6; i += 1) engine.scan();
    engine.event({ sensor: "Yard", is: "clear" });
    engine.scan();
    return plain(engine.checkerView());
  };
  const a = ask("Left", "Right");
  const b = ask("Right", "Left");
  assert.deepEqual(a.asked, [["Yard/1", "Yard/2"], ["Gauntlet/1", "Gauntlet/2"]]);
  assert.deepEqual(b.asked, [["Yard/1", "Yard/2"], ["Gauntlet/2", "Gauntlet/1"]]);
  // Try it still lists every request in the order it came.
  assert.deepEqual(a.order, ["Gauntlet/1", "Gauntlet/2", "Yard/1", "Yard/2"]);
});

// ===== Through validation, on a configurator board ==========================

const { normalizeConfig, validateConfig, topicFor } = ctx.EsphomeMr;

function configGauntlet() {
  const config = JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "fixtures", "turnouts-gpio.json"), "utf8"));
  config.board.name = "check-k7m4x2";
  config.board.nameSuffix = "k7m4x2";
  config.blocks = ["Left", "Bridge", "Right"].map((name, i) => ({ name, topic: topicFor("block", name), topicCustom: false, gpio: ["GPIO14", "GPIO27", "GPIO26"][i], inverted: true, debounce: "500ms" }));
  config.points = [];
  const lamp = (color) => ({ color, mode: "steady" });
  config.signals = { mode: "gpio", masts: [["Left Bridge", "GPIO32", "GPIO33"], ["Right Bridge", "GPIO25", "GPIO13"]].map(([name, red, green]) => ({
    name, topic: topicFor("signal", name), topicCustom: false, mode: "gpio",
    lamps: [{ name: "Red", count: 1, pin: red }, { name: "Green", count: 1, pin: green }],
    aspects: [{ label: "R292", states: ["R292; Lit; Unheld"], startup: true, lamps: [lamp("red"), lamp("off")] }, { label: "R281", states: ["R281; Lit; Unheld"], lamps: [lamp("off"), lamp("green")] }],
  })) };
  const entrance = (block) => ({ trigger: { while: { block, is: "occupied" }, for: "0.5s" }, checks: [], then: { mast: `${block} Bridge`, aspect: "R281", reserve: "Bridge" } });
  config.logic = {
    mode: "field",
    masts: ["Left Bridge", "Right Bridge"].map((mast) => ({ mast, tags: { R292: "stop", R281: "clear" } })),
    resources: [{ name: "Bridge", blocks: ["Bridge"], release: { while: { block: "Bridge", is: "clear" }, for: "3s" } }],
    layers: [{ name: "Gauntlet", rules: [entrance("Left"), entrance("Right")] }],
  };
  // Its rules are hand-written, so the board runs its own logic keys (see useOwnItems).
  return ctx.EsphomeMrLogicYaml.useOwnItems(normalizeConfig(config));
}

test("validation: a one-train section has no checker errors or warnings", () => {
  const { errors, warnings } = validateConfig(configGauntlet());
  assert.deepEqual([...errors], []);
  assert.deepEqual([...warnings], []);
});

test("validation: a deadlock blocks the download, and its link carries Show me", () => {
  const config = configGauntlet();
  config.logic.layers[0].rules[0].checks = [{ block: "Bridge", is: "occupied" }];
  const { errors, links } = validateConfig(config);
  const text = [...errors].find((e) => /can be left waiting/.test(e));
  assert.ok(text, [...errors].join("\n"));
  const link = links.get(text);
  assert.equal(link.view, "logic");
  assert.equal(link.part, "logic-groups");
  assert.ok(Array.isArray(link.sequence) && link.sequence.length > 0);
});

if (!process.exitCode) console.log("\nAll checker tests passed.");
