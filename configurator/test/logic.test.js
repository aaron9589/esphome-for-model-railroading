// The JS engine beyond the shared cases: Explain sentences, approach
// lighting, and checks on the case runner itself. Work item 2.2.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";
import { runCase } from "./engine-runner.js";

const { EsphomeMrLogic: L } = loadModules("logic.js");
const plain = (value) => JSON.parse(JSON.stringify(value));
const casesDir = path.join(configuratorDir, "test", "cases");
const loadCase = (name) => JSON.parse(fs.readFileSync(path.join(casesDir, `${name}.json`), "utf8"));
const LABELS = { R292: "Stop", R285: "Approach", ADV_NORM: "Advance Approach", R281: "Clear", R282: "Approach Diverging" };

function withLabels(board) {
  const copy = plain(board);
  for (const mast of Object.values(copy.masts || {})) {
    mast.labels = Object.fromEntries(Object.keys(mast.aspects).map((a) => [a, LABELS[a] || a]));
  }
  return copy;
}

test("Explain gives the spec's sentence for the gauntlet's entrance mast", () => {
  const board = withLabels(loadCase("rules-cancel-and-flicker").board);
  const sentences = plain(L.explainMast(board, "Left Bridge"));
  assert.deepEqual(sentences.slice(0, 2), [
    "Left Bridge shows Clear when a train has been in Left for half a second and the Bridge section is free.",
    "Otherwise it shows Stop.",
  ]);
  assert.equal(sentences[2], "If JMRI or CATS holds it, it shows Stop.");
});

test("Explain changes when a rule changes", () => {
  const board = withLabels(loadCase("rules-cancel-and-flicker").board);
  const before = plain(L.explainMast(board, "Left Bridge"));
  board.logic.layers[0].rules[0].trigger.for = "1s";
  assert.match(L.explainMast(board, "Left Bridge")[0], /for a second and/);
  board.logic.layers[0].rules[0].checks.push({ block: "Right", is: "clear" });
  const after = plain(L.explainMast(board, "Left Bridge"));
  assert.notDeepEqual(after, before);
  assert.equal(after[0], "Left Bridge shows Clear when a train has been in Left for a second and Right is clear and the Bridge section is free.");
});

test("Explain reads block signals rule by rule, in the order they win", () => {
  const board = withLabels(loadCase("blocksig-worked-example").board);
  assert.deepEqual(plain(L.explainMast(board, "Int 2/3")), [
    "Int 2/3 shows Approach when Int 3 is clear and East Home shows a diverging aspect and East Home does not show Stop or Restricting.",
    "Otherwise, it shows Clear when Int 3 is clear and East Home shows Advance Approach or Clear.",
    "Otherwise, it shows Advance Approach when Int 3 is clear and East Home shows Approach.",
    "Otherwise, it shows Approach when Int 3 is clear and East Home shows Stop or Restricting.",
    "Otherwise it shows Stop.",
    "If JMRI or CATS holds it, it shows Stop.",
  ]);
});

test("Explain says when a mast follows several groups, and a when trigger as it happened", () => {
  const exit = plain(L.explainMast(withLabels(loadCase("rules-who-wins").board), "Exit"));
  assert.equal(exit[0], "In Near, Exit shows Approach Diverging when C is clear.");
  assert.ok(exit.includes("Exit shows the most restrictive of what these groups say."));
  const platform = plain(L.explainMast(withLabels(loadCase("scan-short-pulses").board), "Platform Exit"));
  assert.equal(platform[0], "Platform Exit shows Clear when Depart has been pressed and a train is in Platform and the Line section is free.");
  const guard = plain(L.explainMast(withLabels(loadCase("rules-leaving-guard").board), "Right Bridge"));
  assert.match(guard[0], /that train did not arrive while the section was in use and Left is clear/);
  const remote = plain(L.explainMast(withLabels(loadCase("failsafe-remote-not-known").board), "D"));
  assert.equal(remote[0], "D shows Clear when Home on south shows Clear.");
});

test("Explain uses plain words for every mast in every case", () => {
  const SPEC_ONLY = /\b(scans?|scanning|latch(es|ed)?|interpreters?|rule tables?|phases?|resources?|layers?|tags?|tagged)\b/i;
  for (const file of fs.readdirSync(casesDir).filter((f) => f.endsWith(".json"))) {
    const { board } = JSON.parse(fs.readFileSync(path.join(casesDir, file), "utf8"));
    for (const mast of Object.keys(board.masts || {})) {
      for (const sentence of L.explainMast(board, mast)) {
        assert.equal(SPEC_ONLY.exec(sentence), null, `${file} ${mast}: ${sentence}`);
        assert.doesNotMatch(sentence, /undefined|\[object/, `${file} ${mast}: ${sentence}`);
      }
    }
  }
});

test("approach lighting: dark unless its block is occupied, applied after who wins", () => {
  const board = {
    sensors: ["Main", "Approach"],
    masts: { Home: { aspects: { R292: "stop", R281: "clear" }, approachLight: "Approach" } },
    logic: { layers: [{ name: "Plain", rules: [{ trigger: { while: { block: "Main", is: "clear" } }, checks: [], then: { mast: "Home", aspect: "R281" } }] }] },
  };
  const engine = L.createEngine(board, {});
  assert.deepEqual(plain(engine.scan().writes), [{ mast: "Home", aspect: "dark" }]);
  engine.event({ sensor: "Approach", is: "occupied" });
  assert.deepEqual(plain(engine.scan().writes), [{ mast: "Home", aspect: "R281" }]);
  engine.event({ jmri: "Home", message: "R281; Lit; Held" });
  engine.scan();
  assert.equal(engine.state().masts.Home, "R292", "a hold is Stop, and lit while a train approaches");
  engine.event({ sensor: "Approach", is: "clear" });
  engine.scan();
  assert.equal(engine.state().masts.Home, "dark", "held and no train approaching: dark");
  assert.match(L.explainMast(board, "Home").join(" "), /It is dark unless a train is in Approach\./);
});

test("the runner reports a wrong expectation, and the same inputs always give the same outputs", () => {
  const data = loadCase("rules-waiting-order");
  assert.deepEqual(plain(runCase(data)), []);
  const wrong = plain(data);
  wrong.steps.find((s) => s.at === 60).expect.events[1].rule = "Junction/2";
  wrong.steps.find((s) => s.at === 100).expect.masts["B Mid"] = "R292";
  const problems = plain(runCase(wrong));
  assert.equal(problems.length, 2);
  assert.match(problems[0], /^scan 60: events/);
  assert.match(problems[1], /^scan 100: masts B Mid is "R281", expected "R292"/);
});

test("durations and today's handler", () => {
  assert.deepEqual([L.ms("0.5s"), L.ms("500ms"), L.ms("10s"), L.ms(""), L.ms(undefined)], [500, 500, 10000, 0, 0]);
  assert.ok(Number.isNaN(L.ms("soon")) && Number.isNaN(L.ms("10 s")), "a typo is not read as no delay");
  const mast = { aspects: { R292: "stop", R281: "clear" } };
  assert.equal(L.stopAspect(mast), "R292");
  assert.equal(L.stopAspect({ aspects: { Clear: "clear", Danger: "stop" } }), "Danger");
  assert.equal(L.pickAspect(mast, "R281; Lit; Unheld"), "R281");
  assert.equal(L.pickAspect(mast, "R281; Lit; Held"), "R292");
  assert.equal(L.pickAspect(mast, "Nope; Lit; Unheld"), undefined);
});

// --- review fixes (PR 81) ---

const STOPCLEAR = { aspects: { R292: "stop", R281: "clear" } };
const rule = (trigger, then, checks = []) => ({ trigger, checks, then });

test("a when moment on this board's own mast fires once, the scan after it changes", () => {
  const board = {
    sensors: ["S"],
    masts: { A: STOPCLEAR, B: STOPCLEAR },
    logic: { buttons: [], resources: [{ name: "R", blocks: ["S"], release: { while: { block: "S", is: "clear" } } }],
      layers: [{ name: "x", rules: [
        rule({ while: { block: "S", is: "occupied" } }, { mast: "A", aspect: "R281" }),
        rule({ when: { mast: "A", is: "clear" } }, { mast: "B", aspect: "R281", reserve: "R" }),
      ] }] },
  };
  const engine = L.createEngine(board, {});
  engine.scan();
  engine.event({ sensor: "S", is: "occupied" });
  engine.scan(); // A is written Clear
  assert.equal(engine.state().masts.A, "R281");
  engine.scan(); // x/2 reads A as Clear for the first time: its request is made
  assert.equal(engine.state().rules["x/2"], "waiting", "S is occupied, so R is not free");
});

test("an aspect the mast does not have counts as Stop, and never beats a hold", () => {
  const board = { sensors: ["S"], masts: { A: STOPCLEAR },
    logic: { layers: [{ name: "x", rules: [rule({ while: { block: "S", is: "clear" } }, { mast: "A", aspect: "Typo" })] }] } };
  const engine = L.createEngine(board, {});
  engine.scan();
  assert.equal(engine.state().masts.A, "R292");
  engine.event({ jmri: "A", message: "R292; Lit; Held" });
  engine.scan();
  assert.equal(engine.state().masts.A, "R292");
});

test("a block's moment is the block's own change, not one member's", () => {
  const board = {
    sensors: ["S1", "S2"],
    masts: { A: STOPCLEAR },
    logic: { blocks: [{ name: "B", sensors: ["S1", { sensor: "S2" }] }],
      layers: [{ name: "x", rules: [rule({ when: { block: "B", is: "clear" } }, { mast: "A", aspect: "R281" })] }] },
  };
  const engine = L.createEngine(board, { sensors: { S1: "occupied", S2: "occupied" } });
  engine.scan();
  engine.event({ sensor: "S1", is: "clear" });
  assert.deepEqual(plain(engine.scan().writes), [], "S2 still holds B");
  engine.event({ sensor: "S2", is: "clear" });
  assert.deepEqual(plain(engine.scan().writes), [{ mast: "A", aspect: "R281" }], "B went clear");
  engine.scan();
  // A pulse on a member written as { sensor } with no board: B went occupied, then clear.
  engine.event({ sensor: "S2", is: "occupied" });
  engine.event({ sensor: "S2", is: "clear" });
  assert.deepEqual(plain(engine.scan().writes), [{ mast: "A", aspect: "R281" }]);
});

test("another board's block is stored and read under one name, whichever key the event uses", () => {
  const board = { masts: { A: STOPCLEAR }, remote: { south: { sensors: ["S"], blocks: ["B1"] } },
    logic: { layers: [{ name: "x", rules: [rule({ while: { board: "south", block: "B1", is: "clear" } }, { mast: "A", aspect: "R281" })] }] } };
  const engine = L.createEngine(board, { remote: { south: { online: true } } });
  engine.event({ board: "south", sensor: "B1", is: "clear" });
  engine.scan();
  assert.equal(engine.state().masts.A, "R281");
});

test("a release press is answered CLOSED when logic is switching off or off", () => {
  const data = loadCase("scan-next-scan");
  const engine = L.createEngine(data.board, {});
  engine.scan();
  engine.event({ logic: "off" });
  engine.event({ release: "Bridge", via: "mqtt" });
  assert.ok(plain(engine.scan().publishes).some((p) => p.release === "Bridge" && p.value === "CLOSED"));
  engine.event({ release: "Bridge", via: "button" });
  assert.deepEqual(plain(engine.scan().publishes), [{ release: "Bridge", value: "CLOSED" }]);
});

test("a board with a time the engine cannot read is refused", () => {
  const board = plain(loadCase("rules-approach-locking-time").board);
  board.logic.resources[0].approachLock = "10 s";
  assert.throws(() => L.createEngine(board, {}), /Bridge: a time the engine cannot read/);
});

test("Explain keeps an either-or inside its group", () => {
  const sentence = L.explainRule(rule({ while: { block: "Left", is: "occupied" } }, { mast: "A", aspect: "R281" },
    [{ any: [{ block: "X", is: "clear" }, { block: "Y", is: "clear" }] }, { block: "Z", is: "clear" }]));
  assert.equal(sentence, "a train is in Left, and either X is clear or Y is clear, and Z is clear");
});

if (!process.exitCode) console.log("\nAll logic engine tests passed.");
