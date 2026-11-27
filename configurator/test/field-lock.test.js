// Turnout locks under Field Logic (field logic spec, Turnout locks): the
// field lock sits beside the remote lock in the fascia buttons' guard, the
// CLOSED / THROWN handlers and the latch script; the component runs the
// re-sync; a rule-locked turnout gets the lock report without Remote lock.
// Work item 2.5b.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

const ctx = loadModules("generator.js", "logic-yaml.js", "logic.js");
const { generateJmriXml, generateYaml, normalizeConfig, validateConfig, topicFor } = ctx.EsphomeMr;

const plain = (value) => JSON.parse(JSON.stringify(value));
const lamp = (color) => ({ color, mode: "steady" });

// Its rules are hand-written, so the board runs its own logic keys (see useOwnItems).
function fixture(name) {
  return ctx.EsphomeMrLogicYaml.useOwnItems(JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "fixtures", `${name}.json`), "utf8")));
}

function point(name, servoPin, controls, lockEnabled) {
  return { name, topic: topicFor("point", name), channel: 0, travelTime: "10s", servoPin, controls, lockEnabled };
}

// Three turnouts. P1: a push button, no Remote lock, a rule locks it. P2: a
// latched switch and Remote lock, a rule locks it. P3: a latched switch and
// Remote lock, no rule locks it.
function board({ mqtt = true, mode = "field" } = {}) {
  const config = fixture("turnouts-gpio");
  config.board.name = "locks-k7m4x2";
  config.board.nameSuffix = "k7m4x2";
  config.board.mqttEnabled = mqtt;
  config.blocks = ["Bridge", "Left"].map((name, i) => ({
    name, topic: topicFor("block", name), topicCustom: false, gpio: ["GPIO14", "GPIO27"][i], inverted: true, debounce: "500ms",
  }));
  config.points = [
    point("P1", "GPIO18", [{ action: "toggle", buttonPin: "GPIO4" }], false),
    point("P2", "GPIO19", [{ action: "latch-thrown", buttonPin: "GPIO5" }], true),
    point("P3", "GPIO25", [{ action: "latch-closed", buttonPin: "GPIO23" }], true),
  ];
  config.signals = {
    mode: "gpio",
    masts: [{
      name: "Left Bridge", topic: topicFor("signal", "Left Bridge"), topicCustom: false, mode: "gpio",
      lamps: [{ name: "Red", count: 1, pin: "GPIO32" }, { name: "Green", count: 1, pin: "GPIO26" }],
      aspects: [
        { label: "Stop", states: ["R292; Lit; Unheld"], startup: true, lamps: [lamp("red"), lamp("off")] },
        { label: "Clear", states: ["R281; Lit; Unheld"], lamps: [lamp("off"), lamp("green")] },
      ],
    }],
  };
  config.logic = {
    mode,
    // Share needs MQTT.
    ...(mqtt ? {} : { share: false }),
    masts: [{ mast: "Left Bridge", tags: { Stop: "stop", Clear: "clear" } }],
    resources: [{ name: "Bridge", blocks: ["Bridge"], release: { while: { block: "Bridge", is: "clear" }, for: "3s" } }],
    layers: [{
      name: "Gauntlet",
      rules: [{
        trigger: { while: { block: "Left", is: "occupied" }, for: "0.5s" },
        checks: [],
        then: { mast: "Left Bridge", aspect: "Clear", reserve: "Bridge", lock: ["P1", "P2"] },
      }],
    }],
  };
  return normalizeConfig(config);
}

// The YAML list item ("- ...") that holds this line, up to its next sibling.
function itemAt(yaml, line) {
  const lines = yaml.split("\n");
  const indentOf = (row) => row.length - row.trimStart().length;
  let start = lines.indexOf(line);
  assert.ok(start >= 0, `no line ${JSON.stringify(line)}`);
  while (start >= 0 && !lines[start].trimStart().startsWith("- ")) start -= 1;
  const indent = indentOf(lines[start]);
  let end = start + 1;
  while (end < lines.length && lines[end].trim() !== "" && indentOf(lines[end]) > indent) end += 1;
  return lines.slice(start, end).join("\n");
}

const bindingOf = (yaml, name) => itemAt(yaml.slice(yaml.indexOf("\nmr_logic:\n")), `    - name: ${name}`).split("\n").slice(1).map((row) => row.trim());

test("the board is valid", () => {
  assert.deepEqual([...validateConfig(board()).errors], []);
});

test("a rule-locked turnout without Remote lock: the field lock guards its buttons and commands", () => {
  const yaml = generateYaml(board());
  const button = itemAt(yaml, "    id: p1_button_1");
  assert.match(button, /- lambda: 'return !id\(p1_field_locked\);'/);
  const commands = itemAt(yaml, "    id: p1");
  assert.equal((commands.match(/- lambda: 'return !id\(p1_field_locked\);'/g) || []).length, 2);
  // No remote lock: no flag, no Lock topic.
  assert.doesNotMatch(yaml, /p1_locked\b/);
  assert.doesNotMatch(yaml, /P1\/Lock"?\n/);
});

test("a rule-locked turnout without Remote lock still gets the lock report", () => {
  const yaml = generateYaml(board());
  assert.ok(yaml.includes([
    "  - platform: template",
    "    id: p1_lock_report",
    "    internal: true",
    "    lambda: 'return id(p1_field_locked);'",
    "    on_state:",
    "      then:",
    "        - mqtt.publish:",
    "            topic: trains/track/sensor/P1/Locked",
    "            payload: !lambda |-",
    '              return x ? "ACTIVE" : "INACTIVE";',
    "            retain: true",
    "            qos: 2",
  ].join("\n")));
  // And on connect.
  assert.ok(yaml.includes([
    "    - mqtt.publish:",
    "        topic: trains/track/sensor/P1/Locked",
    "        payload: !lambda |-",
    '          return id(p1_field_locked) ? "ACTIVE" : "INACTIVE";',
  ].join("\n")));
  // JMRI: the report is a sensor, as with Remote lock.
  assert.match(generateJmriXml(board()).xml, /<systemName>MSP1\/Locked<\/systemName>/);
});

test("a sensor on a rule-locked turnout's lock report topic is an error", () => {
  const config = board();
  config.blocks.push({ name: "P1 Locked", topic: "trains/track/sensor/P1/Locked", topicCustom: true, gpio: "GPIO33", inverted: true, debounce: "500ms" });
  const errors = [...validateConfig(ctx.EsphomeMrLogicYaml.useOwnItems(normalizeConfig(plain(config)))).errors];
  assert.ok(errors.some((e) => e.includes("trains/track/sensor/P1/Locked") && e.includes("its lock")), errors.join("\n"));
});

test("both locks: either one holds the turnout, and the report follows both", () => {
  const yaml = generateYaml(board());
  const latch = itemAt(yaml, "  - id: p2_latch_1");
  assert.match(latch, /\/\/ A lock \(remote or a rule's\) holds the point where it is\.\n {10}if \(id\(p2_locked\) \|\| id\(p2_field_locked\)\) want = id\(p2_thrown\);/);
  const commands = itemAt(yaml, "    id: p2");
  assert.equal((commands.match(/- lambda: 'return !\(id\(p2_locked\) \|\| id\(p2_field_locked\)\);'/g) || []).length, 2);
  assert.match(yaml, /    lambda: 'return id\(p2_locked\) \|\| id\(p2_field_locked\);'/);
  assert.match(yaml, /return \(id\(p2_locked\) \|\| id\(p2_field_locked\)\) \? "ACTIVE" : "INACTIVE";/);
});

test("the Lock topic's handlers only set the flag; the component re-syncs and the sensor reports", () => {
  const yaml = generateYaml(board());
  const lock = itemAt(yaml, "    id: p2_lock");
  assert.match(lock, /- lambda: 'id\(p2_locked\) = true;'/);
  assert.match(lock, /- lambda: 'id\(p2_locked\) = false;'/);
  // The component runs the latch script when both flags are clear.
  assert.doesNotMatch(lock, /was_locked|p2_latch_1|mqtt\.publish/);
  assert.deepEqual(bindingOf(yaml, "P2"), [
    "thrown: p2_thrown",
    "throw_closed: p2_throw_closed",
    "throw_thrown: p2_throw_thrown",
    "field_locked: p2_field_locked",
    "remote_locked: p2_locked",
    "resync: p2_latch_1",
  ]);
  // P1 has no latched switch, so no re-sync.
  assert.deepEqual(bindingOf(yaml, "P1"), [
    "thrown: p1_thrown",
    "throw_closed: p1_throw_closed",
    "throw_thrown: p1_throw_thrown",
    "field_locked: p1_field_locked",
  ]);
});

test("a turnout no rule locks keeps its remote lock, re-synced by the component", () => {
  const yaml = generateYaml(board());
  assert.doesNotMatch(yaml, /p3_field_locked|p3_lock_report/);
  assert.match(itemAt(yaml, "  - id: p3_latch_1"), /\/\/ A remote lock holds the point where it is\.\n {10}if \(id\(p3_locked\)\) want = id\(p3_thrown\);/);
  const lock = itemAt(yaml, "    id: p3_lock");
  assert.doesNotMatch(lock, /was_locked/);
  // Its report still comes from the Lock topic's handlers: only the remote lock moves it.
  assert.equal((lock.match(/topic: trains\/track\/sensor\/P3\/Locked/g) || []).length, 2);
  assert.match(lock, /return id\(p3_locked\) \? "ACTIVE" : "INACTIVE";/);
  assert.deepEqual(bindingOf(yaml, "P3"), [
    "thrown: p3_thrown",
    "throw_closed: p3_throw_closed",
    "throw_thrown: p3_throw_thrown",
    "remote_locked: p3_locked",
    "resync: p3_latch_1",
  ]);
});

test("Disable MQTT: the field lock still guards the buttons and latch, with no report and no remote lock", () => {
  const config = board({ mqtt: false });
  assert.deepEqual([...validateConfig(config).errors], []);
  const yaml = generateYaml(config);
  assert.match(itemAt(yaml, "    id: p1_button_1"), /- lambda: 'return !id\(p1_field_locked\);'/);
  assert.match(itemAt(yaml, "  - id: p2_latch_1"), /\/\/ A lock \(remote or a rule's\) holds the point where it is\.\n {10}if \(id\(p2_field_locked\)\) want = id\(p2_thrown\);/);
  assert.doesNotMatch(yaml, /_lock_report|remote_locked|p\d_locked\b|mqtt\.publish|^mqtt:/m);
  assert.deepEqual(bindingOf(yaml, "P2"), [
    "thrown: p2_thrown",
    "throw_closed: p2_throw_closed",
    "throw_thrown: p2_throw_thrown",
    "field_locked: p2_field_locked",
    "resync: p2_latch_1",
  ]);
});

test("without Field Logic the Lock topic's UNLOCKED handler still re-syncs, as before", () => {
  const config = board({ mode: "none" });
  config.logic = { mode: "none", share: true };
  const yaml = generateYaml(ctx.EsphomeMrLogicYaml.useOwnItems(normalizeConfig(plain(config))));
  assert.doesNotMatch(yaml, /field_locked|lock_report|mr_logic/);
  const lock = itemAt(yaml, "    id: p2_lock");
  assert.match(lock, /bool was_locked = id\(p2_locked\);\n {16}id\(p2_locked\) = false;\n {16}if \(was_locked\) id\(p2_latch_1\)\.execute\(false\);/);
  assert.match(itemAt(yaml, "  - id: p2_latch_1"), /\/\/ A remote lock holds the point where it is\.\n {10}if \(id\(p2_locked\)\) want = id\(p2_thrown\);/);
});

test("MSS Logic runs the component as Field Logic does: it re-syncs the remote lock, and no rule locks a turnout", () => {
  const config = board({ mode: "mss" });
  config.logic = { mode: "mss" };
  const yaml = generateYaml(ctx.EsphomeMrLogicYaml.useOwnItems(normalizeConfig(plain(config))));
  assert.match(yaml, /mr_logic:/);
  assert.doesNotMatch(yaml, /field_locked|lock_report/);
  assert.doesNotMatch(itemAt(yaml, "    id: p2_lock"), /was_locked/);
  assert.deepEqual(bindingOf(yaml, "P2"), [
    "thrown: p2_thrown",
    "throw_closed: p2_throw_closed",
    "throw_thrown: p2_throw_thrown",
    "remote_locked: p2_locked",
    "resync: p2_latch_1",
  ]);
});

if (!process.exitCode) console.log("\nAll field lock tests passed.");
