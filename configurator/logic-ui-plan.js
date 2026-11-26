// The Logic page's track plan (docs/field-logic-plan-spec.md; work item TP 3):
// a grid you draw the track on, then pick things on it to name blocks, give
// them sensors, stand signals at block breaks and say what is beyond each end.
// Changes are made by plan-edit.js; plan-builder.js turns the drawing into the
// rules. The layout and picking are pure (layout, pick), checked by
// test/plan-editor.test.js; the render functions only draw them.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const E = () => global.EsphomeMrPlanEdit;
  const PART = "logic-plan";

  const TEXT = Object.freeze({
    card: "Track plan",
    intro: "Draw your track, then pick things on it: a piece of track to name its block, a point to stand a signal or set up a turnout, an end to say what is beyond it. The board works the signals out from the drawing.",
    tools: Object.freeze({ draw: "Draw", erase: "Erase", select: "Select" }),
    toolsLabel: "Drawing tools",
    hints: Object.freeze({
      draw: "Drag from one grid point to another, or click the first and then the second.",
      erase: "Click a piece of track to take it away, or drag along several.",
      select: "Click a piece of track, a point, a signal or an end of the track.",
    }),
    start: "Draw your track. Start at one end and drag to the other.",
    keys: "With the keyboard: click the grid or tab to it, move with the arrow keys and press Enter.",
    gridLabel: "Track plan drawing",
    cursorAt: (x, y) => `Grid point ${x}, ${y}`,
    noSensor: "no sensor",
    plainEnd: "plain track",
    unset: "?",
    directions: Object.freeze({
      "1,0": "right", "-1,0": "left", "0,1": "down", "0,-1": "up",
      "1,1": "down and right", "-1,1": "down and left", "1,-1": "up and right", "-1,-1": "up and left",
    }),
    nothing: "Nothing is selected.",
    trackTitle: (name) => (name ? `Block ${name}` : "Track with no block"),
    blockName: "Block name",
    blockNameHint: "The track between block breaks. It is also the name JMRI sees.",
    blockTopic: "MQTT topic",
    blockTopicHint: "Where this block reports occupied or clear. Left empty, it follows the name.",
    blockSensors: "Sensors in this block",
    blockSensorsHint: "A block with no sensor is drawn dashed: nothing sees a train there. Ticking a sensor names the block.",
    nameBlock: "Name this block",
    newBlock: (n) => `Track ${n}`,
    removeBlock: "Remove the block",
    direction: "Trains run",
    bothWays: "Both ways",
    only: (way) => `Only ${way}`,
    directionHint: "One way applies up to the next turnout, crossing or end.",
    noSensors: "Add sensors on the Sensors page, or link a board, then tick them here.",
    otherBoard: (board) => `From ${board}`,
    missing: (name) => `${name} (not found)`,
    oneTrain: "One train at a time",
    oneTrainAdd: "Make this block one train at a time",
    oneTrainHint: "Only one train may be in it. Each signal leading in clears for a train waiting at it, and holds the track until that train has gone through.",
    oneTrainNeedsSensor: "Give this block a sensor to make it one train at a time.",
    sectionName: (n, block) => (n > 1 ? `${block} section ${n}` : `${block} section`),
    sectionNameLabel: "Section name",
    sectionNameHint: "Shown in the logs and on the board's web page. Two sections cannot share a name.",
    sectionBlocks: "Blocks in this section",
    entrances: "Ways in found on your drawing",
    entrance: (mast, waiting) => (waiting ? `${mast}, for a train waiting in ${waiting}` : `${mast}, with no sensor to see a train waiting`),
    moreOptions: "More options",
    freeAfter: "Free it when clear for",
    holdAfter: "Hold after cancelling",
    holdAfterHint: "Keep the section for a while if a signal drops in front of a train. Railways call this approach locking.",
    off: "Off",
    seconds: (n) => (n === 1 ? "1 second" : `${n} seconds`),
    removeSection: "Stop taking one train at a time",
    clashesTitle: "Track two trains can get onto",
    clashNoBlocks: "Give the track they share a block with a sensor, so it can be taken one train at a time.",
    clashFix: (blocks) => `Make ${blocks} one train at a time`,
    pointTitle: Object.freeze({ plain: "Point on the track", turnout: "Where three lines meet", crossing: "Crossing", end: "End of the track" }),
    turnout: "Turnout",
    turnoutPick: "Pick one…",
    turnoutNone: "No turnout: two tracks that join, as on a gauntlet",
    turnoutHint: "Add turnouts on the Turnouts page.",
    straight: "Straight line goes",
    straightAuto: "Pick one…",
    straightInLine: "The line that carries straight on",
    straightIs: "Turnout is straight when",
    closed: "Closed",
    thrown: "Thrown",
    crossingNote: "Two lines cross here. Trains run straight through.",
    addBreak: "Add a block break",
    removeBreak: "Remove the block break",
    removeBreakNote: "Removing it also removes its signals and joins the two blocks.",
    breakSensors: "Sensors at this break",
    breakSensorsHint: "A sensor at a boundary holds the blocks on both sides.",
    signal: (way) => `Signal for trains heading ${way}`,
    noSignal: "No signal",
    signalHint: "A signal stands at a block break. Picking one adds the break.",
    noMasts: "Add signals on the Signal Masts page, then pick them here.",
    editTrack: (way) => `Pick the track going ${way}`,
    beyond: "Beyond this end",
    beyondSignalled: "End of signalled track: the signal before it shows Approach at best",
    beyondPlain: "Plain track, no more signals: the signal before it can show Clear",
    beyondBoard: "Another board",
    beyondNoBoard: "To pick another board, link it under Linked boards first.",
    beyondBoardName: "Board",
    beyondMast: "Its next signal",
    beyondBlocks: "Its blocks that must be clear",
    beyondNoBlocks: "That board has no blocks on its Logic page.",
  });

  // ===== Pure: the layout ===================================================

  const CELL = 48;
  const key = (p) => `${p[0]},${p[1]}`;
  const wayWords = (from, to) => TEXT.directions[`${Math.sign(to[0] - from[0])},${Math.sign(to[1] - from[1])}`];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  // The unit vector from one point towards another.
  function toward(from, to) {
    const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
    const size = Math.hypot(dx, dy) || 1;
    return [dx / size, dy / size];
  }

  /**
   * The picture, in grid units: { view: { x, y, w, h }, pieces, blocks, breaks,
   * signals, points, ends, arrows, sections }.
   */
  function layout(config) {
    // Where signals and their names lie, so block names keep clear of them.
    const taken = list(config?.logic?.plan?.breaks).filter((b) => isObject(b) && Array.isArray(b.at)).flatMap((brk) => list(brk.signals)
      .filter((s) => isObject(s) && Array.isArray(s.facing))
      .map((s) => {
        const way = toward(brk.at, s.facing);
        const [x, y] = [brk.at[0] + way[1] * 0.55, brk.at[1] - way[0] * 0.55];
        // The name runs back from the head, about 7 pixels a letter.
        const end = x - (Math.sign(way[0]) || -1) * ((String(s.mast ?? "").length * 7 + 14) / CELL);
        return { x1: Math.min(x, end) - 0.2, x2: Math.max(x, end) + 0.2, y };
      }));
    // Whether a name under the middle of a piece would lie over a signal.
    const crowded = (m) => taken.some((t) => Math.abs(t.y - m[1] - 0.45) < 0.4 && m[0] + 0.4 > t.x1 && m[0] - 0.4 < t.x2);
    const plan = config?.logic?.plan;
    const g = E().graph(plan);
    const nodes = [...g.near.keys()].map((k) => k.split(",").map(Number));
    const xs = nodes.map((p) => p[0]);
    const ys = nodes.map((p) => p[1]);
    // At least one spare cell all round, and room to draw to the right and below.
    const x = Math.min(-1, ...xs.map((v) => v - 1));
    const y = Math.min(-2, ...ys.map((v) => v - 2));
    const view = { x, y, w: Math.max(15, ...xs.map((v) => v + 3)) - x, h: Math.max(6, ...ys.map((v) => v + 3)) - y };

    const blocks = [];
    const blockOf = new Map(); // piece key -> block
    for (const def of list(plan?.blocks).filter(isObject)) {
      const first = def.at;
      if (!Array.isArray(first)) continue;
      const from = first[0];
      const to = first[1];
      if (!Array.isArray(from) || !Array.isArray(to)) continue;
      const next = [from[0] + Math.sign(to[0] - from[0]), from[1] + Math.sign(to[1] - from[1])];
      const pieces = E().stretchOfBlock(config, from, next);
      if (!pieces.length) continue;
      const middles = pieces.map(([a, b]) => mid(a, b));
      const centre = [0, 1].map((i) => middles.reduce((sum, m) => sum + m[i], 0) / middles.length);
      // The label goes on the piece nearest the middle, level pieces first,
      // away from signals. With no clear place below, it goes above.
      const score = (m, i) => Math.hypot(m[0] - centre[0], m[1] - centre[1]) + (pieces[i][0][1] === pieces[i][1][1] ? 0 : 0.25) + (crowded(m) ? 3 : 0);
      const best = middles.map(score).reduce((at, v, i, all) => (v < all[at] ? i : at), 0);
      const block = { name: String(def.name ?? ""), detected: list(def.sensors).length > 0, label: middles[best], above: crowded(middles[best]) };
      blocks.push(block);
      for (const [a, b] of pieces) blockOf.set([key(a), key(b)].sort().join("|"), block);
    }
    // A break's sensor holds the blocks on both sides.
    for (const brk of list(plan?.breaks).filter((b) => isObject(b) && list(b.sensors).length && Array.isArray(b.at))) {
      for (const other of E().neighbours(config, brk.at)) {
        const block = blockOf.get([key(brk.at), key(other)].sort().join("|"));
        if (block) block.detected = true;
      }
    }

    const pieces = [...g.pieces].map((piece) => {
      const [a, b] = piece.split("|").map((k) => k.split(",").map(Number));
      const block = blockOf.get(piece);
      return { a, b, block: block?.name || "", detected: !!block?.detected };
    });

    const breaks = [];
    const signals = [];
    for (const brk of list(plan?.breaks).filter((b) => isObject(b) && Array.isArray(b.at))) {
      const next = E().neighbours(config, brk.at);
      if (!next.length) continue;
      const along = toward(brk.at, next[0]);
      breaks.push({ at: brk.at, across: [-along[1], along[0]] });
      for (const signal of list(brk.signals).filter((s) => isObject(s) && Array.isArray(s.facing))) {
        const way = toward(brk.at, signal.facing);
        // On the train's left.
        const side = [way[1], -way[0]];
        signals.push({
          at: brk.at, mast: String(signal.mast ?? ""), way, side,
          head: [brk.at[0] + side[0] * 0.55, brk.at[1] + side[1] * 0.55],
        });
      }
    }

    const settings = new Map(list(plan?.points).filter((p) => isObject(p) && Array.isArray(p.at)).map((p) => [key(p.at), p]));
    const ends = new Map(list(plan?.ends).filter((e) => isObject(e) && Array.isArray(e.at)).map((e) => [key(e.at), e.beyond]));
    const points = [];
    const outEnds = [];
    for (const at of nodes) {
      const next = g.near.get(key(at));
      if (next.length === 3) {
        const set = settings.get(key(at));
        points.push({ at, label: set ? String(set.turnout ?? "") : TEXT.unset, unset: !set });
      } else if (next.length === 1) {
        const beyond = ends.get(key(at));
        const label = beyond === "plain" ? TEXT.plainEnd : isObject(beyond) ? String(beyond.board ?? "") : "";
        const from = next[0].split(",").map(Number);
        const way = toward(from, at);
        outEnds.push({ at, way, label });
      }
    }

    const arrows = list(plan?.arrows).filter((a) => isObject(a) && Array.isArray(a.from) && Array.isArray(a.to)).map((arrow) => {
      const way = toward(arrow.from, arrow.to);
      const step = [Math.sign(arrow.to[0] - arrow.from[0]), Math.sign(arrow.to[1] - arrow.from[1])];
      return { at: mid(arrow.from, [arrow.from[0] + step[0], arrow.from[1] + step[1]]), way };
    });

    // Each section's track, and where its label goes: over its middle.
    const sections = list(plan?.sections).filter(isObject).map((section) => {
      const inside = pieces.filter((piece) => piece.block && list(section.blocks).includes(piece.block));
      if (!inside.length) return null;
      const ends = inside.flatMap((piece) => [piece.a, piece.b]);
      const across = ends.map((p) => p[0]);
      return {
        name: String(section.name ?? ""),
        pieces: inside.map(({ a, b }) => ({ a, b })),
        label: [(Math.min(...across) + Math.max(...across)) / 2, Math.min(...ends.map((p) => p[1])) - 0.55],
      };
    }).filter(Boolean);

    return { view, pieces, blocks, breaks, signals, points, ends: outEnds, arrows, sections };
  }

  /**
   * What is at a place on the drawing, in grid units: { kind: "point", at },
   * { kind: "piece", a, b } or null. A signal picks the point it stands at.
   */
  function pick(shape, x, y) {
    const distance = (p) => Math.hypot(p[0] - x, p[1] - y);
    const signal = shape.signals.find((s) => distance(s.head) <= 0.3);
    if (signal) return { kind: "point", at: signal.at };
    const nodes = shape.pieces.flatMap((p) => [p.a, p.b]);
    const point = nodes.find((p) => distance(p) <= 0.28);
    if (point) return { kind: "point", at: point };
    let best = null;
    for (const { a, b } of shape.pieces) {
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
      const d = distance([a[0] + dx * t, a[1] + dy * t]);
      if (d <= 0.35 && (!best || d < best.d)) best = { d, a, b };
    }
    return best ? { kind: "piece", a: best.a, b: best.b } : null;
  }

  // ===== The page ===========================================================

  const SVG = "http://www.w3.org/2000/svg";
  // What the person is doing: kept while the page is drawn again.
  const state = { tool: null, start: null, cursor: [0, 0], selected: null, scroll: [0, 0], board: null, more: false };

  function svg(tag, attrs = {}, text) {
    const node = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(text, onClick, className = "") {
    const b = el("button", className, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  const px = (v) => Math.round(v * CELL * 10) / 10;

  function drawPicture(config, shape, tool) {
    const { view } = shape;
    const drawing = svg("svg", {
      id: "logic-plan-grid", class: `plan-grid is-${tool}`, tabindex: 0, role: "application", "aria-label": TEXT.gridLabel,
      viewBox: `${px(view.x - 0.5)} ${px(view.y - 0.5)} ${px(view.w)} ${px(view.h)}`, width: px(view.w), height: px(view.h),
    });
    for (let x = view.x; x < view.x + view.w; x += 1) {
      for (let y = view.y; y < view.y + view.h; y += 1) drawing.append(svg("circle", { class: "plan-dot", cx: px(x), cy: px(y), r: 1.5 }));
    }
    const selected = state.selected;
    const chosen = new Set(selected?.kind === "piece" ? E().stretchOfBlock(config, selected.a, selected.b).map(([a, b]) => [key(a), key(b)].sort().join("|")) : []);
    const line = (a, b, className) => svg("line", { class: className, x1: px(a[0]), y1: px(a[1]), x2: px(b[0]), y2: px(b[1]) });
    // Sections lie under the track.
    for (const section of shape.sections) {
      for (const piece of section.pieces) drawing.append(line(piece.a, piece.b, "plan-section"));
      drawing.append(svg("text", { class: "plan-section-name", x: px(section.label[0]), y: px(section.label[1]), "text-anchor": "middle" }, TEXT.oneTrain));
    }
    for (const piece of shape.pieces) {
      const picked = chosen.has([key(piece.a), key(piece.b)].sort().join("|"));
      drawing.append(line(piece.a, piece.b, `plan-rail${piece.detected ? "" : " is-undetected"}${picked ? " is-selected" : ""}`));
    }
    for (const arrow of shape.arrows) {
      const [x, y] = [px(arrow.at[0]), px(arrow.at[1])];
      const angle = Math.atan2(arrow.way[1], arrow.way[0]) * (180 / Math.PI);
      drawing.append(svg("path", { class: "plan-arrow", d: "M-7 -8 L9 0 L-7 8 Z", transform: `translate(${x} ${y}) rotate(${angle})` }));
    }
    for (const brk of shape.breaks) {
      const [dx, dy] = brk.across;
      drawing.append(line([brk.at[0] - dx * 0.25, brk.at[1] - dy * 0.25], [brk.at[0] + dx * 0.25, brk.at[1] + dy * 0.25], "plan-break"));
    }
    for (const block of shape.blocks) {
      const [x, y] = [px(block.label[0]), px(block.label[1])];
      const note = !block.detected;
      drawing.append(svg("text", { class: "plan-block-name", x, y: block.above ? y - (note ? 28 : 14) : y + 22, "text-anchor": "middle" }, block.name));
      if (note) drawing.append(svg("text", { class: "plan-note", x, y: block.above ? y - 14 : y + 36, "text-anchor": "middle" }, TEXT.noSensor));
    }
    for (const point of shape.points) {
      const [x, y] = [px(point.at[0]), px(point.at[1])];
      drawing.append(svg("circle", { class: `plan-join${point.unset ? " is-unset" : ""}`, cx: x, cy: y, r: point.unset ? 9 : 5 }));
      if (point.label) drawing.append(svg("text", { class: `plan-point-name${point.unset ? " is-unset" : ""}`, x, y: y - 13, "text-anchor": "middle" }, point.label));
    }
    for (const end of shape.ends) {
      const [x, y] = [px(end.at[0]), px(end.at[1])];
      drawing.append(svg("circle", { class: "plan-end", cx: x, cy: y, r: 4 }));
      if (end.label) drawing.append(svg("text", { class: "plan-note", x, y: y - 12, "text-anchor": end.way[0] > 0 ? "end" : end.way[0] < 0 ? "start" : "middle" }, end.label));
    }
    for (const signal of shape.signals) {
      const [x, y] = [px(signal.head[0]), px(signal.head[1])];
      drawing.append(line(signal.at, signal.head, "plan-post"));
      drawing.append(svg("circle", { class: "plan-lamp", cx: x, cy: y, r: 8 }));
      // The arrow shows which way its trains head.
      const angle = Math.atan2(signal.way[1], signal.way[0]) * (180 / Math.PI);
      drawing.append(svg("path", { class: "plan-heading", d: "M-3 -4 L5 0 L-3 4 Z", transform: `translate(${x} ${y}) rotate(${angle})` }));
      const [tx, ty, anchor] = Math.abs(signal.side[1]) > 0.5
        ? [x - Math.sign(signal.way[0] || 1) * 14, y + 4, signal.way[0] >= 0 ? "end" : "start"]
        : [x + Math.sign(signal.side[0]) * 14, y + 4, signal.side[0] > 0 ? "start" : "end"];
      drawing.append(svg("text", { class: "plan-signal-name", x: tx, y: ty, "text-anchor": anchor }, signal.mast));
    }
    if (selected?.kind === "point") drawing.append(svg("circle", { class: "plan-picked", cx: px(selected.at[0]), cy: px(selected.at[1]), r: 13 }));
    if (state.start) drawing.append(svg("circle", { class: "plan-start", cx: px(state.start[0]), cy: px(state.start[1]), r: 9 }));
    drawing.append(svg("circle", { class: "plan-cursor", cx: px(state.cursor[0]), cy: px(state.cursor[1]), r: 7 }));
    drawing.append(svg("polyline", { class: `plan-preview is-${tool}`, points: "" }));
    return drawing;
  }

  // Draw the page again, keeping the keyboard where it was.
  function redraw(ctx, focus) {
    ctx.render();
    if (focus) document.querySelector(focus)?.focus({ preventScroll: true });
  }

  function changed(ctx, focus) {
    ctx.persist();
    redraw(ctx, focus);
  }

  // The mouse and keyboard on the grid.
  function listen(drawing, config, ctx, shape, tool) {
    const where = (event) => {
      const box = drawing.getBoundingClientRect();
      const { view } = shape;
      return [view.x - 0.5 + ((event.clientX - box.left) / box.width) * view.w, view.y - 0.5 + ((event.clientY - box.top) / box.height) * view.h];
    };
    const nearest = ([x, y]) => [Math.round(x) || 0, Math.round(y) || 0];
    const preview = (from, to) => {
      const corners = E().path(config, from, to);
      drawing.querySelector(".plan-preview").setAttribute("points", corners.map((p) => `${px(p[0])},${px(p[1])}`).join(" "));
    };
    const finish = (from, to) => {
      state.start = null;
      state.cursor = to;
      const did = tool === "erase" ? E().erase(config, from, to) : E().draw(config, from, to);
      if (did) changed(ctx, "#logic-plan-grid");
      else redraw(ctx, "#logic-plan-grid");
    };
    // One end of a line, picked by clicking or Enter.
    const mark = (point) => {
      state.cursor = point;
      if (!state.start) state.start = point;
      else if (key(state.start) !== key(point)) return finish(state.start, point);
      else state.start = null;
      redraw(ctx, "#logic-plan-grid");
    };
    const select = (found) => {
      state.selected = found;
      redraw(ctx, "#logic-plan-grid");
    };

    let down = null;
    drawing.addEventListener("pointerdown", (event) => {
      if (event.button) return;
      down = where(event);
      drawing.setPointerCapture?.(event.pointerId);
    });
    drawing.addEventListener("pointermove", (event) => {
      if (tool === "select") return;
      const from = down ? nearest(down) : state.start;
      if (from) preview(from, nearest(where(event)));
    });
    drawing.addEventListener("pointercancel", () => { down = null; });
    drawing.addEventListener("pointerup", (event) => {
      if (!down) return;
      const [first, last] = [down, where(event)];
      down = null;
      const [from, to] = [nearest(first), nearest(last)];
      if (tool === "select") {
        state.cursor = to;
        select(pick(shape, ...last));
      } else if (key(from) !== key(to)) {
        finish(from, to);
      } else {
        const found = tool === "erase" && !state.start ? pick(shape, ...last) : null;
        if (found?.kind === "piece") finish(found.a, found.b);
        else mark(to);
      }
    });
    drawing.addEventListener("keydown", (event) => {
      const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      const { view } = shape;
      if (move) {
        event.preventDefault();
        state.cursor = [
          Math.max(view.x, Math.min(view.x + view.w - 1, state.cursor[0] + move[0])),
          Math.max(view.y, Math.min(view.y + view.h - 1, state.cursor[1] + move[1])),
        ];
        const cursor = drawing.querySelector(".plan-cursor");
        cursor.setAttribute("cx", px(state.cursor[0]));
        cursor.setAttribute("cy", px(state.cursor[1]));
        drawing.setAttribute("aria-label", `${TEXT.gridLabel}. ${TEXT.cursorAt(...state.cursor)}`);
        if (tool !== "select" && state.start) preview(state.start, state.cursor);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (tool === "select") select(pick(shape, ...state.cursor));
        else mark(state.cursor);
      } else if (event.key === "Escape") {
        state.start = null;
        state.selected = null;
        redraw(ctx, "#logic-plan-grid");
      }
    });
  }

  // ===== The panel for what is picked =======================================

  function choice(ctx, id, label, value, options, onPick, hint) {
    const field = ctx.field(label, value, (v) => {
      onPick(v);
      changed(ctx, `#${id}`);
    }, { select: options, hint, full: true });
    field.querySelector("select").id = id;
    return field;
  }

  // Ticks for a list of stored members: names, or { board, sensor }.
  function ticks(ctx, id, label, groups, chosen, onChange, hint) {
    const L = global.EsphomeMrLogicYaml;
    const box = el("fieldset", "plan-ticks full");
    box.append(el("legend", "field-label", label));
    const keys = new Set(chosen.map((member) => L.memberKey(member)));
    const offered = new Set(groups.flatMap((group) => group.options.map((o) => L.memberKey(o.value))));
    const gone = chosen.filter((member) => !offered.has(L.memberKey(member)))
      .map((member) => ({ value: member, text: TEXT.missing(typeof member === "string" ? member : member.sensor ?? member.block ?? "?") }));
    let n = 0;
    for (const group of [...groups, ...(gone.length ? [{ label: "", options: gone }] : [])]) {
      if (group.label) box.append(el("span", "plan-tick-group", group.label));
      for (const option of group.options) {
        const row = el("label", "plan-tick");
        const input = el("input");
        input.type = "checkbox";
        input.id = `${id}-${n}`;
        n += 1;
        input.checked = keys.has(L.memberKey(option.value));
        input.addEventListener("change", () => {
          const rest = chosen.filter((member) => L.memberKey(member) !== L.memberKey(option.value));
          onChange(input.checked ? [...rest, option.value] : rest);
          changed(ctx, `#${input.id}`);
        });
        row.append(input, el("span", "", option.text));
        box.append(row);
      }
    }
    if (hint) box.append(ctx.hintEl(hint));
    return box;
  }

  function sensorGroups(config, ui) {
    return ui.itemChoices(config, "sensor", { remote: true });
  }

  const RELEASES = Object.freeze(["1s", "2s", "3s", "5s", "10s", "20s"]);
  const HOLDS = Object.freeze(["5s", "10s", "20s", "30s", "60s"]);

  // Times offered, with the stored one kept even if it is not among them.
  const times = (values, current) => [...new Set([...values, ...(current ? [current] : [])])]
    .map((value) => ({ value, label: /^[\d.]+s$/.test(value) ? TEXT.seconds(parseFloat(value)) : value }));

  // One train at a time, for the block picked.
  function sectionPart(panel, config, ctx, ui, block) {
    const box = el("div", "plan-section-part");
    panel.append(box);
    const section = E().sectionOf(config, block.name);
    if (!section) {
      if (!list(block.sensors).length) {
        box.append(el("p", "hint", TEXT.oneTrainNeedsSensor));
        return;
      }
      const add = button(TEXT.oneTrainAdd, () => {
        E().addSection(config, [block.name], (first, n) => TEXT.sectionName(n, first));
        changed(ctx, "#logic-plan-section-name");
      });
      add.id = "logic-plan-section-add";
      box.append(add, ctx.hintEl(TEXT.oneTrainHint));
      return;
    }
    const name = section.name;
    box.append(el("h4", "", TEXT.oneTrain), ui.paragraph(TEXT.oneTrainHint, "hint"));
    const look = global.EsphomeMrPlanBuilder.look(config);
    for (const problem of look.problems.filter((p) => p.where.section === name)) {
      box.append(el("p", "linked-warning", problem.text));
    }
    const found = look.sections.find((s) => s.name === name);
    if (found) {
      box.append(el("span", "field-label", TEXT.entrances));
      const items = el("ul", "plan-entrances");
      for (const way of found.entrances) items.append(el("li", "", TEXT.entrance(way.mast, way.waiting)));
      box.append(items);
    }

    const fields = el("div", "fields");
    const nameField = ctx.field(TEXT.sectionNameLabel, name, () => {}, { hint: TEXT.sectionNameHint, full: true });
    const input = nameField.querySelector("input");
    input.id = "logic-plan-section-name";
    input.addEventListener("change", () => {
      E().setSection(config, name, { name: input.value.trim() });
      changed(ctx, "#logic-plan-section-name");
    });
    fields.append(nameField);
    // Blocks a train can be seen in, that no other section has.
    const free = list(config.logic.plan.blocks)
      .filter((b) => isObject(b) && b.name && list(b.sensors).length && [null, section].includes(E().sectionOf(config, b.name)))
      .map((b) => b.name);
    fields.append(ticks(ctx, "logic-plan-section-block", TEXT.sectionBlocks,
      [{ label: "", options: free.map((b) => ({ value: b, text: b })) }], list(section.blocks),
      (blocks) => E().setSection(config, name, { blocks })));
    box.append(fields);

    const more = el("details", "plan-more");
    more.open = state.more;
    // Noted on the click itself: the "toggle" event can come after the next redraw.
    const summary = el("summary", "", TEXT.moreOptions);
    summary.addEventListener("click", () => { state.more = !more.open; });
    more.append(summary);
    const inner = el("div", "fields");
    const release = String(section.release || "3s");
    inner.append(choice(ctx, "logic-plan-section-release", TEXT.freeAfter, release, times(RELEASES, release),
      (v) => E().setSection(config, name, { release: v === "3s" ? "" : v })));
    const hold = String(section.approachLock || "");
    inner.append(choice(ctx, "logic-plan-section-hold", TEXT.holdAfter, hold, [{ value: "", label: TEXT.off }, ...times(HOLDS, hold)],
      (v) => E().setSection(config, name, { approachLock: v }), TEXT.holdAfterHint));
    more.append(inner);
    box.append(more, button(TEXT.removeSection, () => {
      E().removeSection(config, name);
      changed(ctx, "#logic-plan-section-add");
    }, "remove"));
  }

  // Signals that can still send two trains onto one track, each with the way
  // to stop it when the drawing shows one.
  function clashes(config, ctx) {
    const found = global.EsphomeMrPlanBuilder.look(config).problems.filter((p) => Array.isArray(p.where.blocks));
    const box = el("div", found.length ? "plan-clashes" : "plan-clashes is-empty");
    if (!found.length) return box;
    box.append(el("h4", "", TEXT.clashesTitle));
    const offered = new Set();
    for (const problem of found) {
      box.append(el("p", "linked-warning", problem.text));
      const blocks = problem.where.blocks;
      const key = JSON.stringify(blocks);
      if (!blocks.length) box.append(ctx.hintEl(TEXT.clashNoBlocks));
      // Not when they are already one section: that did not settle it.
      const held = new Set(blocks.map((b) => E().sectionOf(config, b)));
      if (!blocks.length || offered.has(key) || (held.size === 1 && !held.has(null))) continue;
      offered.add(key);
      box.append(button(TEXT.clashFix(blocks.join(", ")), () => {
        E().addSection(config, blocks, (first, n) => TEXT.sectionName(n, first));
        // Pick its track, so the section shows.
        const shape = layout(config);
        const named = shape.blocks.find((b) => b.name === blocks[0]);
        state.selected = named ? pick(shape, ...named.label) : null;
        changed(ctx, "#logic-plan-section-name");
      }));
    }
    return box;
  }

  function trackPanel(panel, config, ctx, ui, { a, b }, repaint) {
    const block = E().blockAt(config, a, b);
    const title = el("h4", "", TEXT.trackTitle(block?.name));
    panel.append(title);
    const fields = el("div", "fields");
    const newName = () => E().freeBlockName(config, TEXT.newBlock);
    const nameField = ctx.field(TEXT.blockName, block?.name || "", () => {}, { hint: TEXT.blockNameHint, full: true });
    const input = nameField.querySelector("input");
    input.id = "logic-plan-block-name";
    // Kept once typing is finished: sections follow the name. Only the
    // picture is drawn again, so a click that ends the typing is not lost.
    input.addEventListener("change", () => {
      E().setBlock(config, a, b, { name: input.value.trim() });
      ctx.persist();
      ctx.refresh();
      const name = E().blockAt(config, a, b)?.name;
      input.value = name || "";
      title.textContent = TEXT.trackTitle(name);
      if (name) end.replaceWith((end = endButton()));
      repaint();
      // A block just named can be taken one train at a time.
      if (name) {
        panel.querySelector(".plan-section-part")?.remove();
        sectionPart(panel, config, ctx, ui, E().blockAt(config, a, b));
      }
    });
    fields.append(nameField);
    if (block) {
      const topicField = ctx.field(TEXT.blockTopic, block.topic || "", (value) => {
        E().setBlock(config, a, b, { topic: value.trim() });
        ctx.persist();
      }, { hint: TEXT.blockTopicHint, full: true, spellcheck: false });
      topicField.querySelector("input").placeholder = global.EsphomeMr.topicFor("block", block.name);
      fields.append(topicField);
    }
    const groups = sensorGroups(config, ui);
    const members = list(block?.sensors);
    if (groups.length || members.length) {
      fields.append(ticks(ctx, "logic-plan-sensor", TEXT.blockSensors, groups, members, (sensors) => {
        E().setBlock(config, a, b, E().blockAt(config, a, b) ? { sensors } : { name: newName(), sensors });
      }, TEXT.blockSensorsHint));
    } else fields.append(ctx.hintEl(TEXT.noSensors));
    const towards = E().directionAt(config, a, b);
    const value = !towards ? "" : key(towards) === key(b) ? "b" : "a";
    fields.append(choice(ctx, "logic-plan-direction", TEXT.direction, value, [
      { value: "", label: TEXT.bothWays },
      { value: "b", label: TEXT.only(wayWords(a, b)) },
      { value: "a", label: TEXT.only(wayWords(b, a)) },
    ], (v) => E().setDirection(config, a, b, v === "a" ? a : v === "b" ? b : null), TEXT.directionHint));
    panel.append(fields);
    const endButton = () => (E().blockAt(config, a, b)
      ? button(TEXT.removeBlock, () => { E().removeBlock(config, a, b); changed(ctx, "#logic-plan-grid"); }, "remove")
      : button(TEXT.nameBlock, () => { E().setBlock(config, a, b, { name: newName() }); changed(ctx, "#logic-plan-block-name"); }));
    let end = endButton();
    panel.append(end);
    if (block) sectionPart(panel, config, ctx, ui, block);
  }

  // The buttons that pick the track either side of a point.
  function trackButtons(panel, config, ctx, at) {
    const row = el("div", "plan-track-buttons");
    for (const other of E().neighbours(config, at)) {
      row.append(button(TEXT.editTrack(wayWords(at, other)), () => {
        state.selected = { kind: "piece", a: at, b: other };
        redraw(ctx, "#logic-plan-block-name");
      }));
    }
    panel.append(row);
  }

  function turnoutFields(fields, config, ctx, at) {
    const plan = config.logic.plan;
    const set = list(plan.points).find((p) => isObject(p) && key(p.at ?? [NaN, NaN]) === key(at));
    const names = list(config.points).map((p) => p.name).filter(Boolean);
    const stored = !set ? "?" : set.turnout === null ? "" : `=${set.turnout}`;
    const options = [{ value: "?", label: TEXT.turnoutPick }, { value: "", label: TEXT.turnoutNone }, ...names.map((name) => ({ value: `=${name}`, label: name }))];
    if (!options.some((o) => o.value === stored)) options.push({ value: stored, label: TEXT.missing(set.turnout) });
    fields.append(choice(ctx, "logic-plan-turnout", TEXT.turnout, stored, options,
      (v) => E().setPoint(config, at, { turnout: v === "?" ? undefined : v === "" ? null : v.slice(1) }),
      names.length ? undefined : TEXT.turnoutHint));
    if (!set?.turnout) return;
    // The two ways out of the turnout: every line but the one that leads to both.
    const next = E().neighbours(config, at);
    const unit = (to) => toward(at, to);
    const opens = (a, b) => unit(a)[0] * unit(b)[0] + unit(a)[1] * unit(b)[1] < -0.7; // 135 degrees or more
    const stem = next.find((s) => next.filter((o) => o !== s && opens(s, o)).length === 2);
    if (!stem) return;
    const ways = next.filter((p) => p !== stem);
    const inLine = ways.find((p) => unit(p)[0] * unit(stem)[0] + unit(p)[1] * unit(stem)[1] < -0.99);
    const picked = ways.find((p) => Array.isArray(set.straight) && wayWords(at, p) === wayWords(at, set.straight));
    fields.append(choice(ctx, "logic-plan-straight", TEXT.straight, picked ? key(picked) : "", [
      { value: "", label: inLine ? TEXT.straightInLine : TEXT.straightAuto },
      ...ways.map((p) => ({ value: key(p), label: wayWords(at, p) })),
    ], (v) => E().setPoint(config, at, { straight: ways.find((p) => key(p) === v) })));
    fields.append(choice(ctx, "logic-plan-straight-is", TEXT.straightIs, set.straightIs === "thrown" ? "thrown" : "closed", [
      { value: "closed", label: TEXT.closed }, { value: "thrown", label: TEXT.thrown },
    ], (v) => E().setPoint(config, at, { straightIs: v })));
  }

  // The masts a signal here can be: those not already elsewhere on the drawing.
  function mastOptions(config, current) {
    const used = new Set(list(config.logic.plan.breaks).flatMap((b) => list(b?.signals).map((s) => s?.mast)));
    const names = list(config.signals?.masts).map((m) => m.name).filter((name) => name && (name === current || !used.has(name)));
    const options = [{ value: "", label: TEXT.noSignal }, ...names.map((name) => ({ value: name, label: name }))];
    if (current && !names.includes(current)) options.push({ value: current, label: TEXT.missing(current) });
    return options;
  }

  function plainFields(panel, fields, config, ctx, ui, at) {
    const brk = E().breakAt(config.logic.plan, at);
    E().neighbours(config, at).forEach((other, i) => {
      const facing = (s) => isObject(s) && Array.isArray(s.facing) && wayWords(at, s.facing) === wayWords(at, other);
      const signal = list(brk?.signals).find(facing);
      const current = String(signal?.mast ?? "");
      fields.append(choice(ctx, `logic-plan-signal-${i}`, TEXT.signal(wayWords(at, other)), current, mastOptions(config, current),
        (v) => E().setSignal(config, at, signal ? signal.facing : other, v), i ? TEXT.signalHint : undefined));
    });
    if (!list(config.signals?.masts).length) fields.append(ctx.hintEl(TEXT.noMasts));
    if (brk) {
      const groups = sensorGroups(config, ui);
      const members = list(brk.sensors);
      if (groups.length || members.length) {
        fields.append(ticks(ctx, "logic-plan-break-sensor", TEXT.breakSensors, groups, members,
          (sensors) => E().setBreakSensors(config, at, sensors), TEXT.breakSensorsHint));
      }
    }
    panel.append(fields);
    if (!brk) panel.append(button(TEXT.addBreak, () => { E().addBreak(config, at); changed(ctx, "#logic-plan-remove-break"); }));
  }

  function endFields(fields, config, ctx, at) {
    const L = global.EsphomeMrLogicYaml;
    const beyond = list(config.logic.plan.ends).find((e) => isObject(e) && key(e.at ?? [NaN, NaN]) === key(at))?.beyond;
    const boards = L.linkedBoards(config).filter((board) => board.name);
    const kind = isObject(beyond) ? "board" : beyond === "plain" ? "plain" : "signalled";
    fields.append(choice(ctx, "logic-plan-beyond", TEXT.beyond, kind, [
      { value: "signalled", label: TEXT.beyondSignalled },
      { value: "plain", label: TEXT.beyondPlain },
      { value: "board", label: TEXT.beyondBoard, disabled: !boards.length && kind !== "board" },
    ], (v) => E().setEnd(config, at, v === "board" ? { board: boards[0].name, mast: "", blocks: [] } : v),
    boards.length ? undefined : TEXT.beyondNoBoard));
    if (kind !== "board") return;
    const names = boards.map((board) => board.name);
    const options = names.map((name) => ({ value: name, label: name }));
    if (!names.includes(beyond.board)) options.push({ value: beyond.board, label: TEXT.missing(beyond.board) });
    fields.append(choice(ctx, "logic-plan-beyond-board", TEXT.beyondBoardName, beyond.board, options,
      (v) => E().setEnd(config, at, { board: v, mast: "", blocks: [] })));
    const other = boards.find((board) => board.name === beyond.board);
    const masts = [...list(other?.signals?.masts), ...list(other?.logic?.masts)].map((m) => m?.name).filter(Boolean);
    const current = String(beyond.mast ?? "");
    const mastChoices = [{ value: "", label: TEXT.noSignal }, ...masts.map((name) => ({ value: name, label: name }))];
    if (current && !masts.includes(current)) mastChoices.push({ value: current, label: TEXT.missing(current) });
    fields.append(choice(ctx, "logic-plan-beyond-mast", TEXT.beyondMast, current, mastChoices,
      (v) => E().setEnd(config, at, { ...beyond, mast: v })));
    const blocks = list(other?.logic?.blocks).map((b) => b?.name).filter(Boolean);
    const chosen = list(beyond.blocks);
    if (blocks.length || chosen.length) {
      // A block here is kept by name only.
      fields.append(ticks(ctx, "logic-plan-beyond-block", TEXT.beyondBlocks,
        [{ label: "", options: blocks.map((name) => ({ value: name, text: name })) }], chosen,
        (picked) => E().setEnd(config, at, { ...beyond, blocks: picked })));
    } else fields.append(ctx.hintEl(TEXT.beyondNoBlocks));
  }

  function pointPanel(panel, config, ctx, ui, at) {
    const kind = E().kindAt(config, at);
    panel.append(el("h4", "", TEXT.pointTitle[kind] || TEXT.pointTitle.crossing));
    const fields = el("div", "fields");
    if (kind === "plain") plainFields(panel, fields, config, ctx, ui, at);
    else {
      if (kind === "turnout") turnoutFields(fields, config, ctx, at);
      else if (kind === "end") endFields(fields, config, ctx, at);
      else fields.append(ui.paragraph(TEXT.crossingNote, "card-copy full"));
      panel.append(fields);
    }
    // A break left where it cannot be (a line joined it later) can be removed too.
    if (E().breakAt(config.logic.plan, at)) {
      const remove = button(TEXT.removeBreak, () => { E().removeBreak(config, at); changed(ctx, "#logic-plan-grid"); }, "remove");
      remove.id = "logic-plan-remove-break";
      panel.append(remove, ctx.hintEl(TEXT.removeBreakNote));
    }
    trackButtons(panel, config, ctx, at);
  }

  // Drop a selection whose track has gone.
  function stillThere(config) {
    const s = state.selected;
    if (!s) return null;
    if (s.kind === "point") return E().kindAt(config, s.at) === "none" ? null : s;
    return E().stretchOfBlock(config, s.a, s.b).length ? s : null;
  }

  function renderPlan(root, config, ctx, ui) {
    // A different board: nothing is picked on it yet.
    if (state.board !== config) Object.assign(state, { board: config, tool: null, start: null, cursor: [0, 0], selected: null, scroll: [0, 0], more: false });
    const card = ui.card(PART, TEXT.card);
    card.append(ui.paragraph(TEXT.intro));
    const shape = layout(config);
    state.selected = stillThere(config);
    // With nothing drawn there is only drawing to do.
    const tool = shape.pieces.length ? state.tool || "select" : "draw";
    // Kept from the first draw, so the tool does not change under the person.
    state.tool = tool;

    const tools = el("div", "plan-tools");
    tools.setAttribute("role", "group");
    tools.setAttribute("aria-label", TEXT.toolsLabel);
    for (const name of Object.keys(TEXT.tools)) {
      const b = button(TEXT.tools[name], () => {
        state.tool = name;
        state.start = null;
        if (name !== "select") state.selected = null;
        redraw(ctx, `#logic-plan-tool-${name}`);
      });
      b.id = `logic-plan-tool-${name}`;
      b.setAttribute("aria-pressed", String(name === tool));
      tools.append(b);
    }
    const hint = !shape.pieces.length ? TEXT.start : TEXT.hints[tool];
    card.append(tools, ui.paragraph(`${hint} ${TEXT.keys}`, "hint"));

    const wrap = el("div", "plan-wrap");
    const picture = (drawn) => {
      const drawing = drawPicture(config, drawn, tool);
      listen(drawing, config, ctx, drawn, tool);
      return drawing;
    };
    wrap.append(picture(shape));
    // The picture, and what names it: drawn again without the rest of the page.
    const repaint = () => {
      wrap.querySelector("svg").replaceWith(picture(layout(config)));
      card.querySelector(".plan-clashes")?.replaceWith(clashes(config, ctx));
    };
    wrap.addEventListener("scroll", () => { state.scroll = [wrap.scrollLeft, wrap.scrollTop]; });
    card.append(wrap);

    if (tool === "select") {
      card.append(clashes(config, ctx));
      const panel = el("div", "plan-panel");
      if (!state.selected) panel.append(el("p", "hint", TEXT.nothing));
      else if (state.selected.kind === "piece") trackPanel(panel, config, ctx, ui, state.selected, repaint);
      else pointPanel(panel, config, ctx, ui, state.selected.at);
      card.append(panel);
    }
    root.append(card);
    // Once the whole page is drawn: laying it out part way would move the page.
    const [left, top] = state.scroll;
    if ((left || top) && typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => { wrap.scrollLeft = left; wrap.scrollTop = top; });
    }
  }

  global.EsphomeMrLogicUiPlan = { TEXT, PART, CELL, layout, pick };

  if (global.EsphomeMrLogicUi) {
    global.EsphomeMrLogicUi.registerPart({ id: PART, order: 33, modes: ["field"], text: TEXT, render: renderPlan });
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
