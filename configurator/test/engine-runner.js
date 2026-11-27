// Replays one case (test/cases) against the JS engine. Shared by
// engine-run.test.js and logic.test.js. A multi-board case (`boards`) runs one
// engine per board, with the broker between them (test/cases/README.md,
// Multi-board cases); engine-tests/main.cpp does the same for the C++ core.
import assert from "node:assert/strict";
import { loadModules } from "./harness.js";

const { EsphomeMrLogic: L } = loadModules("logic.js");
const plain = (value) => JSON.parse(JSON.stringify(value));

const STATE_KEYS = ["masts", "rules", "resources", "holders", "locks", "locked", "ends", "links"];

// Compares one step's expect with a scan's outputs and the state after it.
function check(problems, where, expect = {}, out, state) {
  if ("logic" in expect && state.logic !== expect.logic) problems.push(`${where}: logic is ${state.logic}, expected ${expect.logic}`);
  if ("auto" in expect && state.auto !== expect.auto) problems.push(`${where}: auto is ${state.auto}, expected ${expect.auto}`);
  for (const key of STATE_KEYS) {
    for (const [name, want] of Object.entries(expect[key] || {})) {
      const got = state[key][name];
      if (got !== want) problems.push(`${where}: ${key} ${name} is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    }
  }
  for (const key of ["events", "writes", "publishes"]) {
    if (!(key in expect)) continue;
    try {
      assert.deepEqual(out[key], expect[key]);
    } catch {
      problems.push(`${where}: ${key} ${JSON.stringify(out[key])}, expected ${JSON.stringify(expect[key])}`);
    }
  }
}

// Runs one case. Returns a list of mismatches, each naming the step.
export function runCase(data) {
  if (data.boards) return runMultiCase(data);
  const engine = L.createEngine(data.board, data.start || {});
  const problems = [];
  let next = 0;
  for (const step of data.steps) {
    while (next < step.at) {
      engine.scan();
      next += 1;
    }
    for (const e of step.do || []) engine.event(e);
    const out = plain(engine.scan());
    next += 1;
    check(problems, `scan ${step.at}`, step.expect, out, plain(engine.state()));
  }
  return problems;
}

// --- The broker between boards ---------------------------------------------

// A link's target, "<board>/<end>", as the engine reads it (README rule 24),
// or null when the end hears no one.
function target(link, board, end) {
  const at = link.lastIndexOf("/");
  if (link === "end" || at <= 0 || at === link.length - 1 || link === `${board}/${end}`) return null;
  return link;
}

/**
 * The broker of a multi-board case: retained messages, and each end's
 * subscriptions from its link. `route` takes a round of scans' publishes and
 * returns, per board, the events it hears before the next round.
 */
export function createBroker(names, connected) {
  const retained = new Map(); // "<board>/<end>" -> { link, tracks: Map(track -> { block, mast }) }
  const online = new Map(names.filter((name) => connected.get(name)).map((name) => [name, true]));
  let targets = new Map(); // board -> [target or null per end], as of the last round
  const endOf = (who) => {
    if (!retained.has(who)) retained.set(who, { link: undefined, tracks: new Map() });
    return retained.get(who);
  };
  const trackOf = (who, track) => {
    const tracks = endOf(who).tracks;
    if (!tracks.has(track)) tracks.set(track, {});
    return tracks.get(track);
  };

  // Everything retained that an end subscribed to `who` hears.
  function replay(who) {
    const out = [];
    const board = who.slice(0, who.lastIndexOf("/"));
    if (online.has(board)) out.push({ online: online.get(board) });
    const end = retained.get(who);
    if (!end) return out;
    if (end.link !== undefined) out.push({ theirLink: end.link });
    for (const track of [...end.tracks.keys()].sort((a, b) => a - b)) {
      const value = end.tracks.get(track);
      if (value.block !== undefined) out.push({ track, block: value.block });
      if (value.mast !== undefined) out.push({ track, mast: value.mast });
    }
    return out;
  }

  /**
   * One round: `publishes` per board (what its scan published), `changed` the
   * boards whose connection changed this round, `links` per board: its ends'
   * names and links after the scan. Returns the events per board.
   */
  function route(publishes, changed, links) {
    const messages = new Map(); // "<board>/<end>" -> [message], this round, in order
    const say = (who, message) => {
      if (!messages.has(who)) messages.set(who, []);
      messages.get(who).push(message);
    };
    const announcements = [];
    for (const name of names) {
      for (const p of publishes.get(name) || []) {
        if (p.pairing !== undefined) announcements.push(p.pairing);
        if (p.end === undefined) continue;
        const who = `${name}/${p.end}`;
        if (p.link !== undefined) {
          // An empty retained message clears the topic; subscribers still get it.
          endOf(who).link = p.link === "" ? undefined : p.link;
          say(who, { theirLink: p.link });
        } else if (p.block !== undefined) {
          const block = p.block === "ACTIVE" ? "occupied" : "clear";
          trackOf(who, p.track).block = block;
          say(who, { track: p.track, block });
        } else if (p.mast !== undefined) {
          trackOf(who, p.track).mast = p.mast;
          say(who, { track: p.track, mast: p.mast });
        }
      }
    }
    // A board that connected or went away: its Online (birth, or will).
    const onlineNow = new Map();
    for (const name of changed) {
      online.set(name, connected.get(name));
      onlineNow.set(name, connected.get(name));
    }
    const heard = new Map(names.map((name) => [name, []]));
    const next = new Map();
    for (const name of names) {
      const ends = links.get(name);
      const now = ends.map(({ end, link }) => target(link, name, end));
      const before = targets.get(name) || [];
      next.set(name, now);
      if (!connected.get(name)) continue;
      ends.forEach(({ end }, i) => {
        const who = now[i];
        if (who === null) return;
        const board = who.slice(0, who.lastIndexOf("/"));
        let list;
        if (changed.has(name) || before[i] !== who) list = replay(who);
        else list = [...(onlineNow.has(board) ? [{ online: onlineNow.get(board) }] : []), ...(messages.get(who) || [])];
        for (const m of list) heard.get(name).push({ end, ...m });
      });
      for (const pairing of announcements) heard.get(name).push({ pairing });
    }
    targets = next;
    return heard;
  }

  return { route };
}

// A multi-board case: one engine per board, in `boards` order, wired by the broker.
export function runMultiCase(data) {
  const names = Object.keys(data.boards);
  const engines = new Map();
  const connected = new Map();
  for (const name of names) {
    const start = { ...(data.start?.[name] || {}), board: name };
    engines.set(name, L.createEngine(data.boards[name], start));
    connected.set(name, start.broker !== "disconnected");
  }
  const broker = createBroker(names, connected);
  const endNames = (name) => (data.boards[name].logic?.ends || []).map((end) => end.name);
  let inbox = new Map(names.map((name) => [name, []]));
  const problems = [];
  let next = 0;
  for (const step of data.steps) {
    while (next <= step.at) {
      const at = next;
      const changed = new Set();
      const publishes = new Map();
      const outs = new Map();
      for (const name of names) {
        const engine = engines.get(name);
        for (const e of inbox.get(name)) engine.event(e);
        for (const e of at === step.at ? step.do?.[name] || [] : []) {
          engine.event(e);
          if (e.broker !== undefined) {
            const now = e.broker === "connected";
            if (now !== connected.get(name)) changed.add(name);
            connected.set(name, now);
          }
        }
      }
      for (const name of names) {
        const out = plain(engines.get(name).scan());
        outs.set(name, out);
        publishes.set(name, out.publishes);
      }
      const links = new Map(names.map((name) => {
        const state = engines.get(name).state();
        return [name, endNames(name).map((end) => ({ end, link: String(state.links[end] ?? "") }))];
      }));
      inbox = broker.route(publishes, changed, links);
      if (at === step.at) {
        for (const name of names) {
          check(problems, `${name}, scan ${at}`, step.expect?.[name], outs.get(name), plain(engines.get(name).state()));
        }
      }
      next += 1;
    }
  }
  return problems;
}
