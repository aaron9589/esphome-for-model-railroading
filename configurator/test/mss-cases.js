// MSS Logic's hand-worked cases (test/cases/mss) as boards. Each case gives a
// module (its sensors, turnouts and masts by name, and `logic.mss`, a
// description or a row of nodes); mssBoard makes the configurator board, and
// builtMssCases turns each case into an engine case (each board as its rule
// table, built the way the YAML is), so both engines can replay it:
// mss-builder.test.js in JS, engine-diff.test.js in the C++ core too.
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules } from "./harness.js";

export const mssCasesDir = path.join(configuratorDir, "test", "cases", "mss");
export const mssCaseFiles = () => fs.readdirSync(mssCasesDir).filter((file) => file.endsWith(".json")).sort();
export const readMssCase = (file) => JSON.parse(fs.readFileSync(path.join(mssCasesDir, file), "utf8"));
export const MSS_FILES = ["generator.js", "logic-yaml.js", "logic.js", "logic-checker.js", "logic-starters.js", "logic-starters-sections.js", "logic-starters-signals.js", "mss-builder.js", "mss-templates.js", "mss-row.js", "plan-builder.js"];

const CATS = ["R292", "R285", "ADV_NORM", "R281", "R282", "R283", "R286"];
const SENSOR_PINS = ["GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO32", "GPIO35", "GPIO34", "GPIO39"];
const MAST_PINS = ["GPIO16", "GPIO17", "GPIO19", "GPIO23", "GPIO18", "GPIO13", "GPIO4"];
const plain = (value) => JSON.parse(JSON.stringify(value));

/** The configurator board for a case's module, in `context`'s generator. */
export function mssBoard(context, name, module) {
  const { myFirstBoardPreset, topicFor } = context.EsphomeMr;
  const mast = (mastName, pin) => ({
    name: mastName, topic: topicFor("signal", mastName), topicCustom: false, mode: "addressable", pin,
    lamps: [{ name: "Head", count: 1 }],
    aspects: CATS.map((label, i) => ({ label, states: [`${label}; Lit; Unheld`], ...(i === 0 ? { startup: true } : {}), lamps: [{ color: i === 0 ? "red" : "green", mode: "steady" }] })),
  });
  const config = myFirstBoardPreset();
  config.board.name = name;
  config.blocks = (module.sensors || []).map((s, i) => ({ name: s, topic: topicFor("block", s), topicCustom: false, gpio: SENSOR_PINS[i], inverted: true, debounce: "500ms" }));
  config.points = (module.turnouts || []).map((t, i) => ({ name: t, topic: topicFor("point", t), channel: i }));
  config.signals = { mode: "addressable", masts: (module.masts || []).map((m, i) => mast(m, MAST_PINS[i])) };
  config.logic = { mode: "mss", mss: plain(module.mss) };
  return config;
}

/** A case as the engine runs it: each module's rule table in place of the module. */
export function engineMssCase(context, data) {
  const table = (name, module) => plain(context.EsphomeMrLogicYaml.logicTable(mssBoard(context, name, module)));
  if (data.modules) {
    const boards = Object.fromEntries(Object.entries(data.modules).map(([name, module]) => [name, table(name, module)]));
    return { ...data, modules: undefined, boards };
  }
  return { ...data, module: undefined, board: table(data.start?.board || "module", data.module) };
}

/** Every MSS case as an engine case: [{ file, data }]. */
export function builtMssCases() {
  const context = loadModules(...MSS_FILES);
  return mssCaseFiles().map((file) => ({ file, data: plain(engineMssCase(context, readMssCase(file))) }));
}
