// Screenshots for docs/mss-logic-guide.md. Follows the guide's steps on the
// real configurator, as a newcomer would: West (plain track) on one board,
// then East (a turnout junction) on a fresh board in a new browser window,
// which starts with nothing saved. See shoot.mjs for how to run it.
//
// Pictures are numbered in the order the guide shows them, which is not quite
// the order they are taken: Step 2 shows West's ends and then East's, West is
// converted (Step 12) before East starts, and Step 6's messages are East's
// just after its junction is added.
import fs from "node:fs";
import path from "node:path";
import { openConfigurator, repoDir } from "./shoot.mjs";

const { browser, page, shot, done } = await openConfigurator("mss-logic");
const outDir = path.join(repoDir, "docs", "img", "mss-logic");
const errors = [];
const extra = [];

// ===== Helpers ===============================================================

const nav = (p, view) => p.click(`.nav-item[data-view="${view}"]`);

// The input or select of the field labelled `label` inside `scope`.
const fieldIn = (scope, label) => scope.locator(`label:has(.field-label:text-is("${label}"))`).locator("input, select").first();

// The top bar sticks to the top of the window, so a card scrolled up to it
// would be drawn under it. Pictures only: let it scroll away with the page.
// The top bar and the module picture stay put while the page scrolls. In a
// picture of one card they would be drawn over it, so they scroll here.
const unstickTopBar = (p) => p.addStyleTag({ content: ".topbar, .mss-module { position: static !important; }" });

// A picture of several cards in a row on the page (the first to the last),
// cropped to them. shot() takes one element; this takes the span of two.
async function shotSpan(p, first, last, name) {
  await p.locator(first).scrollIntoViewIfNeeded();
  const a = await p.locator(first).evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width }; });
  const b = await p.locator(last).evaluate((el) => { const r = el.getBoundingClientRect(); return { y: r.bottom + scrollY }; });
  const file = path.join(outDir, `${name}.png`);
  await p.screenshot({ path: file, fullPage: true, animations: "disabled", clip: { x: a.x, y: a.y, width: a.w, height: b.y - a.y } });
  extra.push(path.relative(repoDir, file));
}


// Nothing focused, so no focus ring or selected text in a picture.
const blur = (p) => p.evaluate(() => document.activeElement?.blur());

// A second board: a new browser window with nothing saved.
async function freshPage() {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2, acceptDownloads: true });
  const p = await context.newPage();
  p.on("pageerror", (error) => errors.push(error.message));
  p.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await p.goto(page.url());
  await unstickTopBar(p);
  return p;
}

// ----- The foundation pages -----

// Board page: the name (the page adds the suffix) and fake Wi-Fi, so the
// Wi-Fi warnings stay out of the pictures.
async function fillBoard(p, name) {
  await nav(p, "board");
  await fieldIn(p.locator("#board-identity"), "Board name").fill(name);
  await fieldIn(p.locator("#board-network"), "Wi-Fi name").fill("LayoutWiFi");
  await fieldIn(p.locator("#board-network"), "Wi-Fi password").fill("example-password");
}

// Sensors page. A new board starts with one example sensor: rename it to the
// first name, then Add sensor and type each other name.
async function addSensors(p, names) {
  await nav(p, "blocks");
  for (const [i, name] of names.entries()) {
    if (i > 0) await p.click("#btn-add-block");
    await fieldIn(p.locator("#blocks-list > .row-card").last(), "Name").fill(name);
  }
}

// Turnouts page. A new board starts with one example turnout: rename it, or
// remove it on a board with none.
async function setTurnout(p, name) {
  await nav(p, "points");
  const card = p.locator("#points-list .row-card").first();
  if (name) await fieldIn(card, "Name").fill(name);
  else await card.getByRole("button", { name: "Remove", exact: true }).click();
}

// Signal Masts page: a three-lamp mast (green at the top, amber, red at the
// base), with CATS aspects added from the list and their lamps lit.
const LAMPS = { R292: ["red", "steady"], R285: ["amber", "steady"], R281: ["green", "steady"],
  ADV_NORM: ["amber", "blink"], R282: ["amber", "pulse"], R283: ["green", "blink"], R286: ["amber", "blink"] };
const LAMP_AT = { green: 0, amber: 1, red: 2 }; // the picture lists the top of the mast first
const COLOUR = { red: "Red", amber: "Amber", green: "Green" };

async function addMast(p, name, aspects) {
  await nav(p, "signals");
  await p.click("#btn-add-mast");
  const card = p.locator("#signals-list > .row-card").last();
  await fieldIn(card, "Name").fill(name);
  for (let i = 0; i < 3; i += 1) await card.getByRole("button", { name: /^Add lamp/ }).click();
  for (const cats of aspects) {
    await card.getByLabel("CATS aspect").selectOption(cats);
    await card.getByRole("button", { name: "Add CATS aspect" }).click();
    const aspect = card.locator(".aspect-card").last();
    const [colour, mode] = LAMPS[cats];
    await aspect.locator(".mini-mast .mini-lamp").nth(LAMP_AT[colour]).click();
    await aspect.locator(".swatch-btn", { hasText: COLOUR[colour] }).click();
    if (mode !== "steady") await aspect.locator(".mode", { hasText: mode.charAt(0).toUpperCase() + mode.slice(1) }).click();
  }
}

// ----- The Logic page -----

async function chooseMss(p) {
  await nav(p, "logic");
  await fieldIn(p.locator("#logic-mode"), "Logic").selectOption({ label: "MSS Logic" });
}

const ends = (p) => p.locator("#logic-mss-ends");
const tracks = (p) => p.locator("#logic-mss-tracks");
const junctions = (p) => p.locator("#logic-mss-junctions");
const trackCard = (p, n) => tracks(p).locator(`#logic-mss-track-${n}`);
const form = (p, n) => trackCard(p, n).locator(".mss-form");

async function addEnds(p, count) {
  for (let i = 0; i < count; i += 1) await ends(p).getByRole("button", { name: "Add an end" }).click();
}

// The picture of the whole module, at the top of the page.
const picture = (p) => p.locator("#logic-mss-module");

// Click a block or block boundary of track n (from 0) on the picture, by its label.
const pickOnPicture = (p, n, label) => picture(p).locator(`g[aria-label="Track ${n + 1}, ${label}: edit it"]`).click();

// Pick a sensor for the block or boundary whose form is open.
const pickSensor = (p, n, name) => form(p, n).getByLabel("Add a sensor…").selectOption({ label: name });

async function setPlace(p, n, side, text) {
  await trackCard(p, n).getByLabel(side, { exact: true }).selectOption({ label: text });
}

// ===== West ==================================================================

await unstickTopBar(page);
await fillBoard(page, "kiama-west");
await addSensors(page, ["W1 current", "W2 current", "W12 optical"]);
await setTurnout(page, null);
await addMast(page, "W toward A", ["R292", "R285", "R281"]);
await addMast(page, "W toward B", ["R292", "R285", "R281"]);
await shot(page.locator("#signals-list > .row-card").first().locator(".aspects"), "01-mast-aspects");

// Step 1: Choose MSS Logic.
await chooseMss(page);
await blur(page);
await shotSpan(page, "#logic-mode", "#logic-settings", "02-choose-mss-logic");

// Step 2: Ends. Two ends, each with one track; no tracks yet, so red dots.
await addEnds(page, 2);
await blur(page);
await shotSpan(page, "#logic-mss-steps", "#logic-mss-ends", "03-west-ends");

// Step 3: Draw the track.
await tracks(page).getByRole("button", { name: "Add a track" }).click();
await blur(page);
await shot(picture(page), "05-track-new");
await trackCard(page, 0).getByRole("button", { name: "Add a block boundary" }).click();
await blur(page);
await shot(picture(page), "06-track-boundary");
await pickOnPicture(page, 0, "Block 1");
await pickSensor(page, 0, "W1 current");
await pickOnPicture(page, 0, "Block 1");
await shot(trackCard(page, 0).locator(".mss-body"), "07-track-block");
await pickOnPicture(page, 0, "Block 2");
await pickSensor(page, 0, "W2 current");
await pickOnPicture(page, 0, "Block boundary 1");
await pickSensor(page, 0, "W12 optical");
await form(page, 0).getByLabel("Signal for trains heading towards End B, track 1").selectOption({ label: "W toward B" });
await form(page, 0).getByLabel("Signal for trains heading towards End A, track 1").selectOption({ label: "W toward A" });
await pickOnPicture(page, 0, "Block boundary 1");
await blur(page);
await shot(picture(page), "08-west-track");
await shot("#logic-mss-steps", "09-west-steps");

// Step 12: Convert to Field Logic. West stops here, so it can be the copy.
const convert = page.locator("#logic-mss-convert");
await convert.getByRole("button", { name: "Convert to Field Logic" }).click();
await shot(convert, "19-convert");

// ===== East: a fresh board ===================================================

const east = await freshPage();
await fillBoard(east, "kiama-east");
await addSensors(east, ["E1 current", "E2 current", "E12 optical", "E Junction optical", "E Main current", "E Branch current"]);
await setTurnout(east, "E P1");
await addMast(east, "E Outer", ["R292", "R285", "ADV_NORM", "R281", "R282"]);
await addMast(east, "E Home", ["R292", "R285", "ADV_NORM", "R281", "R282", "R283", "R286"]);
await chooseMss(east);

// Step 2: ends A, B and C, with a Pair button and an LED on end A.
await addEnds(east, 3);
const endA = ends(east).locator("#logic-mss-end-0");
await fieldIn(endA, "Pair button pin").selectOption({ label: "GPIO32" });
await fieldIn(endA, "LED pin").selectOption({ label: "GPIO33" });
await blur(east);
await shot(ends(east), "04-east-ends");

// Step 4: the junction first, so its legs can be picked for the tracks.
await shot(junctions(east).locator(".mssj-add"), "10-junction-shapes");
await junctions(east).getByRole("button", { name: "Add junction" }).click();
await blur(east);
// Step 6 (Problems): with a junction and no tracks, the messages at the top.
await shot(east.locator("#messages"), "16-problems");
const j1 = junctions(east).locator(".mssj-junction").first();
await j1.getByLabel("Add a sensor…").selectOption({ label: "E Junction optical" });
await j1.getByLabel("Leg 1", { exact: true }).selectOption({ label: "E Home" });

// The tracks: Add a track fills in the first places nobody uses; set each one.
for (let n = 0; n < 3; n += 1) await tracks(east).getByRole("button", { name: "Add a track" }).click();
await setPlace(east, 0, "From", "End A, track 1");
await setPlace(east, 0, "To", "Junction J1, leg 1");
await setPlace(east, 1, "From", "Junction J1, leg 2");
await setPlace(east, 1, "To", "End B, track 1");
await setPlace(east, 2, "From", "Junction J1, leg 3");
await setPlace(east, 2, "To", "End C, track 1");
await trackCard(east, 0).getByRole("button", { name: "Add a block boundary" }).click();
await pickOnPicture(east, 0, "Block 1");
await pickSensor(east, 0, "E1 current");
await pickOnPicture(east, 0, "Block 2");
await pickSensor(east, 0, "E2 current");
await pickOnPicture(east, 0, "Block boundary 1");
await pickSensor(east, 0, "E12 optical");
await form(east, 0).getByLabel("Signal for trains heading towards Junction J1, leg 1").selectOption({ label: "E Outer" });
await pickOnPicture(east, 1, "Block 1");
await pickSensor(east, 1, "E Main current");
await pickOnPicture(east, 2, "Block 1");
await pickSensor(east, 2, "E Branch current");
await pickOnPicture(east, 0, "Block boundary 1");
await shot(trackCard(east, 0), "11-east-track-1");
await blur(east);
await shot(picture(east), "11-east-module");

// The junction, now that its legs have tracks.
await east.mouse.move(0, 0);
await shot(j1, "12-east-junction");
// Hover the diverging route: the drawing lights it. A taller window, so the
// drawing and the route are both in view and nothing scrolls the mouse off it.
await east.setViewportSize({ width: 1100, height: 2200 });
await j1.locator(".mssj-preview").evaluate((el) => el.scrollIntoView({ block: "start" }));
await j1.locator(".mssj-route-card").nth(1).locator(".mssj-route-head").hover();
await shot(j1.locator(".mssj-preview"), "13-junction-route-lit");
await east.mouse.move(0, 0);
await east.setViewportSize({ width: 1100, height: 900 });

// Step 5: the Signals grid, with both optional indications ticked. The page
// is never wider than 920px, so the grid scrolls sideways: the second picture
// is the grid scrolled to its right-hand end.
const signals = east.locator("#logic-mss-signals");
await fieldIn(signals, "Advance Approach").check();
await fieldIn(signals, "Approach Diverging").check();
await blur(east);
await shot(signals, "14-east-signals");
await signals.locator(".mss-signals-wrap").evaluate((el) => { el.scrollLeft = el.scrollWidth; });
await shot(signals.locator(".mss-signals-wrap"), "15-east-signals-right");

// Step 7: Download, and the module card it offers.
await nav(east, "yaml");
await shot(east.locator("#logic-download"), "17-download");
const [download] = await Promise.all([
  east.waitForEvent("download"),
  east.locator("#logic-download").getByRole("button", { name: "Download module card" }).click(),
]);
const cardFile = path.join(outDir, "module-card.tmp.html");
await download.saveAs(cardFile);
const cardPage = await east.context().newPage();
await cardPage.setViewportSize({ width: 800, height: 900 });
await cardPage.goto(`file://${cardFile}`);
await shot(cardPage.locator("body"), "18-module-card");
await cardPage.close();
fs.rmSync(cardFile);

await east.context().close();
await done();
for (const file of extra) console.log(`saved ${file}`);
if (errors.length) {
  console.error(`The second board's page logged errors:\n${errors.join("\n")}`);
  process.exit(1);
}
