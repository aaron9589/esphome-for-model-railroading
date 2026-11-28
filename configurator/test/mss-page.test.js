// The MSS page's shared parts: built items shown read-only, the MSS
// plain-words lint and the Download version. The page's frame is
// test/mss-page-frame.test.js.
// Work item 4.2d.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

// Every page script, in index.html's order (logic-page.test.js checks that list).
const html = fs.readFileSync(path.join(configuratorDir, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script src="\.\/([^"]+)"><\/script>/g)].map((m) => m[1]);
const LOGIC_UI_FILES = scripts.slice(scripts.indexOf("generator.js"), scripts.indexOf("app.js"));

const context = loadModules(...LOGIC_UI_FILES);
const { myFirstBoardPreset, topicFor, validateConfig } = context.EsphomeMr;
const { EsphomeMrMssBuilder: B, EsphomeMrLogicUiViews: Views, EsphomeMrLogicUiStart: Start, EsphomeMrLogicUi: Ui } = context;
const plain = (value) => JSON.parse(JSON.stringify(value));

// Spec, mss-emulation-spec.md "Plain labels for MSS terms": the left-hand
// words must not reach the page. "Block boundary" is the right word.
export const MSS_TERMS = [
  ["Boundary", /(?<!block )\bboundar(y|ies)\b/i],
  ["Pass-through track", /\bpass[- ]?through\b/i],
  ["Junction leg", /\bjunction legs?\b/i],
  ["Route active", /\broutes? (is |are )?active\b/i],
  ["Plant end", /\bplant ends?\b/i],
  ["Link", /\blink(s|ed|ing)?\b/i],
  ["Built item", /\bbuilt items?\b/i],
];

function strings(value, where) {
  if (typeof value === "string") return [[where, value]];
  if (typeof value === "function") {
    // A sentence-builder some part wrote for other sample values is skipped here; logic-page.test.js reports it.
    try {
      return strings(value("Sample", ["a change", "another"], 2), `${where}()`);
    } catch {
      return [];
    }
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, inner]) => strings(inner, `${where}.${key}`));
}

const lamp = (color) => ({ color, mode: "steady" });
function board() {
  const config = myFirstBoardPreset();
  config.board.name = "module-one";
  config.blocks = ["S1", "S2", "O12"].map((name, i) => ({ name, topic: topicFor("block", name), topicCustom: false, gpio: ["GPIO14", "GPIO27", "GPIO26"][i], inverted: true, debounce: "500ms" }));
  config.signals = {
    mode: "addressable",
    masts: [{
      name: "West", topic: topicFor("signal", "West"), topicCustom: false, mode: "addressable", pin: "GPIO16",
      lamps: [{ name: "Head", count: 1 }],
      aspects: ["R292", "R285", "ADV_NORM", "R281", "R282", "R283", "R286"].map((label, i) => ({ label, states: [`${label}; Lit; Unheld`], ...(i === 0 ? { startup: true } : {}), lamps: [lamp(i === 0 ? "red" : "green")] })),
    }],
  };
  config.logic = {
    mode: "mss",
    mss: {
      ends: [{ name: "A", tracks: 1 }, { name: "B", tracks: 1 }],
      tracks: [{
        from: { end: "A", track: 1 }, to: { end: "B", track: 1 },
        blocks: [{ sensors: ["S1"] }, { sensors: ["S2"] }],
        boundaries: [{ sensors: ["O12"], towardsFrom: "West", towardsTo: null }],
      }],
    },
  };
  return config;
}

// Builder strings (mss-builder.js, 4.1) that still say a spec term. The page
// shows both. Fixing the first renames built signals, so cases and goldens move
// with it; remove each entry when its string is fixed.
const KNOWN_IN_BUILDER = new Set([
  "EsphomeMrMssBuilder.TEXT.boundarySignal()", // built signal names: "<track> boundary 1 towards B1"
]);

test("the MSS terms stay off the page: the builder's words and every MSS part's TEXT", () => {
  const texts = [
    ["EsphomeMrMssBuilder.TEXT", B.TEXT],
    ["EsphomeMrLogicUiViews.TEXT", Views.TEXT],
    ...["", "Row", "Try"].map((name) => [`EsphomeMrLogicUiMss${name}.TEXT`, context[`EsphomeMrLogicUiMss${name}`].TEXT]),
    ["EsphomeMrMssRow.TEXT", context.EsphomeMrMssRow.TEXT],
    ...Ui.allText().filter(([id]) => Object.values(B.PARTS).includes(id)),
  ];
  const found = texts
    .flatMap(([where, text]) => strings(text, where))
    .filter(([where]) => !KNOWN_IN_BUILDER.has(where))
    .flatMap(([where, text]) => MSS_TERMS.filter(([, re]) => re.test(text)).map(([term]) => [where, term, text]));
  assert.deepEqual(found, []);
});

test("the MSS lint catches each term, and lets Block boundary through", () => {
  const says = (text) => MSS_TERMS.filter(([, re]) => re.test(text)).map(([term]) => term);
  assert.deepEqual(says("The boundary signal"), ["Boundary"]);
  assert.deepEqual(says("Block boundary 2"), []);
  assert.deepEqual(says("A pass-through track"), ["Pass-through track"]);
  assert.deepEqual(says("Each junction leg"), ["Junction leg"]);
  assert.deepEqual(says("While the route is active"), ["Route active"]);
  assert.deepEqual(says("Its plant ends"), ["Plant end"]);
  assert.deepEqual(says("Linked boards"), ["Link"]);
  assert.deepEqual(says("The built items"), ["Built item"]);
  assert.deepEqual(says("Paired with B. Made by MSS Logic. Leg 2. Route set. End A."), []);
});

test("Who uses what and the control table show what MSS Logic built, marked", () => {
  const config = board();
  const who = plain(Views.whoUses(config));
  const blocks = who.filter((r) => r.kind === "block");
  assert.ok(blocks.length >= 2, "the built blocks are listed");
  assert.ok(blocks.every((r) => r.madeBy && r.madeBy.startsWith("track ") === false), "each carries what made it");
  assert.ok(blocks.some((r) => r.madeBy.includes("Track 1 (A1 to B1)")));
  const virtual = who.find((r) => r.kind === "mast" && r.name !== "West");
  assert.ok(virtual?.madeBy, "a signal with no lights is built");
  assert.equal(who.find((r) => r.kind === "mast" && r.name === "West")?.madeBy, undefined, "the person's own signal is not");
  assert.ok(who.every((r) => r.setBy.every((g) => typeof g === "string")));

  const rows = plain(Views.controlTable(config));
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.madeBy === Views.TEXT.madeBy));
  assert.ok(rows.some((r) => r.mast === "West"));
});

test("Field Logic's views read config.logic exactly as before", () => {
  const config = board();
  config.logic = { mode: "field", mss: config.logic.mss };
  assert.deepEqual(plain(Views.whoUses(config)), []);
  assert.deepEqual(plain(Views.controlTable(config)), []);
});

test("every problem the builder can report names a part the page has", () => {
  const config = board();
  config.logic.mss = { ends: [{ name: "A" }, { name: "A" }], tracks: [{}], junctions: [{}] };
  const parts = new Set(Object.values(B.PARTS));
  const found = B.problems(config);
  assert.ok(found.length > 3);
  for (const problem of found) assert.ok(parts.has(problem.where.part), problem.text);
});

test("MSS Logic is in the mode list, and its Download page shows the Logic version", () => {
  assert.ok([...Ui.modeChoices()].includes("mss"));
  const config = board();
  const info = Start.downloadLogic(config, validateConfig(config));
  assert.ok(info, "MSS Logic has a Download section");
  assert.match(info.version, /^[0-9a-f]{8}$/);
  const field = board();
  delete field.logic;
  assert.equal(Start.downloadLogic(field), null);
});
