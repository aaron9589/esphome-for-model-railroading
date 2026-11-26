// The shared engine cases in test/cases (work item 2.1). No engine runs them
// yet (2.2 and 2.3 will). This checks that each case only refers to what its
// board has, in the shapes test/cases/README.md describes, and that every Scan,
// Rules, Fail safe and Plant ends bullet in the spec's Tests section has a case.
// A multi-board case (`boards`) is checked board by board.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { configuratorDir, test } from "./harness.js";

const casesDir = path.join(configuratorDir, "test", "cases");
const files = fs.readdirSync(casesDir).filter((file) => file.endsWith(".json")).sort();
const cases = files.map((file) => ({ file, data: JSON.parse(fs.readFileSync(path.join(casesDir, file), "utf8")) }));

const TAGS = ["stop", "restricting", "approach", "advance", "clear"];
const DURATION = /^\d+(\.\d+)?(ms|s)$/;

// The spec's Tests bullets that must each have a case.
function specBullets() {
  const spec = fs.readFileSync(path.join(configuratorDir, "..", "docs", "field-logic-spec.md"), "utf8");
  const tests = spec.slice(spec.indexOf("\n## Tests"), spec.indexOf("\n## Open questions"));
  const bullets = [];
  let section = null;
  for (const line of tests.split(/\r?\n/)) {
    const head = line.match(/^- \*\*([^*]+)\*\*/);
    if (head) section = head[1].replace(/:$/, "");
    else if (["Scan", "Rules", "Fail safe", "Plant ends"].includes(section) && line.startsWith("  - ")) bullets.push(line.slice(4));
  }
  return bullets;
}

const END_STATES = ["pairing", "empty", "end", "unheard", "disagrees", "heard"];

// Checks one case, pushing a message for each problem. A multi-board case is
// checked as one case per board, with that board's part of each step.
function check({ file, data }) {
  if (!data.name) return [`${file}: case: no name`];
  if (!data.boards) return checkBoard(file, data);
  const problems = [];
  const names = Object.keys(data.boards);
  if (names.length < 2) problems.push(`${file}: case: a multi-board case needs two boards or more`);
  if ("board" in data) problems.push(`${file}: case: board and boards`);
  for (const key of Object.keys(data.start || {})) if (!names.includes(key)) problems.push(`${file}: start: no board ${key}`);
  for (const step of data.steps || []) {
    for (const part of ["do", "expect"]) {
      for (const key of Object.keys(step[part] || {})) if (!names.includes(key)) problems.push(`${file}: step at ${step.at}: ${part} for no board ${key}`);
    }
  }
  for (const name of names) {
    const steps = (data.steps || []).map((step) => {
      const one = { at: step.at };
      if (step.do?.[name]) one.do = step.do[name];
      if (step.expect?.[name]) one.expect = step.expect[name];
      return one;
    });
    const start = { ...(data.start?.[name] || {}) };
    if ("board" in start) problems.push(`${file}: ${name}: start: board is the board's key in boards`);
    problems.push(...checkBoard(`${file} (${name})`, { ...data, board: data.boards[name], start: { ...start, board: name }, steps }));
  }
  return problems;
}

function checkBoard(file, data) {
  const problems = [];
  const fail = (where, what) => problems.push(`${file}: ${where}: ${what}`);
  const { board = {}, start = {}, steps } = data;
  if (!data.name) fail("case", "no name");
  if (!data.about) fail("case", "no about");
  if (!Array.isArray(data.covers) || !data.covers.length) fail("case", "covers no spec bullet");
  if (!Array.isArray(steps) || !steps.length) fail("case", "no steps");

  const sensors = new Set(board.sensors || []);
  const turnouts = new Set(board.turnouts || []);
  const masts = board.masts || {};
  const logic = board.logic || {};
  const blocks = new Set((logic.blocks || []).map((b) => b.name));
  const buttons = new Set((logic.buttons || []).map((b) => b.name));
  const resources = new Map((logic.resources || []).map((r) => [r.name, r]));
  const remote = board.remote || {};
  const layers = logic.layers || [];
  const ruleRefs = new Set(layers.flatMap((layer) => (layer.rules || []).map((_, i) => `${layer.name}/${i + 1}`)));
  const isBlock = (name) => sensors.has(name) || blocks.has(name);

  for (const [name, mast] of Object.entries(masts)) {
    const aspects = mast.aspects || {};
    if (!Object.keys(aspects).length) fail(`mast ${name}`, "no aspects");
    for (const [aspect, tag] of Object.entries(aspects)) if (!TAGS.includes(tag)) fail(`mast ${name}`, `${aspect} has tag ${tag}`);
    for (const aspect of mast.diverging || []) if (!(aspect in aspects)) fail(`mast ${name}`, `diverging ${aspect} is not an aspect`);
    for (const aspect of Object.keys(mast.states || {})) if (!(aspect in aspects)) fail(`mast ${name}`, `states for ${aspect}`);
    for (const key of ["stop", "startup"]) if (mast[key] !== undefined && !(mast[key] in aspects)) fail(`mast ${name}`, `${key} ${mast[key]}`);
    if (!Object.values(aspects).includes("stop")) fail(`mast ${name}`, "has no stop aspect");
  }
  // Plant ends: each track's sensors are this board's; a mast is on this
  // board; a pass-through names a track of an end. The link is never here.
  const ends = new Map((logic.ends || []).map((end) => [end.name, end]));
  const endTrack = (end, track) => ends.has(end) && Number.isInteger(track) && track >= 1 && track <= (ends.get(end).tracks || []).length;
  if (ends.size !== (logic.ends || []).length) fail("ends", "two ends share a name");
  for (const end of logic.ends || []) {
    for (const key of Object.keys(end)) if (!["name", "tracks", "pairPin", "ledPin"].includes(key)) fail(`end ${end.name}`, `${key} (a link is not part of the board)`);
    if (!(end.tracks || []).length) fail(`end ${end.name}`, "no tracks");
    (end.tracks || []).forEach((track, i) => {
      const where = `end ${end.name} track ${i + 1}`;
      for (const key of Object.keys(track)) if (!["sensors", "mast", "through"].includes(key)) fail(where, key);
      for (const s of track.sensors || []) if (!sensors.has(s)) fail(where, `sensor ${s}`);
      if (track.mast !== undefined && !(track.mast in masts)) fail(where, `mast ${track.mast}`);
      if (track.mast !== undefined && track.through !== undefined) fail(where, "a mast and a pass-through");
      if (track.through !== undefined && !endTrack(track.through.end, track.through.track)) fail(where, `through ${JSON.stringify(track.through)}`);
    });
  }
  for (const block of logic.blocks || []) {
    for (const s of block.sensors || []) {
      if (typeof s === "string") {
        if (!sensors.has(s)) fail(`block ${block.name}`, `sensor ${s}`);
      } else if (s.end !== undefined) {
        if (!endTrack(s.end, s.track)) fail(`block ${block.name}`, `end ${s.end} track ${s.track}`);
      } else if (s.board !== undefined) {
        if (!remoteHas(s.board, s.block !== undefined ? "block" : "sensor", s.sensor ?? s.block)) fail(`block ${block.name}`, `member ${JSON.stringify(s)}`);
      } else fail(`block ${block.name}`, `member ${JSON.stringify(s)}`);
    }
  }

  for (const [b, other] of Object.entries(remote)) {
    for (const [name, mast] of Object.entries(other.masts || {})) {
      const aspects = mast.aspects || {};
      if (!Object.keys(aspects).length) fail(`${b} mast ${name}`, "no aspects");
      for (const [aspect, tag] of Object.entries(aspects)) if (!TAGS.includes(tag)) fail(`${b} mast ${name}`, `${aspect} has tag ${tag}`);
    }
  }
  const remoteAspects = (b, m) => remote[b]?.masts?.[m]?.aspects || {};

  function remoteHas(boardName, kind, name) {
    const other = remote[boardName];
    if (!other) return false;
    if (kind === "mast") return name in (other.masts || {});
    if (kind === "turnout") return (other.turnouts || []).includes(name);
    return (other.sensors || []).includes(name) || (other.blocks || []).includes(name);
  }

  // A condition (or a moment: the same shapes).
  function condition(c, where) {
    if (!c || typeof c !== "object") return fail(where, "not a condition");
    if (c.all || c.any) return (c.all || c.any).forEach((inner) => condition(inner, where));
    if (c.not) return condition(c.not, where);
    if (c.end !== undefined) {
      if (!endTrack(c.end, c.track)) fail(where, `end ${c.end} track ${c.track}`);
      if (!["block", "mast"].includes(c.hears)) fail(where, `hears ${c.hears}`);
      const allowed = c.hears === "mast" ? TAGS : ["occupied", "clear"];
      for (const is of [].concat(c.is)) if (!allowed.includes(is)) fail(where, `end ${c.end} is ${is}`);
      return;
    }
    const kind = ["block", "sensor", "turnout", "mast", "button"].find((k) => c[k] !== undefined);
    if (!kind) return fail(where, `unknown condition ${JSON.stringify(c)}`);
    const name = c[kind];
    if (c.board !== undefined) {
      if (!remoteHas(c.board, kind, name)) fail(where, `${c.board} has no ${kind} ${name}`);
    } else if ((kind === "block" || kind === "sensor") && !isBlock(name)) fail(where, `no block or sensor ${name}`);
    else if (kind === "turnout" && !turnouts.has(name)) fail(where, `no turnout ${name}`);
    else if (kind === "mast" && !(name in masts)) fail(where, `no mast ${name}`);
    else if (kind === "button" && !buttons.has(name)) fail(where, `no button ${name}`);
    const allowed = {
      block: ["occupied", "clear"], sensor: ["occupied", "clear"], turnout: ["closed", "thrown"],
      button: ["pressed"], mast: [...TAGS, "diverging"],
    }[kind];
    for (const is of [].concat(c.is)) if (!allowed.includes(is)) fail(where, `${kind} ${name} is ${is}`);
  }

  function trigger(t, where) {
    if (!t || typeof t !== "object") return fail(where, "no trigger");
    if (t.for !== undefined && !DURATION.test(t.for)) fail(where, `for ${t.for}`);
    if (t.while) condition(t.while, `${where} while`);
    else if (t.when) {
      condition(t.when, `${where} when`);
      (t.then || []).forEach((m, i) => condition(m, `${where} then ${i + 1}`));
      if (t.leavingGuard) fail(where, "a leaving guard needs a while trigger");
    } else fail(where, "neither while nor when");
  }

  for (const [name, r] of resources) {
    for (const b of r.blocks || []) if (!isBlock(b)) fail(`resource ${name}`, `block ${b}`);
    if (!(r.blocks || []).length) fail(`resource ${name}`, "no blocks");
    trigger(r.release, `resource ${name} release`);
    if (r.approachLock !== undefined && !DURATION.test(r.approachLock)) fail(`resource ${name}`, `approachLock ${r.approachLock}`);
  }
  if (new Set(layers.map((l) => l.name)).size !== layers.length) fail("layers", "two layers share a name");
  for (const layer of layers) {
    (layer.rules || []).forEach((rule, i) => {
      const where = `${layer.name}/${i + 1}`;
      trigger(rule.trigger, where);
      (rule.checks || []).forEach((c) => condition(c, `${where} check`));
      const then = rule.then || {};
      if (then.mast !== undefined) {
        if (!(then.mast in masts)) fail(where, `sets no mast ${then.mast}`);
        else if (!(then.aspect in masts[then.mast].aspects)) fail(where, `${then.mast} has no aspect ${then.aspect}`);
      }
      for (const name of [].concat(then.reserve ?? [])) if (!resources.has(name)) fail(where, `reserves ${name}`);
      const guard = rule.trigger?.leavingGuard;
      if (Array.isArray(guard)) for (const name of guard) if (!resources.has(name)) fail(where, `leaving guard watches ${name}`);
      for (const t of then.lock || []) if (!turnouts.has(t)) fail(where, `locks ${t}`);
      if (rule.cancel) {
        if (!rule.trigger?.when) fail(where, "CANCEL is only for a when trigger");
        condition(rule.cancel.when, `${where} cancel`);
      }
    });
  }

  // start
  const states = { sensor: ["occupied", "clear"], turnout: ["closed", "thrown"] };
  if (start.logic !== undefined && !["on", "off"].includes(start.logic)) fail("start", `logic ${start.logic}`);
  if (start.broker !== undefined && !["connected", "disconnected"].includes(start.broker)) fail("start", `broker ${start.broker}`);
  for (const [s, v] of Object.entries(start.sensors || {})) if (!sensors.has(s) || !states.sensor.includes(v)) fail("start", `sensor ${s} ${v}`);
  for (const [t, v] of Object.entries(start.turnouts || {})) if (!turnouts.has(t) || !states.turnout.includes(v)) fail("start", `turnout ${t} ${v}`);
  for (const [m, message] of Object.entries(start.jmri || {})) if (!(m in masts) || typeof message !== "string") fail("start", `jmri ${m}`);
  for (const t of Object.keys(start.remoteLocks || {})) if (!turnouts.has(t)) fail("start", `remoteLock ${t}`);
  if (start.board !== undefined && typeof start.board !== "string") fail("start", `board ${start.board}`);
  for (const [e, link] of Object.entries(start.links || {})) if (!ends.has(e) || typeof link !== "string") fail("start", `link ${e}`);
  for (const [b, s] of Object.entries(start.remote || {})) {
    if (!remote[b]) fail("start", `remote ${b}`);
    for (const n of Object.keys(s.sensors || {})) if (!remoteHas(b, "sensor", n)) fail("start", `${b} sensor ${n}`);
    for (const n of Object.keys(s.turnouts || {})) if (!remoteHas(b, "turnout", n)) fail("start", `${b} turnout ${n}`);
    if (s.online !== undefined && typeof s.online !== "boolean") fail("start", `${b} online ${s.online}`);
    for (const [n, v] of Object.entries(s.sensors || {})) if (!["occupied", "clear"].includes(v)) fail("start", `${b} sensor ${n} ${v}`);
    for (const [n, v] of Object.entries(s.turnouts || {})) if (!["closed", "thrown", "moving"].includes(v)) fail("start", `${b} turnout ${n} ${v}`);
    for (const [n, a] of Object.entries(s.masts || {})) if (!remoteHas(b, "mast", n) || (a && !(a in remoteAspects(b, n)))) fail("start", `${b} mast ${n} ${a}`);
  }

  // steps
  function event(e, where) {
    if (e.end !== undefined) {
      if (!ends.has(e.end)) return fail(where, `no end ${e.end}`);
      if (e.pair !== undefined) return void (e.pair !== "pressed" && fail(where, `pair ${e.pair}`));
      if (e.link !== undefined || e.theirLink !== undefined) return void (typeof (e.link ?? e.theirLink) !== "string" && fail(where, "link"));
      if (e.online !== undefined) return void (typeof e.online !== "boolean" && fail(where, "online"));
      // A heard track is numbered as the linked end numbers it: the same count.
      if (!endTrack(e.end, e.track)) return fail(where, `end ${e.end} track ${e.track}`);
      if (e.block !== undefined) return void (!["occupied", "clear", "unknown"].includes(e.block) && fail(where, `block ${e.block}`));
      if (e.mast !== undefined) return void (typeof e.mast !== "string" && fail(where, `mast ${e.mast}`));
      return fail(where, `end event ${JSON.stringify(e)}`);
    }
    if (e.pairing !== undefined) return void (typeof e.pairing !== "string" && fail(where, "pairing"));
    if (e.board !== undefined) {
      if (!remote[e.board]) return fail(where, `no board ${e.board}`);
      if (e.online !== undefined) return void (typeof e.online !== "boolean" && fail(where, "online"));
      if (e.mast !== undefined) {
        if (!remoteHas(e.board, "mast", e.mast)) fail(where, `${e.board} mast ${e.mast}`);
        else if (e.aspect !== "" && !(e.aspect in remoteAspects(e.board, e.mast))) fail(where, `${e.mast} aspect ${e.aspect}`);
        return;
      }
      const kind = ["sensor", "block", "turnout"].find((k) => e[k] !== undefined);
      if (!kind || !remoteHas(e.board, kind, e[kind])) return fail(where, `remote ${JSON.stringify(e)}`);
      const ok = kind === "turnout" ? ["closed", "thrown", "moving", "unknown"] : ["occupied", "clear", "unknown"];
      if (!ok.includes(e.is)) fail(where, `${kind} ${e[kind]} is ${e.is}`);
      return;
    }
    if (e.sensor !== undefined) return void ((!sensors.has(e.sensor) || !["occupied", "clear"].includes(e.is)) && fail(where, `sensor ${e.sensor} ${e.is}`));
    if (e.button !== undefined) return void ((!buttons.has(e.button) || !["pressed", "released"].includes(e.is)) && fail(where, `button ${e.button}`));
    if (e.turnout !== undefined) return void ((!turnouts.has(e.turnout) || !["closed", "thrown", "moving"].includes(e.is)) && fail(where, `turnout ${e.turnout} ${e.is}`));
    if (e.remoteLock !== undefined) return void ((!turnouts.has(e.remoteLock) || !["locked", "unlocked"].includes(e.is)) && fail(where, `remoteLock ${e.remoteLock}`));
    if (e.jmri !== undefined) return void ((!(e.jmri in masts) || typeof e.message !== "string") && fail(where, `jmri ${e.jmri}`));
    if (e.release !== undefined) return void ((!resources.has(e.release) || !["button", "mqtt"].includes(e.via)) && fail(where, `release ${e.release}`));
    if (e.logic !== undefined) return void (!["on", "off"].includes(e.logic) && fail(where, `logic ${e.logic}`));
    if (e.broker !== undefined) return void (!["connected", "disconnected"].includes(e.broker) && fail(where, `broker ${e.broker}`));
    fail(where, `unknown event ${JSON.stringify(e)}`);
  }

  const ref = (r, where) => ruleRefs.has(r) || fail(where, `no rule ${r}`);
  const res = (r, where) => resources.has(r) || fail(where, `no resource ${r}`);
  function logged(e, where) {
    if (e.startup !== undefined) return void (e.startup !== true && fail(where, "startup"));
    if (e.grant !== undefined) return res(e.grant, where) && ref(e.rule, where);
    if (e.cancel !== undefined) return res(e.cancel, where) && ref(e.rule, where);
    // null: a resource held at start-up, with no rule holding it.
    if (e.pass !== undefined) return res(e.pass, where) && (e.rule === null || ref(e.rule, where));
    if (e.release !== undefined) return res(e.release, where) && (["release", "cancel", "time", "manual", "switch"].includes(e.by) || fail(where, `by ${e.by}`));
    if (e.ignored !== undefined) return (e.ignored === "release" || fail(where, `ignored ${e.ignored}`)) && res(e.resource, where);
    if (e.resync !== undefined) return turnouts.has(e.resync) || fail(where, `resync ${e.resync}`);
    if (e.pairing !== undefined) {
      if (!ends.has(e.pairing)) return fail(where, `pairing ${e.pairing}`);
      if (e.result === "paired") return void (typeof e.with !== "string" && fail(where, "paired with"));
      return void ((!["crowded", "tracks", "alone"].includes(e.result) || "with" in e) && fail(where, `pairing result ${e.result}`));
    }
    if (e.disagrees !== undefined) return void ((!ends.has(e.disagrees) || typeof e.link !== "string" || typeof e.theirs !== "string") && fail(where, "disagrees"));
    fail(where, `unknown event ${JSON.stringify(e)}`);
  }

  let last = -1;
  for (const step of steps || []) {
    const where = `step at ${step.at}`;
    if (!Number.isInteger(step.at) || step.at <= last) fail(where, "at must be a whole number, going up");
    last = step.at;
    if (step.at === 0 && step.do) fail(where, "use start for the field at power-on");
    (step.do || []).forEach((e) => event(e, where));
    const expect = step.expect || {};
    for (const key of Object.keys(expect)) {
      if (!["logic", "masts", "rules", "resources", "holders", "locks", "locked", "events", "writes", "publishes", "ends", "links"].includes(key)) fail(where, `expect ${key}`);
    }
    for (const [e, st] of Object.entries(expect.ends || {})) if (!ends.has(e) || !END_STATES.includes(st)) fail(where, `end ${e} is ${st}`);
    for (const [e, link] of Object.entries(expect.links || {})) if (!ends.has(e) || typeof link !== "string") fail(where, `link ${e}`);
    for (const [m, a] of Object.entries(expect.masts || {})) {
      if (!(m in masts)) fail(where, `expect mast ${m}`);
      else if (a !== null && a !== "dark" && !(a in masts[m].aspects)) fail(where, `${m} has no aspect ${a}`);
    }
    for (const [r, phase] of Object.entries(expect.rules || {})) {
      ref(r, where);
      if (!["idle", "waiting", "active", "passed", "cancelling"].includes(phase)) fail(where, `rule phase ${phase}`);
    }
    for (const [r, state] of Object.entries(expect.resources || {})) {
      res(r, where);
      if (!["IDLE", "ACTIVE", "PASSED", "CANCELLING"].includes(state)) fail(where, `resource state ${state}`);
    }
    for (const [r, holder] of Object.entries(expect.holders || {})) res(r, where) && (holder === null || ref(holder, where));
    for (const key of ["locks", "locked"]) {
      for (const [t, v] of Object.entries(expect[key] || {})) if (!turnouts.has(t) || typeof v !== "boolean") fail(where, `${key} ${t}`);
    }
    (expect.events || []).forEach((e) => logged(e, where));
    for (const w of expect.writes || []) {
      if (w.mast !== undefined) {
        if (!(w.mast in masts) || (w.aspect !== "dark" && !(w.aspect in masts[w.mast].aspects))) fail(where, `write ${JSON.stringify(w)}`);
      } else if (!turnouts.has(w.lock) || typeof w.on !== "boolean") fail(where, `write ${JSON.stringify(w)}`);
    }
    for (const p of expect.publishes || []) {
      if (p.pairing !== undefined) {
        const [, end, tracks] = /^.*\/([^/]+)\/(\d+)$/.exec(p.pairing) || [];
        if (p.pairing !== `${start.board ?? ""}/${end}/${tracks}` || !ends.has(end) || Number(tracks) !== ends.get(end).tracks.length) fail(where, `publish ${JSON.stringify(p)}`);
      } else if (p.end !== undefined) {
        const ok = p.link !== undefined ? typeof p.link === "string"
          : endTrack(p.end, p.track) && (p.block !== undefined ? ["ACTIVE", "INACTIVE"].includes(p.block) : TAGS.includes(p.mast));
        if (!ok) fail(where, `publish ${JSON.stringify(p)}`);
      } else if (p.release !== undefined) res(p.release, where) && p.value !== "CLOSED" && fail(where, "release publishes CLOSED");
      else {
        const held = p.held !== undefined;
        const ok = resources.has(p.resource) && held !== (p.state !== undefined) &&
          (held ? ["ACTIVE", "INACTIVE"].includes(p.held) : ["IDLE", "ACTIVE", "PASSED", "CANCELLING"].includes(p.state));
        if (!ok) fail(where, `publish ${JSON.stringify(p)}`);
      }
    }
  }
  return problems;
}

test("there are cases, and each is one board, or several, and one timeline", () => {
  assert.ok(cases.length >= 30, `${cases.length} cases`);
  for (const { file, data } of cases) {
    assert.deepEqual(Object.keys(data).filter((k) => !["name", "covers", "about", "board", "boards", "start", "steps"].includes(k)), [], file);
    assert.ok(("board" in data) !== ("boards" in data), `${file}: board or boards`);
  }
  assert.ok(cases.some(({ data }) => Object.keys(data.boards || {}).length >= 3), "a case with three boards");
});

test("a link is never part of a board, so it cannot change the version code", () => {
  // The version code is a hash of the board's table (logic-yaml.js). A link is
  // set only by start.links and link events, so no board in a case has one.
  for (const { file, data } of cases) {
    const boards = data.boards ? Object.values(data.boards) : [data.board];
    for (const board of boards) assert.ok(!/"(link|links|theirLink)"/.test(JSON.stringify(board)), file);
  }
});

test("every case refers only to what its board has", () => {
  assert.deepEqual(cases.flatMap(check), []);
});

test("every Scan, Rules, Fail safe and Plant ends bullet in the spec has a case", () => {
  const bullets = specBullets();
  assert.ok(bullets.length >= 26, `found ${bullets.length} bullets`);
  assert.ok(bullets.some((b) => b.startsWith("pairing:")), "the Plant ends bullets are read");
  const covered = new Set(cases.flatMap(({ data }) => data.covers));
  assert.deepEqual(bullets.filter((b) => !covered.has(b)), [], "bullets with no case");
  assert.deepEqual([...covered].filter((c) => !bullets.includes(c)), [], "covers text that is not a spec bullet");
});

// MSS Logic (docs/mss-emulation-spec.md, Tests): its MSS behaviour, Junctions
// and Across modules bullets each need an MSS case in test/cases/mss, which
// mss-builder.test.js builds and replays. Its one validation bullet is a
// builder test there.
const mssDir = path.join(casesDir, "mss");
const mssCases = fs.readdirSync(mssDir).filter((file) => file.endsWith(".json")).sort()
  .map((file) => ({ file, data: JSON.parse(fs.readFileSync(path.join(mssDir, file), "utf8")) }));

function mssBullets() {
  const spec = fs.readFileSync(path.join(configuratorDir, "..", "docs", "mss-emulation-spec.md"), "utf8");
  const tests = spec.slice(spec.indexOf("\n## Tests"));
  const bullets = [];
  let section = null;
  for (const line of tests.split(/\r?\n/)) {
    const head = line.match(/^- \*\*([^*]+)\*\*/);
    if (head) {
      section = head[1].replace(/:$/, "");
      // "Across modules" has its bullet on the same line.
      const rest = line.slice(head[0].length).trim();
      if (section === "Across modules" && rest) bullets.push(rest.replace(/ The plant end tests themselves are in the core spec\.$/, ""));
    } else if (["MSS behaviour", "Junctions"].includes(section) && line.startsWith("  - ") && !line.startsWith("  - validation")) bullets.push(line.slice(4));
  }
  // A bullet's closing full stop is not part of what a case covers.
  return bullets.map((bullet) => bullet.replace(/\.$/, ""));
}

test("every MSS behaviour, Junctions and Across modules bullet in the MSS spec has an MSS case", () => {
  const bullets = mssBullets();
  assert.equal(bullets.length, 9, bullets.join("\n"));
  for (const { file, data } of mssCases) {
    assert.deepEqual(Object.keys(data).filter((k) => !["name", "covers", "about", "module", "modules", "start", "steps"].includes(k)), [], file);
    assert.ok(("module" in data) !== ("modules" in data), `${file}: module or modules`);
    assert.ok(data.name && data.about && data.covers?.length && data.steps?.length, file);
  }
  const covered = new Set(mssCases.flatMap(({ data }) => data.covers));
  assert.deepEqual(bullets.filter((b) => !covered.has(b)), [], "bullets with no case");
  assert.deepEqual([...covered].filter((c) => !bullets.includes(c)), [], "covers text that is not an MSS spec bullet");
  const readme = fs.readFileSync(path.join(casesDir, "README.md"), "utf8");
  const table = readme.slice(readme.indexOf("## MSS Logic cases"));
  for (const { file } of mssCases) assert.ok(table.includes(`\`${file.replace(/\.json$/, "")}\``), `${file} is in the README's MSS table`);
});

test("the README's table lists every case file", () => {
  const readme = fs.readFileSync(path.join(casesDir, "README.md"), "utf8");
  const table = readme.slice(readme.indexOf("## Which case covers which bullet"));
  const named = new Set();
  for (const [, cell] of table.matchAll(/\| ([^|]*`[^|]*) \|\r?\n/g)) {
    let prefix = "";
    for (const [, name] of cell.matchAll(/`([^`]+)`/g)) {
      // "`rules-approach-locking-off`, `-time`" names rules-approach-locking-time.
      const full = name.startsWith("-") ? `${prefix}${name}` : name;
      if (!name.startsWith("-")) prefix = name.slice(0, name.lastIndexOf("-"));
      named.add(full);
    }
  }
  const stems = files.map((f) => f.replace(/\.json$/, ""));
  assert.deepEqual(stems.filter((f) => !named.has(f)), [], "case files missing from the table");
  assert.deepEqual([...named].filter((n) => !stems.includes(n)), [], "names in the table with no case file");
});

test("the check would catch a broken case", () => {
  const broken = JSON.parse(JSON.stringify(cases.find(({ file }) => file === "rules-leaving-guard.json")));
  broken.data.steps.push({ at: 999, do: [{ sensor: "Nowhere", is: "occupied" }], expect: { masts: { "Left Bridge": "R999" }, rules: { "Single line/9": "active" } } });
  const problems = check(broken);
  assert.ok(problems.some((p) => p.includes("sensor Nowhere")));
  assert.ok(problems.some((p) => p.includes("no aspect R999")));
  assert.ok(problems.some((p) => p.includes("no rule Single line/9")));
  const odd = JSON.parse(JSON.stringify(broken));
  odd.data.board.remote = { south: { masts: { Home: {} } } };
  odd.data.start = { remote: { south: { online: "true", masts: { Home: "R281" } } }, jmri: { "Left Bridge": 7 } };
  odd.data.steps = [{ at: 1, expect: {
    events: [{ grant: "Bridge", rule: null }, { ignored: "anything", resource: "Bridge" }],
    publishes: [{ resource: "Bridge", held: "PASSED", state: "IDLE" }],
  } }];
  const more = check(odd);
  for (const text of ["south mast Home: no aspects", "south online true", "jmri Left Bridge", "no rule null", "ignored anything", "publish"]) {
    assert.ok(more.some((p) => p.includes(text)), text);
  }
});

test("the check would catch a broken plant end case", () => {
  const broken = JSON.parse(JSON.stringify(cases.find(({ file }) => file === "ends-three-boards-turned.json")));
  const west = broken.data.boards.west;
  west.logic.ends[0].tracks[1].mast = "Nowhere";
  west.logic.ends[1].link = "mid/B";
  west.logic.blocks[0].sensors.push({ end: "C", track: 1 });
  west.logic.layers[0].rules[0].checks.push({ end: "B", track: 3, hears: "block", is: "approach" });
  broken.data.steps.push({ at: 999, do: { west: [{ end: "B", track: 9, block: "occupied" }], south: [] }, expect: { mid: { ends: { A: "lost" } } } });
  const problems = check(broken);
  for (const text of ["mast Nowhere", "link (a link", "end C track 1", "end B track 3", "end B is approach", "end B track 9", "no board south", "end A is lost"]) {
    assert.ok(problems.some((p) => p.includes(text)), text);
  }
});

if (!process.exitCode) console.log("\nAll engine case checks passed.");
