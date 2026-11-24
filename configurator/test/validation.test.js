// Validation and the cycle check for Field Logic (field logic spec, Validation,
// Problems in plain words, Plain words on the page). Work item 2.6.
//
// Worked out from the spec, not from the validation code: these tests assert
// error or warning, the names a message mentions and where it links, never the
// exact wording.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

const ctx = loadModules("generator.js", "logic-yaml.js", "logic.js");
const { EsphomeMr, EsphomeMrLogicYaml: L } = ctx;
const { generateYaml, normalizeConfig, parseConfigFromYaml, validateConfig, topicFor } = EsphomeMr;

const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "fixtures", `${name}.json`), "utf8"));
}

// Spec, Ease of use: "no page label uses a spec-only term". The same lint as
// test/logic-page.test.js; the plain-words table covers validation messages too.
const SPEC_ONLY = /\b(scans?|scanning|latch(es|ed)?|interpreters?|rule tables?|phases?|resources?|layers?|tags?|tagged)\b/i;

// The parts of the Logic page a message can link to.
const LOGIC_PARTS = ["logic-mode", "logic-settings", "logic-linked", "logic-blocks", "logic-masts", "logic-buttons", "logic-sections", "logic-groups"];

// --- Building boards --------------------------------------------------------

const lamp = (color) => ({ color, mode: "steady" });
const JMRI = { Stop: "R292", Clear: "R281", Proceed: "R282", Approach: "R285", Caution: "R285" };

// A two-lamp mast on ESP pins, with its aspects in order.
function mast(name, pins, labels = ["Stop", "Clear"]) {
  return {
    name, topic: topicFor("signal", name), topicCustom: false, mode: "gpio",
    lamps: [{ name: "Red", count: 1, pin: pins[0] }, { name: "Green", count: 1, pin: pins[1] }],
    aspects: labels.map((label, i) => ({
      label,
      states: [`${JMRI[label] || label}; Lit; Unheld`],
      ...(i === 0 ? { startup: true } : {}),
      lamps: i === 0 ? [lamp("red"), lamp("off")] : [lamp("off"), lamp(label === "Approach" ? "amber" : "green")],
    })),
  };
}

function sensor(name, gpio) {
  return { name, topic: topicFor("block", name), topicCustom: false, gpio, inverted: true, debounce: "500ms" };
}

function logicBlock(name, sensors) {
  return { name, topic: topicFor("block", name), sensors };
}

function entrance(block, mastName, section, extra = {}) {
  return { trigger: { while: { block, is: "occupied" }, for: "0.5s" }, checks: [], then: { mast: mastName, aspect: "Clear", reserve: section, ...extra } };
}

const SENSOR_PINS = ["GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33"];
const MAST_PINS = [["GPIO32", "GPIO19"], ["GPIO21", "GPIO22"], ["GPIO23", "GPIO17"]];
const FREE_PIN = "GPIO13";
const SERVO_PIN = "GPIO18";

function shell(name, suffix) {
  const config = fixture("turnouts-gpio");
  config.board.name = `${name}-${suffix}`;
  config.board.nameSuffix = suffix;
  // One turnout, P1, on a servo pin with a latched switch.
  config.points = [{ ...config.points[0], name: "P1", topic: topicFor("point", "P1"), servoPin: SERVO_PIN, controls: [{ action: "latch-thrown", buttonPin: "GPIO4" }] }];
  return config;
}

const TAGS = { Stop: "stop", Clear: "clear" };

// A two-entrance gauntlet (spec, One-train section, worked example): sensors
// Bridge, Left and Right; masts Left Bridge and Right Bridge; one section over
// Bridge, taken by both entrances; the Left entrance locks P1. With `home`, a
// third mast, Home, that no rule sets yet (JMRI drives it).
function board({ name = "valid", suffix = "k7m4x2", section = "Span", home = false } = {}) {
  const config = shell(name, suffix);
  config.blocks = ["Bridge", "Left", "Right"].map((n, i) => sensor(n, SENSOR_PINS[i]));
  const masts = [mast("Left Bridge", MAST_PINS[0]), mast("Right Bridge", MAST_PINS[1])];
  if (home) masts.push(mast("Home", MAST_PINS[2]));
  config.signals = { mode: "gpio", masts };
  config.logic = {
    mode: "field",
    masts: masts.map((m) => ({ mast: m.name, tags: { ...TAGS } })),
    resources: [{ name: section, blocks: ["Bridge"], release: { while: { block: "Bridge", is: "clear" }, for: "3s" } }],
    layers: [{
      name: "Gauntlet",
      starter: "one-train-section",
      rules: [entrance("Left", "Left Bridge", section, { lock: ["P1"] }), entrance("Right", "Right Bridge", section)],
    }],
  };
  return config;
}

// The gauntlet with a signal with no lights, Bridge Exit, set by its own group.
function withVirtualMast() {
  const config = board();
  config.logic.masts.push({ virtual: true, name: "Bridge Exit", topic: topicFor("signal", "Bridge Exit"), aspects: ["Stop", "Clear"], tags: { ...TAGS } });
  config.logic.layers.push({ name: "Exit", rules: [{ trigger: { while: { block: "Bridge", is: "clear" } }, checks: [], then: { mast: "Bridge Exit", aspect: "Clear" } }] });
  return config;
}

// The gauntlet with a rule button on a free pin, used by no rule.
function withButton(pin = FREE_PIN) {
  const config = board();
  config.logic.buttons = [{ name: "Depart", pin }];
  return config;
}

// Another board, south-a3f9qp: the same gauntlet, with its own section South
// Span. `members` is what South Span holds.
function southConfig(members = ["Bridge"], blocks = []) {
  const south = board({ name: "south", suffix: "a3f9qp", section: "South Span" });
  south.logic.blocks = blocks;
  south.logic.resources[0].blocks = members;
  return south;
}

// Linked the way the Logic page links it: from the board's downloaded file.
function snapshotOf(other) {
  return L.linkedBoardFromConfig(parseConfigFromYaml(generateYaml(normalizeConfig(plain(other)))));
}

const SOUTH = "south-a3f9qp";

function linkedTo(south) {
  const config = board();
  config.logic.remoteBoards = [snapshotOf(south)];
  return config;
}

// Block signals (spec, Block signals): one direction, Up, over Int 1, Int 2
// and Int 3, masts Up 1, Up 2 and Up 3 in order along the line, end of
// signalled track beyond Int 3. Each block is its current sensor plus the
// optical sensor at each boundary, so neighbours share one. With
// `boundary: false`, Int 2 leaves out the optical sensor it shares with Int 1.
function blockSignals({ boundary = true } = {}) {
  const config = shell("abs", "k7m4x2");
  config.blocks = ["A current", "AB optical", "B current", "BC optical", "C current"].map((n, i) => sensor(n, SENSOR_PINS[i]));
  const names = ["Up 1", "Up 2", "Up 3"];
  config.signals = { mode: "gpio", masts: names.map((n, i) => mast(n, MAST_PINS[i], ["Stop", "Approach", "Clear"])) };
  const blocks = ["Int 1", "Int 2", "Int 3"];
  // The mast's block is clear in its trigger (as the engine cases write it)
  // and in its checks (as the spec's table says), so either reading finds it.
  const rule = (block, checks, mastName, aspect) => ({
    trigger: { while: { block, is: "clear" } },
    checks: [{ block, is: "clear" }, ...checks],
    then: { mast: mastName, aspect },
  });
  const rows = names.flatMap((m, i) => {
    const next = names[i + 1];
    if (!next) return [rule(blocks[i], [], m, "Approach")];
    return [
      rule(blocks[i], [{ mast: next, is: "diverging" }, { not: { mast: next, is: ["stop", "restricting"] } }], m, "Approach"),
      rule(blocks[i], [{ mast: next, is: ["advance", "clear"] }], m, "Clear"),
      rule(blocks[i], [{ mast: next, is: ["stop", "restricting"] }], m, "Approach"),
    ];
  });
  config.logic = {
    mode: "field",
    blocks: [
      logicBlock("Int 1", ["A current", "AB optical"]),
      logicBlock("Int 2", boundary ? ["AB optical", "B current", "BC optical"] : ["B current", "BC optical"]),
      logicBlock("Int 3", ["BC optical", "C current"]),
    ],
    masts: names.map((m) => ({ mast: m, tags: { Stop: "stop", Approach: "approach", Clear: "clear" } })),
    layers: [{ name: "Up", starter: "block-signals", rules: rows }],
  };
  return config;
}

// --- Reading the result -----------------------------------------------------

function check(config) {
  const result = validateConfig(normalizeConfig(plain(config)));
  return { errors: [...result.errors], warnings: [...result.warnings], links: result.links };
}

// What `config` says that `base` does not.
function fresh(config, base) {
  const now = check(config);
  const before = check(base);
  return {
    errors: now.errors.filter((m) => !before.errors.includes(m)),
    warnings: now.warnings.filter((m) => !before.warnings.includes(m)),
    links: now.links,
  };
}

const isMap = (value) => Object.prototype.toString.call(value) === "[object Map]";

// A message mentions every one of `names`, or one of each inner list.
function mentionsAll(message, names) {
  return names.every((name) => (Array.isArray(name) ? name.some((n) => message.includes(n)) : message.includes(name)));
}

// --- The bad boards ---------------------------------------------------------
//
// Each starts from `base` (a valid board) and breaks one thing. `kind` is
// error or warning, `names` what one message must mention, `part` the Logic
// page part it links to.

const ruleOf = (config, layer = 0, n = 0) => config.logic.layers[layer].rules[n];

const BAD = [
  // 1. Every referenced item exists.
  {
    id: "a rule's When names a missing block", bullet: 1, kind: "error", names: ["Nowhere"], part: "logic-groups",
    build() { const c = board(); ruleOf(c).trigger.while.block = "Nowhere"; return c; },
  },
  {
    id: "a rule's Only if names a missing sensor", bullet: 1, kind: "error", names: ["Nowhere"], part: "logic-groups",
    build() { const c = board(); ruleOf(c).checks = [{ sensor: "Nowhere", is: "clear" }]; return c; },
  },
  {
    id: "a rule's CANCEL names a missing block", bullet: 1, kind: "error", names: ["Nowhere"], part: "logic-groups",
    build() {
      const c = board();
      ruleOf(c).trigger = { when: { block: "Left", is: "occupied" } };
      ruleOf(c).cancel = { when: { block: "Nowhere", is: "occupied" } };
      return c;
    },
  },
  {
    id: "a rule's Only if names a missing turnout", bullet: 1, kind: "error", names: ["Ghost Points"], part: "logic-groups",
    build() { const c = board(); ruleOf(c).checks = [{ turnout: "Ghost Points", is: "closed" }]; return c; },
  },
  {
    id: "a rule's Only if names a missing mast", bullet: 1, kind: "error", names: ["Phantom"], part: "logic-groups",
    build() { const c = board(); ruleOf(c).checks = [{ mast: "Phantom", is: "stop" }]; return c; },
  },
  {
    id: "a rule's When names a missing button", bullet: 1, kind: "error", names: ["Lost Button"], part: "logic-groups",
    build() {
      const c = board();
      ruleOf(c).trigger = { when: { button: "Lost Button", is: "pressed" } };
      ruleOf(c).cancel = { when: { block: "Bridge", is: "occupied" } };
      return c;
    },
  },
  {
    id: "a rule takes a missing section", bullet: 1, kind: "error", names: ["Tunnel"], part: "logic-groups",
    build() { const c = board(); ruleOf(c).then.reserve = "Tunnel"; return c; },
  },
  {
    id: "a rule locks a missing turnout", bullet: 1, kind: "error", names: ["Ghost Points"], part: "logic-groups",
    build() { const c = board(); ruleOf(c).then.lock = ["Ghost Points"]; return c; },
  },
  {
    id: "a rule sets a missing mast", bullet: 1, kind: "error", names: ["Phantom"], part: "logic-groups",
    build() { const c = board(); ruleOf(c).then.mast = "Phantom"; return c; },
  },
  {
    id: "a section names a missing block", bullet: 1, kind: "error", names: ["Nowhere"], part: "logic-sections",
    build() { const c = board(); c.logic.resources[0].blocks = ["Bridge", "Nowhere"]; return c; },
  },
  {
    id: "a section's Free the section when names a missing block", bullet: 1, kind: "error", names: ["Nowhere"], part: "logic-sections",
    build() { const c = board(); c.logic.resources[0].release.while.block = "Nowhere"; return c; },
  },

  // 2. Each chosen aspect exists on its mast.
  {
    id: "an aspect the mast does not have", bullet: 2, kind: "error", names: ["Proceed", "Left Bridge"], part: "logic-groups",
    build() { const c = board(); ruleOf(c).then.aspect = "Proceed"; return c; },
  },
  {
    id: "an aspect a signal with no lights does not have", bullet: 2, kind: "error", names: ["Caution", "Bridge Exit"], part: "logic-groups",
    base: withVirtualMast,
    build() { const c = withVirtualMast(); ruleOf(c, 1).then.aspect = "Caution"; return c; },
  },

  // 3. A block is in at most one section, on one board.
  {
    id: "a sensor in two sections", bullet: 3, kind: "error", names: ["Bridge", "Span", "Viaduct"], part: "logic-sections",
    build() { const c = board(); c.logic.resources.push({ name: "Viaduct", blocks: ["Bridge"] }); return c; },
  },
  {
    id: "a block in two sections", bullet: 3, kind: "error", names: ["Deck", "Span", "Viaduct"], part: "logic-sections",
    base() { const c = board(); c.logic.blocks = [logicBlock("Deck", ["Bridge"])]; c.logic.resources[0].blocks = ["Deck"]; return c; },
    build() { const c = this.base(); c.logic.resources.push({ name: "Viaduct", blocks: ["Deck"] }); return c; },
  },
  {
    id: "another board's block in a section here and in one there", bullet: 3, kind: "error", names: ["South Deck", "Span", "South Span"], part: "logic-sections",
    base() { return linkedTo(southConfig(["South Deck"], [logicBlock("South Deck", ["Bridge"])])); },
    build() { const c = this.base(); c.logic.resources[0].blocks.push({ board: SOUTH, block: "South Deck" }); return c; },
  },
  {
    id: "another board's sensor in a section here and in one there", bullet: 3, kind: "error", names: ["Bridge", "Span", "South Span"], part: "logic-sections",
    base() { return linkedTo(southConfig(["Bridge"])); },
    build() { const c = this.base(); c.logic.resources[0].blocks.push({ board: SOUTH, sensor: "Bridge" }); return c; },
  },
  {
    id: "this board's block in a section here and in one on another board", bullet: 3, kind: "error", names: ["Bridge", "Span", "South Span"], part: "logic-sections",
    base() { return linkedTo(southConfig(["Bridge"])); },
    build() { return linkedTo(southConfig(["Bridge", { board: "valid-k7m4x2", sensor: "Bridge" }])); },
  },

  // 4. No cycles.
  {
    id: "a rule reads the mast it sets", bullet: 4, kind: "error", names: ["Left Bridge"], part: "logic-groups",
    build() { const c = board(); ruleOf(c).checks = [{ mast: "Left Bridge", is: "stop" }]; return c; },
  },
  {
    id: "a rule's When reads the mast it sets", bullet: 4, kind: "error", names: ["Left Bridge"], part: "logic-groups",
    build() { const c = board(); ruleOf(c).trigger.while = { all: [{ block: "Left", is: "occupied" }, { mast: "Left Bridge", is: "stop" }] }; return c; },
  },
  {
    id: "two rules that read each other's masts", bullet: 4, kind: "error", names: ["Left Bridge", "Right Bridge"], part: "logic-groups",
    build() {
      const c = board();
      ruleOf(c, 0, 0).checks = [{ mast: "Right Bridge", is: "stop" }];
      ruleOf(c, 0, 1).checks = [{ mast: "Left Bridge", is: "stop" }];
      return c;
    },
  },
  {
    id: "a section freed by a mast a rule taking it sets", bullet: 4, kind: "error", names: ["Left Bridge"], part: "logic-groups",
    build() {
      const c = board();
      c.logic.resources[0].release = { while: { all: [{ block: "Bridge", is: "clear" }, { mast: "Left Bridge", is: "stop" }] }, for: "3s" };
      return c;
    },
  },

  // 5. Warnings.
  {
    id: "two groups give different aspects with the same meaning", bullet: 5, kind: "warning", names: ["Left Bridge"], part: "logic-groups",
    base: sameMeaning("Clear"),
    build: sameMeaning("Proceed", "clear"),
  },
  {
    id: "a When with no CANCEL", bullet: 5, kind: "warning", names: [["Left Bridge", "Gauntlet"]], part: "logic-groups",
    build() { const c = board(); ruleOf(c).trigger = { when: { block: "Left", is: "occupied" } }; return c; },
  },

  // 6. Block signals with no boundary sensor.
  {
    id: "a block signals mast whose block shares no sensor with the one before", bullet: 6, kind: "warning", names: ["Up 2"], part: "logic-groups",
    base: () => blockSignals(),
    build: () => blockSignals({ boundary: false }),
  },

  // 7. A button's pin is free.
  {
    id: "a button on a sensor's pin", bullet: 7, kind: "error", names: ["Depart"], part: "logic-buttons",
    base: () => withButton(), build: () => withButton(SENSOR_PINS[0]),
  },
  {
    id: "a button on a servo's pin", bullet: 7, kind: "error", names: ["Depart"], part: "logic-buttons",
    base: () => withButton(), build: () => withButton(SERVO_PIN),
  },
  {
    id: "a button on a mast lamp's pin", bullet: 7, kind: "error", names: ["Depart"], part: "logic-buttons",
    base: () => withButton(), build: () => withButton(MAST_PINS[0][0]),
  },
  {
    id: "two buttons on one pin", bullet: 7, kind: "error", names: [["Depart", "Arrive"]], part: "logic-buttons",
    base: () => withButton(),
    build() { const c = withButton(); c.logic.buttons.push({ name: "Arrive", pin: FREE_PIN }); return c; },
  },

  // 8. A block cannot take a signal with no lights' name.
  {
    id: "a block named like a signal with no lights", bullet: 8, kind: "error", names: ["Bridge Exit"], part: "logic-blocks",
    base: withVirtualMast,
    build() { const c = withVirtualMast(); c.logic.blocks = [logicBlock("Bridge Exit", ["Bridge"])]; return c; },
  },
];

// The gauntlet plus a group, Shunt, that sets Left Bridge to `aspect` while
// Left is occupied. Left Bridge's third aspect, Proceed, has meaning `tag`.
function sameMeaning(aspect, tag = "approach") {
  return () => {
    const c = board();
    c.signals.masts[0] = mast("Left Bridge", MAST_PINS[0], ["Stop", "Clear", "Proceed"]);
    c.logic.masts[0].tags = { ...TAGS, Proceed: tag };
    c.logic.layers.push({ name: "Shunt", rules: [{ trigger: { while: { block: "Left", is: "occupied" } }, checks: [], then: { mast: "Left Bridge", aspect } }] });
    return c;
  };
}

const baseOf = (bad) => (bad.base ? bad.base.call(bad) : board());
const buildOf = (bad) => bad.build.call(bad);

// The messages of a bad board that are about what it broke.
function problemOf(bad) {
  const found = fresh(buildOf(bad), baseOf(bad));
  const own = bad.kind === "error" ? found.errors : found.warnings;
  return { ...found, matching: own.filter((m) => mentionsAll(m, bad.names)) };
}

// --- Tests ------------------------------------------------------------------

// 11. A valid board says nothing.
test("the valid boards have no errors and no warnings", () => {
  for (const [label, config] of [
    ["gauntlet", board()],
    ["gauntlet with Home", board({ home: true })],
    ["signal with no lights", withVirtualMast()],
    ["button on a free pin", withButton()],
    ["block signals", blockSignals()],
    ["linked to south", linkedTo(southConfig())],
  ]) {
    const { errors, warnings } = check(config);
    assert.deepEqual({ label, errors, warnings }, { label, errors: [], warnings: [] });
  }
});

// 10. The shape of the result.
test("validateConfig gives errors, warnings and links", () => {
  const result = validateConfig(normalizeConfig(board()));
  assert.ok(Array.isArray(result.errors) || typeof result.errors?.length === "number");
  assert.ok(Array.isArray(result.warnings) || typeof result.warnings?.length === "number");
  assert.ok(isMap(result.links), "links is a Map from each message to where it points");
});

// Every bad board, one test each: the right kind of message, about the right
// thing. A warning never blocks the download, so it brings no error with it.
for (const bad of BAD) {
  test(`${bad.kind}: ${bad.id}`, () => {
    // The starting board is valid, so the message is about what was broken.
    assert.deepEqual(check(baseOf(bad)).errors, []);
    const { errors, matching } = problemOf(bad);
    assert.ok(matching.length > 0, `expected an ${bad.kind} mentioning ${JSON.stringify(bad.names)}; got ${JSON.stringify(problemOf(bad))}`);
    if (bad.kind === "warning") assert.deepEqual(errors, [], "a warning is not an error");
  });
}

// 1. Names that are there are fine, and a sensor works wherever a block does.
test("a sensor's name works wherever a block is named", () => {
  const config = board();
  ruleOf(config).checks = [{ block: "Right", is: "clear" }, { sensor: "Bridge", is: "clear" }];
  config.logic.resources[0].blocks = ["Bridge"];
  assert.deepEqual(check(config).errors, []);
});

test("a block on the Logic page works in rules, sections and Free the section when", () => {
  const config = board();
  config.logic.blocks = [logicBlock("Deck", ["Bridge"])];
  config.logic.resources[0].blocks = ["Deck"];
  config.logic.resources[0].release = { while: { block: "Deck", is: "clear" }, for: "3s" };
  ruleOf(config).checks = [{ block: "Deck", is: "clear" }];
  assert.deepEqual(check(config).errors, []);
});

test("a turnout and a mast the board has: no error", () => {
  const config = board({ home: true });
  ruleOf(config).checks = [{ turnout: "P1", is: "closed" }, { mast: "Home", is: "clear" }];
  assert.deepEqual(check(config).errors, []);
});

test("a button the board has: no error about the button", () => {
  const config = withButton();
  ruleOf(config).trigger = { when: { button: "Depart", is: "pressed" } };
  ruleOf(config).cancel = { when: { block: "Bridge", is: "occupied" } };
  assert.deepEqual(fresh(config, withButton()).errors.filter((m) => m.includes("Depart")), []);
});

// 3. The same name on two boards is two blocks.
test("each board's own block in its own section is fine", () => {
  // South Span holds south's Bridge; Span holds this board's Bridge.
  assert.deepEqual(check(linkedTo(southConfig(["Bridge"]))).errors, []);
  const blocks = [logicBlock("Deck", ["Bridge"])];
  const config = linkedTo(southConfig(["Deck"], blocks));
  config.logic.blocks = blocks;
  config.logic.resources[0].blocks = ["Deck"];
  assert.deepEqual(check(config).errors, []);
});

// 4. What is not a cycle.
test("a chain that only reads forwards is not a cycle", () => {
  // Left Bridge reads Right Bridge, Right Bridge reads Home, Home reads no mast.
  const config = board({ home: true });
  config.logic.layers.push({ name: "Home", rules: [{ trigger: { while: { block: "Bridge", is: "clear" } }, checks: [], then: { mast: "Home", aspect: "Clear" } }] });
  ruleOf(config, 0, 0).checks = [{ mast: "Right Bridge", is: "stop" }];
  ruleOf(config, 0, 1).checks = [{ mast: "Home", is: "clear" }];
  assert.deepEqual(check(config).errors, []);
  // The same chain with Home driven by JMRI.
  config.logic.layers.pop();
  assert.deepEqual(check(config).errors, []);
});

test("block signals read the next mast, and pass the cycle check", () => {
  assert.deepEqual(check(blockSignals()).errors, []);
});

test("a mast on another board never makes a cycle, even with the same name", () => {
  const config = linkedTo(southConfig());
  // Left Bridge here reads south's Left Bridge.
  ruleOf(config).checks = [{ board: SOUTH, mast: "Left Bridge", is: ["clear"] }];
  assert.deepEqual(check(config).errors, []);
  ruleOf(config).trigger.while = { all: [{ block: "Left", is: "occupied" }, { board: SOUTH, mast: "Left Bridge", is: "stop" }] };
  assert.deepEqual(check(config).errors, []);
});

test("a section freed by a mast that no rule taking it sets is not a cycle", () => {
  const config = board({ home: true });
  config.logic.resources[0].release = { while: { all: [{ block: "Bridge", is: "clear" }, { mast: "Home", is: "stop" }] }, for: "3s" };
  assert.deepEqual(check(config).errors, []);
});

// 5. What does not warn.
test("two groups giving the same aspect, or aspects of different meaning, do not warn", () => {
  const same = fresh(sameMeaning("Clear")(), board());
  assert.deepEqual(same.warnings.filter((m) => m.includes("Left Bridge")), []);
  const different = fresh(sameMeaning("Proceed", "approach")(), board());
  assert.deepEqual(different.warnings.filter((m) => m.includes("Left Bridge")), []);
  assert.deepEqual(different.errors, []);
});

test("a While never needs a CANCEL, and a When with one does not warn", () => {
  assert.deepEqual(check(board()).warnings, []);
  const config = board();
  ruleOf(config).trigger = { when: { block: "Left", is: "occupied" } };
  ruleOf(config).cancel = { when: { block: "Bridge", is: "occupied" } };
  const { errors, warnings } = check(config);
  assert.deepEqual({ errors, warnings }, { errors: [], warnings: [] });
});

// 6. Shared boundary sensors.
test("block signals whose blocks share a boundary sensor do not warn", () => {
  const { errors, warnings } = check(blockSignals());
  assert.deepEqual({ errors, warnings }, { errors: [], warnings: [] });
});

test("only the mast without a boundary sensor is named", () => {
  const { warnings } = fresh(blockSignals({ boundary: false }), blockSignals());
  // Up 3's block shares BC optical with Up 2's, and Up 1 has none before it.
  assert.deepEqual(warnings.filter((m) => /\bUp (1|3)\b/.test(m) && !m.includes("Up 2")), []);
});

// 7. A free pin.
test("a button on a free pin is fine", () => {
  const { errors } = fresh(withButton(), board());
  assert.deepEqual(errors.filter((m) => m.includes(FREE_PIN)), []);
});

// 11. Without Field Logic, none of this is checked.
test("mode None and Share alone give none of these errors", () => {
  for (const bad of BAD) {
    for (const share of [false, true]) {
      const config = buildOf(bad);
      delete config.logic.mode;
      config.logic.share = share;
      const { errors, warnings } = check(config);
      assert.deepEqual({ bad: bad.id, share, errors }, { bad: bad.id, share, errors: [] });
      assert.deepEqual({ bad: bad.id, share, warnings: warnings.filter((m) => mentionsAll(m, bad.names)) }, { bad: bad.id, share, warnings: [] });
    }
  }
});

// 9. Plain words, as sentences.
test("every message from the bad boards is a sentence in plain words", () => {
  const found = [];
  for (const bad of BAD) {
    const { errors, warnings } = check(buildOf(bad));
    for (const message of [...errors, ...warnings]) {
      const text = String(message).trim();
      if (!text) found.push([bad.id, "empty"]);
      else if (!/[.?!]$/.test(text)) found.push([bad.id, `not a sentence: ${text}`]);
      if (SPEC_ONLY.test(text)) found.push([bad.id, `spec-only term "${SPEC_ONLY.exec(text)[0]}": ${text}`]);
    }
  }
  assert.deepEqual(found, []);
});

test("each bad board has a message to lint", () => {
  // So the lint above is not passing on nothing.
  const silent = BAD.filter((bad) => problemOf(bad).matching.length === 0).map((bad) => bad.id);
  assert.deepEqual(silent, []);
});

// 10. Every new message links to its part of the Logic page.
test("each message links to its part of the Logic page", () => {
  const found = [];
  for (const bad of BAD) {
    const { links, matching, errors, warnings } = problemOf(bad);
    if (!matching.length) {
      found.push([bad.id, "no message to link"]);
      continue;
    }
    if (!isMap(links)) {
      found.push([bad.id, "links is not a Map"]);
      continue;
    }
    for (const message of matching) {
      const link = links.get(message);
      if (!link || link.view !== "logic" || link.part !== bad.part) {
        found.push([bad.id, message, link ? { view: link.view, part: link.part } : null, `want logic / ${bad.part}`]);
      }
    }
    // Anything else new on the Logic page still points at one of its parts.
    for (const message of [...errors, ...warnings]) {
      const link = links.get(message);
      if (link && link.view === "logic" && !LOGIC_PARTS.includes(link.part)) {
        found.push([bad.id, message, { view: link.view, part: link.part }, "not a Logic page part"]);
      }
    }
  }
  assert.deepEqual(found, []);
});

if (!process.exitCode) console.log("\nAll validation tests passed.");
