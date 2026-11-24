// Runs every test/*.test.js file, each in its own Node process, and fails if any
// of them fails. Pass file names to run only those: node test/run.js golden
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv.slice(2);
const files = fs
  .readdirSync(testDir)
  .filter((file) => file.endsWith(".test.js"))
  .filter((file) => !only.length || only.some((name) => file.startsWith(name)))
  .sort();

if (!files.length) {
  console.error(`No test files match: ${only.join(" ")}`);
  process.exit(1);
}

const failed = [];
for (const file of files) {
  console.log(`# ${file}`);
  const result = spawnSync(process.execPath, [path.join(testDir, file)], { stdio: "inherit" });
  if (result.status !== 0) failed.push(file);
}

if (failed.length) {
  console.error(`\n${failed.length} of ${files.length} test files failed: ${failed.join(", ")}`);
  process.exit(1);
}
console.log(`\nAll ${files.length} test files passed.`);
