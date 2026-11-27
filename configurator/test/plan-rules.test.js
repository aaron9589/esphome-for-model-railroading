// Your own pieces and rules on the track plan (work item TP 7): the builder
// turns each rule into a group of its own, a rule reads as one sentence and
// knows what it reads, the examples write ordinary pieces and rules, and the
// local panel example works in the engine. The rule words themselves are
// hand-worked engine cases (rules-local-panel, rules-button-within, and the
// plan case gauntlet-button).
import assert from "node:assert/strict";
import { loadModules, test } from "./harness.js";
import { planBoard, readPlanCase } from "./plan-cases.js";
import { LOGIC_UI_FILES } from "./logic-page.test.js";

const ctx = loadModules(...LOGIC_UI_FILES);
const { EsphomeMrPlanBuilder: B, EsphomeMrLogicUiOwn: O, EsphomeMrPlanEdit: E, EsphomeMrLogicYaml: L, EsphomeMrLogic: Engine } = ctx;
const plain = (value) => JSON.parse(JSON.stringify(value));
const board = (name) => planBoard(ctx, readPlanCase(name).module);
const errors = (config) => plain(B.problems(config)).filter((p) => p.level === "error");

test("each rule is a group of its own, after the drawing's, that can only hold its signal back", () => {
  const config = board("gauntlet");
  E.addPiece(config, { kind: "button", name: "Go", at: [1, 1], pin: "GPIO4" });
  E.addRule(config, { on: { mast: "Left Bridge" }, kind: "stopUnless", when: { button: "Go", is: "pressed", within: "30s" } });
  E.addRule(config, { on: { mast: "Left Bridge" }, kind: "approachWhile", when: { block: "Right", is: "occupied" } });
  assert.deepEqual(errors(config), []);
  const built = plain(B.build(config));
  const names = built.layers.map((l) => l.name);
  assert.deepEqual(names.slice(-2), ["Left Bridge rule 1", "Left Bridge rule 2"]);
  assert.ok(names.indexOf("Left Bridge moves") < names.indexOf("Left Bridge rule 1"));
  // Unless: the best aspect while it holds, so the drawing decides; Stop otherwise.
  assert.deepEqual(built.layers.at(-2).rules, [{ trigger: { while: { button: "Go", is: "pressed", within: "30s" } }, checks: [], then: { mast: "Left Bridge", aspect: "R281" } }]);
  // No better than Approach: the best aspect while it does not hold, Approach while it does.
  assert.deepEqual(built.layers.at(-1).rules.map((r) => r.then.aspect), ["R281", "R285"]);
  assert.deepEqual(built.buttons.map((b) => b.name).at(-1), "Go");
});

test("turnout and lamp rules: a field lock, a lock only its own buttons get past, a lamp lit or flashing", () => {
  const config = board("passing-siding");
  E.addPiece(config, { kind: "switch", name: "Local", at: [8, 3], pin: "GPIO13" });
  E.addPiece(config, { kind: "lamp", name: "Local lamp", at: [9, 3], pin: "GPIO15" });
  E.addRule(config, { on: { turnout: "PE" }, kind: "lockWhile", when: { switch: "Local", is: "off" } });
  E.addRule(config, { on: { turnout: "PW" }, kind: "ownButtonsWhile", when: { switch: "Local", is: "on" } });
  E.addRule(config, { on: { lamp: "Local lamp" }, kind: "flashWhile", when: { switch: "Local", is: "on" } });
  assert.deepEqual(errors(config), []);
  const built = plain(B.build(config));
  assert.deepEqual(built.switches, [{ name: "Local", pin: "GPIO13" }]);
  assert.deepEqual(built.lamps, [{ name: "Local lamp", pin: "GPIO15" }]);
  const rule = (name) => built.layers.find((l) => l.name === name).rules[0].then;
  assert.deepEqual(rule("PE rule 1"), { lock: ["PE"] });
  assert.deepEqual(rule("PW rule 1"), { lock: [{ turnout: "PW", own: true }] });
  assert.deepEqual(rule("Local lamp rule 1"), { lamp: "Local lamp", light: "flash" });
  // On the board: PW gets the panel lock, PE only the field lock.
  assert.ok(L.panelTurnoutNames(config).has("PW"));
  assert.ok(!L.panelTurnoutNames(config).has("PE"));
});

test("a rule on nothing, the wrong rule for its thing, or a rule with nothing to read, is a problem in Behaviour and rules", () => {
  const config = board("gauntlet");
  E.addRule(config, { on: { mast: "Nowhere" }, kind: "stopWhile", when: { block: "Left", is: "occupied" } });
  E.addRule(config, { on: { mast: "Left Bridge" }, kind: "lockWhile", when: { block: "Left", is: "occupied" } });
  E.addRule(config, { on: { mast: "Left Bridge" }, kind: "stopWhile" });
  const found = errors(config);
  assert.deepEqual(found.map((p) => p.text), [B.TEXT.ruleOn(1), B.TEXT.ruleKind(2, "Left Bridge"), B.TEXT.ruleWhen(3)]);
  assert.ok(found.every((p) => p.step === "behaviour"));
});

test("a rule reads as one sentence, and knows what it reads", () => {
  const rule = { on: { turnout: "PW" }, kind: "ownButtonsWhile", when: { all: [{ switch: "Local", is: "on" }, { mast: "West Home", is: "stop", for: "30s" }] } };
  assert.equal(O.sentence(rule), "Only its own buttons move it while: Local is on and West Home has shown Stop for 30 seconds.");
  assert.deepEqual(plain(O.readsOf(rule)), [{ kind: "switch", name: "Local" }, { kind: "mast", name: "West Home" }]);
  assert.equal(O.sentence({ kind: "stopUnless", when: { button: "Go", is: "pressed", within: "30s" } }), "Keep at Stop unless: Go was pressed in the last 30 seconds.");
  // The editor reads each condition back, and joins them again.
  const { join, parts } = O.partsOf(rule.when);
  assert.equal(join, "all");
  assert.deepEqual(plain(parts.map(O.readCondition)), [{ kind: "switch", name: "Local", id: "on", seconds: 30 }, { kind: "mast", name: "West Home", id: "stopFor", seconds: 30 }]);
  assert.deepEqual(plain(O.joinParts(join, parts)), rule.when);
  for (const [kind, choices] of Object.entries(O.CHOICES)) {
    for (const c of choices) assert.equal(O.readCondition(c.make("X", 12)).id, c.id, `${kind} ${c.id}`);
  }
});

test("renaming a piece renames it in every rule; taking a lamp off takes its rules with it", () => {
  const config = board("gauntlet");
  E.addPiece(config, { kind: "switch", name: "Local", at: [1, 1] });
  E.addPiece(config, { kind: "lamp", name: "Lamp", at: [2, 1] });
  E.addRule(config, { on: { mast: "Left Bridge" }, kind: "stopWhile", when: { switch: "Local", is: "on" } });
  E.addRule(config, { on: { lamp: "Lamp" }, kind: "lightWhile", when: { switch: "Local", is: "on" } });
  E.setPiece(config, "Local", { name: "Yard switch" });
  assert.deepEqual(plain(config.logic.plan.rules.map((r) => r.when.switch)), ["Yard switch", "Yard switch"]);
  E.removePiece(config, "Lamp");
  assert.equal(config.logic.plan.rules.length, 1);
  // A plan with only pieces and rules is kept when its track is erased.
  const bare = board("gauntlet");
  E.addPiece(bare, { kind: "button", name: "Go", at: [1, 1] });
  for (const [a, b] of bare.logic.plan.track) E.erase(bare, a, b);
  assert.equal(bare.logic.plan.pieces.length, 1);
});

test("the examples write ordinary pieces and rules", () => {
  const config = board("gauntlet");
  const hold = plain(O.exampleHold(config, "Left Bridge", [1, 1]));
  assert.deepEqual(hold, {
    pieces: [{ kind: "button", name: "Left Bridge go", at: [1, 1] }],
    rules: [{ on: { mast: "Left Bridge" }, kind: "stopUnless", when: { button: "Left Bridge go", is: "pressed", within: "30s" } }],
  });
  const first = plain(O.exampleFirst(["West"], ["North signal"]));
  assert.deepEqual(first.rules, [{ on: { mast: "North signal" }, kind: "stopWhile", when: { block: "West", is: "occupied" } }]);
});

test("the local panel example, on the passing siding's east turnout, works on the board", () => {
  const config = board("passing-siding");
  const made = O.exampleLocalPanel(config, "PE", ["Main East", "Siding East", "East Home"], [12, 3]);
  for (const p of made.pieces) E.addPiece(config, { ...p, pin: p.kind === "switch" ? "GPIO13" : "GPIO15" });
  for (const r of made.rules) E.addRule(config, r);
  assert.deepEqual(errors(config), []);
  const table = plain(L.logicTable(config));
  const engine = Engine.createEngine(table, { logic: "on", broker: "connected" });
  const scan = (n = 1) => { for (let i = 0; i < n; i += 1) engine.scan(); };
  scan();
  engine.event({ switch: "PE local", is: "on" });
  scan(2);
  let s = engine.state();
  for (const mast of ["Main East", "Siding East", "East Home"]) assert.equal(s.masts[mast], "R292", mast);
  assert.equal(s.panel.PE, false);
  // Thirty seconds of Stop on all three: PE goes to its own buttons, the lamp lights.
  scan(300);
  s = engine.state();
  assert.equal(s.panel.PE, true);
  assert.equal(s.locks.PE, false);
  assert.equal(s.lamps["PE lamp"], "on");
  // Back to Remote with PE thrown: the lamp flashes until it is closed.
  engine.event({ turnout: "PE", is: "thrown" });
  engine.event({ switch: "PE local", is: "off" });
  scan();
  s = engine.state();
  assert.equal(s.panel.PE, false);
  assert.equal(s.lamps["PE lamp"], "flash");
});

if (!process.exitCode) console.log("\nAll plan rules tests passed.");
