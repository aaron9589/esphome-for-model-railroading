// The checker on drawn track plans (work item TP 5): the engine's snapshot
// and skipped idle scans change nothing, a part too big to explore is checked
// from its routes' rules and finds what exploring finds, and the passing
// siding, the scissors and a station are checked completely.
import assert from "node:assert/strict";
import { loadModules, test } from "./harness.js";
import { builtPlanCases, planBoard, readPlanCase } from "./plan-cases.js";
import { station } from "./plan-station.js";

const ctx = loadModules("generator.js", "logic-yaml.js", "logic.js", "logic-checker.js", "logic-starters.js", "logic-starters-sections.js", "logic-starters-signals.js", "mss-builder.js", "plan-builder.js");
const { EsphomeMrLogicChecker: C, EsphomeMrLogic: Engine } = ctx;
const plain = (value) => JSON.parse(JSON.stringify(value));
const cases = Object.fromEntries(builtPlanCases().map((c) => [c.name, c.data.board]));
const kinds = (result) => plain(result.problems.map((p) => `${p.level}:${p.kind}:${p.rule ?? p.mast ?? ""}`));

// A seeded walk over a board's inputs: events, and waits of a few scans.
function walk(board, seed, steps) {
  let s = seed;
  const next = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const inputs = C.inputsOf(board);
  return Array.from({ length: steps }, () => {
    if (next() < 0.3) return { wait: 1 + Math.floor(next() * 40) };
    const input = inputs[Math.floor(next() * inputs.length)];
    const value = input.values[Math.floor(next() * input.values.length)];
    return { do: input.event(value) };
  });
}
const fresh = (board) => {
  const engine = Engine.createEngine(board, { logic: "on", broker: "connected" });
  engine.scan();
  return engine;
};

test("a snapshot put back carries on exactly as the engine it was taken from", () => {
  for (const name of ["passing-siding", "scissors", "diamond"]) {
    const board = cases[name];
    const steps = walk(board, 3, 60);
    const a = fresh(board);
    const b = fresh(board);
    for (const [i, step] of steps.entries()) {
      // b is put back from a copy of itself taken one step earlier.
      const saved = b.snapshot();
      b.restore(saved);
      for (const e of [a, b]) {
        if (step.do) { e.event(step.do); e.scan(); } else for (let k = 0; k < step.wait; k += 1) e.scan();
      }
      assert.deepEqual(plain(b.state()), plain(a.state()), `${name}, step ${i}`);
      assert.deepEqual(plain(b.checkerView()), plain(a.checkerView()), `${name}, step ${i}`);
    }
  }
});

test("skipping scans until the next timer runs out is the same as scanning through them", () => {
  for (const name of ["passing-siding", "routes-cancel", "merge"]) {
    const board = cases[name];
    const a = fresh(board);
    const b = fresh(board);
    for (const [i, step] of walk(board, 11, 80).entries()) {
      if (step.do) {
        for (const e of [a, b]) { e.event(step.do); e.scan(); }
      } else {
        for (let k = 0; k < step.wait; k += 1) a.scan();
        // b scans once, then skips what idleScans says is the same.
        let left = step.wait;
        while (left > 0) {
          b.scan();
          left -= 1;
          const idle = b.idleScans();
          const skip = Math.min(idle === Infinity ? left : idle, left);
          b.skip(skip);
          left -= skip;
        }
      }
      assert.equal(b.time(), a.time());
      assert.deepEqual(plain(b.state()), plain(a.state()), `${name}, step ${i}`);
      assert.deepEqual(plain(b.checkerView()), plain(a.checkerView()), `${name}, step ${i}`);
    }
  }
});

// What exploring finds about waiting for good, against what the routes'
// rules say, on the plan cases and on changed copies of them.
// Exploring every state of the larger cases takes too long here with the
// switch and holds (the diamond is 141,341 states, about 40 s): the bench
// and the comparison while building covered them.
const SLOW = ["passing-siding", "scissors", "diamond", "detector-dropout", "merge"];
const fromRules = (board) => [...new Set(["on", "off"].flatMap((mode) => plain(C.routeProblems(board, mode)).map((p) => `deadlock:${p.rule}`)))].sort();
const waits = (problems) => plain(problems).filter((p) => p.kind === "deadlock" || p.kind === "starvation").map((p) => `${p.kind}:${p.rule}`).sort();
function mutants(count, seed) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const bases = Object.entries(cases).filter(([name, b]) => !SLOW.includes(name) && b.logic.layers.some((l) => l.routes));
  return Array.from({ length: count }, () => {
    const [name, base] = pick(bases);
    const board = plain(base);
    const blocks = board.logic.blocks.map((b) => b.name);
    const routes = board.logic.layers.filter((l) => l.routes).flatMap((l) => l.rules);
    const did = [];
    for (let m = 0; m < 2; m += 1) {
      const route = pick(routes);
      const kind = Math.floor(rnd() * 5);
      if (kind === 0) { route.checks.push({ block: pick(blocks), is: pick(["clear", "occupied"]) }); did.push("an Only if"); }
      else if (kind === 1) { route.then.next = { ...route.then.next, [pick(route.then.reserve)]: [pick(blocks)] }; did.push("the next block"); }
      else if (kind === 2) { pick(board.logic.resources).release = { while: { block: pick(blocks), is: pick(["clear", "occupied"]) }, for: "1s" }; did.push("a release"); }
      else if (kind === 3) { pick(board.logic.resources).release = { while: { all: [{ block: pick(blocks), is: "clear" }, { auto: pick(["on", "off"]) }] }, for: "1s" }; did.push("a release in one position of the switch"); }
      else { route.then.next = { ...route.then.next, [pick(route.then.reserve)]: [] }; did.push("no next block"); }
    }
    return { name: `${name} with ${did.join(" and ")} changed`, board };
  });
}

test("a part's routes checked from their rules find what exploring every state finds", () => {
  const boards = Object.entries(cases).filter(([name, b]) => !SLOW.includes(name) && C.analysable(b) && b.logic.layers.some((l) => l.routes)).map(([name, board]) => ({ name, board }));
  const broken = plain(cases.gauntlet);
  broken.logic.layers.find((l) => l.routes).rules[0].checks.push({ block: "Bridge", is: "occupied" });
  boards.push({ name: "a route that needs its own track occupied", board: broken });
  let deadlocks = 0;
  for (const { name, board } of [...boards, ...mutants(6, 12)]) {
    const explored = C.checkBoard(board, { split: false, fromRules: false, runs: 0, runsMs: 0, maxStates: 100000, maxMs: 60000 });
    assert.equal(explored.complete, true, name);
    const found = fromRules(board);
    assert.deepEqual(found, waits(explored.problems), name);
    deadlocks += found.length;
  }
  assert.ok(deadlocks >= 3, `the changed copies include some that wait for good (${deadlocks})`);
});

test("the switch and JMRI's holds are explored, where the routes read them", () => {
  const keys = (board) => plain(C.inputsOf(board).map((input) => input.key.replace("\u0000", ":")));
  assert.deepEqual(keys(cases.gauntlet).filter((k) => k === "auto" || k.startsWith("hold:")), ["hold:Left Bridge", "hold:Right Bridge", "auto"]);
  assert.deepEqual(keys(cases.junction).filter((k) => k === "auto" || k.startsWith("hold:")), []);
  // A section freed only in Auto: in Manual a route set across it never
  // frees it, so the other signal's request waits for good. Both checks
  // find it, and only in Manual.
  const board = plain(cases.gauntlet);
  board.logic.resources[0].release = { while: { all: [{ block: "Bridge", is: "clear" }, { auto: "on" }] }, for: "3s" };
  const explored = C.checkBoard(board, { split: false, fromRules: false, runs: 0, runsMs: 0 });
  assert.deepEqual(waits(explored.problems), ["deadlock:Left Bridge moves/1", "deadlock:Right Bridge moves/1"]);
  assert.deepEqual(plain(C.routeProblems(board, "on")), []);
  assert.deepEqual(fromRules(board), waits(explored.problems));
  // Its Show me puts the board in Manual and asks with CATS.
  const steps = plain(explored.problems.find((p) => p.kind === "deadlock").sequence);
  assert.ok(steps.some((step) => step.do?.auto === "off"), JSON.stringify(steps));
  assert.ok(steps.some((step) => /Unheld/.test(step.do?.message || "")), JSON.stringify(steps));
  // CATS holding the signal a train waits at passes nothing over.
  assert.deepEqual(waits(C.checkBoard(cases["cats-hold"], { split: false, fromRules: false, runs: 0, runsMs: 0 }).problems), []);
});

test("a rule that asks *while* its train stands is not checked from the rules: it can go first again", () => {
  const board = plain(cases.gauntlet);
  assert.equal(C.analysable(board), true);
  board.logic.layers.find((l) => l.routes).rules[0].trigger = { while: { block: "Left", is: "occupied" } };
  assert.equal(C.analysable(board), false);
});

// ===== The drawings, through validation =====================================

const checkFully = (module) => C.checkFully(planBoard(ctx, module));

test("the passing siding, the scissors and a station are checked completely, with nothing wrong", () => {
  for (const [name, module] of [["passing siding", readPlanCase("passing-siding").module], ["scissors", readPlanCase("scissors").module], ["station", station()]]) {
    const result = checkFully(module);
    assert.equal(result.complete, true, name);
    assert.deepEqual(kinds(result), [], name);
  }
  const big = station();
  assert.equal(big.plan.blocks.length, 18);
  assert.equal(big.masts.length, 10);
  assert.equal(big.turnouts.length, 8);
});

test("two trains meeting head-on at an end of the drawing are not counted; inside it they are", () => {
  // The passing siding: Main West's route out to West line, and a train
  // come in from beyond the end, waiting at West Home. The layout beyond
  // holds such a train (decided 2026-11-27); a hand release frees it.
  const board = cases["passing-siding"];
  assert.deepEqual(plain(C.routeProblems(board, "on", ["West line", "Far"])), []);
  assert.deepEqual(plain(C.routeProblems(board, "on", [])).map((p) => p.rule).sort(), ["East Home moves/1", "East Home moves/2"]);
  // The engine agrees that it waits: West points is never freed.
  const engine = fresh(board);
  for (const [sensor, is] of [["Main loop current", "occupied"], ["West line current", "occupied"], ["West points current", "occupied"], ["Main loop current", "clear"], ["West points current", "clear"]]) {
    engine.event({ sensor, is });
    for (let k = 0; k < 10; k += 1) engine.scan();
  }
  for (let k = 0; k < 600; k += 1) engine.scan();
  assert.equal(engine.state().rules["West Home moves/1"], "waiting");
  assert.equal(engine.state().holders["West points"], "Main West moves/1");
});

if (!process.exitCode) console.log("\nAll checker plan tests passed.");
