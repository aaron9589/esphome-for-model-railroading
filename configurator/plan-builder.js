// The Field Logic track plan's builder (docs/field-logic-plan-spec.md; work
// item TP 2). The plan is a drawing: track between grid points, turnouts,
// block breaks with their signals, blocks and their sensors, what is beyond
// each end, and sections for one train at a time (`logic.plan`). This file
// turns it into ordinary Field Logic items, which the engine cannot tell from
// hand-made ones:
//
//   build(config) -> { blocks, masts, layers, resources, origins }
//     blocks     one per named block with sensors, holding its boundary sensors
//     masts      each plan signal, with the meaning of each aspect it shows
//     layers     one group per signal (its routes), one "Turnout locks" group,
//                then one group per section (its entrances)
//     resources  one per section
//     origins    which part of the plan made each item
//   problems(config) -> [{ level: "error" | "warning", text, where }]
//     `where` is { view: "logic", part: PART } plus { at: [x, y] } or
//     { mast } or { block } or { section }.
//   trace(config) -> the plan worked out: regions, routes (for the editor)
//
// Nothing built is stored. Plain JS with no DOM; it needs generator.js,
// logic-yaml.js, logic-starters*.js and mss-builder.js loaded first.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const text = (value) => (typeof value === "string" ? value.trim() : "");
  const S = () => global.EsphomeMrLogicStarters;
  const M = () => global.EsphomeMr;
  const Mss = () => global.EsphomeMrMssBuilder;

  const PART = "logic-plan";
  const MAX_SPAN = 200; // grid units in one segment, so a bad file cannot hang the page

  const TEXT = Object.freeze({
    locksGroup: "Turnout locks",
    sectionGroup: (name) => `${name} entrances`,
    at: (p) => `the point at ${p[0]}, ${p[1]}`,
    badSegment: (n) => `Piece of track ${n} is not a straight line along the grid or at 45 degrees. Draw it again.`,
    diagonalCross: (p) => `Two lines cross between grid points near ${p[0]}, ${p[1]}. Move one so they cross at a grid point.`,
    sharp: (where) => `The track at ${where} bends too sharply for a train. Use 45 degree bends.`,
    badThree: (where) => `The three lines at ${where} do not make a turnout or a join. One line must lead on to both of the others.`,
    badCross: (where) => `The four lines at ${where} do not make a crossing. Two straight lines must pass through each other.`,
    tooMany: (where) => `More than four lines meet at ${where}. Move some of them.`,
    needTurnout: (where) => `Pick the turnout at ${where}, or choose no turnout for gauntlet track.`,
    notPoint: (where) => `A turnout is set at ${where}, but three lines do not meet there. Remove it.`,
    noTurnout: (name) => `The drawing uses turnout "${name}", which is not on the Turnouts page. Add it there, or pick another.`,
    needStraight: (where) => `Pick which line is straight at ${where}.`,
    badStraight: (where) => `The straight line picked at ${where} is not one of the turnout's two ways. Pick it again.`,
    badBreak: (where) => `The block break at ${where} is not on plain track. Put it between two lines, away from turnouts, crossings and ends.`,
    badFacing: (where) => `A signal at ${where} does not face along the track. Pick which way it faces.`,
    twoFacing: (where) => `Two signals at ${where} face the same way. Remove one.`,
    noMast: (name) => `The drawing uses signal "${name}", which is not on the Signal Masts page. Add it there, or pick another.`,
    needMast: (where) => `Pick the signal at ${where}.`,
    mastTwice: (name) => `Signal "${name}" is on the drawing twice. A signal faces one way at one place: pick another for one of them.`,
    badArrow: (n) => `Arrow ${n} is not on the track. Remove it and add it again.`,
    arrowClash: (n) => `Arrow ${n} points against another arrow on the same stretch of track. Remove one.`,
    blockNoName: "A block has no name. Name it.",
    blockTwice: (name) => `Two blocks are called "${name}". Give each its own name.`,
    blockOffTrack: (name) => `Block "${name}" is not on the track. Pick its track again.`,
    blockShared: (a, b) => `"${a}" and "${b}" name the same stretch of track. Put a block break between them, or remove one.`,
    sensorsNoBlock: (where) => `The block break at ${where} has a sensor, but a track beside it has no block. Name the block, or move the sensor.`,
    noSensor: (name) => `The drawing uses sensor "${name}", which is not on the Sensors page. Add it there, or pick another.`,
    badBeyond: (where) => `Say what is beyond the end of the track at ${where}.`,
    remoteSensorsOnly: (name) => `Block "${name}" includes another board's block. Pick that board's sensors instead, so two boards cannot hold each other occupied.`,
    noRoute: (mast) => `No train can pass signal "${mast}": there is no way on from it. Check the track, the arrows and which way it faces.`,
    ambiguous: (mast) => `Signal "${mast}" faces a join with no turnout that leads two ways, so it cannot tell which a train will take. Put an arrow on the track a train does not take.`,
    loopSelf: (mast) => `Signal "${mast}" is the only signal round a loop, so it would wait on itself. Add another signal on the loop.`,
    loopNone: (mast) => `The track past signal "${mast}" runs round a loop with no signal on it. Add one on the loop.`,
    unproved: (mast) => `Nothing detects a train on the way past signal "${mast}", so it can never be proved clear. Give a block ahead of it a sensor.`,
    needAspect: (mast, words) => `Pick what signal "${mast}" shows for ${words}.`,
    notAspect: (mast, aspect, words) => `Signal "${mast}" has no aspect called "${aspect}". Pick another for ${words}.`,
    aspectTwice: (mast, aspect, a, b) => `Signal "${mast}" shows "${aspect}" for both ${a} and ${b}, which mean different things to the signal behind. Pick a different aspect for one of them.`,
    undetected: (mast) => `Some track past signal "${mast}" has no sensor of its own, so a train standing there may not be seen.`,
    headOn: (a, b) => `Signals "${a}" and "${b}" can let two trains onto the same track at once. Make that track one train at a time.`,
    sectionNoName: "A one-train section has no name. Name it.",
    sectionTwice: (name) => `Two sections are called "${name}". Give each its own name.`,
    sectionNoBlocks: (name) => `Section "${name}" has no blocks. Select the track it covers.`,
    sectionBlock: (name, block) => `Section "${name}" includes "${block}", which is not a block with a sensor of its own. Pick another, or give it one.`,
    sectionBlockTwice: (block, a, b) => `Block "${block}" is in sections "${a}" and "${b}". A block can be in one section only.`,
    sectionNoEntrance: (name) => `Section "${name}" has no way in past a signal. Put a signal where trains enter it.`,
    sectionWaiting: (name, mast) => `Section "${name}": the track behind signal "${mast}" has no sensor, so the board cannot see a train waiting there. Give that block a sensor.`,
  });

  // ===== Geometry ============================================================

  const key = (p) => `${p[0]},${p[1]}`;
  const isPoint = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isInteger);
  const pointOf = (k) => k.split(",").map(Number);
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  // The unit steps along a straight segment, or null when it is not one.
  function steps(a, b) {
    if (!isPoint(a) || !isPoint(b)) return null;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const n = Math.max(Math.abs(dx), Math.abs(dy));
    if (!n || n > MAX_SPAN || (dx && dy && Math.abs(dx) !== Math.abs(dy))) return null;
    const out = [];
    for (let i = 0; i < n; i += 1) {
      out.push([[a[0] + Math.sign(dx) * i, a[1] + Math.sign(dy) * i], [a[0] + Math.sign(dx) * (i + 1), a[1] + Math.sign(dy) * (i + 1)]]);
    }
    return out;
  }

  // The angle at `at` between the lines to a and b, in degrees: 180 is straight.
  function angle(at, a, b) {
    const [p, q, r] = [pointOf(at), pointOf(a), pointOf(b)];
    const one = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const two = Math.atan2(r[1] - p[1], r[0] - p[0]);
    const diff = Math.abs(one - two) * (180 / Math.PI);
    return Math.round(diff > 180 ? 360 - diff : diff);
  }

  // ===== Reading the plan ====================================================

  function planOf(config) {
    return isObject(config?.logic?.plan) ? config.logic.plan : null;
  }

  /**
   * The plan worked out: the track graph, its blocks (regions between breaks),
   * one-way stretches and each signal's routes. Problems found on the way are
   * in `found`. Anything of the wrong shape is skipped and reported.
   */
  function trace(config) {
    const plan = planOf(config) || {};
    const found = [];
    const report = (level) => (words, where = {}) => found.push({ level, text: words, where: { view: "logic", part: PART, ...where } });
    const error = report("error");
    const warn = report("warning");
    const sensorNames = new Set(list(config?.blocks).map((b) => b.name));
    const turnoutNames = new Set(list(config?.points).map((p) => p.name));
    const mastNames = new Set(list(config?.signals?.masts).map((m) => m.name));

    // The graph: each grid point's neighbours.
    const near = new Map();
    const edges = new Set();
    const link = (a, b) => {
      if (!near.has(a)) near.set(a, []);
      if (!near.get(a).includes(b)) near.get(a).push(b);
    };
    list(plan.track).forEach((segment, i) => {
      const parts = steps(segment?.[0], segment?.[1]);
      if (!parts) {
        error(TEXT.badSegment(i + 1));
        return;
      }
      for (const [p, q] of parts) {
        const [a, b] = [key(p), key(q)];
        link(a, b);
        link(b, a);
        edges.add(edgeKey(a, b));
      }
    });
    // Two diagonals through the middle of one grid square.
    for (const edge of edges) {
      const [a, b] = edge.split("|").map(pointOf);
      if (a[0] === b[0] || a[1] === b[1]) continue;
      const other = edgeKey(key([a[0], b[1]]), key([b[0], a[1]]));
      if (edges.has(other) && edge < other) error(TEXT.diagonalCross(a), { at: a });
    }

    // Points: what each is, and which way a train can pass.
    const settings = new Map(list(plan.points).filter((p) => isObject(p) && isPoint(p.at)).map((p) => [key(p.at), p]));
    const points = new Map(); // node -> { kind, stem, straight, turnout, straightIs, lock }
    for (const [node, next] of near) {
      const at = pointOf(node);
      const where = TEXT.at(at);
      const connected = (a, b) => angle(node, a, b) >= (next.length === 4 ? 180 : 135);
      if (next.length === 2) {
        if (!connected(next[0], next[1])) error(TEXT.sharp(where), { at });
      } else if (next.length === 3) {
        const stems = next.filter((s) => next.filter((o) => o !== s && connected(s, o)).length === 2);
        const others = next.filter((o) => o !== stems[0]);
        if (stems.length !== 1 || connected(others[0], others[1])) {
          error(TEXT.badThree(where), { at });
          continue;
        }
        const set = settings.get(node);
        if (!set) {
          error(TEXT.needTurnout(where), { at });
          continue;
        }
        const turnout = text(set.turnout);
        const info = { kind: "turnout", stem: stems[0], turnout, lock: set.lock !== false };
        if (turnout) {
          if (!turnoutNames.has(turnout)) error(TEXT.noTurnout(turnout), { at });
          let straight = isPoint(set.straight) ? others.find((o) => sameWay(node, o, key(set.straight))) : null;
          if (isPoint(set.straight) && !straight) error(TEXT.badStraight(where), { at });
          if (!isPoint(set.straight)) straight = others.find((o) => angle(node, stems[0], o) === 180);
          if (!straight && !isPoint(set.straight)) error(TEXT.needStraight(where), { at });
          info.straight = straight || others[0];
          info.straightIs = set.straightIs === "thrown" ? "thrown" : "closed";
        }
        points.set(node, info);
      } else if (next.length === 4) {
        if (!next.every((a) => next.filter((b) => b !== a && connected(a, b)).length === 1)) error(TEXT.badCross(where), { at });
        points.set(node, { kind: "crossing" });
      } else if (next.length > 4) error(TEXT.tooMany(where), { at });
    }
    for (const [node, set] of settings) {
      if ((near.get(node)?.length ?? 0) !== 3) error(TEXT.notPoint(TEXT.at(set.at)), { at: pointOf(node) });
    }

    // Breaks and their signals.
    const breaks = new Map();
    const signals = []; // { mast, at, facing, def }
    const used = new Set();
    for (const brk of list(plan.breaks).filter(isObject)) {
      const at = isPoint(brk.at) ? brk.at : null;
      const node = at ? key(at) : "";
      if (!at || near.get(node)?.length !== 2) {
        error(TEXT.badBreak(at ? TEXT.at(at) : "an unknown place"), at ? { at } : {});
        continue;
      }
      const entry = breaks.get(node) || { sensors: [] };
      entry.sensors.push(...list(brk.sensors));
      breaks.set(node, entry);
      for (const def of list(brk.signals).filter(isObject)) {
        const mast = text(def.mast);
        const facing = isPoint(def.facing) ? near.get(node).find((n) => sameWay(node, n, key(def.facing))) : null;
        if (!mast) error(TEXT.needMast(TEXT.at(at)), { at });
        else if (!mastNames.has(mast)) error(TEXT.noMast(mast), { at, mast });
        if (!facing) error(TEXT.badFacing(TEXT.at(at)), { at });
        else if (signals.some((s) => s.at === node && s.facing === facing)) error(TEXT.twoFacing(TEXT.at(at)), { at });
        else if (mast && used.has(mast)) error(TEXT.mastTwice(mast), { at, mast });
        else if (mast && mastNames.has(mast)) {
          used.add(mast);
          signals.push({ mast, at: node, facing, def });
        }
      }
    }

    // Regions: the track between breaks. Each edge is in one.
    const region = new Map();
    let regions = 0;
    for (const start of edges) {
      if (region.has(start)) continue;
      const id = regions;
      regions += 1;
      const queue = [start];
      region.set(start, id);
      while (queue.length) {
        for (const node of queue.pop().split("|")) {
          if (breaks.has(node)) continue;
          for (const other of near.get(node)) {
            const edge = edgeKey(node, other);
            if (region.has(edge)) continue;
            region.set(edge, id);
            queue.push(edge);
          }
        }
      }
    }

    // One way: an arrow covers its stretch, up to a turnout, crossing or end.
    const barred = new Set(); // "a>b": no train runs from a to b
    const way = new Set(); // "a>b": the arrow's own direction
    list(plan.arrows).forEach((arrow, i) => {
      const parts = steps(arrow?.from, arrow?.to);
      const [a, b] = parts ? [key(parts[0][0]), key(parts[0][1])] : ["", ""];
      if (!parts || !edges.has(edgeKey(a, b))) {
        error(TEXT.badArrow(i + 1));
        return;
      }
      const run = [[a, b]];
      const seen = new Set([edgeKey(a, b)]);
      for (const [from, to, forward] of [[a, b, true], [b, a, false]]) {
        let [prev, cur] = [from, to];
        while (near.get(cur).length === 2) {
          const next = near.get(cur).find((n) => n !== prev);
          if (seen.has(edgeKey(cur, next))) break;
          seen.add(edgeKey(cur, next));
          run.push(forward ? [cur, next] : [next, cur]);
          [prev, cur] = [cur, next];
        }
      }
      if (run.some(([p, q]) => way.has(`${q}>${p}`))) {
        error(TEXT.arrowClash(i + 1));
        return;
      }
      for (const [p, q] of run) {
        way.add(`${p}>${q}`);
        barred.add(`${q}>${p}`);
      }
    });

    // Blocks: a name and sensors on one region.
    const blocks = [];
    const regionBlock = new Map();
    for (const def of list(plan.blocks).filter(isObject)) {
      const name = text(def.name);
      if (!name) {
        error(TEXT.blockNoName);
        continue;
      }
      if (blocks.some((b) => b.name === name)) {
        error(TEXT.blockTwice(name), { block: name });
        continue;
      }
      const parts = steps(def.at?.[0], def.at?.[1]);
      const id = parts ? region.get(edgeKey(key(parts[0][0]), key(parts[0][1]))) : undefined;
      if (id === undefined) {
        error(TEXT.blockOffTrack(name), { block: name });
        continue;
      }
      if (regionBlock.has(id)) {
        error(TEXT.blockShared(regionBlock.get(id).name, name), { block: name });
        continue;
      }
      const sensors = [];
      for (const member of list(def.sensors)) {
        if (typeof member === "string") {
          if (!sensorNames.has(member)) error(TEXT.noSensor(member), { block: name });
          sensors.push(member);
        } else if (isObject(member) && member.board && member.sensor !== undefined) sensors.push({ ...member });
        else if (isObject(member) && member.block !== undefined) error(TEXT.remoteSensorsOnly(name), { block: name });
      }
      const block = { name, region: id, own: sensors, sensors: [...sensors], topic: text(def.topic) };
      blocks.push(block);
      regionBlock.set(id, block);
    }
    // A break's sensor holds the blocks on both sides.
    for (const [node, brk] of breaks) {
      if (!brk.sensors.length) continue;
      const at = pointOf(node);
      for (const name of brk.sensors) if (typeof name === "string" && !sensorNames.has(name)) error(TEXT.noSensor(name), { at });
      for (const other of near.get(node)) {
        const block = regionBlock.get(region.get(edgeKey(node, other)));
        if (!block) {
          error(TEXT.sensorsNoBlock(TEXT.at(at)), { at });
          continue;
        }
        for (const member of brk.sensors) {
          if (!block.sensors.some((m) => JSON.stringify(m) === JSON.stringify(member))) block.sensors.push(member);
        }
      }
    }
    // Detected: a sensor of its own sees a train anywhere in it. A boundary
    // sensor alone is checked too, but it only sees its own spot.
    const detected = (id) => !!regionBlock.get(id)?.own.length;

    const ends = new Map(list(plan.ends).filter((e) => isObject(e) && isPoint(e.at)).map((e) => [key(e.at), e.beyond]));
    const endAt = (node) => {
      const beyond = ends.get(node);
      if (beyond === undefined || beyond === "signalled") return { kind: "signalled" };
      if (beyond === "plain") return { kind: "plain" };
      if (isObject(beyond) && text(beyond.board)) {
        return {
          kind: "board",
          next: text(beyond.mast) ? { board: beyond.board, mast: beyond.mast } : "",
          blocks: list(beyond.blocks).filter((b) => text(b)).map((block) => ({ board: beyond.board, block })),
        };
      }
      error(TEXT.badBeyond(TEXT.at(pointOf(node))), { at: pointOf(node) });
      return { kind: "signalled" };
    };

    // Routes: follow the track past each signal to the next signal facing the
    // same way, or to an end.
    const signalAt = (node, facing) => signals.find((s) => s.at === node && s.facing === facing);
    for (const signal of signals) {
      signal.routes = [];
      signal.behind = region.get(edgeKey(signal.at, near.get(signal.at).find((n) => n !== signal.facing)));
      const failed = { loop: false };
      const walk = (prev, cur, route) => {
        const done = (end) => signal.routes.push({ ...route, ...end });
        const next = near.get(cur);
        if (next.length === 1) {
          done({ end: endAt(cur) });
          return;
        }
        const point = points.get(cur);
        for (const to of next) {
          if (to === prev || angle(cur, prev, to) < (next.length === 4 ? 180 : 135) || barred.has(`${cur}>${to}`)) continue;
          const reached = breaks.has(cur) ? signalAt(cur, to) : null;
          if (reached) {
            if (reached === signal) error(TEXT.loopSelf(signal.mast), { mast: signal.mast });
            else done({ next: reached.mast });
            continue;
          }
          if (route.seen.has(`${cur}>${to}`)) {
            failed.loop = true;
            continue;
          }
          let { turnouts, diverging } = route;
          if (point?.kind === "turnout" && point.turnout) {
            const branch = prev === point.stem ? to : prev;
            const straight = branch === point.straight;
            const position = straight ? point.straightIs : (point.straightIs === "closed" ? "thrown" : "closed");
            const already = turnouts.find((t) => t.turnout === point.turnout);
            if (already && already.position !== position) continue; // cannot be set both ways
            if (!already) turnouts = [...turnouts, { turnout: point.turnout, position }];
            diverging = diverging || !straight;
          }
          const id = region.get(edgeKey(cur, to));
          walk(cur, to, {
            turnouts, diverging,
            regions: route.regions.includes(id) ? route.regions : [...route.regions, id],
            edges: [...route.edges, `${cur}>${to}`],
            seen: new Set([...route.seen, `${cur}>${to}`]),
          });
        }
      };
      const first = `${signal.at}>${signal.facing}`;
      if (!barred.has(first)) {
        walk(signal.at, signal.facing, {
          turnouts: [], diverging: false,
          regions: [region.get(edgeKey(signal.at, signal.facing))],
          edges: [first], seen: new Set([first]),
        });
      }
      if (failed.loop) error(TEXT.loopNone(signal.mast), { mast: signal.mast });
      else if (!signal.routes.length) error(TEXT.noRoute(signal.mast), { mast: signal.mast });
      // Two ways that no turnout tells apart.
      const apart = (a, b) => a.turnouts.some((t) => b.turnouts.some((u) => u.turnout === t.turnout && u.position !== t.position));
      if (signal.routes.some((a, i) => signal.routes.slice(i + 1).some((b) => !apart(a, b)))) {
        error(TEXT.ambiguous(signal.mast), { mast: signal.mast });
      }
    }

    return { plan, found, error, warn, near, region, regionBlock, blocks, points, signals, barred, detected };
  }

  // Whether `other` lies in the same direction from `node` as the neighbour does.
  function sameWay(node, neighbour, other) {
    return other !== node && angle(node, neighbour, other) === 0;
  }

  // ===== Building ============================================================

  // The indication each aspect of a route rule is for.
  const MAIN = Object.freeze({ clear: "clear", approach: "approach", advance: "advance", diverging: "approachDiverging" });
  const DIVERGING = Object.freeze({ clear: "divergingClear", approach: "divergingApproach", advance: "divergingClear", diverging: "divergingClear" });

  // Which indication a rule's `slot` shows on this route.
  function indication(plan, route, slot) {
    if (route.diverging) return DIVERGING[slot];
    if (slot === "advance" && plan.advanceApproach !== true) return "clear";
    if (slot === "diverging" && plan.approachDiverging !== true) return "approach";
    return MAIN[slot];
  }

  // The indications a route's rules show.
  function slotsOf(route) {
    if (route.end?.kind === "plain") return ["clear"];
    if (route.end && !(route.end.kind === "board" && route.end.next)) return ["approach"];
    return ["clear", "approach", "advance", "diverging"];
  }

  function aspectOf(config, signal, name) {
    const given = signal.def.aspects?.[name];
    return text(given) ? given : Mss().prefill(config, signal.mast, name);
  }

  const STARTER_CONFIG = Object.freeze({ signals: { masts: [] }, logic: {} });
  const clearOf = (ref) => (typeof ref === "string" ? { block: ref, is: "clear" } : { ...ref, is: "clear" });
  const turnoutIs = (t) => ({ turnout: t.turnout, is: t.position });

  function work(config) {
    const model = trace(config);
    const { plan, error, warn, regionBlock, detected, signals, blocks, points } = model;
    const logic = isObject(config?.logic) ? config.logic : {};
    const layers = [];
    const resources = [];
    const origins = [];
    const taken = new Set(list(logic.layers).filter(isObject).map((g) => String(g.name ?? "")));
    const freeGroup = (base) => {
      const name = S().freeName(base, taken);
      taken.add(name);
      return name;
    };
    const origin = (kind, name, where) => origins.push({ kind, name, where: { view: "logic", part: PART, ...where }, words: "the track plan" });

    const built = blocks.filter((b) => b.sensors.length).map((b) => {
      origin("block", b.name, { block: b.name });
      return { name: b.name, topic: b.topic || M().topicFor("block", b.name), sensors: b.sensors };
    });

    // Each signal's routes: what must be proved, and what it shows.
    const masts = [];
    for (const signal of signals) {
      const shown = new Set(["stop"]);
      for (const route of signal.routes) {
        const local = route.regions.filter((id) => regionBlock.get(id)?.sensors.length).map((id) => regionBlock.get(id).name);
        route.clear = [...local, ...(route.end?.blocks || [])];
        if (!route.clear.length) error(TEXT.unproved(signal.mast), { mast: signal.mast });
        for (const slot of slotsOf(route)) shown.add(indication(plan, route, slot));
      }
      if (signal.routes.some((route) => route.regions.some((id) => !detected(id)))) warn(TEXT.undetected(signal.mast), { mast: signal.mast });

      // The meaning of each aspect it shows.
      const mast = list(config?.signals?.masts).find((m) => m.name === signal.mast);
      const labels = list(mast?.aspects).map((a) => String(a.label ?? ""));
      const own = list(logic.masts).filter(isObject).find((e) => e.virtual !== true && e.mast === signal.mast);
      const tags = { ...(isObject(own?.tags) ? own.tags : {}) };
      const diverging = new Set(list(own?.diverging));
      const meant = new Map(); // aspect -> indication
      signal.aspects = {};
      for (const i of Mss().INDICATIONS) {
        if (!shown.has(i.key)) continue;
        const aspect = aspectOf(config, signal, i.key);
        const words = Mss().TEXT.indications[i.key];
        signal.aspects[i.key] = aspect;
        if (!aspect) {
          error(TEXT.needAspect(signal.mast, words), { mast: signal.mast });
          continue;
        }
        if (!labels.includes(aspect)) {
          error(TEXT.notAspect(signal.mast, aspect, words), { mast: signal.mast });
          continue;
        }
        const before = meant.get(aspect);
        if (before && (before.tag !== i.tag || !!before.diverging !== !!i.diverging)) {
          error(TEXT.aspectTwice(signal.mast, aspect, Mss().TEXT.indications[before.key], words), { mast: signal.mast });
        } else if (!before) {
          meant.set(aspect, i);
          tags[aspect] = i.tag;
          if (i.diverging) diverging.add(aspect);
          else diverging.delete(aspect);
        }
      }
      const entry = { mast: signal.mast, tags };
      if (diverging.size) entry.diverging = [...diverging];
      if (signal.aspects.stop) entry.stopAspect = signal.aspects.stop;
      const lit = text(signal.def.approachLight) || text(own?.approachLight);
      if (lit) entry.approachLight = lit;
      masts.push(entry);
      origin("mast", signal.mast, { mast: signal.mast });
    }

    // One group per signal: a row per route.
    for (const signal of signals) {
      const rows = signal.routes.filter((route) => route.clear.length).map((route) => {
        const aspects = Object.fromEntries(["clear", "approach", "advance", "diverging"].map((slot) => [slot, signal.aspects[indication(plan, route, slot)] || ""]));
        const plain = route.end?.kind === "plain";
        return {
          turnouts: route.turnouts, blocks: route.clear, diverging: route.diverging,
          follow: !plain, aspect: plain ? aspects.clear : "",
          next: route.next || route.end?.next || "", aspects,
        };
      });
      if (!rows.length) continue;
      const name = freeGroup(signal.mast);
      const result = S().build("route-signal", STARTER_CONFIG, {
        name, mast: signal.mast, trigger: "", routeLocking: false,
        useAdvance: plan.advanceApproach === true, useDiverging: plan.approachDiverging === true, rows,
      });
      layers.push({ ...result.groups[0], starter: "plan-signals" });
      origin("group", name, { mast: signal.mast });
    }

    // Turnouts inside a detected block lock while it is occupied.
    const locks = [];
    for (const [node, point] of points) {
      if (!point.turnout || !point.lock) continue;
      const block = regionBlock.get(model.region.get(edgeKey(node, point.stem)));
      if (!block?.sensors.length || locks.some((l) => l.turnout === point.turnout && l.block === block.name)) continue;
      locks.push({ turnout: point.turnout, block: block.name });
    }
    if (locks.length) {
      const name = freeGroup(TEXT.locksGroup);
      const result = S().build("lock-turnouts", STARTER_CONFIG, { name, rows: locks });
      layers.push({ ...result.groups[0], starter: "plan-locks" });
      origin("group", name, {});
    }

    // One train at a time.
    const covered = []; // { regions: Set, entrances: Set }
    const sectionNames = new Set(list(logic.resources).filter(isObject).map((res) => String(res.name ?? "")));
    const claimed = new Map(); // block -> section
    for (const def of list(plan.sections).filter(isObject)) {
      const name = text(def.name);
      const where = { section: name };
      if (!name) {
        error(TEXT.sectionNoName);
        continue;
      }
      if (sectionNames.has(name)) {
        error(TEXT.sectionTwice(name), where);
        continue;
      }
      sectionNames.add(name);
      const inside = [];
      for (const blockName of list(def.blocks)) {
        const block = blocks.find((b) => b.name === blockName && b.own.length);
        if (!block) error(TEXT.sectionBlock(name, blockName), where);
        else if (claimed.has(block.name)) error(TEXT.sectionBlockTwice(block.name, claimed.get(block.name), name), where);
        else {
          claimed.set(block.name, name);
          inside.push(block);
        }
      }
      if (!inside.length) {
        error(TEXT.sectionNoBlocks(name), where);
        continue;
      }
      const regions = new Set(inside.map((b) => b.region));
      const entrances = signals.filter((s) => !regions.has(s.behind) && s.routes.some((route) => route.regions.some((id) => regions.has(id))));
      if (!entrances.length) {
        error(TEXT.sectionNoEntrance(name), where);
        continue;
      }
      const rules = [];
      for (const signal of entrances) {
        if (!detected(signal.behind)) {
          error(TEXT.sectionWaiting(name, signal.mast), { ...where, mast: signal.mast });
          continue;
        }
        const waiting = regionBlock.get(signal.behind).name;
        // A train can run out of the section into the waiting block unless an
        // arrow on the way past the signal forbids it.
        const leaves = !model.barred.has(`${signal.facing}>${signal.at}`);
        for (const route of signal.routes.filter((r) => r.clear.length)) {
          const enters = route.regions.some((id) => regions.has(id));
          const aspect = signal.aspects[route.end?.kind === "plain" || route.next || route.end?.next
            ? (route.diverging ? "divergingClear" : "clear")
            : (route.diverging ? "divergingApproach" : "approach")];
          const turnouts = route.turnouts.map(turnoutIs);
          if (!enters) {
            // A way that misses the section: the section has no say over it.
            rules.push({ trigger: { while: clearOf(route.clear[0]) }, checks: [...turnouts, ...route.clear.slice(1).map(clearOf)], then: { mast: signal.mast, aspect } });
            continue;
          }
          const trigger = { while: { block: waiting, is: "occupied" }, for: "0.5s" };
          if (leaves) trigger.leavingGuard = true;
          const then = { mast: signal.mast, aspect, reserve: name };
          if (route.turnouts.length) then.lock = route.turnouts.map((t) => t.turnout);
          rules.push({ trigger, checks: [...turnouts, ...route.clear.map(clearOf)], then });
        }
      }
      const resource = {
        name,
        blocks: inside.map((b) => b.name),
        release: { while: { all: inside.map((b) => clearOf(b.name)) }, for: text(def.release) || "3s" },
      };
      if (text(def.approachLock)) resource.approachLock = def.approachLock;
      resources.push(resource);
      origin("section", name, where);
      if (rules.length) {
        const group = freeGroup(TEXT.sectionGroup(name));
        layers.push({ name: group, starter: "plan-section", rules });
        origin("group", group, where);
      }
      covered.push({ regions, entrances: new Set(entrances) });
    }

    // Two signals that can put trains on the same track at once: meeting
    // head-on, or crossing, with no section to take.
    const nodesOf = (route) => route.edges.map((edge) => edge.split(">"));
    const clash = (a, b) => {
      for (const [p, q] of nodesOf(a)) {
        for (const [r, s] of nodesOf(b)) {
          if (p === s && q === r) return true;
          // The same crossing, by different lines.
          if (q === s && points.get(q)?.kind === "crossing" && p !== r && angle(q, p, r) !== 180) return true;
        }
      }
      return false;
    };
    signals.forEach((a, i) => {
      for (const b of signals.slice(i + 1)) {
        const open = a.routes.some((ra) => b.routes.some((rb) => {
          // Safe when both ways must take the same section.
          const takes = (route, c) => route.regions.some((id) => c.regions.has(id));
          return clash(ra, rb) && !covered.some((c) => c.entrances.has(a) && c.entrances.has(b) && takes(ra, c) && takes(rb, c));
        }));
        if (open) warn(TEXT.headOn(a.mast, b.mast), { mast: a.mast });
      }
    });

    // Each message once.
    const seen = new Set();
    const problems = model.found.filter((p) => !seen.has(p.text) && seen.add(p.text));
    return { items: { blocks: built, masts, layers, resources, origins }, problems };
  }

  /** The built items, from the plan. `config` is not changed. */
  const build = (config) => work(config).items;

  /** The plan's own problems. */
  const problems = (config) => work(config).problems;

  global.EsphomeMrPlanBuilder = { TEXT, PART, planOf, trace, build, problems };
})(typeof globalThis !== "undefined" ? globalThis : window);
