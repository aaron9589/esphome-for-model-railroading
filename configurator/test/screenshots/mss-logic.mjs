// Screenshots for docs/mss-logic-guide.md. Follows the guide's steps on the
// real configurator, as a newcomer would, from an empty page: West (one
// Cascade) on one board, then East (a passing siding from two Complex
// cascades) on a fresh board in a new browser window, which starts with
// nothing saved. It checks the page says what the guide says as it goes, and
// stops if it does not. See shoot.mjs for how to run it.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openConfigurator, repoDir } from "./shoot.mjs";

const { browser, page, shot, done } = await openConfigurator("mss-logic");
const outDir = path.join(repoDir, "docs", "img", "mss-logic");
const errors = [];

// ===== Helpers ===============================================================

const nav = (p, view) => p.click(`.nav-item[data-view="${view}"]`);

// The input or select of the field labelled `label` inside `scope`.
const fieldIn = (scope, label) => scope.locator(`label:has(.field-label:text-is("${label}"))`).locator("input, select").first();

// The top bar sticks to the top of the window, so a card scrolled up to it
// would be drawn under it. Pictures only: let it scroll away with the page.
const unstickTopBar = (p) => p.addStyleTag({ content: ".topbar { position: static !important; }" });

// Drag with the mouse, as a person does: some gaps (where a Complex cascade
// joins two lines) show only once a drag has started.
async function drag(p, source, target) {
  await p.locator(source).hover();
  await p.mouse.down();
  const from = await p.locator(source).boundingBox();
  await p.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 4 });
  const to = await p.locator(target).boundingBox();
  await p.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await p.mouse.up();
}

// Nothing focused, so no focus ring or selected text in a picture.
const blur = (p) => p.evaluate(() => document.activeElement?.blur());

// A second board: a new browser window with nothing saved, and its own clock.
async function freshPage() {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  const p = await context.newPage();
  p.on("pageerror", (error) => errors.push(error.message));
  p.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await p.clock.install();
  await p.goto(page.url());
  await unstickTopBar(p);
  return p;
}

// Before you start: the board's name and Wi-Fi, and the example sensor and
// turnout cleared away (Clear this page, then yes).
async function startBoard(p, name) {
  await nav(p, "board");
  await fieldIn(p.locator("#board-identity"), "Board name").fill(name);
  await fieldIn(p.locator("#board-network"), "Wi-Fi name").fill("LayoutWiFi");
  await fieldIn(p.locator("#board-network"), "Wi-Fi password").fill("example-password");
  for (const [view, title] of [["blocks", "Sensors"], ["points", "Turnouts"]]) {
    await nav(p, view);
    await p.locator(`[data-panel="${view}"]`).getByRole("button", { name: "Clear this page" }).click();
    await p.getByRole("button", { name: `Yes, clear the ${title} page` }).click();
  }
  assert.deepEqual(await p.evaluate(() => [state.blocks.length, state.points.length, state.signals.masts.length]), [0, 0, 0], "the foundation pages are empty");
  // The Cleared messages would sit over the pictures for a few seconds.
  await p.evaluate(() => el.toasts.replaceChildren());
}

// Step 1: Choose MSS Logic.
async function chooseMss(p) {
  await nav(p, "logic");
  await fieldIn(p.locator("#logic-mode"), "Logic").selectOption({ label: "MSS Logic" });
}

const openSteps = (p) => p.locator(".logic-field-steps button:not([disabled])").evaluateAll((all) => all.map((b) => b.id.replace("logic-step-", "")));
const current = (p) => p.evaluate(() => document.querySelector(".logic-field-steps [aria-current=step]")?.id.replace("logic-step-", ""));
const problems = (p) => p.evaluate(() => EsphomeMrMssBuilder.problems(state).map((x) => x.text));
const pageCard = (p) => p.locator(".mss-page");

// A picture of the page from the steps line down to the end of `last`.
async function shotFromSteps(p, last, name) {
  await p.locator(".logic-field-steps").scrollIntoViewIfNeeded();
  const a = await p.locator(".logic-field-steps").evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width }; });
  const b = await p.locator(last).evaluate((el) => { const r = el.getBoundingClientRect(); return { y: r.bottom + scrollY }; });
  const file = path.join(outDir, `${name}.png`);
  await p.screenshot({ path: file, fullPage: true, animations: "disabled", clip: { x: a.x, y: a.y, width: a.w, height: b.y - a.y } });
  console.log(`saved ${path.relative(repoDir, file)}`);
}

// ===== West: one Cascade ====================================================

await unstickTopBar(page);
await startBoard(page, "kiama-west");
await chooseMss(page);
assert.deepEqual(await openSteps(page), ["pick"], "only Pick your module is open");
assert.deepEqual(await page.locator(".mss-presets.is-boards .mss-preset strong").allInnerTexts(), ["Crossover", "Cascade", "Complex cascade"]);
assert.deepEqual(await page.locator(".mss-presets.is-samples .mss-preset strong").allInnerTexts(), ["Passing siding", "Two cascades"]);
assert.match(await page.locator(".mss-drop.is-empty").innerText(), /Drag an MSS board or a sample here/);
assert.match(await page.locator("#logic-mss").innerText(), /Shared with the boards beside it: always/);
await blur(page);
await shotFromSteps(page, ".mss-palette", "01-pick-empty");

// Step 2: drag the Cascade onto the empty module.
await page.dragAndDrop("#logic-mss-preset-cascade", ".mss-drop.is-empty");
assert.deepEqual(await page.locator(".mss-board-card strong").allInnerTexts(), ["1. Cascade"]);
const westAdds = await page.locator(".mss-adds").innerText();
assert.match(westAdds, /Make the module adds these to the board:/);
assert.match(westAdds, /Sensors: Block 1 current, Block 2 current, IR 1\./);
assert.match(westAdds, /Signals: Signal 1 to A, Signal 1 to B, each head a red, a yellow and a green LED on its own pin/);
assert.equal(await page.locator("#logic-mss-strip").isChecked(), false, "West's LEDs fit");
assert.equal(await page.evaluate(() => state.blocks.length), 0, "nothing is added until Make the module");
await blur(page);
await shot(page.locator(".mss-canvas"), "02-west-cascade");
assert.equal(await page.locator("#logic-mss-next").innerText(), "Make the module");
await page.click("#logic-mss-next");
assert.equal(await current(page), "wire");
assert.deepEqual(await openSteps(page), ["pick", "wire", "signals", "try", "download", "pair"]);
assert.deepEqual(await problems(page), []);

// Step 3 to 5 on West: every part already has a free pin, so each step is done.
for (const step of ["wire", "signals"]) assert.equal(await page.locator(`#logic-step-${step} .step-number`).innerText(), "✓", step);
await page.click("#logic-mss-next");
assert.equal(await current(page), "signals");
await page.click("#logic-mss-next");
assert.equal(await current(page), "try");
const westYaml = await page.evaluate(() => EsphomeMr.generateYaml(state));
assert.match(westYaml, /mr_logic:/);

// ===== East: a passing siding from two Complex cascades =====================

const east = await freshPage();
await startBoard(east, "kiama-east");
await chooseMss(east);
// One Complex cascade splits the line in two ...
await east.dragAndDrop("#logic-mss-preset-complex", ".mss-drop.is-empty");
assert.deepEqual(await east.locator(".mss-board-card strong").allInnerTexts(), ["1. Complex cascade"]);
// ... and a second, dropped in the gap between the two lines to its right, joins them.
await drag(east, "#logic-mss-preset-complex", '.mss-drop[data-at="1"][data-join="0"]');
assert.deepEqual(await east.locator(".mss-board-card strong").allInnerTexts(), ["1. Complex cascade", "2. Complex cascade, flipped"]);
assert.deepEqual(await east.evaluate(() => EsphomeMrMssRow.describe(state.logic.mss.row)), await east.evaluate(() => EsphomeMrMssRow.describe(EsphomeMrMssRow.preset("passing"))), "the same as the Passing siding sample");
assert.equal(await east.locator("#logic-mss-strip").isChecked(), true, "six signals: WS2812B, one data pin each");
await blur(east);
await shot(east.locator("#logic-mss-lane"), "03-east-module");
await east.click("#logic-mss-next");
assert.equal(await current(east), "wire");
assert.deepEqual(await problems(east), []);

// Step 3: Wire it. The first part, lit and numbered on the picture.
const picture = east.locator("#logic-mss-picture");
assert.match(await east.locator("#logic-mss-wire").innerText(), /1 of 12\s+Block 1 current \(block detector\)\s+A current detector: its output to this pin, its GND to the board's GND\./);
assert.equal(await picture.locator(".mss-row-badge").count(), 12);
await blur(east);
await shotFromSteps(east, "#logic-mss-wire", "04-wire-it");
// IR 2 on Block 1's pin: both red, with the message; then a free pin again.
await picture.locator('[data-part="IR 2"] text').first().click();
const irPin = await east.inputValue("#logic-mss-wire-pin");
const block1 = await east.evaluate(() => state.blocks.find((b) => b.name === "Block 1 current").gpio);
await east.selectOption("#logic-mss-wire-pin", block1);
assert.match(await east.locator("#logic-mss-wire").innerText(), /is used by something else too\. A pin can do one job\./);
assert.equal(await picture.locator(".mss-row-badge.is-error").count(), 2);
await blur(east);
await shotFromSteps(east, "#logic-mss-wire", "05-wire-shared");
await east.selectOption("#logic-mss-wire-pin", irPin);
assert.equal(await picture.locator(".mss-row-badge.is-error").count(), 0);
// End A's Pair button, from the list under the panel: the one safe pin left.
const freePin = () => east.evaluate(() => {
  const used = new Set([...state.blocks.map((b) => b.gpio), ...state.signals.masts.map((m) => m.pin), ...(state.logic.mss.ends || []).flatMap((e) => [e.pairPin, e.ledPin])]);
  return [...document.querySelectorAll("#logic-mss-wire-pin option")].map((o) => o.value).find((v) => v && !used.has(v) && !/GPIO(0|2|5|12|15)$/.test(v));
});
await east.locator('.mss-wire-list [data-wire="end:A:pair"]').click();
assert.match(await east.locator("#logic-mss-wire").innerText(), /End A Pair button \(Pair button\)/);
await east.selectOption("#logic-mss-wire-pin", await freePin());
await east.click("#logic-mss-wire-next");
assert.match(await east.locator("#logic-mss-wire").innerText(), /End A LED \(end LED\)/);
assert.equal(await freePin(), undefined, "no safe pin left for its LED");
assert.deepEqual(await problems(east), []);
assert.equal(await east.locator("#logic-step-wire .step-number").innerText(), "✓");
assert.equal(await east.locator("#logic-mss-next").innerText(), "Next: signals");
await east.click("#logic-mss-next");

// Step 4: Signals. Point at Diverging Clear: the picture lights it.
assert.equal(await current(east), "signals");
assert.match(await east.locator("#logic-mss-signal").innerText(), /1 of 6\s+Signal 1 to B \(two heads: upper the main line, lower the siding\)/);
const chips = await east.locator("#logic-mss-signal .mss-indication").evaluateAll((all) => all.map((c) => c.textContent.trim()));
assert.deepEqual(chips, ["Stop", "Approach", "Clear", "Diverging Clear", "Diverging Approach"]);
await east.hover('#logic-mss-signal [data-indication="divergingClear"]');
await shotFromSteps(east, "#logic-mss-signal", "06-signals");
await east.mouse.move(0, 0);
await east.click("#logic-mss-next");

// Step 5: Try it. Both pretend neighbours, both points thrown, a train from End A.
assert.equal(await current(east), "try");
await east.clock.pauseAt(await east.evaluate(() => Date.now() + 100));
const wait = (ms) => east.clock.runFor(ms);
const live = east.locator("#logic-mss-try-picture");
await east.check("#logic-mss-try-neighbour-A");
await east.check("#logic-mss-try-neighbour-B");
await live.locator('[data-part="Points 1"] circle').click();
await live.locator('[data-part="Points 2"] circle').click();
await wait(1000);
await live.locator('[data-part="Signal 1 to B"] .mss-row-label').click();
assert.match(await east.locator(".mss-try-panel").innerText(), /Signal 1 to B\s+Shows Diverging Approach/);
assert.match(await east.locator("#logic-mss-try .mss-try-main").innerText(), /Its way through: Block 1 current, Siding 1 current, Block 3 current\. It leaves at End B\./);
await east.selectOption("#logic-mss-try-from", "A:1");
await east.click("#logic-mss-try-run");
await wait(3000);
assert.deepEqual(await live.locator(".mss-row-block.is-train").evaluateAll((all) => all.map((g) => g.dataset.part)), ["Siding 1 current"]);
assert.match(await east.locator(".mss-try-panel").innerText(), /Signal 1 to B\s+Shows Stop/);
await blur(east);
await shot(east.locator("#logic-mss-try"), "07-try-it");
await wait(12000);
assert.match(await east.locator(".mss-try-panel").innerText(), /Signal 1 to B\s+Shows Diverging Approach/, "clear again once the train has gone");
assert.equal(await east.locator("#logic-mss-next").innerText(), "Next: download");
await east.click("#logic-mss-next");
assert.match(await pageCard(east).innerText(), /Download the board's file, the JMRI file and the module card from the Download page\./);

// Step 6: Download, and the module card it offers.
await nav(east, "yaml");
assert.match(await east.locator("#logic-download").innerText(), /Download module card/);
await shot(east.locator("#logic-download"), "08-download");
const [download] = await Promise.all([
  east.waitForEvent("download"),
  east.locator("#logic-download").getByRole("button", { name: "Download module card" }).click(),
]);
assert.match(download.suggestedFilename(), /^kiama-east-[a-z2-9]{6}-module-card\.html$/);
const cardFile = path.join(outDir, "module-card.tmp.html");
await download.saveAs(cardFile);
const cardHtml = fs.readFileSync(cardFile, "utf8");
assert.match(cardHtml, /<li>MSS board 1, Complex cascade<\/li><li>MSS board 2, Complex cascade \(flipped\)<\/li>/);
const cardPage = await east.context().newPage();
await cardPage.setViewportSize({ width: 800, height: 900 });
await cardPage.goto(`file://${cardFile}`);
await shot(cardPage.locator("body"), "09-module-card");
await cardPage.close();
fs.rmSync(cardFile);

// Step 8: Pair, on the Logic page.
await nav(east, "logic");
await east.click("#logic-step-pair");
assert.match(await east.locator(".mss-pair").innerText(), /Press Pair on this module's end and on the end of the module beside it, within 30 seconds of each other\./);

await east.context().close();
await done();
if (errors.length) {
  console.error(`The second board's page logged errors:\n${errors.join("\n")}`);
  process.exit(1);
}
