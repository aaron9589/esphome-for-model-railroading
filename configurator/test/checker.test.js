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
function gauntlet({ leave = false } = {}) {
  const mast = { aspects: { R292: "stop", R281: "clear" } };
  const entrance = (block, other) => ({
    trigger: { while: { block, is: "occupied" }, for: "0.5s", ...(leave ? { leavingGuard: true } : {}) },
    checks: leave ? [{ block: other, is: "clear" }] : [],
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
  for (const leave of [false, true]) {
    const result = C.checkBoard(gauntlet({ leave }));
    assert.equal(result.complete, true, `${leave}: ${result.states} states`);
    assert.deepEqual(kinds(result), [], `leave ${leave}`);
  }
});

test("passes the gauntlet cases' own boards, three entrances included", () => {
  for (const file of ["rules-waiting-order.json", "rules-approach-locking-time.json", "rules-leaving-guard.json"]) {
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
  const board = readCase("blocksig-worked-example.json").board;
  const a = C.checkBoard(board, { maxStates: 5, runs: 20, steps: 10, seed: 7 });
  const b = C.checkBoard(board, { maxStates: 5, runs: 20, steps: 10, seed: 7 });
  assert.equal(a.complete, false);
  assert.equal(a.runs, 20);
  assert.deepEqual(kinds(a), kinds(b));
  assert.ok(a.problems.some((p) => p.kind === "partial" && /20 random runs/.test(p.text)));
  // Without every state, deadlock and starvation are not claimed.
  assert.ok(!a.problems.some((p) => p.kind === "deadlock" || p.kind === "starvation"));
});

test("only what the rules read are inputs", () => {
  const board = gauntlet();
  board.sensors.push("Yard 1", "Yard 2");
  const keys = plain(C.inputsOf(board).map((input) => input.key.replace("\u0000", ":")));
  assert.deepEqual(keys, ["sensor:Left", "sensor:Right", "sensor:Bridge"]);
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
  return normalizeConfig(config);
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
