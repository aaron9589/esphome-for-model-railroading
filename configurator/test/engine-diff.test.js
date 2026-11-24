// The JS engine against the C++ core (work item 2.3): the same random events
// on every case's board, compared scan by scan, outputs and state. The cases
// prove both engines right where the spec is written down; this catches the
// two drifting apart anywhere else. It needs the C++ harness built:
//   ENGINE_TESTS_BIN=<path to engine_tests> npm test
// Without it, this file says so and passes. CI builds it and sets the path.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configuratorDir, loadModules, test } from "./harness.js";

const bin = process.env.ENGINE_TESTS_BIN;
const { EsphomeMrLogic: L } = loadModules("logic.js");
const casesDir = path.join(configuratorDir, "test", "cases");
const SCANS = 400;
const TRACES = 3;

// A small seeded generator, so a failure can be replayed exactly.
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Every kind of event the board can see, for this board's items.
function candidates(board) {
  const list = [];
  const logic = board.logic || {};
  for (const s of board.sensors || []) list.push({ sensor: s, is: "occupied" }, { sensor: s, is: "clear" });
  for (const b of logic.buttons || []) list.push({ button: b.name, is: "pressed" }, { button: b.name, is: "released" });
  for (const t of board.turnouts || []) {
    for (const is of ["closed", "thrown", "moving"]) list.push({ turnout: t, is });
    list.push({ remoteLock: t, is: "locked" }, { remoteLock: t, is: "unlocked" });
  }
  for (const [m, def] of Object.entries(board.masts || {})) {
    for (const a of Object.keys(def.aspects)) {
      list.push({ jmri: m, message: `${a}; Lit; Unheld` }, { jmri: m, message: `${a}; Lit; Held` }, { jmri: m, message: `${a}; Unlit; Unheld` });
    }
    list.push({ jmri: m, message: "null; Lit; Held" }, { jmri: m, message: "Bogus; Lit; Unheld" });
  }
  for (const r of logic.resources || []) list.push({ release: r.name, via: "button" }, { release: r.name, via: "mqtt" });
  for (const [b, def] of Object.entries(board.remote || {})) {
    list.push({ board: b, online: true }, { board: b, online: true }, { board: b, online: false });
    for (const s of def.sensors || []) for (const is of ["occupied", "clear", "unknown"]) list.push({ board: b, sensor: s, is });
    for (const s of def.blocks || []) for (const is of ["occupied", "clear", "unknown"]) list.push({ board: b, block: s, is });
    for (const t of def.turnouts || []) for (const is of ["closed", "thrown", "moving", "unknown"]) list.push({ board: b, turnout: t, is });
    for (const [m, md] of Object.entries(def.masts || {})) {
      for (const a of [...Object.keys(md.aspects), ""]) list.push({ board: b, mast: m, aspect: a });
    }
  }
  return list;
}

function trace(board, seed) {
  const next = random(seed);
  const pool = candidates(board);
  const scans = [];
  for (let i = 0; i < SCANS; i++) {
    const events = [];
    // Mostly quiet scans, with bursts, as on a layout.
    const count = next() < 0.6 ? 0 : 1 + Math.floor(next() * 3);
    for (let k = 0; k < count && pool.length; k++) events.push(pool[Math.floor(next() * pool.length)]);
    if (next() < 0.01) events.push({ logic: next() < 0.5 ? "off" : "on" });
    if (next() < 0.01) events.push({ broker: next() < 0.5 ? "disconnected" : "connected" });
    scans.push(events);
  }
  return scans;
}

// Boards with shapes the cases do not use, so the two engines are compared on
// them too: blocks of local, keyed and remote members, both keys for one
// sensor in one sequence, is lists, a when trigger with a cancel, a button,
// lock rules, approach lighting, and a resource no rule reserves.
const S2 = { aspects: { R292: "stop", R285: "approach", R281: "clear", R283: "clear" }, diverging: ["R283"] };
const EXTRA_BOARDS = {
  "mixed shapes": {
    board: {
      sensors: ["A", "B", "C", "D", "Far"],
      turnouts: ["P1", "P2"],
      masts: { M1: S2, M2: { ...S2, approachLight: "D" }, M3: S2, JM: S2 },
      remote: { south: { sensors: ["RS"], blocks: ["RB"], turnouts: ["RT"], masts: { RM: S2 } } },
      logic: {
        blocks: [
          { name: "Inner", sensors: ["A"] },
          { name: "Outer", sensors: ["Inner", { sensor: "B" }, { board: "south", sensor: "RS" }, { board: "south", block: "RB" }] },
          { name: "Ghostly", sensors: ["C", { board: "nowhere", sensor: "Z" }] },
        ],
        buttons: [{ name: "Go" }, { name: "Stop it" }],
        resources: [
          { name: "Main", blocks: ["Outer", "C"], release: { when: { sensor: "Far", is: "occupied" }, then: [{ block: "Far", is: "clear" }] }, approachLock: "1.5s" },
          { name: "Spare", blocks: ["D"], release: { while: { block: "D", is: ["clear"] }, for: "300ms" } },
          { name: "Nulls", blocks: ["Far"], release: null },
        ],
        layers: [
          { name: "One", rules: [
            { trigger: { when: { button: "Go", is: "pressed" } }, checks: [{ any: [{ block: "C", is: "clear" }, { turnout: "P1", is: ["closed"] }] }],
              then: { mast: "M1", aspect: "R281", reserve: "Main", lock: ["P1"] }, cancel: { when: { button: "Stop it", is: "pressed" } } },
            { trigger: { while: { block: "Outer", is: "occupied" }, for: "0.4s", leavingGuard: true }, checks: [{ not: { mast: "JM", is: ["stop", "restricting"] } }],
              then: { mast: "M2", aspect: "R285", reserve: "Main" } },
            { trigger: { while: { board: "south", mast: "RM", is: "diverging" } }, checks: [{ board: "south", turnout: "RT", is: "thrown" }],
              then: { mast: "M3", aspect: "R283", lock: ["P2"] } },
          ] },
          { name: "Nulls", rules: [
            { trigger: { while: { block: "Far", is: "occupied" } }, checks: null, then: { mast: "M1", aspect: "R285", reserve: "Nulls", lock: null }, cancel: null },
          ] },
          { name: "Three", rules: [
            { trigger: { while: { turnout: "P1", is: "moving" } }, checks: [{ board: "south", turnout: "RT", is: ["moving"] }], then: { mast: "JM", aspect: "R285" } },
            { trigger: { while: { block: "Ghostly", is: "clear" } }, checks: [], then: { mast: "JM", aspect: "R281" } },
          ] },
          { name: "Two", rules: [
            { trigger: { while: { all: [{ block: "Inner", is: "clear" }, { mast: "M1", is: "clear" }] }, for: "200ms" }, checks: [], then: { mast: "M3", aspect: "R285" } },
            { trigger: { while: { block: "D", is: "clear" } }, checks: [], then: { mast: "M2", aspect: "R283" } },
          ] },
        ],
      },
    },
    start: { remote: { south: { online: true } } },
  },
};

function runJs(board, start, scans) {
  const engine = L.createEngine(board, start);
  return scans.map((events) => {
    events.forEach((e) => engine.event(e));
    return { ...engine.scan(), ...engine.state() };
  });
}

const DURATIONS = ["", "0.5s", "500ms", "3s", "10s", " 3s", "3s ", ".5s", "5.s", "5", "3 s", "10 s", "1.25s", "0ms", "s", "ms", "-1s", "1e3ms", "1.5.0s", "07s"];

if (bin) {
  test("JS and C++ read every time the same way, and refuse the same typos", () => {
    const cpp = execFileSync(bin, ["--durations"], { input: DURATIONS.join("\n") + "\n", encoding: "utf8" }).trim().split("\n");
    const js = DURATIONS.map((text) => {
      const value = L.ms(text);
      return Number.isNaN(value) ? "null" : String(value);
    });
    assert.deepEqual(cpp, js, DURATIONS.map((d, i) => `${JSON.stringify(d)}: C++ ${cpp[i]}, JS ${js[i]}`).join("; "));
  });
}

if (!bin) {
  test("JS and C++ engines agree (skipped: set ENGINE_TESTS_BIN to the built engine_tests)", () => {});
} else {
  assert.ok(fs.existsSync(bin), `ENGINE_TESTS_BIN ${bin} does not exist`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-diff-"));
  const boards = fs.readdirSync(casesDir).filter((f) => f.endsWith(".json")).sort()
    .map((file) => [file, JSON.parse(fs.readFileSync(path.join(casesDir, file), "utf8"))]);
  for (const [name, data] of Object.entries(EXTRA_BOARDS)) boards.push([name, data]);
  for (const [file, { board, start = {} }] of boards) {
    const runs = file in EXTRA_BOARDS ? TRACES * 10 : TRACES;
    test(`JS and C++ agree on ${file}'s board, ${runs} random runs of ${SCANS} scans`, () => {
      for (let run = 0; run < runs; run++) {
        // A seed per file name and run, so every board gets its own events.
        let seed = run * 7919;
        for (const ch of file) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
        const scans = trace(board, seed);
        const tracePath = path.join(dir, `${file.replace(/\W+/g, "-")}-${run}.json`);
        fs.writeFileSync(tracePath, JSON.stringify({ board, start, scans }));
        const cpp = JSON.parse(execFileSync(bin, ["--trace", tracePath], { encoding: "utf8", maxBuffer: 64 << 20 }));
        const js = JSON.parse(JSON.stringify(runJs(board, start, scans)));
        assert.equal(cpp.length, js.length);
        for (let i = 0; i < js.length; i++) {
          assert.deepEqual(cpp[i], js[i], `${file}, seed ${seed}, scan ${i}, after events ${JSON.stringify(scans[i])}`);
        }
      }
    });
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

if (!process.exitCode) console.log("\nEngine cross-check done.");
