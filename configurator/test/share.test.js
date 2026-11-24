// Share with other boards (field logic spec, What each board publishes, and
// Unique board names: the Owner check). Work item 1.4.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import util from "node:util";
import { configuratorDir, loadModules, test } from "./harness.js";

const { EsphomeMr, EsphomeMrLogicYaml } = loadModules("generator.js", "logic-yaml.js");
const { generateJmriXml, generateYaml, normalizeConfig, validateConfig } = EsphomeMr;

const yamlOut = process.env.ESPHOME_YAML_OUT;

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "fixtures", `${name}.json`), "utf8"));
}

function shared(name, logic = { share: true }) {
  const config = fixture(name);
  config.logic = logic;
  return config;
}

function yamlFor(config, name) {
  const yaml = generateYaml(config);
  if (yamlOut) fs.writeFileSync(path.join(yamlOut, `share-${name}.yaml`), yaml);
  return yaml;
}

// Lines removed and added going from `before` to `after`.
function lineDiff(before, after) {
  const removed = [];
  const added = [];
  // util.diff(actual, expected): 1 is only in actual, -1 only in expected.
  for (const [op, line] of util.diff(before.split("\n"), after.split("\n"))) {
    if (op === 1) removed.push(line);
    if (op === -1) added.push(line);
  }
  return { removed, added };
}

function errorsOf(config) {
  return [...validateConfig(normalizeConfig(config)).errors];
}

for (const name of ["my-first-board", "turnouts-pca", "turnouts-gpio", "masts-addressable", "masts-gpio", "expanders", "sensors"]) {
  test(`${name}: Share on its own adds the publishes and nothing else`, () => {
    const plain = generateYaml(fixture(name));
    const config = shared(name);
    assert.deepEqual(errorsOf(config), []);
    const yaml = yamlFor(config, name);
    const { removed, added } = lineDiff(plain, yaml);
    // Only the config comment changes; every other line of today's YAML stays.
    assert.equal(removed.length, 1, removed.join("\n"));
    assert.ok(removed[0].startsWith("# {"));
    assert.ok(added[0].startsWith("# {") && added[0].includes('"logic":{"share":true}'));
    // Everything added is about sharing: these topics and their plumbing.
    const topics = added.filter((line) => /topic: /.test(line)).map((line) => line.replace(/^.*topic: "?|"?$/g, ""));
    for (const topic of topics) {
      assert.match(topic, /\/(State|Moving|Online|Owner)$/, topic);
    }
  });
}

test("Field Logic shares by default; unticked it publishes nothing", () => {
  const plain = generateYaml(fixture("my-first-board"));
  assert.match(generateYaml(shared("my-first-board", { mode: "field" })), /birth_message:/);
  const off = generateYaml(shared("my-first-board", { mode: "field", share: false }));
  const { removed, added } = lineDiff(plain, off);
  assert.equal(removed.length, 1);
  // Field Logic adds the logic component, its switch and the web page, but
  // nothing that another board reads.
  assert.ok(added.length > 1);
  assert.doesNotMatch(added.join("\n"), /birth_message|\/(State|Moving|Online|Owner)\b/);
});

test("the board's Online sensor is its birth, will and shutdown message", () => {
  const yaml = generateYaml(shared("my-first-board"));
  const topic = "trains/track/sensor/board/my-first-board/Online";
  assert.equal(EsphomeMrLogicYaml.onlineTopic(normalizeConfig(shared("my-first-board"))), topic);
  assert.match(yaml, new RegExp(`  topic_prefix: null\\n  reboot_timeout: 0s\\n  birth_message:\\n    topic: ${topic}\\n    payload: ACTIVE\\n    retain: true\\n  will_message:\\n    topic: ${topic}\\n    payload: INACTIVE\\n    retain: true\\n  shutdown_message:\\n    topic: ${topic}\\n    payload: INACTIVE\\n    retain: true\\n`));
});

test("a sensor mirrors its state to /State, retained; its own topic stays unretained", () => {
  const yaml = generateYaml(shared("my-first-board"));
  const state = '"trains/track/sensor/Kiama/Up XOver/State"';
  for (const payload of ["ACTIVE", "INACTIVE"]) {
    assert.match(yaml, new RegExp(`            topic: "trains/track/sensor/Kiama/Up XOver"\\n            payload: ${payload}\\n            retain: false\\n            qos: 2\\n        - mqtt.publish:\\n            topic: ${state}\\n            payload: ${payload}\\n            retain: true\\n            qos: 2\\n`));
  }
  // On connect, only once the sensor has a reading.
  assert.match(yaml, new RegExp(`    - if:\\n        condition:\\n          lambda: 'return id\\(kiama_up_xover_sensor\\).has_state\\(\\);'\\n        then:\\n          - mqtt.publish:\\n              topic: ${state}\\n              payload: !lambda \\|-\\n                return id\\(kiama_up_xover_sensor\\).state \\? "ACTIVE" : "INACTIVE";\\n              retain: true\\n`));
});

test("a turnout publishes /Moving: ACTIVE as a throw starts, INACTIVE after /Thrown", () => {
  const yaml = generateYaml(shared("my-first-board"));
  const moving = '"trains/track/sensor/Kiama/Up Loop/Moving"';
  for (const [which, other] of [["closed", "thrown"], ["thrown", "closed"]]) {
    const script = yaml.slice(yaml.indexOf(`  - id: kiama_up_loop_throw_${which}\n`));
    const body = script.slice(0, script.indexOf("\n  - id: ", 5));
    // Every throw, announced or not (a boot move can be running at connect).
    const start = body.indexOf(`      - mqtt.publish:\n          topic: ${moving}\n          payload: ACTIVE`);
    const servo = body.indexOf("servo.write");
    const thrown = body.indexOf('topic: "trains/track/sensor/Kiama/Up Loop/Thrown"');
    const end = body.indexOf(`      - if:\n          condition:\n            lambda: 'return !id(kiama_up_loop_throw_${other}).is_running();'\n          then:\n            - mqtt.publish:\n                topic: ${moving}\n                payload: INACTIVE`);
    assert.ok(start > 0 && start < servo, `${which}: ACTIVE before the servo moves`);
    assert.ok(thrown > servo && end > thrown, `${which}: INACTIVE after /Thrown, unless the other throw is still running`);
    assert.equal(body.match(/lambda: 'return announce;'/g).length, 1, `${which}: only /Thrown waits for announce`);
  }
  assert.match(yaml, new RegExp(`    - mqtt.publish:\\n        topic: ${moving}\\n        payload: !lambda \\|-\\n          return id\\(kiama_up_loop_throw_closed\\).is_running\\(\\) \\|\\| id\\(kiama_up_loop_throw_thrown\\).is_running\\(\\) \\? "ACTIVE" : "INACTIVE";\\n        retain: true\\n`));
});

test("a mast publishes the aspect name it shows to /State", () => {
  const yaml = generateYaml(shared("masts-addressable"));
  const script = yaml.slice(yaml.indexOf("  - id: kjn_42_26_show\n"));
  assert.match(script, /^  - id: kjn_42_26_show\n    mode: restart\n    parameters:\n      restart_effects: bool\n    then:\n      - if:\n          condition:\n            lambda: 'return restart_effects;'\n          then:\n            - mqtt.publish:\n                topic: trains\/track\/signalmast\/KJN-42.26\/State\n                payload: !lambda \|-\n                  switch \(id\(kjn_42_26_aspect\)\) \{\n                    case 0: return "R292";\n                    case 1: return "R285";\n                    case 2: return "R282";\n                    case 3: return "R281";\n                    case 4: return "R290";\n                    default: return "";\n                  \}\n                retain: true\n/);
  assert.match(yaml, /  on_connect:\n(    .*\n)*    - mqtt.publish:\n        topic: trains\/track\/signalmast\/KJN-42.26\/State\n/);
});

test("an aspect's name is its JMRI name, else its label", () => {
  const { aspectName } = EsphomeMrLogicYaml;
  assert.equal(aspectName({ label: "Stop", states: ["R292; Lit; Unheld", "R292"] }), "R292");
  assert.equal(aspectName({ label: "Stop", states: ["", " Stop "] }), "Stop");
  assert.equal(aspectName({ label: "Shunt", states: [""] }), "Shunt");
});

test("the Owner check: this board's MAC, retained, and a clash after our own came back", () => {
  const yaml = generateYaml(shared("sensors"));
  const owner = "trains/track/board/sensor-board/Owner";
  assert.match(yaml, new RegExp(`    - globals.set:\\n        id: board_owner_heard\\n        value: 'false'\\n    - globals.set:\\n        id: board_owner_answered\\n        value: 'false'\\n    - mqtt.publish:\\n        topic: ${owner}\\n        payload: !lambda \\|-\\n          return get_mac_address_pretty\\(\\);\\n        retain: true\\n`));
  // The board that sees a clash sends its own MAC again, once, so both see it.
  assert.match(yaml, new RegExp(`if \\(!id\\(board_owner_answered\\)\\) \\{\\n {12}id\\(board_owner_answered\\) = true;\\n {12}id\\(mqtt_server\\).publish\\("${owner}", mine, 2, true\\);`));
  assert.match(yaml, /  - id: board_owner_heard\n    type: bool\n    restore_value: false\n/);
  assert.match(yaml, new RegExp(`  - platform: mqtt_subscribe\\n    id: board_owner\\n    internal: true\\n    topic: ${owner}\\n`));
  assert.match(yaml, /if \(x.empty\(\) \|\| !id\(board_owner_heard\)\) return;\n {10}ESP_LOGE\("board", "Another board called %s is on the broker \(MAC %s\). Give one of them a new suffix.", "sensor-board", x.c_str\(\)\);/);
  assert.match(yaml, /id\(mqtt_server\).publish\("trains\/track\/board\/sensor-board\/Problem", std::string\("Clash"\), 0, false\);/);
  // Shown on the board's web page, which a sensors-only board now has.
  assert.match(yaml, /  - platform: template\n    id: board_name_check\n    name: "Board name check"\n/);
  assert.match(yaml, /^web_server:\n/m);
});

test("Disable MQTT makes Share an error, and nothing is published", () => {
  const config = shared("mqtt-off");
  assert.ok(errorsOf(config).some((e) => e.includes("Share with other boards needs MQTT")));
  const yaml = generateYaml(config);
  assert.doesNotMatch(yaml, /State|Moving|Online|Owner|board_owner/);
  // Field Logic shares by default, so it is an error there too until unticked.
  assert.ok(errorsOf(shared("mqtt-off", { mode: "field" })).some((e) => e.includes("needs MQTT")));
  assert.deepEqual(errorsOf(shared("mqtt-off", { mode: "field", share: false })), []);
});

test("reserved names are errors once a board shares or runs logic", () => {
  const names = ["logic/Bridge", "Board/x", "Up Main/State", "Loop/Moving", "Loop/Locked", "Loop/Thrown", "Loop/thrown", "Loop/STATE"];
  for (const name of names) {
    const config = fixture("my-first-board");
    config.blocks[0].name = name;
    config.blocks[0].topic = `trains/track/sensor/${name}`;
    assert.deepEqual(errorsOf(config).filter((e) => e.includes(name)), [], `${name} is fine without logic`);
    config.logic = { share: true };
    assert.ok(errorsOf(config).some((e) => e.includes(`Sensor "${name}"`)), name);
    config.logic = { mode: "field", share: false };
    assert.ok(errorsOf(config).some((e) => e.includes(`Sensor "${name}"`)), `${name} in Field Logic`);
  }
  const turnout = shared("my-first-board");
  turnout.points[0].name = "board/points";
  assert.ok(errorsOf(turnout).some((e) => e.includes('Turnout "board/points" starts with board/')));
});

test("a sensor cannot sit on a topic the board shares", () => {
  for (const topic of ["trains/track/sensor/Kiama/Up Loop/Moving", "trains/track/sensor/board/my-first-board/Online"]) {
    const config = shared("my-first-board");
    config.blocks.push({ name: "Odd", topic, topicCustom: true, gpio: "GPIO27", inverted: true, debounce: "500ms" });
    assert.ok(errorsOf(config).some((e) => e.includes(`Sensor "Odd" uses ${topic}`)), topic);
  }
  const masts = shared("masts-addressable");
  masts.signals.masts[1].topic = "trains/track/signalmast/KJN-42.26/State";
  assert.ok(errorsOf(masts).some((e) => e.includes('Signal mast "Dwarf (Yard)" uses trains/track/signalmast/KJN-42.26/State')));

  const mirror = shared("my-first-board");
  mirror.blocks.push({ name: "Odd", topic: "trains/track/sensor/Kiama/Up XOver/State", topicCustom: true, gpio: "GPIO27", inverted: true, debounce: "500ms" });
  assert.ok(errorsOf(mirror).some((e) => e.includes("Kiama/Up XOver\"'s shared state")));
});

test("JMRI XML: the Logic box adds the board's Online sensor", () => {
  const plain = normalizeConfig(fixture("my-first-board"));
  const config = normalizeConfig(shared("my-first-board"));
  assert.equal(generateJmriXml(plain).xml, generateJmriXml(plain, { logic: true }).xml);
  const xml = generateJmriXml(config).xml;
  assert.match(xml, /<systemName>MSboard\/my-first-board\/Online<\/systemName>/);
  assert.doesNotMatch(generateJmriXml(config, { logic: false }).xml, /Online/);
  // The other boxes give what they did before.
  assert.equal(generateJmriXml(config, { logic: false }).xml, generateJmriXml(plain).xml);
  assert.equal(EsphomeMrLogicYaml.hasJmriLogic(config), true);
  assert.equal(EsphomeMrLogicYaml.hasJmriLogic(plain), false);
  const off = normalizeConfig(shared("mqtt-off"));
  assert.doesNotMatch(generateJmriXml(off).xml, /Online/);
});

if (yamlOut) fs.mkdirSync(yamlOut, { recursive: true });
if (!process.exitCode) console.log("\nAll Share tests passed.");
