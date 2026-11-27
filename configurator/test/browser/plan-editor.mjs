// Drives the new Field Logic page (work item TP 6) in Chromium, as a person
// would, from an empty page: the only step open is Draw. It draws the
// gauntlet over a bridge with the mouse, settles both joins, then follows
// each step's Next button: cuts the track into blocks and makes their
// sensors there, makes the two signals at their block breaks, says what is
// beyond the open ends, reads what protects the bridge, and ends at Download
// with no problems. npm test does not run it (it needs a browser). Run it
// after changing logic-ui-field.js, logic-ui-plan.js or plan-edit.js:
//
//   cd configurator
//   npm install --no-save playwright && npx playwright install chromium
//   node test/browser/plan-editor.mjs
//
// PLAYWRIGHT=/path/to/node_modules/playwright uses a copy installed elsewhere,
// and CHROMIUM=/path/to/chromium a browser already on the computer.
// SHOTS=/some/folder saves a picture of each step there.
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
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
await page.goto(`file://${path.join(configuratorDir, "index.html")}`);
await page.evaluate(() => localStorage.clear());
await page.reload();
const shot = async (name) => { if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`), fullPage: true }); };

// A new board in Field Logic: no sensors, turnouts or signals yet.
await page.evaluate(() => {
  state.board.wifiSsid = "layout-wifi";
  state.board.wifiPassword = "not-a-real-password";
  state.blocks = [];
  state.points = [];
  state.signals.masts = [];
  state.logic = { mode: "field" };
  persist();
  render();
});
await page.click('.nav-item[data-view="logic"]');

const grid = page.locator("#logic-plan-grid");
const panel = page.locator(".plan-panel");
// The open steps, as "1 Draw" or "✓ Draw" (a done step), without their counts.
const openSteps = () => page.evaluate(() => [...document.querySelectorAll(".logic-field-steps button:not([disabled])")]
  .map((b) => [...b.childNodes].filter((n) => !n.classList?.contains("step-count")).map((n) => n.textContent).join("").replace(/\s+/g, " ").trim()));
const problems = () => page.evaluate(() => {
  const { errors: e, warnings: w } = EsphomeMr.validateConfig(state);
  return { errors: [...e], warnings: [...w] };
});
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

// 1. Draw: on an empty page only Draw is open, with Draw picked.
assert.deepEqual(await openSteps(), ["1 Draw"]);
assert.equal(await page.locator("#logic-plan-tool-draw").getAttribute("aria-pressed"), "true");
await shot("1-empty");
for (const [a, b] of [[[0, 0], [3, 0]], [[3, 0], [4, 1]], [[4, 1], [8, 1]], [[8, 1], [9, 0]], [[9, 0], [12, 0]],
  [[0, 2], [3, 2]], [[3, 2], [4, 1]], [[8, 1], [9, 2]], [[9, 2], [12, 2]]]) await drag(a, b);
assert.equal(await trackCount(), 9);
// Drawing does not move the page on to the next step.
assert.equal(await page.locator(".step-pill.is-current").innerText().then((t) => t.includes("Draw")), true);
// Two clicks draw too, and Erase takes the line away again.
await click(0, 4);
await click(3, 4);
assert.equal(await trackCount(), 10);
await page.click("#logic-plan-tool-erase");
await drag([0, 4], [3, 4]);
assert.equal(await trackCount(), 9);
// Each join is a ? until settled: no turnout, as on a gauntlet. The outer
// tracks run one way, so each signal knows which way its trains go.
await page.click("#logic-plan-tool-select");
assert.match(await page.locator(".logic-field-steps").innerText(), /2 problems/);
for (const x of [4, 8]) {
  await click(x, 1);
  await page.selectOption("#logic-plan-turnout", "");
}
for (const [x, y, way] of [[0.5, 0, "right"], [1.5, 2, "left"], [10.5, 0, "right"], [11.5, 2, "left"]]) {
  await click(x, y);
  await page.selectOption("#logic-plan-direction", { label: `Only ${way}` });
}
await shot("2-draw");
await page.click("#logic-plan-next");

// 2. Sensors: four block breaks, three blocks, each sensor made where it goes.
for (const [x, y] of [[2, 0], [2, 2], [10, 0], [10, 2]]) {
  await click(x, y);
  await page.click("#logic-plan-add-break");
}
for (const [x, y, name] of [[0.5, 0, "Left"], [6.5, 1, "Bridge"], [11.5, 2, "Right"]]) {
  await click(x, y);
  await page.fill("#logic-plan-block-name", name);
  await page.locator("#logic-plan-block-name").press("Tab");
  await page.click("#logic-plan-new-sensor-make");
}
const blocks = await page.evaluate(() => state.logic.plan.blocks.map((b) => [b.name, b.sensors]));
assert.deepEqual(blocks, [["Left", ["Left current"]], ["Bridge", ["Bridge current"]], ["Right", ["Right current"]]]);
assert.deepEqual(await page.evaluate(() => state.blocks.map((b) => b.name)), ["Left current", "Bridge current", "Right current"]);
await shot("3-sensors");
await page.click("#logic-plan-next");

// 3. Signals: each made at its break, facing its trains; the open ends are plain track.
async function makeSignal(x, y, way, name) {
  await click(x, y);
  const maker = panel.locator(".plan-maker", { hasText: `heading ${way}` });
  await maker.locator("input").fill(name);
  await maker.getByRole("button").click();
}
await makeSignal(2, 0, "right", "Left Bridge");
await makeSignal(10, 2, "left", "Right Bridge");
for (const [x, y] of [[12, 0], [0, 2]]) {
  await click(x, y);
  await page.selectOption("#logic-plan-beyond", "plain");
}
assert.deepEqual(await page.evaluate(() => state.signals.masts.map((m) => m.name)), ["Left Bridge", "Right Bridge"]);
// A controlled signal can have a button and be Manual only.
await click(2, 0);
await page.check("#logic-plan-manual-0, #logic-plan-manual-1");
assert.equal(await page.evaluate(() => state.logic.plan.breaks.find((b) => b.at[0] === 2 && b.at[1] === 0).signals[0].manualOnly), true);
await page.uncheck("#logic-plan-manual-0, #logic-plan-manual-1");
await shot("4-signals");
const after = await problems();
assert.deepEqual(after.errors, []);
assert.deepEqual(await openSteps(), ["✓ Draw", "✓ Sensors", "✓ Signals", "✓ Behaviour and rules", "✓ Try it", "6 Download"]);
await page.click("#logic-plan-next");

// 4. Behaviour and rules: the bridge is protected by the drawing itself.
await click(6.5, 1);
assert.match(await panel.innerText(), /Signals "Left Bridge" and "Right Bridge" each have a route onto this block/);
await click(2, 0);
assert.match(await panel.innerText(), /"Left Bridge" is a controlled signal/);
// TP 7: hold Left Bridge until a button is pressed, from the example.
await page.click("#logic-plan-example-hold-0");
assert.deepEqual(await page.evaluate(() => state.logic.plan.pieces.map((p) => [p.kind, p.name])), [["button", "Left Bridge go"]]);
await click(2, 0);
assert.match(await panel.innerText(), /Keep at Stop unless: Left Bridge go was pressed in the last 30 seconds\./);
assert.equal(await page.locator(".plan-reads").count(), 1);
assert.ok(await page.evaluate(() => EsphomeMr.generateYaml(state).includes("Left Bridge rule 1")));
await shot("5-behaviour");
await page.click("#logic-plan-next");

// 5. Try it, then Download.
assert.ok(await page.locator("#logic-try").isVisible());
await page.click("#logic-plan-next");
await page.click("#logic-plan-next");
assert.equal(await page.locator('.view[data-panel="yaml"]').isVisible(), true);

// The YAML has a Release button for each signal's route over the bridge.
assert.ok(await page.evaluate(() => EsphomeMr.generateYaml(state).includes('release_group("Left Bridge moves")')));
assert.ok(await page.evaluate(() => EsphomeMr.generateYaml(state).includes('release_group("Right Bridge moves")')));

// The keyboard: arrow to a point and press Enter to pick it.
await page.click('.nav-item[data-view="logic"]');
await page.click("#logic-step-sensors");
await grid.focus();
await page.keyboard.press("Escape");
await page.keyboard.press("Enter");
assert.equal(await panel.locator("h4").first().innerText() !== "", true);

await browser.close();
if (errors.length) {
  console.error(`The page logged errors:\n${errors.join("\n")}`);
  process.exit(1);
}
console.log("The Field Logic page works in the browser: the gauntlet was drawn from an empty page.");
