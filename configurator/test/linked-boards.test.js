// Linked boards and remote inputs (field logic spec, Remote inputs and
// Inputs). Work item 1.5.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

const { EsphomeMr, EsphomeMrLogicYaml: L } = loadModules("generator.js", "logic-yaml.js");
const { generateYaml, normalizeConfig, parseConfigFromYaml, validateConfig } = EsphomeMr;

const yamlOut = process.env.ESPHOME_YAML_OUT;
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "fixtures", `${name}.json`), "utf8"));
}

// kiama-north: a board that shares, as another board would link it.
function northFile() {
  const north = fixture("turnouts-pca");
  north.board.name = "kiama-north-k7m4x2";
  north.logic = { mode: "field" };
  return generateYaml(north);
}

function linked() {
  return L.linkedBoardFromConfig(parseConfigFromYaml(northFile()));
}

// This board, in Field Logic, with kiama-north linked and a block using it.
function board(members) {
  const config = fixture("my-first-board");
  config.logic = { mode: "field", remoteBoards: [linked()], blocks: [{ name: "Junction", sensors: members }] };
  return config;
}

function errorsOf(config) {
  return [...validateConfig(normalizeConfig(config)).errors];
}

test("a linked board keeps names, topics and whether it shares; never its Wi-Fi or keys", () => {
  const snapshot = linked();
  assert.equal(snapshot.name, "kiama-north-k7m4x2");
  assert.equal(snapshot.share, true);
  assert.deepEqual(plain(snapshot.blocks), [{ name: "Junction Track", topic: "trains/track/sensor/Junction Track" }]);
  assert.equal(snapshot.points.length, 4);
  assert.deepEqual(plain(snapshot.points[3]), { name: "Goods Shed", topic: "trains/goods/shed" });
  const text = JSON.stringify(snapshot);
  assert.doesNotMatch(text, /password|apiKey|wifi|GoldenFixture|not-a-real/i);
});

test("a board that does not share is linked as not sharing", () => {
  const quiet = L.linkedBoardFromConfig(parseConfigFromYaml(generateYaml(fixture("sensors"))));
  assert.equal(quiet.share, false);
  const off = fixture("mqtt-off");
  off.logic = { share: true };
  assert.equal(L.linkedBoardFromConfig(off).share, false, "sharing with MQTT off reaches nobody");
});

test("a typed board's items follow the standard topics", () => {
  const typed = L.typedLinkedBoard(" yard-ab12cd ");
  assert.equal(typed.name, "yard-ab12cd");
  assert.equal(typed.typed, true);
  assert.deepEqual(plain(L.typedItem("sensor", " Up Main ")), { name: "Up Main", topic: "trains/track/sensor/Up Main" });
  assert.deepEqual(plain(L.typedItem("turnout", "Yard Points")), { name: "Yard Points", topic: "trains/track/turnout/Yard Points" });
});

test("Refresh says what changed in a linked board's file", () => {
  const before = linked();
  const after = plain(before);
  after.blocks.push({ name: "Siding", topic: "trains/track/sensor/Siding" });
  after.points[0].topic = "trains/track/turnout/Elsewhere";
  after.points.splice(1, 1);
  after.share = false;
  assert.deepEqual(plain(L.linkedBoardChanges(before, after)), [
    'new sensor "Siding"',
    'turnout "Junction/Up Loop" has a new topic',
    'turnout "Junction/Down Loop" is gone',
    "it no longer shares",
  ]);
  assert.deepEqual(plain(L.linkedBoardChanges(before, plain(before))), []);
});

test("linking a board adds nothing to the YAML until something uses it", () => {
  const config = fixture("my-first-board");
  config.logic = { mode: "field", share: false, remoteBoards: [linked()] };
  const yaml = generateYaml(config);
  assert.doesNotMatch(yaml, /linked_/);
  const without = fixture("my-first-board");
  without.logic = { mode: "field", share: false };
  // Only the config comment differs.
  assert.equal(yaml.split("\n").slice(2).join("\n"), generateYaml(without).split("\n").slice(2).join("\n"));
});

test("a remote sensor: its /State and its board's Online are subscribed", () => {
  const config = board([{ board: "kiama-north-k7m4x2", sensor: "Junction Track" }]);
  assert.deepEqual(errorsOf(config), []);
  assert.deepEqual(plain([...L.remoteSubscriptions(config)]), [
    ["linked_kiama_north_k7m4x2_online", "trains/track/sensor/board/kiama-north-k7m4x2/Online"],
    ["linked_kiama_north_k7m4x2_sensor_junction_track", "trains/track/sensor/Junction Track/State"],
  ]);
  const yaml = generateYaml(config);
  if (yamlOut) fs.writeFileSync(path.join(yamlOut, "linked-sensor.yaml"), yaml);
  assert.match(yaml, /  - platform: mqtt_subscribe\n    id: linked_kiama_north_k7m4x2_online\n    internal: true\n    topic: trains\/track\/sensor\/board\/kiama-north-k7m4x2\/Online\n  - platform: mqtt_subscribe\n    id: linked_kiama_north_k7m4x2_sensor_junction_track\n    internal: true\n    topic: "trains\/track\/sensor\/Junction Track\/State"\n/);
});

test("a remote turnout: /Thrown and /Moving, and the Online topic only once", () => {
  const config = board([
    { board: "kiama-north-k7m4x2", turnout: "Goods Shed" },
    { board: "kiama-north-k7m4x2", sensor: "Junction Track" },
  ]);
  const subs = [...L.remoteSubscriptions(config)];
  assert.deepEqual(subs.map(([, topic]) => topic), [
    "trains/track/sensor/board/kiama-north-k7m4x2/Online",
    "trains/goods/shed/Thrown",
    "trains/goods/shed/Moving",
    "trains/track/sensor/Junction Track/State",
  ]);
});

test("a remote input is clear only when known and INACTIVE; not known reads occupied", () => {
  const config = board([{ board: "kiama-north-k7m4x2", sensor: "Junction Track" }]);
  const expr = L.remoteOccupiedExpr(config, config.logic.blocks[0].sensors[0]);
  assert.equal(expr, '!((id(mqtt_server).is_connected() && id(linked_kiama_north_k7m4x2_online).has_state() && id(linked_kiama_north_k7m4x2_online).state == "ACTIVE" && id(linked_kiama_north_k7m4x2_sensor_junction_track).has_state() && !id(linked_kiama_north_k7m4x2_sensor_junction_track).state.empty()) && id(linked_kiama_north_k7m4x2_sensor_junction_track).state == "INACTIVE")');
  // A reference that does not resolve is occupied.
  assert.equal(L.remoteOccupiedExpr(config, { board: "nowhere", sensor: "x" }), "true");
});

test("a remote turnout is in a position only when known and not moving", () => {
  const config = board([{ board: "kiama-north-k7m4x2", turnout: "Goods Shed" }]);
  const ref = config.logic.blocks[0].sensors[0];
  const thrown = L.remoteTurnoutExpr(config, ref, true);
  assert.match(thrown, /id\(linked_kiama_north_k7m4x2_turnout_goods_shed_moving\).state == "INACTIVE"/);
  assert.match(thrown, /id\(linked_kiama_north_k7m4x2_turnout_goods_shed_thrown\).state == "ACTIVE"\)$/);
  assert.match(L.remoteTurnoutExpr(config, ref, false), /_thrown\).state == "INACTIVE"\)$/);
  assert.equal(L.remoteTurnoutExpr(config, { board: "nowhere", turnout: "x" }, true), "false");
});

test("remote inputs need MQTT, a sharing board, and an item that is there", () => {
  const off = board([{ board: "kiama-north-k7m4x2", sensor: "Junction Track" }]);
  off.board.mqttEnabled = false;
  off.logic.share = false;
  assert.ok(errorsOf(off).some((e) => e.includes("Items from other boards need MQTT")));
  const gone = board([{ board: "kiama-north-k7m4x2", sensor: "Nope" }]);
  assert.ok(errorsOf(gone).some((e) => e.includes('sensor "Nope" is not on kiama-north-k7m4x2. Refresh the linked board')));
  const unknown = board([{ board: "kiama-south", sensor: "Up" }]);
  assert.ok(errorsOf(unknown).some((e) => e.includes('board "kiama-south", which is not under Linked boards')));
  const quiet = board([{ board: "kiama-north-k7m4x2", sensor: "Junction Track" }]);
  quiet.logic.remoteBoards[0].share = false;
  assert.ok(errorsOf(quiet).some((e) => e.includes('Board "kiama-north-k7m4x2" does not share')));
});

test("a linked board cannot be this board, or be linked twice", () => {
  const config = board([]);
  config.logic.remoteBoards.push(linked());
  assert.ok(errorsOf(config).some((e) => e.includes("is linked twice")));
  const self = board([]);
  self.logic.remoteBoards[0].name = "my-first-board";
  assert.ok(errorsOf(self).some((e) => e.includes("this board's own name")));
});

test("remote inputs are only for Field Logic", () => {
  const config = board([{ board: "kiama-north-k7m4x2", sensor: "Junction Track" }]);
  delete config.logic.mode;
  assert.deepEqual([...L.remoteRefsUsed(config)], []);
  assert.doesNotMatch(generateYaml(config), /linked_/);
});

test("linked boards survive download and import", () => {
  const config = board([{ board: "kiama-north-k7m4x2", sensor: "Junction Track" }]);
  const yaml = generateYaml(config);
  const restored = normalizeConfig(parseConfigFromYaml(yaml));
  assert.deepEqual(plain(restored.logic.remoteBoards), plain(config.logic.remoteBoards));
  assert.equal(generateYaml(restored), yaml);
});

test("two remote items whose ids would be the same each get their own", () => {
  const config = board([
    { board: "kiama-north-k7m4x2", sensor: "Up Main" },
    { board: "kiama-north-k7m4x2", sensor: "Up-Main" },
    { board: "kiama-north-k7m4x2", sensor: "Junction Track" },
  ]);
  const north = config.logic.remoteBoards[0];
  north.blocks.push({ name: "Up Main", topic: "trains/track/sensor/Up Main" }, { name: "Up-Main", topic: "trains/track/sensor/Up-Main" });
  const subs = new Map(L.remoteSubscriptions(config));
  assert.equal(subs.size, 4, "Online and three sensors");
  assert.deepEqual([...subs.values()].slice(1).sort(), [
    "trains/track/sensor/Junction Track/State",
    "trains/track/sensor/Up Main/State",
    "trains/track/sensor/Up-Main/State",
  ]);
  // Only the clashing pair is changed; the rest keep their readable ids.
  assert.ok(subs.has("linked_kiama_north_k7m4x2_sensor_junction_track"));
  assert.ok(!subs.has("linked_kiama_north_k7m4x2_sensor_up_main"));
  const [a, b] = config.logic.blocks[0].sensors.map((ref) => L.resolveRemote(config, ref).id);
  assert.notEqual(a, b);
  assert.ok(subs.has(a) && subs.has(b));
  assert.equal(L.resolveRemote(config, config.logic.blocks[0].sensors[0]).id, a, "the same every time");
});

test("boards whose names fold to one id keep separate Online subscriptions", () => {
  const config = board([{ board: "a-b", sensor: "Up" }, { board: "a--b", sensor: "Up" }]);
  config.logic.remoteBoards = ["a-b", "a--b"].map((name) => {
    const typed = L.typedLinkedBoard(name);
    typed.blocks = [L.typedItem("sensor", "Up")];
    return typed;
  });
  assert.deepEqual(errorsOf(config), []);
  const subs = new Map(L.remoteSubscriptions(config));
  assert.equal(subs.size, 4);
  assert.ok([...subs.values()].includes("trains/track/sensor/board/a-b/Online"));
  assert.ok([...subs.values()].includes("trains/track/sensor/board/a--b/Online"));
});

test("linked boards are checked only in Field Logic, where they are shown", () => {
  const config = board([]);
  config.logic.remoteBoards.push(L.typedLinkedBoard(""));
  assert.ok(errorsOf(config).some((e) => e.includes("A linked board has no name")));
  config.logic.mode = "none";
  assert.deepEqual(errorsOf(config), []);
});

test("typed names must work as MQTT topics", () => {
  const config = board([]);
  const typed = L.typedLinkedBoard("Kiama South");
  typed.blocks = ["+", "Up#Main", "Up/Main", "Up Main"].map((name) => L.typedItem("sensor", name));
  typed.points = [L.typedItem("turnout", "#")];
  config.logic.remoteBoards.push(typed);
  const { errors, warnings } = validateConfig(normalizeConfig(config));
  assert.ok(errors.some((e) => e.includes('Linked board "Kiama South" is not a board name')));
  assert.ok(errors.some((e) => e.includes('Sensor "+" on linked board')));
  assert.ok(errors.some((e) => e.includes('Sensor "Up#Main" on linked board')));
  assert.ok(errors.some((e) => e.includes('Turnout "#" on linked board')));
  assert.ok(warnings.some((w) => w.includes('Sensor "Up/Main" on linked board "Kiama South" has a /')));
  assert.ok(!errors.some((e) => e.includes('"Up Main"')));
});

test("a hand-edited file with a broken linked board imports without crashing", () => {
  const config = board([]);
  config.logic.remoteBoards = [null, "x", [], { name: "yard-ab12cd", typed: true, share: true, blocks: [null, { name: "Up", topic: "trains/track/sensor/Up" }], points: "no", logic: null }];
  normalizeConfig(config);
  assert.equal(config.logic.remoteBoards.length, 1);
  assert.deepEqual(plain(config.logic.remoteBoards[0].blocks), [{ name: "Up", topic: "trains/track/sensor/Up" }]);
  assert.deepEqual(plain(config.logic.remoteBoards[0].points), []);
  assert.doesNotThrow(() => validateConfig(config));
});

if (yamlOut) fs.mkdirSync(yamlOut, { recursive: true });
if (!process.exitCode) console.log("\nAll linked board tests passed.");
