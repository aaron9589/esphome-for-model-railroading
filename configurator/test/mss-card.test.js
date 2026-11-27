// The printable module card (docs/mss-emulation-spec.md, The module card; work
// item 4.4): every sensor, signal and pin is listed, the Wi-Fi and pairing
// steps are there, names are escaped, and the words are plain.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

const LOGIC_UI_FILES = ["generator.js", "logic-yaml.js", "logic.js", "logic-checker.js", "logic-try.js", "logic-ui.js", "logic-ui-masts.js", "logic-ui-ends.js", "logic-ui-views.js", "logic-ui-start.js", "logic-ui-try.js", "logic-starters.js", "logic-starters-sections.js", "logic-starters-signals.js", "mss-builder.js", "plan-builder.js", "plan-edit.js", "logic-summary.js", "mss-card.js"];
const ctx = loadModules(...LOGIC_UI_FILES);
const { EsphomeMr, EsphomeMrLogicYaml: Y, EsphomeMrMssCard: Card } = ctx;
const { myFirstBoardPreset, topicFor } = EsphomeMr;

// Same words as test/logic-page.test.js.
const SPEC_ONLY = /\b(scans?|scanning|latch(es|ed)?|interpreters?|rule tables?|phases?|resources?|layers?|tags?|tagged)\b/i;

const casesDir = path.join(configuratorDir, "test", "cases", "mss");
const readCase = (file) => JSON.parse(fs.readFileSync(path.join(casesDir, file), "utf8"));
const plain = (value) => JSON.parse(JSON.stringify(value));
const SENSOR_PINS = ["GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO32", "GPIO35", "GPIO34", "GPIO39"];
const MAST_PINS = ["GPIO16", "GPIO17", "GPIO19", "GPIO23", "GPIO18", "GPIO13"];

function moduleBoard(name, module) {
  const config = myFirstBoardPreset();
  config.board.name = name;
  config.blocks = (module.sensors || []).map((s, i) => ({ name: s, topic: topicFor("block", s), topicCustom: false, gpio: SENSOR_PINS[i], inverted: true, debounce: "500ms" }));
  config.points = (module.turnouts || []).map((t, i) => ({ name: t, topic: topicFor("point", t), channel: i }));
  config.signals = {
    mode: "addressable",
    masts: (module.masts || []).map((m, i) => ({
      name: m, topic: topicFor("signal", m), topicCustom: false, mode: "addressable", pin: MAST_PINS[i],
      lamps: [{ name: "Head", count: 1 }],
      aspects: [{ label: "R292", states: ["R292; Lit; Unheld"], startup: true, lamps: [{ color: "red", mode: "steady" }] }],
    })),
  };
  config.logic = { mode: "mss", mss: plain(module.mss) };
  return config;
}

const junction = () => moduleBoard("jm", readCase("mss-junction-turnout.json").module);
const date = "2026-01-02";

test("every sensor, signal and turnout is listed with its pin", () => {
  const config = junction();
  config.logic.mss.ends[0].pairPin = "GPIO32";
  config.logic.mss.ends[0].ledPin = "GPIO33";
  const html = Card.cardHtml(config, { date });
  assert.ok(config.blocks.length > 0 && config.signals.masts.length > 0 && config.points.length > 0);
  for (const sensor of config.blocks) assert.ok(html.includes(`<td>${sensor.name}</td><td>${sensor.gpio}</td>`), sensor.name);
  for (const mast of config.signals.masts) assert.ok(html.includes(`<td>${mast.name}</td><td>data ${mast.pin}</td>`), mast.name);
  for (const point of config.points) assert.ok(html.includes(`<td>${point.name}</td><td>PCA9685 board 1, channel ${point.channel}</td>`), point.name);
  for (const end of Y.endsOf(config)) assert.ok(html.includes(`<td>${end.name}</td>`), end.name);
  assert.ok(html.includes("GPIO32") && html.includes("GPIO33"), "Pair and LED pins");
  assert.ok(html.includes(Y.versionCode(config)), "the version code");
  assert.ok(html.includes("2026-01-02"));
});

test("each sensor and signal says where it sits", () => {
  const html = Card.cardHtml(junction(), { date });
  assert.match(html, /Track 1 \(end A track 1 to junction J1 leg 1\), block 1/);
  assert.match(html, /Junction J1/);
  assert.ok(!html.includes("not used by the module"), "every item is placed");
});

test("individual-LED signals and expander sensors show their pins", () => {
  const config = junction();
  config.signals.masts[0].mode = "gpio";
  config.signals.masts[0].lamps = [{ name: "Red", count: 1, pin: "gpio4" }, { name: "Green", count: 1, pin: "GPIO5" }];
  config.blocks[0] = { ...config.blocks[0], expander: "MCP 1", pin: 11 };
  delete config.blocks[0].gpio;
  const html = Card.cardHtml(config, { date });
  assert.ok(html.includes("Red: GPIO4, Green: GPIO5"));
  assert.ok(html.includes("MCP 1 · B3"));
});

test("the Wi-Fi and pairing steps are there", () => {
  const html = Card.cardHtml(junction(), { date });
  assert.ok(html.includes("hotspot called jm setup"));
  assert.ok(html.includes("Press Pair on both sides of the joint within 30 seconds"));
  assert.ok(html.includes("steady when the joint is working"));
  assert.ok(html.includes("Fast blink"));
});

test("it is self-contained: print CSS, no scripts, no links out", () => {
  const html = Card.cardHtml(junction(), { date });
  assert.match(html, /^<!doctype html>/);
  assert.ok(html.includes("@media print"));
  assert.ok(!/<script|<link|<img|https?:\/\//i.test(html));
});

test("every name is escaped", () => {
  const config = junction();
  const evil = "<img src=x onerror=\"alert(1)\">&'";
  config.board.name = evil;
  config.blocks[0].name = evil;
  config.signals.masts[0].name = evil;
  config.points[0].name = evil;
  config.logic.mss.ends[0].name = evil;
  const html = Card.cardHtml(config, { date: evil });
  assert.ok(!html.includes("<img"), "no raw tag");
  assert.ok(!html.includes("onerror=\""));
  assert.ok(html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;"));
});

test("it makes nothing outside MSS Logic", () => {
  const config = junction();
  config.logic.mode = "field";
  assert.equal(Card.cardHtml(config), "");
});

test("the words on the card are plain", () => {
  const html = Card.cardHtml(junction(), { date });
  const text = html.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, " ");
  assert.equal(SPEC_ONLY.exec(text), null, text.match(SPEC_ONLY)?.[0]);
  for (const [key, value] of Object.entries(Card.TEXT)) {
    const lines = typeof value === "function" ? value("Sample setup") : value;
    for (const line of [].concat(lines)) assert.equal(SPEC_ONLY.exec(line), null, `${key}: ${line}`);
  }
});
