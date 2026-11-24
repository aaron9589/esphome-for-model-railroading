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
  assert.deepEqual([L.ms("0.5s"), L.ms("500ms"), L.ms("10s"), L.ms(""), L.ms("soon")], [500, 500, 10000, 0, 0]);
  const mast = { aspects: { R292: "stop", R281: "clear" } };
  assert.equal(L.stopAspect(mast), "R292");
  assert.equal(L.stopAspect({ aspects: { Clear: "clear", Danger: "stop" } }), "Danger");
  assert.equal(L.pickAspect(mast, "R281; Lit; Unheld"), "R281");
  assert.equal(L.pickAspect(mast, "R281; Lit; Held"), "R292");
  assert.equal(L.pickAspect(mast, "Nope; Lit; Unheld"), undefined);
});

if (!process.exitCode) console.log("\nAll logic engine tests passed.");
