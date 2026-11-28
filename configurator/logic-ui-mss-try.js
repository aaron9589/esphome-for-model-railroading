// Try it on the MSS Logic page (docs/mss-patterns-spec.md, The page, step 4;
// work item MP 6): the module's picture, live. Click a block to put a train
// in or take it out, the points to throw them, a signal to read why it shows
// what it does. Time runs as it does on the board, in real time (Pause stops
// it). A pretend neighbour at each end stands in for the module next door.
// Run a train comes in at an end and runs along the route the points set, a
// block every few seconds, out at the other end (and on into a pretend
// neighbour, if one is there).
//
// The session is logic-try.js; the picture is logic-ui-mss-row.js, drawn
// with each block, signal and points named so this file can colour them.
// The pure parts (trainStarts, trainRoute, blocksOf, inPictureWords, headsFor) are checked
// by test/mss-try.test.js; the page by test/browser/mss-page.mjs.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const PART = "logic-mss-try";
  const T = () => global.EsphomeMrLogicTry;
  const B = () => global.EsphomeMrMssBuilder;
  const P = () => global.EsphomeMrLogicUiMssRow;
  const F = () => global.EsphomeMrLogicUiMss;

  const TEXT = Object.freeze({
    card: "Try it",
    intro: "Click a block to put a train in it or take it out, and the points to throw them. Click a signal to see why it shows what it does. Time runs as it does on the board. Nothing here touches the layout.",
    pictureLabel: "The module, live",
    pause: "Pause",
    resume: "Carry on",
    paused: "Paused.",
    again: "Start again",
    time: (s) => `${(Number(s) || 0).toFixed(1)} s`,
    showingMe: "Showing the steps that lead to the problem, paused. Carry on runs time on from here.",
    notReady: "Try it needs the module made, with no problems. Go back to the step with a problem first.",
    // Run a train.
    trainHeading: "Run a train",
    trainEnter: "Comes in at",
    trainStart: (end, track, many) => (many ? `End ${end}, track ${track}` : `End ${end}`),
    fromNeighbour: (end) => `Start in the pretend neighbour at end ${end}`,
    intoNeighbour: (end) => `Carry on into the pretend neighbour at end ${end}`,
    way: (blocks) => `Its way through: ${blocks}.`,
    out: (end) => ` It leaves at ${end}.`,
    dead: " It stops at a dead end.",
    noRoute: " It stops at the points: they set no way on from here. Throw them first.",
    none: "none",
    run: "Run a train",
    running: "The train is running…",
    // The pretend neighbours.
    neighboursHeading: "Pretend neighbours",
    neighboursHint: "A pretend neighbour stands in for the module next door: three blocks with a signal at each. It answers this end the way a real module would. Click one of its blocks to put a train in it.",
    neighbourOn: (end) => `End ${end}: pretend there is a neighbour`,
    neighbourTrack: (end, track, many) => (many ? `End ${end}, track ${track}` : `End ${end}`),
    neighbourRuns: Object.freeze({ into: "its trains run towards this module", away: "its trains run away from this module" }),
    neighbourTurn: "Turn it round",
    neighbourBlock: (at, occupied) => `Block ${at}: ${occupied ? "a train is in it" : "empty"}`,
    // The picked signal, and what happened.
    signalTitle: (name) => name,
    shows: (aspect, meaning) => (meaning && meaning !== aspect ? `Shows ${aspect}: ${meaning}.` : `Shows ${aspect}.`),
    showsNothing: "Shows nothing yet.",
    why: "Why",
    pickSignal: "Click a signal on the picture to see why it shows what it does.",
    happened: "What happened",
    nothingYet: "Nothing yet.",
    blockLabel: (name, occupied) => `${name}: ${occupied ? "a train is in it" : "empty"}`,
    pointsLabel: (name, position) => `${name}: ${position}. Click to throw.`,
    closed: "closed",
    thrown: "thrown",
    locked: "locked",
    legend: Object.freeze({ train: "A train", locked: "Points locked: they cannot be thrown" }),
  });

  // Run a train: a block every few seconds, in real time.
  const TRAIN_MS = 3000;
  const COLOURS = Object.freeze({ red: "#dc2626", amber: "#f59e0b", green: "#16a34a", white: "#f9fafb", off: "#1f2937" });
  // A signal's colour by what it means, for a signal with no aspect of the pattern's.
  const MEANING_COLOURS = Object.freeze({ stop: "red", restricting: "red", approach: "amber", advance: "amber", clear: "green" });

  // ===== Pure ================================================================

  const descriptionOf = (config) => (isObject(config?.logic?.mss) ? B().descriptionOf(config.logic.mss) : {});

  /** Every end track a train can come in at: [{ end, track, label }]. */
  function trainStarts(config) {
    const mss = descriptionOf(config);
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

  /**
   * The way a train goes through the module from an end track: the built
   * blocks it runs through and the signals it meets, in order, following the
   * way the points (`positionOf(turnout)`) are set at each. { blocks: [name],
   * masts: [name], exit: { end, track } | null, stop: "" | "dead" | "route" }.
   * Signals with no lights are left out of `masts`.
   */
  function trainRoute(config, start, positionOf = () => "closed") {
    const mss = descriptionOf(config);
    const names = B().namesOf(config);
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
      const order = [...Array(list(track.blocks).length).keys()];
      if (!forward) order.reverse();
      order.forEach((b, i) => {
        // The signal at the block boundary before this block, facing the way the train goes.
        if (i > 0) {
          const s = signal({ track: index, boundary: forward ? b - 1 : b, key: forward ? "towardsTo" : "towardsFrom" });
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
      // Points: the signal on this leg, then the way they are set.
      const jIndex = junctions.findIndex((j) => isObject(j) && String(j.name ?? "").trim() === String(next.junction));
      const leg = Number(next.leg);
      const s = signal({ junction: jIndex, leg });
      if (s && !s.virtual) out.masts.push(s.name);
      const route = list(junctions[jIndex]?.routes).find((r) => isObject(r) && list(r.legs).map(Number).includes(leg)
        && list(r.turnouts).every((t) => !isObject(t) || !t.turnout || positionOf(t.turnout) === (t.position === "thrown" ? "thrown" : "closed")));
      if (!route) {
        out.stop = "route";
        break;
      }
      place = { junction: String(next.junction), leg: list(route.legs).map(Number).find((l) => l !== leg) };
    }
    return out;
  }

  /**
   * Which built block each detector on the picture is in: Map(sensor name ->
   * built block name). The picture names a block by its first detector, and
   * a Crossover's detector is in the block it stands in.
   */
  function blocksOf(config) {
    const names = B().namesOf(config);
    const out = new Map();
    list(descriptionOf(config).tracks).forEach((track, i) => {
      list(track?.blocks).forEach((block, b) => {
        const built = names.blocks[`${i}:${b}`];
        if (built) for (const sensor of list(block?.sensors)) if (typeof sensor === "string") out.set(sensor, built);
      });
    });
    return out;
  }

  /**
   * A sentence about the built blocks, in the picture's words: each built
   * block named by its detector, as the picture names it.
   */
  function inPictureWords(text, blocks) {
    let out = String(text ?? "");
    const pairs = [...blocks].map(([sensor, built]) => [built, sensor]).sort((a, b) => b[0].length - a[0].length);
    const seen = new Set();
    for (const [built, sensor] of pairs) {
      if (seen.has(built)) continue;
      seen.add(built);
      out = out.split(built).join(sensor);
    }
    return out;
  }

  /**
   * What a signal's heads show, upper head first: [{ color, blink }], from
   * the pattern's indication with this aspect's name, else every head in the
   * colour of what it means (`meaning`: stop, approach, clear …). Dark or
   * nothing shown yet: every head off.
   */
  function headsFor(config, heads, aspect, meaning) {
    const count = heads === "twoHeads" ? 2 : 1;
    const off = Array.from({ length: count }, () => ({ color: "off", blink: false }));
    if (!aspect || aspect === "dark") return off;
    const ind = list(F()?.indicationsFor(config, heads)).find((x) => x.label === aspect);
    if (ind) return ind.heads;
    return off.map(() => ({ color: MEANING_COLOURS[meaning] || "red", blink: false }));
  }

  // ===== The page ============================================================

  const state = { config: null, table: "", session: null, picked: "", paused: false, running: false, start: "", from: false, into: false, pending: null, banner: false };

  /** Show me: the steps that lead to a problem, played from the start on Try it. */
  function showMe(sequence) {
    state.pending = list(sequence);
    F()?.show?.("try");
    return true;
  }

  // The clock, as on the Field Logic page: a scan each tenth of a second
  // while the picture is on the page, drawn again only when what it shows
  // has changed (not while a list is open or a mouse button is down).
  const TICK_MS = 100;
  const clock = { timer: null, last: 0, seen: "", redraw: null, down: false, listening: false };
  const nowMs = () => (global.performance?.now ? global.performance.now() : Date.now());
  const looksOf = (session) => {
    const view = session.view();
    return JSON.stringify([view.masts.map((m) => m.aspect), view.turnouts.map((t) => [t.position, t.locked]), view.ends.map((e) => e.state),
      view.neighbours.map((n) => [n.on, n.tracks.map((t) => [t.direction, t.signals.map((s) => s.tag), t.blocks.map((b) => b.occupied)])]), view.log.length]);
  };

  function tick() {
    const picture = global.document?.getElementById?.("logic-mss-try-picture");
    if (!picture || !state.session) {
      clearInterval(clock.timer);
      clock.timer = null;
      return;
    }
    const now = nowMs();
    const scans = Math.floor((now - clock.last) / TICK_MS);
    if (state.paused || scans < 1) {
      if (state.paused) clock.last = now;
      return;
    }
    clock.last = scans > 10 ? now : clock.last + scans * TICK_MS;
    for (let i = 0; i < Math.min(scans, 10); i += 1) state.session.step();
    const time = global.document.getElementById("logic-mss-try-time");
    if (time) time.textContent = TEXT.time(state.session.view().time / 1000);
    const looks = looksOf(state.session);
    const open = global.document.activeElement;
    if (looks === clock.seen || clock.down || (open?.tagName === "SELECT" && open.closest?.(`#${PART}`))) return;
    clock.seen = looks;
    clock.redraw?.();
  }

  function startClock(redraw) {
    clock.redraw = redraw;
    clock.seen = looksOf(state.session);
    if (clock.timer || typeof setInterval !== "function" || !global.document) return;
    if (!clock.listening) {
      clock.listening = true;
      global.document.addEventListener("pointerdown", () => { clock.down = true; }, true);
      for (const name of ["pointerup", "pointercancel"]) global.document.addEventListener(name, () => { clock.down = false; }, true);
    }
    clock.last = nowMs();
    clock.timer = setInterval(tick, TICK_MS);
  }

  function sessionOf(config) {
    let table = "";
    try {
      table = JSON.stringify(global.EsphomeMrLogicYaml.logicTable(config));
    } catch {
      return null;
    }
    if (state.config !== config || state.table !== table || !state.session) {
      let session = null;
      try {
        session = T().createSession(config);
      } catch {
        session = null;
      }
      Object.assign(state, { config, table, session, picked: "", running: false, paused: false, banner: false });
      session?.advance(1000);
    }
    return state.session;
  }

  const SVG = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs = {}, text) => {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text, onClick, className = "") => {
    const b = el("button", className, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  };

  // The picture, live: trains in blocks, each signal's lamps, the way each
  // points are set (and a lock when they cannot be thrown).
  function livePicture(config, session, row) {
    const picked = new Set(state.picked ? [state.picked] : []);
    const picture = P().draw(row, { lit: picked });
    if (!picture) return null;
    picture.id = "logic-mss-try-picture";
    picture.classList.add("is-live", "is-pickable");
    picture.setAttribute("aria-label", TEXT.pictureLabel);
    const view = session.view();
    const blocks = blocksOf(config);
    const shape = P().layout(row);
    const px = (v) => Math.round(v * 56 * 10) / 10;
    const find = (name) => picture.querySelector(`[data-part="${CSS.escape(name)}"]`);
    for (const b of shape.blocks) {
      const built = blocks.get(b.name);
      const g = b.name ? find(b.name) : null;
      if (!g || !built) continue;
      const occupied = session.blockOccupied(built);
      // A wide line to click along the track, not only its thin rail.
      const track = g.querySelector(".mss-row-track");
      if (track) g.prepend(svg("polyline", { class: "mss-live-hit", points: track.getAttribute("points") }));
      g.classList.toggle("is-train", occupied);
      g.setAttribute("aria-label", TEXT.blockLabel(b.name, occupied));
    }
    for (const c of shape.crossovers) {
      const g = find(c.name);
      const built = blocks.get(c.name);
      if (g && built) g.classList.toggle("is-train", session.blockOccupied(built));
    }
    const masts = new Map(view.masts.map((m) => [m.name, m]));
    const headsOf = new Map(shape.signals.map((s) => [s.name, s.heads === 2 ? "twoHeads" : s.key === "siding" ? "diverging" : "plain"]));
    for (const s of shape.signals) {
      const g = find(s.name);
      const m = masts.get(s.name);
      if (!g) continue;
      const look = headsFor(config, headsOf.get(s.name), m?.aspect, m?.tag);
      [...g.querySelectorAll(".mss-row-head")].forEach((head, h) => {
        const lamp = look[h] || { color: "off" };
        head.style.fill = COLOURS[lamp.color] || COLOURS.off;
        head.classList.toggle("is-blink", !!lamp.blink && lamp.color !== "off");
      });
    }
    const turnouts = new Map(view.turnouts.map((t) => [t.name, t]));
    for (const p of shape.points) {
      const g = find(p.name);
      const t = turnouts.get(p.name);
      if (!g || !t) continue;
      const to = p.legs[t.position === "thrown" ? "thrown" : "closed"];
      g.prepend(svg("line", { class: "mss-live-leg", x1: px(p.at[0]), y1: px(p.at[1]), x2: px(to[0]), y2: px(to[1]) }));
      const words = t.locked ? `${TEXT[t.position] || t.position}, ${TEXT.locked}` : TEXT[t.position] || t.position;
      g.setAttribute("aria-label", TEXT.pointsLabel(p.name, words));
      g.classList.toggle("is-locked", !!t.locked);
      if (t.locked) g.append(svg("rect", { class: "mss-live-lock", x: px(p.at[0]) + 7, y: px(p.at[1]) - 17, width: 9, height: 8, rx: 1 }));
    }
    return picture;
  }

  // A pretend neighbour's track: three blocks and their signals, drawn away from the joint.
  function neighbourStrip(session, end, track, many, redraw) {
    const box = el("div", "mss-neighbour-track");
    box.append(el("p", "hint", `${TEXT.neighbourTrack(end, track.track, many)}: ${TEXT.neighbourRuns[track.direction]}.`));
    const w = 64;
    const gap = 30;
    const width = 3 * (w + gap) + 10;
    const drawing = svg("svg", { class: "mss-neighbour-strip", viewBox: `0 0 ${width} 64`, width, height: 64, role: "group" });
    // End A's neighbour is on the left of the module, end B's on the right: its block 1 next to the joint.
    const left = end === "A";
    drawing.append(svg("line", { class: "mss-row-track", x1: 0, y1: 40, x2: width, y2: 40 }));
    drawing.append(svg("line", { class: "mss-neighbour-joint", x1: left ? width - 2 : 2, y1: 22, x2: left ? width - 2 : 2, y2: 58 }));
    track.blocks.forEach((block, i) => {
      const x = left ? width - 10 - (i + 1) * (w + gap) + gap : 10 + i * (w + gap);
      const g = svg("g", { class: `mss-neighbour-block${block.occupied ? " is-train" : ""}`, role: "button", tabindex: 0, "aria-label": TEXT.neighbourBlock(block.at, block.occupied) });
      g.append(svg("rect", { x, y: 32, width: w, height: 16, rx: 4 }));
      g.append(svg("text", { class: "mss-row-label is-small", x: x + w / 2, y: 62, "text-anchor": "middle" }, String(block.at)));
      const toggle = () => {
        session.setBlock(block.ref, !block.occupied, { scan: true });
        redraw();
      };
      g.addEventListener("click", toggle);
      g.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } });
      drawing.append(g);
      const signal = track.signals[i];
      const cx = left ? x - gap / 2 : x + w + gap / 2;
      const lamp = svg("circle", { class: "mss-row-head", cx, cy: 16, r: 7 });
      lamp.style.fill = COLOURS[MEANING_COLOURS[signal.tag] || "red"];
      lamp.append(svg("title", {}, signal.meaning));
      drawing.append(svg("line", { class: "mss-row-mast", x1: cx, y1: 23, x2: cx, y2: 34 }), lamp);
    });
    box.append(drawing);
    box.append(button(TEXT.neighbourTurn, () => {
      session.turnNeighbour(end, track.track, { scan: true });
      redraw();
    }));
    return box;
  }

  function render(root, config, ctx, ui) {
    const card = ui.card(PART, TEXT.card);
    root.append(card);
    const row = F()?.rowOf?.(config);
    const session = row && P().layout(row) ? sessionOf(config) : null;
    if (!session) {
      card.append(ui.paragraph(TEXT.notReady));
      return;
    }
    if (state.pending) {
      session.play(state.pending);
      state.pending = null;
      state.paused = true;
      state.banner = true;
    }
    card.append(ui.paragraph(TEXT.intro, "hint"));
    const redraw = (focus) => {
      const had = focus || (document.activeElement?.id ? `#${document.activeElement.id}` : "");
      ctx.render();
      if (had) document.querySelector(had)?.focus({ preventScroll: true });
    };

    // Controls: pause, start again, the time.
    const bar = el("div", "plan-tools");
    const pause = button(state.paused ? TEXT.resume : TEXT.pause, () => {
      state.paused = !state.paused;
      state.banner = false;
      clock.last = nowMs();
      redraw("#logic-mss-try-pause");
    });
    pause.id = "logic-mss-try-pause";
    const again = button(TEXT.again, () => {
      session.reset();
      session.advance(1000);
      Object.assign(state, { picked: "", paused: false, banner: false });
      redraw();
    });
    again.id = "logic-mss-try-again";
    const time = el("span", "hint", TEXT.time(session.view().time / 1000));
    time.id = "logic-mss-try-time";
    bar.append(pause, again, time);
    if (state.paused) bar.append(el("span", "hint", TEXT.paused));
    card.append(bar);
    if (state.banner) card.append(el("div", "try-banner", TEXT.showingMe));

    // The picture, live. Clicks: a block, a Crossover's detector, the points, a signal.
    const picture = livePicture(config, session, row);
    const blocks = blocksOf(config);
    picture.addEventListener("click", (event) => {
      if (state.running) return;
      const g = event.target.closest?.("[data-part]");
      const name = g?.dataset.part;
      if (!name) return;
      if (g.classList.contains("mss-row-block") || g.classList.contains("mss-row-crossover")) {
        const built = blocks.get(name);
        if (built) session.setBlock(built, !session.blockOccupied(built), { scan: true });
      } else if (g.classList.contains("mss-row-points")) {
        const t = session.view().turnouts.find((x) => x.name === name);
        if (t && !t.locked) session.setTurnout(name, t.position === "thrown" ? "closed" : "thrown");
      } else if (g.classList.contains("mss-row-signal")) {
        state.picked = state.picked === name ? "" : name;
      }
      redraw();
    });
    const wrap = el("div", "mss-row-wrap");
    wrap.append(picture);
    card.append(wrap);
    const legend = el("p", "hint plan-legend");
    for (const [k, words] of Object.entries(TEXT.legend)) legend.append(el("span", `plan-chip is-mss-${k}`), ` ${words} `);
    card.append(legend);

    const body = el("div", "mss-try-body");
    const main = el("div", "mss-try-main");

    // Run a train: in at an end, along the way the points are set, out at the other.
    main.append(el("h4", "", TEXT.trainHeading));
    const starts = trainStarts(config);
    const key = (s) => `${s.end}:${s.track}`;
    if (!starts.some((s) => key(s) === state.start)) state.start = starts.length ? key(starts[0]) : "";
    const start = starts.find((s) => key(s) === state.start);
    const positionOf = (name) => session.turnoutPosition(name) || "closed";
    const route = start ? trainRoute(config, start, positionOf) : { blocks: [], masts: [], exit: null, stop: "" };
    const on = new Set(session.neighbours().filter((n) => n.on).map((n) => n.end));
    const fields = el("div", "fields try-train-fields");
    const enter = ctx.field(TEXT.trainEnter, state.start, (v) => { Object.assign(state, { start: v, from: false, into: false }); redraw("#logic-mss-try-from"); },
      { select: starts.map((s) => ({ value: key(s), label: s.label })) });
    enter.querySelector("select").id = "logic-mss-try-from";
    fields.append(enter);
    if (start && on.has(start.end)) fields.append(ctx.field(TEXT.fromNeighbour(start.end), state.from === true, (checked) => { state.from = checked; }, { checkbox: true }));
    if (route.exit && on.has(route.exit.end)) fields.append(ctx.field(TEXT.intoNeighbour(route.exit.end), state.into === true, (checked) => { state.into = checked; }, { checkbox: true }));
    main.append(fields);
    const ending = route.exit ? TEXT.out(starts.find((s) => s.end === route.exit.end && s.track === route.exit.track)?.label || route.exit.end)
      : route.stop === "route" ? TEXT.noRoute : route.stop === "dead" ? TEXT.dead : "";
    const names = new Map([...blocks].map(([sensor, built]) => [built, sensor]));
    main.append(el("p", "hint", TEXT.way(route.blocks.map((b) => names.get(b) || b).join(", ") || TEXT.none) + ending));
    const go = button(state.running ? TEXT.running : TEXT.run, () => {
      if (state.running || !start) return;
      let path = [...route.blocks];
      // A pretend neighbour's trains run the way this one does.
      const facing = (end, track, want) => {
        const now = session.neighbours().find((n) => n.end === end)?.tracks.find((t) => t.track === track);
        if (now && now.direction !== want) session.turnNeighbour(end, track, { scan: false });
      };
      if (state.from && on.has(start.end)) {
        facing(start.end, start.track, "into");
        path = [...session.neighbourPath(start.end, start.track), ...path];
      }
      if (state.into && route.exit && on.has(route.exit.end)) {
        facing(route.exit.end, route.exit.track, "away");
        path = [...path, ...session.neighbourPath(route.exit.end, route.exit.track)];
      }
      if (!path.length) return;
      // One block at a time: into the next, then out of the one behind.
      const moves = [];
      path.forEach((block, i) => {
        moves.push(() => session.setBlock(block, true, { scan: true }));
        if (i > 0) moves.push(() => session.setBlock(path[i - 1], false, { scan: true }));
      });
      moves.push(() => session.setBlock(path[path.length - 1], false, { scan: true }));
      state.running = true;
      const next = () => {
        if (state.session !== session) return;
        const move = moves.shift();
        if (!move) {
          state.running = false;
          return redraw();
        }
        // Paused: the train waits too.
        if (state.paused) return setTimeout(next, 250);
        move();
        redraw();
        setTimeout(next, TRAIN_MS / 2);
      };
      next();
    }, "primary");
    go.id = "logic-mss-try-run";
    go.disabled = state.running || !start;
    main.append(go);

    // The pretend neighbours, one at each end.
    main.append(el("h4", "", TEXT.neighboursHeading), el("p", "hint", TEXT.neighboursHint));
    for (const n of session.neighbours()) {
      const box = el("div", "mss-neighbour");
      const f = ctx.field(TEXT.neighbourOn(n.end), n.on, (checked) => {
        session.setNeighbour(n.end, checked);
        Object.assign(state, { from: false, into: false });
        redraw(`#logic-mss-try-neighbour-${n.end}`);
      }, { checkbox: true });
      f.querySelector("input")?.setAttribute("id", `logic-mss-try-neighbour-${n.end}`);
      box.append(f);
      if (n.on) for (const t of n.tracks) box.append(neighbourStrip(session, n.end, t, n.tracks.length > 1, () => redraw()));
      main.append(box);
    }
    body.append(main);

    // The panel: the picked signal, and what happened.
    const panel = el("aside", "mss-try-panel");
    const m = session.view().masts.find((x) => x.name === state.picked);
    if (m) {
      panel.append(el("h4", "", TEXT.signalTitle(m.name)), el("p", "card-copy", m.aspect ? TEXT.shows(m.aspect, m.meaning) : TEXT.showsNothing));
      const why = global.EsphomeMrLogic?.explainMast?.(session.board, m.name);
      if (Array.isArray(why) && why.length) {
        panel.append(el("h5", "", TEXT.why));
        for (const line of why.slice(0, 6)) panel.append(el("p", "hint", inPictureWords(typeof line === "string" ? line : line?.text || "", blocks)));
      }
    } else panel.append(el("p", "hint", TEXT.pickSignal));
    panel.append(el("h5", "", TEXT.happened));
    const entries = session.view().log.slice(-12).reverse();
    if (!entries.length) panel.append(el("p", "hint", TEXT.nothingYet));
    const log = el("ul", "plan-log");
    for (const entry of entries) log.append(el("li", "", `${TEXT.time(entry.time / 1000)}: ${inPictureWords(entry.text, blocks)}`));
    panel.append(log);
    body.append(panel);
    card.append(body);
    startClock(() => redraw());
  }

  global.EsphomeMrLogicUiMssTry = { TEXT, PART, TRAIN_MS, trainStarts, trainRoute, blocksOf, inPictureWords, headsFor, showMe };

  if (global.EsphomeMrLogicUi) {
    global.EsphomeMrLogicUi.registerPart({
      id: PART, order: 6, modes: ["mss"], text: TEXT,
      show: (config) => F()?.currentStep(config) === "try",
      render,
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
