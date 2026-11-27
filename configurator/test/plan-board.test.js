// A Field Logic board reads only its drawing (work item TP 9b): the old
// page's keys are kept in the file and not run, and what the drawing makes
// reaches the board as the old page's items did: blocks as template sensors
// that share their /State, turnouts locked by the field with their lock
// report, another board's sensor in a block, and a linked board's built
// blocks and sections. The rest of the generator is tested on hand-written
// rules (useOwnItems), in each feature's own file.
import assert from "node:assert/strict";
import { loadModules, test } from "./harness.js";
import { planBoard, readPlanCase } from "./plan-cases.js";
import { LOGIC_UI_FILES } from "./logic-page.test.js";

const ctx = loadModules(...LOGIC_UI_FILES);
const { EsphomeMr: M, EsphomeMrLogicYaml: L, EsphomeMrLogic: Engine } = ctx;
const plain = (value) => JSON.parse(JSON.stringify(value));
const board = (name) => planBoard(ctx, readPlanCase(name).module);

test("the old page's keys are kept in the file and not run: the YAML is the drawing's alone", () => {
  const config = board("gauntlet");
  const drawn = M.generateYaml(config).replace(/^# \{.*$/m, "");
  const old = plain(config);
  old.logic.blocks = [{ name: "Old", topic: "trains/track/sensor/Old", sensors: ["Left current"] }];
  old.logic.layers = [{ name: "Old", rules: [{ trigger: { while: { block: "Old", is: "clear" } }, checks: [], then: { mast: "Left Bridge", aspect: "R281" } }] }];
  old.logic.resources = [{ name: "Old", blocks: ["Old"] }];
  old.logic.buttons = [{ name: "Old", pin: "GPIO5" }];
  old.logic.masts = [{ mast: "Left Bridge", tags: { R292: "clear" } }];
  const yaml = M.generateYaml(old);
  assert.equal(yaml.replace(/^# \{.*$/m, ""), drawn);
  assert.deepEqual(plain(M.parseConfigFromYaml(yaml).logic.layers), old.logic.layers, "kept in the file");
  // With no drawing, Field Logic runs nothing.
  delete old.logic.plan;
  assert.deepEqual(plain(L.logicTable(old).logic.layers || []), []);
  assert.doesNotMatch(M.generateYaml(old).replace(/^# \{.*$/m, ""), /\bOld\b/);
});

test("a drawn block is a template sensor of its sensors, and shares its /State", () => {
  const yaml = M.generateYaml(board("gauntlet"));
  for (const id of ["left_block", "bridge_block", "right_block"]) assert.match(yaml, new RegExp(`id: ${id}\\n`));
  assert.match(yaml, /topic: trains\/track\/sensor\/Bridge\/State/);
  const { xml } = M.generateJmriXml(board("gauntlet"));
  assert.match(xml, /<systemName>MSBridge<\/systemName>/);
});

test("a turnout on the drawing is locked by the field: its guard, and its lock report", () => {
  const config = board("passing-siding");
  assert.ok(L.lockedTurnoutNames(config).has("PW"));
  const yaml = M.generateYaml(config);
  assert.match(yaml, /- id: pw_field_locked\n/);
  assert.match(yaml, /topic: trains\/track\/sensor\/PW\/Locked\n/);
  assert.match(yaml, /return id\(pw_field_locked\) \? "ACTIVE" : "INACTIVE";/);
});

test("a drawn block can hold another board's sensor, which reads occupied until it is heard", () => {
  const south = board("gauntlet");
  south.board.name = "south-a3f9qp";
  south.board.nameSuffix = "a3f9qp";
  const config = board("gauntlet");
  config.logic.remoteBoards = [L.linkedBoardFromConfig(M.parseConfigFromYaml(M.generateYaml(south)))];
  config.logic.plan.blocks[0].sensors.push({ board: "south-a3f9qp", sensor: "Right current" });
  assert.deepEqual([...M.validateConfig(config).errors], []);
  const table = plain(L.logicTable(config));
  assert.deepEqual(table.logic.blocks[0].sensors, ["Left current", { board: "south-a3f9qp", sensor: "Right current" }]);
  const engine = Engine.createEngine(table, { logic: "on", broker: "connected", board: config.board.name });
  for (let i = 0; i < 3; i += 1) engine.scan();
  // Not heard yet, so Left reads occupied: a train there, and Left Bridge's route is set for it.
  assert.equal(engine.state().masts["Left Bridge"], "R281");
  // Without that sensor, Left is clear and nothing is asked.
  const own = plain(table);
  own.logic.blocks[0].sensors = ["Left current"];
  const quiet = Engine.createEngine(own, { logic: "on", broker: "connected", board: config.board.name });
  for (let i = 0; i < 3; i += 1) quiet.scan();
  assert.equal(quiet.state().masts["Left Bridge"], "R292");
  assert.match(M.generateYaml(config), /topic: "trains\/track\/sensor\/Right current\/State"/);
});

test("a linked board with a drawing gives its built blocks and sections", () => {
  const other = board("gauntlet");
  other.board.name = "north-p3q8w5";
  other.board.nameSuffix = "p3q8w5";
  const snapshot = plain(L.linkedBoardFromConfig(M.parseConfigFromYaml(M.generateYaml(other))));
  assert.deepEqual(snapshot.logic.blocks.map((b) => b.name), ["Left", "Bridge", "Right"]);
  assert.deepEqual(snapshot.logic.resources.map((r) => r.name), ["Bridge"]);
  // Its signals mean what the drawing says.
  assert.equal(snapshot.signals.masts.find((m) => m.name === "Left Bridge").tags.R281, "clear");
});

if (!process.exitCode) console.log("\nAll drawn-board tests passed.");
