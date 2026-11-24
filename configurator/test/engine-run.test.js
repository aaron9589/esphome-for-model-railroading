// Replays every case in test/cases against the JS engine (logic.js). Work item
// 2.2. The cases are the oracle: a mismatch is an engine bug or a spec
// question, never a reason to change the case's expected values.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, test } from "./harness.js";
import { runCase } from "./engine-runner.js";

const casesDir = path.join(configuratorDir, "test", "cases");

for (const file of fs.readdirSync(casesDir).filter((f) => f.endsWith(".json")).sort()) {
  const data = JSON.parse(fs.readFileSync(path.join(casesDir, file), "utf8"));
  test(`${file.replace(/\.json$/, "")}: ${data.name}`, () => {
    assert.deepEqual(runCase(data), []);
  });
}

if (!process.exitCode) console.log("\nThe JS engine passes every case.");
