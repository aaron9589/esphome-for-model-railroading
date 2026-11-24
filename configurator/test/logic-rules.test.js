// The Logic page's Sections and Groups (rule cards): the pure editing
// functions on EsphomeMrLogicUiRules. Work item 2.7b.
//
// Rules the editor makes must be in the stored shapes of test/cases/README.md,
// "Rules": the last tests build a gauntlet with the editor alone and run it on
// the engine and through validation.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

// Every Logic page file, in index.html's order (as in logic-page.test.js).
const LOGIC_UI_FILES = ["generator.js", "logic-yaml.js", "logic.js", "logic-ui.js", "logic-ui-masts.js", "logic-ui-rules.js", "logic-ui-views.js", "logic-ui-start.js"];
const context = loadModules(...LOGIC_UI_FILES);
const { EsphomeMr, EsphomeMrLogicYaml: L, EsphomeMrLogic: Engine, EsphomeMrLogicUi: Ui, EsphomeMrLogicUiRules: R } = context;
const { topicFor, validateConfig } = EsphomeMr;

const plain = (value) => JSON.parse(JSON.stringify(value));
const same = (actual, expected, ...message) => assert.deepEqual(plain(actual), plain(expected), ...message);

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "fixtures", `${name}.json`), "utf8"));
}

// --- A board with nothing on its Logic page yet ------------------------------

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

const SENSOR_PINS = ["GPIO14", "GPIO27", "GPIO26"];

// Sensors Bridge, Left and Right; masts Left Bridge and Right Bridge; turnout
// P1. Field Logic, with nothing else on the Logic page.
function emptyBoard() {
  const config = fixture("turnouts-gpio");
  config.board.name = "rules-k7m4x2";
  config.board.nameSuffix = "k7m4x2";
  config.points = [{ ...config.points[0], name: "P1", topic: topicFor("point", "P1"), servoPin: "GPIO18", controls: [{ action: "latch-thrown", buttonPin: "GPIO4" }] }];
  config.blocks = ["Bridge", "Left", "Right"].map((name, i) => ({
    name, topic: topicFor("block", name), topicCustom: false, gpio: SENSOR_PINS[i], inverted: true, debounce: "500ms",
  }));
  config.signals = { mode: "gpio", masts: [mast("Left Bridge", ["GPIO32", "GPIO19"]), mast("Right Bridge", ["GPIO21", "GPIO22"])] };
  config.logic = { mode: "field" };
  return config;
}

// A board with a linked board, south, typed in with one sensor and one turnout.
function withSouth() {
  const config = emptyBoard();
  const south = L.typedLinkedBoard("south-a3f9qp");
  south.blocks = [L.typedItem("sensor", "S1")];
  south.points = [L.typedItem("turnout", "T1")];
  config.logic.remoteBoards = [south];
  return config;
}

// --- The parts --------------------------------------------------------------

test("Sections and Groups are parts of the page, in Field Logic, at 70 and 80", () => {
  const ids = [...Ui.allText()].map(([id]) => id);
  assert.ok(ids.includes("logic-sections") && ids.includes("logic-groups"));
  const linted = [...Ui.allText()].filter(([id]) => id === "logic-sections" || id === "logic-groups").map(([, text]) => text);
  assert.ok(linted.every((text) => text === R.TEXT));
});

test("the page's words: Group, Section, When / Only if / Then, Meaning words", () => {
  assert.equal(R.TEXT.groupsCard, "Groups");
  assert.equal(R.TEXT.sectionsCard, "Sections");
  assert.equal(R.TEXT.sectionLabel, "Take the section");
  assert.equal(R.TEXT.releaseLabel, "Free the section when…");
  assert.equal(R.TEXT.holdLabel, "Hold after cancelling");
  assert.match(R.TEXT.holdHint, /approach locking/);
  same([R.TEXT.whenPart, R.TEXT.onlyIfPart, R.TEXT.thenPart], ["When", "Only if", "Then"]);
  same(Object.values(R.TEXT.meanings), ["Stop", "Restricting", "Approach", "Advance Approach", "Clear"]);
  assert.equal(R.TEXT.diverging, "Diverging route");
});

// --- Conditions -------------------------------------------------------------

test("a condition offers this board's blocks, turnouts, signals and buttons, then linked boards' items", () => {
  const config = withSouth();
  config.logic.blocks = [{ name: "Span", topic: topicFor("block", "Span"), sensors: ["Bridge"] }];
  config.logic.buttons = [{ name: "Depart", pin: "GPIO13" }];
  const groups = plain(R.conditionItemChoices(config));
  same(groups.map((g) => g.label), ["Blocks and sensors", "Blocks and sensors on south-a3f9qp", "Turnouts", "Turnouts on south-a3f9qp", "Signals", "Buttons"]);
  same(groups[0].options.map((o) => o.value), [{ block: "Span" }, { block: "Bridge" }, { block: "Left" }, { block: "Right" }]);
  same(groups[1].options.map((o) => o.value), [{ board: "south-a3f9qp", sensor: "S1" }]);
  same(groups[3].options.map((o) => o.value), [{ board: "south-a3f9qp", turnout: "T1" }]);
  same(groups[4].options.map((o) => o.value), [{ mast: "Left Bridge" }, { mast: "Right Bridge" }]);
  same(groups[5].options.map((o) => o.value), [{ button: "Depart" }]);
});

test("a condition's item matches its dropdown value, whatever its key order", () => {
  same(R.conditionRef({ is: "clear", block: "Left" }), { block: "Left" });
  same(R.conditionRef({ sensor: "Left", is: "clear" }), { block: "Left" }, "a sensor on this board is offered as a block");
  same(R.conditionRef({ sensor: "S1", is: "clear", board: "south" }), { board: "south", sensor: "S1" });
  same(R.conditionRef({ all: [] }), "");
});

test("picking an item keeps is when it fits, else the item's first word", () => {
  same(R.setConditionItem({ block: "Left", is: "clear" }, { block: "Right" }), { block: "Right", is: "clear" });
  same(R.setConditionItem({ block: "Left", is: "clear" }, { board: "south", sensor: "S1" }), { board: "south", sensor: "S1", is: "clear" });
  same(R.setConditionItem({ block: "Left", is: "clear" }, { turnout: "P1" }), { turnout: "P1", is: "closed" });
  same(R.setConditionItem({ turnout: "P1", is: "thrown" }, { board: "south", turnout: "T1" }), { board: "south", turnout: "T1", is: "thrown" });
  same(R.setConditionItem({ block: "Left", is: "occupied" }, { mast: "Left Bridge" }), { mast: "Left Bridge", is: "clear" });
  same(R.setConditionItem({ block: "Left", is: "occupied" }, { button: "Depart" }), { button: "Depart", is: "pressed" });
  same(R.setConditionItem({ block: "Left", is: "clear" }, ""), { block: "", is: "clear" });
  same(R.isWords("block"), ["occupied", "clear"]);
  same(R.isWords("turnout"), ["closed", "thrown"]);
  same(R.isWords("button"), ["pressed"]);
  same(R.isWords("mast"), ["stop", "restricting", "approach", "advance", "clear", "diverging"]);
});

test("a signal's meanings: one or several, in order; Diverging route stands alone", () => {
  let cond = { mast: "Home", is: "clear" };
  cond = R.toggleMeaning(cond, "approach", true);
  same(cond, { mast: "Home", is: ["approach", "clear"] });
  cond = R.toggleMeaning(cond, "advance", true);
  same(cond.is, ["approach", "advance", "clear"]);
  cond = R.toggleMeaning(R.toggleMeaning(cond, "approach", false), "advance", false);
  same(cond.is, "clear", "one meaning is stored as a word");
  same(R.toggleMeaning(cond, "clear", false), cond, "the last meaning stays");
  cond = R.toggleMeaning(cond, "diverging", true);
  same(cond, { mast: "Home", is: "diverging" });
  same(R.toggleMeaning(cond, "stop", true), { mast: "Home", is: "stop" }, "a meaning replaces Diverging route");
  same(R.toggleMeaning(cond, "diverging", false), { mast: "Home", is: "clear" });
  same(R.meaningsOf({ mast: "Home", is: ["stop", "clear"] }), ["stop", "clear"]);
});

test("all of, any of and not wrap a condition, and unwrap again", () => {
  const left = { block: "Left", is: "occupied" };
  const all = R.wrapCondition(left, "all");
  same(all, { all: [left, { block: "", is: "occupied" }] });
  same(R.setCombine(all, "any"), { any: [left, { block: "", is: "occupied" }] });
  const three = R.addBranch(all);
  assert.equal(three.all.length, 3);
  same(R.setBranch(three, 1, { block: "Right", is: "clear" }).all[1], { block: "Right", is: "clear" });
  same(R.removeBranch(three, 2), all);
  same(R.removeBranch(all, 1), left, "one branch left: the combination goes");
  same(R.wrapCondition(left, "not"), { not: left });
  same(R.unwrapCondition({ not: left }), left);
  same(R.unwrapCondition({ any: [left] }), left);
  same(R.unwrapCondition(all), all, "two branches stay combined");
  assert.equal(all.all.length, 2, "the original is not changed");
  same(R.wrapCondition(left, "nonsense"), left);
});

// --- When -------------------------------------------------------------------

test("While ↔ When keeps the item; a while drops Cancel and moments, a when drops for and the guard", () => {
  const rule = Ui.newRule();
  rule.trigger = { while: { all: [{ block: "Left", is: "occupied" }, { block: "Right", is: "clear" }] }, for: "0.5s", leavingGuard: true };
  R.setTriggerKind(rule, "when");
  same(rule.trigger, { when: { block: "Left", is: "occupied" } });
  R.addThenMoment(rule.trigger);
  same(rule.trigger.then, [{ block: "Left", is: "clear" }], "the next moment guesses the same item, the other way");
  R.setCancel(rule, true);
  same(rule.cancel, { when: { block: "Left", is: "clear" } });
  R.setTriggerKind(rule, "while");
  same(rule.trigger, { while: { block: "Left", is: "occupied" } });
  assert.equal(rule.cancel, undefined);
  R.setTriggerKind(rule, "while");
  same(rule.trigger, { while: { block: "Left", is: "occupied" } }, "switching to the same kind changes nothing");
});

test("for, the leaving guard and following moments are set and cleared", () => {
  const trigger = { while: { block: "Left", is: "occupied" } };
  R.setFor(trigger, "0.5s");
  R.setLeavingGuard(trigger, true);
  same(trigger, { while: { block: "Left", is: "occupied" }, for: "0.5s", leavingGuard: true });
  R.setFor(trigger, "");
  R.setLeavingGuard(trigger, false);
  same(trigger, { while: { block: "Left", is: "occupied" } });

  const when = { when: { button: "Depart", is: "pressed" } };
  R.addThenMoment(when);
  R.setThenMoment(when, 0, { block: "Left", is: "occupied" });
  same(when.then, [{ block: "Left", is: "occupied" }]);
  R.removeThenMoment(when, 0);
  same(when, { when: { button: "Depart", is: "pressed" } }, "no moments left: no then key");
});

test("Cancel is only for a when; its first guess is the trigger's item the other way", () => {
  const rule = { trigger: { while: { block: "Left", is: "occupied" } }, checks: [], then: {} };
  R.setCancel(rule, true);
  assert.equal(rule.cancel, undefined);
  same(R.defaultCancel({ when: { button: "Depart", is: "pressed" } }), { when: { button: "Depart", is: "pressed" } }, "a button: pressed again");
  same(R.defaultCancel({ when: { turnout: "P1", is: "thrown" } }), { when: { turnout: "P1", is: "closed" } });
  same(R.defaultCancel({ when: { mast: "Home", is: "clear" } }), { when: { mast: "Home", is: "stop" } });
  rule.trigger = { when: { button: "Depart", is: "pressed" } };
  R.setCancel(rule, true);
  rule.cancel.when = { block: "Left", is: "clear" };
  R.setCancel(rule, true);
  same(rule.cancel, { when: { block: "Left", is: "clear" } }, "turning it on again keeps what is there");
  R.setCancel(rule, false);
  assert.equal(rule.cancel, undefined);
});

// --- Only if and Then -------------------------------------------------------

test("checks are added, set and removed", () => {
  const rule = Ui.newRule();
  R.addCheck(rule);
  R.addCheck(rule);
  R.setCheck(rule, 1, { block: "Right", is: "clear" });
  same(rule.checks, [{ block: "", is: "occupied" }, { block: "Right", is: "clear" }]);
  R.removeCheck(rule, 0);
  same(rule.checks, [{ block: "Right", is: "clear" }]);
});

test("Then: a signal brings its clearest aspect; clearing it clears the aspect", () => {
  const config = emptyBoard();
  const rule = Ui.newRule();
  R.setThenMast(config, rule, "Left Bridge");
  same(rule.then, { mast: "Left Bridge", aspect: "Clear" });
  R.setThenAspect(rule, "Stop");
  R.setThenMast(config, rule, "Right Bridge");
  same(rule.then, { mast: "Right Bridge", aspect: "Stop" }, "an aspect the new signal has is kept");
  R.setThenMast(config, rule, "");
  same(rule.then, {});

  // With meanings from Masts, the aspect meaning Clear wins over the name.
  config.signals.masts[0].aspects.push({ label: "Proceed", states: ["R282; Lit; Unheld"], lamps: [lamp("off"), lamp("green")] });
  config.logic.masts = [{ mast: "Left Bridge", tags: { Stop: "stop", Clear: "approach", Proceed: "clear" } }];
  same(R.mastAspects(config, "Left Bridge"), [
    { aspect: "Stop", meaning: "stop" }, { aspect: "Clear", meaning: "approach" }, { aspect: "Proceed", meaning: "clear" },
  ]);
  assert.equal(R.defaultAspect(config, "Left Bridge"), "Proceed");

  // A signal with no lights: its own aspects.
  config.logic.masts.push({ virtual: true, name: "Exit", topic: topicFor("signal", "Exit"), aspects: ["Danger", "Go"], tags: { Danger: "stop", Go: "clear" } });
  same(R.mastAspects(config, "Exit").map((a) => a.aspect), ["Danger", "Go"]);
  assert.equal(R.defaultAspect(config, "Exit"), "Go");
});

test("a signal picked under Then joins Masts, its meanings prefilled", () => {
  const config = emptyBoard();
  const rule = Ui.newRule();
  R.setThenMast(config, rule, "Left Bridge");
  same(config.logic.masts, [{ mast: "Left Bridge", tags: { Stop: "stop", Clear: "clear" } }]);
  R.setThenMast(config, rule, "Left Bridge");
  assert.equal(config.logic.masts.length, 1, "once");
});

test("Then: take a section, lock turnouts in the Turnouts page's order", () => {
  const config = emptyBoard();
  config.points.push({ ...config.points[0], name: "P2", topic: topicFor("point", "P2"), servoPin: "GPIO5", controls: [] });
  const rule = Ui.newRule();
  R.setThenSection(rule, "Bridge");
  R.setThenLock(config, rule, "P2", true);
  R.setThenLock(config, rule, "P1", true);
  same(rule.then, { reserve: "Bridge", lock: ["P1", "P2"] });
  R.setThenLock(config, rule, "P1", false);
  R.setThenLock(config, rule, "P2", false);
  R.setThenSection(rule, "");
  same(rule.then, {}, "nothing left: no keys");
});

// --- Rules and groups -------------------------------------------------------

test("groups get unique names and a blank rule; rules are added, moved and removed", () => {
  const config = emptyBoard();
  const first = R.addGroup(config);
  same(first, { name: "Group 1", rules: [plain(Ui.newRule())] });
  config.logic.layers[0].name = "Group 2";
  assert.equal(R.addGroup(config).name, "Group 3", "a name already taken is skipped");
  R.removeGroup(config, 1);
  same(config.logic.layers.map((g) => g.name), ["Group 2"]);

  const group = config.logic.layers[0];
  R.addRule(group);
  R.addRule(group);
  group.rules.forEach((rule, i) => (rule.tag = i));
  R.moveRule(group, 2, -1);
  same(group.rules.map((r) => r.tag), [0, 2, 1]);
  R.moveRule(group, 0, -1);
  R.moveRule(group, 2, 1);
  same(group.rules.map((r) => r.tag), [0, 2, 1], "moving past either end does nothing");
  R.removeRule(group, 0);
  same(group.rules.map((r) => r.tag), [2, 1]);
});

// --- Sections ---------------------------------------------------------------

test("a new section is freed when its blocks are all clear for 3s, and that follows its blocks", () => {
  const config = withSouth();
  const section = R.addSection(config);
  same(section, { name: "Section 1", blocks: [], release: { while: { all: [] }, for: "3s" } });
  R.addSectionBlock(section, "Bridge");
  same(section.release, { while: { block: "Bridge", is: "clear" }, for: "3s" }, "one block, as itself");
  R.addSectionBlock(section, "Bridge");
  same(section.blocks, ["Bridge"], "a block is added once");
  R.setFor(section.release, "5s");
  R.addSectionBlock(section, { board: "south-a3f9qp", sensor: "S1" });
  same(section.release, { while: { all: [{ block: "Bridge", is: "clear" }, { board: "south-a3f9qp", sensor: "S1", is: "clear" }] }, for: "5s" }, "several under all of, keeping the time");
  assert.ok(R.isDefaultRelease(section.release, section.blocks));
  R.removeSectionBlock(section, 1);
  same(section.release, { while: { block: "Bridge", is: "clear" }, for: "5s" });
  assert.equal(R.addSection(config).name, "Section 2");
});

test("a release written by hand is left alone when the blocks change", () => {
  const config = emptyBoard();
  const section = R.addSection(config);
  R.addSectionBlock(section, "Bridge");
  R.setReleaseKind(section, "when");
  same(section.release, { when: { block: "Bridge", is: "clear" } });
  R.addSectionBlock(section, "Left");
  same(section.release, { when: { block: "Bridge", is: "clear" } });
  R.useDefaultRelease(section);
  same(section.release, { while: { all: [{ block: "Bridge", is: "clear" }, { block: "Left", is: "clear" }] }, for: "3s" });
  R.setReleaseKind(section, "while");
  same(section.release.for, "3s", "already a while: unchanged");
});

test("the blocks a section can add leave out those it has", () => {
  const config = withSouth();
  const section = R.addSection(config);
  R.addSectionBlock(section, "Left");
  R.addSectionBlock(section, { board: "south-a3f9qp", sensor: "S1" });
  const values = R.sectionBlockChoices(config, section).flatMap((g) => g.options.map((o) => o.value));
  same(values, ["Bridge", "Right"], "S1 was south's only item, so its group goes");
});

test("Hold after cancelling: off or a time", () => {
  const section = { name: "Bridge", blocks: ["Bridge"] };
  R.setHold(section, "10s");
  assert.equal(section.approachLock, "10s");
  R.setHold(section, "");
  assert.ok(!("approachLock" in section));
  same(R.timeChoices("", "Off").map((c) => c.value), ["", ...R.TIMES]);
  same(R.timeChoices("7s", "Off").slice(-1), [{ value: "7s", label: "7 seconds" }], "a time from the file is kept");
  same(R.timeChoices("", "Off").slice(0, 2), [{ value: "", label: "Off" }, { value: "0.5s", label: "half a second" }]);
});

test("renaming a section renames the rules that take it, unless another section has either name", () => {
  const config = emptyBoard();
  const bridge = R.addSection(config);
  const other = R.addSection(config);
  const group = R.addGroup(config);
  R.setThenSection(group.rules[0], bridge.name);
  R.addRule(group);
  R.setThenSection(group.rules[1], other.name);
  assert.equal(R.renameSection(config, bridge, "Span"), 1);
  same([bridge.name, group.rules[0].then.reserve, group.rules[1].then.reserve], ["Span", "Span", "Section 2"]);

  assert.equal(R.renameSection(config, bridge, "Section 2"), 0, "the new name is another section's");
  assert.equal(bridge.name, "Section 2");
  assert.equal(group.rules[0].then.reserve, "Span");
  assert.equal(R.renameSection(config, bridge, ""), 0, "an empty name is never a reference");

  R.removeSection(config, 0);
  same(config.logic.resources.map((s) => s.name), ["Section 2"]);
  assert.equal(group.rules[0].then.reserve, "Span", "removing a section leaves its rules for validation to report");
});

// --- Words ------------------------------------------------------------------

test("each rule card says its rule as one sentence", () => {
  const rule = { trigger: { while: { block: "Left", is: "occupied" }, for: "0.5s" }, checks: [], then: { mast: "Left Bridge", aspect: "Clear", reserve: "Bridge", lock: ["P1"] } };
  assert.equal(R.ruleSentence(rule), "Left Bridge shows Clear and P1 stays locked when a train has been in Left for half a second and the Bridge section is free.");
  assert.equal(R.ruleSentence({ trigger: { when: { button: "Depart", is: "pressed" } }, then: { lock: ["P1", "P2"] } }), "P1 and P2 stay locked when Depart has been pressed.");
  assert.equal(R.ruleSentence({ trigger: { while: { block: "Left", is: "occupied" } }, then: { reserve: "Bridge" } }), "The Bridge section is taken when a train is in Left and the Bridge section is free.");
  assert.equal(R.ruleSentence(Ui.newRule()), R.TEXT.sentenceUnfinished);
  assert.equal(R.ruleSentence({ trigger: { while: { block: "Left", is: "occupied" } }, checks: [], then: {} }), R.TEXT.sentenceNoThen);
});

test("each section says when it is freed", () => {
  const config = emptyBoard();
  const section = R.addSection(config);
  assert.equal(R.releaseSentence(section), R.TEXT.releaseEmpty);
  R.addSectionBlock(section, "Bridge");
  assert.equal(R.releaseSentence(section), "Free the section when Bridge has been clear for 3 seconds.");
  R.addSectionBlock(section, "Left");
  assert.equal(R.releaseSentence(section), "Free the section when Bridge is clear and Left is clear, for 3 seconds.");
  R.setReleaseKind(section, "when");
  R.addThenMoment(section.release);
  assert.equal(R.releaseSentence(section), "Free the section when Bridge has cleared, then a train has entered Bridge.");
  assert.equal(R.sayTime("90s"), "90 seconds");
  assert.equal(R.sayTime("60s"), "1 minute");
});

// --- What the editor makes runs ---------------------------------------------

// The gauntlet (spec, One-train section), built with the editor alone.
function builtGauntlet() {
  const config = emptyBoard();
  const section = R.addSection(config);
  R.renameSection(config, section, "Span");
  R.addSectionBlock(section, "Bridge");
  const group = R.addGroup(config);
  R.addRule(group);
  [["Left", "Left Bridge"], ["Right", "Right Bridge"]].forEach(([block, mastName], i) => {
    const rule = group.rules[i];
    rule.trigger.while = R.setConditionItem(rule.trigger.while, { block });
    R.setFor(rule.trigger, "0.5s");
    R.setThenMast(config, rule, mastName);
    R.setThenSection(rule, "Span");
    if (i === 0) R.setThenLock(config, rule, "P1", true);
  });
  // Masts gives the meanings (work item 2.7a); here by hand, as it would.
  config.logic.masts = config.signals.masts.map((m) => ({ mast: m.name, tags: { Stop: "stop", Clear: "clear" } }));
  return config;
}

test("a gauntlet built with the editor is in the stored shapes, and validates", () => {
  const config = builtGauntlet();
  same(config.logic.resources, [{ name: "Span", blocks: ["Bridge"], release: { while: { block: "Bridge", is: "clear" }, for: "3s" } }]);
  same(config.logic.layers[0].rules[0], {
    trigger: { while: { block: "Left", is: "occupied" }, for: "0.5s" }, checks: [], then: { mast: "Left Bridge", aspect: "Clear", reserve: "Span", lock: ["P1"] },
  });
  const { errors } = validateConfig(EsphomeMr.normalizeConfig(config));
  same(errors, []);
});

test("a gauntlet built with the editor runs on the engine", () => {
  const config = builtGauntlet();
  const engine = Engine.createEngine(L.logicTable(config));
  engine.scan();
  engine.event({ sensor: "Left", is: "occupied" });
  for (let i = 0; i < 6; i += 1) engine.scan();
  const state = plain(engine.state());
  assert.equal(state.masts["Left Bridge"], "Clear");
  assert.equal(state.masts["Right Bridge"], "Stop");
  assert.equal(state.holders.Span, "Group 1/1");
  assert.equal(state.locks.P1, true);
});

test("a when rule with Cancel, combined checks and a mast meaning runs and validates", () => {
  const config = builtGauntlet();
  config.logic.buttons = [{ name: "Depart", pin: "GPIO13" }];
  const group = R.addGroup(config);
  const rule = group.rules[0];
  R.setTriggerKind(rule, "when");
  rule.trigger.when = R.setConditionItem(rule.trigger.when, { button: "Depart" });
  R.setCancel(rule, true);
  R.addCheck(rule);
  let check = R.setConditionItem(rule.checks[0], { mast: "Left Bridge" });
  check = R.toggleMeaning(check, "stop", true);
  check = R.wrapCondition(check, "any");
  check = R.setBranch(check, 1, R.setConditionItem(check.any[1], { turnout: "P1" }));
  R.setCheck(rule, 0, R.wrapCondition(check, "not"));
  R.setThenLock(config, rule, "P1", true);
  same(rule, {
    trigger: { when: { button: "Depart", is: "pressed" } },
    checks: [{ not: { any: [{ mast: "Left Bridge", is: ["stop", "clear"] }, { turnout: "P1", is: "closed" }] } }],
    then: { lock: ["P1"] },
    cancel: { when: { button: "Depart", is: "pressed" } },
  });
  const { errors } = validateConfig(EsphomeMr.normalizeConfig(config));
  same(errors, []);
  const engine = Engine.createEngine(L.logicTable(config));
  engine.scan();
  engine.event({ button: "Depart", is: "pressed" });
  engine.scan();
  assert.equal(plain(engine.state()).locks.P1, false, "Left Bridge shows Stop, so the check fails");
});

if (!process.exitCode) console.log("\nAll Logic page rule card tests passed.");
