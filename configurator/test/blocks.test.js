// Blocks: named groups of sensors on the Logic page (field logic spec, Blocks
// and detection). Work item 1.6.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

const { EsphomeMr, EsphomeMrLogicYaml: L } = loadModules("generator.js", "logic-yaml.js");
const { generateJmriXml, generateYaml, normalizeConfig, parseConfigFromYaml, validateConfig } = EsphomeMr;

const yamlOut = process.env.ESPHOME_YAML_OUT;
if (yamlOut) fs.mkdirSync(yamlOut, { recursive: true });
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "fixtures", `${name}.json`), "utf8"));
}

function block(name, sensors, extra = {}) {
  return { name, topic: `trains/track/sensor/${name}`, sensors, ...extra };
}

// The expander fixture in Field Logic: Int 2 is the current sensor on an ESP
// pin plus the optical sensors either end, both on MCP 1.
function expanderBoard(logic = {}) {
  const config = fixture("expanders");
  config.logic = {
    mode: "field",
    blocks: [block("Int 2", ["Kiama/Up XOver", "Int 2 East", "Int 2 West"])],
    ...logic,
  };
  return normalizeConfig(config);
}

// A shared board's file, for linking.
function northSnapshot() {
  const north = fixture("sensors");
  north.board.name = "kiama-north-k7m4x2";
  north.logic = { mode: "field", blocks: [block("North Loop", ["Yard Ladder"])] };
  return L.linkedBoardFromConfig(parseConfigFromYaml(generateYaml(north)));
}

function errorsOf(config) {
  return [...validateConfig(normalizeConfig(config)).errors];
}

function binarySensors(yaml) {
  return yaml.slice(yaml.indexOf("\nbinary_sensor:"), yaml.indexOf("\n\n", yaml.indexOf("\nbinary_sensor:") + 1));
}

test("a block is a template sensor, occupied while any of its sensors is", () => {
  const config = expanderBoard({ share: false });
  assert.deepEqual(errorsOf(config), []);
  const yaml = generateYaml(config);
  if (yamlOut) fs.writeFileSync(path.join(yamlOut, "block-expander.yaml"), yaml);
  assert.ok(binarySensors(yaml).includes([
    "  - platform: template",
    "    id: int_2_block",
    '    name: "Int 2"',
    "    lambda: |-",
    "      if (!id(kiama_up_xover_sensor).has_state() || !id(int_2_east_sensor).has_state() || !id(int_2_west_sensor).has_state()) return {};",
    "      return id(kiama_up_xover_sensor).state",
    "          || id(mcp23017_1).is_failed() || id(mcp23017_1).status_has_warning() || id(int_2_east_sensor).state",
    "          || id(mcp23017_1).is_failed() || id(mcp23017_1).status_has_warning() || id(int_2_west_sensor).state;",
    "    on_press:",
    "      then:",
    "        - logger.log:",
    '            format: "Int 2 | OCCUPIED"',
    "            level: INFO",
    "            tag: block",
    "        - mqtt.publish:",
    '            topic: "trains/track/sensor/Int 2"',
    "            payload: ACTIVE",
    "            retain: false",
    "            qos: 2",
    "    on_release:",
    "      then:",
    "        - logger.log:",
    '            format: "Int 2 | UNOCCUPIED"',
    "            level: INFO",
    "            tag: block",
    "        - mqtt.publish:",
    '            topic: "trains/track/sensor/Int 2"',
    "            payload: INACTIVE",
    "            retain: false",
    "            qos: 2",
  ].join("\n")));
});

test("a sensor on an ESP pin needs no expander check", () => {
  const config = expanderBoard({ share: false, blocks: [block("Main", ["Kiama/Up XOver"])] });
  const lambda = plain(L.blockLambda(config, config.logic.blocks[0]));
  assert.deepEqual(lambda, [
    "if (!id(kiama_up_xover_sensor).has_state()) return {};",
    "return id(kiama_up_xover_sensor).state;",
  ]);
});

test("when sharing, a block also sends its retained /State, and again on connect", () => {
  const config = expanderBoard();
  assert.deepEqual(errorsOf(config), []);
  const yaml = generateYaml(config);
  const sensors = binarySensors(yaml);
  assert.match(sensors, /payload: ACTIVE\n            retain: false\n            qos: 2\n        - mqtt.publish:\n            topic: "trains\/track\/sensor\/Int 2\/State"\n            payload: ACTIVE\n            retain: true\n            qos: 2/);
  assert.match(sensors, /topic: "trains\/track\/sensor\/Int 2\/State"\n            payload: INACTIVE\n            retain: true/);
  assert.match(yaml, /    - if:\n        condition:\n          lambda: 'return id\(int_2_block\).has_state\(\);'\n        then:\n          - mqtt.publish:\n              topic: "trains\/track\/sensor\/Int 2\/State"\n              payload: !lambda \|-\n                return id\(int_2_block\).state \? "ACTIVE" : "INACTIVE";/);
});

test("with MQTT off a block still runs, and only logs", () => {
  const config = fixture("mqtt-off");
  config.logic = { mode: "field", share: false, blocks: [block("Siding", [config.blocks[0].name])] };
  assert.deepEqual(errorsOf(config), []);
  const sensors = binarySensors(generateYaml(config));
  assert.match(sensors, /id: siding_block/);
  assert.doesNotMatch(sensors.slice(sensors.indexOf("siding_block")), /mqtt\.publish/);
});

test("another board's sensor or block counts as occupied until it is known", () => {
  const config = expanderBoard({
    remoteBoards: [northSnapshot()],
    blocks: [block("Junction", ["Int 2 East", { board: "kiama-north-k7m4x2", sensor: "Yard Ladder" }, { board: "kiama-north-k7m4x2", block: "North Loop" }])],
  });
  assert.deepEqual(errorsOf(config), []);
  const lambda = plain(L.blockLambda(config, config.logic.blocks[0]));
  // Only this board's sensors hold the block quiet at boot; the remote ones read occupied.
  assert.equal(lambda[0], "if (!id(int_2_east_sensor).has_state()) return {};");
  assert.equal(lambda[2], `    || ${L.remoteOccupiedExpr(config, { board: "kiama-north-k7m4x2", sensor: "Yard Ladder" })}`);
  assert.equal(lambda[3], `    || ${L.remoteOccupiedExpr(config, { board: "kiama-north-k7m4x2", block: "North Loop" })};`);
  assert.match(lambda[2], /id\(linked_kiama_north_k7m4x2_online\).state == "ACTIVE"/);
  const subs = plain([...L.remoteSubscriptions(config)].map(([, topic]) => topic));
  assert.deepEqual(subs, [
    "trains/track/sensor/board/kiama-north-k7m4x2/Online",
    "trains/track/sensor/Yard Ladder/State",
    "trains/track/sensor/North Loop/State",
  ]);
  const yaml = generateYaml(config);
  if (yamlOut) fs.writeFileSync(path.join(yamlOut, "block-remote.yaml"), yaml);
  assert.match(yaml, /id: linked_kiama_north_k7m4x2_block_north_loop/);
});

test("a block with only remote sensors reports from the first loop", () => {
  const config = expanderBoard({ remoteBoards: [northSnapshot()], blocks: [block("Far", [{ board: "kiama-north-k7m4x2", sensor: "Yard Ladder" }])] });
  const lambda = plain(L.blockLambda(config, config.logic.blocks[0]));
  assert.equal(lambda.length, 1);
  assert.match(lambda[0], /^return !\(.*\);$/);
});

test("a sensor listed twice is read once", () => {
  const config = expanderBoard({ share: false, blocks: [block("Main", ["Kiama/Up XOver", "Kiama/Up XOver"])] });
  assert.deepEqual(plain(L.blockLambda(config, config.logic.blocks[0])), [
    "if (!id(kiama_up_xover_sensor).has_state()) return {};",
    "return id(kiama_up_xover_sensor).state;",
  ]);
});

test("blocks are only for Field Logic; None and MSS Logic keep them in the file and generate none", () => {
  for (const mode of [undefined, "mss"]) {
    const config = expanderBoard({ share: false });
    if (mode) config.logic.mode = mode;
    else delete config.logic.mode;
    const yaml = generateYaml(config);
    assert.doesNotMatch(yaml, /_block\n/, String(mode));
    assert.equal(normalizeConfig(parseConfigFromYaml(yaml)).logic.blocks.length, 1, "kept in the file");
  }
});

test("JMRI XML: each block is a sensor under the Logic box", () => {
  const config = expanderBoard({
    blocks: [block("Int 2", ["Int 2 East"]), block("Odd", ["Int 2 West"], { topic: "layout/odd", topicCustom: true })],
  });
  const { xml, skipped } = generateJmriXml(config);
  assert.match(xml, /<systemName>MSInt 2<\/systemName>/);
  assert.match(xml, /<systemName>MSboard\/expander-board\/Online<\/systemName>/);
  assert.deepEqual(plain(skipped), ['Block "Odd": topic has no track/sensor/']);
  const without = generateJmriXml(config, { logic: false }).xml;
  assert.doesNotMatch(without, /MSInt 2</);
  assert.doesNotMatch(without, /Online/);
  config.board.mqttEnabled = false;
  assert.doesNotMatch(generateJmriXml(config).xml, /MSInt 2</);
  if (yamlOut) {
    config.board.mqttEnabled = true;
    fs.writeFileSync(path.join(yamlOut, "block-jmri.xml"), generateJmriXml(config).xml);
  }
});

test("a block needs a name, a topic of its own, and at least one sensor", () => {
  const has = (config, text) => errorsOf(config).some((error) => error.includes(text));
  assert.ok(has(expanderBoard({ blocks: [block("", ["Int 2 East"])] }), "A block has no name"));
  assert.ok(has(expanderBoard({ blocks: [block("Int 2", [])] }), 'Block "Int 2" has no sensors'));
  assert.ok(has(expanderBoard({ blocks: [block("Int 2", ["Int 2 East"]), block("Int 2", ["Int 2 West"])] }), 'Two blocks are called "Int 2"'));
  assert.ok(has(expanderBoard({ blocks: [block("Yard 3", ["Int 2 East"])] }), 'Block "Yard 3" has the same name as a sensor'));
  assert.ok(has(expanderBoard({ blocks: [block("A", ["Int 2 East"], { topic: "trains/track/sensor/Yard 3" })] }), "which sensor \"Yard 3\" uses"));
  assert.ok(has(expanderBoard({ blocks: [block("A", ["Int 2 East"]), block("B", ["Int 2 West"], { topic: "trains/track/sensor/A" })] }), 'Block "B" and block "A" both use'));
  assert.ok(has(expanderBoard({ blocks: [block("A", ["Int 2 East"], { topic: "" })] }), 'Block "A" has no MQTT topic'));
  const thrown = expanderBoard({ blocks: [block("A", ["Int 2 East"])] });
  thrown.logic.blocks[0].topic = EsphomeMr.thrownTopic(thrown.points[0].topic);
  assert.ok(has(thrown, "reports its position"));
});

test("a block's sensors must be there, and be sensors", () => {
  const has = (config, text) => errorsOf(config).some((error) => error.includes(text));
  assert.ok(has(expanderBoard({ blocks: [block("A", ["Gone"])] }), 'Block "A" uses sensor "Gone", which is not on the Sensors page'));
  const turnout = expanderBoard({ remoteBoards: [northSnapshot()], blocks: [block("A", [{ board: "kiama-north-k7m4x2", turnout: "Points" }])] });
  assert.ok(has(turnout, 'Block "A" has turnout "Points" in it'));
  const remoteGone = expanderBoard({ remoteBoards: [northSnapshot()], blocks: [block("A", [{ board: "kiama-north-k7m4x2", sensor: "Nope" }])] });
  assert.ok(has(remoteGone, 'sensor "Nope" is not on kiama-north-k7m4x2'));
  // A missing sensor reads occupied, never clear.
  const gone = expanderBoard({ blocks: [block("A", ["Gone"])] });
  assert.deepEqual(plain(L.blockLambda(gone, gone.logic.blocks[0])), ["return true;"]);
});

test("block names follow the sensor rules once the board shares", () => {
  const has = (config, text) => errorsOf(config).some((error) => error.includes(text));
  assert.ok(has(expanderBoard({ blocks: [block("logic/x", ["Int 2 East"])] }), 'Block "logic/x" starts with logic/'));
  assert.ok(has(expanderBoard({ blocks: [block("Int 2/State", ["Int 2 East"])] }), 'Block "Int 2/State" ends with /State'));
  const clash = expanderBoard({ blocks: [block("A", ["Int 2 East"], { topic: "trains/track/sensor/Int 2 East/State" })] });
  assert.ok(has(clash, "where the board sends sensor \"Int 2 East\"'s shared state"));
});

test("a sensor in more than two blocks is a warning: a boundary has two sides", () => {
  const config = expanderBoard({
    share: false,
    blocks: ["A", "B", "C"].map((name) => block(name, ["Int 2 East"])),
  });
  const { errors, warnings } = validateConfig(config);
  assert.deepEqual([...errors], []);
  assert.ok(warnings.some((w) => w === 'Sensor "Int 2 East" is in 3 blocks (A, B, C). A sensor at a boundary is in two: check the others.'));
  const two = expanderBoard({ share: false, blocks: ["A", "B"].map((name) => block(name, ["Int 2 East"])) });
  assert.ok(!validateConfig(two).warnings.some((w) => w.includes("blocks (")));
});

test("blocks survive download and import, and odd entries are tidied", () => {
  const config = expanderBoard();
  const yaml = generateYaml(config);
  const restored = normalizeConfig(parseConfigFromYaml(yaml));
  assert.deepEqual(plain(restored.logic.blocks), plain(config.logic.blocks));
  assert.equal(generateYaml(restored), yaml);
  const odd = fixture("expanders");
  odd.logic = { mode: "field", blocks: [null, "x", { name: "Int 2", sensors: ["Int 2 East", 7, null, { board: "b", sensor: "s" }] }] };
  normalizeConfig(odd);
  assert.deepEqual(plain(odd.logic.blocks), [
    { name: "Int 2", sensors: ["Int 2 East", { board: "b", sensor: "s" }], topic: "trains/track/sensor/Int 2", topicCustom: false },
  ]);
});

test("a board without blocks gives the same YAML as before", () => {
  const config = fixture("expanders");
  config.logic = { mode: "field", share: false };
  const before = generateYaml(config);
  config.logic.blocks = [];
  assert.equal(generateYaml(normalizeConfig(config)).split("\n").slice(2).join("\n"), before.split("\n").slice(2).join("\n"));
});

if (!process.exitCode) console.log("\nAll block tests passed.");
