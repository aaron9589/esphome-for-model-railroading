// Field Logic in the YAML and JMRI XML (field logic spec, Generated YAML and
// Tests > Generator): the rule table, its version code, the mr_logic
// component and what the generator writes around it. Work item 2.5.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

const ctx = loadModules("generator.js", "logic-yaml.js", "logic.js");
const { EsphomeMr, EsphomeMrLogicYaml: L, EsphomeMrLogic: Engine } = ctx;
const { generateJmriXml, generateYaml, normalizeConfig, parseConfigFromYaml, validateConfig, topicFor } = EsphomeMr;

const yamlOut = process.env.ESPHOME_YAML_OUT;
if (yamlOut) fs.mkdirSync(yamlOut, { recursive: true });
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "fixtures", `${name}.json`), "utf8"));
}

const lamp = (color) => ({ color, mode: "steady" });
const tags = { Stop: "stop", Clear: "clear" };

function mast(name, pins) {
  return {
    name, topic: topicFor("signal", name), topicCustom: false, mode: "gpio",
    lamps: [{ name: "Red", count: 1, pin: pins[0] }, { name: "Green", count: 1, pin: pins[1] }],
    aspects: [
      { label: "Stop", states: ["R292; Lit; Unheld"], startup: true, lamps: [lamp("red"), lamp("off")] },
      { label: "Clear", states: ["R281; Lit; Unheld"], lamps: [lamp("off"), lamp("green")] },
    ],
  };
}

function entrance(block, mastName, extra = {}) {
  return { trigger: { while: { block, is: "occupied" }, for: "0.5s" }, checks: [], then: { mast: mastName, aspect: "Clear", reserve: "Bridge", ...extra } };
}

const SENSOR_PINS = ["GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO13"];
const MAST_PINS = [["GPIO32", "GPIO19"], ["GPIO21", "GPIO22"], ["GPIO23", "GPIO12"], ["GPIO17", "GPIO16"]];

// A one-train section with 2 to 4 entrances (spec, One-train section).
function section(entrances = 2, { mqtt = true, logic = {} } = {}) {
  const config = fixture("turnouts-gpio");
  config.board.name = "gauntlet-k7m4x2";
  config.board.nameSuffix = "k7m4x2";
  config.board.mqttEnabled = mqtt;
  const names = ["Left", "Right", "Up", "Down"].slice(0, entrances);
  config.blocks = ["Bridge", ...names].map((name, i) => ({
    name, topic: topicFor("block", name), topicCustom: false, gpio: SENSOR_PINS[i], inverted: true, debounce: "500ms",
  }));
  config.points = [{ ...config.points[0], name: "P1", topic: topicFor("point", "P1"), controls: [{ action: "latch-thrown", buttonPin: "GPIO4" }] }];
  config.signals = { mode: "gpio", masts: names.map((name, i) => mast(`${name} Bridge`, MAST_PINS[i])) };
  config.logic = {
    mode: "field",
    masts: names.map((name) => ({ mast: `${name} Bridge`, tags })),
    resources: [{ name: "Bridge", blocks: ["Bridge"], release: { while: { block: "Bridge", is: "clear" }, for: "3s" } }],
    layers: [{ name: "Gauntlet", starter: "one-train-section", rules: names.map((name, i) => entrance(name, `${name} Bridge`, i === 0 ? { lock: ["P1"] } : {})) }],
    ...logic,
  };
  return normalizeConfig(config);
}

function errorsOf(config) {
  return [...validateConfig(normalizeConfig(plain(config))).errors];
}

// One top-level section of the YAML, up to the next blank line.
function sectionOf(yaml, key) {
  const at = yaml.indexOf(`\n${key}:\n`);
  if (at < 0) return "";
  const end = yaml.indexOf("\n\n", at + 1);
  return yaml.slice(at + 1, end < 0 ? undefined : end).trimEnd();
}

function topLevelKeys(yaml) {
  return yaml.split("\n").filter((line) => /^[a-z_]+:/.test(line)).map((line) => line.split(":")[0]);
}

test("the rule table is the board in the engine's format, and runs in logic.js", () => {
  const config = section(2);
  assert.deepEqual(errorsOf(config), []);
  const table = L.logicTable(config);
  assert.deepEqual(table.sensors, ["Bridge", "Left", "Right"]);
  assert.deepEqual(table.turnouts, ["P1"]);
  assert.deepEqual(Object.keys(table.masts), ["Left Bridge", "Right Bridge"]);
  // The aspects keep the Signal Masts page's order: the component turns a name
  // into the index the show script draws.
  assert.deepEqual(plain(table.masts["Left Bridge"]), {
    aspects: { Stop: "stop", Clear: "clear" },
    states: { Stop: ["R292; Lit; Unheld"], Clear: ["R281; Lit; Unheld"] },
    stop: "Stop",
    startup: "Stop",
  });
  // The layer's starter is for the page; it is not in the table.
  assert.equal(JSON.stringify(table).includes("starter"), false);

  const engine = Engine.createEngine(plain(table), {});
  const shows = (m) => engine.state().masts[m];
  engine.scan();
  assert.equal(shows("Left Bridge"), "Stop");
  engine.event({ sensor: "Left", is: "occupied" });
  for (let i = 0; i < 6; i += 1) engine.scan();
  assert.equal(shows("Left Bridge"), "Clear");
  assert.equal(shows("Right Bridge"), "Stop");
  assert.equal(engine.state().locks.P1, true);
});

test("the YAML binds the component to the board's own ids", () => {
  const config = section(2);
  const yaml = generateYaml(config);
  if (yamlOut) fs.writeFileSync(path.join(yamlOut, "field-logic-section-2.yaml"), yaml);
  assert.ok(yaml.includes([
    "",
    "external_components:",
    `  - source: github://aaron9589/esphome-for-model-railroading@${L.LOGIC_COMPONENT_REF}`,
    "    components: [mr_logic]",
    "",
    "mr_logic:",
    "  id: logic",
    "  board: gauntlet-k7m4x2",
    `  version: "${L.versionCode(config)}"`,
    `  table: '${L.logicTableJson(config)}'`,
    "  logic_switch: field_logic",
    "  sensors:",
    "    - name: Bridge",
    "      sensor: bridge_sensor",
    "    - name: Left",
    "      sensor: left_sensor",
    "    - name: Right",
    "      sensor: right_sensor",
    "  masts:",
    '    - name: "Left Bridge"',
    "      aspect: left_bridge_aspect",
    "      show: left_bridge_show",
    "      jmri: left_bridge",
    '    - name: "Right Bridge"',
    "      aspect: right_bridge_aspect",
    "      show: right_bridge_show",
    "      jmri: right_bridge",
    "  turnouts:",
    "    - name: P1",
    "      thrown: p1_thrown",
    "      throw_closed: p1_throw_closed",
    "      throw_thrown: p1_throw_thrown",
    "      field_locked: p1_field_locked",
    "",
  ].join("\n")));
  assert.ok(yaml.endsWith("      field_locked: p1_field_locked\n"));
  // Every top-level key once: ESPHome rejects a repeat.
  const keys = topLevelKeys(yaml);
  assert.deepEqual(keys, [...new Set(keys)]);
  // The rule-locked turnout's field lock, not saved.
  assert.ok(sectionOf(yaml, "globals").includes("  - id: p1_field_locked\n    type: bool\n    restore_value: false\n    initial_value: \"false\""));
});

test("a four-entrance section, with MQTT on and off", () => {
  const on = section(4);
  assert.deepEqual(errorsOf(on), []);
  const yaml = generateYaml(on);
  if (yamlOut) fs.writeFileSync(path.join(yamlOut, "field-logic-section-4.yaml"), yaml);
  assert.equal(L.logicTable(on).logic.layers[0].rules.length, 4);
  assert.equal((yaml.match(/^      jmri: /gm) || []).length, 4);

  // Share needs MQTT, so it is unticked.
  const off = section(4, { mqtt: false, logic: { share: false } });
  assert.deepEqual(errorsOf(off), []);
  const quiet = generateYaml(off);
  if (yamlOut) fs.writeFileSync(path.join(yamlOut, "field-logic-section-4-no-mqtt.yaml"), quiet);
  // Logic runs on local inputs. No board name, so the component sends and
  // hears nothing; no JMRI subscriptions to bind; the switch, the Release
  // button and the version stay.
  assert.doesNotMatch(quiet, /^mqtt:/m);
  assert.doesNotMatch(sectionOf(quiet, "mr_logic"), /board:|jmri:/);
  assert.match(sectionOf(quiet, "switch"), /id: field_logic/);
  assert.match(sectionOf(quiet, "button"), /name: "Release Bridge"/);
  assert.match(sectionOf(quiet, "text_sensor"), /name: "Logic version"/);
  // The same rules, so the same code: MQTT is not part of the logic.
  assert.equal(L.versionCode(off), L.versionCode(on));
  const keys = topLevelKeys(quiet);
  assert.deepEqual(keys, [...new Set(keys)]);
  // A mast JMRI sets still needs MQTT.
  off.signals.masts.push(mast("Home", ["GPIO5", "GPIO15"]));
  assert.deepEqual(errorsOf(off), ['Signal mast "Home" needs MQTT: JMRI sets it. Turn MQTT back on under Board, or set the mast from a rule.']);
});

test("a field-controlled mast keeps its subscription, without a handler", () => {
  const config = section(2);
  // Right Bridge is read, not set: it stays with JMRI and keeps its handler.
  config.signals.masts.push(mast("Home", ["GPIO5", "GPIO15"]));
  config.logic.layers[0].rules[0].checks = [{ mast: "Home", is: ["clear"] }];
  assert.deepEqual(errorsOf(config), []);
  const text = sectionOf(generateYaml(config), "text_sensor");
  assert.ok(text.includes([
    "  - platform: mqtt_subscribe",
    '    name: "Left Bridge"',
    "    id: left_bridge",
    "    internal: true",
    '    topic: "trains/track/signalmast/Left Bridge"',
    "  - platform: mqtt_subscribe",
  ].join("\n")));
  assert.match(text, /id: home\n    internal: true\n    topic: "?trains\/track\/signalmast\/Home"?\n    on_value:/);
  // The read mast is bound too, so rules see JMRI's aspect.
  assert.match(sectionOf(generateYaml(config), "mr_logic"), /- name: Home\n      aspect: home_aspect\n      show: home_show\n      jmri: home/);
});

test("field-controlled masts are at their stop aspect from boot while logic is on", () => {
  const config = section(2);
  // Right Bridge's startup aspect is Clear, so the two differ.
  config.signals.masts[1].aspects[0].startup = false;
  config.signals.masts[1].aspects[1].startup = true;
  const yaml = generateYaml(config);
  assert.ok(yaml.includes([
    "    - priority: -150.0",
    "      then:",
    "        - globals.set:",
    "            id: left_bridge_aspect",
    "            value: '0'",
    "        - script.execute:",
    "            id: left_bridge_show",
    "            restart_effects: true",
    "        - if:",
    "            condition:",
    "              lambda: 'return id(logic).logic_on();'",
    "            then:",
    "              - globals.set:",
    "                  id: right_bridge_aspect",
    "                  value: '0'",
    "              - script.execute:",
    "                  id: right_bridge_show",
    "                  restart_effects: true",
    "            else:",
    "              - globals.set:",
    "                  id: right_bridge_aspect",
    "                  value: '1'",
    "              - script.execute:",
    "                  id: right_bridge_show",
    "                  restart_effects: true",
  ].join("\n")));
  // A mast with no startup aspect still boots at Stop with logic on.
  config.signals.masts[1].aspects[1].startup = false;
  assert.match(generateYaml(config), /value: '0'\n {14}- script\.execute:\n {18}id: right_bridge_show\n {18}restart_effects: true\n\nesp32:/);
});

test("a toggle switch's boot move waits for the start-up scan", () => {
  const yaml = generateYaml(section(2));
  assert.ok(yaml.includes([
    "    - priority: -200.0",
    "      then:",
    "        - wait_until:",
    "            condition:",
    "              lambda: 'return id(logic).started();'",
    "        - script.execute:",
    "            id: p1_latch_1",
    "            force: true",
  ].join("\n")));
});

test("the switch, its starting value, and a Release button per section", () => {
  const config = section(2);
  const yaml = generateYaml(config);
  assert.equal(sectionOf(yaml, "switch"), [
    "switch:",
    "  - platform: template",
    "    id: field_logic",
    '    name: "Field logic"',
    "    optimistic: true",
    "    restore_mode: RESTORE_DEFAULT_ON",
  ].join("\n"));
  assert.ok(sectionOf(yaml, "button").endsWith([
    "  - platform: template",
    '    name: "Release Bridge"',
    "    on_press:",
    "      - lambda: |-",
    '          id(logic).release("Bridge");',
  ].join("\n")));
  assert.match(yaml, /^web_server:/m);
  config.logic.startsOn = false;
  assert.match(sectionOf(generateYaml(config), "switch"), /restore_mode: RESTORE_DEFAULT_OFF/);
  // Starts on is not logic: the version stays.
  assert.equal(L.versionCode(config), L.versionCode(section(2)));
});

test("the switch joins the switch section a turnout's lights opened", () => {
  const config = section(2);
  config.points[0].controls = [{ action: "toggle", buttonPin: "GPIO4", closedLight: "GPIO2" }];
  const yaml = generateYaml(config);
  const switches = sectionOf(yaml, "switch");
  assert.match(switches, /platform: gpio[\s\S]*id: field_logic/);
  const keys = topLevelKeys(yaml);
  assert.deepEqual(keys, [...new Set(keys)]);
});

test("the version code: the same rules give the same code, and any change to a rule changes it", () => {
  const base = L.versionCode(section(2));
  assert.match(base, /^[0-9a-f]{8}$/);
  assert.equal(L.versionCode(section(2)), base);
  // Display only: the starter, the order of a condition's keys, a block's topic.
  const display = section(2);
  display.logic.layers[0].starter = "something-else";
  display.logic.layers[0].rules[0].trigger = { for: "0.5s", while: { is: "occupied", block: "Left" } };
  assert.equal(L.versionCode(display), base);
  // Any change to a rule.
  const changes = [
    (c) => { c.logic.layers[0].rules[0].trigger.for = "1s"; },
    (c) => { c.logic.layers[0].rules[1].then.aspect = "Stop"; },
    (c) => { c.logic.layers[0].rules[0].checks.push({ block: "Right", is: "clear" }); },
    (c) => { c.logic.layers[0].rules.reverse(); },
    (c) => { c.logic.resources[0].approachLock = "10s"; },
    (c) => { c.logic.resources[0].release.for = "5s"; },
    (c) => { c.logic.masts[0].tags = { Stop: "stop", Clear: "approach" }; },
    (c) => { c.logic.masts[0].approachLight = "Left"; },
    (c) => { c.logic.layers[0].name = "Bridge"; },
  ];
  const codes = new Set([base]);
  for (const change of changes) {
    const config = section(2);
    change(config);
    const code = L.versionCode(config);
    assert.notEqual(code, base, String(change));
    codes.add(code);
  }
  assert.equal(codes.size, changes.length + 1);
  // None without Field Logic.
  assert.equal(L.versionCode(normalizeConfig(fixture("my-first-board"))), "");
});

test("tags: as set under Masts, else stop; diverging and the stop aspect", () => {
  const config = section(2);
  config.logic.masts = [{ mast: "Left Bridge", tags: { Clear: "clear" }, diverging: ["Clear"], stopAspect: "Stop" }];
  const table = L.logicTable(config);
  assert.deepEqual(plain(table.masts["Left Bridge"].aspects), { Stop: "stop", Clear: "clear" });
  assert.deepEqual(plain(table.masts["Left Bridge"].diverging), ["Clear"]);
  // No entry at all: every aspect counts as the most restrictive.
  assert.deepEqual(plain(table.masts["Right Bridge"].aspects), { Stop: "stop", Clear: "stop" });
  // The stop aspect by its JMRI aspect when the label is not R292 or Stop.
  config.signals.masts[1].aspects[0].label = "Danger";
  config.logic.masts.push({ mast: "Right Bridge", tags: { Danger: "stop", Clear: "clear" } });
  assert.equal(L.logicTable(config).masts["Right Bridge"].stop, "Danger");
  // A CATS aspect on its default string carries no states.
  config.signals.masts[1].aspects[1] = { label: "R281", states: ["R281; Lit; Unheld"], lamps: [lamp("off"), lamp("green")] };
  assert.deepEqual(plain(L.logicTable(config).masts["Right Bridge"].states), { Danger: ["R292; Lit; Unheld"] });
});

test("approach lighting goes in the table", () => {
  const config = section(2, { logic: {} });
  config.logic.masts[0].approachLight = "Left";
  assert.equal(L.logicTable(config).masts["Left Bridge"].approachLight, "Left");
  const engine = Engine.createEngine(plain(L.logicTable(config)), {});
  engine.scan();
  assert.equal(engine.state().masts["Left Bridge"], "dark");
});

test("a virtual mast: aspect global and a show script with no lamp code, and its /State", () => {
  const config = section(2);
  config.logic.masts.push({ virtual: true, name: "Bridge Exit", topic: topicFor("signal", "Bridge Exit"), aspects: ["Stop", "Clear"], tags });
  config.logic.layers.push({ name: "Exit", rules: [{ trigger: { while: { block: "Bridge", is: "clear" } }, checks: [], then: { mast: "Bridge Exit", aspect: "Clear" } }] });
  assert.deepEqual(errorsOf(config), []);
  const yaml = generateYaml(config);
  if (yamlOut) fs.writeFileSync(path.join(yamlOut, "field-logic-virtual-mast.yaml"), yaml);
  assert.deepEqual(plain(L.logicTable(config).masts["Bridge Exit"]), { aspects: { Stop: "stop", Clear: "clear" }, stop: "Stop" });
  assert.ok(sectionOf(yaml, "globals").includes("  - id: bridge_exit_aspect\n    type: int\n    restore_value: false\n    initial_value: '-1'"));
  const script = sectionOf(yaml, "script");
  const show = script.slice(script.indexOf("  - id: bridge_exit_show"));
  assert.ok(show.startsWith([
    "  - id: bridge_exit_show",
    "    mode: restart",
    "    parameters:",
    "      restart_effects: bool",
    "    then:",
    "      - lambda: |-",
    "          switch (id(bridge_exit_aspect)) {",
    '            case 0: ESP_LOGI("signal_mast", "%s", "Bridge Exit | Stop"); break;',
    '            case 1: ESP_LOGI("signal_mast", "%s", "Bridge Exit | Clear"); break;',
    "            default: break;",
    "          }",
    "      - mqtt.publish:",
    '          topic: "trains/track/signalmast/Bridge Exit/State"',
  ].join("\n")));
  assert.doesNotMatch(show, /light\.|lamp/);
  // Sent again on connect, like any mast.
  assert.match(sectionOf(yaml, "mqtt"), /topic: "trains\/track\/signalmast\/Bridge Exit\/State"/);
  assert.match(sectionOf(yaml, "mr_logic"), /- name: "Bridge Exit"\n      aspect: bridge_exit_aspect\n      show: bridge_exit_show\n/);
  // Not in the JMRI XML: JMRI and CATS do not drive it.
  assert.doesNotMatch(generateJmriXml(config).xml, /Bridge Exit/);
  // Unticked Share: no /State.
  config.logic.share = false;
  assert.doesNotMatch(generateYaml(config), /Bridge Exit\/State/);
});

test("a virtual mast no rule sets is an error", () => {
  const config = section(2);
  config.logic.masts.push({ virtual: true, name: "Bridge Exit", topic: topicFor("signal", "Bridge Exit"), aspects: ["Stop", "Clear"], tags });
  assert.ok(errorsOf(config).some((e) => e.includes('"Bridge Exit" is not set by any rule')));
  config.logic.masts[2].name = "Left Bridge";
  assert.ok(errorsOf(config).some((e) => e.includes("has the name of a signal mast on the Signal Masts page")));
});

test("a mast logic uses needs aspects with names of their own", () => {
  const config = section(2);
  config.signals.masts[0].aspects[1].label = "Stop";
  assert.ok(errorsOf(config).some((e) => e.includes('Signal mast "Left Bridge" has two aspects called "Stop"')));
  config.signals.masts[0].aspects[1].label = "2";
  assert.ok(errorsOf(config).some((e) => e.includes('aspect called "2", only a number')));
  // A mast logic does not use is left as it is.
  const unused = section(2);
  unused.signals.masts.push({ ...mast("Yard", ["GPIO5", "GPIO15"]), aspects: [{ label: "A", states: ["A"], lamps: [lamp("red"), lamp("off")] }, { label: "A", states: ["B"], lamps: [lamp("off"), lamp("red")] }] });
  assert.deepEqual(errorsOf(unused), []);
});

test("another board's mast: tags by its JMRI aspect, subscription and binding", () => {
  const other = fixture("masts-gpio");
  other.board.name = "kiama-north-k7m4x2";
  const home = other.signals.masts[0];
  other.logic = { mode: "field", masts: [{ mast: home.name, tags: { Stop: "stop", Caution: "approach", Clear: "clear" }, diverging: ["Caution"] }] };
  const snapshot = L.linkedBoardFromConfig(parseConfigFromYaml(generateYaml(normalizeConfig(other))));
  const snap = snapshot.signals.masts[0];
  // /State carries the JMRI aspect name (R292, not Stop), so the tags are keyed by it.
  assert.deepEqual(plain(snap.aspects).slice(0, 3), ["R292", "R285", "R281"]);
  assert.deepEqual(plain(snap.tags), { R292: "stop", R285: "approach", R281: "clear", R290: "stop" });
  assert.deepEqual(plain(snap.diverging), ["R285"]);

  const config = section(2);
  config.logic.remoteBoards = [snapshot];
  config.logic.layers[0].rules[1].checks = [{ board: "kiama-north-k7m4x2", mast: home.name, is: ["approach", "clear"] }];
  assert.deepEqual(errorsOf(config), []);
  assert.deepEqual(plain(L.logicTable(config).remote), {
    "kiama-north-k7m4x2": { masts: { [home.name]: { aspects: { R292: "stop", R285: "approach", R281: "clear", R290: "stop" }, diverging: ["R285"] } } },
  });
  const yaml = generateYaml(config);
  const id = L.resolveRemote(config, { board: "kiama-north-k7m4x2", mast: home.name }).id;
  assert.match(sectionOf(yaml, "text_sensor"), new RegExp(`id: ${id}\\n    internal: true\\n    topic: "?${home.topic}/State"?`));
  assert.ok(sectionOf(yaml, "mr_logic").endsWith([
    "  remote:",
    "    - board: kiama-north-k7m4x2",
    "      online: linked_kiama_north_k7m4x2_online",
    "      masts:",
    `        - name: ${EsphomeMr.yamlQuote(home.name)}`,
    `          state: ${id}`,
  ].join("\n")));
  // A mast is not a block member.
  config.logic.blocks = [{ name: "Far", topic: topicFor("block", "Far"), sensors: [{ board: "kiama-north-k7m4x2", mast: home.name }] }];
  assert.ok(errorsOf(config).some((e) => e.includes("A block is made of sensors: take the mast out")));
});

test("a board that logic does not tag shares its masts as stop", () => {
  const other = fixture("masts-gpio");
  other.board.name = "kiama-north-k7m4x2";
  other.logic = { share: true };
  const snapshot = L.linkedBoardFromConfig(parseConfigFromYaml(generateYaml(normalizeConfig(other))));
  assert.ok(Object.values(snapshot.signals.masts[0].tags).every((tag) => tag === "stop"));
});

test("JMRI XML: the Logic box adds the switch light, each Release turnout and each Held sensor", () => {
  const config = section(2);
  const { xml, counts } = generateJmriXml(config);
  if (yamlOut) fs.writeFileSync(path.join(yamlOut, "field-logic-section-2.xml"), xml);
  assert.match(xml, /<systemName>MSlogic\/gauntlet-k7m4x2\/Bridge\/Held<\/systemName>/);
  assert.match(xml, /<turnout feedback="DIRECT" inverted="false" automate="Default">\n      <systemName>MTlogic\/gauntlet-k7m4x2\/Bridge\/Release<\/systemName>/);
  assert.match(xml, /<lights class="jmri.jmrix.mqtt.configurexml.MqttLightManagerXml">\n    <light>\n      <systemName>MLlogic\/gauntlet-k7m4x2<\/systemName>\n    <\/light>\n  <\/lights>/);
  // The Release turnout has no /Thrown sensor.
  assert.doesNotMatch(xml, /Release\/Thrown/);
  assert.equal(counts.lights, 1);
  // Unticked: none of them, and the other boxes as before.
  const without = generateJmriXml(config, { logic: false }).xml;
  assert.doesNotMatch(without, /logic\/|<lights/);
  assert.equal(without, generateJmriXml(config, { logic: false }).xml);
  // MQTT off: none.
  assert.doesNotMatch(generateJmriXml(section(2, { mqtt: false })).xml, /logic\//);
});

test("mode None and Share alone write no component", () => {
  for (const name of ["my-first-board", "masts-gpio", "turnouts-pca"]) {
    const none = normalizeConfig(fixture(name));
    assert.doesNotMatch(generateYaml(none), /mr_logic|field_logic|Logic version/);
    const shared = normalizeConfig({ ...fixture(name), logic: { share: true } });
    assert.doesNotMatch(generateYaml(shared), /mr_logic|field_logic|Logic version/);
    assert.equal(L.logicTable(shared), null);
  }
});
