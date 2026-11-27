// The MSS page's junction shapes and routes (work item 4.2c): the pure
// functions in logic-ui-mss-junctions.js, checked without a DOM, and that
// every shape builds through the MSS builder with no problems once its
// tracks exist.
import assert from "node:assert/strict";
import { loadModules, test } from "./harness.js";

// Every Logic page file, in index.html's order (as in logic-page.test.js).
const LOGIC_UI_FILES = ["generator.js", "logic-yaml.js", "logic.js", "logic-checker.js", "logic-try.js", "logic-ui.js", "logic-ui-masts.js", "logic-ui-ends.js", "logic-ui-views.js", "logic-ui-start.js", "logic-ui-try.js", "logic-starters.js", "logic-starters-sections.js", "logic-starters-signals.js", "mss-builder.js", "logic-ui-mss-steps.js", "logic-ui-mss-tracks.js", "logic-ui-mss-junctions.js", "logic-summary.js"];

const context = loadModules(...LOGIC_UI_FILES);
const { EsphomeMr, EsphomeMrMssBuilder: B, EsphomeMrLogicUiMssJunctions: J } = context;
const { myFirstBoardPreset, topicFor } = EsphomeMr;

const plain = (value) => JSON.parse(JSON.stringify(value));
// Objects made inside the loaded modules are from another realm: compare as plain data.
const same = (actual, expected, ...message) => assert.deepEqual(plain(actual), plain(expected), ...message);

// A board with a junction from a shape, a track on each leg, and the sensors
// and turnouts they need.
function boardWith(shapeId) {
  const config = myFirstBoardPreset();
  const pins = ["GPIO14", "GPIO27", "GPIO26", "GPIO25", "GPIO33", "GPIO32", "GPIO35", "GPIO34"];
  const sensors = ["J1 optical", "S1", "S2", "S3", "S4"];
  config.blocks = sensors.map((name, i) => ({ name, topic: topicFor("block", name), topicCustom: false, gpio: pins[i], inverted: true, debounce: "500ms" }));
  config.points = ["P1", "P2"].map((name, i) => ({ name, topic: topicFor("point", name), channel: i }));
  config.logic = { mode: "mss", mss: { advanceApproach: true, approachDiverging: true, masts: [], ends: [{ name: "A", tracks: 2 }, { name: "B", tracks: shapeId === "crossover" ? 2 : 1 }], tracks: [], junctions: [] } };
  const junction = J.fromShape(shapeId, { name: "J1", turnouts: J.suggestTurnouts(config, J.shapeOf(shapeId).slots), sensors: ["J1 optical"] });
  config.logic.mss.junctions.push(junction);
  // Odd legs come in from end A, even legs go out to end B.
  const legs = J.legsOf(junction);
  legs.forEach((leg, i) => {
    const sensor = { sensors: [sensors[1 + i]] };
    const end = leg % 2 === 1 ? "A" : "B";
    const place = { end, track: Math.ceil(leg / 2) };
    config.logic.mss.tracks.push(leg % 2 === 1
      ? { from: place, to: { junction: "J1", leg }, blocks: [sensor], boundaries: [] }
      : { from: { junction: "J1", leg }, to: place, blocks: [sensor], boundaries: [] });
  });
  return config;
}

test("every shape builds with no problems once its tracks exist", () => {
  for (const shape of J.SHAPES.filter((s) => s.layout)) {
    const config = boardWith(shape.id);
    same(B.problems(config), [], shape.id);
    const built = B.build(config);
    assert.ok(built.layers.length > 0, `${shape.id} builds a route layer`);
  }
});

test("shapes fill in legs, turnouts and routes", () => {
  const left = J.fromShape("turnout-left", { name: "J1", turnouts: ["P1"] });
  same(plain(left.routes), [
    { legs: [1, 2], turnouts: [{ turnout: "P1", position: "closed" }] },
    { legs: [1, 3], turnouts: [{ turnout: "P1", position: "thrown" }], diverging: true },
  ]);
  same(left.masts, { 1: null, 2: null, 3: null });
  const wye = J.fromShape("wye");
  assert.ok(wye.routes.every((r) => r.diverging));
  const cross = J.fromShape("crossover", { turnouts: ["P1", "P2"] });
  assert.equal(cross.routes.length, 4);
  same(J.legsOf(cross), [1, 2, 3, 4]);
  assert.equal(cross.routes.filter((r) => r.diverging).length, 2);
  same(J.fromShape("custom").routes, []);
  assert.throws(() => J.fromShape("nope"));
});

test("a junction left without a turnout is reported by the builder, next to its route", () => {
  const config = boardWith("turnout-left");
  config.logic.mss.junctions[0].routes[1].turnouts[0].turnout = "";
  const found = J.problemsFor(B.problems(config), 0);
  assert.ok(found.routes[1]?.length >= 1);
  same(found.junction, []);
});

test("problems are sorted to the junction, route or leg they name", () => {
  const config = boardWith("turnout-left");
  const j = config.logic.mss.junctions[0];
  j.sensors = [];
  j.routes[1].turnouts[0].position = "closed"; // the same as route 1: they clash
  config.logic.mss.tracks.pop(); // leg 3 has no track
  const found = J.problemsFor(B.problems(config), 0);
  assert.equal(found.junction.length, 1, "no sensor");
  assert.equal(found.routes[1].length, 1, "routes clash");
  assert.ok(found.legs[3].length >= 1, "leg with no track");
  same(J.problemsFor(B.problems(config), 1).all, []);
});

test("routes can be added, joined to other legs and removed", () => {
  const junction = J.fromShape("custom", { name: "J1" });
  const route = J.addRoute(junction);
  same(route.legs, [1, 2]);
  J.setRouteLeg(route, 1, "3");
  same(route.legs, [1, 3]);
  J.setDiverging(route, true);
  assert.equal(route.diverging, true);
  J.setDiverging(route, false);
  assert.equal("diverging" in route, false);
  J.addRouteTurnout(route, "P1");
  same(route.turnouts, [{ turnout: "P1", position: "closed" }]);
  J.removeRouteTurnout(route, 0);
  same(route.turnouts, []);
  same(J.legChoices(junction), [1, 2, 3, 4]);
  J.removeRoute(junction, 0);
  same(junction.routes, []);
});

test("leg signals and sensors", () => {
  const junction = J.fromShape("turnout-right");
  J.setLegSignal(junction, 1, "J1 Leg 1");
  assert.equal(J.mastOf(junction, 1), "J1 Leg 1");
  J.setLegSignal(junction, 1, "");
  assert.equal(junction.masts["1"], null);
  assert.equal(J.addSensor(junction, "S1"), true);
  assert.equal(J.addSensor(junction, "S1"), false);
  J.removeSensor(junction, 0);
  same(junction.sensors, []);
});

test("names: a free one, and a rename that tracks follow", () => {
  const config = boardWith("turnout-left");
  assert.equal(J.freeJunctionName(config), "J2");
  const added = J.addJunction(config, "wye", ["P1"]);
  assert.equal(added.name, "J2");
  assert.equal(config.logic.mss.junctions.length, 2);
  assert.equal(J.renameJunction(config, "J1", "East"), 3);
  assert.ok(config.logic.mss.tracks.every((t) => [t.from, t.to].some((p) => p.junction === "East")));
  assert.equal(J.renameJunction(config, "East", ""), 0);
  J.removeJunction(config, 1);
  assert.equal(config.logic.mss.junctions.length, 1);
});

test("turnouts no junction uses are suggested first", () => {
  const config = boardWith("turnout-left");
  same(J.suggestTurnouts(config, 2), ["P2", ""]);
});

test("the preview says which legs join, and what sets the route", () => {
  const junction = J.fromShape("turnout-left", { turnouts: ["P1"] });
  const joins = J.connections(junction);
  same(joins.map((c) => c.legs), [[1, 2], [1, 3]]);
  assert.equal(joins[0].text, "Leg 1 to leg 2, main, set when P1 is closed");
  assert.equal(joins[1].text, "Leg 1 to leg 3, diverging, set when P1 is thrown");
  assert.match(J.connections({ routes: [{ legs: [1, 2], turnouts: [] }] })[0].text, /always set/);
});

test("the drawing places each leg and draws a path for each route", () => {
  const shape = J.shapeOf("crossover");
  const d = J.diagram(J.fromShape("crossover").routes, shape.layout);
  assert.equal(d.legs.length, 4);
  assert.equal(d.paths.length, 4);
  assert.ok(d.paths.every((p) => p.d.startsWith("M")));
  assert.match(d.paths[0].d, / L/, "a straight route is a line");
  // Without a layout, three legs have one on the left and two on the right.
  const generic = J.legLayout([1, 2, 3]);
  same(generic.map((p) => p.x), [10, 110, 110]);
  assert.equal(J.diagram([{ legs: [1, 1] }]).paths[0].d, "");
});
