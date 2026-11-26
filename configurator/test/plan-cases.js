// The track plan's hand-worked cases (test/cases/plan) as boards. Each case
// gives a drawing; planBoard makes the configurator board it is drawn on, and
// builtPlanCases turns each case into an engine case (the board as its rule
// table, built the way the YAML is), so both engines can replay it:
// plan-builder.test.js in JS, engine-diff.test.js in the C++ core too.
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules } from "./harness.js";

export const planCasesDir = path.join(configuratorDir, "test", "cases", "plan");
export const readPlanCase = (name) => JSON.parse(fs.readFileSync(path.join(planCasesDir, `${name}.json`), "utf8"));
export const planCaseNames = () => fs.readdirSync(planCasesDir).filter((f) => f.endsWith(".json")).sort().map((f) => f.replace(/\.json$/, ""));

const CATS = ["R292", "R285", "ADV_NORM", "R281", "R282", "R283", "R286"];
const SENSOR_PINS = ["GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO32", "GPIO35", "GPIO34", "GPIO39"];
const MAST_PINS = ["GPIO16", "GPIO17", "GPIO19", "GPIO23", "GPIO18", "GPIO13", "GPIO4"];
const plain = (value) => JSON.parse(JSON.stringify(value));

/** The configurator board a case's `module` is drawn on, in `context`'s generator. */
export function planBoard(context, module) {
  const { myFirstBoardPreset, topicFor } = context.EsphomeMr;
  const mast = (name, pin) => ({
    name, topic: topicFor("signal", name), topicCustom: false, mode: "addressable", pin,
    lamps: [{ name: "Head", count: 1 }],
    aspects: CATS.map((label, i) => ({ label, states: [`${label}; Lit; Unheld`], ...(i === 0 ? { startup: true } : {}), lamps: [{ color: i === 0 ? "red" : "green", mode: "steady" }] })),
  });
  const config = myFirstBoardPreset();
  config.board.name = "plan-k7m4x2";
  config.board.nameSuffix = "k7m4x2";
  config.blocks = module.sensors.map((s, i) => ({ name: s, topic: topicFor("block", s), topicCustom: false, gpio: SENSOR_PINS[i], inverted: true, debounce: "500ms" }));
  config.points = (module.turnouts || []).map((t, i) => ({ name: t, topic: topicFor("point", t), channel: i }));
  config.signals = { mode: "addressable", masts: module.masts.map((m, i) => mast(m, MAST_PINS[i])) };
  config.logic = { mode: "field", plan: plain(module.plan) };
  return config;
}

/** Every plan case as an engine case: [{ name, data }], `data.board` the built rule table. */
export function builtPlanCases() {
  const context = loadModules("generator.js", "logic-yaml.js", "logic.js", "logic-checker.js", "logic-starters.js", "logic-starters-sections.js", "logic-starters-signals.js", "mss-builder.js", "plan-builder.js");
  return planCaseNames().map((name) => {
    const data = readPlanCase(name);
    const board = plain(context.EsphomeMrLogicYaml.logicTable(planBoard(context, data.module)));
    return { name, data: { ...data, module: undefined, board } };
  });
}
