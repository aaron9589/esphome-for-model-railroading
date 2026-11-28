// Writes gauntlet.yaml: the gauntlet board as the configurator's generator
// writes it, Field Logic and all, for CI's `esphome compile`. The only change
// is the component's source: this checkout instead of the pinned GitHub ref.
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
for (const f of ["generator.js", "logic-yaml.js", "logic.js", "logic-checker.js", "logic-starters.js", "logic-starters-sections.js", "logic-starters-signals.js", "mss-builder.js", "plan-builder.js"]) vm.runInContext(fs.readFileSync(path.join(repo, "configurator", f), "utf8"), ctx);
const M = ctx.EsphomeMr;
const L = ctx.EsphomeMrLogicYaml;

const config = M.normalizeConfig(JSON.parse(fs.readFileSync(path.join(repo, "configurator/test/fixtures/turnouts-gpio.json"), "utf8")));
config.board.name = "gauntlet-k7m4x2";
config.board.nameSuffix = "k7m4x2";
config.blocks = ["Left", "Bridge", "Right"].map((name, i) => ({
  name, topic: M.topicFor("block", name), topicCustom: false, gpio: ["GPIO14", "GPIO27", "GPIO26"][i], inverted: true, debounce: "500ms",
}));
// P1: a toggle switch and Remote lock. P2: a push button, no Remote lock.
config.points = [
  { ...config.points[0], name: "P1", topic: M.topicFor("point", "P1"), lockEnabled: true, lockDefault: "unlocked",
    controls: [{ action: "latch-thrown", buttonPin: "GPIO33" }] },
  { ...config.points[0], name: "P2", topic: M.topicFor("point", "P2"), servoPin: "GPIO25", lockEnabled: false,
    controls: [{ action: "toggle", buttonPin: "GPIO4" }] },
];
const lamp = (color) => ({ color, mode: "steady" });
config.signals = { mode: "gpio", masts: ["Left Bridge", "Right Bridge"].map((name, i) => ({
  name, topic: M.topicFor("signal", name), topicCustom: false, mode: "gpio",
  lamps: [{ name: "Red", count: 1, pin: ["GPIO32", "GPIO21"][i] }, { name: "Green", count: 1, pin: ["GPIO19", "GPIO22"][i] }],
  aspects: [
    { label: "Stop", states: ["R292; Lit; Unheld"], startup: true, lamps: [lamp("red"), lamp("off")] },
    { label: "Clear", states: ["R281; Lit; Unheld"], lamps: [lamp("off"), lamp("green")] },
  ],
})) };

// A linked board: Far reads its Approach sensor, and Right Bridge clears only
// while its Home mast is not at Stop.
const north = L.typedLinkedBoard("kiama-north-k7m4x2");
north.blocks = [L.typedItem("sensor", "Approach")];
north.signals.masts = [{ name: "Home", topic: M.topicFor("signal", "Home"), aspects: ["R292", "R281"], tags: { R292: "stop", R281: "clear" }, diverging: [] }];

// The gauntlet over a bridge (spec, One-train section), with P1 locked by the
// Left entrance and P2 by the Right, approach lighting on Left Bridge, and a signal with no lights.
const tags = { Stop: "stop", Clear: "clear" };
config.logic = {
  mode: "field",
  remoteBoards: [north],
  blocks: [{ name: "Far", topic: M.topicFor("block", "Far"), topicCustom: false, sensors: [{ board: "kiama-north-k7m4x2", sensor: "Approach" }] }],
  masts: [
    { mast: "Left Bridge", tags, approachLight: "Left" },
    { mast: "Right Bridge", tags },
    { virtual: true, name: "Bridge Exit", topic: M.topicFor("signal", "Bridge Exit"), aspects: ["Stop", "Clear"], tags },
  ],
  // One plant end with two tracks: track 1 meets Left Bridge, and track 2 passes
  // through to track 1. A Pair button on GPIO17 and an LED on GPIO23.
  ends: [{ name: "A", tracks: [{ sensors: ["Left"], mast: "Left Bridge" }, { sensors: ["Right"], through: { end: "A", track: 1 } }], pairPin: "GPIO17", ledPin: "GPIO23" }],
  // A rule button on GPIO16 (and on the web page), and the Auto/Manual switch,
  // for a routes group as a track plan builds them.
  buttons: [{ name: "Depart", pin: "GPIO16" }],
  resources: [
    { name: "Bridge", blocks: ["Bridge"], release: { while: { block: "Bridge", is: "clear" }, for: "3s" } },
    { name: "Approach", blocks: ["Right"], release: { while: { block: "Right", is: "clear" }, for: "3s" } },
  ],
  layers: [
    { name: "Gauntlet", starter: "one-train-section", rules: [
      { trigger: { while: { block: "Left", is: "occupied" }, for: "0.5s" }, checks: [],
        then: { mast: "Left Bridge", aspect: "Clear", reserve: "Bridge", lock: ["P1"] } },
      { trigger: { while: { block: "Right", is: "occupied" }, for: "0.5s" },
        checks: [{ mast: "Home", board: "kiama-north-k7m4x2", is: ["approach", "advance", "clear"] }],
        then: { mast: "Right Bridge", aspect: "Clear", reserve: "Bridge", lock: ["P2"] } },
    ] },
    { name: "Exit", rules: [
      { trigger: { while: { block: "Far", is: "clear" } }, checks: [], then: { mast: "Bridge Exit", aspect: "Clear" } },
    ] },
    { name: "Bridge Exit routes", routes: true, rules: [
      { trigger: { when: { any: [
          { button: "Depart", is: "pressed", if: { auto: "off" } },
          { block: "Far", is: "occupied", notFrom: ["Left"], if: { auto: "on" } },
        ] } },
        cancel: { when: { any: [{ button: "Depart", is: "pressed", if: { auto: "off" } }, { block: "Far", is: "clear", for: "1s", if: { auto: "on" } }] } },
        withdraw: { when: { any: [{ auto: "on" }, { auto: "off" }] } },
        tryOnce: { if: { auto: "off" }, waitWhile: { turnout: "P2", is: "moving" } },
        checks: [{ block: "Right", is: "clear" }],
        then: { mast: "Bridge Exit", aspect: "Clear", reserve: ["Approach"], next: { Approach: ["Bridge"] }, lock: [{ turnout: "P2", with: "Approach" }] } },
    ] },
  ],
};
// Pieces (TP 7): a switch and a lamp on the fascia, with P2 locked so only
// its own buttons move it while the switch is on, and the lamp lit then.
// They are built from a track plan with no track, and run beside the
// hand-written rules above: the board runs its own logic keys (useOwnItems).
const pieces = {
  ...config,
  logic: { mode: "field", plan: {
    pieces: [{ kind: "switch", name: "Local", at: [0, 0], pin: "GPIO13" }, { kind: "lamp", name: "Local lamp", at: [1, 0], pin: "GPIO15" }],
    rules: [
      { on: { turnout: "P2" }, kind: "ownButtonsWhile", when: { switch: "Local", is: "on" } },
      { on: { lamp: "Local lamp" }, kind: "flashWhile", when: { switch: "Local", is: "on" } },
    ],
  } },
};
const built = L.logicItems(pieces);
config.logic.layers.push(...built.layers);
config.logic.switches = built.switches;
config.logic.lamps = built.lamps;
L.useOwnItems(config);
const errors = [...M.validateConfig(config).errors];
if (errors.length) throw new Error(errors.join("\n"));
let yaml = M.generateYaml(config);

const source = `  - source: ${L.LOGIC_COMPONENT_SOURCE}\n`;
if (!yaml.includes(source)) throw new Error("The generator no longer writes the component's source line.");
yaml = yaml.replace(source, "  - source:\n      type: local\n      path: ../../components\n");

const header = "# Made by engine-tests/esphome/make-gauntlet.mjs for CI's esphome compile. Do not edit by hand.\n";
fs.writeFileSync(path.join(here, "gauntlet.yaml"), header + yaml);
console.log("wrote", path.join(here, "gauntlet.yaml"));
