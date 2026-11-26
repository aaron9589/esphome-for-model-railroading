// Changes to the Field Logic track plan (docs/field-logic-plan-spec.md; work
// item TP 3), as the grid editor makes them. Each takes the board, changes
// `logic.plan` and tidies what the change left behind. plan-builder.js turns
// the result into blocks, signal rules and the rest. Plain JS with no DOM.
//
// Points are grid points [x, y], y down the page. A "piece" of track is one
// grid step between two neighbouring points.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const isPoint = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isInteger);
  const MAX_SPAN = 200; // as plan-builder.js

  const key = (p) => `${p[0]},${p[1]}`;
  const pointOf = (k) => k.split(",").map(Number);
  const pieceKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const same = (a, b) => isPoint(a) && isPoint(b) && a[0] === b[0] && a[1] === b[1];

  // ===== Reading ============================================================

  // The unit steps along a straight segment, or none when it is not one.
  function steps(a, b) {
    if (!isPoint(a) || !isPoint(b)) return [];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const n = Math.max(Math.abs(dx), Math.abs(dy));
    if (!n || n > MAX_SPAN || (dx && dy && Math.abs(dx) !== Math.abs(dy))) return [];
    const at = (i) => [a[0] + Math.sign(dx) * i, a[1] + Math.sign(dy) * i];
    return Array.from({ length: n }, (_, i) => [at(i), at(i + 1)]);
  }

  /**
   * The drawing as a graph: { pieces: Set of "a|b", near: Map of point ->
   * neighbouring points }, all as "x,y" strings. Segments that are not along
   * the grid or at 45 degrees are left out (the builder reports them).
   */
  function graph(plan) {
    const pieces = new Set();
    const near = new Map();
    for (const segment of list(plan?.track)) {
      for (const [p, q] of steps(segment?.[0], segment?.[1])) {
        const [a, b] = [key(p), key(q)];
        if (pieces.has(pieceKey(a, b))) continue;
        pieces.add(pieceKey(a, b));
        for (const [from, to] of [[a, b], [b, a]]) {
          if (!near.has(from)) near.set(from, []);
          near.get(from).push(to);
        }
      }
    }
    return { pieces, near };
  }

  const degree = (g, p) => g.near.get(key(p))?.length ?? 0;

  /** What is at a point: "none", "end", "plain", "turnout", "crossing" or "crowded". */
  function kindAt(config, at) {
    const n = degree(graph(config?.logic?.plan), at);
    return ["none", "end", "plain", "turnout", "crossing"][n] || "crowded";
  }

  /** The neighbouring points of a point, in reading order. */
  function neighbours(config, at) {
    return (graph(config?.logic?.plan).near.get(key(at)) || []).map(pointOf).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  }

  // The pieces from one point to the next along `a` -> `b`, both ways, up to a
  // turnout, crossing or end: what one direction arrow covers. Each is [from,
  // to] in the a -> b sense.
  function stretchOf(g, a, b) {
    const run = [[a, b]];
    const seen = new Set([pieceKey(a, b)]);
    for (const [from, to, forward] of [[a, b, true], [b, a, false]]) {
      let [prev, cur] = [from, to];
      while (g.near.get(cur).length === 2) {
        const next = g.near.get(cur).find((n) => n !== prev);
        if (seen.has(pieceKey(cur, next))) break;
        seen.add(pieceKey(cur, next));
        run.push(forward ? [cur, next] : [next, cur]);
        [prev, cur] = [cur, next];
      }
    }
    return run;
  }

  // The pieces joined to `start` without passing a block break.
  function regionOf(g, breaks, start) {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      for (const node of queue.pop().split("|")) {
        if (breaks.has(node)) continue;
        for (const other of g.near.get(node) || []) {
          const piece = pieceKey(node, other);
          if (seen.has(piece)) continue;
          seen.add(piece);
          queue.push(piece);
        }
      }
    }
    return seen;
  }

  const breakNodes = (plan) => new Set(list(plan?.breaks).filter((b) => isObject(b) && isPoint(b.at)).map((b) => key(b.at)));

  // The first piece of a segment such as a block's `at`, as a piece key.
  function anchorOf(g, at) {
    const first = steps(at?.[0], at?.[1])[0];
    if (!first) return null;
    const piece = pieceKey(key(first[0]), key(first[1]));
    return g.pieces.has(piece) ? piece : null;
  }

  /** The pieces in the same block as the piece a-b, as [[point, point]]. */
  function stretchOfBlock(config, a, b) {
    const plan = config?.logic?.plan;
    const g = graph(plan);
    const start = pieceKey(key(a), key(b));
    if (!g.pieces.has(start)) return [];
    return [...regionOf(g, breakNodes(plan), start)].map((piece) => piece.split("|").map(pointOf));
  }

  /** The block named on the track at the piece a-b, or null. */
  function blockAt(config, a, b) {
    const plan = config?.logic?.plan;
    const g = graph(plan);
    const start = pieceKey(key(a), key(b));
    if (!g.pieces.has(start)) return null;
    const region = regionOf(g, breakNodes(plan), start);
    return list(plan.blocks).find((block) => isObject(block) && region.has(anchorOf(g, block.at))) || null;
  }

  /** Which way trains run on the piece a-b: null (both), or the point they head for. */
  function directionAt(config, a, b) {
    const plan = config?.logic?.plan;
    const g = graph(plan);
    const [p, q] = [key(a), key(b)];
    if (!g.pieces.has(pieceKey(p, q))) return null;
    const run = new Set(stretchOf(g, p, q).map(([from, to]) => `${from}>${to}`));
    for (const arrow of list(plan.arrows)) {
      const first = steps(arrow?.from, arrow?.to)[0];
      if (!first) continue;
      const [from, to] = [key(first[0]), key(first[1])];
      if (run.has(`${from}>${to}`)) return b;
      if (run.has(`${to}>${from}`)) return a;
    }
    return null;
  }

  /**
   * The line a drag from `a` to `b` draws, as its corner points: straight when
   * it can be, otherwise a 45 degree part and a straight part. The bend leaves
   * or joins existing track on the 45 degree part, as a turnout does.
   */
  function path(config, a, b) {
    if (!isPoint(a) || !isPoint(b) || same(a, b)) return [];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const slant = Math.min(Math.abs(dx), Math.abs(dy));
    if (!slant || Math.abs(dx) === Math.abs(dy)) return [a, b];
    const g = graph(config?.logic?.plan);
    const diagonalFirst = degree(g, a) > 0;
    const step = [Math.sign(dx) * slant, Math.sign(dy) * slant];
    const corner = diagonalFirst ? [a[0] + step[0], a[1] + step[1]] : [b[0] - step[0], b[1] - step[1]];
    return [a, corner, b];
  }

  const along = (corners) => corners.slice(1).flatMap((to, i) => steps(corners[i], to));

  // ===== Changing ===========================================================

  const KEYS = ["track", "points", "arrows", "breaks", "blocks", "ends"];

  function planFor(config) {
    const logic = config.logic || (config.logic = {});
    if (!isObject(logic.plan)) logic.plan = {};
    const plan = logic.plan;
    for (const name of KEYS) if (!Array.isArray(plan[name])) plan[name] = [];
    // One train at a time (TP 2) is gone: the drawing protects the track itself.
    delete plan.sections;
    return plan;
  }

  // The pieces as as few straight segments as will hold them.
  function segments(pieces) {
    const out = [];
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const has = (p) => pieces.has(pieceKey(key(p), key([p[0] + dx, p[1] + dy])));
      const starts = [...pieces]
        .map((piece) => piece.split("|").map(pointOf))
        .map(([p, q]) => (q[0] - p[0] === dx && q[1] - p[1] === dy ? p : p[0] - q[0] === dx && p[1] - q[1] === dy ? q : null))
        .filter((p) => p && !has([p[0] - dx, p[1] - dy]))
        .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      for (const start of starts) {
        let n = 1;
        while (n < MAX_SPAN && has([start[0] + dx * n, start[1] + dy * n])) n += 1;
        out.push([start, [start[0] + dx * n, start[1] + dy * n]]);
      }
    }
    return out;
  }

  const unit = (piece) => piece.split("|").map(pointOf);

  /**
   * Make one change to the plan, then keep the rest with the track it is on:
   * blocks and arrows move to a piece that is left, and settings for a point
   * that is no longer what they were for are dropped. An empty plan is removed.
   */
  function change(config, edit) {
    const plan = planFor(config);
    const before = graph(plan);
    const cuts = breakNodes(plan);
    const blockPieces = new Map(plan.blocks.filter(isObject).map((block) => {
      const anchor = anchorOf(before, block.at);
      return [block, anchor ? [anchor, ...regionOf(before, cuts, anchor)] : []];
    }));
    const arrowPieces = new Map(plan.arrows.filter(isObject).map((arrow) => {
      const first = steps(arrow.from, arrow.to)[0];
      const [a, b] = first ? [key(first[0]), key(first[1])] : [];
      return [arrow, a && before.pieces.has(pieceKey(a, b)) ? stretchOf(before, a, b) : []];
    }));

    edit(plan);

    const g = graph(plan);
    const n = (at) => (isPoint(at) ? degree(g, at) : 0);
    plan.points = plan.points.filter((p) => isObject(p) && n(p.at) === 3);
    plan.breaks = plan.breaks.filter((b) => isObject(b) && n(b.at) >= 2);
    plan.ends = plan.ends.filter((e) => isObject(e) && n(e.at) === 1);
    plan.blocks = plan.blocks.filter((block) => {
      if (!isObject(block)) return false;
      if (anchorOf(g, block.at)) return true;
      const left = (blockPieces.get(block) || []).find((piece) => g.pieces.has(piece));
      if (left) block.at = unit(left);
      return !!left;
    });
    plan.arrows = plan.arrows.filter((arrow) => {
      if (!isObject(arrow)) return false;
      const first = steps(arrow.from, arrow.to)[0];
      if (first && g.pieces.has(pieceKey(key(first[0]), key(first[1])))) return true;
      const left = (arrowPieces.get(arrow) || []).find(([a, b]) => g.pieces.has(pieceKey(a, b)));
      if (!left) return false;
      arrow.from = pointOf(left[0]);
      arrow.to = pointOf(left[1]);
      return true;
    });
    if (KEYS.every((name) => !plan[name].length)) delete config.logic.plan;
  }

  /** Draw track from `a` to `b`. */
  function draw(config, a, b) {
    const added = along(path(config, a, b));
    if (!added.length) return false;
    change(config, (plan) => {
      const { pieces } = graph(plan);
      for (const [p, q] of added) pieces.add(pieceKey(key(p), key(q)));
      plan.track = segments(pieces);
    });
    return true;
  }

  /** Take away the track from `a` to `b`, along the line a drag would draw. */
  function erase(config, a, b) {
    const plan0 = config?.logic?.plan;
    if (!isPoint(a) || !isPoint(b) || !isObject(plan0)) return false;
    const g = graph(plan0);
    // Whichever of the two bends has track under it.
    const straight = along(path(config, a, b));
    const other = along(path(config, b, a));
    const count = (run) => run.filter(([p, q]) => g.pieces.has(pieceKey(key(p), key(q)))).length;
    const run = count(other) > count(straight) ? other : straight;
    if (!count(run)) return false;
    change(config, (plan) => {
      const { pieces } = graph(plan);
      for (const [p, q] of run) pieces.delete(pieceKey(key(p), key(q)));
      plan.track = segments(pieces);
    });
    return true;
  }

  /** Set which way trains run on the piece a-b: towards `a` or `b`, or null for both. */
  function setDirection(config, a, b, towards) {
    change(config, (plan) => {
      const g = graph(plan);
      const [p, q] = [key(a), key(b)];
      if (!g.pieces.has(pieceKey(p, q))) return;
      const run = new Set(stretchOf(g, p, q).map(([from, to]) => pieceKey(from, to)));
      plan.arrows = plan.arrows.filter((arrow) => {
        const first = steps(arrow?.from, arrow?.to)[0];
        return first && !run.has(pieceKey(key(first[0]), key(first[1])));
      });
      if (!towards) return;
      plan.arrows.push(same(towards, a) ? { from: b, to: a } : { from: a, to: b });
    });
  }

  /**
   * Change the setting of the point where three lines meet. `turnout`: a
   * turnout's name, null for no turnout, or undefined to leave it unpicked.
   * Changing it drops a straight line picked for another turnout.
   */
  function setPoint(config, at, values) {
    change(config, (plan) => {
      const i = plan.points.findIndex((p) => isObject(p) && same(p.at, at));
      const next = { ...(i < 0 ? { at } : plan.points[i]), ...values };
      if ("turnout" in values && values.turnout === undefined) {
        if (i >= 0) plan.points.splice(i, 1);
        return;
      }
      if (next.turnout === null) {
        delete next.straight;
        delete next.straightIs;
        delete next.pairedWith;
      }
      if (next.straight === undefined) delete next.straight;
      if (i < 0) plan.points.push(next);
      else plan.points[i] = next;
    });
  }

  function breakAt(plan, at) {
    return list(plan?.breaks).find((b) => isObject(b) && same(b.at, at)) || null;
  }

  /** Put a block break at a point on plain track. Returns the break. */
  function addBreak(config, at) {
    if (kindAt(config, at) !== "plain") return null;
    change(config, (plan) => {
      if (!breakAt(plan, at)) plan.breaks.push({ at, sensors: [], signals: [] });
    });
    return breakAt(config.logic.plan, at);
  }

  /**
   * Take a block break away, with its signals and sensors. Blocks it kept
   * apart become one: the first keeps its name and Timing, and takes the
   * other's sensors.
   */
  function removeBreak(config, at) {
    change(config, (plan) => {
      plan.breaks = plan.breaks.filter((b) => !same(b?.at, at));
      const g = graph(plan);
      const cuts = breakNodes(plan);
      const here = new Set((g.near.get(key(at)) || []).map((other) => pieceKey(key(at), other)));
      const done = new Set();
      for (const piece of here) {
        if (done.has(piece)) continue;
        const region = regionOf(g, cuts, piece);
        region.forEach((p) => done.add(p));
        const [kept, ...rest] = plan.blocks.filter((b) => isObject(b) && region.has(anchorOf(g, b.at)));
        for (const other of rest) {
          kept.sensors = list(kept.sensors);
          for (const member of list(other.sensors)) {
            if (!kept.sensors.some((m) => JSON.stringify(m) === JSON.stringify(member))) kept.sensors.push(member);
          }
          plan.blocks.splice(plan.blocks.indexOf(other), 1);
        }
      }
    });
  }

  /** The signal at a break for trains heading for `facing`: a mast name, or "". */
  function setSignal(config, at, facing, mast) {
    if (mast && !addBreak(config, at)) return;
    change(config, (plan) => {
      const brk = breakAt(plan, at);
      if (!brk) return;
      brk.signals = list(brk.signals);
      const i = brk.signals.findIndex((s) => isObject(s) && same(s.facing, facing));
      if (!mast) {
        if (i >= 0) brk.signals.splice(i, 1);
      } else if (i < 0) brk.signals.push({ mast, facing });
      // Another signal has its own aspects.
      else if (brk.signals[i].mast !== mast) brk.signals[i] = { mast, facing };
    });
  }

  /** The sensors that stand at a block break. */
  function setBreakSensors(config, at, sensors) {
    change(config, (plan) => {
      const brk = breakAt(plan, at);
      if (brk) brk.sensors = sensors;
    });
  }

  /**
   * Name or change the block on the piece a-b: `name`, `sensors`, and its
   * Timing, `release` and `approachLock` (empty for the usual). A new block
   * needs a name, and a block cannot lose its name.
   */
  function setBlock(config, a, b, values) {
    change(config, (plan) => {
      let found = blockAt(config, a, b);
      if (!found) {
        if (!values.name) return;
        found = { name: values.name, at: [a, b], sensors: [] };
        plan.blocks.push(found);
      }
      if (values.name !== undefined && !values.name) return;
      Object.assign(found, values);
      for (const key of ["release", "approachLock"]) if (!found[key]) delete found[key];
    });
  }

  function removeBlock(config, a, b) {
    const found = blockAt(config, a, b);
    if (!found) return;
    change(config, (plan) => {
      plan.blocks.splice(plan.blocks.indexOf(found), 1);
    });
  }

  /** What is beyond an end: "signalled", "plain" or { board, mast, blocks }. */
  function setEnd(config, at, beyond) {
    change(config, (plan) => {
      plan.ends = plan.ends.filter((e) => !same(e?.at, at));
      if (beyond && beyond !== "signalled") plan.ends.push({ at, beyond });
    });
  }

  /** A name for a new block that nothing else uses: `make(n)` for n = 1, 2, ... */
  function freeBlockName(config, make) {
    const taken = new Set([
      ...list(config?.logic?.plan?.blocks), ...list(config?.logic?.blocks), ...list(config?.blocks),
    ].map((item) => item?.name));
    let n = 1;
    while (taken.has(make(n))) n += 1;
    return make(n);
  }

  global.EsphomeMrPlanEdit = {
    graph, kindAt, neighbours, stretchOfBlock, blockAt, directionAt, path, breakAt,
    draw, erase, setDirection, setPoint, addBreak, removeBreak, setSignal, setBreakSensors,
    setBlock, removeBlock, setEnd, freeBlockName,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
