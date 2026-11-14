import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generatorPath = path.join(__dirname, "..", "generator.js");
const context = { crypto: globalThis.crypto };
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(generatorPath, "utf8"), context, {
  filename: "generator.js",
});

const {
  CONFIG_MARKER,
  MIN_ESPHOME_VERSION,
  generatePassword,
  generateYaml,
  myFirstBoardPreset,
  parseConfigFromYaml,
  topicFor,
  stateTopic,
  uniqueIds,
  validateConfig,
} = context.EsphomeMr;

function withCreds(config) {
  config.board.wifiSsid = "layout-wifi";
  config.board.wifiPassword = "s3cret";
  config.board.mqttBroker = "192.168.1.50";
  return config;
}

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
  assert.equal(config.board.module, "nodemcu-32s");
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
  const config = withCreds(myFirstBoardPreset());

  const yaml = generateYaml(config);
  assert.match(yaml, new RegExp(`# ${CONFIG_MARKER}`));
  assert.match(yaml, /min_version: "2026\.9\.0"/);
  assert.match(yaml, /variant: esp32/);
  assert.doesNotMatch(yaml, /^  board:/m);
  assert.match(yaml, /platform: esphome/);
  assert.match(yaml, /ssid: layout-wifi/);
  assert.match(yaml, /password: s3cret/);
  assert.match(yaml, /broker: 192\.168\.1\.50/);
  assert.match(yaml, /^api:\n  encryption:\n    key: "[A-Za-z0-9+/]{43}="\n  reboot_timeout: 0s\n/m);
  assert.match(yaml, /^ota:\n  - platform: esphome\n    encryption:\n/m);
  assert.doesNotMatch(yaml, /ota-pass/);
  assert.doesNotMatch(yaml, /!secret/);
  assert.match(yaml, /Kiama\/Up XOver \| OCCUPIED/);
  assert.match(yaml, /tag: block_sensor/);
  assert.match(yaml, /pca9685:/);
  assert.match(yaml, /frequency: 50Hz/);
  assert.match(yaml, /channel: 0/);
  assert.match(yaml, /tag: point_control/);
  assert.match(yaml, /web_server:\n  local: true/);
  assert.equal(MIN_ESPHOME_VERSION, "2026.9.0");
});

test("round-trip import restores UI state including secrets", () => {
  const config = myFirstBoardPreset();
  config.board.wifiSsid = "A";
  config.board.wifiPassword = "B";
  config.board.mqttBroker = "10.0.0.2";
  config.board.otaPassword = "C";
  config.board.apiKey = "abc";
  config.board.apPassword = "hotspot123";
  config.points[0].controls = [
    { action: "toggle", buttonPin: "GPIO4", closedLight: "GPIO16", openLight: "GPIO13" },
  ];
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
  assert.deepEqual(JSON.parse(JSON.stringify(restored.points[0].controls)), [
    { action: "toggle", buttonPin: "GPIO4", closedLight: "GPIO16", openLight: "GPIO13" },
  ]);
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
  assert.match(yaml, /name: "Kiama - Up Loop Normal Position"/);
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

test("entity names replace slashes, and MQTT topics keep them", () => {
  const config = withCreds(myFirstBoardPreset());
  config.points[0].controls = [
    { action: "toggle", buttonPin: "GPIO4", closedLight: "GPIO16", openLight: "GPIO13" },
  ];
  const yaml = generateYaml(config);
  assert.match(yaml, /name: "Kiama - Up XOver"/);
  assert.match(yaml, /name: "Kiama - Up Loop Normal Position"/);
  assert.match(yaml, /name: "Kiama - Up Loop last command"/);
  assert.match(yaml, /name: "Kiama - Up Loop button 1"/);
  assert.match(yaml, /name: "Kiama - Up Loop closed light 1"/);
  assert.match(yaml, /topic: "trains\/track\/sensor\/Kiama\/Up XOver"/);
  assert.match(yaml, /topic: "trains\/track\/turnout\/Kiama\/Up Loop"/);
  for (const match of yaml.matchAll(/^    name: (.*)$/gm)) {
    assert.doesNotMatch(match[1], /\//);
  }
});

test("topic follows the name and state topic is the command topic plus /State", () => {
  assert.equal(topicFor("point", "Kiama/Up Loop"), "trains/track/turnout/Kiama/Up Loop");
  assert.equal(topicFor("block", "Kiama/Up XOver"), "trains/track/sensor/Kiama/Up XOver");
  const config = myFirstBoardPreset();
  config.board.wifiSsid = "x";
  config.board.wifiPassword = "y";
  config.board.mqttBroker = "1.2.3.4";
  config.board.otaPassword = "z";
  const yaml = generateYaml(config);
  assert.match(yaml, /topic: "trains\/track\/turnout\/Kiama\/Up Loop\/State"/);
  assert.equal(stateTopic(config.points[0].topic), "trains/track/turnout/Kiama/Up Loop/State");
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

test("both pictures write variant esp32 and an old file still imports", () => {
  for (const moduleName of ["nodemcu-32s", "esp32dev"]) {
    const config = withCreds(myFirstBoardPreset());
    config.board.module = moduleName;
    const yaml = generateYaml(config);
    assert.match(yaml, /^esp32:\n  variant: esp32\n/m);
    assert.doesNotMatch(yaml, /^  board:/m);
  }

  for (const boardType of ["nodemcu-32s", "esp32dev"]) {
    const stored = {
      board: {
        name: "my-first-board",
        boardType,
        wifiSsid: "layout-wifi",
        wifiPassword: "s3cret",
        mqttBroker: "192.168.1.50",
        otaPassword: "ota-pass",
      },
      blocks: [],
      points: [],
      i2c: { sda: "GPIO21", scl: "GPIO22" },
    };
    const parsed = parseConfigFromYaml(`# ${CONFIG_MARKER}\n# ${JSON.stringify(stored)}\n`);
    const yaml = generateYaml(parsed);
    assert.equal(parsed.board.module, boardType);
    assert.equal(parsed.board.boardType, undefined);
    assert.match(yaml, /variant: esp32\n/);
    assert.doesNotMatch(yaml, /"boardType"/);
  }

  const s3 = {
    board: {
      name: "my-first-board",
      boardType: "esp32-s3-devkitc-1",
      wifiSsid: "layout-wifi",
      wifiPassword: "s3cret",
      mqttBroker: "192.168.1.50",
      otaPassword: "ota-pass",
    },
    blocks: [],
    points: [],
  };
  const parsed = parseConfigFromYaml(`# ${CONFIG_MARKER}\n# ${JSON.stringify(s3)}\n`);
  const yaml = generateYaml(parsed);
  assert.match(yaml, /variant: esp32s3/);
  const { warnings } = validateConfig(parsed);
  assert.ok(warnings.some((warning) => /ESP32-S3/.test(warning)));
});

test("panel buttons use pull-up pins, and GPIO34 is rejected", () => {
  const config = withCreds(myFirstBoardPreset());
  config.points[0].controls = [
    { action: "toggle", buttonPin: "GPIO4", closedLight: "GPIO16", openLight: "GPIO13" },
    { action: "closed", buttonPin: "GPIO5", closedLight: "", openLight: "" },
  ];
  const yaml = generateYaml(config);
  assert.match(yaml, /number: GPIO4/);
  assert.match(yaml, /number: GPIO5/);
  assert.match(yaml, /pullup: true/);
  assert.match(yaml, /inverted: true/);
  assert.match(yaml, /delayed_on_off: 50ms/);
  assert.match(yaml, /internal: true/);
  assert.match(yaml, /pin: GPIO13/);
  assert.match(yaml, /pin: GPIO16/);
  const scripts = yaml.slice(yaml.indexOf("\nscript:\n"));
  const closedScript = scripts.slice(scripts.indexOf("id: kiama_up_loop_throw_closed"), scripts.indexOf("id: kiama_up_loop_throw_thrown"));
  const thrownScript = scripts.slice(scripts.indexOf("id: kiama_up_loop_throw_thrown"));
  assert.match(closedScript, /switch.turn_on: kiama_up_loop_closed_light_1/);
  assert.match(closedScript, /switch.turn_off: kiama_up_loop_open_light_1/);
  assert.match(thrownScript, /switch.turn_off: kiama_up_loop_closed_light_1/);
  assert.match(thrownScript, /switch.turn_on: kiama_up_loop_open_light_1/);
  assert.match(yaml, /throw_closed/);
  assert.match(yaml, /throw_thrown/);
  assert.match(yaml, /announce: true/);
  assert.doesNotMatch(yaml, /number: GPIO34/);

  config.points[0].controls = [{ action: "toggle", buttonPin: "GPIO34", closedLight: "", openLight: "" }];
  const rejected = validateConfig(config);
  assert.ok(rejected.errors.some((error) => error.includes("GPIO34")));

  config.points[0].controls = [{ action: "toggle", buttonPin: "GPIO4", closedLight: "", openLight: "GPIO4" }];
  const shared = validateConfig(config);
  assert.ok(shared.errors.some((error) => /both the button and a light/.test(error)));

  config.points[0].controls = [{ action: "toggle", buttonPin: "GPIO4", lightPin: "GPIO13", lightOn: "closed" }];
  const migrated = generateYaml(config);
  const restored = JSON.parse(JSON.stringify(parseConfigFromYaml(migrated).points[0].controls[0]));
  assert.equal(restored.closedLight, "GPIO13");
  assert.equal(restored.openLight, "");
  assert.equal(restored.lightPin, undefined);
});

test("hotspot is always on, and generated passwords are three words", () => {
  const config = withCreds(myFirstBoardPreset());
  config.board.fallbackHotspot = false;
  config.board.apPassword = "hotspot123";
  const yaml = generateYaml(config);
  assert.match(yaml, /captive_portal:/);
  assert.match(yaml, /ssid: "my-first-board setup"/);
  assert.match(yaml, /password: hotspot123/);
  assert.equal(config.board.fallbackHotspot, undefined);
  assert.doesNotMatch(yaml, /reboot_timeout: 15min/);

  for (let i = 0; i < 20; i += 1) {
    const password = generatePassword();
    assert.match(password, /^[A-Z][a-z]+[A-Z][a-z]+[A-Z][a-z]+$/);
    assert.ok(password.length >= 8 && password.length <= 63, password);
  }
});

test("boot does not publish a hardcoded CLOSED, and on_connect publishes the latest state", () => {
  const config = withCreds(myFirstBoardPreset());
  const yaml = generateYaml(config);
  const boot = yaml.slice(yaml.indexOf("on_boot:"), yaml.indexOf("\nesp32:"));
  assert.doesNotMatch(boot, /mqtt\.publish/);
  assert.doesNotMatch(boot, /CLOSED/);
  assert.match(boot, /announce: false/);
  assert.doesNotMatch(yaml, /priority: -50/);
  assert.match(yaml, /on_connect:/);
  assert.match(yaml, /return id\(kiama_up_xover_sensor\)\.state \? "ACTIVE" : "INACTIVE";/);
  assert.match(yaml, /return id\(kiama_up_loop_thrown\) \? "THROWN" : "CLOSED";/);
  assert.match(yaml, /restore_value: true/);
  assert.match(yaml, /id: kiama_up_loop_thrown/);
  assert.doesNotMatch(yaml, /payload: 'CLOSED'/);

  const blocksOnly = withCreds(myFirstBoardPreset());
  blocksOnly.points = [];
  const blocksYaml = generateYaml(blocksOnly);
  assert.doesNotMatch(blocksYaml, /on_boot:/);
  assert.match(blocksYaml, /on_connect:/);
  assert.doesNotMatch(blocksYaml, /web_server:/);
});

test("the API key is written into the YAML and kept across a download", () => {
  const config = withCreds(myFirstBoardPreset());
  delete config.board.apiKey;
  config.board.apiEnabled = false;
  config.board.otaPassword = "left-out";
  const yaml = generateYaml(config);
  assert.match(yaml, /^api:\n  encryption:\n    key: "[A-Za-z0-9+/]{43}="\n  reboot_timeout: 0s\n/m);
  assert.match(yaml, /^ota:\n  - platform: esphome\n    encryption:\n/m);
  assert.doesNotMatch(yaml, /left-out/);
  assert.equal(config.board.apiEnabled, undefined);
  assert.equal(config.board.otaPassword, undefined);
  assert.match(config.board.apiKey, /^[A-Za-z0-9+/]{43}=$/);
  assert.equal((yaml.match(/reboot_timeout: 0s/g) || []).length, 2);

  const again = generateYaml(config);
  assert.ok(again.includes(`key: ${JSON.stringify(config.board.apiKey)}`));
});

test("disabling MQTT drops the broker and every JMRI topic", () => {
  const config = withCreds(myFirstBoardPreset());
  config.board.mqttEnabled = false;
  config.board.mqttBroker = "";
  const yaml = generateYaml(config);
  assert.equal(config.board.mqttEnabled, false);
  assert.doesNotMatch(yaml, /^mqtt:/m);
  assert.doesNotMatch(yaml, /mqtt\.publish/);
  assert.doesNotMatch(yaml, /mqtt_subscribe/);
  assert.match(yaml, /Kiama\/Up XOver \| OCCUPIED/);
  assert.match(yaml, /^api:\n/m);
  assert.equal((yaml.match(/reboot_timeout: 0s/g) || []).length, 1);
  assert.equal(validateConfig(config).warnings.some((warning) => warning.includes("MQTT address")), false);

  const restored = parseConfigFromYaml(yaml);
  assert.equal(restored.board.mqttEnabled, false);
});

test("direct PWM servos skip the PCA9685", () => {
  const config = withCreds(myFirstBoardPreset());
  config.pca9685 = false;
  config.points[0].servoPin = "GPIO18";
  const yaml = generateYaml(config);
  assert.match(yaml, /platform: ledc\n    id: kiama_up_loop_output\n    pin: GPIO18\n    frequency: 50Hz/);
  assert.doesNotMatch(yaml, /^pca9685:/m);
  assert.doesNotMatch(yaml, /^i2c:/m);
  assert.equal(validateConfig(config).warnings.some((warning) => warning.includes("external 5V")), false);

  config.points[0].servoPin = "GPIO34";
  const blocked = validateConfig(config);
  assert.ok(blocked.errors.some((error) => error.includes("input only")));

  config.points[0].servoPin = "GPIO18";
  for (const [name, pin] of [["Yard", "GPIO19"], ["Loop", "GPIO23"], ["Spur", "GPIO25"], ["Siding", "GPIO26"]]) {
    config.points.push({
      name,
      topic: `trains/track/turnout/${name}`,
      channel: 0,
      servoPin: pin,
      travelTime: "10s",
      controls: [],
    });
  }
  const { warnings } = validateConfig(config);
  assert.ok(warnings.some((warning) => warning.includes("external 5V")));

  const restored = parseConfigFromYaml(generateYaml(config));
  assert.equal(restored.pca9685, false);
  assert.equal(restored.points[0].servoPin, "GPIO18");
});

console.log("\nAll generator tests passed.");
