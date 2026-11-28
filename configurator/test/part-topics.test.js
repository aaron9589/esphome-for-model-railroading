// On an MSS Logic board, each part's MQTT topic carries the board's name after
// the type: trains/track/sensor/<board>/<name>, .../turnout/<board>/<name>,
// .../signalmast/<board>/<name>. Modules made from the same MSS boards have
// the same part names (Block 1 current, Signal 1 to B ...) and meet on one
// broker, so without it two modules would share a topic. Other boards keep
// trains/track/<type>/<name>. A topic the person typed is never changed.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

const html = fs.readFileSync(path.join(configuratorDir, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script src="\.\/([^"]+)"><\/script>/g)].map((m) => m[1]);
const ctx = loadModules(...scripts.slice(scripts.indexOf("generator.js"), scripts.indexOf("app.js")));
const { EsphomeMr: M, EsphomeMrMssRow: R } = ctx;

// A passing siding made as Make the module makes it, on a board called `name`.
function module(name) {
  const config = M.myFirstBoardPreset();
  config.board.name = name;
  M.addNameSuffix(config.board);
  config.blocks = [];
  config.points = [];
  config.signals = { mode: "addressable", masts: [] };
  config.logic = { mode: "mss", mss: { row: R.preset("passing") } };
  const pins = ["GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO32", "GPIO16", "GPIO17", "GPIO19", "GPIO23", "GPIO18", "GPIO13"];
  let k = 0;
  R.use(config, config.logic.mss.row, ({ sensors, turnouts, masts }) => {
    config.blocks.push(...sensors.map((s) => ({ name: s, topic: M.partTopic(config, "block", s), topicCustom: false, gpio: pins[k++], inverted: true, debounce: "500ms" })));
    config.points.push(...turnouts.map((t, i) => ({ name: t, topic: M.partTopic(config, "point", t), topicCustom: false, channel: i })));
    config.signals.masts.push(...masts.map((m) => ({ ...m, topic: M.partTopic(config, "signal", m.name), topicCustom: false, pin: pins[k++] })));
  }, { style: "strip" });
  M.normalizeConfig(config);
  return config;
}

test("an MSS Logic board's parts carry its name in their topics; other boards' do not", () => {
  const config = { board: { name: "kiama-east-xnjwjs" }, logic: { mode: "mss" } };
  assert.equal(M.partTopic(config, "block", "Block 1 current"), "trains/track/sensor/kiama-east-xnjwjs/Block 1 current");
  assert.equal(M.partTopic(config, "point", "Points 1"), "trains/track/turnout/kiama-east-xnjwjs/Points 1");
  assert.equal(M.partTopic(config, "signal", "Signal 1 to B"), "trains/track/signalmast/kiama-east-xnjwjs/Signal 1 to B");
  for (const mode of ["field", "none"]) {
    assert.equal(M.partTopic({ ...config, logic: { mode } }, "block", "Block 1 current"), "trains/track/sensor/Block 1 current", mode);
  }
  assert.equal(M.partTopic({ board: {}, logic: { mode: "mss" } }, "block", "B1"), "trains/track/sensor/B1", "no board name yet");
  assert.equal(M.partTopic(config, "block", "  "), "");
});

test("two modules made from the same boards share part names, never a topic", () => {
  const west = module("kiama-west");
  const east = module("kiama-east");
  const topics = (config) => [...config.blocks, ...config.points, ...config.signals.masts].map((x) => x.topic);
  assert.deepEqual(west.blocks.map((b) => b.name), east.blocks.map((b) => b.name), "the same names");
  const shared = topics(west).filter((t) => topics(east).includes(t));
  assert.deepEqual(shared, [], "no topic in common");
  assert.ok(topics(east).every((t) => t.includes(`/${east.board.name}/`)), topics(east).join());
});

test("the YAML and the JMRI file use the board's topics, with the turnout's feedback under them", () => {
  const config = module("kiama-east");
  const board = config.board.name;
  const yaml = M.generateYaml(config);
  assert.match(yaml, new RegExp(`topic: "trains/track/sensor/${board}/Block 1 current"`));
  assert.match(yaml, new RegExp(`"trains/track/turnout/${board}/Points 1"`));
  assert.match(yaml, new RegExp(`"trains/track/sensor/${board}/Points 1/Thrown"`), "the position feedback follows the turnout's topic");
  assert.match(yaml, new RegExp(`"trains/track/signalmast/${board}/Signal 1 to B"`));
  assert.doesNotMatch(yaml, /"trains\/track\/sensor\/Block 1 current"/);
  const { xml, skipped } = M.generateJmriXml(config);
  assert.equal(skipped.length, 0, "nothing left out");
  assert.ok(xml.includes(`<systemName>MS${board}/Block 1 current</systemName>`), "a sensor");
  assert.ok(xml.includes(`<systemName>MT${board}/Points 1</systemName>`), "a turnout");
  assert.ok(xml.includes(`<systemName>MS${board}/Points 1/Thrown</systemName>`), "its feedback");
  assert.ok(xml.includes(`IF$mqm:cats-masts:cats-virtual(${board}/Signal 1 to B)`), "a signal mast");
});

test("topics that follow their part's name follow the board's name and mode; a typed one stays", () => {
  const config = module("kiama-east");
  const suffix = config.board.nameSuffix;
  const block = () => config.blocks[0].topic;
  // Renamed: the suffix stays, the topic follows.
  M.setTypedBoardName(config.board, "kiama-south");
  M.normalizeConfig(config);
  assert.equal(block(), `trains/track/sensor/kiama-south-${suffix}/Block 1 current`);
  // Field Logic: the plain topic again; MSS Logic: the board's.
  config.logic.mode = "field";
  M.normalizeConfig(config);
  assert.equal(block(), "trains/track/sensor/Block 1 current");
  config.logic.mode = "mss";
  M.normalizeConfig(config);
  assert.equal(block(), `trains/track/sensor/kiama-south-${suffix}/Block 1 current`);
  // A topic the person typed is never changed.
  config.blocks[1].topic = "trains/east/loop";
  config.blocks[1].topicCustom = true;
  M.normalizeConfig(config);
  assert.equal(config.blocks[1].topic, "trains/east/loop");
  // Nor is an old file's own topic, even where it was not marked as typed.
  config.blocks[2].topic = "trains/fiddle/occupancy";
  config.blocks[2].topicCustom = false;
  M.normalizeConfig(config);
  assert.equal(config.blocks[2].topic, "trains/fiddle/occupancy");
});

test("an MSS board's file imports with its topics as they were", () => {
  const config = module("kiama-east");
  const again = M.parseConfigFromYaml(M.generateYaml(config));
  assert.deepEqual(JSON.parse(JSON.stringify(again.blocks.map((b) => [b.topic, b.topicCustom]))), config.blocks.map((b) => [b.topic, false]));
  assert.equal(M.generateYaml(again), M.generateYaml(config));
});

if (!process.exitCode) console.log("\nAll part topic tests passed.");
