// The Logic page in MSS Logic mode: the module picture (logic-mss-module), one
// drawing of the whole module made from its ends, tracks and junctions as they
// are described. It stays at the top of the page while you work down it. Click
// a block or block boundary to edit it in its track's card, or a junction or an
// end to go to its card.
// Loaded after logic-ui-mss-tracks.js and logic-ui-mss-junctions.js, whose
// strip and junction shapes it reuses. The layout is pure (layout(config)) and
// test/mss-module.test.js checks it without a DOM; the render functions at the
// end only draw it.
//
// Layout: the first end with a track goes on the left. Each track runs away
// from a place already drawn, as long as its blocks need; a junction is placed
// so the leg a track arrives at faces it, turned round when needed, and its
// other legs sit on the rows its shape gives them. The other tracks of an end
// sit on the rows beside its first. Ends that face left are lined up at the
// right edge. Tracks with no way to the first end start a new row underneath.
// When two tracks would lie over each other, the picture is drawn one track
// to a row instead (`rows: true`).
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const Tracks = () => global.EsphomeMrLogicUiMssTracks;
  const Junctions = () => global.EsphomeMrLogicUiMssJunctions;
  const B = () => global.EsphomeMrMssBuilder;

  const PART = "logic-mss-module";

  const TEXT = Object.freeze({
    card: "The module",
    intro: "The whole module as you describe it. Click a block or block boundary to edit it, or a junction or end to go to it.",
    empty: "Add the ends and a track, and the module is drawn here as you go.",
    fold: "Hide the picture",
    unfold: "Show the picture",
    pictureLabel: "Picture of the whole module",
    rows: "The tracks cross in a way this picture cannot lay out, so it shows one track to a row.",
    endLabel: (name, track, many) => (many ? `End ${name}, track ${track}` : `End ${name}`),
    deadEnd: "Dead end",
    noPlace: "Pick a place",
    junctionLabel: (name) => (name ? `Junction ${name}` : "Junction (no name)"),
    legLabel: (junction, leg) => `Junction ${junction}, leg ${leg}`,
    endAria: (label) => `${label}: go to its card`,
    itemAria: (track, label) => `Track ${track}, ${label}: edit it`,
    tryBlockAria: (label, occupied) => `${label}: ${occupied ? "a train is in it. Click to take it out" : "empty. Click to put a train in it"}`,
    tryTurnout: (name, position) => `${name} ${position}`,
    tryTurnoutAria: (name, position) => `${name}: ${position}. Click to throw it`,
    trainStart: (end, track, many) => (many ? `End ${end}, track ${track}` : `End ${end}`),
    junctionAria: (label) => `${label}: go to its card`,
  });

  const SIZES = Object.freeze({ block: 110, gap: 90, pad: 40, junction: 120, lane: 140, left: 80, right: 80, top: 56, bottom: 80 });

  // ===== Pure logic: the layout =============================================

  // A junction's legs: which side of it each sits on and its row, from the
  // shape it was made from (or spread by count).
  function junctionShape(junction) {
    const J = Junctions();
    const legs = J.legsOf(junction);
    const layout = J.layoutFor(junction);
    const points = J.legLayout(legs, layout);
    const ys = [...new Set(points.map((p) => p.y))].sort((a, b) => a - b);
    const base = points.length ? ys.indexOf(points[0].y) : 0;
    return points.map((p) => ({ leg: p.leg, side: p.x < 60 ? -1 : 1, row: ys.indexOf(p.y) - base }));
  }

  const keyOf = (place) => (place.kind === "end" ? `e:${place.end}:${place.track}`
    : place.kind === "leg" ? `l:${place.junction}:${place.leg}` : place.key);

  /**
   * The picture, in pixels: { width, height, rows, ends, places, tracks,
   * junctions }. Each track is { index, x1, y1, x2, y2, items, through },
   * drawn from its left point to its right one; its items are the strip's
   * blocks and block boundaries, with `left` and `right` the signals for trains
   * heading that way. An end is { index, name, track, x, y, faces, label }
   * (faces 1: the track leaves to the right). A junction is { index, label,
   * x, y, w, h, legs: [{ leg, x, y, side, signal }], paths }. `places` holds
   * dead ends and places not picked yet.
   */
  function layout(config, sizes = {}) {
    const S = { ...SIZES, ...sizes };
    const T = Tracks();
    const mss = isObject(config?.logic?.mss) ? B().descriptionOf(config.logic.mss) : {};
    const ends = list(mss.ends).map((end, index) => ({ end, index })).filter(({ end }) => isObject(end) && String(end.name ?? "").trim());
    const endInfo = new Map(ends.map(({ end, index }) => [String(end.name).trim(), { index, tracks: Math.max(1, Number(end.tracks) || 1) }]));
    const junctions = new Map();
    list(mss.junctions).forEach((junction, index) => {
      const name = isObject(junction) ? String(junction.name ?? "").trim() : "";
      if (name && !junctions.has(name)) junctions.set(name, { junction, index, shape: junctionShape(junction) });
    });
    const tracks = list(mss.tracks).map((track, index) => ({ track, index })).filter(({ track }) => isObject(track));

    // Each side of each track as a place.
    function placeOf(track, index, side) {
      const value = track[side];
      if (isObject(value) && value.end !== undefined && endInfo.has(String(value.end))) return { kind: "end", end: String(value.end), track: Number(value.track) || 1 };
      if (isObject(value) && value.junction !== undefined && junctions.has(String(value.junction))) return { kind: "leg", junction: String(value.junction), leg: Number(value.leg) };
      if (isObject(value)) return { kind: "missing", key: `m:${index}:${side}`, label: T.placeText(value) };
      return side === "to" ? { kind: "dead", key: `d:${index}`, label: TEXT.deadEnd } : { kind: "none", key: `n:${index}`, label: TEXT.noPlace };
    }
    const sides = tracks.map(({ track, index }) => {
      const shape = T.stripShape(track, { blockWidth: S.block, gap: S.gap, margin: S.pad });
      return { track, index, shape, from: placeOf(track, index, "from"), to: placeOf(track, index, "to") };
    });
    const at = new Map(); // place key -> [{ t, side }]
    sides.forEach((t) => {
      for (const side of ["from", "to"]) {
        const key = keyOf(t[side]);
        if (!at.has(key)) at.set(key, []);
        at.get(key).push({ t, side });
      }
    });

    const pos = new Map(); // place key -> { x, lane, out, place, group }
    const jpos = new Map(); // junction name -> { x, lane, turned, flipped, group }
    const done = new Set(); // track index
    let group = 0;
    const queue = [];

    const legAt = (name, leg, j) => {
      const info = junctions.get(name);
      const own = info.shape.find((l) => l.leg === leg) || { side: 1, row: 0 };
      const side = j.turned ? -own.side : own.side;
      return { x: j.x + (side < 0 ? 0 : S.junction), lane: j.lane + (j.flipped ? -own.row : own.row), out: side };
    };

    // Rows a junction's legs would take, and whether something already sits there.
    function clashes(name, j) {
      const info = junctions.get(name);
      return info.shape.some((l) => {
        const p = legAt(name, l.leg, j);
        return [...pos.values()].some((q) => q.lane === p.lane && Math.abs(q.x - p.x) < S.junction && !(q.place.kind === "leg" && q.place.junction === name));
      });
    }

    function placeJunction(name, entry, x, lane, dir) {
      const info = junctions.get(name);
      const own = info.shape.find((l) => l.leg === entry) || { side: -1, row: 0 };
      // The entry leg faces back the way the track came.
      const turned = own.side !== -dir;
      let j = null;
      for (const flipped of [false, true]) {
        const side = turned ? -own.side : own.side;
        const jx = side < 0 ? x : x - S.junction;
        const candidate = { x: jx, lane: lane - (flipped ? -own.row : own.row), turned, flipped, group };
        if (!j) j = candidate;
        if (!clashes(name, candidate)) { j = candidate; break; }
      }
      jpos.set(name, j);
      for (const l of info.shape) {
        const p = legAt(name, l.leg, j);
        const place = { kind: "leg", junction: name, leg: l.leg };
        const key = keyOf(place);
        if (!pos.has(key)) {
          pos.set(key, { ...p, place, group });
          queue.push(key);
        }
      }
    }

    function put(place, x, lane, out) {
      const key = keyOf(place);
      if (pos.has(key)) return;
      if (place.kind === "leg") {
        if (!jpos.has(place.junction)) placeJunction(place.junction, place.leg, x, lane, -out);
        return;
      }
      pos.set(key, { x, lane, out, place, group });
      queue.push(key);
      if (place.kind === "end") {
        // The end's other tracks, on the rows beside this one.
        const count = endInfo.get(place.end).tracks;
        for (let n = 1; n <= count; n += 1) {
          const other = { kind: "end", end: place.end, track: n };
          if (n !== place.track && at.has(keyOf(other)) && !pos.has(keyOf(other))) {
            pos.set(keyOf(other), { x, lane: lane + (n - place.track), out, place: other, group });
            queue.push(keyOf(other));
          }
        }
      }
    }

    function walk() {
      while (queue.length) {
        const key = queue.shift();
        const p = pos.get(key);
        for (const { t, side } of at.get(key) || []) {
          if (done.has(t.index)) continue;
          done.add(t.index);
          const other = t[side === "from" ? "to" : "from"];
          put(other, p.x + p.out * t.shape.width, p.lane, -p.out);
        }
      }
    }

    // Each group of joined tracks, starting from the first end that has a track.
    const seeds = [];
    for (const { end } of ends) {
      const info = endInfo.get(String(end.name).trim());
      for (let n = 1; n <= info.tracks; n += 1) seeds.push({ kind: "end", end: String(end.name).trim(), track: n });
    }
    for (const t of sides) seeds.push(t.from, t.to);
    const groups = [];
    for (const seed of seeds) {
      const key = keyOf(seed);
      if (pos.has(key) || !at.has(key) || at.get(key).every(({ t }) => done.has(t.index))) continue;
      if (seed.kind === "leg") {
        if (!jpos.has(seed.junction)) placeJunction(seed.junction, seed.leg, 0, 0, 1);
      } else {
        put(seed, 0, 0, 1);
      }
      walk();
      groups.push(group);
      group += 1;
    }
    // Junctions no track reaches yet still show.
    for (const [name, info] of junctions) {
      if (jpos.has(name)) continue;
      const first = info.shape[0];
      if (!first) continue;
      placeJunction(name, first.leg, 0, 0, first.side < 0 ? 1 : -1);
      walk();
      groups.push(group);
      group += 1;
    }

    // Stack the groups, each starting at the left.
    let nextLane = 0;
    for (const g of groups) {
      const items = [...[...pos.values()].filter((p) => p.group === g), ...[...jpos.values()].filter((j) => j.group === g)];
      const lanes = [...pos.values()].filter((p) => p.group === g).map((p) => p.lane);
      if (!lanes.length) continue;
      const minLane = Math.min(...lanes);
      const maxLane = Math.max(...lanes);
      const minX = Math.min(...[...pos.values()].filter((p) => p.group === g).map((p) => p.x), ...[...jpos.values()].filter((j) => j.group === g).map((j) => j.x));
      for (const item of items) {
        item.lane += nextLane - minLane;
        item.x -= minX;
      }
      nextLane += maxLane - minLane + 1;
    }

    // Ends facing left line up at the right edge, when nothing else is in the way.
    const places = [...pos.values()];
    const maxX = Math.max(0, ...places.map((p) => p.x), ...[...jpos.values()].map((j) => j.x + S.junction));
    for (const p of places) {
      if (p.place.kind !== "end" || p.out !== -1) continue;
      const between = places.some((q) => q !== p && q.lane === p.lane && q.x > p.x);
      const junctionIn = [...jpos.values()].some((j) => j.x + S.junction > p.x && legLanes(j).includes(p.lane));
      if (!between && !junctionIn) p.x = maxX;
    }
    function legLanes(j) {
      const name = [...jpos.entries()].find(([, v]) => v === j)?.[0];
      return name ? junctions.get(name).shape.map((l) => legAt(name, l.leg, j).lane) : [];
    }

    // Two tracks over each other: lay out one track to a row instead.
    const spans = sides.map((t) => {
      const a = pos.get(keyOf(t.from));
      const b = pos.get(keyOf(t.to));
      return a && b && a.lane === b.lane ? { lane: a.lane, x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x) } : null;
    }).filter(Boolean);
    const crossed = spans.some((s, i) => spans.some((o, k) => k > i && o.lane === s.lane && Math.min(s.x2, o.x2) - Math.max(s.x1, o.x1) > 1));
    if (crossed) return rowsLayout(sides, S, endInfo);

    // Into pixels.
    const lanes = places.map((p) => p.lane);
    const top = lanes.length ? Math.min(...lanes) : 0;
    const X = (x) => S.left + x;
    const Y = (lane) => S.top + (lane - top) * S.lane;
    const width = S.left + maxX + S.right;
    const height = S.top + (lanes.length ? Math.max(...lanes) - top : 0) * S.lane + S.bottom;

    const outEnds = [];
    const outPlaces = [];
    for (const p of places) {
      if (p.place.kind === "end") {
        const info = endInfo.get(p.place.end);
        outEnds.push({ index: info.index, name: p.place.end, track: p.place.track, x: X(p.x), y: Y(p.lane), faces: p.out, label: TEXT.endLabel(p.place.end, p.place.track, info.tracks > 1) });
      } else if (p.place.kind !== "leg") {
        outPlaces.push({ kind: p.place.kind, x: X(p.x), y: Y(p.lane), faces: p.out, label: p.place.label });
      }
    }
    const outTracks = sides.map((t) => {
      const a = pos.get(keyOf(t.from));
      const b = pos.get(keyOf(t.to));
      if (!a || !b) return null;
      return trackPicture(t, { x: X(a.x), y: Y(a.lane) }, { x: X(b.x), y: Y(b.lane) }, S);
    }).filter(Boolean);
    const outJunctions = [...jpos.entries()].map(([name, j]) => {
      const info = junctions.get(name);
      const legs = info.shape.map((l) => {
        const p = legAt(name, l.leg, j);
        return { leg: l.leg, x: X(p.x), y: Y(p.lane), side: p.out, signal: Junctions().mastOf(info.junction, l.leg) || null };
      });
      const ys = legs.map((l) => l.y);
      return {
        index: info.index, name, label: TEXT.junctionLabel(name),
        x: X(j.x), y: Math.min(...ys), w: S.junction, h: Math.max(...ys) - Math.min(...ys),
        legs, paths: routePaths(info.junction, legs),
      };
    });
    return { width, height, rows: false, ends: outEnds, places: outPlaces, tracks: outTracks, junctions: outJunctions };
  }

  // A track's picture between two points: its strip's items, centred on the
  // straight part, and mirrored when its From is on the right.
  function trackPicture(t, a, b, S) {
    const reversed = a.x > b.x;
    const [l, r] = reversed ? [b, a] : [a, b];
    // A track between two rows runs along the row of its left end, then
    // bends to the other row over its last `bend` pixels.
    const bend = l.y === r.y ? 0 : Math.min(60, Math.max(0, r.x - l.x) / 3);
    const straight = r.x - bend - l.x;
    const offset = Math.max(0, (straight - t.shape.width) / 2);
    const items = t.shape.items.map((item) => {
      const x = item.kind === "block"
        ? (reversed ? r.x - bend - offset - (item.x + item.w) : l.x + offset + item.x)
        : (reversed ? r.x - bend - offset - item.x : l.x + offset + item.x);
      const out = { ...item, x, y: l.y };
      if (item.kind === "boundary") {
        out.left = reversed ? item.towardsTo : item.towardsFrom;
        out.right = reversed ? item.towardsFrom : item.towardsTo;
      }
      return out;
    });
    return { index: t.index, x1: l.x, y1: l.y, x2: r.x, y2: r.y, bend, items, through: t.shape.through, reversed };
  }

  // The junction's routes as paths between its legs, as on its own card.
  function routePaths(junction, legs) {
    const at = (leg) => legs.find((l) => l.leg === leg);
    return list(junction.routes).map((route, index) => {
      const a = at(route?.legs?.[0]);
      const b = at(route?.legs?.[1]);
      let d = "";
      if (a && b && a.leg !== b.leg) {
        if (a.x === b.x) {
          const bulge = a.side < 0 ? 36 : -36;
          d = `M${a.x} ${a.y} C${a.x + bulge} ${a.y} ${b.x + bulge} ${b.y} ${b.x} ${b.y}`;
        } else if (a.y === b.y) {
          d = `M${a.x} ${a.y} L${b.x} ${b.y}`;
        } else {
          const mid = (a.x + b.x) / 2;
          d = `M${a.x} ${a.y} C${mid} ${a.y} ${mid} ${b.y} ${b.x} ${b.y}`;
        }
      }
      return { index, d, diverging: !!route?.diverging };
    });
  }

  // One track to a row, From on the left: for modules the picture cannot lay out.
  function rowsLayout(sides, S, endInfo) {
    const label = (place) => (place.kind === "end" ? TEXT.endLabel(place.end, place.track, endInfo.get(place.end).tracks > 1)
      : place.kind === "leg" ? TEXT.legLabel(place.junction, place.leg) : place.label);
    const widest = Math.max(0, ...sides.map((t) => t.shape.width));
    const ends = [];
    const places = [];
    const tracks = sides.map((t, row) => {
      const y = S.top + row * S.lane;
      const a = { x: S.left, y };
      const b = { x: S.left + t.shape.width, y };
      for (const [place, p, faces] of [[t.from, a, 1], [t.to, b, -1]]) {
        if (place.kind === "end") ends.push({ index: endInfo.get(place.end).index, name: place.end, track: place.track, x: p.x, y, faces, label: label(place) });
        else places.push({ kind: place.kind, x: p.x, y, faces, label: label(place) });
      }
      return trackPicture(t, a, b, S);
    });
    return {
      width: S.left + widest + S.right,
      height: S.top + Math.max(0, sides.length - 1) * S.lane + S.bottom,
      rows: true, ends, places, tracks, junctions: [],
    };
  }

  // ===== Pure logic: a train's path =========================================

  /**
   * The way a train goes through the module from an end track: the built
   * blocks it runs through and the signals it meets, in order, following the
   * route the turnouts set at each junction (`positionOf(turnout)` says where
   * each is). { blocks: [name], masts: [name], exit: { end, track } | null,
   * stop: "" | "dead" | "route" } (a dead end, or a junction no route of
   * which is set). Signals with no lights are left out of `masts`.
   */
  function trainRoute(config, start, positionOf = () => "closed") {
    const B0 = B();
    const mss = isObject(config?.logic?.mss) ? B().descriptionOf(config.logic.mss) : {};
    const names = B0.namesOf(config);
    const tracks = list(mss.tracks);
    const junctions = list(mss.junctions);
    const same = (a, b) => isObject(a) && isObject(b) && (a.end !== undefined
      ? String(a.end) === String(b.end) && Number(a.track) === Number(b.track)
      : String(a.junction) === String(b.junction) && Number(a.leg) === Number(b.leg));
    const signal = (where) => names.signals.find((x) => Object.entries(where).every(([k, v]) => x[k] === v));
    const out = { blocks: [], masts: [], exit: null, stop: "" };
    const seen = new Set();
    let place = { end: start?.end, track: Number(start?.track) || 1 };
    for (;;) {
      const index = tracks.findIndex((t, i) => !seen.has(i) && isObject(t) && (same(t.from, place) || same(t.to, place)));
      if (index < 0) break;
      seen.add(index);
      const track = tracks[index];
      const forward = same(track.from, place);
      const count = list(track.blocks).length;
      const order = [...Array(count).keys()];
      if (!forward) order.reverse();
      order.forEach((b, i) => {
        // The signal at the block boundary before this block, facing the way the train goes.
        if (i > 0) {
          const boundary = forward ? b - 1 : b;
          const s = signal({ track: index, boundary, key: forward ? "towardsTo" : "towardsFrom" });
          if (s && !s.virtual) out.masts.push(s.name);
        }
        const name = names.blocks[`${index}:${b}`];
        if (name) out.blocks.push(name);
      });
      const next = forward ? track.to : track.from;
      if (!isObject(next)) {
        out.stop = "dead";
        break;
      }
      if (next.end !== undefined) {
        out.exit = { end: String(next.end), track: Number(next.track) || 1 };
        break;
      }
      // A junction: its signal on this leg, then the route the turnouts set.
      const jIndex = junctions.findIndex((j) => isObject(j) && String(j.name ?? "").trim() === String(next.junction));
      const junction = junctions[jIndex];
      const leg = Number(next.leg);
      const s = signal({ junction: jIndex, leg });
      if (s && !s.virtual) out.masts.push(s.name);
      const route = list(junction?.routes).find((r) => isObject(r) && list(r.legs).map(Number).includes(leg)
        && list(r.turnouts).every((t) => !isObject(t) || !t.turnout || positionOf(t.turnout) === (t.position === "thrown" ? "thrown" : "closed")));
      if (!route) {
        out.stop = "route";
        break;
      }
      place = { junction: String(next.junction), leg: list(route.legs).map(Number).find((l) => l !== leg) };
    }
    return out;
  }

  /** Every end track a train can start from: [{ end, track, label }]. */
  function trainStarts(config) {
    const mss = isObject(config?.logic?.mss) ? B().descriptionOf(config.logic.mss) : {};
    const used = list(mss.tracks).flatMap((t) => (isObject(t) ? [t.from, t.to] : [])).filter((p) => isObject(p) && p.end !== undefined);
    const out = [];
    for (const end of list(mss.ends).filter(isObject)) {
      const name = String(end.name ?? "").trim();
      const count = Math.max(1, Number(end.tracks) || 1);
      for (let track = 1; track <= count; track += 1) {
        if (used.some((p) => String(p.end) === name && Number(p.track) === track)) out.push({ end: name, track, label: TEXT.trainStart(name, track, count > 1) });
      }
    }
    return out;
  }

  // ===== The page ===========================================================

  const SVG = "http://www.w3.org/2000/svg";
  let folded = false;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svg(tag, attrs = {}, text) {
    const node = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const shorten = (text, max) => (String(text).length > max ? `${String(text).slice(0, max - 1)}…` : String(text));

  // Something to click on the picture: a group that acts as a button.
  function clickable(attrs, label, onPick) {
    const g = svg("g", { ...attrs, tabindex: 0, role: "button", "aria-label": label });
    g.addEventListener("click", onPick);
    g.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onPick();
      }
    });
    return g;
  }

  // Scroll to a card (or what `find` returns) below the picture, once the
  // page has drawn and the picture has its size.
  function goTo(find) {
    const later = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => fn();
    later(() => later(() => {
      const target = typeof find === "string" ? document.getElementById(find) : find();
      if (!target) return;
      target.scrollIntoView({ block: "start", behavior: "smooth" });
      target.classList.remove("is-flashed");
      void target.offsetWidth;
      target.classList.add("is-flashed");
    }));
  }

  // `live` (Try it): { names, tagOf(mast), occupied(block), position(turnout),
  // toggleBlock(block), toggleTurnout(turnout) }. Without it the picture is the
  // editor's: click to edit, problems in red.
  function drawPicture(config, ctx, shape, live = null) {
    const T = Tracks();
    const TT = T.TEXT;
    const Marks = global.EsphomeMrLogicUiMssMarks;
    const problems = live ? [] : B().problems(config);
    const status = (marks) => Marks.statusOf(problems, marks).status;
    const picked = live ? null : T.picked();
    const signalName = (where) => live?.names.signals.find((x) => Object.entries(where).every(([k, v]) => x[k] === v))?.name;
    // A signal's name with a lamp in the colour it shows.
    const lit = (text, mast, attrs) => {
      const node = svg("text", attrs);
      if (live && mast) node.append(svg("tspan", { class: `mss-lamp tag-${live.tagOf(mast) || "none"}` }, "● "));
      node.append(svg("tspan", {}, text));
      return node;
    };
    const drawing = svg("svg", { class: "mss-module-picture", viewBox: `0 0 ${shape.width} ${shape.height}`, width: shape.width, height: shape.height, role: "group", "aria-label": TEXT.pictureLabel });

    // Junctions first, so tracks and their labels sit on top.
    for (const j of shape.junctions) {
      const flag = status({ part: B().PARTS.junctions, junction: String(j.index) });
      const g = live
        ? svg("g", { class: "mss-module-junction is-live" })
        : clickable({ class: `mss-module-junction${flag ? ` is-${flag}` : ""}` }, TEXT.junctionAria(j.label), () => goTo(`${B().PARTS.junctions}-${j.index}`));
      g.append(svg("rect", { class: "mss-hit", x: j.x - 6, y: j.y - 24, width: j.w + 12, height: j.h + 48, rx: 8 }));
      const routes = list(list(isObject(config?.logic?.mss) ? B().descriptionOf(config.logic.mss).junctions : [])[j.index]?.routes);
      const isSet = (route) => list(route?.turnouts).every((t) => !isObject(t) || !t.turnout || live.position(t.turnout) === (t.position === "thrown" ? "thrown" : "closed"));
      for (const path of j.paths) {
        if (!path.d) continue;
        const state = live ? (isSet(routes[path.index]) ? " is-set" : " is-unset") : "";
        g.append(svg("path", { class: `mss-module-route${path.diverging ? " is-diverging" : ""}${state}`, d: path.d }));
      }
      for (const leg of j.legs) {
        g.append(svg("circle", { class: "mss-module-leg", cx: leg.x, cy: leg.y, r: 4 }));
        const mast = live ? signalName({ junction: j.index, leg: leg.leg }) : null;
        if (leg.signal) {
          // Over the track it faces, just before the junction.
          const tx = leg.x + (leg.side < 0 ? -4 : 4);
          g.append(lit(leg.side < 0 ? TT.towardsToArrow(shorten(leg.signal, 14)) : TT.towardsFromArrow(shorten(leg.signal, 14)), mast,
            { class: "mss-module-signal", x: tx, y: leg.y - 26, "text-anchor": leg.side < 0 ? "end" : "start" }));
        }
      }
      g.append(svg("text", { class: "mss-module-name", x: j.x + j.w / 2, y: j.y - 30, "text-anchor": "middle" }, j.label));
      drawing.append(g);
      if (live) {
        // Its turnouts, under it: click one to throw it.
        const names = [...new Set(routes.flatMap((r) => list(r?.turnouts)).filter((t) => isObject(t) && t.turnout).map((t) => t.turnout))];
        names.forEach((name, k) => {
          const position = live.position(name) === "thrown" ? TT.thrown : TT.closed;
          const tg = clickable({ class: "mss-module-throw" }, TEXT.tryTurnoutAria(name, position), () => live.toggleTurnout(name));
          tg.append(svg("text", { x: j.x + j.w / 2, y: j.y + j.h + 30 + k * 18, "text-anchor": "middle" }, TEXT.tryTurnout(name, position)));
          drawing.append(tg);
        });
      }
    }

    for (const t of shape.tracks) {
      const line = t.bend
        ? `M${t.x1} ${t.y1} L${t.x2 - t.bend} ${t.y1} L${t.x2} ${t.y2}`
        : `M${t.x1} ${t.y1} L${t.x2} ${t.y2}`;
      drawing.append(svg("path", { class: "mss-module-rail", d: line }));
      if (t.through) drawing.append(svg("text", { class: "mss-through", x: (t.x1 + t.x2) / 2, y: t.y1 - 46, "text-anchor": "middle" }, TT.through));
      for (const item of t.items) {
        const where = { part: B().PARTS.tracks, track: String(t.index), [item.kind]: String(item.index) };
        const flag = status(where);
        const isPicked = picked && picked.track === t.index && picked.kind === item.kind && picked.index === item.index;
        const blockName = live && item.kind === "block" ? live.names.blocks[`${t.index}:${item.index}`] : null;
        const occupied = blockName ? live.occupied(blockName) : false;
        let g;
        if (!live) {
          g = clickable({ class: `mss-${item.kind}${isPicked ? " is-selected" : ""}${flag ? " has-problem" : ""}`, "aria-pressed": isPicked ? "true" : "false" },
            TEXT.itemAria(t.index + 1, item.label), () => pickItem(ctx, t.index, item));
        } else if (blockName) {
          g = clickable({ class: `mss-block${occupied ? " is-occupied" : ""}` }, TEXT.tryBlockAria(blockName, occupied), () => live.toggleBlock(blockName));
        } else {
          g = svg("g", { class: `mss-${item.kind} is-live` });
        }
        if (item.kind === "block") {
          const cx = item.x + item.w / 2;
          g.append(svg("rect", { x: item.x + 3, y: t.y1 - 20, width: item.w - 6, height: 40, rx: 6 }));
          if (occupied) g.append(svg("rect", { class: "try-train-body", x: item.x + 14, y: t.y1 - 10, width: item.w - 28, height: 20, rx: 4 }));
          else g.append(svg("text", { class: "mss-label", x: cx, y: t.y1 + 5, "text-anchor": "middle" }, item.sensors.length ? shorten(item.sensors.join(", "), 15) : TT.noSensor));
          g.append(svg("text", { class: "mss-sub", x: cx, y: t.y1 + 36, "text-anchor": "middle" }, item.label));
          item.turnouts.forEach((u, k) => {
            if (live && u.turnout) {
              // Where it is now; click to throw it.
              const position = live.position(u.turnout) === "thrown" ? TT.thrown : TT.closed;
              const tg = clickable({ class: "mss-module-throw" }, TEXT.tryTurnoutAria(u.turnout, position), () => live.toggleTurnout(u.turnout));
              tg.append(svg("text", { x: cx, y: t.y1 + 52 + k * 16, "text-anchor": "middle" }, TEXT.tryTurnout(shorten(u.turnout, 12), position)));
              drawing.append(tg);
              return;
            }
            g.append(svg("text", { class: "mss-turnout", x: cx, y: t.y1 + 52 + k * 14, "text-anchor": "middle" },
              TT.turnoutMark(shorten(u.turnout || "?", 12), u.position === "thrown" ? TT.thrown : TT.closed)));
          });
        } else {
          g.append(svg("rect", { class: "mss-hit", x: item.x - item.w / 2, y: t.y1 - 30, width: item.w, height: 92 }));
          g.append(svg("line", { class: "mss-bar", x1: item.x, y1: t.y1 - 24, x2: item.x, y2: t.y1 + 24 }));
          g.append(svg("text", { class: "mss-sub", x: item.x, y: t.y1 + 38, "text-anchor": "middle" }, item.sensors.length ? shorten(item.sensors.join(", "), 14) : TT.noSensor));
          // Each arrow's signal: given, or the one with no lights made there.
          const keys = t.reversed ? ["towardsTo", "towardsFrom"] : ["towardsFrom", "towardsTo"];
          const mastAt = (k) => (live ? signalName({ track: t.index, boundary: item.index, key: k }) : null);
          const arrow = (y, name, text, mast) => g.append(name
            ? lit(text(shorten(name, 12)), mast, { class: "mss-arrow", x: item.x, y, "text-anchor": "middle" })
            : svg("text", { class: "mss-arrow is-none", x: item.x, y, "text-anchor": "middle" }, TT.noSignal));
          arrow(t.y1 + 54, item.left, TT.towardsFromArrow, mastAt(keys[0]));
          arrow(t.y1 + 70, item.right, TT.towardsToArrow, mastAt(keys[1]));
        }
        drawing.append(g);
      }
    }

    for (const end of shape.ends) {
      const flag = status({ part: B().PARTS.ends, end: String(end.index) });
      const g = live
        ? svg("g", { class: "mss-module-end is-live" })
        : clickable({ class: `mss-module-end${flag ? ` is-${flag}` : ""}` }, TEXT.endAria(end.label), () => goTo(`logic-mss-end-${end.index}`));
      g.append(svg("rect", { class: "mss-hit", x: end.x - 40, y: end.y - 44, width: 80, height: 70 }));
      g.append(svg("line", { class: "mss-module-plate", x1: end.x, y1: end.y - 18, x2: end.x, y2: end.y + 18 }));
      g.append(svg("text", { class: "mss-place", x: end.x, y: end.y - 26, "text-anchor": end.faces > 0 ? "start" : "end" }, end.label));
      drawing.append(g);
    }
    for (const place of shape.places) {
      drawing.append(svg("line", { class: place.kind === "dead" ? "mss-module-stop" : "mss-module-open", x1: place.x, y1: place.y - 10, x2: place.x, y2: place.y + 10 }));
      drawing.append(svg("text", { class: "mss-place", x: place.x, y: place.y - 18, "text-anchor": place.faces > 0 ? "start" : "end" }, place.label));
    }
    return drawing;
  }

  // A block or block boundary picked on the picture: open its form in the track's card.
  function pickItem(ctx, track, item) {
    Tracks().pick(track, { kind: item.kind, index: item.index });
    ctx.render();
    goTo(() => document.querySelector(`#logic-mss-track-${track} .mss-form`));
  }

  // How far the pinned picture reaches down the window, so cards scrolled to
  // stop below it.
  // A wide module is drawn smaller to fit the frame, down to 60%; past that it scrolls.
  function fit(card, shape) {
    const wrap = card.querySelector(".mss-module-wrap");
    const picture = wrap?.querySelector("svg");
    if (!picture || !wrap.clientWidth) return;
    const scale = Math.max(0.6, Math.min(1, (wrap.clientWidth - 2) / shape.width));
    picture.setAttribute("width", Math.round(shape.width * scale));
    picture.setAttribute("height", Math.round(shape.height * scale));
  }

  function pinHeight(card) {
    const bar = document.querySelector(".topbar");
    const top = bar ? bar.getBoundingClientRect().height : 0;
    card.style.top = `${top}px`;
    document.documentElement.style.setProperty("--mss-pin", `${top + card.getBoundingClientRect().height + 12}px`);
  }

  function renderModule(root, config, ctx, ui) {
    const card = ui.card(PART, TEXT.card);
    card.classList.add("mss-module");
    const shape = layout(config);
    // Nothing drawn yet: just say what fills it in.
    if (!shape.tracks.length && !shape.junctions.length) {
      card.classList.add("is-empty");
      card.append(ui.paragraph(TEXT.empty, "hint"));
      root.append(card);
      return;
    }
    const toggle = el("button", "text mss-module-fold", folded ? TEXT.unfold : TEXT.fold);
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", String(!folded));
    toggle.addEventListener("click", () => {
      folded = !folded;
      ctx.render();
    });
    card.querySelector("h3").after(toggle);
    if (!folded) {
      card.append(ui.paragraph(TEXT.intro));
      if (shape.rows) card.append(ui.paragraph(TEXT.rows, "hint"));
      const wrap = el("div", "mss-module-wrap");
      wrap.append(drawPicture(config, ctx, shape));
      card.append(wrap);
    }
    root.append(card);
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        fit(card, shape);
        pinHeight(card);
      });
    }
  }

  // The picture for Try it: trains in the blocks, each signal lit, the
  // turnouts clickable. Returns a wrap holding it, or null for an empty module.
  function livePicture(config, ctx, live) {
    const shape = layout(config);
    if (!shape.tracks.length && !shape.junctions.length) return null;
    const wrap = el("div", "mss-module-wrap is-live");
    wrap.append(drawPicture(config, ctx, shape, live));
    return wrap;
  }

  global.EsphomeMrLogicUiMssModule = { TEXT, PART, SIZES, layout, junctionShape, trainRoute, trainStarts, livePicture };

  // MP 2: no longer a card on the page; Try it still draws with this file until MP 6.
})(typeof globalThis !== "undefined" ? globalThis : window);
