// MCP23017 expanders on the Sensors page (field logic spec, More sensor pins).
// Work item 1.2.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

const {
  expanderPinLabel,
  generateJmriXml,
  generateYaml,
  i2cBuses,
  myFirstBoardPreset,
  normalizeConfig,
  parseConfigFromYaml,
  validateConfig,
} = loadModules("generator.js").EsphomeMr;

// Write the YAML each test builds here, for `esphome config` by hand:
// ESPHOME_YAML_OUT=/some/dir npm test
const yamlOut = process.env.ESPHOME_YAML_OUT;

function board(extra = {}) {
  const config = myFirstBoardPreset();
  config.board.wifiSsid = "layout-wifi";
  config.board.wifiPassword = "not-a-real-password";
  config.board.apPassword = "GoldenFixtureHotspot";
  config.board.apiKey = "Z29sZGVuLWZpeHR1cmUta2V5LW5vdC1hLXNlY3JldCE=";
  return Object.assign(config, extra);
}

function yamlFor(config, name) {
  const yaml = generateYaml(config);
  if (yamlOut) fs.writeFileSync(path.join(yamlOut, `expanders-${name}.yaml`), yaml);
  return yaml;
}

function sensor(name, expander, pin) {
  return { name, topic: `trains/track/sensor/${name}`, expander, pin, inverted: true, debounce: "500ms" };
}

function errorsOf(config) {
  return [...validateConfig(normalizeConfig(config)).errors];
}

test("pin labels run A0-A7 then B0-B7", () => {
  assert.deepEqual([0, 7, 8, 11, 15].map(expanderPinLabel), ["A0", "A7", "B0", "B3", "B7"]);
});

test("an expander sharing the PCA9685's bus: one i2c bus, no ids", () => {
  const config = board({ expanders: [{ name: "MCP 1", bus: 1, address: "0x20" }] });
  config.blocks.push(sensor("Int 2 East", "MCP 1", 11));
  assert.deepEqual(errorsOf(config), []);
  const yaml = yamlFor(config, "shared-bus");
  assert.match(yaml, /^i2c:\n  sda: GPIO21\n  scl: GPIO22\n  scan: true\n\npca9685:\n  frequency: 50Hz\n\nmcp23017:\n  - id: mcp23017_1\n    address: 0x20\n\n/m);
  assert.match(yaml, /    pin:\n      mcp23xxx: mcp23017_1\n      number: 11\n      inverted: true\n      mode:\n        input: true\n        pullup: true\n    id: int_2_east_sensor\n/);
  // The ESP sensor is unchanged.
  assert.match(yaml, /    pin:\n      number: GPIO14\n      inverted: true\n      mode:\n        input: true\n    id: kiama_up_xover_sensor\n/);
});

test("an expander on its own pins: two buses, each with an id", () => {
  const config = board({ expanders: [{ name: "MCP 1", sda: "GPIO25", scl: "GPIO26", address: "0x21" }] });
  config.blocks.push(sensor("Yard 1", "MCP 1", 0));
  assert.deepEqual(errorsOf(config), []);
  const yaml = yamlFor(config, "own-bus");
  assert.match(yaml, /^i2c:\n  - id: i2c_1\n    sda: GPIO21\n    scl: GPIO22\n    scan: true\n  - id: i2c_2\n    sda: GPIO25\n    scl: GPIO26\n    scan: true\n\npca9685:\n  - id: pca9685_1\n    i2c_id: i2c_1\n    frequency: 50Hz\n\nmcp23017:\n  - id: mcp23017_1\n    address: 0x21\n    i2c_id: i2c_2\n/m);
});

test("a sensors-only board: the expander's bus alone, no PCA9685", () => {
  const config = board({ points: [], expanders: [{ name: "MCP 1", sda: "GPIO21", scl: "GPIO22", address: "0x20" }] });
  config.blocks.push(sensor("Yard 1", "MCP 1", 8));
  assert.deepEqual(errorsOf(config), []);
  const yaml = yamlFor(config, "sensors-only");
  assert.match(yaml, /^i2c:\n  sda: GPIO21\n  scl: GPIO22\n  scan: true\n\nmcp23017:\n  - id: mcp23017_1\n    address: 0x20\n/m);
  assert.doesNotMatch(yaml, /^pca9685:/m);
});

test("expanders on two PCA9685 boards' buses", () => {
  const config = board({
    pcaBoards: [{ sda: "GPIO21", scl: "GPIO22" }, { sda: "GPIO25", scl: "GPIO26" }],
    expanders: [
      { name: "MCP 1", bus: 2, address: "0x20" },
      { name: "MCP 2", bus: 2, address: "0x21" },
      { name: "MCP 3", bus: 1, address: "0x20" },
    ],
  });
  config.points.push({ name: "Siding", topic: "trains/track/turnout/Siding", channel: 0, pcaBoard: 1, travelTime: "10s", controls: [] });
  config.blocks.push(sensor("A", "MCP 1", 0), sensor("B", "MCP 2", 0), sensor("C", "MCP 3", 0));
  assert.deepEqual(errorsOf(config), []);
  const buses = i2cBuses(config);
  assert.deepEqual(JSON.parse(JSON.stringify(buses.map((bus) => [bus.pca, bus.expanders]))), [[0, [2]], [1, [0, 1]]]);
  const yaml = yamlFor(config, "two-pca");
  assert.match(yaml, /^mcp23017:\n  - id: mcp23017_3\n    address: 0x20\n    i2c_id: i2c_1\n  - id: mcp23017_1\n    address: 0x20\n    i2c_id: i2c_2\n  - id: mcp23017_2\n    address: 0x21\n    i2c_id: i2c_2\n/m);
});

test("expanders with the same own pins share one bus", () => {
  const config = board({
    points: [],
    expanders: [
      { name: "MCP 1", sda: "GPIO21", scl: "GPIO22", address: "0x20" },
      { name: "MCP 2", sda: "GPIO21", scl: "GPIO22", address: "0x21" },
    ],
  });
  assert.deepEqual(errorsOf(config), []);
  assert.deepEqual(JSON.parse(JSON.stringify(i2cBuses(config).map((bus) => bus.expanders))), [[0, 1]]);
  assert.match(yamlFor(config, "own-shared"), /^mcp23017:\n  - id: mcp23017_1\n    address: 0x20\n  - id: mcp23017_2\n    address: 0x21\n\n/m);
});

test("addresses must be 0x20-0x27 and unique on a bus", () => {
  const config = board({ expanders: [{ name: "MCP 1", bus: 1, address: "0x40" }] });
  assert.ok(errorsOf(config).some((e) => e.includes("0x40 is not 0x20 to 0x27")));

  config.expanders = [{ name: "MCP 1", bus: 1, address: "0x20" }, { name: "MCP 2", bus: 1, address: "0x20" }];
  assert.ok(errorsOf(config).some((e) => e.includes("MCP 1 and MCP 2 are both at 0x20")));

  // The same address on two different buses is fine.
  config.expanders[1] = { name: "MCP 2", sda: "GPIO25", scl: "GPIO26", address: "0x20" };
  assert.deepEqual(errorsOf(config), []);
});

test("addresses are tidied: 0x2 and 0X21 become 0x02 and 0x21", () => {
  const config = normalizeConfig(board({ expanders: [{ name: "MCP 1", bus: 1, address: "0X21" }] }));
  assert.equal(config.expanders[0].address, "0x21");
});

test("eight expanders on a bus at most", () => {
  const config = board({ expanders: [] });
  for (let i = 0; i < 9; i += 1) config.expanders.push({ name: `MCP ${i + 1}`, bus: 1, address: `0x2${Math.min(i, 7)}` });
  assert.ok(errorsOf(config).some((e) => e.includes("9 expanders share the I2C bus") && e.includes("8 at most")));
});

test("two buses at most", () => {
  const config = board({
    pcaBoards: [{ sda: "GPIO21", scl: "GPIO22" }, { sda: "GPIO25", scl: "GPIO26" }],
    expanders: [{ name: "MCP 1", sda: "GPIO32", scl: "GPIO33", address: "0x20" }],
  });
  config.points.push({ name: "Siding", topic: "trains/track/turnout/Siding", channel: 0, pcaBoard: 1, travelTime: "10s", controls: [] });
  assert.ok(errorsOf(config).some((e) => e.includes("2 I2C buses, and this board needs 3")));
});

test("sharing a PCA9685 board with no turnouts uses its pins as the expander's own bus", () => {
  const config = board({ points: [], expanders: [{ name: "MCP 1", bus: 1, address: "0x20" }] });
  config.blocks.push(sensor("Yard 1", "MCP 1", 8));
  assert.deepEqual(errorsOf(config), []);
  assert.match(yamlFor(config, "shared-unused"), /^i2c:\n  sda: GPIO21\n  scl: GPIO22\n  scan: true\n\nmcp23017:\n  - id: mcp23017_1\n    address: 0x20\n\n/m);

  // With servos on ESP pins, those pins are the expander's, and a servo on one clashes.
  const servos = board({ pca9685: false, expanders: [{ name: "MCP 1", bus: 1, address: "0x20" }] });
  servos.points[0].servoPin = "GPIO21";
  assert.ok(validateConfig(normalizeConfig(servos)).warnings.some((w) => w.includes("GPIO clash: GPIO21")));

  const missing = board({ expanders: [{ name: "MCP 1", bus: 2, address: "0x20" }] });
  assert.ok(errorsOf(missing).some((e) => e.includes("there is no PCA9685 2")));
});

test("own pins must be both of a bus's pins, and usable", () => {
  const half = board({ expanders: [{ name: "MCP 1", sda: "GPIO21", scl: "GPIO26", address: "0x20" }] });
  assert.ok(errorsOf(half).some((e) => e.includes("GPIO21 is on two I2C buses")));
  const inputOnly = board({ points: [], expanders: [{ name: "MCP 1", sda: "GPIO34", scl: "GPIO22", address: "0x20" }] });
  assert.ok(errorsOf(inputOnly).some((e) => e.includes("MCP 1 SDA pin GPIO34") && e.includes("input only")));
  const clash = board({ points: [], expanders: [{ name: "MCP 1", sda: "GPIO14", scl: "GPIO22", address: "0x20" }] });
  assert.ok(validateConfig(normalizeConfig(clash)).warnings.some((w) => w.includes("GPIO clash: GPIO14")));
});

test("each expander pin takes one sensor, and must exist", () => {
  const config = board({ expanders: [{ name: "MCP 1", bus: 1, address: "0x20" }] });
  config.blocks.push(sensor("A", "MCP 1", 3), sensor("B", "MCP 1", 3));
  assert.ok(errorsOf(config).some((e) => e.includes("MCP 1 pin A3 is used by \"A\" and \"B\"")));
  config.blocks[2] = sensor("B", "MCP 1", 16);
  assert.ok(errorsOf(config).some((e) => e.includes("Sensor \"B\" needs an expander pin")));
  config.blocks[2] = sensor("B", "MCP 9", 1);
  assert.ok(errorsOf(config).some((e) => e.includes("expander \"MCP 9\", which is not on the Sensors page")));
  config.expanders.push({ name: "MCP 1", bus: 1, address: "0x21" });
  assert.ok(errorsOf(config).some((e) => e.includes("Two expanders are called \"MCP 1\"")));
});

test("a half-typed expander name keeps its sensors", () => {
  for (const typed of ["", "Yard ", "  Yard"]) {
    const config = board({ expanders: [{ name: "MCP 1", bus: 1, address: "0x20" }] });
    config.blocks.push(sensor("A", "MCP 1", 5));
    config.expanders[0].name = typed;
    config.blocks[1].expander = typed;
    normalizeConfig(config);
    assert.equal(config.blocks[1].expander, config.expanders[0].name, JSON.stringify(typed));
    assert.equal(config.blocks[1].pin, 5);
    assert.deepEqual(errorsOf(config), []);
  }
});

test("a missing or bad expander pin is left out, not moved to A0", () => {
  for (const pin of [null, "", undefined, 16, -1, 2.5, "x"]) {
    const config = board({ expanders: [{ name: "MCP 1", bus: 1, address: "0x20" }] });
    config.blocks.push(sensor("A", "MCP 1", pin));
    normalizeConfig(config);
    assert.equal(config.blocks[1].pin, undefined, JSON.stringify(pin));
    assert.ok(errorsOf(config).some((e) => e.includes("needs an expander pin")), JSON.stringify(pin));
  }
  const config = normalizeConfig(board({ expanders: [{ name: "MCP 1", bus: 1, address: "0x20" }] }));
  config.blocks.push(sensor("A", "MCP 1", "7"));
  normalizeConfig(config);
  assert.equal(config.blocks[1].pin, 7);
});

test("expanders and expander sensors survive download and import", () => {
  const config = board({ expanders: [{ name: "MCP 1", bus: 1, address: "0x20" }, { name: "Yard MCP", sda: "GPIO25", scl: "GPIO26", address: "0x27" }] });
  config.blocks.push(sensor("Int 2 East", "MCP 1", 11), sensor("Yard 3", "Yard MCP", 2));
  const yaml = generateYaml(config);
  const restored = normalizeConfig(parseConfigFromYaml(yaml));
  assert.deepEqual(JSON.parse(JSON.stringify(restored.expanders)), [
    { name: "MCP 1", address: "0x20", bus: 1 },
    { name: "Yard MCP", address: "0x27", sda: "GPIO25", scl: "GPIO26" },
  ]);
  assert.equal(restored.blocks[1].expander, "MCP 1");
  assert.equal(restored.blocks[1].pin, 11);
  assert.equal(restored.blocks[1].gpio, undefined);
  assert.equal(generateYaml(restored), yaml);
});

test("a file without expanders keeps no expanders key", () => {
  const yaml = generateYaml(board());
  assert.doesNotMatch(yaml, /expanders|mcp23/);
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeConfig(parseConfigFromYaml(yaml)).expanders)), []);
});

test("expander sensors are ordinary sensors in the JMRI XML", () => {
  const config = normalizeConfig(board({ expanders: [{ name: "MCP 1", bus: 1, address: "0x20" }] }));
  config.blocks.push(sensor("Int 2 East", "MCP 1", 11));
  assert.match(generateJmriXml(config).xml, /<systemName>MSInt 2 East<\/systemName>/);
});

if (yamlOut) fs.mkdirSync(yamlOut, { recursive: true });
void configuratorDir;
if (!process.exitCode) console.log("\nAll expander tests passed.");
