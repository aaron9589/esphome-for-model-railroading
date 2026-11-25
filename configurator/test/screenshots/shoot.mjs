// Guide screenshots. Each guide has a script beside this one that drives the
// real configurator in Chromium by following the guide's own steps, then
// saves pictures of the page into docs/img/<guide>/. npm test does not run
// them. Run one again when the page changes:
//
//   cd configurator
//   npm install --no-save playwright && npx playwright install chromium
//   node test/screenshots/field-logic.mjs
//
// PLAYWRIGHT=/path/to/node_modules/playwright uses a copy installed elsewhere.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const configuratorDir = path.join(here, "..", "..");
export const repoDir = path.join(configuratorDir, "..");

function playwright() {
  const require = createRequire(import.meta.url);
  try {
    return require(process.env.PLAYWRIGHT || "playwright");
  } catch {
    console.error("Playwright is not installed. In configurator/, run:\n  npm install --no-save playwright && npx playwright install chromium");
    process.exit(1);
  }
}

// Opens the configurator from disk with nothing saved: the page a newcomer sees.
// Returns { browser, page, shot, done }. shot(target, name) saves a picture of
// a locator (or selector) as docs/img/<guide>/<name>.png. done() closes the
// browser and fails if the page logged an error.
export async function openConfigurator(guide, { width = 1100, height = 900 } = {}) {
  const outDir = path.join(repoDir, "docs", "img", guide);
  fs.mkdirSync(outDir, { recursive: true });
  const { chromium } = playwright();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`file://${path.join(configuratorDir, "index.html")}`);
  const saved = [];
  async function shot(target, name, options = {}) {
    const locator = typeof target === "string" ? page.locator(target) : target;
    await locator.scrollIntoViewIfNeeded();
    const file = path.join(outDir, `${name}.png`);
    await locator.screenshot({ path: file, animations: "disabled", ...options });
    saved.push(path.relative(repoDir, file));
  }
  async function done() {
    await browser.close();
    for (const file of saved) console.log(`saved ${file}`);
    if (errors.length) {
      console.error(`The page logged errors:\n${errors.join("\n")}`);
      process.exit(1);
    }
  }
  return { browser, page, shot, done };
}
