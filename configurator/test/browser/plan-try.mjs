// Drives Try it on the Field Logic page's drawing (work item TP 8) in
// Chromium: a meet on the passing siding. A train at each end asks for its
// route; each route shows green, each signal clears, and as the westbound
// train runs into the loop its track is taken behind it and its signal goes
// back to Stop. npm test does not run it. Run it as plan-editor.mjs.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const configuratorDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require(process.env.PLAYWRIGHT || "playwright"));
} catch {
  console.error("Playwright is not installed. In configurator/, run:\n  npm install --no-save playwright && npx playwright install chromium");
  process.exit(1);
}
const module = JSON.parse(fs.readFileSync(path.join(configuratorDir, "test/cases/plan/passing-siding.json"), "utf8")).module;

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
await page.goto(`file://${path.join(configuratorDir, "index.html")}`);
await page.evaluate(() => localStorage.clear());
await page.reload();
const shot = async (name) => { if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`), fullPage: true }); };

await page.evaluate((m) => {
  state.blocks = [];
  state.points = [];
  state.signals.masts = [];
  const aspects = ["R292", "R285", "ADV_NORM", "R281", "R282", "R283", "R286"].map((label, i) => ({
    label, states: [`${label}; Lit; Unheld`], startup: i === 0, lamps: [{ color: i ? "green" : "red", mode: "steady" }],
  }));
  addItems({ sensors: m.sensors, turnouts: m.turnouts, masts: m.masts.map((name) => ({ name, lamps: [{ name: "Head", count: 1 }], aspects })) });
  state.logic = { mode: "field", plan: JSON.parse(JSON.stringify(m.plan)) };
  persist();
  render();
}, module);
await page.click('.nav-item[data-view="logic"]');
await page.click("#logic-step-try");

const grid = () => page.locator("#logic-try-grid");
async function at(x, y) {
  await grid().scrollIntoViewIfNeeded();
  const box = await grid().boundingBox();
  const [vx, vy, vw, vh] = (await grid().getAttribute("viewBox")).split(" ").map(Number);
  return [box.x + ((x * 48 - vx) / vw) * box.width, box.y + ((y * 48 - vy) / vh) * box.height];
}
const click = async (x, y) => page.mouse.click(...await at(x, y));
const count = (cls) => page.locator(`#logic-try-grid .plan-live.is-${cls}`).count();
const lamp = (n) => page.locator("#logic-try-grid .plan-live-lamp").nth(n).getAttribute("fill");

// The east turnout to the siding, then a train at each end.
await click(12, 1);
await click(0.5, 1);
await click(19.5, 1);
await page.click("button:text('Skip ahead 1 second')");
assert.ok((await count("route")) >= 2, "both routes are set, in green");
assert.ok((await count("train")) >= 2, "two trains");
await shot("try-1-both-routes");
const greens = [];
for (let n = 0; n < 7; n += 1) greens.push(await lamp(n));
assert.ok(greens.filter((c) => c !== "#dc2626").length >= 2, `two signals off Stop: ${greens.join()}`);

// The eastbound train runs into West points, then on into the main loop:
// West points is still taken behind it until it has been clear 3 seconds.
await click(3.5, 1);
await click(0.5, 1);
await click(8.5, 1);
await click(3.5, 1);
await page.click("button:text('Step')");
assert.ok((await count("taken")) >= 1, "track taken behind the train");
await shot("try-2-meet");
await page.click("button:text('Skip ahead 10 seconds')");
assert.equal(await count("taken"), 0, "freed behind the train");
assert.ok((await page.locator(".plan-log li").count()) > 0, "what happened is listed");

// Pick West Home: its panel says what it shows, and why.
await click(2, 1);
assert.match(await page.locator(".plan-panel").innerText(), /Signal West Home/);

await browser.close();
if (errors.length) {
  console.error(`The page logged errors:\n${errors.join("\n")}`);
  process.exit(1);
}
console.log("Try it works on the drawing: a meet on the passing siding.");
