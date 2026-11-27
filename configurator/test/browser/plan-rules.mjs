// Drives your own pieces and rules on the Field Logic page (work item TP 7)
// in Chromium: on the passing siding, hands the east turnout to a local panel
// with the example, puts a lamp on the drawing, and writes a rule for it
// with the rule editor. npm test does not run it. Run it as plan-editor.mjs.
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

// The passing siding, drawn, with its sensors, turnouts and CATS masts.
await page.evaluate((m) => {
  state.board.wifiSsid = "layout-wifi";
  state.board.wifiPassword = "not-a-real-password";
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
await page.click("#logic-step-behaviour");

const grid = page.locator("#logic-plan-grid");
const panel = page.locator(".plan-panel");
async function at(x, y) {
  await grid.scrollIntoViewIfNeeded();
  const box = await grid.boundingBox();
  const [vx, vy, vw, vh] = (await grid.getAttribute("viewBox")).split(" ").map(Number);
  return [box.x + ((x * 48 - vx) / vw) * box.width, box.y + ((y * 48 - vy) / vh) * box.height];
}
const click = async (x, y) => page.mouse.click(...await at(x, y));
const problems = () => page.evaluate(() => [...EsphomeMr.validateConfig(state).errors]);

// 1. Hand PE to a local panel: the example writes a switch, a lamp and rules.
await click(12, 1);
await page.click("#logic-plan-example-local");
const pieces = await page.evaluate(() => state.logic.plan.pieces.map((p) => [p.kind, p.name]));
assert.deepEqual(pieces, [["switch", "PE local"], ["lamp", "PE lamp"]]);
const kinds = await page.evaluate(() => state.logic.plan.rules.map((r) => r.kind));
assert.ok(kinds.includes("ownButtonsWhile") && kinds.includes("flashWhile") && kinds.includes("stopWhile"), kinds.join());
// A free pin each for the two pieces, as the page offers them; then nothing is wrong.
await page.evaluate(() => {
  for (const name of ["PE local", "PE lamp"]) {
    const used = new Set([...usedPins(), ...EsphomeMrLogicYaml.buttonPins(state).map((b) => b.pin)]);
    const pin = PULLUP_PINS.find((p) => !used.has(p) && !STRAPPING_PINS.has(p));
    state.logic.plan.pieces.find((x) => x.name === name).pin = pin;
  }
  persist();
  render();
});
// (The case's own signal buttons share pins with masts this test made; only
// what the example added is checked.)
assert.deepEqual((await problems()).filter((e) => /PE local|PE lamp|Rule \d/.test(e)), []);
await click(12, 1);
assert.ok((await page.locator(".plan-reads").count()) >= 3, "dotted lines from PE to what its rules read");
await shot("rules-1-local-panel");

// 2. Put a lamp on the drawing, and light it with the rule editor while Far is occupied.
await click(16, 4);
await page.selectOption("#logic-plan-new-piece-kind", "lamp");
await page.fill("#logic-plan-new-piece-name", "Far lamp");
await page.click("#logic-plan-new-piece-make");
assert.match(await panel.innerText(), /Lamp: Far lamp/);
await page.selectOption("#logic-plan-cond-0", "block|Far");
await page.click("#logic-plan-save-rule");
assert.match(await panel.innerText(), /Light while: Far is occupied\./);
await shot("rules-2-lamp");
const yaml = await page.evaluate(() => EsphomeMr.generateYaml(state));
assert.ok(yaml.includes("panel_locked: pe_panel_locked") && yaml.includes("Far lamp rule 1"), "the board has the panel lock and the lamp's rule");

await browser.close();
if (errors.length) {
  console.error(`The page logged errors:\n${errors.join("\n")}`);
  process.exit(1);
}
console.log("Your own pieces and rules work in the browser: a local panel and a lamp on the passing siding.");
