// Try it on the track plan's drawing (work item TP 8): the path a train runs
// from a signal along the routes its turnouts are set for, and what each
// block looks like (a route set, track taken), from a Try it session. The
// page itself is driven in Chromium by test/browser/plan-try.mjs.
import assert from "node:assert/strict";
import { loadModules, test } from "./harness.js";
import { planBoard, readPlanCase } from "./plan-cases.js";
import { LOGIC_UI_FILES } from "./logic-page.test.js";

const ctx = loadModules(...LOGIC_UI_FILES);
const { EsphomeMrLogicUiPlanTry: P, EsphomeMrLogicTry: T } = ctx;
const plain = (value) => JSON.parse(JSON.stringify(value));
const board = (name) => planBoard(ctx, readPlanCase(name).module);

test("a train from a signal runs along the routes its turnouts are set for, to an end", () => {
  const config = board("passing-siding");
  assert.deepEqual(plain(P.pathFrom(config, "West Home", { PW: "closed", PE: "closed" })), ["West line", "West points", "Main loop", "East points", "Single", "Far"]);
  assert.deepEqual(plain(P.pathFrom(config, "West Home", { PW: "thrown", PE: "thrown" })), ["West line", "West points", "Siding", "East points", "Single", "Far"]);
  assert.deepEqual(plain(P.pathFrom(config, "East Home", { PE: "thrown", PW: "thrown" })), ["Far", "Single", "East points", "Siding", "West points", "West line"]);
  assert.deepEqual(plain(P.pathFrom(config, "Nowhere", {})), []);
});

test("a meet on the crossing loop: each route green while set, shaded once its train is in it", () => {
  const config = board("passing-siding");
  const session = T.createSession(config);
  session.advance(1000);
  session.setTurnout("PE", "thrown");
  // A train at each end asks (Auto): West Home into the main, East Home into the siding.
  session.setBlock("West line", true);
  session.setBlock("Far", true);
  session.advance(1000);
  let view = session.view();
  let looks = plain(P.overlay(session.board, view));
  assert.equal(looks["Main loop"], "route");
  assert.equal(looks.Siding, "route");
  const shows = (m) => view.masts.find((x) => x.name === m).tag;
  assert.notEqual(shows("West Home"), "stop");
  assert.notEqual(shows("East Home"), "stop");
  // The westbound train enters West points: that piece is taken, the signal goes to Stop.
  session.setBlock("West points", true);
  session.advance(500);
  view = session.view();
  looks = plain(P.overlay(session.board, view));
  assert.equal(looks["West points"], "taken");
  assert.equal(shows("West Home"), "stop");
  assert.ok(view.turnouts.find((t) => t.name === "PW").locked, "PW is locked under its route");
  assert.ok(view.log.length > 0);
});

if (!process.exitCode) console.log("\nAll plan Try it tests passed.");
