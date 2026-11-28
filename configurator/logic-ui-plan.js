// The Field Logic page's drawing (docs/field-logic-plan-spec.md; work items
// TP 3 and TP 6): a grid you draw the track on, and a panel for what is
// picked on it, which follows the page's step (logic-ui-field.js): settle the
// joins, cut the track into blocks and give them sensors, stand signals at
// block breaks and say what is beyond each end, then read what protects each
// block. Sensors, turnouts and signals can be made where they go. Problems are
// marked on the drawing. Changes are made by plan-edit.js; plan-builder.js
// turns the drawing into the rules. The layout, picking and marks are pure
// (layout, pick, marks), checked by test/plan-editor.test.js and
// test/plan-page.test.js; the render functions only draw them.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const E = () => global.EsphomeMrPlanEdit;
  const Own = () => global.EsphomeMrLogicUiOwn;
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
    protectedBy: (masts) => {
      const names = [].concat(masts).map((m) => `"${m}"`);
      return `Signals ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} each have a route onto this block. Only one of those routes can be set at a time: a route takes all its track at once, and gives it back behind its train.`;
    },
    moreOptions: "Timing",
    freeAfter: "Free its track when clear for",
    freeAfterHint: "How long this block must be clear, after a train has gone through, before another train can be given its track.",
    holdAfter: "Hold after cancelling",
    holdAfterHint: "Keep the track taken for a while if a signal drops in front of a train. Railways call this approach locking.",
    off: "Off",
    seconds: (n) => (n === 1 ? "1 second" : `${n} seconds`),
    pointTitle: Object.freeze({ plain: "Point on the track", turnout: "Where three lines meet", crossing: "Crossing", end: "End of the track" }),
    turnout: "Turnout",
    turnoutPick: "Pick one…",
    turnoutNone: "No turnout: two tracks that join, as on a gauntlet",
    turnoutHint: "Add turnouts on the Turnouts page.",
    straight: "Straight line goes",
    straightAuto: "Pick one…",
    straightInLine: "The line that carries straight on",
    straightIs: "Turnout is straight when",
    pairWith: "Moves with",
    pairNone: "No other turnout",
    pairHint: "The two turnouts of a crossover move together: throwing one throws the other, from a button, JMRI or CATS. A crossover on your drawing is found for you.",
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
    // The page's steps (TP 6).
    trackCard: "Your track",
    selectedLabel: "What is selected",
    nothingHere: "Click something on the drawing.",
    plainNote: "Plain track. In the Sensors step, cut it into blocks here.",
    endNote: "An end of the drawing. In the Signals step, say what is beyond it.",
    breakNote: "A block break. Its signals are set in the Signals step.",
    signalsPieceNote: "Click a block break (a short line across the track) to stand a signal there, or an end of the track to say what is beyond it.",
    sensorsPointNote: "Only plain track can have a block break: not a turnout, a crossing or an end.",
    newTurnout: "New turnout here",
    newSensor: "New sensor in this block",
    newSignal: (way) => `New signal for trains heading ${way}`,
    newName: "Name",
    makeTurnout: "Make the turnout",
    makeSensor: "Add the sensor",
    makeSignal: "Make the signal",
    madeTurnout: (name, where) => `Made turnout "${name}" on ${where}. Its full settings are on the Turnouts page.`,
    madeSensor: (name, where) => `Made sensor "${name}" on ${where}. Its full settings are on the Sensors page.`,
    noPins: (name, n) => `Not enough free pins for "${name}": it needs ${n === 1 ? "one" : n}. Pick a WS2812B kind, which takes one pin for the whole mast, or free some pins.`,
    madeSignal: (name) => `Made signal "${name}". Its lamps and wiring are on the Signal Masts page.`,
    needName: "Give it a name first.",
    nameTaken: (name) => `"${name}" is already taken on this board. Pick another name.`,
    turnoutName: (n) => `Turnout ${n}`,
    sensorName: (block) => `${block} current`,
    signalName: (n) => `Signal ${n}`,
    mastKind: "Kind of mast",
    mastKinds: Object.freeze({
      oneHead: "One head: a red, a yellow and a green LED",
      oneHeadStrip: "One head: one WS2812B LED",
      twoHeads: "Two heads: six LEDs",
      twoHeadsStrip: "Two heads: two WS2812B LEDs",
    }),
    buttonLabel: (mast) => `Button for ${mast}`,
    buttonNone: "No button",
    buttonHint: "A push button on the fascia, wired to GND. In Manual it asks for a route, and cancels it when pressed again.",
    manualOnly: (mast) => `${mast} is Manual only`,
    manualOnlyHint: "Always asked for by a person, through CATS, JMRI or its button, whatever the Auto/Manual switch says.",
    controlled: (mast) => `"${mast}" is a controlled signal: a route from it can clash with another signal's, so it clears only for a route that has been asked for and set. In Auto the board asks when a train arrives at it; in Manual, CATS or JMRI clearing it, or its button.`,
    blockSignal: (mast) => `"${mast}" is a block signal: none of its routes can clash with another signal's, so it shows the best the track ahead allows. Nothing has to ask for it.`,
    oneSignal: "No two signals can send trains onto this block, so there is nothing to keep apart here. Each signal still checks it is clear.",
    noSignalHere: "No signal stands here.",
    problemsHere: "Problems in this step",
    // TP 7: pieces, rules and the signal's own settings.
    lockUnderTrain: "Lock it while a train is on it",
    lockUnderTrainHint: "So its points never move under a train. Untick only for a turnout a train can safely run through.",
    aspectsFold: "Aspects for each meaning",
    aspectFor: (meaning) => `For ${meaning}`,
    aspectDefault: (label) => (label ? `As usual: ${label}` : "As usual"),
    approachLight: (mast) => `Light ${mast} only while a train comes up to it`,
    approachNone: "Always lit",
    approachHint: "Approach lighting: the signal is dark until the block behind it is occupied.",
    spotTitle: "A place on the drawing",
    spotHint: "Put a button, switch or lamp here: something on the fascia your rules can read or light.",
    pieceKind: "Kind",
    piecePin: "Pin",
    pinNone: "No pin yet",
    addPiece: "Put it here",
    pieceTitle: (kind, name) => `${kind}: ${name}`,
    removePiece: "Take it off the drawing",
    rulesOn: (name) => `Rules on ${name}`,
    noRules: "No rules of your own yet. The drawing already protects the track.",
    addRule: "Add a rule",
    ruleKind: "Rule",
    conditionWhat: (n) => `Condition ${n}`,
    conditionIs: "Is",
    conditionSeconds: "Seconds",
    addCondition: "Add a condition",
    removeCondition: "Remove this condition",
    joinLabel: "Conditions",
    joinAll: "All of them",
    joinAny: "Any of them",
    saveRule: "Save the rule",
    removeRule: "Remove",
    pickSubject: "Pick something…",
    subjectGroups: Object.freeze({ block: "Blocks", turnout: "Turnouts", mast: "Signals", switch: "Switches", button: "Buttons" }),
    choiceWords: Object.freeze({
      occupied: "occupied", clear: "clear", occupiedFor: "occupied for a time",
      closed: "closed", thrown: "thrown",
      stop: "at Stop", notStop: "not at Stop", stopFor: "has shown Stop for a time",
      on: "on", off: "off", pressed: "pressed in the last few seconds",
    }),
    needCondition: "Pick what the rule reads first.",
    madeExample: "Added the example's pieces and rules. They are yours to change or remove.",
    showProblem: "Show",
  });

  // ===== Pure: the layout ===================================================

  const CELL = 48;
  const MIN_CELL = 28;
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
   * signals, points, ends, arrows }.
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
    const placed = list(plan?.pieces).filter((p) => isObject(p) && Array.isArray(p.at)).map((p) => p.at);
    const xs = [...nodes, ...placed].map((p) => p[0]);
    const ys = [...nodes, ...placed].map((p) => p[1]);
    // At least one spare cell all round, and room to draw to the right and below.
    // An end's note is written past the end, so a left end needs two cells.
    const labelled = list(plan?.ends).filter((e) => isObject(e) && Array.isArray(e.at) && (e.beyond === "plain" || isObject(e.beyond))).map((e) => e.at[0]);
    const x = Math.min(-1, ...xs.map((v) => v - 1), ...labelled.map((v) => v - 2));
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

    // Your own pieces (TP 7): buttons, switches and lamps where they were put.
    const fascia = list(plan?.pieces).filter((p) => isObject(p) && Array.isArray(p.at) && p.name).map((p) => ({ name: String(p.name), kind: String(p.kind || ""), at: p.at }));
    return { view, pieces, blocks, breaks, signals, points, ends: outEnds, arrows, fascia };
  }

  /**
   * What is at a place on the drawing, in grid units: { kind: "point", at },
   * { kind: "piece", a, b } or null. A signal picks the point it stands at.
   */
  function pick(shape, x, y) {
    const distance = (p) => Math.hypot(p[0] - x, p[1] - y);
    const piece = list(shape.fascia).find((f) => distance(f.at) <= 0.35);
    if (piece) return { kind: "fascia", name: piece.name };
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

  /**
   * Where the drawing's problems are, for marking them: [{ level, step, text,
   * at? (a grid point), pieces? ([{ a, b }]), head? }]. A problem at a point is
   * ringed there, a block's along its track, a signal's round its head.
   */
  function marks(config, shape) {
    const B = global.EsphomeMrPlanBuilder;
    if (!B || !list(config?.logic?.plan?.track).length) return [];
    return list(B.look(config).problems).map((p) => {
      const where = p.where || {};
      const mark = { level: p.level, step: p.step, text: p.text };
      if (where.mast !== undefined) {
        const signal = shape.signals.find((s) => s.mast === where.mast);
        if (signal) return { ...mark, head: signal.head, at: signal.at };
      }
      if (Array.isArray(where.at)) return { ...mark, at: where.at };
      if (where.block !== undefined) {
        const def = list(config.logic.plan.blocks).find((b) => isObject(b) && b.name === where.block);
        const first = def?.at;
        if (Array.isArray(first) && Array.isArray(first[0]) && Array.isArray(first[1])) {
          const [from, to] = first;
          const next = [from[0] + Math.sign(to[0] - from[0]), from[1] + Math.sign(to[1] - from[1])];
          const pieces = E().stretchOfBlock(config, from, next).map(([a, b]) => ({ a, b }));
          if (pieces.length) return { ...mark, pieces };
        }
      }
      return mark;
    });
  }

  // ===== The page ===========================================================

  const SVG = "http://www.w3.org/2000/svg";
  // What the person is doing: kept while the page is drawn again.
  const state = { tool: null, start: null, cursor: [0, 0], selected: null, scroll: [0, 0], board: null, more: false, draft: null };

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

  function drawPicture(config, shape, tool, found = [], links = []) {
    const { view } = shape;
    const drawing = svg("svg", {
      id: "logic-plan-grid", class: `plan-grid is-${tool}`, tabindex: 0, role: "application", "aria-label": TEXT.gridLabel,
      viewBox: `${px(view.x - 0.5)} ${px(view.y - 0.5)} ${px(view.w)} ${px(view.h)}`, width: px(view.w), height: px(view.h),
      // Shrunk to fit beside the panel, down to MIN_CELL a grid square; past
      // that, it scrolls.
      style: `width: 100%; height: auto; max-width: ${px(view.w)}px; min-width: ${Math.round(view.w * MIN_CELL)}px`,
    });
    for (let x = view.x; x < view.x + view.w; x += 1) {
      for (let y = view.y; y < view.y + view.h; y += 1) drawing.append(svg("circle", { class: "plan-dot", cx: px(x), cy: px(y), r: 1.5 }));
    }
    const selected = state.selected;
    const chosen = new Set(selected?.kind === "piece" ? E().stretchOfBlock(config, selected.a, selected.b).map(([a, b]) => [key(a), key(b)].sort().join("|")) : []);
    const line = (a, b, className) => svg("line", { class: className, x1: px(a[0]), y1: px(a[1]), x2: px(b[0]), y2: px(b[1]) });
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
      // The note goes past the end, in line with the track, clear of block names.
      if (end.label) {
        const [dx, dy] = end.way;
        const sideways = Math.abs(dx) > 0.3;
        drawing.append(svg("text", {
          class: "plan-note", x: x + dx * 10, y: sideways ? y + 4 + dy * 10 : y + dy * 16,
          "text-anchor": dx > 0.3 ? "start" : dx < -0.3 ? "end" : "middle",
        }, end.label));
      }
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
    // Your own pieces: a square with its kind's letter, and its name.
    for (const f of list(shape.fascia)) {
      const [x, y] = [px(f.at[0]), px(f.at[1])];
      drawing.append(svg("rect", { class: `plan-fascia is-${f.kind}`, x: x - 10, y: y - 10, width: 20, height: 20, rx: 4 }));
      drawing.append(svg("text", { class: "plan-fascia-letter", x, y: y + 4, "text-anchor": "middle" }, (Own()?.TEXT.kinds[f.kind] || "?")[0]));
      drawing.append(svg("text", { class: "plan-note", x, y: y + 24, "text-anchor": "middle" }, f.name));
    }
    // Dotted lines from a rule's thing to what it reads.
    for (const l of links) drawing.append(svg("line", { class: "plan-reads", x1: px(l.from[0]), y1: px(l.from[1]), x2: px(l.to[0]), y2: px(l.to[1]) }));
    if (selected?.kind === "fascia") {
      const f = list(shape.fascia).find((x) => x.name === selected.name);
      if (f) drawing.append(svg("circle", { class: "plan-picked", cx: px(f.at[0]), cy: px(f.at[1]), r: 15 }));
    }
    if (selected?.kind === "spot") drawing.append(svg("circle", { class: "plan-picked", cx: px(selected.at[0]), cy: px(selected.at[1]), r: 11 }));
    // Problems: red for errors, amber for warnings, under the selection ring.
    for (const mark of found) {
      const cls = `plan-problem is-${mark.level === "error" ? "error" : "warning"}`;
      for (const { a, b } of mark.pieces || []) drawing.append(line(a, b, `${cls} is-track`));
      const ring = mark.head || mark.at;
      if (ring && !mark.pieces) drawing.append(svg("circle", { class: cls, cx: px(ring[0]), cy: px(ring[1]), r: 15 }));
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
        // In Behaviour and rules, an empty place is where a piece can go.
        select(pick(shape, ...last) || (state.step === "behaviour" ? { kind: "spot", at: to } : null));
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
        if (tool === "select") select(pick(shape, ...state.cursor) || (state.step === "behaviour" ? { kind: "spot", at: state.cursor } : null));
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

  // What protects the block picked, and its Timing.
  function blockPart(panel, config, ctx, ui, block, a, b) {
    const box = el("div", "plan-block-part");
    panel.append(box);
    const found = global.EsphomeMrPlanBuilder.look(config).protects.find((p) => p.block === block.name);
    if (found) box.append(ui.paragraph(TEXT.protectedBy(found.masts), "hint"));
    if (!list(block.sensors).length) return;
    const more = el("details", "plan-more");
    more.open = state.more;
    // Noted on the click itself: the "toggle" event can come after the next redraw.
    const summary = el("summary", "", TEXT.moreOptions);
    summary.addEventListener("click", () => { state.more = !more.open; });
    more.append(summary);
    const inner = el("div", "fields");
    const release = String(block.release || "3s");
    inner.append(choice(ctx, "logic-plan-block-release", TEXT.freeAfter, release, times(RELEASES, release),
      (v) => E().setBlock(config, a, b, { release: v === "3s" ? "" : v }), TEXT.freeAfterHint));
    const hold = String(block.approachLock || "");
    inner.append(choice(ctx, "logic-plan-block-hold", TEXT.holdAfter, hold, [{ value: "", label: TEXT.off }, ...times(HOLDS, hold)],
      (v) => E().setBlock(config, a, b, { approachLock: v }), TEXT.holdAfterHint));
    more.append(inner);
    box.append(more);
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
    // Kept once typing is finished. Only the picture is drawn again, so a
    // click that ends the typing is not lost.
    input.addEventListener("change", () => {
      E().setBlock(config, a, b, { name: input.value.trim() });
      ctx.persist();
      ctx.refresh();
      const name = E().blockAt(config, a, b)?.name;
      input.value = name || "";
      title.textContent = TEXT.trackTitle(name);
      if (name) end.replaceWith((end = endButton()));
      repaint();
      // A block just named has its Timing.
      if (name) {
        panel.querySelector(".plan-block-part")?.remove();
        blockPart(panel, config, ctx, ui, E().blockAt(config, a, b), a, b);
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
    if (block) blockPart(panel, config, ctx, ui, block, a, b);
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
    // A crossover's turnouts move together: found on the drawing, or picked.
    const pair = list(global.EsphomeMrPlanBuilder.trace(config).pairs).find((p) => p.turnout === set.turnout || p.with === set.turnout);
    const current = pair ? (pair.turnout === set.turnout ? pair.with : pair.turnout) : "";
    const others = [...new Set(list(plan.points).filter((p) => isObject(p) && p.turnout && p.turnout !== set.turnout).map((p) => p.turnout))];
    fields.append(choice(ctx, "logic-plan-pair", TEXT.pairWith, current, [
      { value: "", label: TEXT.pairNone }, ...others.map((name) => ({ value: name, label: name })),
    ], (v) => E().setPoint(config, at, { pairedWith: v }), TEXT.pairHint));
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

  // ===== Making hardware where it goes ======================================

  const F = () => global.EsphomeMrLogicUiField;
  const taken = (config) => new Set([
    ...list(config.blocks).map((b) => b?.name),
    ...list(config.points).map((p) => p?.name),
    ...list(config.signals?.masts).map((m) => m?.name),
    ...list(config.logic?.plan?.blocks).map((b) => b?.name),
  ].filter(Boolean));
  const freeName = (config, make) => {
    const used = taken(config);
    let n = 1;
    while (used.has(make(n))) n += 1;
    return make(n);
  };

  // A name box and a button that makes the thing; `make(name, extra)` does it.
  function maker(panel, ctx, id, title, suggested, buttonText, make, extra) {
    const box = el("div", "plan-maker");
    box.append(el("strong", "", title));
    const nameField = ctx.field(TEXT.newName, suggested, () => {}, { full: true });
    const input = nameField.querySelector("input");
    input.id = `${id}-name`;
    box.append(nameField);
    const more = extra ? extra(box) : null;
    const go = button(buttonText, () => {
      const name = input.value.trim();
      if (!name) return ctx.flash("err", TEXT.needName);
      if (taken(ctx.config).has(name)) return ctx.flash("err", TEXT.nameTaken(name));
      make(name, more);
    });
    go.id = `${id}-make`;
    box.append(go);
    panel.append(box);
  }

  // The pins a button, switch or lamp can take: the free ones, and its own.
  const freePins = (ctx, current) => (ctx.freePinChoices ? ctx.freePinChoices(current) : ctx.pinChoices());

  const pinOf = (items, name) => {
    const item = list(items).find((i) => i?.name === name);
    return item?.gpio || item?.servoPin || item?.pin || (Number.isInteger(item?.channel) ? `PCA9685 channel ${item.channel}` : "");
  };

  // ===== One panel for each step ============================================

  function drawPanel(panel, config, ctx, ui) {
    const s = state.selected;
    if (!s) return;
    if (s.kind === "piece") {
      panel.append(el("h4", "", TEXT.trackTitle(E().blockAt(config, s.a, s.b)?.name)));
      const fields = el("div", "fields");
      const towards = E().directionAt(config, s.a, s.b);
      const value = !towards ? "" : key(towards) === key(s.b) ? "b" : "a";
      fields.append(choice(ctx, "logic-plan-direction", TEXT.direction, value, [
        { value: "", label: TEXT.bothWays },
        { value: "b", label: TEXT.only(wayWords(s.a, s.b)) },
        { value: "a", label: TEXT.only(wayWords(s.b, s.a)) },
      ], (v) => E().setDirection(config, s.a, s.b, v === "a" ? s.a : v === "b" ? s.b : null), TEXT.directionHint));
      panel.append(fields);
      return;
    }
    const at = s.at;
    const kind = E().kindAt(config, at);
    panel.append(el("h4", "", TEXT.pointTitle[kind] || TEXT.pointTitle.crossing));
    if (kind === "turnout") {
      const fields = el("div", "fields");
      turnoutFields(fields, config, ctx, at);
      const set = list(config.logic.plan.points).find((p) => isObject(p) && key(p.at ?? [NaN, NaN]) === key(at));
      if (set?.turnout) {
        const lock = ctx.field(TEXT.lockUnderTrain, set.lock !== false, (checked) => {
          E().setPoint(config, at, { lock: checked ? undefined : false });
          changed(ctx, "#logic-plan-lock");
        }, { checkbox: true, hint: TEXT.lockUnderTrainHint });
        lock.querySelector("input").id = "logic-plan-lock";
        fields.append(lock);
      }
      panel.append(fields);
      if (!list(config.logic.plan.points).some((p) => isObject(p) && key(p.at ?? [NaN, NaN]) === key(at) && p.turnout)) {
        maker(panel, ctx, "logic-plan-new-turnout", TEXT.newTurnout, freeName(config, TEXT.turnoutName), TEXT.makeTurnout, (name) => {
          ctx.addItems({ turnouts: [name] });
          E().setPoint(config, at, { turnout: name });
          ctx.flash("ok", TEXT.madeTurnout(name, pinOf(config.points, name)));
          changed(ctx, "#logic-plan-straight");
        });
      }
    } else if (kind === "crossing") panel.append(ui.paragraph(TEXT.crossingNote, "card-copy"));
    else if (kind === "end") panel.append(ui.paragraph(TEXT.endNote, "hint"));
    else panel.append(ui.paragraph(E().breakAt(config.logic.plan, at) ? TEXT.breakNote : TEXT.plainNote, "hint"));
  }

  function sensorsPanel(panel, config, ctx, ui) {
    const s = state.selected;
    if (!s) return;
    if (s.kind === "piece") {
      trackPanel(panel, config, ctx, ui, s, () => redraw(ctx, "#logic-plan-block-name"));
      const block = E().blockAt(config, s.a, s.b);
      maker(panel, ctx, "logic-plan-new-sensor", TEXT.newSensor, block?.name ? TEXT.sensorName(block.name) : freeName(config, (n) => TEXT.sensorName(TEXT.newBlock(n))), TEXT.makeSensor, (name) => {
        ctx.addItems({ sensors: [name] });
        const now = E().blockAt(config, s.a, s.b);
        E().setBlock(config, s.a, s.b, now ? { sensors: [...list(now.sensors), name] } : { name: E().freeBlockName(config, TEXT.newBlock), sensors: [name] });
        ctx.flash("ok", TEXT.madeSensor(name, pinOf(config.blocks, name)));
        changed(ctx, "#logic-plan-block-name");
      });
      return;
    }
    const at = s.at;
    const kind = E().kindAt(config, at);
    panel.append(el("h4", "", TEXT.pointTitle[kind] || TEXT.pointTitle.crossing));
    const brk = E().breakAt(config.logic.plan, at);
    if (kind === "plain") {
      if (brk) {
        const groups = sensorGroups(config, ui);
        const members = list(brk.sensors);
        if (groups.length || members.length) {
          const fields = el("div", "fields");
          fields.append(ticks(ctx, "logic-plan-break-sensor", TEXT.breakSensors, groups, members,
            (sensors) => E().setBreakSensors(config, at, sensors), TEXT.breakSensorsHint));
          panel.append(fields);
        }
      } else {
        const add = button(TEXT.addBreak, () => { E().addBreak(config, at); changed(ctx, "#logic-plan-remove-break"); });
        add.id = "logic-plan-add-break";
        panel.append(add);
      }
    } else panel.append(ui.paragraph(TEXT.sensorsPointNote, "hint"));
    if (brk) {
      const remove = button(TEXT.removeBreak, () => { E().removeBreak(config, at); changed(ctx, "#logic-plan-grid"); }, "remove");
      remove.id = "logic-plan-remove-break";
      panel.append(remove, ctx.hintEl(TEXT.removeBreakNote));
    }
    trackButtons(panel, config, ctx, at);
  }

  // A signal's button and Manual only, once it stands on the drawing.
  function signalOptions(fields, config, ctx, at, signal, i) {
    const current = String(signal.button ?? "");
    const pins = [{ value: "", label: TEXT.buttonNone }, ...freePins(ctx, current)];
    if (current && !pins.some((p) => p.value === current)) pins.push({ value: current, label: current });
    fields.append(choice(ctx, `logic-plan-button-${i}`, TEXT.buttonLabel(signal.mast), current, pins,
      (v) => E().setSignalOptions(config, at, signal.facing, { button: v }), TEXT.buttonHint));
    const manual = ctx.field(TEXT.manualOnly(signal.mast), signal.manualOnly === true, (checked) => {
      E().setSignalOptions(config, at, signal.facing, { manualOnly: checked });
      changed(ctx, `#logic-plan-manual-${i}`);
    }, { checkbox: true, hint: TEXT.manualOnlyHint });
    manual.querySelector("input").id = `logic-plan-manual-${i}`;
    fields.append(manual);
    // Approach lighting: dark until the block behind it is occupied.
    const blocks = list(config.logic.plan.blocks).map((b) => b?.name).filter(Boolean);
    const lit = String(signal.approachLight ?? "");
    fields.append(choice(ctx, `logic-plan-approach-${i}`, TEXT.approachLight(signal.mast), lit,
      [{ value: "", label: TEXT.approachNone }, ...blocks.map((b) => ({ value: b, label: b }))],
      (v) => E().setSignalOptions(config, at, signal.facing, { approachLight: v }), TEXT.approachHint));
    // The aspect for each meaning: as usual (a CATS mast's own), or picked.
    const Mss = global.EsphomeMrMssBuilder;
    const labels = list(list(config.signals?.masts).find((m) => m.name === signal.mast)?.aspects).map((a) => String(a.label ?? "")).filter(Boolean);
    if (Mss && labels.length) {
      const fold = el("details", "plan-more");
      fold.open = state.aspects === `${key(at)}|${i}`;
      const summary = el("summary", "", TEXT.aspectsFold);
      summary.addEventListener("click", () => { state.aspects = fold.open ? null : `${key(at)}|${i}`; });
      fold.append(summary);
      const inner = el("div", "fields");
      for (const ind of Mss.INDICATIONS) {
        const usual = Mss.prefill(config, signal.mast, ind.key) || "";
        const current = String(signal.aspects?.[ind.key] ?? "");
        inner.append(choice(ctx, `logic-plan-aspect-${i}-${ind.key}`, TEXT.aspectFor(Mss.TEXT.indications[ind.key]), current,
          [{ value: "", label: TEXT.aspectDefault(usual) }, ...labels.map((l) => ({ value: l, label: l }))],
          (v) => E().setSignalOptions(config, at, signal.facing, { aspects: { ...(signal.aspects || {}), [ind.key]: v } })));
      }
      fold.append(inner);
      fields.append(fold);
    }
  }

  const KINDS = Object.freeze({
    oneHead: ["oneHead", "leds"], oneHeadStrip: ["oneHead", "strip"],
    twoHeads: ["twoHeads", "leds"], twoHeadsStrip: ["twoHeads", "strip"],
  });

  function signalsPanel(panel, config, ctx, ui) {
    const s = state.selected;
    if (!s) return;
    if (s.kind === "piece") return void panel.append(ui.paragraph(TEXT.signalsPieceNote, "hint"));
    const at = s.at;
    const kind = E().kindAt(config, at);
    panel.append(el("h4", "", TEXT.pointTitle[kind] || TEXT.pointTitle.crossing));
    const fields = el("div", "fields");
    if (kind === "end") {
      endFields(fields, config, ctx, at);
      return void panel.append(fields);
    }
    if (kind !== "plain") return void panel.append(ui.paragraph(TEXT.signalsPieceNote, "hint"));
    const brk = E().breakAt(config.logic.plan, at);
    const MT = global.EsphomeMrMssTemplates;
    E().neighbours(config, at).forEach((other, i) => {
      const way = wayWords(at, other);
      const facing = (sig) => isObject(sig) && Array.isArray(sig.facing) && wayWords(at, sig.facing) === way;
      const signal = list(brk?.signals).find(facing);
      const current = String(signal?.mast ?? "");
      fields.append(choice(ctx, `logic-plan-signal-${i}`, TEXT.signal(way), current, mastOptions(config, current),
        (v) => E().setSignal(config, at, signal ? signal.facing : other, v), i ? TEXT.signalHint : undefined));
      if (signal?.mast) signalOptions(fields, config, ctx, at, signal, i);
    });
    panel.append(fields);
    // A signal can be made here for a way that has none.
    E().neighbours(config, at).forEach((other, i) => {
      const way = wayWords(at, other);
      if (list(brk?.signals).some((sig) => isObject(sig) && Array.isArray(sig.facing) && wayWords(at, sig.facing) === way)) return;
      maker(panel, ctx, `logic-plan-new-signal-${i}`, TEXT.newSignal(way), freeName(config, TEXT.signalName), TEXT.makeSignal, (name, kindSelect) => {
        const [rows, style] = KINDS[kindSelect.value] || KINDS.oneHead;
        const mast = MT.mast(name, MT.ROWS[rows], MT.HEADS[rows], style);
        // Each LED of an individual-LED mast takes a pin; a strip takes one.
        const need = mast.mode === "gpio" ? list(mast.lamps).length : 1;
        if (ctx.safeOutputPins && ctx.safeOutputPins() < need) return ctx.flash("err", TEXT.noPins(name, need));
        ctx.addItems({ masts: [mast] });
        E().setSignal(config, at, other, name);
        ctx.flash("ok", TEXT.madeSignal(name));
        changed(ctx, `#logic-plan-signal-${i}`);
      }, (box) => {
        const kindField = ctx.field(TEXT.mastKind, "oneHead", () => {}, {
          select: Object.keys(KINDS).map((value) => ({ value, label: TEXT.mastKinds[value] })), full: true,
        });
        const select = kindField.querySelector("select");
        select.id = `logic-plan-new-signal-${i}-kind`;
        box.append(kindField);
        return select;
      });
    });
    if (brk) {
      const remove = button(TEXT.removeBreak, () => { E().removeBreak(config, at); changed(ctx, "#logic-plan-grid"); }, "remove");
      remove.id = "logic-plan-remove-break";
      panel.append(remove, ctx.hintEl(TEXT.removeBreakNote));
    }
  }

  // ===== Behaviour and rules: pieces, rules and examples (TP 7) =============

  // Every subject a condition can read, grouped: [{ kind, label, names }].
  function subjects(config) {
    const plan = config.logic.plan || {};
    const pieces = (kind) => list(plan.pieces).filter((p) => isObject(p) && p.kind === kind).map((p) => p.name);
    return [
      { kind: "block", names: list(plan.blocks).map((b) => b?.name).filter(Boolean) },
      { kind: "turnout", names: list(config.points).map((p) => p?.name).filter(Boolean) },
      { kind: "mast", names: list(plan.breaks).flatMap((b) => list(b?.signals).map((x) => x?.mast)).filter(Boolean) },
      { kind: "switch", names: pieces("switch") },
      { kind: "button", names: pieces("button") },
    ].filter((g) => g.names.length);
  }

  // The rules on one thing ({ kind, name }), each with its place in plan.rules,
  // and the form that adds one.
  function rulesPart(panel, config, ctx, thing) {
    const O = Own();
    const all = list(config.logic.plan?.rules);
    panel.append(el("h5", "", TEXT.rulesOn(thing.name)));
    const mine = all.map((rule, index) => ({ rule, index })).filter(({ rule }) => {
      const t = O.thingOf(rule);
      return t && t.kind === thing.kind && t.name === thing.name;
    });
    if (!mine.length) panel.append(el("p", "hint", TEXT.noRules));
    for (const { rule, index } of mine) {
      const row = el("div", "plan-rule");
      row.append(el("span", "", O.sentence(rule)));
      const remove = button(TEXT.removeRule, () => { E().removeRule(config, index); changed(ctx, "#logic-plan-grid"); }, "remove link-button");
      row.append(remove);
      panel.append(row);
    }
    ruleForm(panel, config, ctx, thing);
  }

  // The form for a new rule: its kind, its conditions and how they join.
  // Kept in state.draft while the page is drawn again.
  function ruleForm(panel, config, ctx, thing) {
    const O = Own();
    const id = `${thing.kind}|${thing.name}`;
    if (state.draft?.id !== id) state.draft = { id, kind: O.ON[thing.kind][0], join: "all", parts: [{ kind: "", name: "", choice: "", seconds: 30 }] };
    const draft = state.draft;
    const box = el("div", "plan-maker");
    box.append(el("strong", "", TEXT.addRule));
    const fields = el("div", "fields");
    const redrawForm = (focus) => redraw(ctx, focus);
    fields.append(ctx.field(TEXT.ruleKind, draft.kind, (v) => { draft.kind = v; }, {
      select: O.ON[thing.kind].map((k) => ({ value: k, label: O.TEXT.rules[k] })), full: true, hint: O.TEXT.ruleHint[draft.kind],
    }));
    const groups = subjects(config);
    draft.parts.forEach((part, n) => {
      const value = part.kind ? `${part.kind}|${part.name}` : "";
      const subject = ctx.field(TEXT.conditionWhat(n + 1), value, (v) => {
        const [kind, ...rest] = v.split("|");
        Object.assign(part, { kind, name: rest.join("|"), choice: O.CHOICES[kind]?.[0]?.id || "" });
        redrawForm(`#logic-plan-cond-${n}`);
      }, { select: [{ value: "", label: TEXT.pickSubject }, ...groups.flatMap((g) => g.names.map((name) => ({ value: `${g.kind}|${name}`, label: `${TEXT.subjectGroups[g.kind]}: ${name}` })))], full: true });
      subject.querySelector("select").id = `logic-plan-cond-${n}`;
      fields.append(subject);
      if (part.kind) {
        const choices = O.CHOICES[part.kind];
        const is = ctx.field(TEXT.conditionIs, part.choice, (v) => { part.choice = v; redrawForm(`#logic-plan-cond-${n}-is`); }, {
          select: choices.map((c) => ({ value: c.id, label: TEXT.choiceWords[c.id] })), full: true,
        });
        is.querySelector("select").id = `logic-plan-cond-${n}-is`;
        fields.append(is);
        if (choices.find((c) => c.id === part.choice)?.timed) {
          const secs = ctx.field(TEXT.conditionSeconds, String(part.seconds), (v) => { part.seconds = Math.max(1, Number(v) || 30); }, { full: true });
          fields.append(secs);
        }
      }
      if (draft.parts.length > 1) {
        const drop = button(TEXT.removeCondition, () => { draft.parts.splice(n, 1); redrawForm("#logic-plan-add-condition"); }, "link-button");
        fields.append(drop);
      }
    });
    if (draft.parts.length > 1) {
      fields.append(ctx.field(TEXT.joinLabel, draft.join, (v) => { draft.join = v; }, {
        select: [{ value: "all", label: TEXT.joinAll }, { value: "any", label: TEXT.joinAny }], full: true,
      }));
    }
    box.append(fields);
    const more = button(TEXT.addCondition, () => { draft.parts.push({ kind: "", name: "", choice: "", seconds: 30 }); redrawForm(`#logic-plan-cond-${draft.parts.length - 1}`); }, "link-button");
    more.id = "logic-plan-add-condition";
    const save = button(TEXT.saveRule, () => {
      const made = draft.parts.filter((p) => p.kind && p.name).map((p) => O.CHOICES[p.kind].find((c) => c.id === p.choice)?.make(p.name, p.seconds)).filter(Boolean);
      if (!made.length) return ctx.flash("err", TEXT.needCondition);
      E().addRule(config, { on: { [thing.kind]: thing.name }, kind: draft.kind, when: O.joinParts(draft.join, made) });
      state.draft = null;
      changed(ctx, "#logic-plan-grid");
    });
    save.id = "logic-plan-save-rule";
    box.append(more, save);
    panel.append(box);
  }

  // The signals whose routes cross a turnout: those whose routes are locked with it.
  function signalsOver(config, turnout) {
    const B = global.EsphomeMrPlanBuilder;
    const out = [];
    for (const layer of list(B.build(config).layers)) {
      if (layer.routes !== true) continue;
      if (list(layer.rules).some((r) => list(r?.then?.lock).some((l) => (isObject(l) ? l.turnout : l) === turnout))) {
        const mast = list(layer.rules)[0]?.then?.mast;
        if (mast && !out.includes(mast)) out.push(mast);
      }
    }
    return out;
  }

  function example(ctx, config, made) {
    for (const piece of made.pieces) E().addPiece(config, piece);
    for (const rule of made.rules) E().addRule(config, rule);
    ctx.flash("ok", TEXT.madeExample);
    changed(ctx, "#logic-plan-grid");
  }

  // A free grid point near another, for an example's piece.
  // A free grid point near `near`; `tall`: and the one under it free too.
  function freeSpot(config, near, tall = false) {
    const taken = new Set([...E().graph(config.logic.plan).near.keys(), ...list(config.logic.plan.pieces).filter((p) => Array.isArray(p?.at)).map((p) => key(p.at))]);
    for (let d = 1; d < 6; d += 1) {
      for (const at of [[near[0], near[1] + d], [near[0], near[1] - d], [near[0] + d, near[1] + d], [near[0] - d, near[1] + d]]) {
        if (!taken.has(key(at)) && !(tall && taken.has(key([at[0], at[1] + 1])))) return at;
      }
    }
    return [near[0], near[1] + 6];
  }

  function behaviourPanel(panel, config, ctx, ui) {
    const s = state.selected;
    if (!s) return;
    const B = global.EsphomeMrPlanBuilder;
    const O = Own();
    if (s.kind === "spot") {
      panel.append(el("h4", "", TEXT.spotTitle), ui.paragraph(TEXT.spotHint, "hint"));
      let kindSelect;
      let pinSelect;
      maker(panel, ctx, "logic-plan-new-piece", O.TEXT.kinds.switch, freeName(config, (n) => `${O.TEXT.kinds.switch} ${n}`), TEXT.addPiece, (name) => {
        E().addPiece(config, { kind: kindSelect.value, name, at: s.at, ...(pinSelect.value ? { pin: pinSelect.value } : {}) });
        state.selected = { kind: "fascia", name };
        changed(ctx, "#logic-plan-grid");
      }, (box) => {
        const kind = ctx.field(TEXT.pieceKind, "switch", () => {}, { select: ["button", "switch", "lamp"].map((k) => ({ value: k, label: O.TEXT.kinds[k] })), full: true });
        kindSelect = kind.querySelector("select");
        kindSelect.id = "logic-plan-new-piece-kind";
        const pin = ctx.field(TEXT.piecePin, "", () => {}, { select: [{ value: "", label: TEXT.pinNone }, ...freePins(ctx, "")], full: true });
        pinSelect = pin.querySelector("select");
        pinSelect.id = "logic-plan-new-piece-pin";
        box.append(kind, pin);
        return kindSelect;
      });
      return;
    }
    if (s.kind === "fascia") {
      const piece = list(config.logic.plan.pieces).find((p) => p?.name === s.name);
      if (!piece) return;
      panel.append(el("h4", "", TEXT.pieceTitle(O.TEXT.kinds[piece.kind] || piece.kind, piece.name)), ui.paragraph(O.TEXT.pieceHint[piece.kind] || "", "hint"));
      const fields = el("div", "fields");
      const nameField = ctx.field(TEXT.newName, piece.name, () => {}, { full: true });
      const input = nameField.querySelector("input");
      input.id = "logic-plan-piece-name";
      input.addEventListener("change", () => {
        const name = input.value.trim();
        if (!name || name === piece.name) return;
        if (taken(config).has(name) || list(config.logic.plan.pieces).some((p) => p?.name === name)) return ctx.flash("err", TEXT.nameTaken(name));
        E().setPiece(config, piece.name, { name });
        state.selected = { kind: "fascia", name };
        changed(ctx, "#logic-plan-piece-name");
      });
      fields.append(nameField);
      const pins = [{ value: "", label: TEXT.pinNone }, ...freePins(ctx, piece.pin)];
      fields.append(choice(ctx, "logic-plan-piece-pin", TEXT.piecePin, String(piece.pin ?? ""), pins, (v) => E().setPiece(config, piece.name, { pin: v })));
      panel.append(fields);
      if (piece.kind === "lamp") rulesPart(panel, config, ctx, { kind: "lamp", name: piece.name });
      const remove = button(TEXT.removePiece, () => { E().removePiece(config, piece.name); state.selected = null; changed(ctx, "#logic-plan-grid"); }, "remove");
      panel.append(remove);
      return;
    }
    if (s.kind === "piece") {
      const block = E().blockAt(config, s.a, s.b);
      panel.append(el("h4", "", TEXT.trackTitle(block?.name)));
      const found = block && B.look(config).protects.find((p) => p.block === block.name);
      panel.append(ui.paragraph(found ? TEXT.protectedBy(found.masts) : TEXT.oneSignal, "card-copy"));
      return;
    }
    const at = s.at;
    const kind = E().kindAt(config, at);
    panel.append(el("h4", "", TEXT.pointTitle[kind] || TEXT.pointTitle.crossing));
    if (kind === "turnout") {
      const turnout = list(config.logic.plan.points).find((p) => isObject(p) && key(p.at ?? [NaN, NaN]) === key(at))?.turnout;
      if (!turnout) return void panel.append(ui.paragraph(TEXT.noSignalHere, "hint"));
      rulesPart(panel, config, ctx, { kind: "turnout", name: turnout });
      const local = button(O.TEXT.examples.local, () => example(ctx, config, O.exampleLocalPanel(config, turnout, signalsOver(config, turnout), freeSpot(config, at, true))), "link-button");
      local.id = "logic-plan-example-local";
      panel.append(local);
      return;
    }
    const brk = E().breakAt(config.logic.plan, at);
    const signals = list(brk?.signals).filter((sig) => isObject(sig) && sig.mast);
    if (!signals.length) return void panel.append(ui.paragraph(TEXT.noSignalHere, "hint"));
    const groups = new Set(list(B.build(config).layers).map((layer) => layer.name));
    for (const signal of signals) {
      panel.append(ui.paragraph(groups.has(B.TEXT.movesGroup(signal.mast)) ? TEXT.controlled(signal.mast) : TEXT.blockSignal(signal.mast), "card-copy"));
      rulesPart(panel, config, ctx, { kind: "mast", name: signal.mast });
      const hold = button(O.TEXT.examples.hold, () => example(ctx, config, O.exampleHold(config, signal.mast, freeSpot(config, at))), "link-button");
      hold.id = `logic-plan-example-hold-${signals.indexOf(signal)}`;
      panel.append(hold);
    }
  }

  // Where each thing a rule can read or be on is drawn, for the dotted lines.
  function placeOf(config, shape, item) {
    if (item.kind === "block") return shape.blocks.find((b) => b.name === item.name)?.label || null;
    if (item.kind === "mast") return shape.signals.find((x) => x.mast === item.name)?.head || null;
    if (item.kind === "turnout") return list(config.logic.plan?.points).find((p) => isObject(p) && p.turnout === item.name)?.at || null;
    return list(shape.fascia).find((f) => f.name === item.name)?.at || null;
  }

  // The dotted lines for what is selected in Behaviour and rules: from the
  // thing to what each of its rules reads.
  function linksFor(config, shape) {
    const s = state.selected;
    const O = Own();
    if (state.step !== "behaviour" || !s || !O) return [];
    const things = [];
    if (s.kind === "fascia") things.push({ kind: "lamp", name: s.name });
    if (s.kind === "point") {
      const turnout = list(config.logic.plan?.points).find((p) => isObject(p) && key(p.at ?? [NaN, NaN]) === key(s.at))?.turnout;
      if (turnout) things.push({ kind: "turnout", name: turnout });
      for (const sig of list(E().breakAt(config.logic.plan, s.at)?.signals)) if (sig?.mast) things.push({ kind: "mast", name: sig.mast });
    }
    const out = [];
    for (const thing of things) {
      const from = placeOf(config, shape, thing);
      if (!from) continue;
      for (const rule of list(config.logic.plan?.rules)) {
        const t = O.thingOf(rule);
        if (!t || t.kind !== thing.kind || t.name !== thing.name) continue;
        for (const read of O.readsOf(rule)) {
          const to = placeOf(config, shape, read);
          if (to) out.push({ from, to });
        }
      }
    }
    return out;
  }

  const PANELS = Object.freeze({ draw: drawPanel, sensors: sensorsPanel, signals: signalsPanel, behaviour: behaviourPanel });

  // Drop a selection whose track has gone.
  function stillThere(config) {
    const s = state.selected;
    if (!s) return null;
    if (s.kind === "spot") return s;
    if (s.kind === "fascia") return list(config.logic?.plan?.pieces).some((p) => p?.name === s.name) ? s : null;
    if (s.kind === "point") return E().kindAt(config, s.at) === "none" ? null : s;
    return E().stretchOfBlock(config, s.a, s.b).length ? s : null;
  }

  // The problems of this step, under the drawing: each picks its place.
  function problemList(card, found, step, ctx) {
    const mine = found.filter((m) => m.step === step);
    if (!mine.length) return;
    const box = el("div", "plan-problems");
    box.append(el("strong", "", TEXT.problemsHere));
    const items = el("ul");
    for (const mark of mine) {
      const item = el("li", `msg-line is-${mark.level === "error" ? "error" : "warning"}`);
      item.append(el("span", "", mark.text));
      const place = mark.pieces?.[0] ? { kind: "piece", a: mark.pieces[0].a, b: mark.pieces[0].b } : mark.at ? { kind: "point", at: mark.at } : null;
      if (place) {
        const show = button(TEXT.showProblem, () => {
          state.selected = place;
          state.tool = "select";
          redraw(ctx, "#logic-plan-grid");
        }, "link-button");
        item.append(" ", show);
      }
      items.append(item);
    }
    box.append(items);
    card.append(box);
  }

  function renderPlan(root, config, ctx, ui) {
    // A different board: nothing is picked on it yet.
    if (state.board !== config) Object.assign(state, { board: config, tool: null, start: null, cursor: [0, 0], selected: null, scroll: [0, 0], more: false, step: null });
    const step = F() ? F().currentStep(config) : "draw";
    // A different step: what was picked belongs to the last one.
    if (state.step !== step) Object.assign(state, { step, tool: null, start: null, selected: null });
    const card = ui.card(PART, step === "try" || step === "download" ? F().TEXT.steps[step] : TEXT.trackCard);
    const guide = F()?.guidance(config, step);
    // Try it is its own part (logic-ui-plan-try.js), with the way on after it.
    if (step === "try") return;
    if (step === "download") {
      card.append(ui.paragraph(guide.doing), F().nextButton(config, ctx, step));
      root.append(card);
      return;
    }
    const shape = layout(config);
    state.selected = stillThere(config);
    // With nothing drawn there is only drawing to do; the other steps pick.
    const tool = step !== "draw" ? "select" : shape.pieces.length ? state.tool || "select" : "draw";
    state.tool = tool;

    if (step === "draw") {
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
        b.disabled = !shape.pieces.length && name !== "draw";
        tools.append(b);
      }
      card.append(tools);
    }
    const hint = step === "draw" ? (!shape.pieces.length ? TEXT.start : TEXT.hints[tool]) : guide.doing;
    card.append(ui.paragraph(`${hint} ${TEXT.keys}`, "hint"));

    const body = el("div", "plan-body");
    const left = el("div", "plan-left");
    const wrap = el("div", "plan-wrap");
    // Only this step's problems and those of the steps before it are marked:
    // a later step's are still to come.
    const order = F() ? F().ORDER : [];
    const upTo = (m) => order.indexOf(m.step) <= order.indexOf(step);
    const found = marks(config, shape).filter(upTo);
    const picture = (drawn) => {
      const drawing = drawPicture(config, drawn, tool, marks(config, drawn).filter(upTo), linksFor(config, drawn));
      listen(drawing, config, ctx, drawn, tool);
      return drawing;
    };
    wrap.append(picture(shape));
    wrap.addEventListener("scroll", () => { state.scroll = [wrap.scrollLeft, wrap.scrollTop]; });
    left.append(wrap);
    problemList(left, found, step, ctx);
    body.append(left);

    const panel = el("aside", "plan-panel");
    panel.setAttribute("aria-label", TEXT.selectedLabel);
    if (tool === "select" && shape.pieces.length) {
      if (!state.selected) panel.append(ui.paragraph(guide?.doing || TEXT.nothingHere, "hint"));
      else PANELS[step]?.(panel, config, ctx, ui);
    } else panel.append(ui.paragraph(guide?.doing || TEXT.start, "hint"));
    if (F() && shape.pieces.length) panel.append(F().nextButton(config, ctx, step));
    body.append(panel);
    card.append(body);
    root.append(card);
    // Once the whole page is drawn: laying it out part way would move the page.
    const [left0, top] = state.scroll;
    if ((left0 || top) && typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => { wrap.scrollLeft = left0; wrap.scrollTop = top; });
    }
  }

  global.EsphomeMrLogicUiPlan = { TEXT, PART, CELL, layout, pick, marks, drawPicture };

  if (global.EsphomeMrLogicUi) {
    global.EsphomeMrLogicUi.registerPart({ id: PART, order: 33, modes: ["field"], text: TEXT, render: renderPlan });
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
