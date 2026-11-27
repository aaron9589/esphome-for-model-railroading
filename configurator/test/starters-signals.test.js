// The Block signals and Route signal starters (field logic spec, Starters;
// work item 2.8): their answers build the rules the hand-worked engine cases
// hold, those rules pass the cases, and a board made by them validates and
// explains.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";
import { runCase } from "./engine-runner.js";

// Every Logic page file, in index.html's order (as in logic-page.test.js).
const LOGIC_UI_FILES = ["generator.js", "logic-yaml.js", "logic.js", "logic-ui.js", "logic-ui-masts.js", "logic-ui-views.js", "logic-ui-start.js", "logic-starters.js", "logic-starters-sections.js", "logic-starters-signals.js"];
const context = loadModules(...LOGIC_UI_FILES);
const { EsphomeMr, EsphomeMrLogicYaml: L, EsphomeMrLogic: Engine, EsphomeMrLogicStarters: S, EsphomeMrLogicStartersSignals: Sig } = context;
const { myFirstBoardPreset, topicFor, validateConfig } = EsphomeMr;

const plain = (value) => JSON.parse(JSON.stringify(value));
const same = (actual, expected, ...message) => assert.deepEqual(plain(actual), plain(expected), ...message);

function readCase(name) {
  return JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "cases", `${name}.json`), "utf8"));
}

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(configuratorDir, "test", "fixtures", `${name}.json`), "utf8"));
}

// ===== A configurator board for a case's board ==============================

const lamp = (color) => ({ color, mode: "steady" });

// A mast on the Signal Masts page whose aspects are the given JMRI names.
function mast(name, aspects, pin = "GPIO16") {
  return {
    name, topic: topicFor("signal", name), topicCustom: false, mode: "addressable", pin,
    lamps: [{ name: "Head", count: 1 }],
    aspects: aspects.map((label, i) => ({ label, states: [`${label}; Lit; Unheld`], ...(i === 0 ? { startup: true } : {}), lamps: [lamp(i === 0 ? "red" : "green")] })),
  };
}

// The case's sensors, turnouts and masts as a Field Logic board, with no
// rules. Another board's masts become a linked board's snapshot.
function boardFor(data) {
  const config = myFirstBoardPreset();
  config.blocks = (data.board.sensors || []).map((name) => ({ name, topic: topicFor("block", name) }));
  config.points = (data.board.turnouts || []).map((name) => ({ name, topic: topicFor("point", name) }));
  config.signals = { mode: "addressable", masts: Object.entries(data.board.masts || {}).map(([name, m]) => mast(name, Object.keys(m.aspects))) };
  config.logic = { mode: "field" };
  const remote = Object.entries(data.board.remote || {});
  if (remote.length) {
    config.logic.remoteBoards = remote.map(([name, other]) => ({
      name, share: true, blocks: [], points: [],
      signals: {
        masts: Object.entries(other.masts || {}).map(([m, def]) => ({
          name: m, topic: topicFor("signal", m), aspects: Object.keys(def.aspects), tags: def.aspects, diverging: def.diverging || [],
        })),
      },
      logic: { blocks: [], resources: [], masts: [] },
    }));
  }
  return config;
}

// Each starter run as [key, answers], applied in turn. Returns the board.
function applyAll(config, runs) {
  for (const [key, answers] of runs) {
    same(S.problems(key, config, answers), [], key);
    S.apply(key, config, answers);
  }
  return config;
}

const blockAnswers = (config, answers) => ({ ...S.defaults("block-signals", config), ...answers });
const routeAnswers = (config, answers) => ({ ...S.defaults("route-signal", config), ...answers });

/**
 * The case, with the starters' groups in place of its layers: the starters'
 * rules must equal the case's, and pass it. The board the starters made must
 * also run the case through its rule table.
 */
function reproduce(name, runs) {
  const data = readCase(name);
  const config = applyAll(boardFor(data), runs(boardFor(data)));
  const groups = config.logic.layers.map((g) => ({ name: g.name, rules: g.rules }));
  same(groups, data.board.logic.layers, `${name}: the starters write the case's rules`);
  const withStarters = { ...data, board: { ...data.board, logic: { ...data.board.logic, layers: plain(groups) } } };
  same(runCase(withStarters), [], `${name}: the starters' rules pass the case`);
  // The rule table the board runs, with the case's timeline.
  const table = plain(L.logicTable(config));
  for (const [mastName, m] of Object.entries(table.masts)) {
    if (data.board.masts[mastName]) same(m.aspects, data.board.masts[mastName].aspects, `${name}: ${mastName}'s meanings`);
  }
  same(runCase({ ...data, board: table }), [], `${name}: the board's rule table passes the case`);
  return config;
}

// ===== 1-2. The block signals cases =========================================

test("the worked example: Block signals Up and the West Exit route that follows Int 1/2", () => {
  reproduce("blocksig-worked-example", (config) => [
    ["block-signals", blockAnswers(config, {
      name: "Up",
      rows: [{ mast: "Int 1/2", block: "Int 2", turnouts: [] }, { mast: "Int 2/3", block: "Int 3", turnouts: [] }],
      beyond: "mast", nextMast: "East Home", useAdvance: true,
    })],
    ["route-signal", routeAnswers(config, {
      name: "West Exit", mast: "West Exit",
      rows: [{ turnouts: [], blocks: ["Int 1"], follow: true, next: "Int 1/2" }],
      useAdvance: true,
    })],
  ]);
});

test("the tumbledown with Advance Approach, to end of signalled track", () => {
  reproduce("blocksig-tumbledown-advance", (config) => [
    ["block-signals", blockAnswers(config, {
      name: "Up",
      rows: [{ mast: "A", block: "Blk 1" }, { mast: "B", block: "Blk 2" }, { mast: "C", block: "Blk 3" }],
      beyond: "end", useAdvance: true,
    })],
  ]);
});

test("the tumbledown without Advance Approach", () => {
  reproduce("blocksig-tumbledown-no-advance", (config) => [
    ["block-signals", blockAnswers(config, {
      name: "Up",
      rows: [{ mast: "A", block: "Blk 1" }, { mast: "B", block: "Blk 2" }, { mast: "C", block: "Blk 3" }],
      beyond: "end",
    })],
  ]);
});

test("Approach Diverging when used (R282), and Approach when not", () => {
  reproduce("blocksig-approach-diverging", (config) => [
    ["block-signals", blockAnswers(config, { name: "With diverging", rows: [{ mast: "Dist", block: "D" }], nextMast: "Junction Home", useDiverging: true })],
    ["block-signals", blockAnswers(config, { name: "Without diverging", rows: [{ mast: "Dist B", block: "E" }], nextMast: "Junction Home" })],
  ]);
});

test("a turnout in the block, in its through position", () => {
  reproduce("blocksig-turnout-in-block", (config) => [
    ["block-signals", blockAnswers(config, {
      name: "Up", rows: [{ mast: "Home", block: "K", turnouts: [{ turnout: "P1", position: "closed" }] }], nextMast: "Next Home",
    })],
  ]);
});

test("a next signal on a linked board", () => {
  reproduce("blocksig-remote-offline", (config) => [
    ["block-signals", blockAnswers(config, { name: "Up", rows: [{ mast: "Exit", block: "X" }], nextMast: { board: "south", mast: "Home" } })],
  ]);
});

// ===== 3. The route signal case =============================================

test("route signal: first matching route wins, a moving turnout matches none, a route follows the next signal", () => {
  reproduce("starter-route-signal", (config) => [
    ["block-signals", blockAnswers(config, { name: "Main", rows: [{ mast: "Main 1/2", block: "Main 2" }], nextMast: "East Home", useAdvance: true })],
    ["route-signal", routeAnswers(config, {
      mast: "Home", useAdvance: true,
      rows: [
        { turnouts: [{ turnout: "P1", position: "closed" }], blocks: ["Main"], follow: true, next: "Main 1/2" },
        { turnouts: [{ turnout: "P1", position: "thrown" }], blocks: ["Branch", "Branch 2"], diverging: true, aspect: "R283" },
        { turnouts: [{ turnout: "P1", position: "thrown" }], blocks: ["Branch"], diverging: true, aspect: "R286" },
      ],
    })],
  ]);
});

// ===== Aspects, prefilled ===================================================

test("CATS masts prefill R281, ADV_NORM, R285 and R282; a diverging route, R283 and R286", () => {
  const config = boardFor(readCase("blocksig-approach-diverging"));
  config.signals.masts.push(mast("All", EsphomeMr.CATS_ASPECTS));
  same(Sig.prefillAspects(config, "All"), { clear: "R281", approach: "R285", advance: "ADV_NORM", diverging: "R282" });
  same(Sig.prefillAspects(config, "All", { diverging: true }), { clear: "R283", approach: "R286", advance: "R283", diverging: "R283A" });
  // Custom aspects: from the meanings given under Masts; Approach Diverging by name.
  config.signals.masts.push(mast("Custom", ["Stop", "Caution", "Proceed", "Approach Diverging"]));
  config.logic.masts = [{ mast: "Custom", tags: { Stop: "stop", Caution: "approach", Proceed: "clear", "Approach Diverging": "clear" } }];
  same(Sig.prefillAspects(config, "Custom"), { clear: "Proceed", approach: "Caution", advance: "", diverging: "Approach Diverging" });
});

// ===== No signal here, both directions, Lock the route =======================

test("No signal here makes a signal with no lights that keeps the tumbledown going", () => {
  const data = readCase("blocksig-tumbledown-advance");
  const config = boardFor(data);
  const answers = blockAnswers(config, {
    name: "Up",
    rows: [{ mast: "A", block: "Blk 1" }, { noSignal: true, block: "Blk 2" }, { mast: "C", block: "Blk 3" }],
    beyond: "end", useAdvance: true,
  });
  const result = S.apply("block-signals", config, answers);
  same(result.virtualMasts, [{
    virtual: true, name: "Up Blk 2", topic: "trains/track/signalmast/Up Blk 2",
    aspects: ["Stop", "Approach", "Advance Approach", "Clear"],
    tags: { Stop: "stop", Approach: "approach", "Advance Approach": "advance", Clear: "clear" },
  }]);
  const rules = config.logic.layers[0].rules;
  same(rules.slice(0, 4).map((r) => r.checks[0].mast ?? r.checks[0].not?.mast), ["Up Blk 2", "Up Blk 2", "Up Blk 2", "Up Blk 2"]);
  same(rules.slice(4, 8).map((r) => r.then), [
    { mast: "Up Blk 2", aspect: "Approach" }, { mast: "Up Blk 2", aspect: "Clear" },
    { mast: "Up Blk 2", aspect: "Advance Approach" }, { mast: "Up Blk 2", aspect: "Approach" },
  ]);
  // The case's timeline, with B now a signal with no lights: A still tumbles down.
  const table = plain(L.logicTable(config));
  const steps = data.steps.map((step) => {
    const masts = { ...(step.expect?.masts || {}) };
    delete masts.B;
    return { ...step, expect: { masts } };
  });
  same(runCase({ ...data, board: table, steps }), []);
});

test("both directions write a second group over the same blocks in reverse", () => {
  const config = boardFor(readCase("blocksig-tumbledown-advance"));
  config.signals.masts.push(mast("D3", ["R292", "R285", "R281"]), mast("D1", ["R292", "R285", "R281"]));
  const answers = blockAnswers(config, {
    rows: [{ mast: "A", block: "Blk 1" }, { mast: "B", block: "Blk 2", turnouts: [{ turnout: "P9", position: "thrown" }] }, { mast: "C", block: "Blk 3" }],
    beyond: "end",
    bothWays: true,
    back: { name: "Down", rows: [{ mast: "D3" }, { noSignal: true, mast: "" }, { mast: "D1" }], beyond: "end" },
  });
  const { groups, virtualMasts } = S.build("block-signals", config, answers);
  same(groups.map((g) => [g.name, g.starter]), [["Up", "block-signals"], ["Down", "block-signals"]]);
  const down = groups[1].rules;
  same(down.map((r) => [r.trigger.while.block, r.then.mast]), [
    ["Blk 3", "D3"], ["Blk 3", "D3"], ["Blk 3", "D3"], ["Blk 3", "D3"],
    ["Blk 2", "Down Blk 2"], ["Blk 2", "Down Blk 2"], ["Blk 2", "Down Blk 2"], ["Blk 2", "Down Blk 2"],
    ["Blk 1", "D1"],
  ]);
  // The block's turnout goes the other way too; D3 reads the signal with no lights.
  same(down[4].checks[0], { turnout: "P9", is: "thrown" });
  same(down[0].checks[0], { mast: "Down Blk 2", is: "diverging" });
  same(virtualMasts.map((m) => [m.name, m.aspects]), [["Down Blk 2", ["Stop", "Approach", "Clear"]]]);
});

test("Lock the route: each route takes a section of its own and locks its turnouts", () => {
  const data = readCase("starter-route-signal");
  const config = boardFor(data);
  config.blocks.push({ name: "Approach", topic: topicFor("block", "Approach") });
  const answers = routeAnswers(config, {
    mast: "Home", trigger: "Approach", routeLocking: true,
    rows: [
      { turnouts: [{ turnout: "P1", position: "closed" }], blocks: ["Main"], aspect: "R281" },
      { turnouts: [{ turnout: "P1", position: "thrown" }], blocks: ["Branch", "Branch 2"], aspect: "R283" },
    ],
  });
  const result = S.build("route-signal", config, answers);
  same(result.sections, [
    { name: "Home route 1", blocks: ["Main"], release: { while: { all: [{ block: "Main", is: "clear" }] }, for: "3s" } },
    { name: "Home route 2", blocks: ["Branch", "Branch 2"], release: { while: { all: [{ block: "Branch", is: "clear" }, { block: "Branch 2", is: "clear" }] }, for: "3s" } },
  ]);
  same(result.groups[0].rules, [
    {
      trigger: { while: { block: "Approach", is: "occupied" }, for: "0.5s" },
      checks: [{ turnout: "P1", is: "closed" }, { block: "Main", is: "clear" }],
      then: { mast: "Home", aspect: "R281", reserve: "Home route 1", lock: ["P1"] },
    },
    {
      trigger: { while: { block: "Approach", is: "occupied" }, for: "0.5s" },
      checks: [{ turnout: "P1", is: "thrown" }, { block: "Branch", is: "clear" }, { block: "Branch 2", is: "clear" }],
      then: { mast: "Home", aspect: "R283", reserve: "Home route 2", lock: ["P1"] },
    },
  ]);
  // Two routes sharing a block cannot each have a section; nor can a route
  // that follows the next signal take one.
  const shared = plain(answers);
  shared.rows[1].blocks = ["Main", "Branch"];
  assert.ok(S.problems("route-signal", config, shared).some((p) => p.includes('both have block "Main"')));
  const follow = plain(answers);
  Object.assign(follow.rows[0], { follow: true, next: "Main 1/2" });
  assert.ok(S.problems("route-signal", config, follow).some((p) => p.startsWith("Route 1 follows the next signal, which Lock the route")));
  same(S.problems("route-signal", config, { ...plain(answers), trigger: "" }).slice(0, 1), ["Lock the route needs the block a train waits in. Pick it, or untick Lock the route."]);
});

// ===== 4. A whole board, through validation and Explain =====================

const SENSOR_PINS = ["GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO32"];
const MAST_PINS = ["GPIO16", "GPIO17", "GPIO19", "GPIO21", "GPIO22", "GPIO23", "GPIO13"];
const ASPECTS = ["R292", "R285", "ADV_NORM", "R281", "R282", "R283", "R286"];

// Single track with a boundary sensor at each joint, a siding, turnout P1.
function wholeBoard() {
  const config = fixture("turnouts-gpio");
  config.board.name = "starters-k7m4x2";
  config.board.nameSuffix = "k7m4x2";
  config.points = [{ ...config.points[0], name: "P1", topic: topicFor("point", "P1"), lockEnabled: false, servoPin: "GPIO18", controls: [{ action: "latch-thrown", buttonPin: "GPIO4" }] }];
  config.blocks = ["Int 1", "B12", "Int 2", "B23", "Int 3", "Siding"].map((name, i) => ({
    name, topic: topicFor("block", name), topicCustom: false, gpio: SENSOR_PINS[i], inverted: true, debounce: "500ms",
  }));
  const masts = ["West Exit", "Siding Exit", "Int 1/2", "Int 2/3", "East Home", "Int 3/2"];
  config.signals = { mode: "addressable", masts: masts.map((name, i) => mast(name, ASPECTS, MAST_PINS[i])) };
  config.logic = {
    mode: "field",
    blocks: [["Blk 1", ["Int 1", "B12"]], ["Blk 2", ["Int 2", "B12", "B23"]], ["Blk 3", ["Int 3", "B23"]]]
      .map(([name, sensors]) => ({ name, topic: topicFor("block", name), sensors })),
  };
  return config;
}

function wholeBoardRuns(config) {
  return [
    ["block-signals", blockAnswers(config, {
      name: "Up",
      rows: [{ mast: "Int 1/2", block: "Blk 2" }, { mast: "Int 2/3", block: "Blk 3", turnouts: [{ turnout: "P1", position: "closed" }] }],
      nextMast: "East Home", useAdvance: true, useDiverging: true,
      bothWays: true,
      back: { name: "Down", rows: [{ mast: "Int 3/2" }, { noSignal: true }], beyond: "end" },
    })],
    ["route-signal", routeAnswers(config, {
      mast: "West Exit", useAdvance: true, useDiverging: true,
      rows: [{ blocks: ["Blk 1"], follow: true, next: "Int 1/2" }],
    })],
    ["route-signal", routeAnswers(config, {
      mast: "Siding Exit", trigger: "Siding", routeLocking: true,
      rows: [{ turnouts: [{ turnout: "P1", position: "thrown" }], blocks: ["Blk 1"], diverging: true, aspect: "R283" }],
    })],
  ];
}

test("a board built by the starters validates with no errors or warnings", () => {
  const config = applyAll(wholeBoard(), wholeBoardRuns(wholeBoard()));
  const { errors, warnings } = validateConfig(config);
  same(errors, []);
  same(warnings, []);
  same(config.logic.layers.map((g) => [g.name, g.starter]), [["Up", "block-signals"], ["Down", "block-signals"], ["West Exit", "route-signal"], ["Siding Exit", "route-signal"]]);
  same(config.logic.resources.map((s) => s.name), ["Siding Exit route 1"]);
  same(config.logic.masts.filter((m) => m.virtual).map((m) => m.name), ["Down Blk 2"]);
  // The masts the rules use joined Masts, with their meanings.
  for (const name of ["West Exit", "Siding Exit", "Int 1/2", "Int 2/3", "East Home", "Int 3/2"]) {
    assert.ok(config.logic.masts.some((m) => m.mast === name), name);
  }
});

test("Explain gives sentences for every signal the starters set", () => {
  const config = applyAll(wholeBoard(), wholeBoardRuns(wholeBoard()));
  const table = L.logicTable(config);
  for (const name of ["West Exit", "Siding Exit", "Int 1/2", "Int 2/3", "Int 3/2", "Down Blk 2"]) {
    const sentences = Engine.explainMast(table, name);
    assert.ok(sentences.length >= 3, name);
    assert.ok(sentences[0].startsWith(`${name} shows `), sentences[0]);
  }
  same(Engine.explainMast(table, "Int 2/3")[0], "Int 2/3 shows R282 when Blk 3 is clear and P1 is closed and East Home shows a diverging aspect and East Home does not show Stop or Restricting.");
  same(Engine.explainMast(table, "Siding Exit")[0], "Siding Exit shows R283 when a train has been in Siding for half a second and P1 is thrown and Blk 1 is clear and the Siding Exit route 1 section is free.");
});

// ===== 5. Problems, and inputs left alone ===================================

test("problems name each missing answer in plain words", () => {
  const config = wholeBoard();
  same(S.problems("block-signals", config, S.defaults("block-signals", config)), [
    "Signal 1 has no signal. Pick one, or tick No signal here.",
    "Signal 1 has no block. Pick the block just beyond it.",
    "Pick the next signal after the last block, or choose End of signalled track.",
  ]);
  same(S.problems("block-signals", config, { ...S.defaults("block-signals", config), rows: [] }), ["Add at least one signal and the block it protects."]);
  same(S.problems("block-signals", config, blockAnswers(config, {
    rows: [{ mast: "Int 1/2", block: "Blk 2", turnouts: [{ turnout: "" }] }, { mast: "Int 1/2", block: "Blk 3" }], beyond: "end",
  })), ["Signal 1 has a turnout with nothing picked. Pick one, or remove it."]);
  same(S.problems("block-signals", config, blockAnswers(config, {
    rows: [{ mast: "Int 1/2", block: "Blk 2" }, { mast: "Int 1/2", block: "Blk 3" }], beyond: "end",
  })), ['Signal "Int 1/2" is listed twice. Each signal protects one block in one direction.']);
  // A custom mast with no meanings given yet has nothing to prefill.
  config.signals.masts.push(mast("Custom", ["Danger", "Proceed"], "GPIO15"));
  same(S.problems("block-signals", config, blockAnswers(config, { rows: [{ mast: "Custom", block: "Blk 2" }], beyond: "end" })), [
    'Pick what "Custom" shows for Clear.',
    'Pick what "Custom" shows for Approach.',
  ]);
  same(S.problems("block-signals", config, blockAnswers(config, { rows: [{ mast: "Int 1/2", block: "Blk 2" }], beyond: "end", bothWays: true, back: { name: "Down", rows: [{}], beyond: "end" } })), [
    "Pick the signal facing the other way that protects Blk 2, or tick No signal here.",
  ]);
  same(S.problems("route-signal", config, S.defaults("route-signal", config)), [
    "Pick the signal.",
    "Route 1 has no block that must be clear. Add one, or pick the block a train waits in.",
  ]);
  same(S.problems("route-signal", config, routeAnswers(config, { mast: "West Exit", rows: [{ blocks: ["Blk 1"], follow: true }, { blocks: ["Blk 2"] }] })), [
    "Route 1 follows the next signal. Pick it.",
    "Route 2: pick what the signal shows.",
  ]);
  // The core adds names that clash with what the board has.
  const built = applyAll(wholeBoard(), wholeBoardRuns(wholeBoard()));
  same(S.problems("route-signal", built, routeAnswers(built, { mast: "West Exit", rows: [{ blocks: ["Blk 1"], aspect: "R281" }] })), [
    'There is already a group called "West Exit". Pick another name.',
  ]);
});

test("build leaves the board and the answers as they were", () => {
  for (const [key, answers] of wholeBoardRuns(wholeBoard())) {
    const config = wholeBoard();
    const before = plain({ config, answers });
    S.build(key, config, answers);
    S.problems(key, config, answers);
    same({ config, answers }, before, key);
  }
});

test("the forms are registered, and their words are linted with the page", () => {
  const start = context.EsphomeMrLogicUiStart;
  const cards = start.starterCards({ logic: {} }).cards;
  for (const key of ["block-signals", "route-signal"]) {
    assert.equal(cards.find((card) => card.key === key).ready, true, key);
    assert.equal(start.TEXT.starterForms[key], Sig.TEXT, key);
  }
});
