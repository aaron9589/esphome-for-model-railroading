// Shared helpers for the configurator tests. Each *.test.js file imports these,
// and test/run.js runs every *.test.js file in its own Node process.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

export const configuratorDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Load browser scripts from configurator/ into one fresh vm context, in order,
 * the way index.html loads them. Later files see what earlier ones put on
 * globalThis (for example `EsphomeMr`). Returns the context.
 */
export function loadModules(...files) {
  const context = { crypto: globalThis.crypto };
  context.globalThis = context;
  vm.createContext(context);
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(configuratorDir, file), "utf8"), context, { filename: file });
  }
  return context;
}

/**
 * Run one named test. A failure is reported and marks the file as failed, and
 * the remaining tests in the file still run.
 */
export function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`fail - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}
