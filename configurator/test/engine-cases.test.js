// The shared engine cases in test/cases (work item 2.1). No engine runs them
// yet (2.2 and 2.3 will). This checks that each case only refers to what its
// board has, in the shapes test/cases/README.md describes, and that every Scan,
// Rules and Fail safe bullet in the spec's Tests section has a case.
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
    else if (["Scan", "Rules", "Fail safe"].includes(section) && line.startsWith("  - ")) bullets.push(line.slice(4));
  }
  return bullets;
}

// Checks one case, pushing a message for each problem.
function check({ file, data }) {
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
  for (const block of logic.blocks || []) for (const s of block.sensors || []) if (!sensors.has(s)) fail(`block ${block.name}`, `sensor ${s}`);

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
      if (then.reserve !== undefined && !resources.has(then.reserve)) fail(where, `reserves ${then.reserve}`);
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
      if (!["logic", "masts", "rules", "resources", "holders", "locks", "locked", "events", "writes", "publishes"].includes(key)) fail(where, `expect ${key}`);
    }
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
      if (p.release !== undefined) res(p.release, where) && p.value !== "CLOSED" && fail(where, "release publishes CLOSED");
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

test("there are cases, and each is one board and one timeline", () => {
  assert.ok(cases.length >= 30, `${cases.length} cases`);
  for (const { file, data } of cases) {
    assert.deepEqual(Object.keys(data).filter((k) => !["name", "covers", "about", "board", "start", "steps"].includes(k)), [], file);
  }
});

test("every case refers only to what its board has", () => {
  assert.deepEqual(cases.flatMap(check), []);
});

test("every Scan, Rules and Fail safe bullet in the spec has a case", () => {
  const bullets = specBullets();
  assert.ok(bullets.length >= 20, `found ${bullets.length} bullets`);
  const covered = new Set(cases.flatMap(({ data }) => data.covers));
  assert.deepEqual(bullets.filter((b) => !covered.has(b)), [], "bullets with no case");
  assert.deepEqual([...covered].filter((c) => !bullets.includes(c)), [], "covers text that is not a spec bullet");
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

if (!process.exitCode) console.log("\nAll engine case checks passed.");
