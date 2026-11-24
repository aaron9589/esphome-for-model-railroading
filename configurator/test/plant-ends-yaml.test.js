// Plant ends in the generated YAML (field logic spec, Plant ends and The
// component): the Link text entity, the Pair button and pin, the LED, the state
// text, the component's `ends:` bindings and the ends in the rule table.
// Work item 3.2. The page and its validation are 3.3.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

const ctx = loadModules("generator.js", "logic-yaml.js");
const { EsphomeMr, EsphomeMrLogicYaml: L } = ctx;
const { generateYaml, normalizeConfig, validateConfig, topicFor } = EsphomeMr;

function board({ ends, mqtt = true, mode = "field" } = {}) {
  const config = normalizeConfig(JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "fixtures", "masts-gpio.json"), "utf8")));
  config.board.name = "kiama-mid-k7m4x2";
  config.board.nameSuffix = "k7m4x2";
  config.board.mqttEnabled = mqtt;
  config.blocks = ["Home in", "Siding"].map((name, i) => ({
    name, topic: topicFor("block", name), topicCustom: false, gpio: ["GPIO14", "GPIO27"][i], inverted: true, debounce: "500ms",
  }));
  const first = config.signals.masts[0];
  config.logic = { mode, masts: [{ mast: first.name, tags: {} }] };
  if (ends) config.logic.ends = ends;
  return { config, mastName: first.name };
}

function twoTracks(mastName, extra = {}) {
  return [{ name: "A", tracks: [{ sensors: ["Home in"], mast: mastName }, { sensors: ["Siding"], through: { end: "A", track: 1 } }], ...extra }];
}

test("an end writes its Link text, state, Pair button, Pair pin, LED and component binding", () => {
  const { config, mastName } = board();
  config.logic.ends = twoTracks(mastName, { pairPin: "gpio17", ledPin: "GPIO33" });
  const yaml = generateYaml(config);
  assert.match(yaml, /\ntext:\n  - platform: template\n    id: end_a_link\n    name: "End A link"\n    mode: text\n    max_length: 64\n    optimistic: true\n    restore_value: true\n/);
  assert.match(yaml, /  - platform: template\n    id: end_a_state\n    name: "End A state"\n/);
  assert.match(yaml, /  - platform: template\n    name: "Pair End A"\n    on_press:\n      - lambda: \|-\n          id\(logic\)\.pair\("A"\);\n/);
  assert.match(yaml, /  - platform: gpio\n    pin:\n      number: GPIO17\n      inverted: true\n      mode:\n        input: true\n        pullup: true\n    id: end_a_pair_pin\n/);
  assert.match(yaml, /  - platform: gpio\n    pin: GPIO33\n    id: end_a_led\n    name: "End A LED"\n    internal: true\n/);
  assert.match(yaml, /  ends:\n    - name: A\n      link: end_a_link\n      led: end_a_led\n      state: end_a_state\n/);
  // The mast on the end's track is bound, though no rule uses it.
  assert.match(yaml, /  masts:\n    - name: /);
  assert.deepEqual(JSON.parse(JSON.stringify(validateConfig(config).errors)), []);
});

test("an end with no pins writes neither the Pair pin nor the LED", () => {
  const { config, mastName } = board();
  config.logic.ends = twoTracks(mastName);
  const yaml = generateYaml(config);
  assert.doesNotMatch(yaml, /end_a_pair_pin|end_a_led/);
  assert.match(yaml, /  ends:\n    - name: A\n      link: end_a_link\n      state: end_a_state\n/);
  assert.match(yaml, /"Pair End A"/);
});

test("the table holds each end's name and tracks, not its pins, and the version code covers them", () => {
  const { config, mastName } = board();
  const without = L.versionCode(config);
  config.logic.ends = twoTracks(mastName, { pairPin: "GPIO17", ledPin: "GPIO33" });
  const table = L.logicTable(config);
  assert.deepEqual(JSON.parse(JSON.stringify(table.logic.ends)), [{ name: "A", tracks: [{ mast: mastName, sensors: ["Home in"] }, { sensors: ["Siding"], through: { end: "A", track: 1 } }] }]);
  const withEnds = L.versionCode(config);
  assert.notEqual(withEnds, without);
  // A pin is for the board, not the engine: moving it does not change the rules.
  config.logic.ends[0].pairPin = "GPIO18";
  config.logic.ends[0].ledPin = "";
  assert.equal(L.versionCode(config), withEnds);
  // Changing a track does.
  config.logic.ends[0].tracks[1].through.track = 2;
  assert.notEqual(L.versionCode(config), withEnds);
});

test("a board without ends writes none of it", () => {
  const { config } = board();
  const yaml = generateYaml(config);
  assert.doesNotMatch(yaml, /^text:|end_a_|Pair End|\n  ends:/m);
  assert.equal(L.logicTable(config).logic.ends, undefined);
  // Stored ends with mode None write nothing.
  const none = board({ mode: "none" });
  none.config.logic.ends = twoTracks(none.mastName);
  assert.doesNotMatch(generateYaml(none.config), /mr_logic|end_a_/);
});

test("two ends have their own ids, in end order", () => {
  const { config, mastName } = board();
  config.logic.ends = [...twoTracks(mastName, { ledPin: "GPIO33" }), { name: "B", tracks: [{ sensors: ["Siding"] }], pairPin: "GPIO17" }];
  const yaml = generateYaml(config);
  assert.match(yaml, /  ends:\n    - name: A\n      link: end_a_link\n      led: end_a_led\n      state: end_a_state\n    - name: B\n      link: end_b_link\n      state: end_b_state\n/);
  assert.match(yaml, /id\(logic\)\.pair\("B"\)/);
});

test("with MQTT disabled, an end still generates (3.3 reports it as an error) and validation does not fail", () => {
  const { config, mastName } = board({ mqtt: false });
  config.logic.ends = twoTracks(mastName, { pairPin: "GPIO17", ledPin: "GPIO33" });
  const yaml = generateYaml(config);
  assert.match(yaml, /  ends:\n/);
  assert.doesNotMatch(yaml, /^  board:/m);
  assert.doesNotThrow(() => validateConfig(config));
});
