// The Field Logic track plan's builder (docs/field-logic-plan-spec.md; work
// items TP 2 and TP 4). The plan is a drawing: track between grid points,
// turnouts, block breaks with their signals, blocks and their sensors, and
// what is beyond each end (`logic.plan`). This file turns it into ordinary
// Field Logic items, which the engine cannot tell from hand-made ones:
//
//   build(config) -> { blocks, masts, layers, resources, pairs, origins }
//     blocks     one per named block with sensors, holding its boundary sensors
//     masts      each plan signal, with the meaning of each aspect it shows
//     layers     one group per signal (its routes), one "Turnout locks" group,
//                then one group per signal with a move that can clash (its
//                moves, each taking its pieces of track)
//     resources  one per piece of track that two moves can clash on (pieces
//                of one block that the same moves use are one)
//     pairs      turnouts that move together: [{ turnout, with, same }]
//     origins    which part of the plan made each item
//   problems(config) -> [{ level: "error" | "warning", text, where }]
//     `where` is { view: "logic", part: PART } plus { at: [x, y] } or
//     { mast } or { block }.
//   trace(config) -> the plan worked out: regions, pieces, routes (for the editor)
//   look(config) -> for the editor: { problems, protects: [{ block, masts }] },
//     the signals that take track in each block, when two or more do.
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
  const TIME = /^\d+(\.\d+)?(ms|s)$/; // as the engine reads a time
  const MAX_SPAN = 200; // grid units in one segment, so a bad file cannot hang the page

  const TEXT = Object.freeze({
    locksGroup: "Turnout locks",
    movesGroup: (mast) => `${mast} moves`,
    piece: (block, n) => `${block} ${n}`,
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
    unwatched: (name) => `No signal on the drawing checks block "${name}", so a train standing there holds none of them at Stop. Put a signal before it, unless you only want to see it in JMRI.`,
    clashUnseen: (a, b) => `Signals "${a}" and "${b}" can let trains onto the same track, but no sensor of its own sees that track, so the board cannot tell when it is free. Give that track a block with a sensor of its own.`,
    clashWaiting: (mast, other) => `Signals "${mast}" and "${other}" can let trains onto the same track, so "${mast}" clears only for a train waiting at it, but nothing sees a train there. Give the block behind it a sensor.`,
    noApproach: (mast) => `Nothing sees a train waiting at signal "${mast}", so its turnouts are not locked as a train comes up to it. Give the block behind it a sensor.`,
    badTime: (name, what) => `Block "${name}" has a ${what} the board cannot read. Pick one from the list.`,
    pairTwice: (name) => `Turnout "${name}" moves with two others. A turnout can move with one other only: unpair one.`,
    pairMissing: (name, other) => `Turnout "${name}" moves with "${other}", which is not on the drawing. Pick another, or unpair it.`,
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
      const block = { name, region: id, own: sensors, sensors: [...sensors], topic: text(def.topic), release: text(def.release), approachLock: text(def.approachLock) };
      for (const [what, value] of [["free-after time", block.release], ["hold time", block.approachLock]]) {
        if (value && !TIME.test(value)) error(TEXT.badTime(name, what), { block: name });
      }
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
          let { turnouts, diverging, reach } = route;
          if (point?.kind === "turnout" && point.turnout) {
            const branch = prev === point.stem ? to : prev;
            const straight = branch === point.straight;
            const position = straight ? point.straightIs : (point.straightIs === "closed" ? "thrown" : "closed");
            const already = turnouts.find((t) => t.turnout === point.turnout);
            if (already && already.position !== position) continue; // cannot be set both ways
            if (!already) {
              turnouts = [...turnouts, { turnout: point.turnout, position }];
              // Which of the route's blocks the turnout is in.
              reach = { ...reach, [point.turnout]: route.regions.indexOf(region.get(edgeKey(prev, cur))) };
            }
            diverging = diverging || !straight;
          }
          const id = region.get(edgeKey(cur, to));
          walk(cur, to, {
            turnouts, diverging, reach,
            regions: route.regions.includes(id) ? route.regions : [...route.regions, id],
            edges: [...route.edges, `${cur}>${to}`],
            seen: new Set([...route.seen, `${cur}>${to}`]),
          });
        }
      };
      const first = `${signal.at}>${signal.facing}`;
      if (!barred.has(first)) {
        walk(signal.at, signal.facing, {
          turnouts: [], diverging: false, reach: {},
          regions: [region.get(edgeKey(signal.at, signal.facing))],
          edges: [first], seen: new Set([first]),
        });
      }
      if (failed.loop) error(TEXT.loopNone(signal.mast), { mast: signal.mast });
      else if (!signal.routes.length) error(TEXT.noRoute(signal.mast), { mast: signal.mast });
      // Two ways that no turnout tells apart.
      if (signal.routes.some((a, i) => signal.routes.slice(i + 1).some((b) => !apart(a, b)))) {
        error(TEXT.ambiguous(signal.mast), { mast: signal.mast });
      }
    }

    // Pieces: the track between turnouts, crossings, breaks and ends. A
    // crossing is a piece of its own, which both its lines use.
    const pieceOf = new Map(); // edge -> piece
    const pieceRegion = new Map(); // piece -> region
    const boundary = (node) => near.get(node).length !== 2 || breaks.has(node);
    for (const start of edges) {
      if (pieceOf.has(start)) continue;
      const id = `p${pieceRegion.size}`;
      pieceRegion.set(id, region.get(start));
      pieceOf.set(start, id);
      const queue = [start];
      while (queue.length) {
        for (const node of queue.pop().split("|")) {
          if (boundary(node)) continue;
          for (const other of near.get(node)) {
            const edge = edgeKey(node, other);
            if (pieceOf.has(edge)) continue;
            pieceOf.set(edge, id);
            queue.push(edge);
          }
        }
      }
    }
    for (const [node, point] of points) if (point.kind === "crossing") pieceRegion.set(`x${node}`, region.get(edgeKey(node, near.get(node)[0])));
    for (const signal of signals) {
      for (const route of signal.routes) {
        const parts = [];
        route.edges.forEach((edge, i) => {
          const [a, b] = edge.split(">");
          parts.push(pieceOf.get(edgeKey(a, b)));
          if (i + 1 < route.edges.length && points.get(b)?.kind === "crossing") parts.push(`x${b}`);
        });
        route.pieces = [...new Set(parts)];
      }
    }

    // Turnouts that move together: two joined by one diagonal, perhaps
    // through a crossing, between two parallel tracks (a crossover): each
    // reached by the other's diverging leg, their straight lines parallel and
    // apart, facing opposite ways. A point's `pairedWith` changes that:
    // another turnout, or none.
    const crossovers = [];
    for (const [node, point] of points) {
      if (point.kind !== "turnout" || !point.turnout) continue;
      let [prev, cur] = [node, near.get(node).find((o) => o !== point.stem && o !== point.straight)];
      const seen = new Set([node]);
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        const next = near.get(cur);
        const on = next.length === 2 ? next.find((o) => o !== prev)
          : points.get(cur)?.kind === "crossing" ? next.find((o) => o !== prev && angle(cur, prev, o) === 180) : null;
        if (!on) break;
        [prev, cur] = [cur, on];
      }
      const other = points.get(cur);
      if (!other || other.kind !== "turnout" || !other.turnout || other.turnout === point.turnout || cur < node) continue;
      if (prev === other.stem || prev === other.straight) continue;
      const [p, q, r, t] = [pointOf(node), pointOf(point.stem), pointOf(cur), pointOf(other.stem)];
      const [ax, ay, bx, by] = [p[0] - q[0], p[1] - q[1], r[0] - t[0], r[1] - t[1]];
      if (ax * by - ay * bx !== 0 || ax * bx + ay * by >= 0) continue;
      // On two lines, not one: a passing loop's turnouts are on the same line.
      if (ax * (r[1] - p[1]) - ay * (r[0] - p[0]) === 0) continue;
      crossovers.push([point.turnout, other.turnout]);
    }
    const straightIs = new Map([...points.values()].filter((pt) => pt.turnout).map((pt) => [pt.turnout, pt.straightIs]));
    const chosen = new Map();
    for (const set of settings.values()) {
      if (text(set.turnout) && Object.prototype.hasOwnProperty.call(set, "pairedWith")) chosen.set(text(set.turnout), text(set.pairedWith));
    }
    const pairs = [];
    const paired = new Map();
    const pair = (a, b) => {
      if (pairs.some((x) => (x.turnout === a && x.with === b) || (x.turnout === b && x.with === a))) return;
      for (const name of [a, b]) {
        if (paired.has(name)) error(TEXT.pairTwice(name));
        paired.set(name, true);
      }
      pairs.push({ turnout: a, with: b, same: straightIs.get(a) === straightIs.get(b) });
    };
    for (const [a, b] of crossovers) if (!chosen.has(a) && !chosen.has(b)) pair(a, b);
    for (const [a, b] of chosen) {
      if (!b) continue;
      if (!straightIs.has(b)) error(TEXT.pairMissing(a, b));
      else pair(a, b);
    }

    return { plan, found, error, warn, near, region, regionBlock, blocks, points, signals, barred, detected, pieceOf, pieceRegion, pairs };
  }

  // Whether two routes need a turnout set different ways, so cannot both be set.
  function apart(a, b) {
    return a.turnouts.some((t) => b.turnouts.some((u) => u.turnout === t.turnout && u.position !== t.position));
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
      signal.can = new Set(["stop", "restricting", ...Mss().INDICATIONS.filter((i) => shown.has(i.key)).map((i) => i.tag)]);
      signal.canDiverge = Mss().INDICATIONS.some((i) => shown.has(i.key) && i.diverging);
      // Your own rules can hold it at any of its aspects.
      for (const layer of list(logic.layers).filter(isObject)) {
        for (const rule of list(layer.rules)) {
          const aspect = rule?.then?.mast === signal.mast ? rule.then.aspect : undefined;
          if (aspect === undefined) continue;
          if (tags[aspect]) signal.can.add(tags[aspect]);
          if (diverging.has(aspect)) signal.canDiverge = true;
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
      // A row that waits for an aspect the next signal can never show never
      // applies: leave it out. Leaving out too much only gives Stop.
      const byMast = new Map(signals.map((s) => [s.mast, s]));
      const possible = (cond) => {
        const next = isObject(cond) && cond.board === undefined ? byMast.get(cond.mast) : null;
        if (!next || !next.can) return true;
        const wanted = [cond.is].flat();
        return wanted.some((tag) => (tag === "diverging" ? next.canDiverge : next.can.has(tag)));
      };
      const group = result.groups[0];
      const rules = group.rules.filter((rule) => [rule.trigger?.while, rule.trigger?.when, ...list(rule.checks)].every((cond) => !cond || possible(cond)));
      layers.push({ ...group, rules, starter: "plan-signals" });
      origin("group", name, { mast: signal.mast });
    }

    // Turnout locks, so points never move in front of a train:
    // - under it: a turnout in a detected block, while that block is occupied
    //   (each turnout can be unticked);
    // - approaching: a train waits behind a signal that is not at Stop, so its
    //   route's turnouts stay where they are;
    // - passed the signal: a train in a block on the route short of a turnout.
    // Each frees the turnout once the train has gone over it, so trains can
    // meet on a passing loop.
    const locks = [];
    const addLock = (turnout, block) => {
      if (!locks.some((l) => l.turnout === turnout && l.block === block)) locks.push({ turnout, block });
    };
    for (const [node, point] of points) {
      if (!point.turnout || !point.lock) continue;
      const block = regionBlock.get(model.region.get(edgeKey(node, point.stem)));
      if (block?.sensors.length) addLock(point.turnout, block.name);
    }
    const approach = [];
    for (const signal of signals) {
      const behind = regionBlock.get(signal.behind);
      const routes = signal.routes.filter((route) => route.turnouts.length && route.clear?.length);
      if (routes.length && !behind?.sensors.length) warn(TEXT.noApproach(signal.mast), { mast: signal.mast });
      for (const route of routes) {
        for (const t of route.turnouts) {
          for (const id of route.regions.slice(0, route.reach[t.turnout] ?? 0)) {
            const block = regionBlock.get(id);
            if (block?.sensors.length) addLock(t.turnout, block.name);
          }
        }
        if (!behind?.sensors.length) continue;
        approach.push({
          trigger: { while: { block: behind.name, is: "occupied" } },
          // Restricting lets a train past too, so only Stop frees them.
          checks: [...route.turnouts.map(turnoutIs), { not: { mast: signal.mast, is: "stop" } }],
          then: { lock: route.turnouts.map((t) => t.turnout) },
        });
      }
    }
    if (locks.length || approach.length) {
      const name = freeGroup(TEXT.locksGroup);
      const rows = locks.length ? S().build("lock-turnouts", STARTER_CONFIG, { name, rows: locks }).groups[0].rules : [];
      layers.push({ name, starter: "plan-locks", rules: [...rows, ...approach] });
      origin("group", name, {});
    }

    // Protection: two moves clash when they use the same piece of track, in
    // either direction or across a crossing, unless a turnout must be set
    // differently for each. Each piece two moves can clash on is taken, all
    // at once with the rest of a move's pieces, by every move that uses it.
    const moves = [];
    for (const signal of signals) for (const route of signal.routes) if (route.clear?.length) moves.push({ signal, route });
    const contested = new Map(); // piece -> [signal, signal]: the first two that clash on it
    moves.forEach((a, i) => {
      for (const b of moves.slice(i + 1)) {
        if (a.signal === b.signal || apart(a.route, b.route)) continue;
        for (const piece of a.route.pieces) {
          if (b.route.pieces.includes(piece) && !contested.has(piece)) contested.set(piece, [a.signal, b.signal]);
        }
      }
    });
    // Pieces of one block that the same moves use are taken as one.
    const resourceOf = new Map(); // piece -> resource
    const byKey = new Map();
    const unseen = new Set();
    for (const move of moves) {
      for (const piece of move.route.pieces) {
        if (!contested.has(piece) || resourceOf.has(piece)) continue;
        const id = model.pieceRegion.get(piece);
        if (!detected(id)) {
          const [a, b] = contested.get(piece);
          const key = `${a.mast}\u0000${b.mast}`;
          if (!unseen.has(key)) error(TEXT.clashUnseen(a.mast, b.mast), { mast: a.mast });
          unseen.add(key);
          continue;
        }
        const users = moves.filter((m) => m.route.pieces.includes(piece)).map((m) => moves.indexOf(m)).join(",");
        const key = `${id}|${users}`;
        if (!byKey.has(key)) byKey.set(key, { region: id, block: regionBlock.get(id), pieces: [] });
        byKey.get(key).pieces.push(piece);
        resourceOf.set(piece, byKey.get(key));
      }
    }
    const takenNames = new Set(list(logic.resources).filter(isObject).map((res) => String(res.name ?? "")));
    const perBlock = new Map();
    for (const res of byKey.values()) perBlock.set(res.region, [...(perBlock.get(res.region) || []), res]);
    for (const [, inBlock] of perBlock) {
      inBlock.forEach((res, i) => {
        const block = res.block;
        res.name = S().freeName(inBlock.length === 1 ? block.name : TEXT.piece(block.name, i + 1), takenNames);
        takenNames.add(res.name);
        const resource = { name: res.name, blocks: [block.name], release: { while: { block: block.name, is: "clear" }, for: block.release || "3s" } };
        if (block.approachLock) resource.approachLock = block.approachLock;
        resources.push(resource);
        origin("piece", res.name, { block: block.name });
      });
    }

    // A signal with a move that can clash clears only for a train waiting at
    // it, once that move has taken its pieces. Its other moves miss them.
    const protects = new Map(); // block -> Set of masts
    for (const signal of signals) {
      const mine = moves.filter((m) => m.signal === signal);
      const takes = (move) => [...new Set(move.route.pieces.map((piece) => resourceOf.get(piece)).filter(Boolean))];
      const clashes = mine.filter((move) => move.route.pieces.some((piece) => contested.has(piece)));
      if (!clashes.length) continue;
      if (!detected(signal.behind)) {
        const piece = clashes[0].route.pieces.find((p) => contested.has(p));
        const other = contested.get(piece).find((s) => s !== signal) || contested.get(piece)[0];
        error(TEXT.clashWaiting(signal.mast, other.mast), { mast: signal.mast });
        continue;
      }
      const waiting = regionBlock.get(signal.behind).name;
      // A train that has just come the other way, through the piece ahead of
      // the signal, is not taken for one waiting.
      const ahead = resourceOf.get(model.pieceOf.get(edgeKey(signal.at, signal.facing)));
      const back = `${signal.facing}>${signal.at}`;
      const guard = ahead && !model.barred.has(back) && moves.some((m) => m.route.edges.includes(back)) ? [ahead.name] : null;
      const rules = [];
      for (const move of mine) {
        const route = move.route;
        const aspect = signal.aspects[route.end?.kind === "plain" || route.next || route.end?.next
          ? (route.diverging ? "divergingClear" : "clear")
          : (route.diverging ? "divergingApproach" : "approach")];
        const turnouts = route.turnouts.map(turnoutIs);
        const taken = takes(move);
        if (!taken.length) {
          // A way that misses the track it can clash on: block signals only.
          rules.push({ trigger: { while: clearOf(route.clear[0]) }, checks: [...turnouts, ...route.clear.slice(1).map(clearOf)], then: { mast: signal.mast, aspect } });
          continue;
        }
        for (const res of taken) {
          if (!protects.has(res.block.name)) protects.set(res.block.name, new Set());
          protects.get(res.block.name).add(signal.mast);
        }
        const trigger = { while: { block: waiting, is: "occupied" }, for: "0.5s" };
        if (guard) trigger.leavingGuard = guard;
        rules.push({ trigger, checks: [...turnouts, ...route.clear.map(clearOf)], then: { mast: signal.mast, aspect, reserve: taken.map((res) => res.name) } });
      }
      const name = freeGroup(TEXT.movesGroup(signal.mast));
      layers.push({ name, starter: "plan-moves", rules });
      origin("group", name, { mast: signal.mast });
    }

    // A block no signal is concerned with: on no way past one, and not where a
    // train stands waiting at one.
    const watched = new Set(signals.flatMap((s) => [s.behind, ...s.routes.flatMap((route) => route.regions)]));
    for (const block of blocks) {
      if (block.sensors.length && !watched.has(block.region)) warn(TEXT.unwatched(block.name), { block: block.name });
    }

    // Each message once.
    const seen = new Set();
    const problems = model.found.filter((p) => !seen.has(p.text) && seen.add(p.text));
    const look = [...protects].filter(([, masts]) => masts.size > 1).map(([block, masts]) => ({ block, masts: [...masts] }));
    return { items: { blocks: built, masts, layers, resources, pairs: model.pairs, origins }, problems, protects: look };
  }

  /** The built items, from the plan. `config` is not changed. */
  const build = (config) => work(config).items;

  /** The plan's own problems. */
  const problems = (config) => work(config).problems;

  /** What the editor shows beside the drawing. */
  function look(config) {
    const done = work(config);
    return { problems: done.problems, protects: done.protects };
  }

  global.EsphomeMrPlanBuilder = { TEXT, PART, planOf, trace, build, problems, look };
})(typeof globalThis !== "undefined" ? globalThis : window);
