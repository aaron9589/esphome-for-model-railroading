// Writes gauntlet.yaml: the gauntlet board from the configurator's generator,
// plus the mr_logic component bound to everything it can bind, for CI's
// `esphome compile`. Work item 2.4; 2.5's generator will write this part itself.
//   node engine-tests/esphome/make-gauntlet.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..");
const ctx = { crypto: globalThis.crypto };
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ["generator.js", "logic-yaml.js"]) vm.runInContext(fs.readFileSync(path.join(repo, "configurator", f), "utf8"), ctx);
const M = ctx.EsphomeMr;
const L = ctx.EsphomeMrLogicYaml;

const config = M.normalizeConfig(JSON.parse(fs.readFileSync(path.join(repo, "configurator/test/fixtures/turnouts-gpio.json"), "utf8")));
config.board.name = "gauntlet-k7m4x2";
config.board.nameSuffix = "k7m4x2";
config.blocks = ["Left", "Bridge", "Right"].map((name, i) => ({
  name, topic: M.topicFor("block", name), topicCustom: false, gpio: ["GPIO14", "GPIO27", "GPIO26"][i], inverted: true, debounce: "500ms",
}));
config.points = [{ ...config.points[0], name: "P1", topic: M.topicFor("point", "P1"), lockEnabled: true, lockDefault: "unlocked",
  controls: [{ action: "latch-thrown", buttonPin: "GPIO33" }] }];
const lamp = (color) => ({ color, mode: "steady" });
config.signals = { mode: "gpio", masts: ["Left Bridge", "Right Bridge"].map((name, i) => ({
  name, topic: M.topicFor("signal", name), topicCustom: false, mode: "gpio",
  lamps: [{ name: "Red", count: 1, pin: ["GPIO32", "GPIO21"][i] }, { name: "Green", count: 1, pin: ["GPIO19", "GPIO22"][i] }],
  aspects: [
    { label: "Stop", states: ["R292; Lit; Unheld"], startup: true, lamps: [lamp("red"), lamp("off")] },
    { label: "Clear", states: ["R281; Lit; Unheld"], lamps: [lamp("off"), lamp("green")] },
  ],
})) };
// Field Logic with a block that reads a linked board's sensor, so the
// generator writes that board's subscriptions.
const north = L.typedLinkedBoard("kiama-north-k7m4x2");
north.blocks = [L.typedItem("sensor", "Approach")];
config.logic = { mode: "field", remoteBoards: [north], blocks: [{ name: "Far", topic: M.topicFor("block", "Far"), topicCustom: false,
  sensors: [{ board: "kiama-north-k7m4x2", sensor: "Approach" }] }] };
const errors = [...M.validateConfig(config).errors];
if (errors.length) throw new Error(errors.join("\n"));
let yaml = M.generateYaml(config);

// The rule table: the gauntlet case's board, with P1 locked by the Left entrance.
const table = JSON.parse(fs.readFileSync(path.join(repo, "configurator/test/cases/rules-approach-locking-off.json"), "utf8")).board;
table.remote = { "kiama-north-k7m4x2": { sensors: ["Approach"] } };

const ids = (list) => M.uniqueIds(list);
const remoteIds = L.resolveRemote(config, { board: "kiama-north-k7m4x2", sensor: "Approach" });
const point = ids(config.points)[0];
const section = [
  "",
  "external_components:",
  "  - source:",
  "      type: local",
  "      path: ../../components",
  "    components: [mr_logic]",
  "",
  "mr_logic:",
  "  id: logic",
  `  board: ${config.board.name}`,
  "  version: test0001",
  `  table: '${JSON.stringify(table)}'`,
  "  logic_switch: field_logic",
  "  sensors:",
  ...ids(config.blocks).flatMap((b) => [`    - name: ${M.yamlQuote(b.name)}`, `      sensor: ${b.id}_sensor`]),
  "  masts:",
  ...ids(config.signals.masts).flatMap((m) => [`    - name: ${M.yamlQuote(m.name)}`, `      aspect: ${m.id}_aspect`, `      show: ${m.id}_show`, `      jmri: ${m.id}`]),
  "  turnouts:",
  `    - name: ${point.name}`,
  `      thrown: ${point.id}_thrown`,
  `      throw_closed: ${point.id}_throw_closed`,
  `      throw_thrown: ${point.id}_throw_thrown`,
  `      field_locked: ${point.id}_field_locked`,
  `      remote_locked: ${point.id}_locked`,
  `      resync: ${point.id}_latch_1`,
  "  remote:",
  "    - board: kiama-north-k7m4x2",
  `      online: ${remoteIds.onlineId}`,
  "      sensors:",
  "        - name: Approach",
  `          state: ${remoteIds.id}`,
  "",
];
yaml = yaml.trimEnd() + "\n" + section.join("\n");
// The field lock global, the logic switch and the Release button: 2.5 writes these.
yaml = yaml.replace(/^globals:\n/m, `globals:\n  - id: ${point.id}_field_locked\n    type: bool\n    restore_value: false\n    initial_value: "false"\n`);
const extra = {
  switch: ["  - platform: template", "    id: field_logic", '    name: "Field logic"', "    optimistic: true", "    restore_mode: RESTORE_DEFAULT_ON"],
  button: ["  - platform: template", '    name: "Release Bridge"', "    on_press:", "      - lambda: 'id(logic).release(\"Bridge\");'"],
};
for (const [key, lines] of Object.entries(extra)) {
  const at = yaml.search(new RegExp(`^${key}:\\n`, "m"));
  yaml = at >= 0 ? yaml.replace(new RegExp(`^${key}:\\n`, "m"), `${key}:\n${lines.join("\n")}\n`) : `${yaml}\n${key}:\n${lines.join("\n")}\n`;
}
const header = "# Made by engine-tests/esphome/make-gauntlet.mjs for CI's esphome compile. Do not edit by hand.\n";
fs.writeFileSync(path.join(here, "gauntlet.yaml"), header + yaml);
console.log("wrote", path.join(here, "gauntlet.yaml"));
