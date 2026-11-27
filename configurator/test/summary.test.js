// The printable summary (field logic spec, Something to keep, and a guide;
// work item 2.11): every logic-set signal, every block with its pins.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

const ctx = loadModules("generator.js", "logic-yaml.js", "logic.js", "logic-summary.js");
const { EsphomeMr, EsphomeMrLogicYaml: Y, EsphomeMrLogicSummary: S } = ctx;
const { generateYaml, normalizeConfig, parseConfigFromYaml } = EsphomeMr;

// Same words as test/logic-page.test.js.
const SPEC_ONLY = /\b(scans?|scanning|latch(es|ed)?|interpreters?|rule tables?|phases?|resources?|layers?|tags?|tagged)\b/i;

// Its rules are hand-written, so the board runs its own logic keys (see useOwnItems).
const fixture = (name) => ctx.EsphomeMrLogicYaml.useOwnItems(JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "fixtures", `${name}.json`), "utf8")));
const lamp = (color) => ({ color, mode: "steady" });
const tags = { Stop: "stop", Clear: "clear" };

function mast(name, pins) {
  return {
    name, topic: `trains/track/signalmast/${name}`, topicCustom: false, mode: "gpio",
    lamps: [{ name: "Red", count: 1, pin: pins[0] }, { name: "Green", count: 1, pin: pins[1] }],
    aspects: [
      { label: "Stop", states: ["R292; Lit; Unheld"], startup: true, lamps: [lamp("red"), lamp("off")] },
      { label: "Clear", states: ["R281; Lit; Unheld"], lamps: [lamp("off"), lamp("green")] },
    ],
  };
}

const rule = (block, target) => ({
  trigger: { while: { block, is: "occupied" }, for: "0.5s" },
  checks: [],
  then: { mast: target, aspect: "Clear", reserve: "Bridge & Co" },
});

function northSnapshot() {
  const north = fixture("sensors");
  north.board.name = "kiama-north-k7m4x2";
  north.logic = { mode: "field", blocks: [{ name: "North Loop", topic: "trains/track/sensor/North Loop", sensors: ["Yard Ladder"] }] };
  return Y.linkedBoardFromConfig(ctx.EsphomeMrLogicYaml.useOwnItems(parseConfigFromYaml(generateYaml(north))));
}

// The expanders fixture (ESP pin, MCP 1 and Yard MCP sensors) in Field Logic.
function board() {
  const config = fixture("expanders");
  config.board.name = "summary-k7m4x2";
  config.signals = { mode: "gpio", masts: [mast("Zed Mast", ["GPIO32", "GPIO19"]), mast("Alpha Mast", ["GPIO21", "GPIO22"]), mast("Unused Mast", ["GPIO23", "GPIO12"])] };
  config.logic = {
    mode: "field",
    remoteBoards: [northSnapshot()],
    masts: [
      { mast: "Zed Mast", tags },
      { mast: "Alpha Mast", tags, approachLight: "Int 2" },
      { virtual: true, name: "Exit <1>", topic: "trains/track/signalmast/Exit", aspects: ["Stop", "Clear"], tags },
    ],
    blocks: [
      { name: "Int 2", sensors: ["Kiama/Up XOver", "Int 2 East", { board: "kiama-north-k7m4x2", sensor: "Yard Ladder" }] },
      { name: "Yard <b>", sensors: ["Yard 3"] },
    ],
    resources: [{ name: "Bridge & Co", blocks: ["Int 2"], release: { while: { block: "Int 2", is: "clear" }, for: "3s" } }],
    layers: [{ name: "Gauntlet", rules: [rule("Int 2", "Zed Mast"), rule("Int 2", "Alpha Mast"), rule("Int 2", "Exit <1>")] }],
  };
  return normalizeConfig(config);
}

const make = (config) => S.summaryHtml(config, { date: "2026-11-25" });
const textOf = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ");
const decode = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

test("the summary lists every logic-set signal in page order, then signals with no lights", () => {
  const html = make(board());
  const at = ["Zed Mast", "Alpha Mast", "Exit &lt;1&gt;"].map((name) => html.indexOf(`<h3>${name}`));
  assert.ok(at.every((i) => i >= 0), at.join());
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  assert.ok(!html.includes("Unused Mast"));
  assert.match(html, /Zed Mast shows Clear when a train has been in Int 2 for half a second/);
  assert.match(html, /Approach lighting: on, lit when a train is in Int 2/);
  assert.match(html, /Approach lighting: off/);
});

test("the summary lists every block with its sensors' pins", () => {
  const html = make(board());
  assert.match(html, /Kiama\/Up XOver<\/td><td><code>GPIO14<\/code>/);
  assert.match(html, /Int 2 East<\/td><td><code>MCP 1 · B3<\/code>/);
  assert.match(html, /Yard 3<\/td><td><code>Yard MCP · B7<\/code>/);
  assert.match(html, /Yard Ladder<\/td><td><code>from kiama-north-k7m4x2<\/code>/);
});

test("the summary lists each section and when it is freed", () => {
  const html = make(board());
  assert.match(html, /<h3>Bridge &amp; Co<\/h3>/);
  assert.match(html, /Free the section when .*Int 2.*\./);
});

test("the summary has the board name, the version code and the date", () => {
  const config = board();
  const html = make(config);
  assert.match(html, /<h1>summary-k7m4x2<\/h1>/);
  assert.ok(html.includes(`<code>${Y.versionCode(config)}</code>`));
  assert.match(Y.versionCode(config), /^[0-9a-f]{8}$/);
  assert.ok(html.includes("made 2026-11-25"));
});

test("names are escaped, and the page has no scripts", () => {
  const html = make(board());
  assert.ok(!html.includes("<b>") && !html.includes("<1>"));
  assert.ok(html.includes("Yard &lt;b&gt;") && html.includes("Exit &lt;1&gt;"));
  assert.ok(!/<script|\son\w+=/i.test(html));
});

test("outside Field Logic there is no summary", () => {
  const config = board();
  config.logic.mode = "none";
  assert.equal(make(config), "");
});

test("the summary uses the page's plain words", () => {
  assert.equal(SPEC_ONLY.exec(decode(textOf(make(board())))), null);
});
