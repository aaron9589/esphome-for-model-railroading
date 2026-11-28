// Try it on the Field Logic page's drawing (docs/field-logic-plan-spec.md,
// Try it; work item TP 8): the same picture, live. Click a block to put a
// train in or take it out, a turnout to throw it, a button to press it, a
// switch to flip it, a signal to pick it (then ask for its route or cancel
// it, as its button or CATS would), and flip Auto/Manual. Time runs as it
// does on the board, in real time (Pause stops it). Run a train from a
// signal along the routes its turnouts are set for, a block every few seconds. Taken track is shaded, a
// set route is green, locked turnouts show a lock; a list says what
// happened, and the panel why the picked signal shows what it does.
// The session is logic-try.js; the picture is logic-ui-plan.js. Pure parts
// (pathFrom, overlay) are checked by test/plan-try.test.js.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const PART = "logic-plan-try";
  const T = () => global.EsphomeMrLogicTry;
  const U = () => global.EsphomeMrLogicUiPlan;
  const B = () => global.EsphomeMrPlanBuilder;
  const E = () => global.EsphomeMrPlanEdit;
  const SEP = "\u0000";

  const TEXT = Object.freeze({
    card: "Try it",
    intro: "Click a block to put a train in or take it out, a turnout to throw it, a button to press it, a switch to flip it. Pick a signal to ask for its route. Nothing here touches the layout.",
    gridLabel: "The drawing, live",
    auto: "Auto",
    manual: "Manual",
    autoIs: (on) => (on ? "The board is in Auto: it asks for a route when a train arrives at a signal." : "The board is in Manual: a route is asked for by its signal's button, or by CATS or JMRI clearing it."),
    flipAuto: (on) => (on ? "Switch to Manual" : "Switch to Auto"),
    pause: "Pause",
    resume: "Carry on",
    paused: "Paused.",
    again: "Start again",
    time: (s) => `${(Number(s) || 0).toFixed(1)} s`,
    runFrom: "Run a train from",
    runNone: "Pick a signal…",
    run: "Run a train",
    running: "The train is running…",
    noPath: "There is no way on from that signal with the turnouts as they are.",
    signalTitle: (mast) => `Signal ${mast}`,
    shows: (meaning) => `Shows ${meaning}.`,
    ask: "Ask for a route",
    cancel: "Cancel its route",
    askHint: "As its button, or CATS clearing it, would: it asks only in Manual, or for a Manual only signal. The route is tried once: if it can't be set now, nothing happens.",
    why: "Why",
    turnoutTitle: (name) => `Turnout ${name}`,
    happened: "What happened",
    nothingYet: "Nothing yet.",
    legend: Object.freeze({ train: "A train", taken: "Track taken by a route", route: "A route set, waiting for its train", locked: "Locked" }),
  });

  // Run a train: a block every few seconds, in real time.
  const TRAIN_MS = 3000;

  const COLOURS = Object.freeze({ stop: "#dc2626", restricting: "#dc2626", approach: "#f59e0b", advance: "#84cc16", clear: "#16a34a", dark: "#4b5563" });

  // ===== Pure ================================================================

  /**
   * The blocks a train runs through from a signal: the block behind it, then
   * each route the turnouts (`positions`: { turnout: "closed" | "thrown" })
   * are set for, signal after signal, to an end. Block names, in order.
   */
  function pathFrom(config, mast, positions) {
    const t = B().trace(config);
    const blockOf = (region) => t.regionBlock.get(region)?.name;
    let signal = t.signals.find((s) => s.mast === mast);
    if (!signal) return [];
    const path = [];
    const add = (name) => { if (name && !path.includes(name)) path.push(name); };
    add(blockOf(signal.behind));
    for (let hops = 0; signal && hops < 40; hops += 1) {
      const route = list(signal.routes).find((r) => list(r.turnouts).every((x) => (positions[x.turnout] || "closed") === x.position));
      if (!route) break;
      for (const region of list(route.regions)) add(blockOf(region));
      signal = route.next ? t.signals.find((s) => s.mast === route.next) : null;
    }
    return path;
  }

  /**
   * What each block is now, for the picture: { [block]: "train" | "route" |
   * "taken" | "" }. A route is set (green) while its rule holds a section of
   * the block and its train has not entered it; taken (shaded) once it has.
   */
  function overlay(board, view) {
    const out = {};
    const sections = new Map(list(view.sections).map((s) => [s.name, s]));
    for (const res of list(board.logic?.resources)) {
      const s = sections.get(res.name);
      if (!s || s.state === "IDLE") continue;
      const look = s.state === "ACTIVE" ? "route" : "taken";
      for (const block of list(res.blocks)) if (typeof block === "string" && out[block] !== "route") out[block] = look;
    }
    return out;
  }

  // ===== The page ============================================================

  const state = { config: null, session: null, selected: null, from: "", running: false, paused: false };

  // The clock: time runs in real time while the drawing is on the page, a
  // scan each tenth of a second, and the page is drawn again only when what
  // it shows has changed (not while a list is open, which a redraw would
  // close, nor while a mouse button is down). A tab in the background catches up at most a second at a time.
  const TICK_MS = 100;
  const clock = { timer: null, last: 0, seen: "", redraw: null, down: false, listening: false };
  const nowMs = () => (global.performance?.now ? global.performance.now() : Date.now());
  const looksOf = (view) => JSON.stringify([view.masts.map((m) => m.aspect), view.sections.map((s) => s.state),
    view.turnouts.map((t) => [t.position, t.locked]), view.rules.map((r) => r.phase), view.auto, view.lamps, view.panel, view.log.length]);

  function tick() {
    const grid = global.document?.getElementById?.("logic-try-grid");
    if (!grid || !state.session) {
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
    const view = state.session.view();
    const time = global.document.getElementById("logic-try-time");
    if (time) time.textContent = TEXT.time(view.time / 1000);
    const looks = looksOf(view);
    const open = global.document.activeElement;
    // Not mid-click either: a redraw between press and release loses the click.
    if (looks === clock.seen || clock.down || (open?.tagName === "SELECT" && open.closest?.(`#${PART}`))) return;
    clock.seen = looks;
    clock.redraw?.();
  }

  function startClock(redraw) {
    clock.redraw = redraw;
    clock.seen = looksOf(state.session.view());
    if (clock.timer || typeof setInterval !== "function" || !global.document) return;
    if (!clock.listening) {
      clock.listening = true;
      global.document.addEventListener("pointerdown", () => { clock.down = true; }, true);
      for (const name of ["pointerup", "pointercancel"]) global.document.addEventListener(name, () => { clock.down = false; }, true);
    }
    clock.last = nowMs();
    clock.timer = setInterval(tick, TICK_MS);
  }
  const SVG = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs = {}, text) => {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
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

  function sessionOf(config) {
    const table = JSON.stringify(global.EsphomeMrLogicYaml.logicTable(config));
    if (state.config !== config || state.table !== table || !state.session) {
      Object.assign(state, { config, table, session: T().createSession(config), selected: null, running: false, paused: false });
      state.session?.advance(1000);
    }
    return state.session;
  }

  const keyOf = (session, kind, name) => session.inputs().find((i) => i.key === `${kind}${SEP}${name}`)?.key || null;

  function press(session, kind, name) {
    const key = keyOf(session, kind, name);
    if (!key) return;
    if (kind === "button") {
      session.setInput(key, "pressed");
      session.setInput(key, "released");
    } else {
      const now = session.inputs().find((i) => i.key === key)?.value;
      session.setInput(key, now === "on" ? "off" : "on");
    }
  }

  function render(root, config, ctx, ui) {
    const session = sessionOf(config);
    const card = ui.card(PART, TEXT.card);
    if (!session) {
      root.append(card);
      return;
    }
    card.append(ui.paragraph(TEXT.intro, "hint"));
    const view = session.view();
    const engineState = { auto: view.auto, lamps: view.lamps || {}, panel: view.panel || {} };
    const redraw = (focus) => {
      const had = focus || (document.activeElement?.id ? `#${document.activeElement.id}` : "");
      ctx.render();
      if (had) document.querySelector(had)?.focus({ preventScroll: true });
    };

    // Controls: Auto/Manual, pause, start again, run a train.
    const bar = el("div", "plan-tools");
    const autoOn = engineState.auto !== "off";
    const flip = button(TEXT.flipAuto(autoOn), () => {
      session.event({ auto: autoOn ? "off" : "on" });
      redraw("#logic-try-auto");
    });
    flip.id = "logic-try-auto";
    const pause = button(state.paused ? TEXT.resume : TEXT.pause, () => {
      state.paused = !state.paused;
      clock.last = nowMs();
      redraw("#logic-try-pause");
    });
    pause.id = "logic-try-pause";
    bar.append(flip, pause,
      button(TEXT.again, () => { session.reset(); session.advance(1000); state.selected = null; state.paused = false; redraw(); }));
    const said = ui.paragraph(`${TEXT.autoIs(autoOn)} `, "hint");
    const time = el("span", "", TEXT.time(view.time / 1000));
    time.id = "logic-try-time";
    said.append(time, state.paused ? ` ${TEXT.paused}` : "");
    card.append(bar, said);

    const signals = list(config.logic.plan?.breaks).flatMap((b) => list(b?.signals).map((s) => s?.mast)).filter(Boolean);
    const run = el("div", "plan-run");
    const from = ctx.field(TEXT.runFrom, state.from, (v) => { state.from = v; }, {
      select: [{ value: "", label: TEXT.runNone }, ...signals.map((m) => ({ value: m, label: m }))],
    });
    from.querySelector("select").id = "logic-try-from";
    const go = button(state.running ? TEXT.running : TEXT.run, () => {
      if (!state.from || state.running) return;
      const positions = Object.fromEntries(view.turnouts.map((t) => [t.name, t.position]));
      const path = pathFrom(config, state.from, positions);
      if (path.length < 2) return ctx.flash("err", TEXT.noPath);
      // One block at a time, the picture drawn again after each.
      const moves = [];
      path.forEach((block, i) => {
        moves.push(() => session.setBlock(block, true));
        if (i > 0) moves.push(() => session.setBlock(path[i - 1], false));
      });
      moves.push(() => session.setBlock(path[path.length - 1], false));
      state.running = true;
      const next = () => {
        const move = moves.shift();
        if (!move) {
          state.running = false;
          return redraw();
        }
        // Paused: the train waits too.
        if (state.paused) return setTimeout(next, 250);
        move();
        redraw();
        setTimeout(next, TRAIN_MS);
      };
      next();
    }, "primary");
    go.id = "logic-try-run";
    go.disabled = state.running;
    run.append(from, go);
    card.append(run);

    // The picture, live.
    const shape = U().layout(config);
    const drawing = U().drawPicture(config, shape, "select", [], []);
    drawing.id = "logic-try-grid";
    drawing.setAttribute("aria-label", TEXT.gridLabel);
    const px = (v) => Math.round(v * U().CELL * 10) / 10;
    const looks = overlay(session.board, view);
    for (const piece of shape.pieces) {
      if (!piece.block) continue;
      const train = session.blockOccupied(piece.block);
      const look = train ? "train" : looks[piece.block] || "";
      if (!look) continue;
      drawing.append(svg("line", { class: `plan-live is-${look}`, x1: px(piece.a[0]), y1: px(piece.a[1]), x2: px(piece.b[0]), y2: px(piece.b[1]) }));
    }
    const masts = new Map(view.masts.map((m) => [m.name, m]));
    for (const s of shape.signals) {
      const m = masts.get(s.mast);
      const colour = !m?.aspect ? COLOURS.dark : m.aspect === "dark" ? COLOURS.dark : COLOURS[m.tag] || COLOURS.stop;
      drawing.append(svg("circle", { class: "plan-live-lamp", cx: px(s.head[0]), cy: px(s.head[1]), r: 7, fill: colour }));
    }
    const turnoutAt = new Map(list(config.logic.plan?.points).filter((p) => isObject(p) && p.turnout).map((p) => [p.turnout, p.at]));
    for (const t of view.turnouts) {
      const at = turnoutAt.get(t.name);
      if (!at) continue;
      drawing.append(svg("text", { class: "plan-live-turnout", x: px(at[0]), y: px(at[1]) + 22, "text-anchor": "middle" }, t.position === "thrown" ? "T" : "C"));
      if (t.locked || engineState.panel[t.name]) drawing.append(svg("rect", { class: "plan-live-lock", x: px(at[0]) + 9, y: px(at[1]) - 18, width: 9, height: 8, rx: 1 }));
    }
    for (const f of list(shape.fascia)) {
      const light = engineState.lamps[f.name];
      const on = f.kind === "switch" ? session.inputs().find((i) => i.key === `switch${SEP}${f.name}`)?.value === "on" : f.kind === "lamp" ? light && light !== "off" : false;
      if (on) drawing.append(svg("rect", { class: `plan-live-piece${light === "flash" ? " is-flash" : ""}`, x: px(f.at[0]) - 10, y: px(f.at[1]) - 10, width: 20, height: 20, rx: 4 }));
    }
    if (state.selected?.kind === "point") drawing.append(svg("circle", { class: "plan-picked", cx: px(state.selected.at[0]), cy: px(state.selected.at[1]), r: 13 }));

    // Clicks: a block, a turnout, a piece, a signal.
    drawing.addEventListener("click", (event) => {
      if (state.running) return;
      const box = drawing.getBoundingClientRect();
      const v = shape.view;
      const x = v.x - 0.5 + ((event.clientX - box.left) / box.width) * v.w;
      const y = v.y - 0.5 + ((event.clientY - box.top) / box.height) * v.h;
      const found = U().pick(shape, x, y);
      if (!found) return;
      if (found.kind === "fascia") {
        const piece = list(shape.fascia).find((f) => f.name === found.name);
        if (piece?.kind === "button" || piece?.kind === "switch") press(session, piece.kind, piece.name);
      } else if (found.kind === "piece") {
        const block = E().blockAt(config, found.a, found.b)?.name;
        if (block) session.setBlock(block, !session.blockOccupied(block));
      } else if (found.kind === "point") {
        const turnout = list(config.logic.plan.points).find((p) => isObject(p) && p.turnout && p.at[0] === found.at[0] && p.at[1] === found.at[1])?.turnout;
        if (turnout) {
          const now = view.turnouts.find((t) => t.name === turnout);
          if (!now?.locked && !engineState.panel[turnout]) session.setTurnout(turnout, now?.position === "thrown" ? "closed" : "thrown");
        }
        state.selected = found;
      }
      redraw("#logic-try-grid");
    });

    // The whole width for the drawing: the panel goes under it.
    const body = el("div", "plan-body is-try");
    const left = el("div", "plan-left");
    const wrap = el("div", "plan-wrap");
    wrap.append(drawing);
    left.append(wrap);
    const legend = el("p", "hint plan-legend");
    for (const [k, words] of Object.entries(TEXT.legend)) {
      const chip = el("span", `plan-chip is-${k}`);
      legend.append(chip, ` ${words} `);
    }
    left.append(legend);
    body.append(left);

    // The panel: the picked signal, and what happened.
    const panel = el("aside", "plan-panel");
    const brk = state.selected?.kind === "point" ? E().breakAt(config.logic.plan, state.selected.at) : null;
    for (const s of list(brk?.signals).filter((x) => x?.mast)) {
      const m = masts.get(s.mast);
      panel.append(el("h4", "", TEXT.signalTitle(s.mast)), el("p", "card-copy", TEXT.shows(m?.meaning || "")));
      const row = el("div", "plan-tools");
      const hold = (held) => session.event({ jmri: s.mast, message: `R292; Lit; ${held ? "Held" : "Unheld"}` });
      row.append(button(TEXT.ask, () => { hold(true); hold(false); redraw(); }), button(TEXT.cancel, () => { hold(true); redraw(); }));
      panel.append(row, el("p", "hint", TEXT.askHint));
      const why = global.EsphomeMrLogic?.explainMast?.(session.board, s.mast);
      if (Array.isArray(why) && why.length) {
        panel.append(el("h5", "", TEXT.why));
        for (const line of why.slice(0, 6)) panel.append(el("p", "hint", typeof line === "string" ? line : line?.text || ""));
      }
    }
    panel.append(el("h5", "", TEXT.happened));
    const entries = view.log.slice(-12).reverse();
    if (!entries.length) panel.append(el("p", "hint", TEXT.nothingYet));
    const logList = el("ul", "plan-log");
    for (const entry of entries) logList.append(el("li", "", `${TEXT.time(entry.time / 1000)}: ${entry.text}`));
    panel.append(logList);
    if (global.EsphomeMrLogicUiField) panel.append(global.EsphomeMrLogicUiField.nextButton(config, ctx, "try"));
    body.append(panel);
    card.append(body);
    root.append(card);
    startClock(() => redraw());
  }

  global.EsphomeMrLogicUiPlanTry = { TEXT, PART, pathFrom, overlay };

  if (global.EsphomeMrLogicUi) {
    global.EsphomeMrLogicUi.registerPart({
      id: PART, order: 34, modes: ["field"], text: TEXT,
      show: (config) => global.EsphomeMrLogicUiField?.currentStep(config) === "try" && !!config?.logic?.plan,
      render,
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
