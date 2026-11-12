import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generatorPath = path.join(__dirname, "..", "generator.js");
const context = { globalThis: {} };
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(generatorPath, "utf8"), context, {
  filename: "generator.js",
});

const {
  CONFIG_MARKER,
  MIN_ESPHOME_VERSION,
  generateYaml,
  myFirstBoardPreset,
  parseConfigFromYaml,
  uniqueIds,
  validateConfig,
} = context.EsphomeMr;

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`fail - ${name}`);
    throw err;
  }
}

test("My First Board preset matches sample topics and pins", () => {
  const config = myFirstBoardPreset();
  assert.equal(config.board.name, "my-first-board");
  assert.equal(config.board.boardType, "nodemcu-32s");
  assert.equal(config.blocks.length, 1);
  assert.equal(config.points.length, 1);
  assert.equal(config.blocks[0].name, "Kiama/Up XOver");
  assert.equal(config.blocks[0].topic, "trains/track/sensor/Kiama/Up XOver");
  assert.equal(config.blocks[0].gpio, "GPIO14");
  assert.equal(config.points[0].name, "Kiama/Up Loop");
  assert.equal(config.points[0].topic, "trains/track/turnout/Kiama/Up Loop");
  assert.equal(config.points[0].channel, 0);
  assert.equal(config.i2c.sda, "GPIO21");
  assert.equal(config.i2c.scl, "GPIO22");
});

test("generated YAML embeds credentials and min_version", () => {
  const config = myFirstBoardPreset();
  config.board.wifiSsid = "layout-wifi";
  config.board.wifiPassword = "s3cret";
  config.board.mqttBroker = "192.168.1.50";
  config.board.otaPassword = "ota-pass";

  const yaml = generateYaml(config);
  assert.match(yaml, new RegExp(`# ${CONFIG_MARKER}`));
  assert.match(yaml, /min_version: "2024\.6\.0"/);
  assert.match(yaml, /platform: esphome/);
  assert.match(yaml, /ssid: layout-wifi/);
  assert.match(yaml, /password: s3cret/);
  assert.match(yaml, /broker: 192\.168\.1\.50/);
  assert.doesNotMatch(yaml, /!secret/);
  assert.match(yaml, /Kiama\/Up XOver \| OCCUPIED/);
  assert.match(yaml, /tag: block_sensor/);
  assert.match(yaml, /pca9685:/);
  assert.match(yaml, /frequency: 50Hz/);
  assert.match(yaml, /channel: 0/);
  assert.match(yaml, /tag: point_control/);
  assert.match(yaml, /web_server:/);
  assert.equal(MIN_ESPHOME_VERSION, "2024.6.0");
});

test("round-trip import restores UI state including secrets", () => {
  const config = myFirstBoardPreset();
  config.board.wifiSsid = "A";
  config.board.wifiPassword = "B";
  config.board.mqttBroker = "10.0.0.2";
  config.board.otaPassword = "C";
  config.blocks.push({
    name: "Bombo/Down Crossover",
    topic: "trains/track/sensor/Bombo/Down Crossover",
    gpio: "GPIO27",
    inverted: true,
    debounce: "500ms",
  });

  const yaml = generateYaml(config);
  const restored = parseConfigFromYaml(yaml);
  assert.deepEqual(restored.board, config.board);
  assert.equal(restored.blocks.length, 2);
  assert.equal(restored.points.length, 1);
  assert.equal(restored.blocks[1].gpio, "GPIO27");
  assert.deepEqual(restored.i2c, config.i2c);
});

test("second point shares one pca9685 hub and unique ids", () => {
  const config = myFirstBoardPreset();
  config.board.wifiSsid = "x";
  config.board.wifiPassword = "y";
  config.board.mqttBroker = "1.2.3.4";
  config.board.otaPassword = "z";
  config.points.push({
    name: "Yard Exit",
    topic: "trains/track/turnout/Yard/Exit",
    channel: 1,
    travelTime: "15s",
  });
  const yaml = generateYaml(config);
  const pcaCount = (yaml.match(/^pca9685:/gm) || []).length;
  assert.equal(pcaCount, 1);
  assert.match(yaml, /id: kiama_up_loop_servo/);
  assert.match(yaml, /id: yard_exit_servo/);
  assert.match(yaml, /name: "Kiama\/Up Loop Normal Position"/);
  assert.match(yaml, /Kiama\/Up Loop -> THROWN \(reverse\)/);
  assert.match(yaml, /channel: 1/);
  assert.match(yaml, /transition_length: 15s/);
});

test("validation catches pin and channel clashes", () => {
  const config = myFirstBoardPreset();
  config.blocks.push({
    name: "Clash",
    topic: "trains/track/sensor/Clash",
    gpio: "GPIO14",
    inverted: true,
    debounce: "500ms",
  });
  config.points.push({
    name: "same_ch",
    topic: "trains/track/turnout/X",
    channel: 0,
    travelTime: "10s",
  });
  const { warnings } = validateConfig(config);
  assert.ok(warnings.some((w) => w.includes("GPIO clash")));
  assert.ok(warnings.some((w) => w.includes("PCA9685 channel clash")));
});

test("uniqueIds sanitizes names", () => {
  const items = uniqueIds([
    { name: "Kiama/Up XOver" },
    { name: "Kiama/Up XOver" },
  ]);
  assert.equal(items[0].id, "kiama_up_xover");
  assert.equal(items[1].id, "kiama_up_xover_2");
});

test("parse rejects hand-edited files without marker", () => {
  assert.throws(() => parseConfigFromYaml("esphome:\n  name: x\n"), /not generated/);
});

console.log("\nAll generator tests passed.");
