// Reference integrity (field logic spec, The Logic page): renaming a sensor,
// turnout or mast updates every reference on the Logic page; deleting one
// marks what used it invalid. Work item 1.7.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

const { EsphomeMr, EsphomeMrLogicYaml: L } = loadModules("generator.js", "logic-yaml.js");
const { generateYaml, normalizeConfig, validateConfig } = EsphomeMr;
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "fixtures", `${name}.json`), "utf8"));
}

function block(name, sensors) {
  return { name, topic: `trains/track/sensor/${name}`, topicCustom: false, sensors };
}

// The expander board in Field Logic, with blocks that share a boundary sensor
// and one member from a linked board of the same sensor name.
function board() {
  const config = fixture("expanders");
  const north = L.typedLinkedBoard("kiama-north-k7m4x2");
  north.blocks = [L.typedItem("sensor", "Int 2 East")];
  config.logic = {
    mode: "field",
    remoteBoards: [north],
    blocks: [
      block("Int 2", ["Kiama/Up XOver", "Int 2 East", { board: "kiama-north-k7m4x2", sensor: "Int 2 East" }]),
      block("Int 3", ["Int 2 East", "Int 2 West"]),
    ],
  };
  return normalizeConfig(config);
}

// Rename a sensor the way the Sensors page does: the item, then its references.
function renameSensor(config, from, to) {
  config.blocks.find((sensor) => sensor.name === from).name = to;
  return L.renameReferences(config, "sensor", from, to);
}

test("renaming a sensor renames it in every block", () => {
  const config = board();
  assert.equal(renameSensor(config, "Int 2 East", "Int 2 E"), 2);
  assert.deepEqual(plain(config.logic.blocks.map((b) => b.sensors)), [
    ["Kiama/Up XOver", "Int 2 E", { board: "kiama-north-k7m4x2", sensor: "Int 2 East" }],
    ["Int 2 E", "Int 2 West"],
  ]);
  assert.deepEqual([...validateConfig(config).errors], []);
});

test("another board's item with the same name is not this board's, and is left alone", () => {
  const config = board();
  renameSensor(config, "Int 2 East", "Int 2 E");
  assert.equal(config.logic.blocks[0].sensors[2].sensor, "Int 2 East");
  assert.equal(config.logic.remoteBoards[0].blocks[0].name, "Int 2 East", "the linked board's snapshot is its own");
});

test("the YAML after a rename is the YAML of a board built with the new name", () => {
  const renamed = board();
  renameSensor(renamed, "Int 2 West", "Int 2 W");
  const built = board();
  built.blocks.find((sensor) => sensor.name === "Int 2 West").name = "Int 2 W";
  built.logic.blocks[1].sensors[1] = "Int 2 W";
  assert.equal(generateYaml(renamed), generateYaml(built));
  assert.match(generateYaml(renamed), /id\(int_2_w_sensor\)\.state/);
});

test("renaming to the same name, or with nothing on the Logic page, changes nothing", () => {
  const config = board();
  const before = plain(config.logic);
  assert.equal(L.renameReferences(config, "sensor", "Int 2 East", "Int 2 East"), 0);
  assert.equal(L.renameReferences(config, "sensor", "", "x"), 0);
  assert.equal(L.renameReferences(config, "sensor", "Not used", "x"), 0);
  assert.equal(L.renameReferences(config, "point", "Int 2 East", "x"), 0, "kinds are sensor, turnout and mast");
  assert.deepEqual(plain(config.logic), before);
  const none = fixture("my-first-board");
  assert.equal(L.renameReferences(none, "sensor", "Kiama/Up XOver", "x"), 0);
  assert.equal(none.logic, undefined, "no logic key is made");
});

test("renaming to an empty name renames nothing", () => {
  const config = board();
  const before = plain(config.logic);
  for (const to of ["", "   ", undefined, null]) assert.equal(L.renameReferences(config, "sensor", "Int 2 East", to), 0);
  assert.deepEqual(plain(config.logic), before);
});

test("a sensor name is only renamed where a sensor is meant", () => {
  const config = board();
  config.logic.blocks[0].name = "Int 2 East";
  renameSensor(config, "Int 2 East", "Int 2 E");
  assert.equal(config.logic.blocks[0].name, "Int 2 East", "a block's own name is not a sensor reference");
});

// Rules, masts and plant ends come in later releases. The shapes below are
// from the spec's Stored format, which refers to items with these keys.
test("turnouts and masts are renamed in the stored format's mast, end and rule shapes", () => {
  const config = board();
  config.logic.masts = [{ mast: "Up Home", stopAspect: "R292" }];
  config.logic.ends = [{ name: "A", tracks: [{ sensors: ["Int 2 East"], mast: "Up Home" }] }];
  config.logic.layers = [{
    name: "Junction",
    rules: [{
      trigger: { while: { sensor: "Int 2 East", is: "occupied" } },
      checks: [{ turnout: "Kiama/Up Loop", is: "closed" }, { board: "kiama-north-k7m4x2", turnout: "Kiama/Up Loop", is: "closed" }],
      then: { mast: "Up Home", aspect: "Clear" },
    }],
  }];
  assert.equal(L.renameReferences(config, "mast", "Up Home", "Up Home 2"), 3);
  assert.equal(L.renameReferences(config, "turnout", "Kiama/Up Loop", "Up Loop"), 1);
  assert.equal(renameSensor(config, "Int 2 East", "Int 2 E"), 4);
  assert.deepEqual(plain(config.logic.masts), [{ mast: "Up Home 2", stopAspect: "R292" }]);
  assert.deepEqual(plain(config.logic.ends[0].tracks[0]), { sensors: ["Int 2 E"], mast: "Up Home 2" });
  const rule = plain(config.logic.layers[0].rules[0]);
  assert.deepEqual(rule.trigger.while, { sensor: "Int 2 E", is: "occupied" });
  assert.deepEqual(rule.checks, [
    { turnout: "Up Loop", is: "closed" },
    { board: "kiama-north-k7m4x2", turnout: "Kiama/Up Loop", is: "closed" },
  ]);
  assert.equal(rule.then.mast, "Up Home 2");
});

test("deleting a sensor marks the blocks that used it, by name, until fixed", () => {
  const config = board();
  config.blocks = config.blocks.filter((sensor) => sensor.name !== "Int 2 East");
  const { errors } = validateConfig(config);
  assert.deepEqual([...errors].filter((e) => e.includes('"Int 2 East"')), [
    'Block "Int 2" uses sensor "Int 2 East", which is not on the Sensors page. Pick another, or remove it.',
    'Block "Int 3" uses sensor "Int 2 East", which is not on the Sensors page. Pick another, or remove it.',
  ]);
  // The reference is kept, not dropped: the block reads occupied, never clear.
  assert.equal(config.logic.blocks[0].sensors[1], "Int 2 East");
  assert.match(plain(L.blockLambda(config, config.logic.blocks[1])).join("\n"), /(return|\|\|) true\b/);
  // Adding the sensor back fixes it.
  config.blocks.push({ ...fixture("expanders").blocks[1] });
  assert.deepEqual([...validateConfig(config).errors], []);
});

test("deleting a block's only sensor leaves it with a missing sensor, not an empty block", () => {
  const config = board();
  config.logic.blocks = [block("Main", ["Kiama/Up XOver"])];
  config.blocks = config.blocks.filter((sensor) => sensor.name !== "Kiama/Up XOver");
  const { errors } = validateConfig(config);
  assert.ok(errors.some((e) => e.startsWith('Block "Main" uses sensor "Kiama/Up XOver"')));
  assert.deepEqual(plain(L.blockLambda(config, config.logic.blocks[0])), ["return true;"]);
});

test("renaming an aspect moves its meaning, diverging tick, stop choice and the rules that show it", () => {
  const config = {
    signals: { masts: [{ name: "Home" }, { name: "Other" }] },
    logic: {
      mode: "field",
      masts: [
        { mast: "Home", tags: { R292: "stop", R281: "clear" }, diverging: ["R281"], stopAspect: "R292" },
        { mast: "Other", tags: { R292: "stop" }, stopAspect: "R292" },
      ],
      layers: [{ name: "G", rules: [
        { then: { mast: "Home", aspect: "R292" } },
        { then: { mast: "Other", aspect: "R292" } },
        { then: { mast: "Home", aspect: "R281" } },
      ] }],
    },
  };
  assert.equal(L.renameAspect(config, "Home", "R292", "Stop"), 3);
  assert.deepEqual(plain(config.logic.masts[0]), { mast: "Home", tags: { Stop: "stop", R281: "clear" }, diverging: ["R281"], stopAspect: "Stop" });
  // Another mast's aspect of the same name stays.
  assert.deepEqual(plain(config.logic.masts[1]), { mast: "Other", tags: { R292: "stop" }, stopAspect: "R292" });
  assert.deepEqual(plain(config.logic.layers[0].rules.map((r) => r.then.aspect)), ["Stop", "R292", "R281"]);
  assert.equal(L.renameAspect(config, "Home", "R281", "Clear"), 3);
  assert.deepEqual(plain(config.logic.masts[0].diverging), ["Clear"]);
  assert.equal(L.renameAspect(config, "Home", "Clear", " "), 0);
});

if (!process.exitCode) console.log("\nAll reference tests passed.");
