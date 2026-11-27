// The Logic page's Masts and Buttons parts (field logic spec, The Logic page,
// Aspect tags, Virtual masts, Approach lighting, Inputs). Work item 2.7a.
// The parts' logic is in pure functions on EsphomeMrLogicUiMasts; the page
// drawing is not run here (no DOM).
import assert from "node:assert/strict";
import { loadModules, test } from "./harness.js";

// Every Logic page file, in index.html's order (as test/logic-page.test.js).
const LOGIC_UI_FILES = ["generator.js", "logic-yaml.js", "logic.js", "logic-ui.js", "logic-ui-masts.js", "logic-ui-views.js", "logic-ui-start.js"];
const context = loadModules(...LOGIC_UI_FILES);
const { myFirstBoardPreset, normalizeConfig, topicFor, validateConfig, CATS_ASPECTS } = context.EsphomeMr;
const L = context.EsphomeMrLogicYaml;
const Engine = context.EsphomeMrLogic;
const U = context.EsphomeMrLogicUiMasts;
const plain = (value) => JSON.parse(JSON.stringify(value));

const lamp = (color) => ({ color, mode: "steady" });

// A mast on the Signal Masts page. Each aspect is [label, JMRI aspect]; the
// JMRI aspect defaults to the label.
function mast(name, aspects, pins = ["GPIO32", "GPIO33"]) {
  return {
    name, topic: topicFor("signal", name), topicCustom: false, mode: "gpio",
    lamps: [{ name: "Red", count: 1, pin: pins[0] }, { name: "Green", count: 1, pin: pins[1] }],
    aspects: aspects.map(([label, jmri = label]) => ({ label, states: [`${jmri}; Lit; Unheld`], lamps: [lamp("red"), lamp("off")] })),
  };
}

// A Field Logic board: Up Home (CATS aspects) set by a rule that reads Down
// Home (custom aspects) and a mast on another board.
// Its rules are hand-written, so the board runs its own logic keys (see useOwnItems).
function board() {
  const config = context.EsphomeMrLogicYaml.useOwnItems(myFirstBoardPreset());
  config.board.name = "kiama-k7m4x2";
  config.board.nameSuffix = "k7m4x2";
  config.board.wifiSsid = "layout-wifi";
  config.board.wifiPassword = "not-a-real-password";
  config.board.apPassword = "GoldenFixtureHotspot";
  config.board.apiKey = "Z29sZGVuLWZpeHR1cmUta2V5LW5vdC1hLXNlY3JldCE=";
  config.signals = {
    mode: "gpio",
    masts: [
      mast("Up Home", [["Stop", "R292"], ["Approach", "R285"], ["Clear", "R281"], ["Medium", "R283"], ["Shunt", "RES_NORM"]]),
      mast("Down Home", [["Danger"], ["Proceed"]], ["GPIO25", "GPIO26"]),
      mast("Spare", [["Stop", "R292"]], ["GPIO27", "GPIO13"]),
    ],
  };
  config.logic = {
    mode: "field",
    layers: [{
      name: "Up",
      rules: [{
        trigger: { while: { block: "Kiama/Up XOver", is: "occupied" } },
        checks: [{ mast: "Down Home", is: "clear" }, { board: "south-a3f9qp", mast: "South Home", is: "clear" }],
        then: { mast: "Up Home", aspect: "Clear" },
      }],
    }],
  };
  return config;
}

const entryOf = (config, name) => config.logic.masts.find((e) => e.virtual !== true && e.mast === name);

test("a joining mast's meanings come from its CATS aspects, and a custom aspect starts as Stop", () => {
  const entry = plain(U.prefilledMastEntry(board().signals.masts[0]));
  assert.deepEqual(entry, {
    mast: "Up Home",
    tags: { Stop: "stop", Approach: "approach", Clear: "clear", Medium: "clear", Shunt: "restricting" },
    diverging: ["Medium"],
  });
  assert.deepEqual(plain(U.prefilledMastEntry(board().signals.masts[1])), { mast: "Down Home", tags: { Danger: "stop", Proceed: "stop" } });
});

test("all 30 CATS aspects prefill as the generator tags them", () => {
  const m = mast("All", CATS_ASPECTS.map((name) => [name]));
  const entry = U.prefilledMastEntry(m);
  for (const name of CATS_ASPECTS) {
    assert.equal(entry.tags[name], context.EsphomeMr.catsAspectTag(name), name);
    assert.equal(U.isDiverging(entry, name), context.EsphomeMr.catsAspectDiverging(name), name);
  }
});

test("masts join Masts when a rule first uses them, once, and only from this board's Signal Masts page", () => {
  const config = board();
  config.logic.layers[0].rules[0].checks.push({ mast: "Not here", is: "stop" });
  assert.deepEqual([...U.joinMasts(config)].sort(), ["Down Home", "Up Home"]);
  assert.equal(config.logic.masts.length, 2);
  assert.equal(entryOf(config, "Up Home").tags.Clear, "clear");
  // Edited meanings are kept: joining again adds nothing.
  entryOf(config, "Up Home").tags.Clear = "approach";
  assert.deepEqual([...U.joinMasts(config)], []);
  assert.equal(entryOf(config, "Up Home").tags.Clear, "approach");
  // A starter can join a mast it is about to use.
  assert.deepEqual([...U.joinMasts(config, ["Spare"])], ["Spare"]);
  assert.deepEqual(plain(entryOf(config, "Spare")), { mast: "Spare", tags: { Stop: "stop" } });
  // A section's release can read a mast too.
  const other = board();
  other.logic.layers = [];
  other.logic.resources = [{ name: "Bridge", blocks: ["Kiama/Up XOver"], release: { while: { mast: "Spare", is: "stop" } } }];
  assert.deepEqual([...U.joinMasts(other)], ["Spare"]);
});

test("joined meanings reach the rule table", () => {
  const config = board();
  U.joinMasts(config);
  const table = L.logicTable(config);
  assert.deepEqual(plain(table.masts["Up Home"].aspects), { Stop: "stop", Approach: "approach", Clear: "clear", Medium: "clear", Shunt: "restricting" });
  assert.deepEqual(plain(table.masts["Up Home"].diverging), ["Medium"]);
});

test("the Masts list: what each mast is to logic", () => {
  const config = board();
  U.joinMasts(config);
  config.logic.masts.push({ mast: "Spare", tags: { Stop: "stop" } }, { mast: "Gone", tags: { Stop: "stop" } });
  const rows = plain(U.mastRows(config).map(({ name, onPage, used, sets, aspects }) => ({ name, onPage, used, sets, aspects })));
  assert.deepEqual(rows, [
    { name: "Up Home", onPage: true, used: true, sets: true, aspects: ["Stop", "Approach", "Clear", "Medium", "Shunt"] },
    { name: "Down Home", onPage: true, used: true, sets: false, aspects: ["Danger", "Proceed"] },
    { name: "Spare", onPage: true, used: false, sets: false, aspects: ["Stop"] },
    { name: "Gone", onPage: false, used: false, sets: false, aspects: [] },
  ]);
});

test("Meaning, Diverging route, At stop and at start-up, and approach lighting are stored as the spec says", () => {
  const config = board();
  U.joinMasts(config);
  const entry = entryOf(config, "Down Home");
  assert.equal(U.meaningOf(entry, "Proceed"), "stop");
  U.setMeaning(entry, "Proceed", "clear");
  U.setMeaning(entry, "Proceed", "fast"); // not a meaning: ignored
  assert.equal(U.meaningOf(entry, "Proceed"), "clear");
  U.setDiverging(entry, "Proceed", true);
  U.setDiverging(entry, "Proceed", true);
  assert.deepEqual(plain(entry.diverging), ["Proceed"]);
  U.setDiverging(entry, "Proceed", false);
  assert.equal(entry.diverging, undefined);
  U.setStopAspect(entry, "Danger");
  U.setApproachLight(entry, "Kiama/Up XOver");
  assert.deepEqual(plain(entry), { mast: "Down Home", tags: { Danger: "stop", Proceed: "clear" }, stopAspect: "Danger", approachLight: "Kiama/Up XOver" });
  U.setStopAspect(entry, "");
  U.setApproachLight(entry, "");
  assert.deepEqual(plain(entry), { mast: "Down Home", tags: { Danger: "stop", Proceed: "clear" } });
  assert.equal(U.meaningOf(undefined, "Danger"), "stop", "no entry yet: Stop");
});

test("At stop and at start-up offers Automatic, naming what the board would pick", () => {
  const config = board();
  U.joinMasts(config);
  const row = U.mastRows(config)[0];
  const table = () => L.logicTable(config).masts["Up Home"];
  const auto = () => U.stopChoices(row.aspects, row.entry, row.jmri)[0].label;
  assert.equal(auto(), "Automatic (Stop)");
  assert.equal(U.defaultStopAspect(row.aspects, row.entry, row.jmri), table().stop);
  // By JMRI aspect: a label that is not R292 or Stop still counts.
  const renamed = board();
  renamed.signals.masts[0].aspects[0].label = "Danger";
  U.joinMasts(renamed);
  const r = U.mastRows(renamed)[0];
  assert.equal(U.defaultStopAspect(r.aspects, r.entry, r.jmri), "Danger");
  assert.equal(L.logicTable(renamed).masts["Up Home"].stop, "Danger");
  // No R292 or Stop that means stop: the first that does, as the table says.
  U.setMeaning(r.entry, "Danger", "clear");
  assert.equal(U.defaultStopAspect(r.aspects, r.entry, r.jmri), L.logicTable(renamed).masts["Up Home"].stop);
  U.setMeaning(r.entry, "Approach", "stop");
  assert.equal(U.defaultStopAspect(r.aspects, r.entry, r.jmri), "Approach");
  assert.equal(L.logicTable(renamed).masts["Up Home"].stop, "Approach");
  // The choices list each aspect once, and keep a chosen one that is gone.
  U.setStopAspect(row.entry, "Gone");
  assert.deepEqual(plain(U.stopChoices(row.aspects, row.entry, row.jmri)).map((c) => c.value), ["", "Stop", "Approach", "Clear", "Medium", "Shunt", "Gone"]);
  assert.equal(U.stopChoices(row.aspects, row.entry, row.jmri).at(-1).label, "Gone (not found)");
});

test("meanings for aspects the mast no longer has are listed, and can be dropped", () => {
  const config = board();
  U.joinMasts(config);
  const entry = entryOf(config, "Up Home");
  config.signals.masts[0].aspects.pop(); // Shunt
  entry.stopAspect = "Old";
  const row = U.mastRows(config)[0];
  assert.deepEqual([...U.staleAspects(entry, row.aspects)], ["Shunt", "Old"]);
  U.dropAspect(entry, "Shunt");
  U.dropAspect(entry, "Old");
  assert.deepEqual([...U.staleAspects(entry, row.aspects)], []);
  assert.equal(entry.stopAspect, undefined);
  U.removeMastEntry(config, entry);
  assert.equal(entryOf(config, "Up Home"), undefined);
});

test("Explain says what logic.js says for the board's rule table", () => {
  const config = board();
  U.joinMasts(config);
  entryOf(config, "Up Home").approachLight = "Kiama/Up XOver";
  const said = [...U.explainSentences(config, "Up Home")];
  assert.deepEqual(said, [...Engine.explainMast(L.logicTable(config), "Up Home")]);
  assert.ok(said.length >= 3, said.join(" | "));
  assert.match(said[0], /^Up Home shows Clear when /);
  assert.ok(said.includes("It is dark unless a train is in Kiama/Up XOver."), said.join(" | "));
  assert.deepEqual([...U.explainSentences(config, "Down Home")], [], "read, not set");
  assert.deepEqual([...U.explainSentences(config, "Nowhere")], []);
  config.logic.mode = undefined;
  assert.deepEqual([...U.explainSentences(config, "Up Home")], [], "not Field Logic");
});

test("a signal with no lights: added with a free name, its topic, and Stop, Approach, Clear", () => {
  const config = board();
  config.signals.masts.push(mast("Signal 1", [["Stop"]], ["GPIO4", "GPIO16"]));
  const entry = U.addVirtualMast(config);
  assert.deepEqual(plain(entry), {
    virtual: true, name: "Signal 2", topic: "trains/track/signalmast/Signal 2",
    aspects: ["Stop", "Approach", "Clear"], tags: { Stop: "stop", Approach: "approach", Clear: "clear" },
  });
  assert.equal(U.addVirtualMast(config).name, "Signal 3");
  // It is a mast the rules' dropdowns offer.
  const offered = context.EsphomeMrLogicUi.itemChoices(config, "mast")[0].options.map((o) => o.value);
  assert.ok(offered.includes("Signal 2") && offered.includes("Signal 3"));
  // The Masts list of real masts does not show it.
  assert.ok(!U.mastRows(config).some((row) => row.name === "Signal 2"));
});

test("a signal with no lights: the topic follows the name unless edited, and rules follow a finished rename", () => {
  const config = board();
  const entry = U.addVirtualMast(config);
  config.logic.layers.push({ name: "Exit", rules: [{ trigger: { while: { block: "Kiama/Up XOver", is: "clear" } }, checks: [], then: { mast: "Signal 1", aspect: "Clear" } }] });
  config.logic.layers[0].rules[0].checks.push({ mast: "Signal 1", is: "clear" });
  for (const typed of ["B", "Br", "Bridge Exit"]) U.setVirtualName(entry, typed);
  assert.equal(entry.topic, "trains/track/signalmast/Bridge Exit");
  assert.equal(U.renameVirtualMast(config, entry, "Signal 1", "Bridge Exit"), 2);
  assert.equal(config.logic.layers[1].rules[0].then.mast, "Bridge Exit");
  assert.equal(config.logic.layers[0].rules[0].checks[2].mast, "Bridge Exit");
  entry.topic = "trains/custom/exit";
  U.setVirtualName(entry, "Exit");
  assert.equal(entry.topic, "trains/custom/exit", "an edited topic stays");
  // Not onto, or from, another mast's name: those references may be its.
  assert.equal(U.renameVirtualMast(config, entry, "Bridge Exit", "Up Home"), 0);
  const other = U.addVirtualMast(config);
  other.name = "Bridge Exit";
  assert.equal(U.renameVirtualMast(config, entry, "Bridge Exit", "Exit"), 0);
  assert.equal(U.renameVirtualMast(config, entry, "Bridge Exit", " "), 0);
});

test("a signal with no lights: aspects are added, renamed with their meaning and rules, and removed", () => {
  const config = board();
  const entry = U.addVirtualMast(config);
  config.logic.layers.push({ name: "Exit", rules: [
    { trigger: { while: { block: "Kiama/Up XOver", is: "clear" } }, checks: [], then: { mast: entry.name, aspect: "Clear" } },
    { trigger: { while: { block: "Kiama/Up XOver", is: "clear" } }, checks: [], then: { board: "south-a3f9qp", mast: entry.name, aspect: "Clear" } },
  ] });
  U.setDiverging(entry, "Clear", true);
  U.setStopAspect(entry, "Clear");
  assert.equal(U.renameVirtualAspect(config, entry, 2, "Proceed"), true);
  assert.deepEqual(plain(entry.aspects), ["Stop", "Approach", "Proceed"]);
  assert.deepEqual(plain(entry.tags), { Stop: "stop", Approach: "approach", Proceed: "clear" });
  assert.deepEqual(plain(entry.diverging), ["Proceed"]);
  assert.equal(entry.stopAspect, "Proceed");
  assert.equal(config.logic.layers[1].rules[0].then.aspect, "Proceed");
  assert.equal(config.logic.layers[1].rules[1].then.aspect, "Clear", "another board's mast is not this one");
  // Onto another aspect's name: only the name changes.
  assert.equal(U.renameVirtualAspect(config, entry, 2, "Stop"), false);
  assert.deepEqual(plain(entry.aspects), ["Stop", "Approach", "Stop"]);
  assert.equal(entry.tags.Proceed, "clear");
  U.renameVirtualAspect(config, entry, 2, "Proceed");
  assert.equal(U.addVirtualAspect(entry), "Aspect 4");
  assert.equal(entry.tags["Aspect 4"], "stop");
  U.removeVirtualAspect(entry, 2);
  assert.deepEqual(plain(entry.aspects), ["Stop", "Approach", "Aspect 4"]);
  assert.equal(entry.tags.Proceed, undefined);
  assert.equal(entry.diverging, undefined);
  assert.equal(entry.stopAspect, undefined);
  // Its stop aspect choices, and the rule table, follow.
  assert.equal(U.stopChoices(entry.aspects, entry)[0].label, "Automatic (Stop)");
});

test("a new button gets a free name and a free pull-up pin, not a strapping one", () => {
  const config = board();
  const first = U.addButton(config);
  assert.deepEqual(plain(first), { name: "Button 1", pin: "GPIO4" });
  // GPIO14 is the sensor's, GPIO21/22 the PCA9685's, GPIO25-27/32/33/13 the masts'.
  assert.deepEqual(plain(U.addButton(config)), { name: "Button 2", pin: "GPIO16" });
  assert.deepEqual(plain(U.addButton(config)), { name: "Button 3", pin: "GPIO17" });
});

test("a new button goes on an expander once the ESP pins are used", () => {
  const config = board();
  config.expanders = [{ name: "MCP 1", bus: 1, address: "0x20" }];
  config.blocks.push({ name: "Exp A0", topic: topicFor("block", "Exp A0"), expander: "MCP 1", pin: 0, inverted: true, debounce: "500ms" });
  const free = context.EsphomeMr.PULLUP_PINS.filter((pin) => !context.EsphomeMr.STRAPPING_PINS.has(pin) && !U.usedEspPins(config).has(pin));
  for (const pin of free) config.logic.buttons = [...(config.logic.buttons || []), { name: `On ${pin}`, pin }];
  assert.deepEqual(plain(U.nextButtonPin(config)), { expander: "MCP 1", pin: 1 });
});

test("a button's pin list: free ESP pins, then free expander pins, and always its own", () => {
  const config = board();
  config.expanders = [{ name: "MCP 1", bus: 1, address: "0x20" }];
  config.blocks.push({ name: "Exp A0", topic: topicFor("block", "Exp A0"), expander: "MCP 1", pin: 0, inverted: true, debounce: "500ms" });
  config.logic.buttons = [{ name: "Depart", pin: "GPIO4" }, { name: "Arrive", expander: "MCP 1", pin: 9 }];
  const [depart, arrive] = config.logic.buttons;
  const values = (b) => U.buttonPinChoices(config, b).map((c) => c.value);
  assert.ok(values(depart).includes("GPIO4"), "its own");
  assert.ok(!values(arrive).includes("GPIO4"), "the other button's");
  assert.ok(!values(depart).includes("GPIO14"), "the sensor's");
  assert.ok(!values(depart).includes("mcp:0:0"), "the expander sensor's");
  assert.ok(!values(depart).includes("mcp:0:9") && values(arrive).includes("mcp:0:9"));
  assert.equal(U.buttonPinChoices(config, arrive).find((c) => c.value === "mcp:0:9").label, "MCP 1 · B1");
  assert.equal(U.buttonPinValue(config, arrive), "mcp:0:9");
  U.setButtonPin(config, depart, "mcp:0:15");
  assert.deepEqual(plain(depart), { name: "Depart", pin: 15, expander: "MCP 1" });
  U.setButtonPin(config, depart, "GPIO18");
  assert.deepEqual(plain(depart), { name: "Depart", pin: "GPIO18" });
  // Its expander is gone: no pin is picked, and Pick a pin leads the list.
  arrive.expander = "MCP 9";
  assert.equal(U.buttonPinValue(config, arrive), "");
  assert.deepEqual(plain(U.buttonPinChoices(config, arrive)[0]), { value: "", label: "Pick a pin", disabled: true });
  // A pin that is not a pull-up pin stays in its own list.
  depart.pin = "GPIO34";
  assert.ok(values(depart).includes("GPIO34"));
});

test("renaming a button renames the rules that use it, when the name is finished", () => {
  const config = board();
  config.logic.buttons = [{ name: "Depart", pin: "GPIO4" }, { name: "Arrive", pin: "GPIO16" }];
  config.logic.layers[0].rules[0].trigger = { when: { button: "Depart", is: "pressed" } };
  config.logic.layers[0].rules[0].cancel = { when: { button: "Arrive", is: "pressed" } };
  config.logic.layers[0].rules.push({ trigger: { when: { board: "south-a3f9qp", button: "Depart", is: "pressed" } }, checks: [], then: {} });
  config.logic.buttons[0].name = "Go";
  assert.equal(U.renameButtonRefs(config, "Depart", "Go"), 1);
  assert.equal(config.logic.layers[0].rules[0].trigger.when.button, "Go");
  assert.equal(config.logic.layers[0].rules[1].trigger.when.button, "Depart", "another board's");
  // Not onto another button's name, nor while another keeps the old one.
  config.logic.buttons[0].name = "Arrive";
  assert.equal(U.renameButtonRefs(config, "Go", "Arrive"), 0);
  assert.equal(U.renameButtonRefs(config, "Go", ""), 0);
});

// ----- validation: buttons on expander pins ---------------------------------

function withExpander() {
  const config = board();
  U.joinMasts(config);
  config.expanders = [{ name: "MCP 1", bus: 1, address: "0x20" }];
  config.blocks.push({ name: "Exp A0", topic: topicFor("block", "Exp A0"), topicCustom: false, expander: "MCP 1", pin: 0, inverted: true, debounce: "500ms" });
  return config;
}

function problems(config) {
  const result = validateConfig(context.EsphomeMrLogicYaml.useOwnItems(normalizeConfig(plain(config))));
  return { errors: [...result.errors], links: result.links };
}

function newErrors(config) {
  const before = new Set(problems(withExpander()).errors);
  const { errors, links } = problems(config);
  return errors.filter((text) => !before.has(text)).map((text) => ({ text, part: links.get(text)?.part }));
}

test("a button on a free expander pin is fine, and is not run through the ESP pin check", () => {
  const config = withExpander();
  config.logic.buttons = [{ name: "Depart", expander: "MCP 1", pin: 5 }, { name: "Arrive", expander: "MCP 1", pin: 0 + 8 }];
  assert.deepEqual(newErrors(config), []);
});

test("a button's expander pin is checked like a sensor's", () => {
  const cases = [
    [{ name: "Depart", expander: "MCP 9", pin: 5 }, /Button "Depart" is on expander "MCP 9", which is not on the Sensors page/],
    [{ name: "Depart", expander: "MCP 1", pin: 16 }, /Button "Depart" needs an expander pin from A0 to B7/],
    [{ name: "Depart", expander: "MCP 1" }, /Button "Depart" needs an expander pin from A0 to B7/],
    [{ name: "Depart", expander: "MCP 1", pin: 0 }, /MCP 1 pin A0 is used by "Exp A0" and button "Depart"/],
  ];
  for (const [button, pattern] of cases) {
    const config = withExpander();
    config.logic.buttons = [button];
    const found = newErrors(config);
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.match(found[0].text, pattern);
    assert.equal(found[0].part, "logic-buttons");
  }
  const two = withExpander();
  two.logic.buttons = [{ name: "Depart", expander: "MCP 1", pin: 3 }, { name: "Arrive", expander: "MCP 1", pin: 3 }];
  const found = newErrors(two);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.match(found[0].text, /MCP 1 pin A3 is used by "button Depart" and button "Arrive"/);
});

test("ESP pin buttons are checked as before", () => {
  const config = withExpander();
  config.logic.buttons = [{ name: "Depart", pin: "GPIO14" }];
  const found = newErrors(config);
  assert.equal(found.length, 1);
  assert.match(found[0].text, /Button "Depart" is on GPIO14/);
  const none = withExpander();
  none.logic.buttons = [{ name: "Depart", pin: "" }];
  assert.match(newErrors(none)[0].text, /Button "Depart" has no pin/);
});

test("the Masts words are plain: Meaning, not the spec's term", () => {
  assert.deepEqual(plain(U.TEXT.meanings), { stop: "Stop", restricting: "Restricting", approach: "Approach", advance: "Advance Approach", clear: "Clear" });
  assert.deepEqual([...context.EsphomeMr.ASPECT_TAGS], Object.keys(U.TEXT.meanings));
});

if (!process.exitCode) console.log("\nAll Logic page Masts and Buttons tests passed.");
