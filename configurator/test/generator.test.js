import assert from "node:assert/strict";
import { loadModules, test } from "./harness.js";

const context = loadModules("generator.js", "logic-yaml.js");

const {
  CONFIG_MARKER,
  MIN_ESPHOME_VERSION,
  generatePassword,
  generateYaml,
  generateJmriXml,
  myFirstBoardPreset,
  normalizeConfig,
  parseConfigFromYaml,
  topicFor,
  thrownTopic,
  lockTopic,
  lockedTopic,
  STRAPPING_PINS,
  uniqueIds,
  validateConfig,
} = context.EsphomeMr;

function withCreds(config) {
  config.board.wifiSsid = "layout-wifi";
  config.board.wifiPassword = "s3cret";
  config.board.mqttBroker = "192.168.1.50";
  return config;
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
  assert.deepEqual(JSON.parse(JSON.stringify(config.pcaBoards)), [{ sda: "GPIO21", scl: "GPIO22" }]);
  assert.equal(config.board.mqttBroker, "layout-mqtt.local");
  assert.match(generateYaml(config), /broker: layout-mqtt\.local/);
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
  assert.match(yaml, /topic_prefix: null/);
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
  assert.match(yaml, /web_server:\n  local: true\n  ota: false/);
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
  assert.deepEqual(restored.pcaBoards, config.pcaBoards);
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

test("topic follows the name and the position report is a sensor beside the turnout", () => {
  assert.equal(topicFor("point", "Kiama/Up Loop"), "trains/track/turnout/Kiama/Up Loop");
  assert.equal(topicFor("block", "Kiama/Up XOver"), "trains/track/sensor/Kiama/Up XOver");
  const config = myFirstBoardPreset();
  config.board.wifiSsid = "x";
  config.board.wifiPassword = "y";
  config.board.mqttBroker = "1.2.3.4";
  config.board.otaPassword = "z";
  const yaml = generateYaml(config);
  assert.match(yaml, /topic: "trains\/track\/sensor\/Kiama\/Up Loop\/Thrown"/);
  assert.doesNotMatch(yaml, /\/State"/);
  assert.equal(thrownTopic(config.points[0].topic), "trains/track/sensor/Kiama/Up Loop/Thrown");
  assert.equal(thrownTopic("track/turnout/Yard/"), "track/sensor/Yard/Thrown");
  assert.equal(thrownTopic("layout/custom/thing"), "layout/custom/thing/Thrown");
  assert.equal(lockTopic(config.points[0].topic), "trains/track/turnout/Kiama/Up Loop/Lock");
  assert.doesNotMatch(yaml, /\/Lock/);
});

test("remote lock holds a turnout until UNLOCKED, and the default is only the boot value", () => {
  const config = withCreds(myFirstBoardPreset());
  config.points[0].controls = [
    { action: "toggle", buttonPin: "GPIO4", closedLight: "", openLight: "" },
  ];
  config.points.push({
    name: "Yard",
    topic: "trains/track/turnout/Yard",
    channel: 1,
    travelTime: "10s",
    controls: [{ action: "toggle", buttonPin: "GPIO18", closedLight: "", openLight: "" }],
  });
  config.points[0].lockEnabled = true;
  config.points[0].lockDefault = "locked";
  const yaml = generateYaml(config);
  assert.match(yaml, /id: kiama_up_loop_locked\n    type: bool\n    restore_value: false\n    initial_value: "true"/);
  assert.doesNotMatch(yaml, /id: yard_locked/);
  assert.match(yaml, /topic: "trains\/track\/turnout\/Kiama\/Up Loop\/Lock"/);
  assert.doesNotMatch(yaml, /turnout\/Yard\/Lock/);
  assert.match(yaml, /state: 'LOCKED'/);
  assert.match(yaml, /state: 'UNLOCKED'/);
  assert.match(yaml, /Kiama\/Up Loop lock -> LOCKED/);
  // Push buttons have nothing to catch up with.
  assert.doesNotMatch(yaml, /was_locked/);
  assert.match(yaml, /- lambda: 'id\(kiama_up_loop_locked\) = false;'/);
  assert.match(yaml, /name: "Kiama - Up Loop lock"/);

  const kiamaButton = yaml.slice(yaml.indexOf("number: GPIO4"), yaml.indexOf("number: GPIO18"));
  const yardButton = yaml.slice(yaml.indexOf("number: GPIO18"), yaml.indexOf("\nnumber:\n"));
  assert.match(kiamaButton, /return !id\(kiama_up_loop_locked\);/);
  assert.doesNotMatch(yardButton, /_locked/);

  const commands = yaml.slice(yaml.indexOf("\ntext_sensor:\n"));
  const kiamaCommand = commands.slice(commands.indexOf("id: kiama_up_loop\n"), commands.indexOf("id: kiama_up_loop_lock"));
  const yardCommand = commands.slice(commands.indexOf("id: yard\n"));
  assert.match(kiamaCommand, /return !id\(kiama_up_loop_locked\);/);
  assert.equal((kiamaCommand.match(/return !id\(kiama_up_loop_locked\);/g) || []).length, 2);
  assert.doesNotMatch(yardCommand, /_locked/);

  const boot = yaml.slice(yaml.indexOf("on_boot:"), yaml.indexOf("\nesp32:"));
  assert.doesNotMatch(boot, /_locked/);
  assert.match(boot, /throw_closed/);

  const restored = parseConfigFromYaml(yaml);
  assert.equal(restored.points[0].lockEnabled, true);
  assert.equal(restored.points[0].lockDefault, "locked");
  assert.equal(restored.points[1].lockEnabled, false);
  assert.equal(restored.points[1].lockDefault, "unlocked");

  config.points[0].lockDefault = "unlocked";
  const unlocked = generateYaml(config);
  assert.match(unlocked, /initial_value: "false"/);

  config.board.mqttEnabled = false;
  const silent = generateYaml(config);
  assert.doesNotMatch(silent, /_locked/);
  assert.doesNotMatch(silent, /\/Lock/);

  const old = myFirstBoardPreset();
  const parsed = parseConfigFromYaml(`# ${CONFIG_MARKER}\n# ${JSON.stringify(old)}\n`);
  normalizeConfig(parsed);
  assert.equal(parsed.points[0].lockEnabled, false);
  assert.equal(parsed.points[0].lockDefault, "unlocked");
});

test("a locked turnout reports its lock as a JMRI sensor", () => {
  assert.equal(lockedTopic("trains/track/turnout/Kiama/Up Loop"), "trains/track/sensor/Kiama/Up Loop/Locked");
  assert.equal(lockedTopic("track/turnout/Yard/"), "track/sensor/Yard/Locked");
  assert.equal(lockedTopic("layout/custom/thing"), "layout/custom/thing/Locked");

  const config = withCreds(myFirstBoardPreset());
  config.points.push({
    name: "Yard",
    topic: "trains/track/turnout/Yard",
    channel: 1,
    travelTime: "10s",
    controls: [],
  });
  config.points[0].lockEnabled = true;
  const yaml = generateYaml(config);
  const report = /- mqtt\.publish:\n\s+topic: "trains\/track\/sensor\/Kiama\/Up Loop\/Locked"\n\s+payload: !lambda \|-\n\s+return id\(kiama_up_loop_locked\) \? "ACTIVE" : "INACTIVE";\n\s+retain: true\n\s+qos: 2/;

  // On connect, and after both LOCKED and UNLOCKED.
  const connect = yaml.slice(yaml.indexOf("  on_connect:"), yaml.indexOf("\nbutton:"));
  assert.match(connect, report);
  const lock = yaml.slice(yaml.indexOf("id: kiama_up_loop_lock\n"));
  assert.match(lock.slice(0, lock.indexOf("state: 'UNLOCKED'")), report);
  assert.match(lock.slice(lock.indexOf("state: 'UNLOCKED'")), report);
  assert.equal((yaml.match(/\/Locked"/g) || []).length, 3);
  assert.doesNotMatch(yaml, /Yard\/Locked/);

  const { xml, counts } = generateJmriXml(config);
  assert.match(xml, /<systemName>MSKiama\/Up Loop\/Locked<\/systemName>/);
  assert.doesNotMatch(xml, /MSYard\/Locked/);
  // The block, both position reports, and the one lock report.
  assert.equal(counts.sensors, 4);

  // A real sensor cannot sit on the report topic.
  config.blocks.push({ name: "Kiama/Up Loop/Locked", topic: topicFor("block", "Kiama/Up Loop/Locked"), gpio: "GPIO27" });
  assert.ok(validateConfig(config).errors.some((error) => /where turnout "Kiama\/Up Loop" reports its lock/.test(error)));
  config.points[0].lockEnabled = false;
  assert.ok(!validateConfig(config).errors.some((error) => /reports its lock/.test(error)));

  // Nor on the position report.
  config.blocks.push({ name: "Yard/Thrown", topic: topicFor("block", "Yard/Thrown"), gpio: "GPIO26" });
  assert.ok(validateConfig(config).errors.some((error) => /where turnout "Yard" reports its position/.test(error)));
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
  const closedAt = scripts.indexOf("\n  - id: kiama_up_loop_throw_closed");
  const thrownAt = scripts.indexOf("\n  - id: kiama_up_loop_throw_thrown");
  const closedScript = scripts.slice(closedAt, thrownAt);
  const thrownScript = scripts.slice(thrownAt);
  assert.match(closedScript, /switch.turn_on: kiama_up_loop_closed_light_1/);
  assert.match(closedScript, /switch.turn_off: kiama_up_loop_open_light_1/);
  assert.match(closedScript, /delay: 2s/);
  assert.match(closedScript, /_servo_endpoint_normal_backoff/);
  assert.match(thrownScript, /switch.turn_off: kiama_up_loop_closed_light_1/);
  assert.match(thrownScript, /switch.turn_on: kiama_up_loop_open_light_1/);
  assert.match(thrownScript, /delay: 2s/);
  assert.match(thrownScript, /_servo_endpoint_reverse_backoff/);
  assert.match(yaml, /throw_closed/);
  assert.match(yaml, /throw_thrown/);
  assert.match(yaml, /announce: true/);
  assert.equal((yaml.match(/script\.is_running:/g) || []).length, 4);
  const buttons = yaml.slice(yaml.indexOf("\nbinary_sensor:\n"), yaml.indexOf("\nnumber:\n"));
  const toggleAt = buttons.indexOf("\n  - platform: gpio\n    pin:\n      number: GPIO4\n");
  const closedAtButton = buttons.indexOf("\n  - platform: gpio\n    pin:\n      number: GPIO5\n");
  const toggleButton = buttons.slice(toggleAt, closedAtButton);
  const closedButton = buttons.slice(closedAtButton);
  for (const button of [toggleButton, closedButton]) {
    assert.match(button, /script\.is_running:\n\s+id: kiama_up_loop_throw_closed/);
    assert.match(button, /script\.is_running:\n\s+id: kiama_up_loop_throw_thrown/);
  }
  assert.match(toggleButton, /lambda: 'return id\(kiama_up_loop_thrown\);'/);
  assert.match(closedButton, /throw_closed/);
  assert.doesNotMatch(closedButton, /lambda: 'return id\(kiama_up_loop_thrown\);'/);
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

test("a latched switch sets the point from the pin, waits for a throw, and wins at boot", () => {
  const config = withCreds(myFirstBoardPreset());
  config.points[0].lockEnabled = true;
  config.points[0].controls = [
    { action: "latch-thrown", buttonPin: "GPIO4", closedLight: "GPIO16", openLight: "GPIO13" },
  ];
  const yaml = generateYaml(config);
  const buttons = yaml.slice(yaml.indexOf("\nbinary_sensor:\n"), yaml.indexOf("\nnumber:\n"));
  const button = buttons.slice(buttons.indexOf("number: GPIO4"));
  assert.match(button, /pullup: true/);
  assert.match(button, /on_state:\n\s+then:\n\s+- script.execute:\n\s+id: kiama_up_loop_latch_1\n\s+force: false/);
  assert.doesNotMatch(button, /on_press/);

  const scripts = yaml.slice(yaml.indexOf("\nscript:\n"));
  const latch = scripts.slice(scripts.indexOf("\n  - id: kiama_up_loop_latch_1"));
  assert.match(latch, /mode: queued/);
  assert.match(latch, /has_state\(\) && !id\(kiama_up_loop_throw_closed\)\.is_running\(\) && !id\(kiama_up_loop_throw_thrown\)\.is_running\(\)/);
  assert.match(latch, /bool want = id\(kiama_up_loop_button_1\)\.state;/);
  assert.match(latch, /if \(id\(kiama_up_loop_locked\)\) want = id\(kiama_up_loop_thrown\);/);
  assert.match(latch, /if \(want\) id\(kiama_up_loop_throw_thrown\)\.execute\(moving\);/);

  // Unlocking makes the point catch up with a switch moved while locked.
  const unlock = yaml.slice(yaml.indexOf("state: 'UNLOCKED'"));
  assert.match(unlock, /bool was_locked = id\(kiama_up_loop_locked\);\n\s+id\(kiama_up_loop_locked\) = false;\n\s+if \(was_locked\) id\(kiama_up_loop_latch_1\)\.execute\(false\);/);

  const boot = yaml.slice(yaml.indexOf("priority: -200.0"), yaml.indexOf("\nwifi:"));
  assert.match(boot, /id: kiama_up_loop_latch_1\n\s+force: true/);
  assert.doesNotMatch(boot.split("\n    - priority")[0], /announce: false/);

  config.points[0].controls[0].action = "latch-closed";
  config.points[0].lockEnabled = false;
  const closedYaml = generateYaml(config);
  assert.match(closedYaml, /bool want = !id\(kiama_up_loop_button_1\)\.state;/);
  assert.doesNotMatch(closedYaml, /_locked/);

  const restored = JSON.parse(JSON.stringify(parseConfigFromYaml(closedYaml).points[0].controls[0]));
  assert.equal(restored.action, "latch-closed");

  config.points[0].controls.push({ action: "latch-thrown", buttonPin: "GPIO5", closedLight: "", openLight: "" });
  const twice = validateConfig(config);
  assert.ok(twice.errors.some((error) => /2 latched switches/.test(error)));
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

test("the saved turnout position is written immediately and applied on boot", () => {
  const config = withCreds(myFirstBoardPreset());
  config.points.push({
    name: "Yard",
    topic: "trains/track/turnout/Yard",
    channel: 1,
    travelTime: "10s",
    controls: [],
  });
  const yaml = generateYaml(config);
  const boot = yaml.slice(yaml.indexOf("on_boot:"), yaml.indexOf("\nesp32:"));
  assert.match(boot, /priority: 600/);
  assert.match(boot, /esphome::random_uint32\(\) % 5000/);
  assert.match(boot, /App\.feed_wdt\(\)/);
  assert.match(boot, /priority: -200/);
  assert.match(boot, /return id\(kiama_up_loop_thrown\);/);
  assert.match(boot, /return id\(yard_thrown\);/);
  assert.match(boot, /throw_thrown/);
  assert.match(boot, /throw_closed/);
  assert.match(boot, /announce: false/);
  assert.equal((boot.match(/return 200 \+ \(esphome::random_uint32\(\) % 800\);/g) || []).length, 2);
  assert.doesNotMatch(boot, /mqtt\.publish/);
  assert.doesNotMatch(yaml, /priority: -50/);
  assert.doesNotMatch(yaml, /on_message:/);
  assert.doesNotMatch(yaml, /restore_turnouts/);

  const mqtt = yaml.slice(yaml.indexOf("\nmqtt:\n"), yaml.indexOf("\nbutton:\n"));
  assert.match(mqtt, /on_connect:/);
  assert.match(mqtt, /return id\(kiama_up_xover_sensor\)\.state \? "ACTIVE" : "INACTIVE";/);
  assert.match(mqtt, /retain: false/);
  assert.match(mqtt, /return id\(kiama_up_loop_thrown\) \? "ACTIVE" : "INACTIVE";/);
  assert.match(mqtt, /return id\(yard_thrown\) \? "ACTIVE" : "INACTIVE";/);
  assert.match(mqtt, /topic: "trains\/track\/sensor\/Kiama\/Up Loop\/Thrown"\n        payload: !lambda \|-\n          return id\(kiama_up_loop_thrown\) \? "ACTIVE" : "INACTIVE";\n        retain: true/);

  const thrown = yaml.slice(yaml.indexOf("id: kiama_up_loop_thrown"), yaml.indexOf("id: yard_thrown"));
  assert.match(thrown, /type: bool/);
  assert.match(thrown, /restore_value: true/);
  assert.match(thrown, /initial_value: "false"/);

  const scripts = yaml.slice(yaml.indexOf("\nscript:\n"));
  const closed = scripts.slice(scripts.indexOf("\n  - id: kiama_up_loop_throw_closed"), scripts.indexOf("\n  - id: kiama_up_loop_throw_thrown"));
  assert.match(closed, /id\(kiama_up_loop_thrown\) = false;/);
  assert.match(closed, /kiama_up_loop_thrown->update\(\);/);
  assert.match(closed, /global_preferences->sync\(\);/);
  assert.match(closed, /topic: "trains\/track\/sensor\/Kiama\/Up Loop\/Thrown"\n\s+payload: "INACTIVE"/);
  assert.match(closed, /retain: true/);
  assert.match(closed, /qos: 2/);
  const thrownScript = scripts.slice(scripts.indexOf("\n  - id: kiama_up_loop_throw_thrown"), scripts.indexOf("\n  - id: yard_throw_closed"));
  assert.match(thrownScript, /id\(kiama_up_loop_thrown\) = true;/);
  assert.match(thrownScript, /topic: "trains\/track\/sensor\/Kiama\/Up Loop\/Thrown"\n\s+payload: "ACTIVE"/);
  assert.match(thrownScript, /retain: true/);

  const blocksOnly = withCreds(myFirstBoardPreset());
  blocksOnly.points = [];
  const blocksYaml = generateYaml(blocksOnly);
  assert.match(blocksYaml, /priority: 600/);
  assert.doesNotMatch(blocksYaml, /priority: -200/);
  assert.doesNotMatch(blocksYaml, /announce: false/);
  assert.doesNotMatch(blocksYaml, /global_preferences->sync/);
  assert.match(blocksYaml, /on_connect:/);
  assert.match(blocksYaml, /retain: false/);
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
  assert.doesNotMatch(yaml, /retain: true/);
  assert.match(yaml, /kiama_up_loop_thrown->update\(\);/);
  assert.match(yaml, /global_preferences->sync\(\);/);
  const boot = yaml.slice(yaml.indexOf("on_boot:"), yaml.indexOf("\nesp32:"));
  assert.match(boot, /throw_closed/);
  assert.match(boot, /announce: false/);
  assert.doesNotMatch(boot, /% 800/);
  const stored = yaml.slice(yaml.indexOf("id: kiama_up_loop_thrown"), yaml.indexOf("id: kiama_up_loop_thrown") + 120);
  assert.match(stored, /restore_value: true/);
  assert.match(yaml, /Kiama\/Up XOver \| OCCUPIED/);
  assert.match(yaml, /^api:\n/m);
  assert.equal((yaml.match(/reboot_timeout: 0s/g) || []).length, 1);
  assert.equal(validateConfig(config).warnings.some((warning) => warning.includes("MQTT address")), false);

  const restored = parseConfigFromYaml(yaml);
  assert.equal(restored.board.mqttEnabled, false);
});

test("a block can use an input-only pin", () => {
  const config = withCreds(myFirstBoardPreset());
  config.blocks[0].gpio = "gpio34";
  normalizeConfig(config);
  assert.equal(config.blocks[0].gpio, "GPIO34");
  const ok = validateConfig(config);
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.warnings.some((warning) => warning.includes("strapping")), false);

  config.blocks[0].gpio = "GPIO6";
  const bad = validateConfig(config);
  assert.ok(bad.errors.some((error) => error.includes("flash")));
});

test("strapping pins are flagged and still allowed", () => {
  assert.deepEqual([...STRAPPING_PINS], ["GPIO0", "GPIO2", "GPIO5", "GPIO12", "GPIO15"]);

  const config = withCreds(myFirstBoardPreset());
  config.pca9685 = false;
  config.points[0].servoPin = "GPIO5";
  const flagged = validateConfig(config);
  assert.equal(flagged.errors.length, 0);
  assert.ok(flagged.warnings.some((warning) => warning.includes("GPIO5 is a strapping pin")));

  config.points[0].servoPin = "GPIO18";
  assert.equal(validateConfig(config).warnings.some((warning) => warning.includes("strapping")), false);
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

function signalMast(name, start, lamps, aspects) {
  return {
    name,
    topic: `trains/track/signalmast/${name}`,
    topicCustom: true,
    start,
    lamps,
    aspects,
  };
}

test("signal mast round-trips and drives the strip", () => {
  const config = withCreds(myFirstBoardPreset());
  config.points = [];
  config.blocks = [];
  config.signals = {
    mode: "addressable",
    pin: "GPIO16",
    numLeds: 8,
    masts: [
      signalMast("KJN-42.26", 0, [
        { name: "Marker", count: 1 },
        { name: "Upper", count: 1 },
        { name: "Middle", count: 1 },
        { name: "Lower", count: 1 },
        { name: "Route", count: 1 },
      ], [
        {
          label: "Stop",
          states: ["R292; Lit; Unheld"],
          lamps: [
            { color: "off", mode: "steady" },
            { color: "red", mode: "steady" },
            { color: "red", mode: "steady" },
            { color: "off", mode: "steady" },
            { color: "off", mode: "steady" },
          ],
        },
        {
          label: "Caution",
          states: ["R288; Lit; Unheld"],
          lamps: [
            { color: "off", mode: "steady" },
            { color: "off", mode: "steady" },
            { color: "amber", mode: "steady" },
            { color: "off", mode: "steady" },
            { color: "off", mode: "steady" },
          ],
        },
        {
          label: "Medium",
          states: ["R283; Lit; Unheld", "R283A; Lit; Unheld"],
          lamps: [
            { color: "amber", mode: "blink" },
            { color: "off", mode: "steady" },
            { color: "green", mode: "steady" },
            { color: "white", mode: "steady" },
            { color: "amber", mode: "pulse" },
          ],
        },
      ]),
    ],
  };
  config.signals.masts[0].aspects[0].startup = true;
  config.signals.masts[0].aspects[2].startup = true;

  const yaml = generateYaml(config);
  const restored = parseConfigFromYaml(yaml);
  assert.equal(JSON.stringify(restored.signals), JSON.stringify(config.signals));
  assert.match(yaml, /platform: esp32_rmt_led_strip/);
  assert.match(yaml, /chipset: WS2812/);
  assert.match(yaml, /channel_colors: GRB/);
  assert.match(yaml, /topic: trains\/track\/signalmast\/KJN-42\.26/);
  assert.match(yaml, /color: 0xff0000/);
  assert.match(yaml, /color: 0xffc800/);
  assert.match(yaml, /color: 0x1fff87/);
  assert.match(yaml, /color: 0xffffff/);
  assert.match(yaml, /addressable_lambda:/);
  assert.match(yaml, /id: signal_blink_bright/);
  assert.match(yaml, /name: "Signal - Blink - Brightness"/);
  assert.match(yaml, /initial_value: 44\.6/);
  assert.equal((yaml.match(/initial_value: 44\.6/g) || []).length, 1);
  assert.match(yaml, /id: signal_blink_bright\n {4}min_value: 0\.1\n {4}max_value: 100\n {4}initial_value: 66\.6/);
  assert.match(yaml, /const float level = elapsed < on_ms \? id\(signal_blink_bright\)\.state \/ 100\.0f : 0\.0f;/);
  assert.match(yaml, /id: signal_blink_lit/);
  assert.match(yaml, /name: "Signal - Blink - On"/);
  assert.match(yaml, /min_value: 0\.1\n {4}max_value: 5\n {4}initial_value: 0\.6/);
  assert.match(yaml, /id: signal_blink_dark/);
  assert.match(yaml, /name: "Signal - Blink - Off"/);
  assert.match(yaml, /min_value: 0\.1\n {4}max_value: 5\n {4}initial_value: 0\.2/);
  assert.match(yaml, /id: signal_pulse_span/);
  assert.match(yaml, /name: "Signal - Pulse - Rate"/);
  assert.match(yaml, /min_value: 0\.1\n {4}max_value: 10\n {4}initial_value: 0\.5/);
  assert.match(yaml, /id: signal_pulse_wait/);
  assert.match(yaml, /name: "Signal - Pulse - Gap"/);
  assert.match(yaml, /min_value: 0\.1\n {4}max_value: 5\n {4}initial_value: 0\.3/);
  assert.match(yaml, /else if \(t >= half \+ pause_s\)/);
  assert.match(yaml, /it\[i\] = px;/);
  assert.doesNotMatch(yaml, /id: signal_rate\b/);
  assert.doesNotMatch(yaml, /cosf/);
  assert.doesNotMatch(yaml, /0\.12f/);
  assert.match(yaml, /id: signal_steady_bright/);
  assert.match(yaml, /name: "Signal - Brightness"/);
  assert.match(yaml, /id: signal_pulse_peak/);
  assert.match(yaml, /name: "Signal - Pulse - Brightness"/);
  assert.match(yaml, /id: signal_pulse_peak\n {4}min_value: 0\.1\n {4}max_value: 100\n {4}initial_value: 88\.5/);
  assert.match(yaml, /const float level = \(id\(signal_pulse_peak\)\.state \/ 100\.0f\) \* wave;/);
  assert.match(yaml, /color_brightness: !lambda 'return id\(signal_steady_bright\)\.state \/ 100\.0;'/);
  assert.doesNotMatch(yaml, /color: 0x000000\n {16}color_brightness:/);
  assert.doesNotMatch(yaml, /kjn_42_26_brightness/);
  assert.match(yaml, /priority: -150\.0/);
  assert.match(yaml, /id: kjn_42_26_aspect\n            value: '0'/);
  assert.equal(restored.signals.masts[0].aspects.filter((aspect) => aspect.startup).length, 1);
  assert.equal(restored.signals.masts[0].aspects[0].startup, true);
  assert.match(yaml, /restart_effects: true/);
  assert.match(yaml, /restart_effects: false/);
  assert.match(yaml, /web_server:\n  local: true\n  ota: false/);
  assert.equal(yaml.split("\n").filter((line) => line === "number:").length, 1);
  assert.equal(yaml.split("\n").filter((line) => line === "script:").length, 1);
  assert.equal(yaml.split("\n").filter((line) => line === "globals:").length, 1);
  assert.match(yaml, /platform: partition/);
  assert.doesNotMatch(yaml, /range_from: 0\n/);
  assert.doesNotMatch(yaml, /range_from: 4\n/);
  assert.match(yaml, /from: 0\n/);
  assert.match(yaml, /from: 4\n/);
  assert.match(yaml, /num_leds: 5/);

  config.signals.masts[0].lamps[4].count = 3;
  const wider = generateYaml(config);
  assert.match(wider, /num_leds: 7/);
  assert.equal(config.signals.masts[0].lamps[4].count, 3);
});

test("a file with no signals key still imports", () => {
  const stored = {
    board: {
      name: "my-first-board",
      module: "nodemcu-32s",
      wifiSsid: "layout-wifi",
      wifiPassword: "s3cret",
      mqttBroker: "192.168.1.50",
    },
    blocks: [],
    points: [],
    i2c: { sda: "GPIO21", scl: "GPIO22" },
  };
  const parsed = parseConfigFromYaml(`# ${CONFIG_MARKER}\n# ${JSON.stringify(stored)}\n`);
  assert.equal(parsed.signals, undefined);
  context.EsphomeMr.normalizeConfig(parsed);
  assert.equal(parsed.signals.masts.length, 0);
  assert.doesNotMatch(generateYaml(parsed), /esp32_rmt_led_strip/);
});

test("a short strip and a shared data pin fail validation", () => {
  const config = withCreds(myFirstBoardPreset());
  config.points = [];
  config.blocks = [{
    name: "Kiama/Up XOver",
    topic: "trains/track/sensor/Kiama/Up XOver",
    gpio: "GPIO16",
    inverted: true,
    debounce: "500ms",
  }];
  config.signals = {
    mode: "addressable",
    pin: "GPIO16",
    numLeds: 4,
    masts: [
      signalMast("A", 0, [{ name: "Lamp", count: 2 }], [{
        label: "Stop",
        states: ["R292; Lit; Unheld"],
        lamps: [{ color: "red", mode: "steady" }],
      }]),
      signalMast("B", 0, [{ name: "Lamp", count: 5 }], [{
        label: "Stop",
        states: [" "],
        lamps: [{ color: "red", mode: "steady" }],
      }]),
    ],
  };
  const { errors, warnings } = validateConfig(config);
  assert.ok(errors.some((error) => error.includes("GPIO16")));
  assert.ok(errors.some((error) => error.includes("needs a JMRI string")));

  config.blocks = [];
  config.signals.pin = "GPIO18";
  config.signals.masts = [
    signalMast("A", 0, [{ name: "Lamp", count: 1 }], [
      { label: "Stop", states: ["R292; Lit; Unheld"], lamps: [{ color: "red", mode: "steady" }] },
      { label: "Stop again", states: ["R292; Lit; Unheld"], lamps: [{ color: "red", mode: "steady" }] },
    ]),
  ];
  const again = validateConfig(config);
  assert.equal(again.errors.length, 0);
  assert.ok(again.warnings.some((warning) => warning.includes("R292; Lit; Unheld")));
  void warnings;
});

test("individual LEDs use one GPIO each", () => {
  const config = withCreds(myFirstBoardPreset());
  config.blocks = [];
  config.signals = {
    mode: "gpio",
    pin: "GPIO16",
    numLeds: 8,
    masts: [
      signalMast("Home", 9, [
        { name: "Red", count: 4, pin: "gpio18" },
        { name: "Green", count: 1, pin: "GPIO19" },
      ], [{
        label: "Stop",
        states: ["R292; Lit; Unheld"],
        lamps: [
          { color: "red", mode: "blink" },
          { color: "off", mode: "steady" },
        ],
      }]),
    ],
  };
  const yaml = generateYaml(config);
  const outputKeys = yaml.split("\n").filter((line) => line === "output:");
  assert.equal(outputKeys.length, 1);
  assert.match(yaml, /platform: ledc/);
  assert.match(yaml, /pin: GPIO18/);
  assert.match(yaml, /frequency: 1000Hz/);
  assert.match(yaml, /platform: monochromatic/);
  assert.match(yaml, /name: Blink/);
  assert.match(yaml, /effect: Blink/);
  assert.match(yaml, /id: signal_steady_bright/);
  assert.match(yaml, /id: signal_blink_lit/);
  assert.match(yaml, /id: signal_pulse_wait/);
  assert.doesNotMatch(yaml, /home_brightness/);
  assert.match(yaml, /- lambda:\n {10}name: Blink/);
  assert.equal(yaml.split("\n").filter((line) => line === "number:").length, 1);
  assert.equal(yaml.split("\n").filter((line) => line === "script:").length, 1);
  assert.match(yaml, /light.turn_off: home_lamp_1/);
  assert.doesNotMatch(yaml, /esp32_rmt_led_strip/);
  assert.equal(config.signals.masts[0].lamps[0].count, 1);
  assert.equal(config.signals.masts[0].mode, "gpio");
  assert.equal(config.signals.mode, undefined);

  config.points = [];
  config.signals.masts[0].lamps[1].pin = "GPIO18";
  const { errors } = validateConfig(config);
  assert.ok(errors.some((error) => error.includes("GPIO18")));
});

test("one PCA9685 keeps the single-bus YAML", () => {
  const yaml = generateYaml(withCreds(myFirstBoardPreset()));
  assert.match(yaml, /^i2c:\n  sda: GPIO21\n  scl: GPIO22\n  scan: true\n\npca9685:\n  frequency: 50Hz$/m);
  assert.doesNotMatch(yaml, /pca9685_id/);
});

test("two PCA9685 boards get their own I2C buses", () => {
  const config = withCreds(myFirstBoardPreset());
  config.pcaBoards.push({ sda: "GPIO25", scl: "GPIO26" });
  config.points.push({
    name: "Bombo/Siding",
    topic: "trains/track/turnout/Bombo/Siding",
    pcaBoard: 1,
    channel: 0,
    travelTime: "10s",
    controls: [],
  });
  const yaml = generateYaml(config);
  assert.match(yaml, /^i2c:\n  - id: i2c_1\n    sda: GPIO21\n    scl: GPIO22\n    scan: true\n  - id: i2c_2\n    sda: GPIO25\n    scl: GPIO26\n    scan: true$/m);
  assert.match(yaml, /^pca9685:\n  - id: pca9685_1\n    i2c_id: i2c_1\n    frequency: 50Hz\n  - id: pca9685_2\n    i2c_id: i2c_2\n    frequency: 50Hz$/m);
  assert.match(yaml, /id: kiama_up_loop_output\n    pca9685_id: pca9685_1\n    channel: 0/);
  assert.match(yaml, /id: bombo_siding_output\n    pca9685_id: pca9685_2\n    channel: 0/);

  // Channel 0 on each board is not a clash.
  const ok = validateConfig(config);
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.warnings.some((w) => w.includes("channel clash")), false);

  config.points[1].pcaBoard = 0;
  assert.ok(validateConfig(config).warnings.some((w) => w.includes("PCA9685 1 channel clash: 0")));
  config.points[1].pcaBoard = 1;

  config.pcaBoards[1] = { sda: "GPIO21", scl: "GPIO34" };
  const bad = validateConfig(config);
  assert.ok(bad.warnings.some((w) => w.includes("GPIO clash: GPIO21")));
  assert.ok(bad.errors.some((e) => e.includes("PCA9685 2 SCL pin GPIO34") && e.includes("cannot drive I2C")));
  config.pcaBoards[1] = { sda: "GPIO25", scl: "GPIO26" };

  const restored = parseConfigFromYaml(yaml);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.pcaBoards)), JSON.parse(JSON.stringify(config.pcaBoards)));
  assert.equal(restored.points[1].pcaBoard, 1);

  config.pcaBoards.push({ sda: "GPIO32", scl: "GPIO33" });
  assert.ok(validateConfig(config).errors.some((e) => e.includes("2 PCA9685 boards at most")));
});

test("old files with one i2c pair import as PCA9685 1", () => {
  const legacy = withCreds(myFirstBoardPreset());
  delete legacy.pcaBoards;
  legacy.i2c = { sda: "GPIO19", scl: "GPIO23" };
  legacy.points[0].pcaBoard = 3;
  normalizeConfig(legacy);
  assert.equal(legacy.i2c, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(legacy.pcaBoards)), [{ sda: "GPIO19", scl: "GPIO23" }]);
  assert.equal(legacy.points[0].pcaBoard, 0);
  assert.match(generateYaml(legacy), /^i2c:\n  sda: GPIO19\n  scl: GPIO23$/m);
});

test("JMRI XML lists sensors, turnouts, and signal masts as MQTT items", () => {
  const config = withCreds(myFirstBoardPreset());
  config.blocks.push({ name: "Yard & <Loop>", topic: topicFor("block", "Yard & <Loop>"), gpio: "GPIO27" });
  config.blocks.push({ name: "Custom", topic: "layout/custom/thing", gpio: "GPIO26" });
  config.signals.masts.push({ name: "Kiama/Up Home", topic: topicFor("signal", "Kiama/Up Home"), lamps: [], aspects: [] });
  config.signals.masts.push({ name: "Bad (mast)", topic: topicFor("signal", "Bad (mast)"), lamps: [], aspects: [] });
  const { xml, counts, skipped } = generateJmriXml(config);

  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<layout-config /);
  assert.match(xml, /<sensors class="jmri.jmrix.mqtt.configurexml.MqttSensorManagerXml">/);
  assert.match(xml, /<systemName>MSKiama\/Up XOver<\/systemName>/);
  assert.match(xml, /<systemName>MSYard &amp; &lt;Loop&gt;<\/systemName>/);
  assert.match(xml, /<turnouts class="jmri.jmrix.mqtt.configurexml.MqttTurnoutManagerXml">/);
  assert.match(xml, /<turnout feedback="ONESENSOR" sensor1="MSKiama\/Up Loop\/Thrown" inverted="false" automate="Default">\n      <systemName>MTKiama\/Up Loop<\/systemName>/);
  assert.match(xml, /<systemName>MSKiama\/Up Loop\/Thrown<\/systemName>/);
  assert.doesNotMatch(xml, /feedback="DIRECT"/);
  assert.match(xml, /<mqttsignalmast class="jmri.jmrix.mqtt.configurexml.MqttSignalMastXml">\n      <systemName>IF\$mqm:cats-masts:cats-virtual\(Kiama\/Up Home\)<\/systemName>\n      <userName>Kiama\/Up Home<\/userName>/);
  assert.match(xml, /MQTT Channel to be "trains\/"/);
  assert.doesNotMatch(xml, /Custom|Bad \(mast\)/);
  assert.deepEqual(JSON.parse(JSON.stringify(counts)), { sensors: 3, turnouts: 1, masts: 1, lights: 0 });
  assert.equal(skipped.length, 2);
  assert.ok(skipped[0].includes("Custom"));
  assert.ok(skipped[1].includes("Bad (mast)"));

  // An XML comment cannot hold "--".
  config.board.name = "my--board";
  assert.doesNotMatch(generateJmriXml(config).xml.split("\n")[2], /--.*--.*--/);

  // Tick boxes. A turnout keeps its own position sensor without the Sensors table.
  const mastsOnly = generateJmriXml(config, { sensors: false, turnouts: false });
  assert.deepEqual(JSON.parse(JSON.stringify(mastsOnly.counts)), { sensors: 0, turnouts: 0, masts: 1, lights: 0 });
  assert.doesNotMatch(mastsOnly.xml, /<sensors|<turnouts/);
  assert.match(mastsOnly.xml, /<signalmasts/);
  assert.deepEqual(JSON.parse(JSON.stringify(mastsOnly.skipped)), [skipped[1]]);
  const turnoutsOnly = generateJmriXml(config, { sensors: false, masts: false });
  assert.deepEqual(JSON.parse(JSON.stringify(turnoutsOnly.counts)), { sensors: 1, turnouts: 1, masts: 0, lights: 0 });
  assert.match(turnoutsOnly.xml, /<systemName>MSKiama\/Up Loop\/Thrown<\/systemName>/);
  assert.doesNotMatch(turnoutsOnly.xml, /MSKiama\/Up XOver|<signalmasts/);
  const none = generateJmriXml(config, { sensors: false, turnouts: false, masts: false });
  assert.deepEqual(JSON.parse(JSON.stringify(none.counts)), { sensors: 0, turnouts: 0, masts: 0, lights: 0 });

  config.board.mqttEnabled = false;
  const off = generateJmriXml(config);
  assert.deepEqual(JSON.parse(JSON.stringify(off.counts)), { sensors: 0, turnouts: 0, masts: 0, lights: 0 });
  assert.doesNotMatch(off.xml, /<sensors|<turnouts|<signalmasts/);
});

test("mast messages: exact match, then Unlit, Held, and the aspect name", () => {
  const config = withCreds(myFirstBoardPreset());
  config.points = [];
  config.blocks = [];
  const off = { color: "off", mode: "steady" };
  const red = { color: "red", mode: "steady" };
  const green = { color: "green", mode: "steady" };
  config.signals = {
    masts: [
      signalMast("Home", 0, [{ name: "Lamp", count: 1 }], [
        { label: "Clear", states: ["R281; Lit; Unheld"], lamps: [green] },
        { label: "Stop", states: ["R292; Lit; Unheld"], lamps: [red] },
        // A deliberate Held match must win over the Held rule.
        { label: "Held clear", states: ['R281 "x"; Lit; Held'], lamps: [green] },
      ]),
      signalMast("Shunt", 0, [{ name: "Lamp", count: 1 }], [
        { label: "On", states: ["Proceed; Lit; Unheld"], lamps: [green] },
      ]),
      signalMast("Empty", 0, [{ name: "Lamp", count: 1 }], [
        { label: "Nothing yet", states: [""], lamps: [off] },
      ]),
    ],
  };
  const yaml = generateYaml(config);
  const handler = (id) => {
    const start = yaml.indexOf(`    id: ${id}\n    internal: true`);
    return yaml.slice(start, yaml.indexOf("\n  - platform:", start + 1));
  };

  const home = handler("home");
  assert.match(home, /std::string name = x\.substr\(0, x\.find\(';'\)\);/);
  const order = [
    'if (x == "R281; Lit; Unheld") pick = 0;',
    'else if (x == "R292; Lit; Unheld") pick = 1;',
    'else if (x == "R281 \\"x\\"; Lit; Held") pick = 2;',
    "else if (unlit) pick = -2;",
    "else if (held) pick = 1;",
    'else if (name == "R281") pick = 0;',
    'else if (name == "R292") pick = 1;',
    'else if (name == "R281 \\"x\\"") pick = 2;',
    "if (pick == -1) return;",
    "id(home_aspect) = pick;",
    "id(home_show).execute(true);",
  ];
  let at = 0;
  for (const row of order) {
    const found = home.indexOf(row, at);
    assert.ok(found >= 0, `missing or out of order: ${row}`);
    at = found;
  }
  assert.doesNotMatch(home, /text_sensor\.state/);

  // No Stop aspect: Held goes dark rather than leaving the last aspect lit.
  assert.match(handler("shunt"), /else if \(held\) pick = -2;/);

  // A mast with nothing to show has no handler (and no aspect global to set).
  assert.doesNotMatch(handler("empty"), /on_value/);
  assert.doesNotMatch(yaml, /id: empty_aspect/);

  // The show script has a dark branch that turns every lamp off.
  const show = yaml.slice(yaml.indexOf("  - id: home_show"), yaml.indexOf("  - id: shunt_show"));
  assert.match(show, /lambda: 'return id\(home_aspect\) == -2;'/);
  assert.match(show, /Home \| Dark/);
});

if (!process.exitCode) console.log("\nAll generator tests passed.");
