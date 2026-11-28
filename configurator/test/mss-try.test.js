// Try it on the MSS Logic page (docs/mss-patterns-spec.md, The page, step 4;
// work item MP 6): the pure parts of logic-ui-mss-try.js, without a DOM. A
// train runs through a passing siding along the way the points are set; the
// picture's blocks are the built blocks; each signal's heads show its aspect
// as the pattern lights it. The page itself is driven in Chromium by
// test/browser/mss-page.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

const html = fs.readFileSync(path.join(configuratorDir, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script src="\.\/([^"]+)"><\/script>/g)].map((m) => m[1]);
const ctx = loadModules(...scripts.slice(scripts.indexOf("generator.js"), scripts.indexOf("app.js")));
const { EsphomeMr: M, EsphomeMrMssRow: R, EsphomeMrLogicUiMssTry: X, EsphomeMrLogicTry: T, EsphomeMrLogicUi: Ui, EsphomeMrLogicUiMss: F } = ctx;
const plain = (value) => JSON.parse(JSON.stringify(value));

function madeModule(preset = "passing") {
  const config = M.myFirstBoardPreset();
  config.board.name = "module-k7m4x2";
  config.blocks = [];
  config.points = [];
  config.signals = { mode: "addressable", masts: [] };
  config.logic = { mode: "mss", mss: { row: R.preset(preset) } };
  const pins = ["GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO32", "GPIO16", "GPIO17", "GPIO19", "GPIO23", "GPIO18", "GPIO13"];
  let k = 0;
  R.use(config, config.logic.mss.row, ({ sensors, turnouts, masts }) => {
    config.blocks.push(...sensors.map((name) => ({ name, topic: M.topicFor("block", name), topicCustom: false, gpio: pins[k++], inverted: true, debounce: "500ms" })));
    config.points.push(...turnouts.map((name, i) => ({ name, topic: M.topicFor("point", name), channel: i })));
    config.signals.masts.push(...masts.map((m) => ({ ...m, topic: M.topicFor("signal", m.name), topicCustom: false, pin: pins[k++] })));
  }, { style: "strip" });
  return config;
}

const aspects = (session) => Object.fromEntries(session.view().masts.map((m) => [m.name, m.aspect]));

test("Try it is the MSS page's own part, on its step, with its words linted", () => {
  assert.ok(Ui.hasPart(X.PART, "mss"));
  assert.ok(!Ui.hasPart(X.PART, "field"));
  assert.ok(Ui.allText().some(([id, text]) => id === X.PART && text === X.TEXT));
  const config = madeModule();
  assert.ok(F.stepsOf(config).find((s) => s.id === "try").open, "a made module opens Try it");
});

test("each block on the picture is a built block, found by its detector", () => {
  const config = madeModule();
  const blocks = X.blocksOf(config);
  for (const name of ["Block 1 current", "Block 2 current", "Siding 1 current", "Block 3 current"]) assert.ok(blocks.get(name), name);
  assert.equal(new Set(blocks.values()).size, 4, "four blocks, one each");
  // A Crossover's detector is in the block it stands in.
  const row = R.preset("passing");
  const withCrossover = madeModule();
  withCrossover.logic.mss.row = R.insertNode(row, 1, { node: "crossover", line: 0 });
  const named = R.named(withCrossover.logic.mss.row);
  withCrossover.logic.mss.row = named;
  const detector = named[1].names.block;
  withCrossover.blocks.push({ name: detector, topic: M.topicFor("block", detector), gpio: "GPIO4" });
  const map = X.blocksOf(withCrossover);
  assert.equal(map.get(detector), map.get(named[0].names.right[0]), "the Crossover's detector is in the main line's block");
});

test("a train comes in at either end, and takes the way the points are set", () => {
  const config = madeModule();
  assert.deepEqual(plain(X.trainStarts(config)).map((s) => s.label), ["End A", "End B"]);
  const blocks = X.blocksOf(config);
  const sensorOf = new Map([...blocks].map(([sensor, built]) => [built, sensor]));
  const way = (positions, end = "A") => {
    const r = X.trainRoute(config, { end, track: 1 }, (name) => positions[name] || "closed");
    return plain({ ...r, blocks: r.blocks.map((b) => sensorOf.get(b)) });
  };
  assert.deepEqual(way({}), { blocks: ["Block 1 current", "Block 2 current", "Block 3 current"], masts: ["Signal 1 to B", "Signal 2 to B main"], exit: { end: "B", track: 1 }, stop: "" });
  assert.deepEqual(way({ "Points 1": "thrown", "Points 2": "thrown" }).blocks, ["Block 1 current", "Siding 1 current", "Block 3 current"]);
  assert.deepEqual(way({ "Points 1": "thrown", "Points 2": "thrown" }).masts, ["Signal 1 to B", "Signal 2 to B siding"]);
  // Into the siding, and the far points set for the main: it stops there.
  const stuck = way({ "Points 1": "thrown" });
  assert.deepEqual([stuck.blocks, stuck.exit, stuck.stop], [["Block 1 current", "Siding 1 current"], null, "route"]);
  assert.deepEqual(way({}, "B").blocks, ["Block 3 current", "Block 2 current", "Block 1 current"]);
});

test("Run a train through a passing siding: each signal drops to Stop behind it", () => {
  const config = madeModule();
  const session = T.createSession(config);
  session.advance(1000);
  session.setNeighbour("A", true);
  session.setNeighbour("B", true);
  session.advance(1000);
  assert.equal(aspects(session)["Signal 1 to B"], "Clear");
  // Through the siding: both points thrown first.
  session.setTurnout("Points 1", "thrown");
  session.setTurnout("Points 2", "thrown");
  session.advance(1000);
  assert.equal(aspects(session)["Signal 1 to B"], "Diverging Approach", "set for the siding");
  const route = X.trainRoute(config, { end: "A", track: 1 }, (name) => session.turnoutPosition(name) || "closed");
  const seen = [];
  route.blocks.forEach((block, i) => {
    session.setBlock(block, true, { scan: true });
    if (i > 0) session.setBlock(route.blocks[i - 1], false, { scan: true });
    session.advance(500);
    seen.push([aspects(session)["Signal 1 to B"], aspects(session)["Signal 2 to B siding"]]);
  });
  session.setBlock(route.blocks.at(-1), false, { scan: true });
  session.advance(1000);
  assert.deepEqual(seen, [
    ["Diverging Approach", "Diverging Clear"], // in Block 1, coming up to Signal 1 to B
    ["Stop", "Diverging Clear"], // in the siding: Signal 1 to B behind it
    // In Block 3, Signal 2 to B siding is behind it; the siding is empty
    // again, so Signal 1 to B shows the way into it, up to that Stop.
    ["Diverging Approach", "Stop"],
  ]);
  assert.equal(aspects(session)["Signal 1 to B"], "Diverging Approach", "clear again once it has gone");
});

test("Why and What happened name each block as the picture does", () => {
  const config = madeModule();
  const session = T.createSession(config);
  session.advance(1000);
  const blocks = X.blocksOf(config);
  const why = ctx.EsphomeMrLogic.explainMast(session.board, "Signal 1 to B").map((line) => (typeof line === "string" ? line : line.text)).join(" ");
  const said = X.inPictureWords(why, blocks);
  for (const built of blocks.values()) assert.ok(!said.includes(built), built);
  assert.match(said, /Block 2 current is clear/);
  assert.equal(X.inPictureWords("Nothing to change.", blocks), "Nothing to change.");
});

test("a signal's heads show its aspect as the pattern lights it", () => {
  const config = madeModule();
  assert.deepEqual(plain(X.headsFor(config, "twoHeads", "Stop", "stop")), [{ color: "red", blink: false }, { color: "red", blink: false }]);
  assert.deepEqual(plain(X.headsFor(config, "twoHeads", "Diverging Approach", "approach")), [{ color: "red", blink: false }, { color: "amber", blink: false }]);
  assert.deepEqual(plain(X.headsFor(config, "plain", "Clear", "clear")), [{ color: "green", blink: false }]);
  // Dark, or nothing yet: every head off; an aspect not in the pattern: what it means.
  assert.deepEqual(plain(X.headsFor(config, "plain", null)), [{ color: "off", blink: false }]);
  assert.deepEqual(plain(X.headsFor(config, "twoHeads", "dark")).map((h) => h.color), ["off", "off"]);
  assert.deepEqual(plain(X.headsFor(config, "plain", "Something else", "approach")), [{ color: "amber", blink: false }]);
});

test("the points know which way each position leads, on the picture", () => {
  const shape = ctx.EsphomeMrLogicUiMssRow.layout(R.preset("passing"));
  const [p1, p2] = plain(shape.points);
  // Points 1 splits the line: the main goes on to the right, the siding up to the right.
  assert.deepEqual([p1.legs.closed[1], p1.legs.thrown[1]], [p1.at[1], 0]);
  assert.ok(p1.legs.closed[0] > p1.at[0]);
  // Points 2, flipped, joins them: both legs come in from the left.
  assert.ok(p2.legs.closed[0] < p2.at[0] && p2.legs.thrown[0] < p2.at[0]);
  assert.equal(p2.legs.thrown[1], 0);
});

test("Show me opens Try it on the MSS page", () => {
  assert.equal(X.showMe([{ wait: 2 }]), true);
  const app = fs.readFileSync(path.join(configuratorDir, "app.js"), "utf8");
  assert.match(app, /if \(link\.sequence && mss\) \{\s+globalThis\.EsphomeMrLogicUiMssTry\?\.showMe\(link\.sequence\)/);
  assert.match(app, /"logic-mss-try"/);
});

test("the module card lists the MSS boards, and says which board each part is on", () => {
  const config = madeModule();
  const card = ctx.EsphomeMrMssCard.cardHtml(config, { date: "2026-11-28" });
  assert.match(card, /<h2>The module<\/h2>/);
  assert.match(card, /<li>MSS board 1, Complex cascade<\/li><li>MSS board 2, Complex cascade \(flipped\)<\/li>/);
  assert.match(card, /<td>Points 1<\/td>/);
  assert.match(card, /<td>IR 2<\/td><td>GPIO\w+<\/td><td>MSS board 2, Complex cascade \(flipped\): the IR sensor<\/td>/);
  assert.match(card, /<td>Siding 1 current<\/td><td>GPIO\w+<\/td><td>MSS board 1, Complex cascade: the block it starts<\/td>/);
  assert.match(card, /<td>Signal 1 to A siding<\/td><td>data GPIO\w+<\/td><td>MSS board 1, Complex cascade: on the diverging line, at the points<\/td>/);
  assert.ok(!card.includes("not used by the module"), "every part of the module says where it sits");
  assert.ok(!/junction|boundary/i.test(card), "none of the description's words");
});

if (!process.exitCode) console.log("\nAll MSS Try it tests passed.");
