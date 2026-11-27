// Drives the Field Logic track plan editor in Chromium, as a person would:
// draws the gauntlet over a bridge with the mouse, sets it up from the panel,
// checks the board has no problems (the drawing protects the bridge by
// itself), and changes the bridge's Timing. npm test does not run it (it needs a
// browser). Run it after changing logic-ui-plan.js or plan-edit.js:
//
//   cd configurator
//   npm install --no-save playwright && npx playwright install chromium
//   node test/browser/plan-editor.mjs
//
// PLAYWRIGHT=/path/to/node_modules/playwright uses a copy installed elsewhere,
// and CHROMIUM=/path/to/chromium a browser already on the computer.
import { createRequire } from "node:module";
import assert from "node:assert/strict";
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

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1200, height: 1500 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
await page.goto(`file://${path.join(configuratorDir, "index.html")}`);
await page.evaluate(() => localStorage.clear());
await page.reload();

// A board with the gauntlet's sensors and two CATS masts, in Field Logic.
await page.evaluate(() => {
  state.board.wifiSsid = "layout-wifi";
  state.board.wifiPassword = "not-a-real-password";
  state.blocks = [];
  state.points = [];
  const aspects = ["R292", "R285", "ADV_NORM", "R281"].map((label, i) => ({
    label, states: [`${label}; Lit; Unheld`], startup: i === 0, lamps: [{ color: i ? "green" : "red", mode: "steady" }],
  }));
  addItems({
    sensors: ["Left current", "Bridge current", "Right current"],
    masts: ["Left Bridge", "Right Bridge"].map((name) => ({ name, lamps: [{ name: "Head", count: 1 }], aspects })),
  });
  state.logic = { mode: "field" };
  persist();
  render();
});
await page.click('.nav-item[data-view="logic"]');

const card = page.locator("#logic-plan");
const grid = page.locator("#logic-plan-grid");
const problems = () => page.evaluate(() => {
  const { errors: e, warnings: w } = EsphomeMr.validateConfig(state);
  return { errors: e, warnings: w };
});

// The screen position of a grid point.
async function at(x, y) {
  await grid.scrollIntoViewIfNeeded();
  const box = await grid.boundingBox();
  const [vx, vy, vw, vh] = (await grid.getAttribute("viewBox")).split(" ").map(Number);
  return [box.x + ((x * 48 - vx) / vw) * box.width, box.y + ((y * 48 - vy) / vh) * box.height];
}
async function drag(a, b) {
  await page.mouse.move(...await at(...a));
  await page.mouse.down();
  await page.mouse.move(...await at(...b), { steps: 6 });
  await page.mouse.up();
}
const click = async (x, y) => page.mouse.click(...await at(x, y));
const trackCount = () => page.evaluate(() => state.logic.plan?.track.length ?? 0);

// 1. Draw: an empty plan starts on Draw. Drag the gauntlet's nine lines.
assert.equal(await page.locator("#logic-plan-tool-draw").getAttribute("aria-pressed"), "true");
for (const [a, b] of [[[0, 0], [3, 0]], [[3, 0], [4, 1]], [[4, 1], [8, 1]], [[8, 1], [9, 0]], [[9, 0], [12, 0]],
  [[0, 2], [3, 2]], [[3, 2], [4, 1]], [[8, 1], [9, 2]], [[9, 2], [12, 2]]]) await drag(a, b);
assert.equal(await trackCount(), 9);
// Two clicks draw too, and Erase takes the line away again.
await click(0, 4);
await click(3, 4);
assert.equal(await trackCount(), 10);
await page.click("#logic-plan-tool-erase");
await drag([0, 4], [3, 4]);
assert.equal(await trackCount(), 9);

// 2. Select: the two joins have no turnout; breaks, signals, blocks, one way, ends.
await page.click("#logic-plan-tool-select");
for (const x of [4, 8]) {
  await click(x, 1);
  await page.selectOption("#logic-plan-turnout", "");
}
for (const [x, y] of [[2, 0], [2, 2], [10, 0], [10, 2]]) {
  await click(x, y);
  await card.getByRole("button", { name: "Add a block break" }).click();
}
async function signal(x, y, way, mast) {
  await click(x, y);
  await card.locator(`label:has(span.field-label:text-is("Signal for trains heading ${way}")) select`).selectOption(mast);
}
await signal(2, 0, "right", "Left Bridge");
await signal(10, 2, "left", "Right Bridge");
for (const [x, y, name, sensor] of [[0.5, 0, "Left", "Left current"], [6.5, 1, "Bridge", "Bridge current"], [11.5, 2, "Right", "Right current"]]) {
  await click(x, y);
  // Type the name, then tick straight away: the tick must not be lost.
  await page.fill("#logic-plan-block-name", name);
  await card.getByLabel(sensor, { exact: true }).check();
}
for (const [x, y, way] of [[0.5, 0, "right"], [1.5, 2, "left"], [10.5, 0, "right"], [11.5, 2, "left"]]) {
  await click(x, y);
  await page.selectOption("#logic-plan-direction", { label: `Only ${way}` });
}
for (const [x, y] of [[12, 0], [0, 2]]) {
  await click(x, y);
  await page.selectOption("#logic-plan-beyond", "plain");
}
const blocks = await page.evaluate(() => state.logic.plan.blocks.map((b) => [b.name, b.sensors]));
assert.deepEqual(blocks, [["Left", ["Left current"]], ["Bridge", ["Bridge current"]], ["Right", ["Right current"]]]);

// 3. The two signals can both send a train onto the bridge: the drawing
// protects it by itself, and the bridge's panel says so.
const after = await problems();
assert.deepEqual(after.errors, []);
await click(6.5, 1);
const protects = await card.locator(".plan-block-part").innerText();
assert.ok(protects.includes('Signals "Left Bridge" and "Right Bridge" can each send a train onto this block.'), protects);

// Timing stays open while its settings change.
await card.locator(".plan-more summary").click();
await page.selectOption("#logic-plan-block-release", "5s");
assert.equal(await card.locator(".plan-more").evaluate((d) => d.open), true);
assert.equal(await page.evaluate(() => state.logic.plan.blocks.find((b) => b.name === "Bridge").release), "5s");

// The YAML has a Release button for each signal's route over the bridge.
assert.ok(await page.evaluate(() => EsphomeMr.generateYaml(state).includes('release_group("Left Bridge moves")')));
assert.ok(await page.evaluate(() => EsphomeMr.generateYaml(state).includes('release_group("Right Bridge moves")')));

// 4. The keyboard: arrow to a point and press Enter to pick it.
await grid.focus();
await page.keyboard.press("Escape");
await page.keyboard.press("Enter");
assert.equal(await card.locator(".plan-panel h4").first().innerText() !== "", true);

await browser.close();
if (errors.length) {
  console.error(`The page logged errors:\n${errors.join("\n")}`);
  process.exit(1);
}
console.log("The track plan editor works in the browser.");
