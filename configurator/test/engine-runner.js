// Replays one case (test/cases) against the JS engine. Shared by
// engine-run.test.js and logic.test.js.
import assert from "node:assert/strict";
import { loadModules } from "./harness.js";

const { EsphomeMrLogic: L } = loadModules("logic.js");
const plain = (value) => JSON.parse(JSON.stringify(value));

// Runs one case. Returns a list of mismatches, each naming the step.
export function runCase(data) {
  const engine = L.createEngine(data.board, data.start || {});
  const problems = [];
  let next = 0;
  for (const step of data.steps) {
    while (next < step.at) {
      engine.scan();
      next += 1;
    }
    for (const e of step.do || []) engine.event(e);
    const out = plain(engine.scan());
    next += 1;
    const state = plain(engine.state());
    const expect = step.expect || {};
    for (const key of ["logic"]) {
      if (key in expect && state[key] !== expect[key]) problems.push(`scan ${step.at}: ${key} is ${state[key]}, expected ${expect[key]}`);
    }
    for (const key of ["masts", "rules", "resources", "holders", "locks", "locked"]) {
      for (const [name, want] of Object.entries(expect[key] || {})) {
        const got = state[key][name];
        if (got !== want) problems.push(`scan ${step.at}: ${key} ${name} is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
      }
    }
    for (const key of ["events", "writes", "publishes"]) {
      if (!(key in expect)) continue;
      try {
        assert.deepEqual(out[key], expect[key]);
      } catch {
        problems.push(`scan ${step.at}: ${key} ${JSON.stringify(out[key])}, expected ${JSON.stringify(expect[key])}`);
      }
    }
  }
  return problems;
}
