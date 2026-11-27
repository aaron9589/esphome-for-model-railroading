// Checker limits (work item 4.5; docs/field-logic-spec.md, Checking in the
// browser). Not a test: npm test only runs test/*.test.js. Run it by hand:
//
//   node test/bench/checker-limits.mjs            every board, full check
//   node test/bench/checker-limits.mjs four       only boards whose name has "four"
//
// For each board it prints the inputs (inputsOf, as Try it offers them), the
// rules, the parts and the inputs each part explores, then the states, whether
// the check finished, and the time: with no budget (up to CAP states, default
// 100000, no time limit), at BUDGETS.validation and at BUDGETS.full.
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules } from "../harness.js";
import { planBoard, planCaseNames, readPlanCase } from "../plan-cases.js";
import { station } from "../plan-station.js";

const ctx = loadModules("generator.js", "logic-yaml.js", "logic.js", "logic-checker.js", "logic-starters.js", "logic-starters-sections.js", "logic-starters-signals.js", "mss-builder.js", "plan-builder.js");
const { EsphomeMr, EsphomeMrLogicChecker: C, EsphomeMrLogicYaml: L } = ctx;
const { myFirstBoardPreset, topicFor } = EsphomeMr;

const CAP = Number(process.env.CAP || 100000);
const plain = (value) => JSON.parse(JSON.stringify(value));
const casesDir = path.join(configuratorDir, "test", "cases");
const readCase = (file) => JSON.parse(fs.readFileSync(path.join(casesDir, file), "utf8"));

// ===== An MSS module as a configurator board (as mss-builder.test.js) =======

const CATS = ["R292", "R285", "ADV_NORM", "R281", "R282", "R283", "R286"];
const SENSOR_PINS = ["GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO32", "GPIO35", "GPIO34", "GPIO39"];
const MAST_PINS = ["GPIO16", "GPIO17", "GPIO19", "GPIO23", "GPIO18", "GPIO13"];

function mssMast(name, pin) {
  return {
    name, topic: topicFor("signal", name), topicCustom: false, mode: "addressable", pin,
    lamps: [{ name: "Head", count: 1 }],
    aspects: CATS.map((label, i) => ({ label, states: [`${label}; Lit; Unheld`], ...(i === 0 ? { startup: true } : {}), lamps: [{ color: i === 0 ? "red" : "green", mode: "steady" }] })),
  };
}

function mssTable(name, module) {
  const config = myFirstBoardPreset();
  config.board.name = name;
  config.blocks = (module.sensors || []).map((s, i) => ({ name: s, topic: topicFor("block", s), topicCustom: false, gpio: SENSOR_PINS[i], inverted: true, debounce: "500ms" }));
  config.points = (module.turnouts || []).map((t, i) => ({ name: t, topic: topicFor("point", t), channel: i }));
  config.signals = { mode: "addressable", masts: (module.masts || []).map((m, i) => mssMast(m, MAST_PINS[i])) };
  config.logic = { mode: "mss", mss: plain(module.mss) };
  return plain(L.logicTable(config));
}

// ===== A four-entrance section, as the One-train section starter wrote it ====
// (the starter went in TP 9; its rules are written out here)

function fourEntrances({ sectionBlocks = 1, approachLock = "", entrances = 4 } = {}) {
  const tags = { R292: "stop", R281: "clear" };
  const waiting = ["North", "South", "East", "West"].slice(0, entrances);
  const inside = Array.from({ length: sectionBlocks }, (_, i) => `Bridge ${i + 1}`);
  const masts = Object.fromEntries(waiting.map((w) => [`${w} Bridge`, { aspects: tags }]));
  const clear = inside.map((block) => ({ block, is: "clear" }));
  const section = { name: "Bridge", blocks: inside, release: { while: clear.length === 1 ? clear[0] : { all: clear }, for: "3s" }, ...(approachLock ? { approachLock } : {}) };
  const rules = waiting.map((w) => ({ trigger: { while: { block: w, is: "occupied" }, for: "0.5s" }, checks: [], then: { mast: `${w} Bridge`, aspect: "R281", reserve: "Bridge" } }));
  return { sensors: [...waiting, ...inside], turnouts: [], masts, logic: { resources: [section], layers: [{ name: "Bridge", rules }] } };
}

// ===== The boards =============================================================

const boards = [];
const add = (name, board, extra = {}) => boards.push({ name, board, extra });

add("two entrances, one block", fourEntrances({ entrances: 2 }));
add("three entrances, one block", fourEntrances({ entrances: 3 }));
add("four entrances, one block", fourEntrances());
add("four entrances, one block, hold 10s", fourEntrances({ approachLock: "10s" }));
add("four entrances, two blocks", fourEntrances({ sectionBlocks: 2 }));
add("block signals worked example", readCase("blocksig-worked-example.json").board);
for (const file of ["mss-crossover.json", "mss-junction-turnout.json", "mss-junction-no-approach-diverging.json", "mss-approach-diverging-no-advance.json", "mss-appendix-b-advance.json"]) {
  const data = readCase(path.join("mss", file));
  add(`MSS ${file.replace(/^mss-|\.json$/g, "")}`, mssTable("module", data.module));
}
for (const [name, module] of Object.entries(readCase(path.join("mss", "mss-three-modules.json")).modules)) add(`MSS three modules: ${name}`, mssTable(name, module));
for (const [name, board] of Object.entries(readCase("ends-three-boards-turned.json").boards)) add(`ends three boards: ${name}`, board);
// Drawn track plans (TP 5), with what the plan tells the checker: its own
// layers (never warned about as never applying) and the blocks at its ends.
for (const [name, module] of [...planCaseNames().map((n) => [n, readPlanCase(n).module]), ["station", station()]]) {
  const config = planBoard(ctx, module);
  const items = L.logicItems(config);
  add(`plan ${name}`, plain(L.logicTable(config)), {
    ignore: items.layers.filter((l) => String(l.starter || "").startsWith("plan-")).map((l) => l.name),
    endBlocks: plain(items.endBlocks || []),
  });
}

// ===== Measure ===============================================================

const only = process.argv[2];
const budgets = [
  ["none", { maxStates: CAP, maxMs: Infinity }],
  ["validation", C.BUDGETS.validation],
  ["full", C.BUDGETS.full],
];
const rules = (board) => (board.logic?.layers || []).reduce((n, layer) => n + (layer.rules || []).length, 0);
const rows = [];
for (const { name, board, extra } of boards) {
  if (only && !name.includes(only)) continue;
  const parts = C.partsOf(board);
  const row = { board: name, inputs: C.inputsOf(board).length, rules: rules(board), parts: parts.map((p) => C.inputsOf(p.board).length).join("+") };
  for (const [label, options] of budgets) {
    const started = process.hrtime.bigint();
    const result = C.checkBoard(board, { ...options, ...extra });
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    row[label] = `${result.states}${result.complete ? "" : "+"} ${Math.round(ms)}ms${result.complete ? "" : ` (${result.runs} runs)`}`;
    if (label === "none") row.problems = result.problems.map((p) => `${p.level}:${p.kind}`).join(" ") || "-";
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}
console.log("\n| Board | Inputs | Rules | Parts (inputs each) | No budget | Validation | Full | Problems |");
console.log("|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.board} | ${r.inputs} | ${r.rules} | ${r.parts} | ${r.none} | ${r.validation} | ${r.full} | ${r.problems} |`);
console.log(`\nStates with + did not finish (random runs after). Node ${process.version}. Budgets: ${JSON.stringify(C.BUDGETS)}`);
