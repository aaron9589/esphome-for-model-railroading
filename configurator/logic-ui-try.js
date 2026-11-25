// The Logic page: Try it (logic-try, order 88). Work item 2.10.
// Loaded after logic-ui-start.js; this file registers its part with
// EsphomeMrLogicUi.registerPart. Every word it shows is in its TEXT (and the
// core's, logic-try.js), which test/logic-page.test.js lints for spec-only
// terms. Scan, latch, phase and the rest appear nowhere: the timing details
// say time, rules and waiting order.
//
// The DOM is thin. The session, the track shapes and Run a train are in
// logic-try.js, which Node tests check without a DOM.
(function (global) {
  const TEXT = Object.freeze({
    card: "Try it",
    intro: "Set the sensors, turnouts and buttons the rules read, and watch the signals. Nothing here touches the layout.",
    nothingYet: "Add some rules first. Then you can try them here.",
    cannotRun: (why) => `These rules cannot run yet: ${why}`,
    step: "Step",
    stepHint: "Moves the time on by a tenth of a second.",
    run: "Run",
    stop: "Stop",
    skip: (seconds) => `Skip ahead ${seconds} second${seconds === 1 ? "" : "s"}`,
    reset: "Start again",
    inputsHeading: "Inputs",
    inputsHint: "Change one and the rules react at once. A value that is Not known is what another board reads when it is switched off or has not been heard from.",
    noInputs: "The rules read nothing you can change.",
    boardsHeading: "Other boards",
    boardOnline: (name) => `${name} is switched on and heard`,
    signalsHeading: "Signals",
    noSignals: "No signals.",
    sectionsHeading: "Sections",
    noSections: "No sections.",
    turnoutsHeading: "Turnouts",
    locked: "Locked",
    trackHeading: "Track",
    trackHint: "Click a block to put a train in it or take it out. Click a turnout to throw it.",
    blockLabel: (name, occupied) => `${name}: ${occupied ? "a train is in it" : "empty"}`,
    turnoutLabel: (name, position) => `${name}: ${position}. Click to change.`,
    mastLabel: (name, aspect) => `${name}: ${aspect}`,
    closed: "closed",
    thrown: "thrown",
    showingMe: "Showing the steps that lead to the problem. Step and Run carry on from here.",
    detailsFold: "Show timing details",
    timeLabel: "Time",
    time: (ms) => `${(ms / 1000).toFixed(1)} s`,
    rulesHeading: "Rules",
    waitingHeading: "Waiting order",
    waitingNone: "Nothing is waiting.",
    eventsHeading: "What happened",
    eventsNone: "Nothing yet.",
    trainHeading: "Run a train",
    trainIntro: "A train runs along the track one block at a time, and every signal is recorded at each step. It starts from the inputs as they are now.",
    trainNeedStarter: "Run a train needs a group made from a starter, such as Block signals or One-train section.",
    trainAlong: "Along",
    trainFrom: "Starting in",
    trainWay: "Direction",
    trainWays: Object.freeze({ forward: "As drawn, left to right", back: "The other way" }),
    trainLength: "Length in blocks",
    trainGo: "Run a train",
    trainBlocks: "Blocks with a train",
    trainStep: "Step",
    trainNoBlocks: "None",
    trainRowOf: (group, n) => `${group}, track ${n}`,
    trainAcross: "Carry on across the joint",
    trainStay: "Stay on this board",
    trainCross: (end, track) => `Into the pretend neighbour at end ${end}, track ${track}`,
    trainNeighbourHeading: (end, track) => `Pretend neighbour, end ${end}, track ${track}: signals 1 to 3`,
    neighboursHeading: "Pretend neighbours",
    neighboursHint: "A pretend neighbour stands in for the board next door at an end: three blocks of track with a signal at each. It answers the end the way a real board would, so you can run a train across the joint. Click one of its blocks to put a train in it or take it out.",
    neighbourOn: (end) => `End ${end}: pretend there is a neighbour`,
    endName: (end) => `End ${end}`,
    neighbourRuns: Object.freeze({ into: "Trains run towards this board", away: "Trains run away from this board" }),
    neighbourTurn: "Turn it round",
    neighbourBlockLabel: (at, occupied) => `Block ${at}: ${occupied ? "a train is in it" : "empty"}`,
    neighbourHears: (occupied, meaning) => `This board offers it: ${occupied ? "block occupied" : "block clear"}, signal ${meaning}`,
    joint: "Joint",
    drivenValue: (label, value) => `${label}: ${value} (set by the pretend neighbour)`,
    dark: "Dark",
    nothing: "Nothing shown yet",
    // MSS Logic: the picture of the module, and a train through it.
    mssTrackHint: "Click a block to put a train in it or take it out. Click a turnout under a junction, or under a block, to throw it. The route the turnouts set is drawn solid.",
    mssTrainIntro: "A train comes in at an end and runs through the module one block at a time, along the route the turnouts set at each junction. Every signal it meets is recorded at each step. Throw the turnouts first for the route you want.",
    mssTrainNeedTrack: "Run a train needs a track from an end.",
    mssTrainEnter: "Comes in at",
    mssTrainFromNeighbour: (end) => `Start in the pretend neighbour at end ${end}`,
    mssTrainIntoNeighbour: (end) => `Carry on into the pretend neighbour at end ${end}`,
    mssTrainWay: (blocks) => `Its way through: ${blocks}.`,
    mssTrainOut: (end) => ` It leaves at ${end}.`,
    mssTrainDead: " It stops at a dead end.",
    mssTrainNoRoute: " It stops at a junction: the turnouts there set no route from this way. Throw them first.",
  });

  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const SVG = "http://www.w3.org/2000/svg";
  const SEP = "\u0000";
  const T = () => global.EsphomeMrLogicTry;

  // ===== State kept between draws ===========================================
  // One session, for as long as the rules are the same: the page redraws on
  // every change anywhere, and the signals should not jump back each time.
  let current = { json: null, session: null, error: "" };
  let pending = null; // a Show me sequence waiting to be played
  let banner = false;
  let timer = null;
  let trainChoice = { shape: 0, start: "", way: "forward", length: 1, steps: null, group: "", cross: "" };

  function stopRunning() {
    if (timer !== null) global.clearInterval(timer);
    timer = null;
  }

  function sessionFor(config, ctx) {
    const Y = global.EsphomeMrLogicYaml;
    let json = "";
    try {
      const table = Y.logicTable(config);
      json = table ? JSON.stringify(table) : "";
    } catch (err) {
      return { session: null, error: err.message || String(err) };
    }
    if (json && current.json === json) return current;
    stopRunning();
    trainChoice = { shape: 0, start: "", way: "forward", length: 1, steps: null, group: "", cross: "" };
    let session = null;
    let error = "";
    if (json) {
      try {
        session = T().createSession(config);
      } catch (err) {
        error = err.message || String(err);
      }
    }
    current = { json, session, error };
    return current;
  }

  // Show me: the page this links to plays these steps from the start.
  function showMe(sequence) {
    pending = list(sequence);
  }

  // ===== Drawing ============================================================

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svg(tag, attrs = {}, text) {
    const node = document.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(text, onClick, className = "") {
    const b = el("button", className, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  function heading(text) {
    return el("h4", "try-heading", text);
  }

  // A signal as the Signal Masts page draws it, with its name and what it
  // shows. A signal with no lights has no picture, so the words stand alone.
  function mastView(ctx, name, aspect, meaning) {
    const wrap = el("div", "try-mast");
    const picture = aspect && aspect !== "dark" ? ctx.mastPicture?.(name, aspect) : null;
    wrap.append(picture || el("span", "try-mast-picture is-none"));
    const shown = aspect === "dark" ? TEXT.dark : aspect || TEXT.nothing;
    const words = el("span", "try-mast-words");
    words.append(el("strong", "", name), el("span", "", meaning && meaning !== shown ? `${shown}: ${meaning}` : shown));
    wrap.append(words);
    return wrap;
  }

  function renderTry(root, config, ctx, ui) {
    stopRunning();
    const mss = global.EsphomeMr?.logicMode?.(config) === "mss";
    const Module = global.EsphomeMrLogicUiMssModule;
    const section = ui.card("logic-try", TEXT.card);
    section.classList.add("logic-try");
    root.append(section);
    const { session, error } = sessionFor(config, ctx);
    if (!session) {
      section.append(ui.paragraph(error ? TEXT.cannotRun(error) : TEXT.nothingYet));
      return;
    }
    section.append(ui.paragraph(TEXT.intro));
    if (pending) {
      session.play(pending);
      pending = null;
      banner = true;
    }

    const isRunning = () => timer !== null;
    const parts = {};
    // MSS Logic draws the whole module instead of a starter's strips (any
    // Field Logic groups kept beside the description are not what runs).
    const shapes = mss ? [] : session.shapes;
    const names = mss ? global.EsphomeMrMssBuilder.namesOf(config) : null;

    // ----- controls -----
    const bar = el("div", "try-controls");
    const runButton = button(TEXT.run, () => (isRunning() ? pause() : go()), "primary");
    function go() {
      timer = global.setInterval(() => {
        if (!section.isConnected || section.closest("[hidden]")) {
          stopRunning();
          syncRun();
          return;
        }
        session.step();
        draw();
      }, global.EsphomeMrLogic.SCAN_MS);
      syncRun();
    }
    function pause() {
      stopRunning();
      syncRun();
    }
    function syncRun() {
      runButton.textContent = isRunning() ? TEXT.stop : TEXT.run;
    }
    const stepButton = button(TEXT.step, () => {
      session.step();
      draw();
    });
    stepButton.title = TEXT.stepHint;
    const skip = (seconds) => button(TEXT.skip(seconds), () => {
      session.advance(seconds * 1000);
      draw();
    });
    const again = button(TEXT.reset, () => {
      pause();
      session.reset();
      banner = false;
      trainChoice.steps = null;
      ctx.render();
    });
    bar.append(runButton, stepButton, skip(1), skip(10), again);
    section.append(bar);

    if (banner) {
      const note = el("div", "try-banner", TEXT.showingMe);
      section.append(note);
    }

    // ----- inputs -----
    parts.inputs = el("div", "try-inputs");
    section.append(heading(TEXT.inputsHeading), parts.inputs);
    function drawInputs() {
      parts.inputs.replaceChildren();
      const T0 = T();
      const inputs = session.inputs();
      const boards = session.boards();
      if (!inputs.length && !boards.length) parts.inputs.append(ui.paragraph(TEXT.noInputs));
      for (const info of inputs) {
        if (info.driven) {
          parts.inputs.append(ui.paragraph(TEXT.drivenValue(info.label, T0.valueLabel(info, info.value)), "hint"));
          continue;
        }
        const options = info.values.map((value) => ({ value, label: T0.valueLabel(info, value) }));
        if (!info.values.includes(info.value)) options.unshift({ value: info.value, label: T0.valueLabel(info, info.value), disabled: true });
        const field = ctx.field(info.label, info.value, (value) => {
          session.setInput(info.key, value, { scan: !isRunning() });
          draw();
          drawInputs();
        }, { select: options });
        parts.inputs.append(field);
        const reads = info.kind === "end" || info.value === "unknown" ? T0.readsAs(info) : "";
        if (info.remote && reads) field.append(ctx.hintEl(reads));
      }
      if (boards.length) {
        parts.inputs.append(heading(TEXT.boardsHeading));
        for (const other of boards) {
          parts.inputs.append(ctx.field(TEXT.boardOnline(other.name), other.online, (checked) => {
            session.setBoardOnline(other.name, checked, { scan: !isRunning() });
            draw();
          }, { checkbox: true }));
        }
      }
    }
    drawInputs();
    section.append(ui.paragraph(TEXT.inputsHint, "hint"));

    // ----- the track -----
    if (shapes.length || (mss && Object.keys(names.blocks).length)) {
      parts.track = el("div", "try-track");
      section.append(heading(TEXT.trackHeading), ui.paragraph(mss ? TEXT.mssTrackHint : TEXT.trackHint, "hint"), parts.track);
    }

    // ----- the pretend neighbours -----
    if (session.neighbours().length) {
      parts.neighbours = el("div", "try-neighbours");
      section.append(heading(TEXT.neighboursHeading), ui.paragraph(TEXT.neighboursHint, "hint"), parts.neighbours);
    }

    // ----- what it shows -----
    parts.signals = el("div", "try-signals");
    parts.sections = el("div", "try-sections");
    parts.turnouts = el("div", "try-turnouts");
    // MSS Logic has no sections.
    if (mss) section.append(heading(TEXT.signalsHeading), parts.signals, heading(TEXT.turnoutsHeading), parts.turnouts);
    else section.append(heading(TEXT.signalsHeading), parts.signals, heading(TEXT.sectionsHeading), parts.sections, heading(TEXT.turnoutsHeading), parts.turnouts);

    // ----- Run a train -----
    parts.train = el("div", "try-train");
    section.append(heading(TEXT.trainHeading), parts.train);

    // ----- timing details -----
    const details = el("details", "try-details");
    details.append(el("summary", "", TEXT.detailsFold));
    parts.time = el("p", "try-time");
    parts.rules = el("div", "try-rules");
    parts.waiting = el("div", "try-waiting");
    parts.events = el("div", "try-events");
    details.append(parts.time, parts.rules, parts.waiting, parts.events);
    section.append(details);

    // ----- redraw -----
    let last = "";
    function draw() {
      const view = session.view();
      parts.time.textContent = `${TEXT.timeLabel}: ${TEXT.time(view.time)}`;
      const signature = JSON.stringify([
        view.masts.map((m) => m.aspect), view.sections.map((s) => [s.state, s.holder]), view.turnouts.map((t) => [t.position, t.locked, t.byRules]),
        view.rules.map((r) => r.phase), view.waiting, view.log.length, session.inputs().map((i) => i.value), view.neighbours, shapes.length ? shapes.map((s) => s.blocks.map((b) => session.blockOccupied(blockRef(s, b)))) : 0,
        mss ? Object.values(names.blocks).map((b) => session.blockOccupied(b)) : 0,
      ]);
      if (signature === last) return;
      last = signature;
      drawSignals(view);
      drawSections(view);
      drawTurnouts(view);
      drawDetails(view);
      drawTrack(view);
      drawNeighbours(view);
    }

    function blockRef(shape, name) {
      for (const row of shape.rows) for (const item of row.items) if (item.type === "block" && item.name === name) return item.ref;
      return name;
    }

    function drawSignals(view) {
      parts.signals.replaceChildren();
      if (!view.masts.length) return void parts.signals.append(ui.paragraph(TEXT.noSignals));
      // MSS Logic makes signals with no lights where the module has none; they are not shown.
      const hidden = new Set(mss ? names.signals.filter((x) => x.virtual).map((x) => x.name) : []);
      for (const mast of view.masts) if (!hidden.has(mast.name)) parts.signals.append(mastView(ctx, mast.name, mast.aspect, mast.meaning));
    }

    function drawSections(view) {
      parts.sections.replaceChildren();
      if (!view.sections.length) return void parts.sections.append(ui.paragraph(TEXT.noSections));
      for (const s of view.sections) {
        const row = el("p", `try-section is-${s.state.toLowerCase()}`);
        row.append(el("strong", "", s.name), ` ${s.text}`);
        if (s.heldBy) row.append(` (${s.heldBy})`);
        parts.sections.append(row);
      }
    }

    function drawTurnouts(view) {
      parts.turnouts.replaceChildren();
      if (!view.turnouts.length) return;
      for (const t of view.turnouts) {
        const row = el("p", `try-turnout${t.locked ? " is-locked" : ""}`);
        row.append(el("strong", "", t.name), ` ${TEXT[t.position] || t.position}. ${t.text}`);
        parts.turnouts.append(row);
      }
    }

    function drawDetails(view) {
      parts.rules.replaceChildren(heading(TEXT.rulesHeading));
      const rules = el("ul", "try-list");
      for (const rule of view.rules) rules.append(el("li", "", `${rule.words}: ${rule.text}`));
      parts.rules.append(rules);
      parts.waiting.replaceChildren(heading(TEXT.waitingHeading));
      if (!view.waiting.length) parts.waiting.append(ui.paragraph(TEXT.waitingNone));
      else {
        const waiting = el("ol", "try-list");
        for (const words of view.waiting) waiting.append(el("li", "", words));
        parts.waiting.append(waiting);
      }
      parts.events.replaceChildren(heading(TEXT.eventsHeading));
      if (!view.log.length) parts.events.append(ui.paragraph(TEXT.eventsNone));
      else {
        const events = el("ul", "try-list");
        for (const entry of [...view.log].reverse().slice(0, 12)) events.append(el("li", "", `${TEXT.time(entry.time)}: ${entry.text}`));
        parts.events.append(events);
      }
    }

    // ----- the strip diagram -----
    function toggleBlock(ref) {
      session.setBlock(ref, !session.blockOccupied(ref), { scan: !isRunning() });
      draw();
      drawInputs();
    }

    function toggleTurnout(ref) {
      session.setTurnout(ref, session.turnoutPosition(ref) === "thrown" ? "closed" : "thrown", { scan: !isRunning() });
      draw();
      drawInputs();
    }

    function clickable(node, label, onActivate) {
      node.setAttribute("role", "button");
      node.setAttribute("tabindex", "0");
      node.setAttribute("aria-label", label);
      node.classList.add("is-clickable");
      node.addEventListener("click", onActivate);
      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate();
        }
      });
    }

    function drawStrip(shape, row, view) {
      const layout = T().stripLayout(row);
      const mastNow = new Map(view.masts.map((m) => [m.name, m]));
      const most = Math.max(0, ...layout.items.map((item) => list(item.turnouts).length));
      const height = layout.height + 16 * most;
      const drawing = svg("svg", { class: "try-strip", viewBox: `0 0 ${layout.width} ${height}`, width: layout.width, height, role: "group", "aria-label": shape.group });
      drawing.append(svg("line", { class: "try-rail", x1: 0, y1: 92, x2: layout.width, y2: 92 }));
      for (const item of layout.items) {
        const cx = item.x + item.w / 2;
        if (item.type === "block") {
          const occupied = session.blockOccupied(item.ref);
          const g = svg("g", { class: `try-block${occupied ? " is-occupied" : ""}` });
          g.append(svg("rect", { x: item.x + 2, y: 72, width: item.w - 4, height: 40, rx: 6 }));
          if (occupied) g.append(svg("rect", { class: "try-train-body", x: item.x + 16, y: 82, width: item.w - 32, height: 20, rx: 4 }));
          g.append(svg("text", { class: "try-label", x: cx, y: 128, "text-anchor": "middle" }, item.name));
          clickable(g, TEXT.blockLabel(item.name, occupied), () => toggleBlock(item.ref));
          drawing.append(g);
          list(item.turnouts).forEach((t, i) => {
            const position = session.turnoutPosition(t.ref);
            const wanted = position === t.through;
            const tg = svg("g", { class: `try-turnout-mark${wanted ? "" : " is-off-route"}` });
            const y = 144 + 16 * i;
            tg.append(svg("rect", { x: item.x + 6, y: y - 11, width: item.w - 12, height: 15, rx: 7 }));
            tg.append(svg("text", { class: "try-label", x: cx, y, "text-anchor": "middle" }, `${t.name} ${TEXT[position] || position}`));
            clickable(tg, TEXT.turnoutLabel(t.name, TEXT[position] || position), () => toggleTurnout(t.ref));
            drawing.append(tg);
          });
        } else {
          const now = mastNow.get(item.name);
          const tag = now?.tag || "none";
          const g = svg("g", { class: `try-signal tag-${tag}${item.external ? " is-external" : ""}` });
          g.append(svg("title", {}, TEXT.mastLabel(item.name, now?.aspect || TEXT.nothing)));
          g.append(svg("line", { class: "try-post", x1: cx, y1: 92, x2: cx, y2: 42 }));
          g.append(svg("circle", { class: "try-head", cx, cy: 34, r: 10 }));
          g.append(svg("path", { class: "try-arrow", d: item.dir > 0 ? `M ${cx - 6} 80 L ${cx + 8} 92 L ${cx - 6} 104` : `M ${cx + 6} 80 L ${cx - 8} 92 L ${cx + 6} 104`, fill: "none" }));
          g.append(svg("text", { class: "try-label", x: cx, y: 12, "text-anchor": "middle" }, item.name));
          drawing.append(g);
        }
      }
      const wrap = el("div", "try-strip-wrap");
      wrap.append(drawing);
      return wrap;
    }

    function drawTrack(view) {
      if (!parts.track) return;
      parts.track.replaceChildren();
      if (mss) {
        const tags = new Map(view.masts.map((m) => [m.name, m.tag]));
        const picture = Module.livePicture(config, ctx, {
          names,
          tagOf: (name) => tags.get(name) || "",
          occupied: (name) => session.blockOccupied(name),
          position: (name) => session.turnoutPosition(name) || "closed",
          toggleBlock: (name) => toggleBlock(name),
          toggleTurnout: (name) => toggleTurnout(name),
        });
        if (picture) parts.track.append(picture);
        return;
      }
      for (const shape of shapes) {
        const box = el("div", "try-shape");
        box.append(el("h5", "try-shape-name", shape.group));
        for (const row of shape.rows) box.append(drawStrip(shape, row, view));
        parts.track.append(box);
      }
    }

    // ----- the pretend neighbours -----
    function toggleNeighbourBlock(ref) {
      session.setBlock(ref, !session.blockOccupied(ref), { scan: !isRunning() });
      draw();
      drawInputs();
    }

    function drawNeighbourStrip(track, endName) {
      const blockW = 76;
      const gap = 44;
      const width = 24 + 3 * (blockW + gap);
      const drawing = svg("svg", { class: "try-strip", viewBox: `0 0 ${width} 150`, width, height: 150, role: "group", "aria-label": TEXT.trainCross(endName, track.track) });
      drawing.append(svg("line", { class: "try-rail", x1: 0, y1: 92, x2: width, y2: 92 }));
      drawing.append(svg("line", { class: "try-joint", x1: 10, y1: 60, x2: 10, y2: 124 }));
      drawing.append(svg("text", { class: "try-label", x: 10, y: 144, "text-anchor": "start" }, TEXT.joint));
      track.blocks.forEach((block, i) => {
        const x = 24 + i * (blockW + gap) + (track.direction === "away" ? gap : 0);
        const g = svg("g", { class: `try-block${block.occupied ? " is-occupied" : ""}` });
        g.append(svg("rect", { x, y: 72, width: blockW, height: 40, rx: 6 }));
        if (block.occupied) g.append(svg("rect", { class: "try-train-body", x: x + 14, y: 82, width: blockW - 28, height: 20, rx: 4 }));
        g.append(svg("text", { class: "try-label", x: x + blockW / 2, y: 128, "text-anchor": "middle" }, String(block.at)));
        clickable(g, TEXT.neighbourBlockLabel(block.at, block.occupied), () => toggleNeighbourBlock(block.ref));
        drawing.append(g);
        const signal = track.signals[i];
        const cx = track.direction === "away" ? x - gap / 2 : x + blockW + gap / 2;
        const sg = svg("g", { class: `try-signal tag-${signal.tag}` });
        sg.append(svg("title", {}, `${signal.at}: ${signal.meaning}`));
        sg.append(svg("line", { class: "try-post", x1: cx, y1: 92, x2: cx, y2: 42 }));
        sg.append(svg("circle", { class: "try-head", cx, cy: 34, r: 10 }));
        sg.append(svg("path", { class: "try-arrow", d: track.direction === "away" ? `M ${cx - 6} 80 L ${cx + 8} 92 L ${cx - 6} 104` : `M ${cx + 6} 80 L ${cx - 8} 92 L ${cx + 6} 104`, fill: "none" }));
        drawing.append(sg);
      });
      const wrap = el("div", "try-strip-wrap");
      wrap.append(drawing);
      return wrap;
    }

    function drawNeighbours(view) {
      if (!parts.neighbours) return;
      parts.neighbours.replaceChildren();
      for (const neighbour of view.neighbours) {
        const box = el("div", "try-shape");
        const state = view.ends.find((e) => e.name === neighbour.end);
        box.append(el("h5", "try-shape-name", state?.text ? `${TEXT.endName(neighbour.end)}: ${state.text}` : TEXT.endName(neighbour.end)));
        box.append(ctx.field(TEXT.neighbourOn(neighbour.end), neighbour.on, (checked) => {
          session.setNeighbour(neighbour.end, checked, { scan: !isRunning() });
          trainChoice.cross = "";
          trainChoice.steps = null;
          draw();
          drawInputs();
          drawTrain();
          drawNeighbours(session.view());
        }, { checkbox: true }));
        if (neighbour.on) {
          for (const track of neighbour.tracks) {
            const row = el("div", "try-neighbour-track");
            row.append(el("p", "hint", `${TEXT.trainCross(neighbour.end, track.track)}. ${TEXT.neighbourRuns[track.direction]}. ${TEXT.neighbourHears(track.hears.occupied, (T().TEXT.meanings[track.hears.tag] || track.hears.tag))}`));
            row.append(button(TEXT.neighbourTurn, () => {
              session.turnNeighbour(neighbour.end, track.track, { scan: !isRunning() });
              trainChoice.steps = null;
              draw();
              drawInputs();
              drawTrain();
              drawNeighbours(session.view());
            }));
            row.append(drawNeighbourStrip(track, neighbour.end));
            box.append(row);
          }
        }
        parts.neighbours.append(box);
      }
    }

    // ----- Run a train -----
    function trainOptions() {
      const out = [];
      shapes.forEach((shape, shapeIndex) => shape.rows.forEach((row, rowIndex) => {
        out.push({ shapeIndex, rowIndex, shape, row, label: shape.rows.length > 1 ? TEXT.trainRowOf(shape.group, rowIndex + 1) : shape.group });
      }));
      return out;
    }

    // MSS Logic: in at an end, along the route the turnouts set, out at another.
    function drawMssTrain() {
      const starts = Module.trainStarts(config);
      if (!starts.length) return void parts.train.append(ui.paragraph(TEXT.mssTrainNeedTrack));
      parts.train.append(ui.paragraph(TEXT.mssTrainIntro, "hint"));
      const key = (s) => `${s.end}${SEP}${s.track}`;
      if (!starts.some((s) => key(s) === trainChoice.start)) trainChoice.start = key(starts[0]);
      const start = starts.find((s) => key(s) === trainChoice.start);
      const route = Module.trainRoute(config, start, (name) => session.turnoutPosition(name) || "closed");
      const on = new Set(session.neighbours().filter((n) => n.on).map((n) => n.end));
      const fields = el("div", "fields try-train-fields");
      fields.append(ctx.field(TEXT.mssTrainEnter, trainChoice.start, (value) => {
        trainChoice = { ...trainChoice, start: value, steps: null, from: false, into: false };
        drawTrain();
      }, { select: starts.map((s) => ({ value: key(s), label: s.label })) }));
      fields.append(ctx.field(TEXT.trainLength, String(trainChoice.length), (value) => {
        trainChoice.length = Math.max(1, Math.floor(Number(value)) || 1);
      }, { type: "number" }));
      if (on.has(start.end)) {
        fields.append(ctx.field(TEXT.mssTrainFromNeighbour(start.end), trainChoice.from === true, (checked) => { trainChoice.from = checked; }, { checkbox: true }));
      }
      if (route.exit && on.has(route.exit.end)) {
        fields.append(ctx.field(TEXT.mssTrainIntoNeighbour(route.exit.end), trainChoice.into === true, (checked) => { trainChoice.into = checked; }, { checkbox: true }));
      }
      parts.train.append(fields);
      const ending = route.exit ? TEXT.mssTrainOut(starts.find((s) => s.end === route.exit.end && s.track === route.exit.track)?.label || route.exit.end)
        : route.stop === "route" ? TEXT.mssTrainNoRoute : route.stop === "dead" ? TEXT.mssTrainDead : "";
      parts.train.append(ui.paragraph(TEXT.mssTrainWay(route.blocks.join(", ") || TEXT.trainNoBlocks) + ending, "hint"));
      parts.train.append(button(TEXT.trainGo, () => {
        let path = [...route.blocks];
        const across = [];
        // A pretend neighbour's trains run the way this one does.
        const facing = (end, track, want) => {
          const now = session.neighbours().find((n) => n.end === end)?.tracks.find((t) => t.track === track);
          if (now && now.direction !== want) session.turnNeighbour(end, track, { scan: false });
        };
        if (trainChoice.from && on.has(start.end)) {
          facing(start.end, start.track, "into");
          path = [...session.neighbourPath(start.end, start.track), ...path];
          across.push({ end: start.end, track: start.track });
        }
        if (trainChoice.into && route.exit && on.has(route.exit.end)) {
          facing(route.exit.end, route.exit.track, "away");
          path = [...path, ...session.neighbourPath(route.exit.end, route.exit.track)];
          across.push({ end: route.exit.end, track: route.exit.track });
        }
        const masts = [...new Set(route.masts)];
        trainChoice.steps = T().runTrain(session, { path, length: trainChoice.length, masts, ...(across.length ? { neighbours: across } : {}) });
        trainChoice.masts = masts;
        draw();
        drawInputs();
        drawTrain();
        drawNeighbours(session.view());
      }, "primary"));
      if (trainChoice.steps) parts.train.append(trainTable(trainChoice.steps, trainChoice.masts || []));
    }

    function drawTrain() {
      parts.train.replaceChildren();
      if (mss) return void drawMssTrain();
      const options = trainOptions();
      if (!options.length) return void parts.train.append(ui.paragraph(TEXT.trainNeedStarter));
      parts.train.append(ui.paragraph(TEXT.trainIntro, "hint"));
      if (!options[trainChoice.shape]) trainChoice.shape = 0;
      const chosen = options[trainChoice.shape];
      const names = chosen.row.items.filter((item) => item.type === "block").map((item) => item.name);
      if (!names.includes(trainChoice.start)) trainChoice.start = trainChoice.way === "back" ? names[names.length - 1] : names[0];
      const fields = el("div", "fields try-train-fields");
      if (options.length > 1) {
        fields.append(ctx.field(TEXT.trainAlong, String(trainChoice.shape), (value) => {
          trainChoice = { ...trainChoice, shape: Number(value), start: "", steps: null };
          drawTrain();
        }, { select: options.map((o, i) => ({ value: String(i), label: o.label })) }));
      }
      fields.append(ctx.field(TEXT.trainWay, trainChoice.way, (value) => {
        trainChoice = { ...trainChoice, way: value, start: "", steps: null };
        drawTrain();
      }, { select: Object.entries(TEXT.trainWays).map(([value, label]) => ({ value, label })) }));
      const ordered = trainChoice.way === "back" ? [...names].reverse() : names;
      fields.append(ctx.field(TEXT.trainFrom, trainChoice.start, (value) => {
        trainChoice.start = value;
      }, { select: ordered.map((name) => ({ value: name, label: name })) }));
      fields.append(ctx.field(TEXT.trainLength, String(trainChoice.length), (value) => {
        trainChoice.length = Math.max(1, Math.min(names.length, Math.floor(Number(value)) || 1));
      }, { type: "number" }));
      const joints = session.neighbours().flatMap((n) => (n.on ? n.tracks.map((t) => ({ value: `${n.end}${SEP}${t.track}`, label: TEXT.trainCross(n.end, t.track) })) : []));
      if (!joints.some((j) => j.value === trainChoice.cross)) trainChoice.cross = "";
      if (joints.length) {
        fields.append(ctx.field(TEXT.trainAcross, trainChoice.cross, (value) => {
          trainChoice.cross = value;
        }, { select: [{ value: "", label: TEXT.trainStay }, ...joints] }));
      }
      parts.train.append(fields);
      parts.train.append(button(TEXT.trainGo, () => {
        let path = T().trainPath(chosen.row, trainChoice.start, trainChoice.way);
        let across;
        if (trainChoice.cross) {
          const [end, track] = trainChoice.cross.split(SEP);
          across = { end, track: Number(track) };
          path = T().crossPath(session, path, across);
        }
        trainChoice.steps = T().runTrain(session, { path, length: trainChoice.length, masts: chosen.shape.masts, ...(across ? { neighbours: [across] } : {}) });
        trainChoice.group = chosen.shape.group;
        draw();
        drawInputs();
        drawTrain();
      }, "primary"));
      if (trainChoice.steps) parts.train.append(trainTable(trainChoice.steps, chosen.shape.masts));
    }

    function trainTable(steps, masts) {
      const wrap = el("div", "logic-view-scroll try-train-scroll");
      const table = el("table", "logic-view-table try-train-table");
      const head = el("tr");
      head.append(el("th", "", TEXT.trainStep), el("th", "", TEXT.trainBlocks));
      for (const name of masts) head.append(el("th", "", name));
      const across = steps[0]?.neighbours || [];
      for (const n of across) head.append(el("th", "", TEXT.trainNeighbourHeading(n.end, n.track)));
      const thead = el("thead");
      thead.append(head);
      table.append(thead);
      const body = el("tbody");
      for (const step of steps) {
        const tr = el("tr");
        tr.append(el("th", "", step.label));
        const occupied = step.blocks.filter((b) => b.occupied).map((b) => b.name);
        tr.append(el("td", "", occupied.length ? occupied.join(", ") : TEXT.trainNoBlocks));
        for (const name of masts) {
          const shown = step.masts.find((m) => m.name === name);
          const cell = el("td", "try-train-cell");
          cell.append(mastView(ctx, name, shown?.aspect ?? null, shown?.meaning));
          tr.append(cell);
        }
        for (const n of step.neighbours || []) {
          const signals = n.signals.map((x) => `${x.at}: ${x.meaning}`).join(", ");
          tr.append(el("td", "", signals));
        }
        body.append(tr);
      }
      table.append(body);
      wrap.append(table);
      return wrap;
    }

    drawTrain();
    draw();
  }

  const api = global.EsphomeMrLogicUi;
  if (api) api.registerPart({ id: "logic-try", order: 88, modes: ["field", "mss"], text: { page: TEXT, core: global.EsphomeMrLogicTry?.TEXT || {} }, render: renderTry });

  global.EsphomeMrLogicUiTry = { TEXT, showMe, stop: stopRunning };
  global.addEventListener?.("pagehide", stopRunning);
})(typeof globalThis !== "undefined" ? globalThis : window);
