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

// Every kind of event the board can see, for this board's items. `me` is its
// name, for plant ends: links and announcements that name it, and others.
function candidates(board, me = "") {
  const list = [];
  const logic = board.logic || {};
  const TAG_WORDS = ["stop", "restricting", "approach", "advance", "clear"];
  for (const end of logic.ends || []) {
    const e = end.name;
    const count = (end.tracks || []).length;
    for (const link of ["", "end", "east/A", "north/C", `${me}/${e}`, "nope", "/A", "east/"]) list.push({ end: e, link });
    // Their link: right, wrong, and not heard; twice as often as the rest.
    for (const theirLink of [`${me}/${e}`, `${me}/${e}`, "west/Z", ""]) list.push({ end: e, theirLink });
    list.push({ end: e, online: true }, { end: e, online: true }, { end: e, online: false });
    for (let track = 0; track <= count + 1; track++) {
      for (const block of ["occupied", "clear", "clear", "unknown"]) list.push({ end: e, track, block });
      for (const mast of [...TAG_WORDS, "", "Clear"]) list.push({ end: e, track, mast });
    }
    list.push({ end: e, track: 1.5, block: "occupied" }, { end: e, pair: "released" });
    // Pair presses and one other end most often, so pairing succeeds as well as fails.
    for (let k = 0; k < 4; k++) list.push({ end: e, pair: "pressed" }, { pairing: `east/A/${count}` });
    for (const pairing of [`east/A/${count}`, `north/C/${count}`, "east/A/9", `${me}/${e}/${count}`, "garbage", "a/b/c/1", "x//1", "x/y/12345"]) list.push({ pairing });
  }
  list.push({ end: "Nowhere", link: "east/A" });
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

function trace(board, seed, me) {
  const next = random(seed);
  // Pair presses and announcements come only in the first 9 s, as at a meet,
  // so that every pairing group closes and is decided within the run.
  const rare = (e) => e.pair !== undefined || e.pairing !== undefined;
  const all = candidates(board, me);
  const pool = all.filter((e) => !rare(e));
  const pairing = all.filter(rare);
  const scans = [];
  for (let i = 0; i < SCANS; i++) {
    const events = [];
    // Mostly quiet scans, with bursts, as on a layout.
    const count = next() < 0.6 ? 0 : 1 + Math.floor(next() * 3);
    for (let k = 0; k < count && pool.length; k++) events.push(pool[Math.floor(next() * pool.length)]);
    if (pairing.length && i < 90 && next() < 0.03) events.push(pairing[Math.floor(next() * pairing.length)]);
    if (next() < 0.01) events.push({ logic: next() < 0.5 ? "off" : "on" });
    if (next() < 0.01) events.push({ broker: next() < 0.5 ? "disconnected" : "connected" });
    scans.push(events);
  }
  return scans;
}

// Boards with shapes the cases do not use, so the two engines are compared on
// them too: blocks of local, keyed and remote members, both keys for one
// sensor in one sequence, is lists, a when trigger with a cancel, a button,
// lock rules, approach lighting, and a resource no rule reserves. "plant
// ends": every kind of end track (a mast set by rules, a JMRI mast, a dark
// mast, none, pass-throughs good and bad, a track that is not an object), a
// block and a section reaching across an end, and rules reading what ends hear
// by Block, by Mast and as moments.
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
  "plant ends": {
    board: {
      sensors: ["In", "Main", "Out", "Loop"],
      turnouts: ["P1"],
      masts: { Home: S2, JM: S2, Dim: { ...S2, approachLight: "Main" }, Spare: S2 },
      logic: {
        blocks: [
          { name: "Approach", sensors: ["In", { end: "A", track: 1 }] },
          { name: "Beyond", sensors: [{ end: "B", track: 2 }] },
          { name: "Ghost", sensors: [{ end: "B", track: 7 }, { end: "Q", track: 1 }] },
        ],
        resources: [{ name: "Main line", blocks: ["Main", "Beyond"], release: { while: { block: "Beyond", is: "clear" }, for: "0.3s" } }],
        ends: [
          { name: "A", tracks: [{ sensors: ["In"], mast: "Home" }, { sensors: ["Loop"], through: { end: "B", track: 1 } }, null, { mast: "JM" }] },
          { name: "B", tracks: [
            { sensors: ["Loop"], through: { end: "A", track: 2 } },
            { sensors: ["Out"], mast: "Dim" },
            { sensors: ["Out"], through: { end: "B", track: 1 } },
            { through: { end: "Q", track: 1 } },
            { through: { end: "A", track: 9 } },
            { through: {} },
          ], pairPin: "GPIO32" },
          { name: "C", tracks: [{ mast: "Nowhere" }] },
        ],
        layers: [
          { name: "Signals", rules: [
            { trigger: { while: { block: "Approach", is: "clear" } }, checks: [{ end: "A", track: 4, hears: "mast", is: ["approach", "advance", "clear"] }],
              then: { mast: "Home", aspect: "R281", reserve: "Main line", lock: ["P1"] } },
            { trigger: { while: { block: "Approach", is: "clear" } }, checks: [{ not: { end: "A", track: 4, hears: "mast", is: "stop" } }, { end: "B", track: 2, hears: "mast", is: "diverging" }],
              then: { mast: "Home", aspect: "R285" } },
            { trigger: { while: { end: "B", track: 3, hears: "block", is: "clear" }, for: "0.2s" }, checks: [{ end: "C", track: 1, hears: "block", is: "occupied" }, { block: "Ghost", is: "occupied" }],
              then: { mast: "Dim", aspect: "R281" } },
          ] },
          { name: "Moments", rules: [
            { trigger: { when: { end: "A", track: 2, hears: "block", is: "occupied" }, then: [{ end: "A", track: 2, hears: "block", is: "clear" }] }, checks: [],
              then: { mast: "Spare", aspect: "R285" } },
            { trigger: { while: { any: [{ end: "B", track: 1, hears: "mast", is: ["clear"] }, { end: "Z", track: 1, hears: "block", is: "clear" }, { end: "A", track: "1", is: "clear" }] } }, checks: [],
              then: { mast: "Spare", aspect: "R281" } },
          ] },
        ],
      },
    },
    start: { board: "mid", links: { A: "west/B", B: "east/A", Nowhere: "x/y" } },
  },
  // Rules that take several resources at once (a track plan's moves), with
  // approach locking on some, and leaving guards on their own resources and
  // on named ones.
  "several resources": {
    board: {
      sensors: ["W", "N", "S", "A", "B", "C", "D"],
      turnouts: ["P1"],
      masts: { West: S2, North: S2, South: S2 },
      logic: {
        resources: [
          { name: "A", blocks: ["A"], release: { while: { block: "A", is: "clear" }, for: "0.5s" }, approachLock: "1s" },
          { name: "B", blocks: ["B"], release: { while: { block: "B", is: "clear" }, for: "0.3s" } },
          { name: "C", blocks: ["C", "D"], release: { when: { block: "D", is: "occupied" }, then: [{ block: "D", is: "clear" }] }, approachLock: "0.4s" },
        ],
        layers: [
          { name: "Moves", rules: [
            { trigger: { while: { block: "W", is: "occupied" }, for: "0.5s", leavingGuard: true }, checks: [{ turnout: "P1", is: "closed" }],
              then: { mast: "West", aspect: "R281", reserve: ["A", "B", "A", "Nowhere"], lock: ["P1"] } },
            { trigger: { while: { block: "N", is: "occupied" }, for: "0.3s", leavingGuard: ["C"] }, checks: [],
              then: { mast: "North", aspect: "R285", reserve: ["B", "C"] } },
            { trigger: { when: { block: "S", is: "occupied" } }, checks: [{ block: "C", is: "clear" }],
              then: { mast: "South", aspect: "R281", reserve: ["C"] }, cancel: { when: { block: "S", is: "clear" } } },
            { trigger: { while: { block: "S", is: "clear" } }, checks: [], then: { mast: "South", aspect: "R285", reserve: [] } },
          ] },
          { name: "More", rules: [
            { trigger: { while: { block: "D", is: "occupied" }, leavingGuard: ["A", "Nowhere"] }, checks: [], then: { mast: "North", aspect: "R281", reserve: ["A", "C"] } },
          ] },
        ],
      },
    },
  },
  // One end, so that pairing with east/A often succeeds, then is heard.
  pairing: {
    board: {
      sensors: ["S"],
      masts: { Home: S2 },
      logic: {
        blocks: [{ name: "Next", sensors: ["S", { end: "A", track: 1 }] }],
        ends: [{ name: "A", tracks: [{ sensors: ["S"], mast: "Home" }, {}] }],
        layers: [{ name: "Home", rules: [
          { trigger: { while: { block: "Next", is: "clear" } }, checks: [{ end: "A", track: 1, hears: "mast", is: ["approach", "clear"] }], then: { mast: "Home", aspect: "R281" } },
        ] }],
      },
    },
    start: { board: "solo" },
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
  // A multi-board case gives each of its boards, with its own start and name.
  const boards = fs.readdirSync(casesDir).filter((f) => f.endsWith(".json")).sort()
    .flatMap((file) => {
      const data = JSON.parse(fs.readFileSync(path.join(casesDir, file), "utf8"));
      if (!data.boards) return [[file, data]];
      return Object.entries(data.boards).map(([name, board]) => [`${file} (${name})`, { board, start: { ...(data.start?.[name] || {}), board: name } }]);
    });
  for (const [name, data] of Object.entries(EXTRA_BOARDS)) boards.push([name, data]);
  for (const [file, { board, start = {} }] of boards) {
    const runs = file in EXTRA_BOARDS ? TRACES * 10 : TRACES;
    test(`JS and C++ agree on ${file}'s board, ${runs} random runs of ${SCANS} scans`, () => {
      for (let run = 0; run < runs; run++) {
        // A seed per file name and run, so every board gets its own events.
        let seed = run * 7919;
        for (const ch of file) seed = (Math.imul(seed, 31) + ch.charCodeAt(0)) >>> 0;
        const scans = trace(board, seed, start.board);
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
