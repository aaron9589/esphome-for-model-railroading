// The Plant ends part of the Logic page (field logic spec, Plant ends; work
// item 3.3): its pure functions, validation, expander Pair and LED pins in the
// YAML, end conditions and block members, and the starters' plant-end option.
import assert from "node:assert/strict";
import { loadModules, test } from "./harness.js";

const FILES = ["generator.js", "logic-yaml.js", "logic.js", "logic-ui.js", "logic-ui-masts.js", "logic-ui-ends.js", "logic-ui-rules.js", "logic-ui-views.js", "logic-ui-start.js", "logic-starters.js", "logic-starters-sections.js", "logic-starters-signals.js"];
const context = loadModules(...FILES);
const { EsphomeMr, EsphomeMrLogicYaml: L, EsphomeMrLogic: Engine, EsphomeMrLogicStarters: S, EsphomeMrLogicUiEnds: E, EsphomeMrLogicUiRules: R, EsphomeMrLogicUi: Ui } = context;
const { generateYaml, myFirstBoardPreset, topicFor, validateConfig } = EsphomeMr;

const plain = (value) => JSON.parse(JSON.stringify(value));
const same = (actual, expected, ...message) => assert.deepEqual(plain(actual), plain(expected), ...message);

const lamp = (color) => ({ color, mode: "steady" });
function mast(name, aspects, pin) {
  return {
    name, topic: topicFor("signal", name), topicCustom: false, mode: "addressable", pin,
    lamps: [{ name: "Head", count: 1 }],
    aspects: aspects.map((label, i) => ({ label, states: [`${label}; Lit; Unheld`], ...(i === 0 ? { startup: true } : {}), lamps: [lamp(i === 0 ? "red" : "green")] })),
  };
}

// A Field Logic board with sensors Home in, Siding, Main, two signals and an
// expander, and no ends.
function board() {
  const config = myFirstBoardPreset();
  config.board.name = "kiama-mid-k7m4x2";
  config.board.nameSuffix = "k7m4x2";
  config.blocks = ["Home in", "Siding", "Main"].map((name, i) => ({
    name, topic: topicFor("block", name), topicCustom: false, gpio: ["GPIO14", "GPIO27", "GPIO26"][i], inverted: true, debounce: "500ms",
  }));
  config.points = [];
  config.pcaBoards = [];
  config.expanders = [{ name: "MCP 1", address: "0x20", sda: "GPIO21", scl: "GPIO22" }];
  config.signals = { mode: "addressable", masts: [mast("Home", ["R292", "R285", "R281"], "GPIO16"), mast("Exit", ["R292", "R285", "R281"], "GPIO17")] };
  config.logic = { mode: "field", masts: [] };
  return config;
}

const errorsOf = (config) => validateConfig(config).errors;
const withEnds = (ends) => { const config = board(); config.logic.ends = ends; return config; };
const goodEnds = () => [
  { name: "A", tracks: [{ sensors: ["Home in"], mast: "Home" }, { sensors: ["Siding"], through: { end: "B", track: 1 } }] },
  { name: "B", tracks: [{ sensors: ["Main"], mast: "Exit" }] },
];

// ===== Pure functions ======================================================

test("add and remove ends and tracks; names run A, B, C", () => {
  const config = board();
  assert.equal(E.addEnd(config).name, "A");
  assert.equal(E.addEnd(config).name, "B");
  E.removeEnd(config, 0);
  assert.equal(E.freeEndName(config), "A");
  const end = config.logic.ends[0];
  E.addTrack(end);
  same(end.tracks, [{ sensors: [], mast: "" }, { sensors: [], mast: "" }]);
});

test("a track meets a signal or passes through; sensors are added once", () => {
  const track = { sensors: [], mast: "Home" };
  E.setTrackKind(track, "through");
  same(track, { sensors: [], through: { end: "", track: 1 } });
  assert.equal(E.trackKind(track), "through");
  E.setTrackKind(track, "mast");
  same(track, { sensors: [], mast: "" });
  E.addTrackSensor(track, "Home in");
  E.addTrackSensor(track, "Home in");
  same(track.sensors, ["Home in"]);
  E.removeTrackSensor(track, 0);
  same(track.sensors, []);
  const config = withEnds(goodEnds());
  same(E.sensorChoices(config, { sensors: ["Home in"] }), ["Siding", "Main"]);
});

test("a pass-through can name any track but itself", () => {
  const config = withEnds(goodEnds());
  const end = config.logic.ends[0];
  same(E.throughChoices(config, end, 1).map((c) => c.value), [{ end: "A", track: 1 }, { end: "B", track: 1 }]);
});

test("renaming an end moves rules, block members and pass-throughs, not when another end has the name", () => {
  const config = withEnds(goodEnds());
  config.logic.blocks = [{ name: "Joint", sensors: ["Main", { end: "B", track: 1 }] }];
  config.logic.layers = [{ name: "G", rules: [{ trigger: { while: { end: "B", track: 1, hears: "mast", is: "clear" } }, checks: [], then: {} }] }];
  config.logic.ends[1].name = "East";
  assert.equal(L.renameEnd(config, "B", "East"), 3);
  same(config.logic.ends[0].tracks[1].through, { end: "East", track: 1 });
  same(config.logic.blocks[0].sensors[1], { end: "East", track: 1 });
  assert.equal(config.logic.layers[0].rules[0].trigger.while.end, "East");
  // Another end still named A: nothing moves.
  config.logic.ends.push({ name: "A", tracks: [] });
  config.logic.blocks[0].sensors.push({ end: "A", track: 1 });
  assert.equal(L.renameEnd(config, "A", "Z"), 0);
  assert.equal(L.renameEnd(config, "East", ""), 0);
});

test("removing a track renumbers the references to the ones after it", () => {
  const config = withEnds(goodEnds());
  config.logic.ends[0].tracks.push({ sensors: ["Main"], mast: "Exit" });
  config.logic.blocks = [{ name: "Joint", sensors: [{ end: "A", track: 3 }, { end: "A", track: 1 }] }];
  E.removeTrack(config, config.logic.ends[0], 1);
  same(config.logic.blocks[0].sensors, [{ end: "A", track: 2 }, { end: "A", track: 1 }]);
});

test("pin choices: ESP and expander, free ones only, an end's own pin kept, shared with the buttons", () => {
  const config = withEnds(goodEnds());
  const end = config.logic.ends[0];
  const values = (which) => E.pinChoices(config, end, which).map((c) => c.value);
  assert.ok(values("pair").includes(""));
  assert.ok(!values("pair").includes("GPIO14"), "a sensor's pin is not offered");
  assert.ok(values("pair").includes("mcp:0:0"));
  E.setPin(config, end, "pair", "GPIO32");
  same([end.pairPin, end.pairExpander], ["GPIO32", undefined]);
  assert.ok(values("pair").includes("GPIO32"), "its own pin stays");
  assert.ok(!values("led").includes("GPIO32"), "the Pair pin is not offered to the LED");
  E.setPin(config, end, "led", "mcp:0:3");
  same([end.ledExpander, end.ledPin], ["MCP 1", 3]);
  assert.equal(E.pinValue(config, end, "led"), "mcp:0:3");
  assert.ok(!E.pinChoices(config, config.logic.ends[1], "pair").some((c) => c.value === "mcp:0:3"), "another end cannot take it");
  // A rule button cannot take the end's pins either.
  assert.ok(!context.EsphomeMrLogicUiMasts.buttonPinChoices(config, { pin: "" }).some((c) => c.value === "GPIO32" || c.value === "mcp:0:3"));
  E.setPin(config, end, "led", "");
  same([end.ledExpander, end.ledPin], [undefined, undefined]);
});

// ===== Validation ==========================================================

test("a good set of ends has no errors", () => {
  same(errorsOf(withEnds(goodEnds())), []);
});

test("each end has a name and a track; each track has sensors and a signal, or passes through", () => {
  const messages = errorsOf(withEnds([
    { name: "", tracks: [] },
    { name: "A", tracks: [] },
    { name: "A", tracks: [{ sensors: [], mast: "" }, { sensors: ["Gone"], mast: "Nope" }, {}] },
  ])).join("\n");
  assert.match(messages, /An end has no name/);
  assert.match(messages, /End "A" has no tracks/);
  assert.match(messages, /Two ends are called "A"/);
  assert.match(messages, /End "A" track 1 has no end sensors/);
  assert.match(messages, /End "A" track 1 has no first signal/);
  assert.match(messages, /track 2 uses sensor "Gone"/);
  assert.match(messages, /track 2 uses signal "Nope"/);
  assert.match(messages, /track 3 has no end sensors/);
});

test("pass-throughs name a track that exists, not themselves, and do not go in circles", () => {
  const messages = errorsOf(withEnds([
    { name: "A", tracks: [{ through: { end: "B", track: 1 } }, { through: { end: "Z", track: 1 } }, { through: { end: "B", track: 5 } }, { through: { end: "A", track: 4 } }] },
    { name: "B", tracks: [{ through: { end: "A", track: 1 } }] },
  ])).join("\n");
  assert.match(messages, /End "A" track 2 passes through to end "Z", which is not under Plant ends/);
  assert.match(messages, /track 3 passes through to track 5 of end "B", which has 1 track/);
  assert.match(messages, /End "A" track 1 passes through in a circle/);
  assert.match(messages, /End "B" track 1 passes through in a circle/);
  assert.match(errorsOf(withEnds([{ name: "A", tracks: [{ through: { end: "A", track: 1 } }] }])).join("\n"), /passes through to itself/);
});

test("ends need MQTT and Share, and say why; every message links to the part", () => {
  const config = withEnds(goodEnds());
  config.logic.share = false;
  const result = validateConfig(config);
  const share = result.errors.find((e) => /Plant ends need Share with other boards/.test(e));
  assert.ok(share);
  assert.match(share, /finds out that this one is on the network/);
  same(result.links.get(share), { view: "logic", part: "logic-ends" });
  config.logic.share = true;
  config.board.mqttEnabled = false;
  const mqtt = validateConfig(config).errors.find((e) => /Plant ends need MQTT/.test(e));
  assert.ok(mqtt);
  same(validateConfig(config).links.get(mqtt), { view: "logic", part: "logic-ends" });
});

test("a rule or a block reading an end track that is not there is an error", () => {
  const config = withEnds(goodEnds());
  config.logic.blocks = [{ name: "Joint", topic: topicFor("block", "Joint"), sensors: ["Main", { end: "A", track: 9 }] }];
  config.logic.layers = [{ name: "G", rules: [
    { trigger: { while: { end: "Q", track: 1, hears: "block", is: "clear" } }, checks: [], then: { mast: "Home", aspect: "R281" } },
    { trigger: { while: { end: "A", track: 1, hears: "mast", is: "diverging" } }, checks: [], then: { mast: "Exit", aspect: "R281" } },
  ] }];
  const messages = errorsOf(config).join("\n");
  assert.match(messages, /Block "Joint" has what end "A" track 9 hears, which is not under Plant ends/);
  assert.match(messages, /reads what end "Q" track 1 hears, which is not under Plant ends/);
  assert.match(messages, /asks whether what end "A" track 1 hears is "diverging"/);
});

test("pins: a Pair or LED pin another part uses, an input-only LED pin and a used expander pin are errors", () => {
  const config = withEnds(goodEnds());
  config.logic.ends[0].pairPin = "GPIO14";
  config.logic.ends[0].ledPin = "GPIO34";
  config.logic.ends[1].pairExpander = "MCP 1";
  config.logic.ends[1].pairPin = 4;
  config.logic.ends[1].ledExpander = "MCP 1";
  config.logic.ends[1].ledPin = 4;
  const messages = errorsOf(config).join("\n");
  assert.match(messages, /Pair button of end "A" is on GPIO14, which "Home in" already uses/);
  assert.match(messages, /LED of end "A": LED pin GPIO34/);
  assert.match(messages, /MCP 1 pin A4 is used by "Pair button on end B" and LED of end "B"/);
  config.logic.ends[1].ledPin = 5;
  config.logic.ends[0].pairPin = "GPIO32";
  config.logic.ends[0].ledPin = "GPIO33";
  same(errorsOf(config), []);
});

// ===== The YAML: expander pins =============================================

test("a Pair button and an LED on an expander use mcp23xxx pins", () => {
  const config = withEnds(goodEnds());
  Object.assign(config.logic.ends[0], { pairExpander: "MCP 1", pairPin: 2, ledExpander: "MCP 1", ledPin: 3 });
  const yaml = generateYaml(config);
  assert.match(yaml, /  - platform: gpio\n    pin:\n      mcp23xxx: mcp23017_1\n      number: 2\n      inverted: true\n      mode:\n        input: true\n        pullup: true\n    id: end_a_pair_pin\n/);
  assert.match(yaml, /  - platform: gpio\n    pin:\n      mcp23xxx: mcp23017_1\n      number: 3\n      mode:\n        output: true\n    id: end_a_led\n    name: "End A LED"\n    internal: true\n/);
  assert.match(yaml, /      led: end_a_led\n/);
  assert.match(yaml, /mcp23017:\n/);
});

test("ESP pins for ends are written as before", () => {
  const config = withEnds(goodEnds());
  Object.assign(config.logic.ends[0], { pairPin: "gpio32", ledPin: "GPIO33" });
  const yaml = generateYaml(config);
  assert.match(yaml, /      number: GPIO32\n      inverted: true/);
  assert.match(yaml, /    pin: GPIO33\n    id: end_a_led\n/);
});

// ===== Reading what an end hears: choices, rules, blocks, starters ==========

test("item choices: what each end track hears, for rules, blocks and next signals", () => {
  const config = withEnds(goodEnds());
  same(Ui.itemChoices(config, "end")[0].options.map((o) => o.value), [
    { end: "A", track: 1, hears: "block" }, { end: "A", track: 1, hears: "mast" },
    { end: "A", track: 2, hears: "block" }, { end: "A", track: 2, hears: "mast" },
    { end: "B", track: 1, hears: "block" }, { end: "B", track: 1, hears: "mast" },
  ]);
  same(Ui.itemChoices(config, "endMast")[0].options.map((o) => o.value), [{ end: "A", track: 1 }, { end: "A", track: 2 }, { end: "B", track: 1 }]);
  same(Ui.itemChoices(board(), "endMast"), []);
  const blocks = context.EsphomeMrLogicUi.itemChoices(config, "endBlock");
  assert.equal(blocks[0].options.length, 3);
});

test("rule conditions: an end track's block or signal, with words that fit", () => {
  const config = withEnds(goodEnds());
  const groups = R.conditionItemChoices(config);
  const group = groups.find((g) => g.options.some((o) => o.value.end !== undefined));
  assert.ok(group);
  const ref = { end: "A", track: 1, hears: "mast" };
  const leaf = R.setConditionItem({ block: "Main", is: "occupied" }, ref);
  same(leaf, { end: "A", track: 1, hears: "mast", is: "clear" });
  same(R.conditionRef(leaf), ref);
  same(R.isWordsOf(leaf), ["stop", "restricting", "approach", "advance", "clear"]);
  const block = R.setConditionItem(leaf, { end: "A", track: 1, hears: "block" });
  same(block, { end: "A", track: 1, hears: "block", is: "occupied" });
  same(R.isWordsOf(block), ["occupied", "clear"]);
  same(R.setConditionItem({ end: "A", track: 1, hears: "block", is: "clear" }, { end: "B", track: 1, hears: "block" }).is, "clear");
  const toggled = R.toggleMeaning(leaf, "approach", true);
  same(toggled.is, ["approach", "clear"]);
});

test("a block can include what an end hears, and the engine reads it", () => {
  const config = withEnds(goodEnds());
  config.logic.blocks = [{ name: "Joint", topic: topicFor("block", "Joint"), topicCustom: false, sensors: ["Main", { end: "B", track: 1 }] }];
  same(errorsOf(config), []);
  same(Ui.itemChoices(config, "endBlock")[0].options.map((o) => o.value)[2], { end: "B", track: 1 });
  const yaml = generateYaml(config);
  assert.match(yaml, /joint_block/);
  // The engine: a Joint made of Main and what end A track 1 hears.
  config.logic.blocks[0].sensors = ["Main", { end: "A", track: 1 }];
  const engine = Engine.createEngine(L.logicTable(config), { logic: "on", broker: "connected", board: "kiama-mid-k7m4x2" });
  engine.scan();
  engine.event({ end: "A", link: "east-y/B" });
  engine.event({ end: "A", online: true });
  engine.event({ end: "A", theirLink: "kiama-mid-k7m4x2/A" });
  engine.event({ end: "A", track: 2, block: "clear" });
  engine.scan();
  assert.equal(engine.state().ends.A, "heard");
});

function planted(answers) {
  const config = withEnds([{ name: "A", tracks: [{ sensors: ["Home in"], mast: "Home" }] }]);
  config.logic.ends[0].tracks.push({ sensors: ["Siding"], mast: "Exit" });
  return { config, answers: { ...S.defaults("block-signals", config), ...answers } };
}

test("Block signals: beyond the last block can be what an end hears; the engine follows it", () => {
  const { config, answers } = planted({
    name: "Up", rows: [{ mast: "Home", block: "Main", turnouts: [], aspects: {} }], beyond: "mast", nextMast: { end: "A", track: 2 },
  });
  same(S.problems("block-signals", config, answers), []);
  S.apply("block-signals", config, answers);
  const rules = config.logic.layers[0].rules;
  same(rules.map((r) => r.checks[0]), [
    { end: "A", track: 2, hears: "mast", is: ["advance", "clear"] },
    { end: "A", track: 2, hears: "mast", is: "approach" },
    { end: "A", track: 2, hears: "mast", is: ["stop", "restricting"] },
  ]);
  same(errorsOf(config), []);
  const engine = Engine.createEngine(L.logicTable(config), { logic: "on", broker: "connected", board: "kiama-mid-k7m4x2" });
  engine.scan();
  // Unheard: stop ahead reads as Stop, so Approach.
  engine.scan();
  assert.equal(engine.state().masts.Home, "R285");
  engine.event({ end: "A", link: "east-y/B" });
  engine.event({ end: "A", online: true });
  engine.event({ end: "A", theirLink: "kiama-mid-k7m4x2/A" });
  // Our track 2 of 2 meets their track 1 of... theirs has 2 tracks too.
  engine.event({ end: "A", track: 1, mast: "clear" });
  engine.scan();
  engine.scan();
  assert.equal(engine.state().masts.Home, "R281", "a clear signal ahead, heard through the end");
});

test("Route signal: a following route can read what an end hears", () => {
  const { config } = planted({});
  const answers = {
    ...S.defaults("route-signal", config), mast: "Home", name: "Out",
    rows: [{ turnouts: [], blocks: ["Main"], diverging: false, follow: true, aspect: "", next: { end: "A", track: 1 }, aspects: {} }],
  };
  same(S.problems("route-signal", config, answers), []);
  S.apply("route-signal", config, answers);
  const rules = config.logic.layers[0].rules;
  assert.ok(rules.every((r) => r.checks.some((c) => c.end === "A" && c.hears === "mast")));
  same(errorsOf(config), []);
});

test("the later-version hint is gone", () => {
  assert.doesNotMatch(context.EsphomeMrLogicStartersSignals.TEXT.beyondHint, /later version/);
});
