// The Logic page's read-only views: Who uses what (the spec's layers view) and
// the control table. Work item 2.7c.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

// Every Logic page file, in index.html's order (as in logic-page.test.js).
const LOGIC_UI_FILES = ["generator.js", "logic-yaml.js", "logic.js", "logic-ui.js", "logic-ui-masts.js", "logic-ui-views.js", "logic-ui-start.js"];
const context = loadModules(...LOGIC_UI_FILES);
const { normalizeConfig, topicFor } = context.EsphomeMr;
const { TEXT, whoUses, controlTable } = context.EsphomeMrLogicUiViews;
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "fixtures", `${name}.json`), "utf8"));
}

const lamp = (color) => ({ color, mode: "steady" });

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

// A gauntlet (one-train section with approach locking, a field lock on P1),
// block signals that also set Left Bridge and read a signal with no lights
// and another board's block, and a group that only locks P1.
function gauntlet() {
  const config = fixture("turnouts-gpio");
  config.board.name = "gauntlet-k7m4x2";
  config.board.nameSuffix = "k7m4x2";
  config.blocks = ["Bridge", "Left", "Right"].map((name, i) => ({
    name, topic: topicFor("block", name), topicCustom: false, gpio: ["GPIO14", "GPIO27", "GPIO26"][i], inverted: true, debounce: "500ms",
  }));
  config.points = [{ ...config.points[0], name: "P1", topic: topicFor("point", "P1") }];
  config.signals = { mode: "gpio", masts: [mast("Left Bridge", ["GPIO32", "GPIO19"]), mast("Right Bridge", ["GPIO21", "GPIO22"])] };
  config.logic = {
    mode: "field",
    masts: [
      { mast: "Left Bridge", tags: { Stop: "stop", Clear: "clear" } },
      { mast: "Right Bridge", tags: { Stop: "stop", Clear: "clear" } },
      { virtual: true, name: "Up Int 2", topic: topicFor("signal", "Up Int 2"), aspects: ["Stop", "Approach", "Clear"], tags: { Stop: "stop", Approach: "approach", Clear: "clear" } },
    ],
    resources: [{ name: "Bridge", blocks: ["Bridge"], approachLock: "10s", release: { while: { block: "Bridge", is: "clear" }, for: "3s" } }],
    layers: [
      { name: "Gauntlet", starter: "one-train-section", rules: [
        { trigger: { while: { block: "Left", is: "occupied" }, for: "0.5s" }, checks: [],
          then: { mast: "Left Bridge", aspect: "Clear", reserve: "Bridge", lock: ["P1"] } },
        { trigger: { when: { block: "Right", is: "occupied" } },
          checks: [{ all: [{ turnout: "P1", is: "closed" }, { not: { block: "Left", is: "occupied" } }] }],
          then: { mast: "Right Bridge", aspect: "Clear", reserve: "Bridge" },
          cancel: { when: { block: "Right", is: "clear" } } },
      ] },
      { name: "Block signals", rules: [
        { trigger: { while: { block: "Bridge", is: "clear" } }, checks: [{ mast: "Up Int 2", is: ["approach", "clear"] }],
          then: { mast: "Left Bridge", aspect: "Clear" } },
        { trigger: { while: { board: "kiama-north", block: "North 1", is: "clear" } }, checks: [],
          then: { mast: "Up Int 2", aspect: "Clear" } },
      ] },
      { name: "Lock P1", rules: [
        { trigger: { while: { block: "Bridge", is: "occupied" } }, checks: [], then: { lock: ["P1"] } },
      ] },
    ],
  };
  return normalizeConfig(config);
}

test("who uses what: each signal, turnout and block, and the groups on it", () => {
  const rows = plain(whoUses(gauntlet()));
  const short = rows.map(({ kind, name, board, setBy, readBy, sections, overlap }) => [kind, board ? `${name}@${board}` : name, setBy, readBy, sections, overlap]);
  assert.deepEqual(short, [
    ["mast", "Left Bridge", ["Gauntlet", "Block signals"], [], [], true],
    ["mast", "Right Bridge", ["Gauntlet"], [], [], false],
    ["mast", "Up Int 2", ["Block signals"], ["Block signals"], [], false],
    ["turnout", "P1", ["Gauntlet", "Lock P1"], ["Gauntlet"], [], true],
    ["block", "Bridge", ["Gauntlet"], ["Gauntlet", "Block signals", "Lock P1"], ["Bridge"], true],
    ["block", "Left", [], ["Gauntlet"], [], false],
    ["block", "Right", [], ["Gauntlet"], [], false],
    ["block", "North 1@kiama-north", [], ["Block signals"], [], false],
  ]);
  assert.deepEqual(rows.map((row) => row.groups), [2, 1, 1, 2, 3, 1, 1, 1]);
});

test("who uses what: a block read by two groups is an overlap; read by one is not", () => {
  const config = gauntlet();
  config.logic.layers.splice(1, 2);
  const rows = plain(whoUses(config));
  assert.equal(rows.find((row) => row.name === "Bridge").overlap, false, "taken and read by the same group");
  assert.equal(rows.find((row) => row.name === "Left Bridge").overlap, false);
  assert.equal(rows.find((row) => row.name === "P1").overlap, false);
});

test("the control table: one row per rule that shows an aspect, by signal", () => {
  const rows = plain(controlTable(gauntlet()));
  assert.deepEqual(rows, [
    {
      mast: "Left Bridge", aspect: "Clear", meaning: "Clear", rule: "Gauntlet, rule 1",
      when: "A train has been in Left for half a second",
      clear: "Bridge", turnouts: "", onlyIf: "", section: "Bridge",
      release: "Bridge has been clear for 3 seconds", hold: "10 seconds", locks: "P1",
    },
    {
      mast: "Left Bridge", aspect: "Clear", meaning: "Clear", rule: "Block signals, rule 1",
      when: "Bridge is clear",
      clear: "", turnouts: "", onlyIf: "Up Int 2 shows Approach or Clear", section: "",
      release: "", hold: "", locks: "",
    },
    {
      mast: "Right Bridge", aspect: "Clear", meaning: "Clear", rule: "Gauntlet, rule 2",
      when: "A train has entered Right. Cancel when Right has cleared",
      clear: "Left, Bridge", turnouts: "P1 closed", onlyIf: "", section: "Bridge",
      release: "Bridge has been clear for 3 seconds", hold: "10 seconds", locks: "",
    },
    {
      mast: "Up Int 2", aspect: "Clear", meaning: "Clear", rule: "Block signals, rule 2",
      when: "North 1 on kiama-north is clear",
      clear: "", turnouts: "", onlyIf: "", section: "",
      release: "", hold: "", locks: "",
    },
    {
      mast: "", aspect: "", meaning: "", rule: "Lock P1, rule 1",
      when: "A train is in Bridge",
      clear: "", turnouts: "", onlyIf: "", section: "",
      release: "", hold: "", locks: "P1",
    },
  ]);
});

test("the control table: hold after cancelling is Off without it, and unnamed groups are numbered", () => {
  const config = gauntlet();
  delete config.logic.resources[0].approachLock;
  config.logic.layers[0].name = "";
  const rows = plain(controlTable(config));
  assert.equal(rows[0].hold, TEXT.off);
  assert.equal(rows[0].rule, "Group 1, rule 1");
  assert.equal(plain(whoUses(config))[0].setBy[0], "Group 1");
});

test("a board with no rules has nothing in either view", () => {
  const config = normalizeConfig(fixture("turnouts-gpio"));
  assert.deepEqual(plain(whoUses(config)), []);
  assert.deepEqual(plain(controlTable(config)), []);
  config.logic = { mode: "field", layers: [{ name: "Empty", rules: [{ trigger: { while: { block: "", is: "occupied" } }, checks: [], then: {} }] }] };
  assert.deepEqual(plain(controlTable(config)), [], "a rule that does nothing has no row");
});

test("both views are registered as parts, with their words linted", () => {
  const ids = [...context.EsphomeMrLogicUi.allText()].filter(([, text]) => text === TEXT).map(([id]) => id);
  assert.deepEqual(ids, ["logic-layers-view", "logic-control-table"]);
});

if (!process.exitCode) console.log("\nAll Logic views tests passed.");
