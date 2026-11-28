// Drives the MSS Logic page (docs/mss-patterns-spec.md; work item MP 2) in
// Chromium, as a person would, from an empty page: the only step open is
// Pick your module, with a card and picture for each standard module. It
// picks a passing siding, adds it, and follows the steps: the module's
// picture lights each step's parts, Try it shows under its step, and the
// settings and what MSS Logic made fold away. Then Start again, and a module
// described by hand. npm test does not run it (it needs a browser). Run it
// after changing logic-ui-mss-page.js, logic-ui-mss-row.js or mss-row.js:
//
//   cd configurator
//   npm install --no-save playwright && npx playwright install chromium
//   node test/browser/mss-page.mjs
//
// PLAYWRIGHT=/path/to/node_modules/playwright uses a copy installed elsewhere,
// and CHROMIUM=/path/to/chromium a browser already on the computer.
// SHOTS=/some/folder saves a picture of each step there.
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

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
await page.goto(`file://${path.join(configuratorDir, "index.html")}`);
await page.evaluate(() => localStorage.clear());
await page.reload();
const shot = async (name) => { if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`), fullPage: true }); };

// A new board in MSS Logic: no sensors, turnouts or signals yet.
await page.evaluate(() => {
  state.board.wifiSsid = "layout-wifi";
  state.board.wifiPassword = "not-a-real-password";
  state.blocks = [];
  state.points = [];
  state.signals.masts = [];
  state.logic = { mode: "mss" };
  persist();
  render();
});
await page.click('.nav-item[data-view="logic"]');

const openSteps = () => page.evaluate(() => [...document.querySelectorAll(".logic-field-steps button:not([disabled])")]
  .map((b) => [...b.childNodes].filter((n) => !n.classList?.contains("step-count")).map((n) => n.textContent).join("").replace(/\s+/g, " ").trim()));
const current = () => page.evaluate(() => document.querySelector(".logic-field-steps [aria-current=step]")?.id);
const mssProblems = () => page.evaluate(() => EsphomeMrMssBuilder.problems(state).map((p) => p.text));

// ===== An empty page: Pick your module, and nothing else ====================

assert.deepEqual(await openSteps(), ["1 Pick your module"]);
assert.equal(await page.locator(".mss-preset").count(), 5, "a card for each MSS board, and the samples");
assert.equal(await page.locator(".mss-preset svg.mss-row-picture").count(), 5, "each with its picture");
assert.deepEqual(await page.locator(".mss-presets.is-boards .mss-preset strong").allInnerTexts(), ["Crossover", "Cascade", "Complex cascade"]);
assert.deepEqual(await page.locator(".mss-presets.is-samples .mss-preset strong").allInnerTexts(), ["Passing siding", "Two cascades"]);
assert.equal(await page.locator("#logic-mode").count(), 0, "the mode card is folded behind Settings");
assert.equal(await page.locator("#logic-layers-view").count(), 0);
await shot("1-pick");

// ===== A passing siding =====================================================

await page.click("#logic-mss-preset-passing");
const confirm = page.locator(".mss-confirm");
assert.match(await confirm.innerText(), /Start this module as a Passing siding\?/);
assert.match(await confirm.innerText(), /Points 1, Points 2/);
// Six signals, two of them two-head: WS2812B LEDs, since LEDs would not fit.
assert.equal(await page.locator("#logic-mss-strip").isChecked(), true);
await shot("2-confirm");
await page.click("#logic-mss-add");

assert.equal(await current(), "logic-step-wire");
assert.deepEqual(await openSteps(), ["✓ Pick your module", "✓ Wire it", "✓ Signals", "✓ Try it", "5 Download", "6 Pair"]);
assert.deepEqual(await mssProblems(), []);
const picture = page.locator("#logic-mss-picture");
assert.equal(await picture.count(), 1, "the module's picture above the step");
// Wire it lights the part being wired, the first to start with; Signals lights the signals.
assert.equal(await picture.locator(".is-lit").count(), 1);
assert.equal(await picture.locator('[data-part="Block 1 current"].is-lit').count(), 1);
await shot("3-wire");
// Each part has its number on the picture, done ones a tick; the first is being wired.
assert.equal(await picture.locator(".mss-row-badge").count(), 12, "8 parts and each end's Pair button and LED");
assert.match(await page.locator("#logic-mss-wire").innerText(), /1 of 12\s+Block 1 current \(block detector\)/);
// Click IR 2 on the picture: it is the one being wired, lit.
await picture.locator('[data-part="IR 2"] text').first().click();
assert.match(await page.locator("#logic-mss-wire").innerText(), /6 of 12\s+IR 2 \(IR sensor\)/);
assert.equal(await picture.locator('[data-part="IR 2"].is-lit').count(), 1);
// Put it on Block 1's pin: both are shared, in red, and Wire it is not done.
const block1 = await page.evaluate(() => state.blocks.find((b) => b.name === "Block 1 current").gpio);
await page.selectOption("#logic-mss-wire-pin", block1);
assert.match(await page.locator("#logic-mss-wire").innerText(), /is used by something else too/);
assert.equal(await picture.locator(".mss-row-badge.is-error").count(), 2);
assert.equal(await page.locator("#logic-step-wire .step-number").innerText(), "2");
await shot("3b-shared");
// A free pin again; then End A's Pair button, from the picture.
const unused = await page.evaluate(() => {
  const used = new Set([...state.blocks.map((b) => b.gpio), ...state.signals.masts.map((m) => m.pin), ...state.signals.masts.flatMap((m) => (m.lamps || []).map((l) => l.pin))]);
  return [...document.querySelectorAll("#logic-mss-wire-pin option")].map((o) => o.value).find((v) => v && !used.has(v) && !/GPIO(0|2|5|12|15)$/.test(v));
});
await page.selectOption("#logic-mss-wire-pin", unused);
assert.equal(await picture.locator(".mss-row-badge.is-error").count(), 0);
await picture.locator('[data-part="end:A:pair"] circle').dispatchEvent("click");
assert.match(await page.locator("#logic-mss-wire").innerText(), /End A Pair button/);
const pairPin = await page.evaluate(() => {
  const used = new Set([...state.blocks.map((b) => b.gpio), ...state.signals.masts.map((m) => m.pin)]);
  return [...document.querySelectorAll("#logic-mss-wire-pin option")].map((o) => o.value).find((v) => v && !used.has(v) && !/GPIO(0|2|5|12|15)$/.test(v));
});
await page.selectOption("#logic-mss-wire-pin", pairPin);
assert.deepEqual(await page.evaluate(() => state.logic.mss.ends), [{ name: "A", pairPin }]);
await page.click("#logic-mss-wire-next");
assert.match(await page.locator("#logic-mss-wire").innerText(), /End A LED/);
assert.deepEqual(await mssProblems(), []);
assert.equal(await page.locator("#logic-step-wire .step-number").innerText(), "✓");
await page.click("#logic-mss-next");
assert.equal(await current(), "logic-step-signals");
// The signal being set up is lit, the others badged with a tick.
assert.equal(await picture.locator(".mss-row-signal.is-lit").count(), 1);
assert.equal(await picture.locator(".mss-row-block.is-lit").count(), 0);
assert.match(await page.locator("#logic-mss-signal").innerText(), /1 of 6\s+Signal 1 to B \(two heads/);
// What it shows: point at Clear and the picture's heads light red over green... upper head first.
const chips = () => page.locator("#logic-mss-signal .mss-indication").evaluateAll((all) => all.map((c) => c.textContent.trim()));
assert.deepEqual(await chips(), ["Stop", "Approach", "Clear", "Diverging Clear", "Diverging Approach"]);
await page.hover('#logic-mss-signal [data-indication="clear"]');
assert.deepEqual(await picture.locator('[data-part="Signal 1 to B"] .mss-row-head').evaluateAll((h) => h.map((x) => x.style.fill)), ["rgb(22, 163, 74)", "rgb(220, 38, 38)"]);
// Tick Advance Approach: it is offered on every signal, flashing yellow over red here.
await page.check("#logic-mss-tick-advance");
assert.deepEqual(await chips(), ["Stop", "Approach", "Advance Approach", "Clear", "Diverging Clear", "Diverging Approach"]);
assert.equal(await page.locator('#logic-mss-signal [data-indication="advance"] .mss-lamp.is-blink').count(), 1);
assert.deepEqual(await mssProblems(), []);
// Click the siding's signal on the picture, and give it individual LEDs: three pins, made free.
await picture.locator('[data-part="Signal 1 to A siding"] .mss-row-label').click();
assert.match(await page.locator("#logic-mss-signal").innerText(), /Signal 1 to A siding/);
await page.selectOption("#logic-mss-signal-style", "leds");
assert.equal(await page.locator("#logic-mss-signal [data-signal-pin]").count(), 3);
assert.equal(await page.evaluate(() => state.signals.masts.find((m) => m.name === "Signal 1 to A siding").lamps.every((l) => l.pin)), true);
assert.deepEqual(await mssProblems(), []);
await shot("3c-signals");
await page.click("#logic-mss-next");
assert.equal(await current(), "logic-step-try");
assert.equal(await page.locator("#logic-try").count(), 1, "Try it under its step");
await shot("4-try");
await page.click("#logic-mss-next");
assert.equal(await page.locator("#logic-try").count(), 0, "and only there");
await page.click("#logic-mss-next");
assert.equal(await current(), "logic-step-pair");
assert.match(await page.locator(".mss-pair").innerText(), /Press Pair/);

// What MSS Logic made, and the settings, fold away.
await page.click("#logic-mss-views");
assert.equal(await page.locator("#logic-layers-view").count(), 1);
await page.click("#logic-mss-views");
assert.equal(await page.locator("#logic-layers-view").count(), 0);
await page.click("#logic-mss-settings");
assert.equal(await page.locator("#logic-mode").count(), 1);
await page.click("#logic-mss-settings");

// ===== Start again =========================================================

await page.click("#logic-step-pick");
assert.deepEqual(await page.locator(".mss-board-card strong").allInnerTexts(), ["1. Complex cascade", "2. Complex cascade, flipped"]);
assert.equal(await page.locator(".mss-board-card svg").count(), 2, "each board card with its picture");
await page.click("#logic-mss-start-again");
await page.click(".mss-confirm button.primary");
assert.deepEqual(await openSteps(), ["1 Pick your module"]);
assert.equal(await page.locator(".mss-preset").count(), 5);
assert.equal(await page.evaluate(() => state.blocks.length), 6, "the parts stay on their pages");

// ===== Building the row: add, remove, turn round ===========================

await page.click("#logic-mss-preset-complex");
await page.click("#logic-mss-add");
await page.click("#logic-step-pick");
// Only a board whose tracks meet the Complex cascade's two is offered: one flipped.
assert.equal(await page.locator("#logic-mss-add-cascade").count(), 0);
assert.equal(await page.locator("#logic-mss-add-complex").count(), 0);
await page.click("#logic-mss-add-complex-flipped");
assert.match(await page.locator(".mss-confirm").innerText(), /Stitch a Complex cascade, flipped onto the right of the module\?/);
await page.click("#logic-mss-change");
const passing = await page.evaluate(() => EsphomeMrMssRow.preset("passing"));
assert.deepEqual(await page.evaluate(() => state.logic.mss.row), passing, "the same as the Passing siding preset");
assert.equal(await page.locator("#logic-mss-picture .mss-row-block").count(), 4);
assert.equal(await page.locator("#logic-mss-flip-1").isDisabled(), true, "flipped, it would not join");
assert.deepEqual(await mssProblems(), []);
await shot("6-added");
// Remove the first: the second takes the block they shared.
await page.click("#logic-mss-remove-0");
assert.match(await page.locator(".mss-confirm").innerText(), /stay on their pages, no longer used by the module: Block 1 current, IR 1, Points 1, Signal 1 to B, Signal 1 to A main, Signal 1 to A siding/);
await page.click("#logic-mss-change");
assert.deepEqual(await page.evaluate(() => state.logic.mss.row[0].names.left), ["Block 2 current", "Siding 1 current"]);
// Turn it round: its signals are renamed for the way they now face, on their page too.
await page.click("#logic-mss-flip-0");
assert.match(await page.locator(".mss-confirm").innerText(), /Signal 2 to A to Signal 2 to B, Signal 2 to B main to Signal 2 to A main, Signal 2 to B siding to Signal 2 to A siding/);
await page.click("#logic-mss-change");
const masts = await page.evaluate(() => state.signals.masts.map((m) => m.name));
assert.ok(masts.includes("Signal 2 to B") && !masts.includes("Signal 2 to A"), masts.join());
assert.equal(await page.evaluate(() => state.signals.masts.find((m) => m.name === "Signal 2 to B").topic), "trains/track/signalmast/Signal 2 to B");
assert.deepEqual(await mssProblems(), []);
await page.click("#logic-mss-start-again");
await page.click(".mss-confirm button.primary");

// ===== A module described by hand ==========================================

const described = JSON.parse(fs.readFileSync(path.join(configuratorDir, "test/cases/mss/mss-junction-turnout.json"), "utf8")).module.mss;
await page.evaluate((mss) => { state.logic.mss = mss; persist(); render(); }, described);
assert.match(await page.locator(".mss-panel").innerText(), /described by hand/);
await shot("5-hand-written");
await page.click("#logic-mss-from-pattern");
await page.click(".mss-confirm button.primary");
assert.equal(await page.locator(".mss-preset").count(), 5);
assert.equal(await page.evaluate(() => Object.keys(state.logic.mss).includes("tracks")), false);

await browser.close();
if (errors.length) {
  console.error(`The page logged errors:\n${errors.join("\n")}`);
  process.exit(1);
}
console.log("The MSS Logic page works in the browser: a passing siding picked from an empty page.");
