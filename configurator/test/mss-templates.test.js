// MSS Logic templates (mss-templates.js): a standard MSS module in one click.
// Each builds with no errors, prefills every signal from its CATS aspects,
// and runs in Try it.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

const html = fs.readFileSync(path.join(configuratorDir, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script src="\.\/([^"]+)"><\/script>/g)].map((m) => m[1]);
const context = loadModules(...scripts.slice(scripts.indexOf("generator.js"), scripts.indexOf("app.js")));
const { EsphomeMr: M, EsphomeMrMssBuilder: B, EsphomeMrMssTemplates: MT, EsphomeMrLogicTry: Try, EsphomeMrLogicUiMssModule: Module } = context;
const plain = (value) => JSON.parse(JSON.stringify(value));

// A fresh board in MSS Logic, with the example sensor and turnout taken off.
function freshBoard() {
  const config = M.myFirstBoardPreset();
  config.blocks = [];
  config.points = [];
  config.signals = { masts: [] };
  config.logic = { mode: "mss" };
  return config;
}

// What the page's addItems does, with fixed pins.
function addTo(config) {
  const pins = ["GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO32", "GPIO16", "GPIO17", "GPIO19", "GPIO23", "GPIO18", "GPIO13"];
  return ({ sensors, turnouts, masts }) => {
    for (const name of sensors) config.blocks.push({ name, topic: M.topicFor("block", name), topicCustom: false, gpio: pins.shift(), inverted: true, debounce: "500ms" });
    for (const name of turnouts) config.points.push({ name, topic: M.topicFor("point", name), topicCustom: false, pcaBoard: 0, channel: config.points.length, servoPin: "", travelTime: "10s", controls: [] });
    for (const mast of masts) config.signals.masts.push({ ...mast, topic: M.topicFor("signal", mast.name), topicCustom: false, mode: "addressable", pin: pins.shift(), numLeds: mast.lamps.length });
  };
}

function made(id) {
  const config = freshBoard();
  MT.apply(config, id, addTo(config));
  return config;
}

const errors = (config) => plain(B.problems(config).filter((p) => p.level === "error").map((p) => p.text));

test("plan: what each template adds to an empty board", () => {
  assert.deepEqual(plain(MT.plan(freshBoard(), "crossover")), { title: "Crossover", sensors: ["Block A current"], turnouts: [], masts: [], kept: [], replaces: false });
  assert.deepEqual(plain(MT.plan(freshBoard(), "cascade")).masts, ["Signal A", "Signal B"]);
  const sw = plain(MT.plan(freshBoard(), "switch"));
  assert.deepEqual(sw.sensors, ["Block A current", "IR sensor", "Block B current", "Block C current"]);
  assert.deepEqual(sw.turnouts, ["Turnout"]);
  assert.deepEqual(sw.masts, ["Signal A", "Signal B", "Signal C"]);
  assert.equal(MT.plan(freshBoard(), "nothing"), null);
});

test("plan and apply: items already on the board are used as they are, not added again", () => {
  const config = freshBoard();
  config.blocks.push({ name: "IR sensor", gpio: "GPIO4" });
  const p = plain(MT.plan(config, "cascade"));
  assert.deepEqual(p.kept, ["IR sensor"]);
  assert.ok(!p.sensors.includes("IR sensor"));
  MT.apply(config, "cascade", addTo(config));
  assert.equal(config.blocks.filter((b) => b.name === "IR sensor").length, 1);
  assert.equal(config.blocks.find((b) => b.name === "IR sensor").gpio, "GPIO4");
});

test("apply replaces a module already described, and keeps the indication ticks", () => {
  const config = made("cascade");
  config.logic.mss.advanceApproach = true;
  assert.equal(MT.plan(config, "crossover").replaces, true);
  MT.apply(config, "crossover", addTo(config));
  assert.equal(config.logic.mss.tracks.length, 1);
  assert.equal(config.logic.mss.advanceApproach, true);
});

for (const id of MT.IDS) {
  test(`${id}: builds with no errors, every signal prefilled from its CATS aspects`, () => {
    const config = made(id);
    assert.deepEqual(errors(config), []);
    // The whole board's checks too (plant ends, the checker): nothing stops the download.
    assert.deepEqual(plain(M.validateConfig(config).errors), []);
    assert.ok(M.generateYaml(config).includes("mr_logic"), "the YAML has the logic component");
  });
}

test("crossover: one block across the module and no signals", () => {
  const built = B.build(made("crossover"));
  assert.equal(built.blocks.length, 1);
  assert.equal(built.masts.filter((m) => m.mast).length, 0);
  assert.deepEqual(plain(built.ends).map((e) => e.name), ["A", "B"]);
});

test("cascade: a train from End A drops Signal A to Stop behind it, and Signal B is not in its way", () => {
  const config = made("cascade");
  const session = Try.createSession(config);
  const route = Module.trainRoute(config, { end: "A", track: 1 }, () => "closed");
  assert.deepEqual(plain(route.masts), ["Signal A"]);
  const steps = Try.runTrain(session, { path: route.blocks, masts: ["Signal A", "Signal B"] });
  const names = B.namesOf(config).blocks;
  const tag = (step, name) => step.masts.find((m) => m.name === name)?.tag;
  const inB = steps.find((s) => JSON.stringify(s.blocks.filter((b) => b.occupied).map((b) => b.name)) === JSON.stringify([names["0:1"]]));
  assert.notEqual(tag(steps[0], "Signal A"), "stop");
  assert.equal(tag(inB, "Signal A"), "stop");
});

test("complex cascade: Signal A shows a diverging aspect with the turnout thrown, on its lower head", () => {
  const config = made("switch");
  const session = Try.createSession(config);
  session.advance(1000);
  const shown = (name) => session.view().masts.find((m) => m.name === name);
  assert.notEqual(shown("Signal A").tag, "stop");
  assert.equal(shown("Signal A").aspect, "Approach", "main line set: the end beyond counts as Stop, so Approach");
  session.setTurnout("Turnout", "thrown");
  session.advance(1000);
  assert.equal(shown("Signal A").aspect, "Diverging Approach");
  const mast = config.signals.masts.find((m) => m.name === "Signal A");
  const lit = plain(mast.aspects.find((a) => a.label === "Diverging Approach").lamps.map((l) => l.color));
  assert.deepEqual(lit, ["amber", "red"], "lower head amber, upper red");
});
