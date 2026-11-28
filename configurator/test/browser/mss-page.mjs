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
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
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

// ===== A passing siding, dragged in ========================================

// While a sample is dragged, the empty module lights up to take it.
await page.dragAndDrop("#logic-mss-preset-passing", ".mss-drop.is-empty");
const passing = await page.evaluate(() => EsphomeMrMssRow.preset("passing"));
assert.deepEqual(await page.evaluate(() => state.logic.mss.row), passing);
assert.deepEqual(await page.locator(".mss-board-card strong").allInnerTexts(), ["1. Complex cascade", "2. Complex cascade, flipped"]);
assert.equal(await page.evaluate(() => state.blocks.length), 0, "nothing is made while the module is built");
const adds = page.locator(".mss-adds");
assert.match(await adds.innerText(), /Make the module adds/);
assert.match(await adds.innerText(), /Points 1, Points 2/);
// Six signals, two of them two-head: WS2812B LEDs, since LEDs would not fit.
assert.equal(await page.locator("#logic-mss-strip").isChecked(), true);
await shot("2-built");
// Plotted, not made: Pick your module stays the step, the rest wait for Make the module.
assert.equal(await current(), "logic-step-pick");
assert.deepEqual(await openSteps(), ["1 Pick your module"]);
assert.equal(await page.locator("#logic-mss-next").innerText(), "Make the module");
await page.click("#logic-mss-next");

assert.equal(await current(), "logic-step-wire");
assert.equal(await page.evaluate(() => state.blocks.length), 6, "going on made the parts");
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

// ===== Building the module by hand: lines, drag, flip, move, remove ========

// Drag by hand with the mouse: the join gaps show only once a drag has begun.
async function dragTo(source, target) {
  const a = await page.locator(source).first().boundingBox();
  await page.mouse.move(a.x + 10, a.y + 10);
  await page.mouse.down();
  await page.mouse.move(a.x + 30, a.y + 30, { steps: 4 });
  const t = page.locator(target);
  await t.waitFor({ state: "visible" });
  const b = await t.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}
const row = () => page.evaluate(() => state.logic.mss.row.map((n) => `${n.node}${n.turned ? "-joins" : ""}@${n.line || 0}`));

await dragTo("#logic-mss-preset-complex", ".mss-drop.is-empty");
assert.deepEqual(await row(), ["complex@0"]);
// After the split there are two lines: a gap on each, and none at the left for the diverging line.
assert.equal(await page.locator('.mss-drop[data-at="1"][data-line]').count(), 2);
assert.equal(await page.locator('.mss-drop[data-at="0"][data-line]').count(), 1);
// A Cascade on the loop (line 2), then a Complex cascade dropped between the lines joins them.
await dragTo("#logic-mss-preset-cascade", '.mss-drop[data-at="1"][data-line="1"]');
assert.deepEqual(await row(), ["complex@0", "cascade@1"]);
await page.locator("#logic-mss-preset-complex").dispatchEvent("dragstart", { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
assert.equal(await page.locator('.mss-drop[data-at="2"][data-join="0"]').getAttribute("class"), "mss-drop is-join is-valid");
assert.equal(await page.locator('.mss-drop[data-at="1"][data-join="0"]').getAttribute("class"), "mss-drop is-join is-invalid", "not before the Cascade: it would lose its loop");
await shot("2b-dragging");
await page.locator("#logic-mss-preset-complex").dispatchEvent("dragend");
await dragTo("#logic-mss-preset-complex", '.mss-drop[data-at="2"][data-join="0"]');
assert.deepEqual(await row(), ["complex@0", "cascade@1", "complex-joins@0"]);
// Plotting adds nothing: the new boards' parts wait for Make the module, as one problem.
assert.match((await mssProblems()).join(), /^Not made yet: Siding 2 current, IR 3, Points 3, Signal 2 to B, Signal 3 to A, Signal 3 to B main, Signal 3 to B siding\./);
assert.equal(await page.locator("#logic-mss-next").innerText(), "Make the module");
// The picture: the loop split in two by the Cascade's IR sensor.
assert.equal(await page.locator("#logic-mss-picture .mss-row-block").count(), 5);
await shot("6-added");
// Move the Cascade from the loop to the main line.
await dragTo('.mss-board-card[data-board="1"]', '.mss-drop[data-at="1"][data-line="0"]');
assert.deepEqual(await row(), ["complex@0", "cascade@0", "complex-joins@0"]);
// Take the Cascade out: a passing siding, the same as the sample.
await page.locator('.mss-board-card[data-board="1"]').dispatchEvent("dragstart", { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
await page.locator("#logic-mss-bin").dispatchEvent("dragover", { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
await page.locator("#logic-mss-bin").dispatchEvent("drop", { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
assert.deepEqual(await row(), ["complex@0", "complex-joins@0"]);
assert.equal((await page.evaluate(() => state.logic.mss.row))[1].names.right[0], passing[1].names.right[0]);
// Flip the join: it splits instead, three lines at end B; and back.
await page.click("#logic-mss-flip-1");
assert.deepEqual(await row(), ["complex@0", "complex@0"]);
assert.equal(await page.locator("#logic-mss-picture .mss-row-end").count(), 4, "end A, and end B's three tracks");
await page.click("#logic-mss-flip-1");
assert.deepEqual(await row(), ["complex@0", "complex-joins@0"]);
// Start again from the Passing siding sample, whose parts are on their pages already.
await page.click("#logic-mss-start-again");
await page.click(".mss-confirm button.primary");
await page.click("#logic-mss-preset-passing");
assert.deepEqual(await mssProblems(), []);
// Drag the first onto the remove area: the second takes the block they shared.
await page.locator('.mss-board-card[data-board="0"]').dispatchEvent("dragstart", { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
assert.equal(await page.locator("#logic-mss-bin").isVisible(), true, "the remove area shows while a card is dragged");
await page.locator("#logic-mss-bin").dispatchEvent("dragover", { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
await page.locator("#logic-mss-bin").dispatchEvent("drop", { dataTransfer: await page.evaluateHandle(() => new DataTransfer()) });
assert.equal(await page.evaluate(() => state.logic.mss.row.length), 1);
assert.deepEqual(await page.evaluate(() => state.logic.mss.row[0].names.left), ["Block 2 current", "Siding 1 current"]);
// Flip it: its signals are renamed for the way they now face, on their page too.
await page.click("#logic-mss-flip-0");
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
// Without a mouse: clicking a board adds it on the right.
await page.click("#logic-mss-preset-cascade");
await page.click("#logic-mss-preset-cascade");
assert.deepEqual(await page.evaluate(() => state.logic.mss.row), await page.evaluate(() => EsphomeMrMssRow.preset("cascades")));
assert.equal(await page.evaluate(() => Object.keys(state.logic.mss).includes("tracks")), false);

await browser.close();
if (errors.length) {
  console.error(`The page logged errors:\n${errors.join("\n")}`);
  process.exit(1);
}
console.log("The MSS Logic page works in the browser: a passing siding picked from an empty page.");
