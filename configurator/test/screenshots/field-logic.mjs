// Screenshots for docs/field-logic-guide.md. Follows the guide's steps in
// order on a new board, the way a reader would, and saves each picture to
// docs/img/field-logic/<nn>-<name>.png. Along the way it checks that the page
// says what the guide says it says, and stops if not. See shoot.mjs for how
// to run it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openConfigurator, configuratorDir, repoDir } from "./shoot.mjs";

const { browser, page, shot, done } = await openConfigurator("field-logic", { width: 1280, height: 1000 });
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

const flat = (text) => text.replace(/\s+/g, " ").trim();

// Stop with a message when the page does not say what the guide says.
async function expectText(locator, wanted, where) {
  const text = flat(await locator.innerText());
  for (const part of [wanted].flat()) {
    // Card titles are drawn in capitals, so case is not compared.
    if (!text.toLowerCase().includes(part.toLowerCase())) throw new Error(`${where}: the guide expects "${part}", but the page says:\n${text}`);
  }
}

async function expectNoMessages(where) {
  const text = (await page.locator("#messages").innerText()).trim();
  if (text) throw new Error(`${where}: the guide expects no messages at the top of the page, but it says:\n${text}`);
}

// The little green notes the page shows after making something fade by
// themselves; they are cleared before a picture so they do not cover it.
async function clearNotes() {
  await page.evaluate(() => document.querySelectorAll("#toasts > *").forEach((n) => n.remove()));
}

// The window is made as tall as the page before each picture, so a tall card
// is not cut by the bar along the top.
async function tallWindow(take) {
  const size = page.viewportSize();
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: size.width, height: Math.max(size.height, height) });
  await clearNotes();
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

// The drawing: grid points are 48 units apart in the picture's viewBox.
const grid = (id = "logic-plan-grid") => page.locator(`#${id}`);
async function at(x, y, id) {
  await grid(id).scrollIntoViewIfNeeded();
  const box = await grid(id).boundingBox();
  const [vx, vy, vw, vh] = (await grid(id).getAttribute("viewBox")).split(" ").map(Number);
  return [box.x + ((x * 48 - vx) / vw) * box.width, box.y + ((y * 48 - vy) / vh) * box.height];
}
async function drag(a, b) {
  await page.mouse.move(...await at(...a));
  await page.mouse.down();
  await page.mouse.move(...await at(...b), { steps: 6 });
  await page.mouse.up();
}
const click = async (x, y, id) => page.mouse.click(...await at(x, y, id));
const panel = page.locator(".plan-panel");
const trackCard = page.locator("#logic-plan");
const stepPills = page.locator(".logic-field-steps");
const next = () => page.click("#logic-plan-next");

// ===== Step 1: the board's name =============================================

const boardView = page.locator('section[data-panel="board"]');
await type(field(boardView, "Board name"), "gauntlet");
// Made-up Wi-Fi, so the page has nothing to warn about. Never a real password.
await type(field(boardView, "Wi-Fi name"), "LayoutWiFi");
await type(field(boardView, "Wi-Fi password"), "example-only");
await blur();
const identity = page.locator("#board-identity");
await expectText(identity, ["-k7m4x2", "New suffix"], "Step 1");
await shotSpan(identity.locator("label").first(), identity.locator(".suffix-action"), "01-board-name");

// A new board comes with an example sensor and turnout. The gauntlet uses neither.
for (const [view, words] of [["blocks", "Sensors"], ["points", "Turnouts"]]) {
  await nav(view);
  const section = page.locator(`section[data-panel="${view}"]`);
  await section.getByRole("button", { name: "Clear this page" }).click();
  await section.getByRole("button", { name: `Yes, clear the ${words} page` }).click();
}
if (await page.evaluate(() => state.blocks.length + state.points.length)) throw new Error("Step 1: Clear this page should leave no sensors or turnouts.");

// ===== Step 2: Field Logic ==================================================

await nav("logic");
await field(page.locator("#logic-mode"), "Logic").selectOption({ label: "Field Logic" });
await blur();
await expectText(page.locator("#logic-field"), ["Logic: Field Logic", "Share with other boards: on", "Linked boards: none"], "Step 2");
await expectText(stepPills, ["1 Draw", "2 Sensors", "6 Download"], "Step 2");
await shotSpan(page.locator("#logic-field"), trackCard, "02-field-logic");
await page.getByRole("button", { name: "Settings and linked boards" }).click();
if (!(await page.locator("#logic-share").isChecked())) throw new Error("Step 2: Share with other boards should be ticked by default.");
await shotSpan(page.locator("#logic-field"), page.locator("#logic-linked"), "03-settings");
await page.getByRole("button", { name: "Hide the settings" }).click();

// ===== Step 3: draw the track ===============================================

// Two tracks come in from the left, join at 4,1, cross the bridge to 8,1 and
// part again. Drawn one straight line at a time.
for (const [a, b] of [[[0, 0], [3, 0]], [[3, 0], [4, 1]], [[4, 1], [8, 1]], [[8, 1], [9, 0]], [[9, 0], [12, 0]],
  [[0, 2], [3, 2]], [[3, 2], [4, 1]], [[8, 1], [9, 2]], [[9, 2], [12, 2]]]) await drag(a, b);
await expectText(stepPills, "2 problems", "Step 3, drawn");
await page.click("#logic-plan-tool-select");
await click(4, 1);
await expectText(panel, ["Where three lines meet", "No turnout: two tracks that join, as on a gauntlet"], "Step 3, a join");
await snap(trackCard, "04-join");
for (const x of [4, 8]) {
  await click(x, 1);
  await page.selectOption("#logic-plan-turnout", "");
}
// Each outer track carries trains one way only.
for (const [x, y, way] of [[0.5, 0, "right"], [0.5, 2, "left"], [11.5, 0, "right"], [11.5, 2, "left"]]) {
  await click(x, y);
  await page.selectOption("#logic-plan-direction", { label: `Only ${way}` });
}
await expectText(panel, ["Trains run", "Only left"], "Step 3, one way");
await snap(trackCard, "05-drawn");

// ===== Step 4: blocks and sensors ===========================================

await next();
await expectText(page.locator(".step-pill.is-current"), "Sensors", "Step 4");
for (const [x, y] of [[2, 0], [10, 2]]) {
  await click(x, y);
  await page.click("#logic-plan-add-break");
}
for (const [x, y, name] of [[0.5, 0, "Left"], [6.5, 1, "Bridge"], [11.5, 2, "Right"]]) {
  await click(x, y);
  await page.fill("#logic-plan-block-name", name);
  await page.locator("#logic-plan-block-name").press("Tab");
  await expectText(page.locator("#logic-plan-new-sensor-name").locator(".."), "", "Step 4");
  if (await page.inputValue("#logic-plan-new-sensor-name") !== `${name} current`) throw new Error(`Step 4: the new sensor should be called "${name} current".`);
  await page.click("#logic-plan-new-sensor-make");
}
await click(6.5, 1);
await expectText(panel, ["Block Bridge", "Sensors in this block", "Bridge current"], "Step 4");
await snap(trackCard, "06-blocks");
await nav("blocks");
await expectText(page.locator("#blocks-list"), ["Left current", "Bridge current", "Right current"], "Step 4, the Sensors page");
await nav("logic");

// ===== Step 5: signals ======================================================

await next();
async function makeSignal(x, y, way, name, kind) {
  await click(x, y);
  const maker = panel.locator(".plan-maker", { hasText: `heading ${way}` });
  await maker.locator("input").fill(name);
  if (kind) await maker.locator("select").selectOption({ label: kind });
  await maker.getByRole("button", { name: "Make the signal" }).click();
}
await makeSignal(2, 0, "right", "Left Bridge");
await makeSignal(10, 2, "left", "Right Bridge");
for (const [x, y] of [[12, 0], [0, 2]]) {
  await click(x, y);
  await page.selectOption("#logic-plan-beyond", "plain");
}
await expectNoMessages("Step 5");
await click(2, 0);
await expectText(panel, ["Signal for trains heading right", "Left Bridge", "Button for Left Bridge", "Aspects for each meaning"], "Step 5");
await snap(trackCard, "07-signals");
await nav("signals");
await expectText(page.locator("#signals-list"), ["Left Bridge", "Right Bridge"], "Step 5, the Signal Masts page");
await nav("logic");

// ===== Step 6: what protects the bridge =====================================

await next();
await click(6.5, 1);
await expectText(panel, `Signals "Left Bridge" and "Right Bridge" each have a route onto this block`, "Step 6, Bridge");
await snap(trackCard, "08-bridge");
await click(2, 0);
await expectText(panel, `"Left Bridge" is a controlled signal`, "Step 6, Left Bridge");

// ===== Step 7: a button and a rule ==========================================

await page.click("#logic-plan-example-hold-0");
await expectText(panel, "Keep at Stop unless: Left Bridge go was pressed in the last 30 seconds.", "Step 7");
await expectText(page.locator("#messages"), `Button "Left Bridge go" has no pin.`, "Step 7, before its pin");
// The button is drawn below the signal: pick it, and pick its pin.
const buttonAt = await page.evaluate(() => state.logic.plan.pieces[0].at);
await click(...buttonAt);
await expectText(panel, "Button: Left Bridge go", "Step 7, the button");
// The first free pin that is not a strapping pin.
const pin = await page.locator("#logic-plan-piece-pin option").evaluateAll((options) => options.find((o) => o.value && !/strapping/.test(o.textContent)).value);
await page.selectOption("#logic-plan-piece-pin", pin);
await expectNoMessages("Step 7, with its pin");
await snap(trackCard, "09-button");
await click(2, 0);
await snap(trackCard, "10-rule");

// ===== Step 8: Try it =======================================================

await next();
const tryCard = page.locator("#logic-plan-try");
const tryPanel = tryCard.locator(".plan-panel");
const tryClick = (x, y) => click(x, y, "logic-try-grid");
const tryButton = (name) => tryCard.getByRole("button", { name, exact: true });
const live = (cls) => tryCard.locator(`#logic-try-grid .plan-live.is-${cls}`).count();
await expectText(tryCard, "The board is in Auto", "Step 8");
// A train in Left asks for Left Bridge's route: set, but held at Stop by the rule.
await tryClick(0.5, 0);
await tryButton("Skip ahead 1 second").click();
if (!(await live("route"))) throw new Error("Step 8: Left Bridge's route should be set, in green.");
await tryClick(2, 0);
await expectText(tryPanel, ["Signal Left Bridge", "Shows Stop."], "Step 8, held by the rule");
await snap(tryCard, "11-try-route");
// Press the button: Left Bridge clears.
await tryClick(...buttonAt);
await tryButton("Step").click();
await tryClick(2, 0);
await expectText(tryPanel, "Shows Clear.", "Step 8, the button pressed");
// A train waiting in Right is held: the bridge is Left Bridge's.
await tryClick(11.5, 2);
await tryButton("Skip ahead 1 second").click();
await tryClick(10, 2);
await expectText(tryPanel, "Shows Stop.", "Step 8, Right waits");
await snap(tryCard, "12-try-clear");
// The train crosses: into Bridge, out of Left, out of Bridge.
await tryClick(6.5, 1);
await tryButton("Skip ahead 1 second").click();
await tryClick(0.5, 0);
await tryButton("Skip ahead 1 second").click();
await tryClick(6.5, 1);
await tryButton("Skip ahead 10 seconds").click();
await tryButton("Skip ahead 10 seconds").click();
await tryClick(10, 2);
await expectText(tryPanel, "Shows Clear.", "Step 8, Right's turn");
await tryButton("Start again").click();

// ===== Problems =============================================================

// One mistake on purpose: the button's pin taken off again. Put right after.
await nav("logic");
await page.click("#logic-step-behaviour");
await click(...buttonAt);
await page.selectOption("#logic-plan-piece-pin", "");
await expectText(page.locator("#messages"), `Button "Left Bridge go" has no pin.`, "Problems");
await snap(page.locator("#messages"), "13-problems");
await page.selectOption("#logic-plan-piece-pin", pin);
await expectNoMessages("Problems, put right");

// ===== Download =============================================================

await nav("yaml");
await expectText(page.locator("#logic-download"), ["Logic version", "Download summary"], "Download");
await snap(page.locator("#logic-download"), "14-logic-version");
const [summaryFile] = await Promise.all([
  page.waitForEvent("download"),
  page.locator("#logic-download").getByRole("button", { name: "Download summary" }).click(),
]);
if (summaryFile.suggestedFilename() !== "gauntlet-k7m4x2-summary.html") throw new Error(`Download summary: saved as ${summaryFile.suggestedFilename()}`);

// ===== More sensor pins: an expander ========================================

await nav("blocks");
await page.getByRole("button", { name: "Add expander" }).click();
const mcp = page.locator("#expanders-list > .card").first();
await mcp.getByRole("button", { name: "Add sensor" }).click();
await type(field(mcp.locator(".board-points > *").first(), "Name"), "Bridge east");
await blur();
await expectText(field(mcp, "Pin").locator("option:checked"), "MCP 1 · A0", "An expander");
await snap(mcp, "19-expander");

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
  await field(south.locator("#blocks-list > *").last(), "Name").fill("South end");
  await south.click('.nav-item[data-view="logic"]');
  await south.locator("#logic-share").check();
  const [download] = await Promise.all([south.waitForEvent("download"), south.click("#btn-download")]);
  await download.saveAs(southFile);
  await context.close();
}
await nav("logic");
await page.getByRole("button", { name: "Settings and linked boards" }).click();
const [chooser] = await Promise.all([
  page.waitForEvent("filechooser"),
  page.locator("#logic-linked").getByRole("button", { name: "Link a board's file" }).click(),
]);
await chooser.setFiles(southFile);
await page.locator("#logic-linked", { hasText: "kiama-south-p3q8w5" }).waitFor({ timeout: 5000 }).catch(() => {});
await expectText(page.locator("#logic-linked"), ["kiama-south-p3q8w5", "From its file"], "Linked boards");
await snap(page.locator("#logic-linked"), "20-linked-board");
await page.getByRole("button", { name: "Hide the settings" }).click();
await page.click("#logic-step-sensors");
await click(0.5, 0);
await expectText(panel, ["This board", "kiama-south-p3q8w5", "South end"], "Linked boards, a block's sensors");
await panel.getByLabel("South end").check();
await expectNoMessages("Linked boards, a sensor ticked");
await snap(trackCard, "21-linked-sensor");

// ===== A crossing loop ======================================================

// The same board, cleared: each page's Clear this page (Logic keeps Field Logic).
async function clearAll() {
  for (const [view, words] of [["blocks", "Sensors"], ["points", "Turnouts"], ["signals", "Signal Masts"], ["logic", "Logic"]]) {
    await nav(view);
    const section = page.locator(`section[data-panel="${view}"]`);
    await section.getByRole("button", { name: "Clear this page" }).click();
    await section.getByRole("button", { name: `Yes, clear the ${words} page` }).click();
  }
  await nav("logic");
}
async function drawLines(lines) {
  await page.click("#logic-plan-tool-draw");
  for (const [a, b] of lines) await drag(a, b);
  await page.click("#logic-plan-tool-select");
}
async function makeTurnout(x, y, name) {
  await click(x, y);
  await page.fill("#logic-plan-new-turnout-name", name);
  await page.click("#logic-plan-new-turnout-make");
}
async function makeBlocks(breaks, blocks) {
  for (const [x, y] of breaks) {
    await click(x, y);
    await page.click("#logic-plan-add-break");
  }
  for (const [x, y, name] of blocks) {
    await click(x, y);
    await page.fill("#logic-plan-block-name", name);
    await page.locator("#logic-plan-block-name").press("Tab");
    await page.click("#logic-plan-new-sensor-make");
  }
}
async function plainEnds(ends) {
  for (const [x, y] of ends) {
    await click(x, y);
    await page.selectOption("#logic-plan-beyond", "plain");
  }
}

// Six signals at three LEDs each would need more pins than the board has:
// each is one WS2812B LED here, one pin a mast.
const STRIP = "One head: one WS2812B LED";
await clearAll();
await drawLines([[[0, 1], [16, 1]], [[3, 1], [4, 0]], [[4, 0], [12, 0]], [[12, 0], [13, 1]]]);
await makeTurnout(3, 1, "West turnout");
await expectText(panel, ["Turnout", "West turnout", "Straight line goes", "The line that carries straight on", "Turnout is straight when", "Lock it while a train is on it"], "A crossing loop, a turnout");
await snap(trackCard, "15-loop-turnout");
await makeTurnout(13, 1, "East turnout");
await next();
await makeBlocks([[1, 1], [5, 1], [5, 0], [11, 1], [11, 0], [15, 1]],
  [[0.5, 1, "West"], [2.5, 1, "West points"], [8.5, 1, "Main"], [8.5, 0, "Loop"], [13.5, 1, "East points"], [15.5, 1, "East"]]);
await next();
for (const [x, y, way, name] of [[1, 1, "right", "West Home"], [5, 1, "left", "Main West"], [5, 0, "left", "Loop West"],
  [11, 1, "right", "Main East"], [11, 0, "right", "Loop East"], [15, 1, "left", "East Home"]]) await makeSignal(x, y, way, name, STRIP);
await plainEnds([[0, 1], [16, 1]]);
await expectNoMessages("A crossing loop");
await next();
await click(3, 1);
await expectText(panel, ["Rules on West turnout", "Example: hand this turnout to a local panel"], "A crossing loop, Behaviour");
await next();
// A meet: East turnout thrown, a train at each end.
await tryClick(13, 1);
await tryClick(0.5, 1);
await tryClick(15.5, 1);
await tryButton("Skip ahead 1 second").click();
await tryClick(1, 1);
await expectText(tryPanel, "Shows Approach.", "A crossing loop, West Home");
await tryClick(15, 1);
// A one-head mast has no diverging aspect of its own: it shows Approach.
await expectText(tryPanel, ["Shows Approach.", `"East Home moves" took section "Loop"`], "A crossing loop, East Home");
await snap(tryCard.locator("#logic-try-grid").locator(".."), "16-loop-meet");

// ===== An industry siding with a local panel =================================

await clearAll();
await drawLines([[[0, 1], [12, 1]], [[4, 1], [5, 0]], [[5, 0], [9, 0]]]);
await makeTurnout(4, 1, "Siding turnout");
await next();
await makeBlocks([[2, 1], [6, 0], [10, 1]], [[0.5, 1, "West"], [7.5, 1, "Main"], [7.5, 0, "Siding"], [11.5, 1, "East"]]);
await next();
for (const [x, y, way, name] of [[2, 1, "right", "West Home"], [10, 1, "left", "East Home"]]) await makeSignal(x, y, way, name, STRIP);
await plainEnds([[0, 1], [12, 1]]);
await expectNoMessages("An industry siding");
await next();
await click(4, 1);
await page.click("#logic-plan-example-local");
// A pin for the switch and the lamp, each picked on the drawing.
const pieces = await page.evaluate(() => state.logic.plan.pieces.map((p) => ({ name: p.name, at: p.at })));
for (const piece of pieces) {
  await click(...piece.at);
  const free = await page.locator("#logic-plan-piece-pin option").evaluateAll((options) => options.find((o) => o.value && !/strapping/.test(o.textContent)).value);
  await page.selectOption("#logic-plan-piece-pin", free);
}
await expectNoMessages("An industry siding, the local panel");
await click(4, 1);
await expectText(panel, "Only its own buttons move it while: Siding turnout local is on and West Home has shown Stop for 30 seconds and East Home has shown Stop for 30 seconds.", "An industry siding, the turnout's rule");
await click(...pieces[1].at);
await expectText(panel, ["Light while: Siding turnout local is on", "Flash while: Siding turnout local is off and Siding turnout is thrown."], "An industry siding, the lamp's rules");
await click(2, 1);
await expectText(panel, "Siding turnout local is on", "An industry siding, West Home's rule");
await click(4, 1);
await snap(trackCard, "17-local-panel");

// Try it: the switch on, the signals go to Stop, and 30 seconds later the turnout is the panel's.
await next();
await tryClick(...pieces[0].at);
await tryButton("Skip ahead 1 second").click();
await tryClick(2, 1);
await expectText(tryPanel, "Shows Stop.", "An industry siding, Try it");
for (let i = 0; i < 3; i += 1) await tryButton("Skip ahead 10 seconds").click();
await snap(tryCard.locator("#logic-try-grid").locator(".."), "18-local-try");

await done();
