// Screenshots for docs/field-logic-guide.md. Follows the guide's steps in
// order on a new board, the way a reader would, and saves each picture to
// docs/img/field-logic/<nn>-<name>.png. Along the way it checks that the page
// says what the guide says it says, and stops if not. See shoot.mjs for how
// to run it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openConfigurator, configuratorDir, repoDir } from "./shoot.mjs";

const { browser, page, shot, done } = await openConfigurator("field-logic");
const outDir = path.join(repoDir, "docs", "img", "field-logic");
const pageUrl = `file://${path.join(configuratorDir, "index.html")}`;

// The board name's six-character suffix is random. Pin it to the one the guide
// uses, so the pictures match the text and come out the same each run. Only
// the browser's random numbers are fixed: nothing is put into the page's
// saved board.
async function fixSuffix(target, suffix) {
  await target.context().addInitScript((wanted) => {
    const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
    let seed = 7;
    crypto.getRandomValues = (bytes) => {
      if (bytes.length === wanted.length) {
        [...wanted].forEach((ch, i) => { bytes[i] = alphabet.indexOf(ch); });
        return bytes;
      }
      for (let i = 0; i < bytes.length; i += 1) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        bytes[i] = (seed >> 16) & 255;
      }
      return bytes;
    };
  }, suffix);
}

// Start again from an empty browser, as a first visit, with the suffix fixed.
await fixSuffix(page, "k7m4x2");
await page.evaluate(() => localStorage.clear());
await page.reload();

// ===== Helpers ===============================================================

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exactly = (text) => new RegExp(`^${escape(text)}$`);

// A form field by its label, in `scope`.
function field(scope, label) {
  return scope.locator("label").filter({
    has: scope.page().locator(":scope > .field-label, :scope > .check-copy > .field-label", { hasText: exactly(label) }),
  }).locator("input, select, textarea").first();
}

async function type(input, value) {
  await input.fill(value);
  await input.dispatchEvent("change");
}

async function blur() {
  await page.evaluate(() => document.activeElement?.blur());
}

async function nav(view) {
  await page.click(`.nav-item[data-view="${view}"]`);
}

// Stop with a message when the page does not say what the guide says.
async function expectText(locator, wanted, where) {
  const text = (await locator.innerText()).replace(/\s+/g, " ").trim();
  for (const part of [wanted].flat()) {
    // Card titles are drawn in capitals, so case is not compared.
    if (!text.toLowerCase().includes(part.toLowerCase())) throw new Error(`${where}: the guide expects "${part}", but the page says:\n${text}`);
  }
}

async function expectNoMessages(where) {
  const text = (await page.locator("#messages").innerText()).trim();
  if (text) throw new Error(`${where}: the guide expects no messages at the top of the page, but it says:\n${text}`);
}

const logicPage = page.locator("#logic-page");
const card = (id) => page.locator(`#${id}`);
const steps = logicPage.locator(".logic-steps");

// A Next steps line's status: "Done", "Next" or "".
async function expectStep(name, status, where) {
  const got = (await steps.locator("li").filter({ hasText: name }).locator(".step-status").innerText()).trim();
  if (got !== status) throw new Error(`${where}: the guide expects Next steps to show "${name}" as "${status}", but it shows "${got}".`);
}

// The window is made as tall as the page before each picture, so a tall card
// is not cut by the bar along the top.
async function tallWindow(take) {
  const size = page.viewportSize();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: size.width, height: Math.max(size.height, height) });
  await take();
  await page.setViewportSize(size);
}

// A picture of one part of the page.
async function snap(target, name) {
  await tallWindow(() => shot(target, name));
}

// A picture from the top of `first` to the bottom of `last`, across the main column.
async function shotSpan(first, last, name, pad = 8) {
  await tallWindow(async () => {
    await page.evaluate(() => window.scrollTo(0, 0));
    const a = await first.boundingBox();
    const b = await last.boundingBox();
    const main = await page.locator("main").boundingBox();
    const y = Math.max(0, a.y - pad);
    const clip = { x: main.x + 16 - pad, y, width: main.width - 32 + 2 * pad, height: b.y + b.height + pad - y };
    const file = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: file, clip, animations: "disabled" });
    console.log(`saved ${path.relative(repoDir, file)}`);
  });
}

// ===== Step 1: the board's name =============================================

const boardView = page.locator('section[data-panel="board"]');
await type(field(boardView, "Board name"), "kiama-north");
// Made-up Wi-Fi, so the page has nothing to warn about. Never a real password.
await type(field(boardView, "Wi-Fi name"), "LayoutWiFi");
await type(field(boardView, "Wi-Fi password"), "example-only");
await blur();
const identity = page.locator("#board-identity");
await expectText(identity, ["-k7m4x2", "New suffix"], "Step 1");
await shotSpan(identity.locator("label").first(), identity.locator(".suffix-action"), "01-board-name");

// ===== Step 2: the sensors ==================================================

await nav("blocks");
// A sensor card on the Sensors page, by its name.
const sensorCard = (name) => page.locator("#blocks-list > *").filter({ has: page.locator("h3", { hasText: exactly(name) }) });
async function addSensor(name) {
  await page.click("#btn-add-block");
  await type(field(page.locator("#blocks-list > *").last(), "Name"), name);
}
for (const name of ["Int 2 current", "Int 2 East", "Int 2 West"]) await addSensor(name);
await blur();
await expectNoMessages("Step 2");
await shotSpan(sensorCard("Int 2 current"), sensorCard("Int 2 West"), "02-sensors");

// ===== Step 3: an expander ==================================================

await page.getByRole("button", { name: "Add expander" }).click();
const mcp = page.locator("#expanders-list > .card").first();
await expectText(field(mcp, "I2C bus").locator("option:checked"), "Shares PCA9685 1", "Step 3");
await mcp.getByRole("button", { name: "Add sensor" }).click();
await type(field(mcp.locator(".board-points > *").first(), "Name"), "Int 3 current");
await blur();
await expectText(field(mcp, "Pin").locator("option:checked"), "MCP 1 · A0", "Step 3");
await snap(mcp, "03-expander");

// ===== Step 4: Field Logic, and share =======================================

await nav("logic");
await field(card("logic-mode"), "Logic").selectOption({ label: "Field Logic" });
await blur();
if (!(await page.locator("#logic-share").isChecked())) throw new Error("Step 4: Share with other boards should be ticked by default.");
await shotSpan(steps, card("logic-settings"), "04-field-logic");

// ===== Step 5: the block ====================================================

// A block card on the Logic page, by its name.
const blockCard = (name) => page.locator("#logic-blocks .logic-block").filter({ has: page.locator("h3", { hasText: exactly(name) }) });
async function addBlock(name, members) {
  await card("logic-blocks").getByRole("button", { name: "Add a block" }).click();
  await type(field(page.locator("#logic-blocks .logic-block").last(), "Name"), name);
  for (const member of members) {
    await blockCard(name).locator(".block-add-member").selectOption({ label: member });
  }
}
await addBlock("Int 2", ["Int 2 current", "Int 2 East", "Int 2 West"]);
await blur();
if (await field(blockCard("Int 2"), "MQTT topic").inputValue() !== "trains/track/sensor/Int 2") throw new Error("Step 5: the block's topic is not trains/track/sensor/Int 2.");
await expectNoMessages("Step 5");
// Add blocks and signals is done only once there are rules too.
await expectStep("Add blocks and signals", "Next", "Step 5");
await snap(blockCard("Int 2"), "05-block");

// ===== Step 7: the Download page's Logic tick box ==========================

await nav("yaml");
await expectText(page.locator('[data-jmri-hint="logic"]'), "This board's Online sensor, 1 block and the Logic on / off light.", "Step 7");

// ===== Reading another board's sensors ======================================

// The board next door, kiama-south, made the same way in a second browser
// window: a name, one sensor and Share ticked. Its downloaded board.yaml is
// the file this board links.
const southFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "field-logic-")), "kiama-south.yaml");
{
  const context = await browser.newContext({ viewport: page.viewportSize() });
  const south = await context.newPage();
  await fixSuffix(south, "p3q8w5");
  await south.goto(pageUrl);
  const board = south.locator('section[data-panel="board"]');
  await field(board, "Board name").fill("kiama-south");
  await field(board, "Wi-Fi name").fill("LayoutWiFi");
  await field(board, "Wi-Fi password").fill("example-only");
  await south.click('.nav-item[data-view="blocks"]');
  await south.click("#btn-add-block");
  await field(south.locator("#blocks-list > *").last(), "Name").fill("Int 1 East");
  await south.click('.nav-item[data-view="logic"]');
  await south.locator("#logic-share").check();
  const [download] = await Promise.all([south.waitForEvent("download"), south.click("#btn-download")]);
  await download.saveAs(southFile);
  await context.close();
}

await nav("logic");
const [chooser] = await Promise.all([
  page.waitForEvent("filechooser"),
  card("logic-linked").getByRole("button", { name: "Link a board's file" }).click(),
]);
await chooser.setFiles(southFile);
// Its sensors are listed under its name in the block's Add a sensor… list.
const fromSouth = blockCard("Int 2").locator('.block-add-member optgroup[label="kiama-south-p3q8w5"]');
await expectText(fromSouth, "Int 1 East", "Reading another board's sensors");
await blockCard("Int 2").locator(".block-add-member").selectOption({ label: "Int 1 East" });
await blur();
await expectNoMessages("Reading another board's sensors");
await snap(card("logic-linked"), "06-linked-board");
await snap(blockCard("Int 2").locator(".block-members-field"), "07-linked-sensor");

// ===== The gauntlet over a bridge ===========================================

// 1. Sensors page: one sensor for each block.
await nav("blocks");
for (const name of ["Left current", "Bridge current", "Right current"]) await addSensor(name);

// 2. Signal Masts page: two masts, each with a red lamp at the top and a green
// one below, and two aspects from the CATS list, renamed: Stop (R292, red,
// shown at startup) and Clear (R281, green).
await nav("signals");
const mastCard = (name) => page.locator("#signals-list > *").filter({ has: page.locator("h3", { hasText: exactly(name) }) });
async function addAspect(mast, cats, name, lamp, colour) {
  await mast.locator('select[aria-label="CATS aspect"]').selectOption(cats);
  await mast.getByRole("button", { name: "Add CATS aspect", exact: true }).click();
  const aspect = mast.locator(".aspect-card").last();
  await type(aspect.locator('input[aria-label="Aspect name"]'), name);
  await aspect.locator(`.mini-lamp[aria-label^="${lamp}:"]`).click();
  await aspect.getByRole("button", { name: colour, exact: true }).click();
}
for (const name of ["Left Bridge", "Right Bridge"]) {
  await page.click("#btn-add-mast");
  await type(field(page.locator("#signals-list > *").last(), "Name"), name);
  const mast = mastCard(name);
  await mast.getByRole("button", { name: "Add lamp", exact: true }).click();
  await mast.getByRole("button", { name: "Add lamp at the top" }).click();
  await addAspect(mast, "R292", "Stop", "Lamp 2", "Red");
  await addAspect(mast, "R281", "Clear", "Lamp 1", "Green");
  await mast.locator(".aspect-card").first().getByText("Show at startup").click();
}
await blur();
await snap(mastCard("Left Bridge"), "08-gauntlet-mast");

// 3. Logic page: the three blocks.
await nav("logic");
await addBlock("Left", ["Left current"]);
await addBlock("Bridge", ["Bridge current"]);
await addBlock("Right", ["Right current"]);
await blur();
await expectNoMessages("The gauntlet");

// ===== Start from a starter: One-train section ==============================

const starters = card("logic-starters");
await expectText(starters, "Start here", "Start from a starter");
await snap(starters, "09-start-here");
await starters.getByRole("button", { name: /One-train section/ }).click();
const form = page.locator("dialog.starter-dialog");
await type(form.locator("label.field").filter({ hasText: /^Name/ }).locator("input"), "Bridge");
await form.getByRole("button", { name: "Add a block" }).click();
await form.locator('select[aria-label="Blocks in the section"]').selectOption({ label: "Bridge" });
const entrance = (n) => form.locator(".starter-entrance").nth(n);
for (const [n, block, mast] of [[0, "Left", "Left Bridge"], [1, "Right", "Right Bridge"]]) {
  await entrance(n).locator('select[aria-label="A train waiting in"]').selectOption({ label: block });
  await entrance(n).locator('select[aria-label="Signal"]').selectOption({ label: mast });
  // shows is filled in for you, with the aspect that means Clear.
  await expectText(entrance(n).locator('select[aria-label="shows"] option:checked'), "Clear", "The questions");
}
await form.locator("summary", { hasText: "More options" }).click();
await snap(form, "10-one-train-form");
await form.getByRole("button", { name: "Add", exact: true }).click();
await expectNoMessages("The section it makes");
await expectStep("Add blocks and signals", "Done", "The section it makes");
await expectStep("Try it", "Next", "The section it makes");
await expectText(card("logic-sections"), "Free the section when Bridge has been clear for 3 seconds.", "The section it makes");
// The Bridge group, from the top of the card to the end of Rule 1.
await shotSpan(card("logic-groups"), card("logic-groups").locator(".logic-rule").first(), "11-bridge-group");

// ===== The signals ==========================================================

const leftMast = card("logic-masts").locator(".row-card").first();
await expectText(leftMast, ["Left Bridge", "Set by logic", "Automatic (Stop)"], "The signals");
await shotSpan(card("logic-masts"), leftMast, "12-masts");
await leftMast.getByRole("button", { name: "Explain" }).click();
await expectText(leftMast.locator(".mast-explain"), [
  "Left Bridge shows Clear when a train has been in Left for half a second and the Bridge section is free.",
  "Otherwise it shows Stop.",
], "Explain");
await snap(leftMast.locator(".mast-explain"), "13-explain");
await leftMast.getByRole("button", { name: "Hide" }).click();

// ===== Try it ===============================================================

const tryIt = card("logic-try");
const tryButton = (name) => tryIt.getByRole("button", { name, exact: true });
const trackBlock = (name) => tryIt.locator(`.try-track [aria-label^="${name}: "]`).first();
const skip = (seconds) => tryButton(`Skip ahead ${seconds} second${seconds === 1 ? "" : "s"}`).click();
async function expectTry(signals, section, where) {
  await expectText(tryIt.locator(".try-signals"), signals, where);
  await expectText(tryIt.locator(".try-sections"), section, where);
}
await expectTry(["Left Bridge Stop", "Right Bridge Stop"], "Bridge Free", "Try it, at the start");
await trackBlock("Left").click();
await skip(1);
await expectTry(["Left Bridge Clear", "Right Bridge Stop"], "Taken, waiting for the train", "Try it, a train in Left");
await shotSpan(tryIt.getByText("Track", { exact: true }), tryIt.locator(".try-sections"), "14-try-it");
await trackBlock("Bridge").click();
await skip(1);
await expectTry([], "A train is in it", "Try it, a train in Bridge");
await trackBlock("Left").click();
await skip(1);
await expectTry(["Left Bridge Stop"], "A train is in it", "Try it, Left empty again");
await trackBlock("Right").click();
await skip(1);
await expectTry(["Right Bridge Stop"], "A train is in it", "Try it, a train waiting in Right");
await trackBlock("Bridge").click();
await skip(10);
await expectTry(["Left Bridge Stop", "Right Bridge Clear"], "Taken, waiting for the train", "Try it, Bridge empty again");

// Run a train, from a fresh start, with the choices as they come.
await tryButton("Start again").click();
await tryIt.getByRole("button", { name: "Run a train" }).click();
await expectText(tryIt.locator(".try-train-table"), ["Train enters Left", "Train leaves Left"], "Run a train");
await shotSpan(tryIt.getByText("Run a train", { exact: true }).first(), tryIt.locator(".try-train-table"), "15-run-a-train");
await tryButton("Start again").click();

// ===== Problems =============================================================

// Two mistakes on purpose, to show the message box: a sensor deleted from the
// Sensors page while a block still uses it (an error), and a boundary sensor
// put in three blocks (a warning). Both are undone after the picture.
await nav("blocks");
await sensorCard("Int 2 West").getByRole("button", { name: "Remove" }).click();
await nav("logic");
await blockCard("Left").locator(".block-add-member").selectOption({ label: "Int 2 East" });
await blockCard("Right").locator(".block-add-member").selectOption({ label: "Int 2 East" });
await blur();
await expectText(page.locator("#messages"), [
  `Block "Int 2" uses sensor "Int 2 West", which is not on the Sensors page.`,
  `Sensor "Int 2 East" is in 3 blocks`,
], "Problems");
await snap(page.locator("#messages"), "16-problems");
for (const block of ["Left", "Right"]) {
  await blockCard(block).locator(".block-members li").filter({ hasText: "Int 2 East" }).getByRole("button", { name: "Remove" }).click();
}
await nav("blocks");
await addSensor("Int 2 West");
await nav("logic");
await expectNoMessages("Problems, put right");

// ===== Download and flash ===================================================

await nav("yaml");
await expectText(card("logic-download"), ["Logic version", "Download summary", "Warnings about the logic"], "The Logic version");
await snap(card("logic-download"), "17-logic-version");
const [summaryFile] = await Promise.all([
  page.waitForEvent("download"),
  card("logic-download").getByRole("button", { name: "Download summary" }).click(),
]);
if (summaryFile.suggestedFilename() !== "kiama-north-k7m4x2-summary.html") throw new Error(`Download summary: saved as ${summaryFile.suggestedFilename()}`);

// ===== Lock turnouts and Block signals: the forms under Add from starter ====

await nav("logic");
async function openStarter(name) {
  await expectText(starters, "Add from starter", "Add from starter");
  if (!(await starters.locator("details").evaluate((fold) => fold.open))) await starters.locator("summary").click();
  await starters.getByRole("button", { name: new RegExp(name) }).click();
  return page.locator("dialog.starter-dialog");
}
{
  const dialog = await openStarter("Lock turnouts under a train");
  await expectText(dialog, ["Group name", "Turnout", "Block it sits in", "Add a turnout"], "Lock turnouts under a train");
  await dialog.getByRole("button", { name: "Cancel" }).click();
}

await done();
