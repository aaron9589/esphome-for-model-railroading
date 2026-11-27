// The track plan's builder (docs/field-logic-plan-spec.md; work items TP 2 and
// TP 4). The cases in test/cases/plan are hand-worked from the spec: each gives
// a drawing (`logic.plan`) and a timeline. Each becomes a configurator board
// (plan-cases.js), its rule table is built the way the YAML does it
// (logicTable), and the JS engine replays the timeline; engine-diff.test.js
// replays them in the C++ core too. Then the builder's own checks.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";
import { runCase } from "./engine-runner.js";
import { planBoard, planCasesDir, readPlanCase } from "./plan-cases.js";

const context = loadModules("generator.js", "logic-yaml.js", "logic.js", "logic-checker.js", "logic-try.js", "logic-ui.js", "logic-ui-masts.js", "logic-ui-views.js", "logic-ui-start.js", "logic-ui-try.js", "logic-starters.js", "logic-starters-sections.js", "logic-starters-signals.js", "mss-builder.js", "plan-builder.js", "logic-summary.js");
const { EsphomeMr, EsphomeMrLogicYaml: L, EsphomeMrPlanBuilder: B } = context;
const { generateJmriXml, generateYaml, myFirstBoardPreset, parseConfigFromYaml, topicFor, validateConfig } = EsphomeMr;

const plain = (value) => JSON.parse(JSON.stringify(value));
const casesDir = planCasesDir;
const readCase = readPlanCase;
const board = (module) => planBoard(context, module);
const of = (name) => board(readCase(name).module);
const texts = (config, level) => plain(B.problems(config)).filter((p) => p.level === level).map((p) => p.text);

// ===== 1. The hand-worked cases ============================================

for (const file of fs.readdirSync(casesDir).filter((f) => f.endsWith(".json")).sort()) {
  const data = readCase(file.replace(/\.json$/, ""));
  test(`${file.replace(/\.json$/, "")}: ${data.name}`, () => {
    const config = board(data.module);
    assert.deepEqual(texts(config, "error"), [], "no plan problems");
    assert.deepEqual(plain(validateConfig(config).errors), [], "no validation errors");
    assert.deepEqual(runCase({ ...data, module: undefined, board: plain(L.logicTable(config)) }), []);
  });
}

// ===== 2. What is built, and what is kept =================================

test("building does not change the board, and the file keeps the drawing, not the built items", () => {
  const config = of("gauntlet");
  const before = JSON.stringify(config);
  B.build(config);
  assert.equal(JSON.stringify(config), before);
  const yaml = generateYaml(config);
  const back = parseConfigFromYaml(yaml);
  assert.deepEqual(plain(back.logic.plan), plain(config.logic.plan));
  assert.equal(back.logic.layers, undefined);
  assert.equal(L.versionCode(back), L.versionCode(config));
});

test("your own rules run beside the plan, after its groups; the old page's keys are not read", () => {
  const config = of("gauntlet");
  config.logic.plan.rules = [{ on: { mast: "Left Bridge" }, kind: "stopWhile", when: { block: "Right", is: "occupied" } }];
  // Left over from the old page: ignored.
  config.logic.layers = [{ name: "Mine", rules: [{ trigger: { while: { block: "Bridge", is: "clear" } }, checks: [], then: { mast: "Left Bridge", aspect: "R281" } }] }];
  config.logic.blocks = [{ name: "Old", sensors: ["Left current"] }];
  const table = plain(L.logicTable(config));
  assert.deepEqual(table.logic.layers.map((g) => g.name), ["Left Bridge", "Right Bridge", "Left Bridge moves", "Right Bridge moves", "Left Bridge rule 1"]);
  assert.deepEqual(table.logic.blocks.map((b) => b.name), ["Left", "Bridge", "Right"]);
});

test("a renamed signal aspect, sensor and mast follow into the drawing", () => {
  const config = of("gauntlet");
  config.logic.plan.breaks[0].signals[0].aspects = { clear: "R281" };
  L.renameAspect(config, "Left Bridge", "R281", "Go");
  assert.equal(config.logic.plan.breaks[0].signals[0].aspects.clear, "Go");
  L.renameReferences(config, "sensor", "Left current", "L");
  assert.deepEqual(plain(config.logic.plan.blocks[0].sensors), ["L"]);
  L.renameReferences(config, "mast", "Left Bridge", "LB");
  assert.equal(config.logic.plan.breaks[0].signals[0].mast, "LB");
});

test("a boundary sensor holds the blocks on both sides", () => {
  const config = of("junction");
  config.logic.plan.breaks[1].sensors = ["Junction current"];
  const blocks = plain(B.build(config).blocks);
  assert.deepEqual(blocks.find((b) => b.name === "Main").sensors, ["Main current", "Junction current"]);
});

test("an end can name another board's block and signal, which are checked and followed", () => {
  const config = of("junction");
  config.logic.remoteBoards = [{
    name: "south-a3f9qp", share: true, blocks: [], points: [],
    signals: { masts: [{ name: "Home south", topic: "trains/track/signalmast/Home south", aspects: ["R292", "R281"], tags: { R292: "stop", R281: "clear" } }] },
    logic: { blocks: [{ name: "Up", topic: "trains/track/sensor/Up" }], masts: [] },
  }];
  config.logic.plan.ends.push({ at: [10, 1], beyond: { board: "south-a3f9qp", mast: "Home south", blocks: ["Up"] } });
  assert.deepEqual(texts(config, "error"), []);
  assert.deepEqual(plain(validateConfig(config).errors), []);
  const group = plain(L.logicTable(config).logic.layers).find((g) => g.name === "Main exit");
  assert.ok(group.rules.every((rule) => rule.checks.some((c) => c.board === "south-a3f9qp" && c.block === "Up" && c.is === "clear")));
  assert.ok(group.rules.some((rule) => rule.checks.some((c) => c.board === "south-a3f9qp" && c.mast === "Home south")));
});

// ===== 3. Problems ==========================================================

const broken = (name, change) => { const config = of(name); change(config.logic.plan, config); return config; };
const has = (config, level, words) => assert.ok(texts(config, level).includes(words), `${words}\n${texts(config, level).join("\n")}`);

test("drawing mistakes are errors that stop the download", () => {
  const T = B.TEXT;
  has(broken("junction", (p) => { p.points = []; }), "error", T.needTurnout("the point at 5, 1"));
  has(broken("junction", (p) => { p.track.push([[0, 5], [3, 6]]); }), "error", T.badSegment(p0(broken("junction", () => {})) + 1));
  has(broken("junction", (p) => { p.track.push([[0, 1], [0, 3]]); }), "error", T.sharp("the point at 0, 1"));
  has(broken("junction", (p) => { p.breaks[0].at = [5, 1]; }), "error", T.badBreak("the point at 5, 1"));
  has(broken("junction", (p) => { p.points[0].turnout = "P9"; }), "error", T.noTurnout("P9"));
  has(broken("gauntlet", (p) => { p.arrows = []; }), "error", T.ambiguous("Left Bridge"));
  has(broken("gauntlet", (p) => { p.blocks.splice(1, 1); }), "error", T.unproved("Left Bridge"));
  has(broken("gauntlet", (p) => { p.blocks.splice(0, 1); }), "error", T.clashWaiting("Left Bridge", "Right Bridge"));
  has(broken("gauntlet", (p) => { p.blocks[1].release = "soon"; }), "error", T.badTime("Bridge", "free-after time"));
  has(broken("gauntlet", (p) => { p.blocks[1].approachLock = "10 s"; }), "error", T.badTime("Bridge", "hold time"));
  const bad = broken("gauntlet", (p) => { p.arrows = []; });
  assert.ok(validateConfig(bad).errors.includes(T.ambiguous("Left Bridge")));
});
function p0(config) { return config.logic.plan.track.length; }

test("a file of the wrong shape is reported, not thrown", () => {
  for (const plan of [{}, { track: "no" }, { track: [[1, 2]], points: [null], breaks: [7], blocks: [{}], ends: [3], sections: [{}] }, { track: [[[0, 0], [1e9, 0]]] }]) {
    const config = of("gauntlet");
    config.logic.plan = plan;
    validateConfig(config);
    B.build(config);
  }
});

// What a signal's routes take, by rule.
const movesOf = (config, mast) => plain(B.build(config)).layers.find((g) => g.name === `${mast} moves`)?.rules.map((r) => r.then.reserve) ?? null;
const movesGroup = (config, mast) => plain(B.build(config)).layers.find((g) => g.name === `${mast} moves`);

test("a route takes everything from its signal to its end; routes clash on a crossing, and track no sensor sees is an error", () => {
  // The diamond's lines share only the crossing, and each route takes the
  // diamond and the block beyond it.
  assert.deepEqual(plain(B.build(of("diamond")).resources).map((r) => [r.name, r.blocks]), [["Diamond", ["Diamond"]], ["East", ["East"]], ["South", ["South"]]]);
  assert.deepEqual(movesOf(of("diamond"), "West signal"), [["Diamond", "East"]]);
  // Track no sensor sees on a route is not taken: it is freed with the next block that has one.
  assert.deepEqual(movesOf(of("gauntlet"), "Left Bridge"), [["Bridge"]]);
  has(broken("diamond", (p) => { p.blocks = p.blocks.filter((b) => b.name !== "Diamond"); }), "error", B.TEXT.clashUnseen("West signal", "North signal"));
  // A junction's signals never share track: they are block signals, and nothing is taken.
  assert.deepEqual(plain(B.build(of("junction")).resources), []);
  assert.equal(movesOf(of("junction"), "Home"), null);
});

test("a crossing loop: every block of a route is taken, and each is freed behind the train after its block's Timing", () => {
  const config = of("passing-siding");
  assert.deepEqual(plain(B.build(config).resources).map((r) => r.name), ["West points", "Main loop", "Siding", "West line", "East points", "Single"]);
  assert.deepEqual(movesOf(config, "Main West"), [["West points", "West line"]]);
  assert.deepEqual(movesOf(config, "West Home"), [["West points", "Main loop"], ["West points", "Siding"]]);
  assert.deepEqual(movesOf(config, "Main East"), [["East points", "Single"]]);
  assert.deepEqual(movesOf(config, "East Home"), [["Single", "East points", "Main loop"], ["Single", "East points", "Siding"]]);
  // East Advance runs off the drawing on track no other signal uses: a block signal.
  assert.equal(movesOf(config, "East Advance"), null);
  // Sequential release: the next block along the way, or past the signal the route ends at.
  assert.deepEqual(movesGroup(config, "West Home").rules[0].then.next, { "West points": ["Main loop"], "Main loop": ["East points"] });
  // A piece is freed after its block's Timing; the hold after cancelling is the block behind the signal's.
  config.logic.plan.blocks.find((b) => b.name === "East points").release = "5s";
  config.logic.plan.blocks.find((b) => b.name === "Far").approachLock = "10s";
  assert.equal(plain(B.build(config).resources).find((r) => r.name === "East points").release.for, "5s");
  assert.ok(plain(B.build(config).resources).every((r) => r.approachLock === undefined));
  assert.deepEqual(movesGroup(config, "East Home").rules.map((r) => r.approachLock), [{ block: "Far", for: "10s" }, { block: "Far", for: "10s" }]);
  assert.equal(movesGroup(config, "West Home").rules[0].approachLock, undefined);
  assert.deepEqual(plain(validateConfig(config).errors), []);
});

test("a scissors crossover: each line's routes take only their own line, and the crossovers clash only on the crossing", () => {
  const config = of("scissors");
  assert.deepEqual(movesOf(config, "NW signal"), [["North scissors 1", "North scissors 2", "North east"], ["North scissors 1", "Diamond", "South scissors 1", "South east"]]);
  assert.deepEqual(movesOf(config, "SW signal"), [["South scissors 2", "South scissors 1", "South east"], ["South scissors 2", "Diamond", "North scissors 2", "North east"]]);
  assert.deepEqual(movesOf(config, "SE signal")[0], ["South scissors 1", "South scissors 2", "South west"]);
});

test("a controlled signal is asked for in Auto by a train arriving from the far side, in Manual by CATS or its button", () => {
  const group = movesGroup(of("gauntlet"), "Left Bridge");
  assert.equal(group.routes, true);
  const rule = group.rules[0];
  assert.deepEqual(rule.trigger, { when: { any: [
    { block: "Left", is: "occupied", notFrom: ["Bridge"], if: { auto: "on" } },
    { mast: "Left Bridge", is: "unheld", if: { auto: "off" } },
  ] } });
  assert.deepEqual(rule.cancel, { when: { any: [
    { block: "Left", is: "clear", for: "3s", if: { auto: "on" } },
    { mast: "Left Bridge", is: "held", if: { auto: "off" } },
  ] } });
  assert.deepEqual(rule.withdraw, { when: { any: [{ auto: "on" }, { auto: "off" }] } });
  // In Auto, a train that asked and never entered: time release after the
  // block behind's hold time, or its Timing when it has none.
  const held = movesGroup(broken("gauntlet", (p) => { p.blocks[0].approachLock = "20s"; }), "Left Bridge").rules[0];
  assert.deepEqual(held.cancel.when.any[0], { block: "Left", is: "clear", for: "20s", if: { auto: "on" } });
  // Each block knows its neighbours, for where its train came from.
  assert.deepEqual(plain(B.build(of("gauntlet")).blocks).map((b) => [b.name, b.next]), [["Left", ["Bridge"]], ["Bridge", ["Left", "Right"]], ["Right", ["Bridge"]]]);
  // A button asks and cancels in Manual, and is built as a button on its pin.
  const button = broken("gauntlet", (p) => { p.breaks[0].signals[0].button = "GPIO5"; });
  assert.deepEqual(plain(B.build(button).buttons), [{ name: "Left Bridge button", pin: "GPIO5" }]);
  const any = movesGroup(button, "Left Bridge").rules[0].trigger.when.any;
  assert.deepEqual(any[2], { button: "Left Bridge button", is: "pressed", if: { auto: "off" } });
  assert.deepEqual(plain(validateConfig(button).errors), []);
  // Manual only: always Manual, whatever the switch says; nothing to withdraw.
  const manual = movesGroup(broken("gauntlet", (p) => { p.breaks[0].signals[0].manualOnly = true; }), "Left Bridge").rules[0];
  assert.deepEqual(manual.trigger, { when: { mast: "Left Bridge", is: "unheld" } });
  assert.deepEqual(manual.cancel, { when: { mast: "Left Bridge", is: "held" } });
  assert.equal(manual.withdraw, undefined);
  // With MQTT off and no button, nothing can ask in Manual.
  has(broken("gauntlet", (p, config) => { config.board.mqttEnabled = false; }), "error", B.TEXT.noAsking("Left Bridge"));
  // Nothing sees a train go past: the board cannot tell when a route was used.
  has(broken("diamond", (p) => { p.blocks.find((b) => b.name === "Diamond").sensors = []; p.blocks.push({ name: "Cross", at: [[4, 2], [4, 3]], sensors: [] }); }), "error", B.TEXT.unseenEntry("West signal"));
});

test("crossovers move together; a passing loop's turnouts do not; a point's pairedWith changes it", () => {
  const pairs = (config) => plain(B.build(config).pairs);
  assert.deepEqual(pairs(of("scissors")), [{ turnout: "P1", with: "P4", same: true }, { turnout: "P3", with: "P2", same: true }]);
  assert.deepEqual(pairs(of("passing-siding")), []);
  assert.deepEqual(pairs(of("junction")), []);
  // Unpaired by hand, then paired with another; a reversed turnout moves the other way.
  assert.deepEqual(pairs(broken("scissors", (p) => { p.points[0].pairedWith = ""; })), [{ turnout: "P3", with: "P2", same: true }]);
  assert.deepEqual(pairs(broken("passing-siding", (p) => { p.points[0].pairedWith = "PE"; p.points[1].straightIs = "thrown"; })), [{ turnout: "PW", with: "PE", same: false }]);
  has(broken("scissors", (p) => { p.points[0].pairedWith = "P9"; }), "error", B.TEXT.pairMissing("P1", "P9"));
  has(broken("scissors", (p) => { p.points[0].pairedWith = "P2"; }), "error", B.TEXT.pairTwice("P2"));
});

test("a crossover's turnouts move together on the board: a command for one throws both, unless the other is locked or moving", () => {
  const yaml = generateYaml(of("scissors"));
  const script = (id) => yaml.slice(yaml.indexOf(`  - id: ${id}\n`), yaml.indexOf("  - id: ", yaml.indexOf(`  - id: ${id}\n`) + 5));
  for (const [mine, other] of [["p1", "p4"], ["p4", "p1"], ["p2", "p3"], ["p3", "p2"]]) {
    for (const way of ["thrown", "closed"]) {
      const body = script(`${mine}_throw_${way}`);
      assert.ok(body.includes(`lambda: 'return announce && id(${other}_thrown) != ${way === "thrown"} && !id(${other}_throw_closed).is_running() && !id(${other}_throw_thrown).is_running() && !id(${other}_field_locked);'`), `${mine} ${way}`);
      assert.ok(body.includes(`id: ${other}_throw_${way}\n                announce: true`), `${mine} ${way}`);
    }
  }
  // A reversed turnout goes the other way; a board with no pairs writes none.
  const reversed = generateYaml(broken("scissors", (p) => { p.points[3].straightIs = "thrown"; }));
  assert.ok(reversed.slice(reversed.indexOf("  - id: p1_throw_thrown\n")).split("  - id: ")[1].includes("id: p4_throw_closed"));
  assert.ok(!generateYaml(of("passing-siding")).includes("A crossover"));
});

test("a track plan's board: the Auto/Manual switch, each signal's button, and Release for each route, not each piece", () => {
  const config = of("passing-siding");
  config.logic.plan.auto = { startsOn: false, pin: "GPIO12" };
  assert.deepEqual(plain(validateConfig(config).errors), []);
  const yaml = generateYaml(config);
  // The switch: on the web page, kept across a restart, starting as the drawing says; its toggle; the component's binding.
  assert.match(yaml, /  - platform: template\n    id: logic_auto\n    name: "Auto"\n    optimistic: true\n    restore_mode: RESTORE_DEFAULT_OFF\n/);
  assert.match(yaml, /    id: logic_auto_pin\n[\s\S]*?    on_press:\n      - switch.turn_on: logic_auto\n    on_release:\n      - switch.turn_off: logic_auto\n/);
  assert.match(yaml, /  auto_switch: logic_auto\n/);
  // A signal's button: its pin, the web page's button, and the binding.
  assert.match(yaml, /      number: GPIO5\n[\s\S]*?    id: west_home_button_button\n/);
  assert.match(yaml, /    name: "West Home button"\n    on_press:\n      - lambda: \|-\n          id\(logic\)\.press\("West Home button"\);/);
  assert.match(yaml, /  buttons:\n    - name: "West Home button"\n      sensor: west_home_button_button\n/);
  // Release for a route, by its signal; none for the pieces it takes.
  assert.match(yaml, /    name: "Release West Home"\n    on_press:\n      - lambda: \|-\n          id\(logic\)\.release_group\("West Home moves"\);/);
  assert.ok(!yaml.includes('release("Main loop")'));
  // In JMRI: the switch's light, and each route's Release turnout.
  const xml = generateJmriXml(config).xml;
  assert.match(xml, /<systemName>MLauto\/plan-k7m4x2<\/systemName>/);
  assert.match(xml, /<systemName>MTlogic\/plan-k7m4x2\/West Home moves\/Release<\/systemName>/);
  assert.ok(!xml.includes("Main loop/Release"));
  // A board whose plan has only block signals has no switch.
  assert.ok(!generateYaml(of("junction")).includes("logic_auto"));
});

test("fail safe: two tracks that join with no turnout cannot both clear onto it, unless a turnout keeps them apart", () => {
  assert.deepEqual(movesOf(of("merge"), "Upper"), [["Merge", "Out"]]);
  assert.deepEqual(movesOf(of("merge"), "Lower"), [["Merge", "Out"]]);
  // Through a turnout they cannot both be set: nothing is taken.
  const turnout = broken("merge", (p, config) => { config.points = [{ name: "P1", topic: topicFor("point", "P1"), channel: 0 }]; p.points = [{ at: [4, 1], turnout: "P1", straight: [3, 0] }]; });
  assert.deepEqual(texts(turnout, "error"), []);
  assert.deepEqual(plain(B.build(turnout).resources), []);
  // With no sensor where they meet, the page says to add one.
  has(broken("merge", (p) => { p.blocks = p.blocks.filter((b) => b.name !== "Merge"); }), "error", B.TEXT.clashUnseen("Upper", "Lower"));
});

test("fail safe: turnouts lock as a train comes up to a cleared signal, past it, and over them, and with each route's pieces", () => {
  const built = plain(B.build(of("passing-siding")));
  const locks = built.layers.find((g) => g.name === "Turnout locks").rules;
  const has1 = (block, checks, turnout) => locks.some((r) => r.trigger.while.block === block && r.then.lock.includes(turnout)
    && JSON.stringify(r.checks) === JSON.stringify(checks));
  assert.ok(has1("East points", [], "PE"), "under the train");
  assert.ok(has1("Single", [], "PE"), "past East Home, short of the points");
  assert.ok(has1("Far", [{ turnout: "PE", is: "closed" }, { not: { mast: "East Home", is: "stop" } }], "PE"), "coming up to East Home");
  // Route locking: each turnout is held with the piece it leads into, so it
  // is freed behind the train.
  assert.deepEqual(built.layers.find((g) => g.name === "West Home moves").rules.map((r) => r.then.lock), [[{ turnout: "PW", with: "West points" }], [{ turnout: "PW", with: "West points" }]]);
  assert.deepEqual(built.layers.find((g) => g.name === "East Home moves").rules[0].then.lock, [{ turnout: "PE", with: "East points" }]);
  // With nothing to see a train coming, the page says so.
  const blind = broken("passing-siding", (p) => { p.blocks = p.blocks.filter((b) => b.name !== "Far"); });
  has(blind, "warning", B.TEXT.noApproach("East Home"));
});

test("a row waiting for an aspect the next signal never shows is left out, and the checker says nothing about the plan's own rules", () => {
  const config = of("junction");
  const home = plain(B.build(config)).layers.find((g) => g.name === "Home");
  // Main exit is capped at Approach; Branch exit shows only Clear.
  assert.ok(!home.rules.some((r) => r.checks.some((c) => c.mast === "Main exit" && [c.is].flat().includes("clear"))));
  assert.ok(!home.rules.some((r) => r.checks.some((c) => c.mast === "Branch exit" && c.is === "approach")));
  assert.deepEqual(plain(validateConfig(config).warnings).filter((w) => /never apply|did not apply/.test(w)), []);
  // Your own rule can hold Branch exit at Approach: that row comes back.
  config.logic.plan.rules = [{ on: { mast: "Branch exit" }, kind: "approachWhile", when: { block: "Branch", is: "occupied" } }];
  assert.ok(plain(B.build(config)).layers.find((g) => g.name === "Home").rules.some((r) => r.checks.some((c) => c.mast === "Branch exit" && c.is === "approach")));
});

test("track with no sensor is warned about", () => {
  has(of("gauntlet"), "warning", B.TEXT.undetected("Left Bridge"));
});

test("a block with only a boundary sensor is still checked, but warned about, and no train can wait in it", () => {
  const config = broken("junction", (p) => { p.breaks[1].sensors = ["Junction current"]; p.blocks[2].sensors = []; });
  has(config, "warning", B.TEXT.undetected("Main exit"));
  const group = plain(B.build(config).layers).find((g) => g.name === "Main exit");
  assert.equal(group.rules[0].trigger.while.block, "Main");
  has(broken("gauntlet", (p) => { p.breaks[0].sensors = ["Left current"]; p.blocks[0].sensors = []; }), "error", B.TEXT.clashWaiting("Left Bridge", "Right Bridge"));
});

// ===== 4. The continuous run ===============================================

const loopBoard = () => board({
  sensors: ["B1 current", "B2 current", "B3 current"],
  masts: ["S1", "S2", "S3"],
  plan: {
    track: [[[1, 0], [7, 0]], [[7, 0], [8, 1]], [[8, 1], [8, 3]], [[8, 3], [7, 4]], [[7, 4], [1, 4]], [[1, 4], [0, 3]], [[0, 3], [0, 1]], [[0, 1], [1, 0]]],
    breaks: [
      { at: [2, 0], signals: [{ mast: "S1", facing: [3, 0] }] },
      { at: [8, 2], signals: [{ mast: "S2", facing: [8, 3] }] },
      { at: [2, 4], signals: [{ mast: "S3", facing: [1, 4] }] },
    ],
    blocks: [["B1", [[3, 0], [4, 0]]], ["B2", [[5, 4], [4, 4]]], ["B3", [[0, 1], [0, 3]]]].map(([name, at]) => ({ name, at, sensors: [`${name} current`] })),
  },
});

test("a block with a sensor that no signal checks is warned about", () => {
  // The worked drawings have none: a block behind a signal counts as watched.
  for (const name of ["gauntlet", "junction", "passing-siding", "diamond", "scissors", "merge"]) {
    const config = of(name);
    for (const block of config.logic.plan.blocks) assert.ok(!texts(config, "warning").includes(B.TEXT.unwatched(block.name)), `${name}: ${block.name}`);
  }
  // With no signals left on it, the drawing checks none of its blocks.
  const bare = broken("gauntlet", (p) => { for (const brk of p.breaks) brk.signals = []; });
  for (const name of ["Left", "Bridge", "Right"]) has(bare, "warning", B.TEXT.unwatched(name));
});

test("signals round a loop drawn on the plan are allowed", () => {
  const config = loopBoard();
  assert.deepEqual(texts(config, "error"), []);
  assert.deepEqual(plain(validateConfig(config).errors), []);
  assert.deepEqual(plain(L.logicTable(config).logic.layers).map((g) => g.rules.at(-1).checks[0].mast), ["S2", "S3", "S1"]);
});

test("a loop with one of your own rules in it is still an error", () => {
  const config = loopBoard();
  // S1 waits for S3 (the next signal on its own); a rule on S3 reading S1 closes a loop that is not the plan's.
  config.logic.plan.rules = [{ on: { mast: "S3" }, kind: "stopWhile", when: { mast: "S1", is: "stop" } }];
  assert.ok(validateConfig(config).errors.some((e) => e.includes("read each other in a loop")));
});

test("a loop with a single signal is refused", () => {
  const config = loopBoard();
  config.logic.plan.breaks.splice(1, 2);
  has(config, "error", B.TEXT.loopSelf("S1"));
});
