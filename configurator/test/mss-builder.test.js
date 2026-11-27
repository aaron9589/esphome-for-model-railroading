// MSS Logic's builder (docs/mss-emulation-spec.md; work item 4.1). The MSS
// cases in test/cases/mss are hand-worked from the spec: each describes a
// module (its sensors, turnouts, masts and `logic.mss`) and a timeline. Here
// each module becomes a configurator board, the builder makes its rule table
// through the same path the YAML takes (logic-yaml.js logicTable), and the
// JS engine replays the timeline. Then the builder's own checks: shapes,
// plant ends, validation mapped back to the description, generation, import.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";
import { runCase } from "./engine-runner.js";
// Every Logic page file, in index.html's order (as in logic-page.test.js).
const LOGIC_UI_FILES = ["generator.js", "logic-yaml.js", "logic.js", "logic-checker.js", "logic-try.js", "logic-ui.js", "logic-ui-masts.js", "logic-ui-views.js", "logic-ui-start.js", "logic-ui-try.js", "logic-starters.js", "logic-starters-sections.js", "logic-starters-signals.js", "mss-builder.js", "plan-builder.js", "plan-edit.js", "logic-summary.js"];

const context = loadModules(...LOGIC_UI_FILES);
const { EsphomeMr, EsphomeMrLogicYaml: L, EsphomeMrMssBuilder: B } = context;
const { generateYaml, myFirstBoardPreset, normalizeConfig, parseConfigFromYaml, topicFor, validateConfig } = EsphomeMr;

const plain = (value) => JSON.parse(JSON.stringify(value));
const same = (actual, expected, ...message) => assert.deepEqual(plain(actual), plain(expected), ...message);

const casesDir = path.join(configuratorDir, "test", "cases", "mss");
const caseFiles = fs.readdirSync(casesDir).filter((file) => file.endsWith(".json")).sort();
const readCase = (file) => JSON.parse(fs.readFileSync(path.join(casesDir, file), "utf8"));

// ===== A configurator board for a case's module ==============================

const CATS = ["R292", "R285", "ADV_NORM", "R281", "R282", "R283", "R286"];
const SENSOR_PINS = ["GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO32", "GPIO35", "GPIO34", "GPIO39"];
const MAST_PINS = ["GPIO16", "GPIO17", "GPIO19", "GPIO23", "GPIO18", "GPIO13"];

function mast(name, aspects = CATS, pin = "GPIO16") {
  return {
    name, topic: topicFor("signal", name), topicCustom: false, mode: "addressable", pin,
    lamps: [{ name: "Head", count: 1 }],
    aspects: aspects.map((label, i) => ({ label, states: [`${label}; Lit; Unheld`], ...(i === 0 ? { startup: true } : {}), lamps: [{ color: i === 0 ? "red" : "green", mode: "steady" }] })),
  };
}

function moduleBoard(name, module) {
  const config = myFirstBoardPreset();
  config.board.name = name;
  config.blocks = (module.sensors || []).map((s, i) => ({ name: s, topic: topicFor("block", s), topicCustom: false, gpio: SENSOR_PINS[i], inverted: true, debounce: "500ms" }));
  config.points = (module.turnouts || []).map((t, i) => ({ name: t, topic: topicFor("point", t), channel: i }));
  config.signals = { mode: "addressable", masts: (module.masts || []).map((m, i) => mast(m, CATS, MAST_PINS[i])) };
  config.logic = { mode: "mss", mss: plain(module.mss) };
  return config;
}

// The case as the engine runs it: each module's rule table in place of the module.
function engineCase(data) {
  if (data.modules) {
    const boards = Object.fromEntries(Object.entries(data.modules).map(([name, module]) => [name, plain(L.logicTable(moduleBoard(name, module)))]));
    return { ...data, modules: undefined, boards };
  }
  return { ...data, module: undefined, board: plain(L.logicTable(moduleBoard(data.start?.board || "module", data.module))) };
}

// ===== 1. The MSS behaviour cases ===========================================

for (const file of caseFiles) {
  const data = readCase(file);
  test(`${file.replace(/\.json$/, "")}: ${data.name}`, () => {
    assert.ok(data.about && Array.isArray(data.covers) && data.covers.length, "a case says what it covers");
    // Each module is a valid board: its description has no problems.
    const modules = data.modules || { [data.start?.board || "module"]: data.module };
    for (const [name, module] of Object.entries(modules)) {
      const config = moduleBoard(name, module);
      same(B.problems(config), [], `${name}: no MSS problems`);
      same(validateConfig(config).errors, [], `${name}: no validation errors`);
    }
    same(runCase(engineCase(data)), []);
  });
}

// ===== 2. Shapes ============================================================

const twoBlocks = () => moduleBoard("two-blocks", {
  sensors: ["S1", "S2", "O12"],
  masts: ["West"],
  mss: {
    ends: [{ name: "A", tracks: 1, pairPin: "GPIO4", ledPin: "GPIO2" }, { name: "B", tracks: 1 }],
    tracks: [{
      from: { end: "A", track: 1 }, to: { end: "B", track: 1 },
      blocks: [{ sensors: ["S1"] }, { sensors: ["S2"] }],
      boundaries: [{ sensors: ["O12"], towardsFrom: "West", towardsTo: null }],
    }],
  },
});

test("a two-block track builds two blocks with the boundary sensor in both, a group each way, and a signal with no lights for none", () => {
  const built = B.build(twoBlocks());
  same(built.blocks, [
    { name: "A1 to B1 block 1", topic: "trains/track/sensor/A1 to B1 block 1", sensors: ["S1", "O12", { end: "A", track: 1 }] },
    { name: "A1 to B1 block 2", topic: "trains/track/sensor/A1 to B1 block 2", sensors: ["S2", "O12", { end: "B", track: 1 }] },
  ]);
  same(built.layers.map((g) => [g.name, g.starter, g.rules.map((r) => [r.trigger.while.block, r.then.mast, r.then.aspect])]), [
    ["A1 to B1 towards B1", "block-signals", [
      ["A1 to B1 block 2", "A1 to B1 boundary 1 towards B1", "Clear"],
      ["A1 to B1 block 2", "A1 to B1 boundary 1 towards B1", "Clear"],
      ["A1 to B1 block 2", "A1 to B1 boundary 1 towards B1", "Approach"],
    ]],
    ["A1 to B1 towards A1", "block-signals", [
      ["A1 to B1 block 1", "West", "R281"],
      ["A1 to B1 block 1", "West", "R281"],
      ["A1 to B1 block 1", "West", "R285"],
    ]],
  ]);
  // Beyond the last block: what the end hears, read by meaning only.
  same(built.layers[1].rules[2].checks, [{ end: "A", track: 1, hears: "mast", is: ["stop", "restricting"] }]);
  same(built.masts, [
    { mast: "West", tags: { R292: "stop", R285: "approach", R281: "clear" }, stopAspect: "R292" },
    {
      virtual: true, name: "A1 to B1 boundary 1 towards B1", topic: "trains/track/signalmast/A1 to B1 boundary 1 towards B1",
      aspects: ["Stop", "Approach", "Clear"], tags: { Stop: "stop", Approach: "approach", Clear: "clear" },
    },
  ]);
});

test("plant ends: the first block's own sensors and the first signal facing inward; pins kept for the board", () => {
  same(B.build(twoBlocks()).ends, [
    { name: "A", tracks: [{ sensors: ["S1", "O12"], mast: "A1 to B1 boundary 1 towards B1" }], pairPin: "GPIO4", ledPin: "GPIO2" },
    { name: "B", tracks: [{ sensors: ["S2", "O12"], mast: "West" }] },
  ]);
  // The rule table carries the ends without their pins.
  same(L.logicTable(twoBlocks()).logic.ends, [
    { name: "A", tracks: [{ mast: "A1 to B1 boundary 1 towards B1", sensors: ["S1", "O12"] }] },
    { name: "B", tracks: [{ mast: "West", sensors: ["S2", "O12"] }] },
  ]);
});

const junctionModule = () => moduleBoard("jm", readCase("mss-junction-turnout.json").module);

test("a junction: its sensors are in the first block of every leg, and each leg's signal follows the next signal on each route", () => {
  const built = B.build(junctionModule());
  const block = (name) => built.blocks.find((b) => b.name === name).sensors;
  same(block("A1 to J1 leg 1 block 3"), ["K3", "O23", "JX"]);
  same(block("J1 leg 2 to B1 block 1"), ["Main", "JX", { end: "B", track: 1 }]);
  same(block("J1 leg 3 to C1 block 1"), ["Branch", "JX", { end: "C", track: 1 }]);
  const home = built.layers.find((g) => g.name === "Home");
  assert.equal(home.starter, "route-signal");
  // Each route's next signal is what an end hears: a meaning only, never
  // diverging, so the Approach Diverging rule is left out.
  same(home.rules.map((r) => [r.trigger.while.block, r.checks[0], r.then.aspect]), [
    ["J1 leg 2 to B1 block 1", { turnout: "P1", is: "closed" }, "R281"],
    ["J1 leg 2 to B1 block 1", { turnout: "P1", is: "closed" }, "ADV_NORM"],
    ["J1 leg 2 to B1 block 1", { turnout: "P1", is: "closed" }, "R285"],
    ["J1 leg 3 to C1 block 1", { turnout: "P1", is: "thrown" }, "R283"],
    ["J1 leg 3 to C1 block 1", { turnout: "P1", is: "thrown" }, "R283"],
    ["J1 leg 3 to C1 block 1", { turnout: "P1", is: "thrown" }, "R286"],
  ]);
  same(home.rules[3].checks[1], { end: "C", track: 1, hears: "mast", is: ["advance", "clear"] });
  // Legs 2 and 3 have no signal: each gets one with no lights, following the
  // first signal heading away on leg 1's track (the boundary signal towards A1).
  const leg3 = built.masts.find((m) => m.name === "J1 leg 3 signal");
  same(leg3.diverging, ["Diverging Clear", "Diverging Approach"]);
  same(built.layers.find((g) => g.name === "J1 leg 3 signal").rules[0].checks.slice(1, 2), [{ mast: "A1 to J1 leg 1 boundary 2 towards A1", is: "diverging" }]);
  // The junction signal's diverging aspects; Approach Diverging means approach.
  same(built.masts.find((m) => m.mast === "Home"), {
    mast: "Home",
    tags: { R292: "stop", R285: "approach", ADV_NORM: "advance", R281: "clear", R282: "approach", R283: "clear", R286: "approach" },
    diverging: ["R283", "R286"], stopAspect: "R292",
  });
  // End B's track enters straight into the junction: its first signal is that leg's.
  same(built.ends.find((e) => e.name === "B").tracks, [{ sensors: ["Main", "JX"], mast: "J1 leg 2 signal" }]);
});

test("a through track (no signals) builds one block and passes through its ends", () => {
  const config = moduleBoard("through", {
    sensors: ["X"],
    mss: {
      ends: [{ name: "A", tracks: 2 }, { name: "B", tracks: 2 }],
      tracks: [
        { from: { end: "A", track: 1 }, to: { end: "B", track: 2 }, blocks: [{ sensors: ["X"] }], boundaries: [] },
        { from: { end: "B", track: 1 }, to: { end: "A", track: 2 }, blocks: [{ sensors: ["X"] }], boundaries: [] },
      ],
    },
  });
  const built = B.build(config);
  same(built.blocks.map((b) => [b.name, b.sensors]), [
    ["A1 to B2 block 1", ["X", { end: "A", track: 1 }, { end: "B", track: 2 }]],
    ["B1 to A2 block 1", ["X", { end: "B", track: 1 }, { end: "A", track: 2 }]],
  ]);
  same(built.layers, []);
  same(built.ends, [
    { name: "A", tracks: [{ sensors: ["X"], through: { end: "B", track: 2 } }, { sensors: ["X"], through: { end: "B", track: 1 } }] },
    { name: "B", tracks: [{ sensors: ["X"], through: { end: "A", track: 2 } }, { sensors: ["X"], through: { end: "A", track: 1 } }] },
  ]);
});

test("built items are not stored, are rebuilt when the description changes, and building changes nothing", () => {
  const config = twoBlocks();
  const before = plain(config);
  const first = L.logicTable(config);
  same(config, before, "building leaves the board as it was");
  const blob = normalizeConfig(parseConfigFromYaml(generateYaml(config)));
  same(Object.keys(blob.logic).sort(), ["mode", "mss"], "only the description is in the file");
  same(L.logicTable(blob), first, "imported: the same rule table");
  assert.equal(L.versionCode(blob), L.versionCode(config));
  config.logic.mss.advanceApproach = true;
  assert.notEqual(L.versionCode(config), L.versionCode(blob), "a changed description changes the version code");
  same(L.logicTable(config).logic.layers[0].rules[1].then.aspect, "Advance Approach");
  same(first.logic.layers[0].rules[1].then.aspect, "Clear");
  // The same description always builds the same items.
  same(B.build(twoBlocks()), B.build(twoBlocks()));
});

// ===== 3. Generation ========================================================

test("an MSS board generates the component with the built rule table; Field Logic keys beside it are ignored", () => {
  const config = junctionModule();
  config.logic.layers = [{ name: "Ignored", rules: [{ trigger: { while: { block: "K1", is: "clear" } }, checks: [], then: { mast: "Home", aspect: "R281" } }] }];
  const yaml = generateYaml(config);
  assert.match(yaml, /^mr_logic:$/m);
  assert.match(yaml, new RegExp(`version: "${L.versionCode(config)}"`));
  const table = L.logicTable(config);
  assert.ok(!table.logic.layers.some((g) => g.name === "Ignored"));
  same(table.logic.ends.map((e) => e.name), ["A", "B", "C"]);
  // Built blocks publish like any block; built signals with no lights get globals.
  assert.match(yaml, /name: "A1 to J1 leg 1 block 1"/);
  assert.match(yaml, /id: j1_leg_3_signal_aspect/);
  same(validateConfig(config).errors, []);
});

test("Field Logic reads only its drawing, not the MSS description or the old page's keys; None reads nothing", () => {
  const config = junctionModule();
  config.logic = { mode: "field", blocks: [{ name: "Only", sensors: ["K1"] }], mss: config.logic.mss };
  same(L.logicBlocks(config), []);
  config.logic.plan = { track: [[[0, 0], [4, 0]]], breaks: [], blocks: [{ name: "Drawn", at: [[0, 0], [1, 0]], sensors: ["K1"] }] };
  same(L.logicBlocks(config).map((b) => b.name), ["Drawn"]);
  delete config.logic.plan;
  same(L.endsOf(config), []);
  config.logic.mode = undefined;
  same(L.logicBlocks(normalizeConfig(config)), []);
});

// ===== 4. Validation, mapped back ===========================================

const problemTexts = (config) => B.problems(config).map((p) => [p.level, p.where.part, p.text]);

test("validation: each problem points at the part of the description that caused it", () => {
  const config = junctionModule();
  const mss = config.logic.mss;
  mss.tracks[0].blocks[1].sensors = [];
  mss.tracks[0].boundaries[0].sensors = ["Nowhere"];
  mss.tracks[0].boundaries[1].sensors = [];
  mss.tracks[2].to = { end: "C", track: 2 };
  mss.junctions[0].sensors = [];
  mss.masts = [{ mast: "Home", aspects: { approach: "R999" } }];
  config.signals.masts[0].aspects = config.signals.masts[0].aspects.filter((a) => a.label !== "R285");
  const found = B.problems(config);
  same(found.map((p) => [p.level, p.where.part, p.text]), [
    ["warning", "logic-mss-junctions", 'Junction "J1" has no sensor, so a car standing on it is not seen. MSS asks for an optical sensor for each route: add one.'],
    ["error", "logic-mss-tracks", "Track 1 (A1 to J1 leg 1), block 2 has no sensor. Pick the current sensor that sees a train in it."],
    ["error", "logic-mss-tracks", 'Track 1 (A1 to J1 leg 1), block boundary 1 uses sensor "Nowhere", which is not on the Sensors page. Add it there, or pick another.'],
    ["warning", "logic-mss-tracks", "Track 1 (A1 to J1 leg 1), block boundary 2 has no sensor, so the signals there can clear while cars that draw no power are still on it. Add its optical sensor."],
    ["error", "logic-mss-tracks", "Track 3 (J1 leg 3 to C2): To is end C track 2, but end C has fewer tracks. Pick another, or add the track under Ends."],
    ["error", "logic-mss-ends", "End C track 1 has no track. Describe the track through it under Tracks, or give end C fewer tracks."],
    ["error", "logic-mss-signals", 'Pick what signal "Outer" shows for Approach under Signals.'],
    ["error", "logic-mss-signals", 'Signal "Home" has no aspect called "R999". Pick another for Approach under Signals.'],
  ]);
  same(found.find((p) => p.text.includes("block 2 has no sensor")).where, { view: "logic", part: "logic-mss-tracks", track: 0, block: 1 });
  same(found.find((p) => p.text.includes("Nowhere")).where, { view: "logic", part: "logic-mss-tracks", track: 0, boundary: 0 });
  // validateConfig reports them, each with its link.
  const { errors, links } = validateConfig(config);
  assert.ok(errors.includes("Track 1 (A1 to J1 leg 1), block 2 has no sensor. Pick the current sensor that sees a train in it."));
  same(links.get("End C track 1 has no track. Describe the track through it under Tracks, or give end C fewer tracks."), { view: "logic", part: "logic-mss-ends", end: 2 });
});

test("validation rejects two routes from one leg that can be active together", () => {
  const config = junctionModule();
  config.logic.mss.junctions[0].routes[1].turnouts = [{ turnout: "P1", position: "closed" }];
  same(problemTexts(config), [
    ["error", "logic-mss-junctions", 'Routes 1 and 2 of junction "J1" both leave leg 1, and their turnouts do not tell them apart, so both could be set at once. Give one of them a turnout in the other position.'],
  ]);
  // A route with no turnouts cannot be told apart either.
  config.logic.mss.junctions[0].routes[1].turnouts = [];
  assert.equal(problemTexts(config).length, 1);
  // The crossover's routes differ: none clash.
  same(problemTexts(moduleBoard("xo", readCase("mss-crossover.json").module)), []);
});

test("validation: places, ends, junctions and signals used twice", () => {
  const config = junctionModule();
  const mss = config.logic.mss;
  mss.ends.push({ name: "A", tracks: 0 });
  mss.tracks.push({ from: { end: "B", track: 1 }, to: { end: "B", track: 1 }, blocks: [{ sensors: ["Main"] }], boundaries: [] });
  mss.tracks.push({ from: { junction: "J9", leg: 1 }, to: null, blocks: [{ sensors: ["Main"] }, { sensors: ["K1"] }], boundaries: [] });
  mss.tracks[0].boundaries[0].towardsFrom = "Dist";
  mss.junctions.push({ name: "J2", sensors: ["JX"], masts: {}, routes: [{ legs: [1, 1], turnouts: [] }] });
  const texts = problemTexts(config).map(([, , text]) => text);
  for (const expected of [
    'Two ends are called "A". Give each end its own letter.',
    'Junction "J2" needs at least two routes. Add the routes its turnouts can set.',
    'Route 1 of junction "J2" needs two different legs. Pick the leg at each side.',
    "Track 4 (B1 to B1) starts and finishes at the same place. Pick a different To.",
    'Track 5 (J9 leg 1 to dead end): From is a leg of junction "J9", which is not under Junctions. Add it, or pick another.',
    "Track 5 (J9 leg 1 to dead end) has 0 block boundaries for 2 blocks. There is one block boundary between each two blocks: add or remove one.",
    "End B track 1 is used by tracks 2 and 4. Each end track and leg joins one track: pick another for one of them.",
    'Signal "Dist" is used twice: Track 1 (A1 to J1 leg 1), block boundary 1, the signal towards A1, and Track 1 (A1 to J1 leg 1), block boundary 2, the signal towards J1 leg 1. A signal faces one way at one place: pick another for one of them.',
  ]) assert.ok(texts.includes(expected), `${expected}\n--- got:\n${texts.join("\n")}`);
  // A through track looping back to its own end.
  const loop = twoBlocks();
  loop.logic.mss.ends[0].tracks = 2;
  loop.logic.mss.tracks.push({ from: { end: "A", track: 2 }, to: { end: "A", track: 2 }, blocks: [{ sensors: ["S1"] }], boundaries: [] });
  loop.logic.mss.tracks[1].to = { end: "A", track: 1 };
  assert.ok(problemTexts(loop).some(([, , t]) => t.startsWith("Track 2 (A2 to A1) is a through track (no signals) from end A back to end A")));
});

test("the checks for Field Logic run over the built items once the description is fine, pointing back at what made them", () => {
  const config = twoBlocks();
  // A sensor with the name of a built block: the block check finds it.
  config.blocks.push({ name: "A1 to B1 block 2", topic: "layout/x", topicCustom: true, gpio: "GPIO13", inverted: true, debounce: "500ms" });
  const { errors, links } = validateConfig(config);
  const text = 'Block "A1 to B1 block 2" has the same name as sensor "A1 to B1 block 2". Rename the block. Made by MSS Logic from Track 1 (A1 to B1), block 2.';
  assert.ok(errors.includes(text), errors.join("\n"));
  same(links.get(text), { view: "logic", part: "logic-mss-tracks", track: 0, block: 1 });
  // While the description has an error, only that is reported.
  config.logic.mss.tracks[0].blocks[0].sensors = [];
  assert.ok(!validateConfig(config).errors.some((e) => e.includes("Made by MSS Logic")));
});

// ===== 5. Linked boards, renames ============================================

test("importing an MSS board as a linked board carries its built blocks and signals", () => {
  const other = junctionModule();
  const snapshot = L.linkedBoardFromConfig(plain(other));
  same(snapshot.logic.blocks.map((b) => b.name), B.build(other).blocks.map((b) => b.name));
  const home = snapshot.signals.masts.find((m) => m.name === "Home");
  same(home.tags.R282, "approach");
  same(home.diverging, ["R283", "R286"]);
  same(snapshot.logic.masts.map((m) => m.name), ["A1 to J1 leg 1 boundary 1 towards A1", "A1 to J1 leg 1 boundary 2 towards A1", "J1 leg 2 signal", "J1 leg 3 signal"]);
  same(snapshot.logic.resources, []);
  assert.equal(snapshot.share, true);
});

test("renaming a sensor, turnout, mast or aspect on its page renames it in the description", () => {
  const config = junctionModule();
  config.logic.mss.masts = [{ mast: "Home", aspects: { clear: "R281" } }];
  assert.equal(L.renameReferences(config, "sensor", "JX", "J1 optical"), 1);
  assert.equal(L.renameReferences(config, "turnout", "P1", "Points 1"), 2);
  assert.equal(L.renameReferences(config, "mast", "Home", "J1 Home"), 2);
  assert.equal(L.renameReferences(config, "mast", "Dist", "Distant"), 1);
  assert.equal(L.renameAspect(config, "J1 Home", "R281", "Clear"), 1);
  const mss = config.logic.mss;
  same(mss.junctions[0].sensors, ["J1 optical"]);
  same(mss.junctions[0].routes.map((r) => r.turnouts[0].turnout), ["Points 1", "Points 1"]);
  same(mss.junctions[0].masts["1"], "J1 Home");
  same(mss.tracks[0].boundaries[1].towardsTo, "Distant");
  same(mss.masts, [{ mast: "J1 Home", aspects: { clear: "Clear" } }]);
});

// ===== The checker on MSS Logic (work item 4.5) ===============================

const { EsphomeMrLogicChecker: Checker, EsphomeMrLogicUiStart: Start } = context;
const PARTIAL = /too many combinations to check every one quickly/;

test("the checker runs on an MSS board: a junction module passes a full check, which the Download page offers", () => {
  const config = junctionModule();
  const quick = validateConfig(config);
  same(quick.errors, []);
  // The quick check may not finish a junction module; if not, it says so and
  // the Download page offers the full check.
  const partial = quick.warnings.find((w) => PARTIAL.test(w));
  same(!!partial, Checker.needsFullCheck(config));
  if (partial) {
    same(quick.links.get(partial).part, B.PARTS.tracks);
    same(plain(Start.downloadLogic(config, quick).fullCheck).button, "Check every combination");
  }
  const full = Checker.checkFully(config);
  same([full.complete, full.problems], [true, []]);
  assert.ok(full.parts > 1, `${full.parts} parts`);
  // Now validation has every combination checked, and nothing is offered.
  const after = validateConfig(config);
  same(after.warnings.filter((w) => PARTIAL.test(w)), []);
  same(Start.downloadLogic(config, after).fullCheck, null);
});

test("the checker finds what the description cannot show: a route that needs a turnout both ways", () => {
  const config = junctionModule();
  config.logic.mss.junctions[0].routes[0].turnouts.push({ turnout: "P1", position: "thrown" });
  same(B.problems(config), []);
  Checker.checkFully(config);
  const { errors, warnings, links } = validateConfig(config);
  same(errors, []);
  const stuck = warnings.find((w) => /Signal "J1 leg 2 signal" can never show anything but Stop/.test(w));
  assert.ok(stuck, warnings.join("\n"));
  same(links.get(stuck), { view: "logic", part: B.PARTS.junctions, junction: 0, leg: 2 });
  assert.ok(warnings.some((w) => /Rule 1 in group "Home" can never apply/.test(w)));
});

if (!process.exitCode) console.log("\nAll MSS builder tests passed.");
