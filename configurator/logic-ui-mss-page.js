// The MSS Logic page's frame (docs/mss-patterns-spec.md, The page; work item
// MP 2): one line for the mode and settings, then the steps Pick your module,
// Wire it, Signals, Try it, Download and Pair, the module's picture, and the
// panel for the step shown. An empty page offers Pick your module only; the
// rest open once the module is a row of nodes with no problems.
//
// Pick your module offers the presets (mss-row.js), each with its picture,
// and asks first, listing what it adds. A module described by hand (before
// MP 2) is still built, and offers Start from a pattern. Wire it and Signals
// list their parts and light them on the picture (MP 4 and MP 5 give them
// their pins); Try it is the Try it part (logic-ui-try.js) under the panel.
//
// The steps are worked out by pure functions (stepsOf, currentStep,
// guidance), checked by test/mss-page-frame.test.js.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const PART = "logic-mss";
  const R = () => global.EsphomeMrMssRow;
  const B = () => global.EsphomeMrMssBuilder;
  const P = () => global.EsphomeMrLogicUiMssRow;

  const TEXT = Object.freeze({
    line: Object.freeze({
      mode: "Logic:",
      mss: "MSS Logic",
      share: "Shared with the boards beside it: always",
      open: "Settings",
      close: "Hide the settings",
    }),
    stepsLabel: "Steps",
    steps: Object.freeze({
      pick: "Pick your module",
      wire: "Wire it",
      signals: "Signals",
      try: "Try it",
      download: "Download",
      pair: "Pair",
    }),
    done: "done",
    closed: "not yet: pick your module first",
    problems: (errors, warnings) => [
      errors ? `${errors} problem${errors === 1 ? "" : "s"}` : "",
      warnings ? `${warnings} warning${warnings === 1 ? "" : "s"}` : "",
    ].filter(Boolean).join(", "),
    doing: Object.freeze({
      pickEmpty: "Pick the MSS module this board runs. Each is the standard MSS node, as Iowa Scaled Engineering's boards build it.",
      pick: "This is your module. Start again to pick another.",
      wire: "Each sensor and turnout, lit on the picture. Give each its pin on the Sensors and Turnouts pages.",
      signals: "Each signal, lit on the picture. Its lamps and pins are on the Signal Masts page; what it shows is the MSS pattern's.",
      try: "Put trains in blocks, throw the points and watch the signals.",
      download: "Download the board's file, the JMRI file and the module card from the Download page.",
      pair: "At a meet, pair each end of this module with the module beside it.",
    }),
    next: Object.freeze({
      pick: "Next: wire it",
      wire: "Next: signals",
      signals: "Next: try it",
      try: "Next: download",
      download: "Next: pair",
      pair: "Go to Download",
    }),
    nextNote: Object.freeze({
      pick: "Happy with the module? Then wire it.",
      wire: "Every sensor and turnout on its page? Then the signals.",
      signals: "Every signal on its page? Then try it.",
      try: "Happy with how it runs? Then download it.",
      download: "Flashed the board? Then pair it at the meet.",
      pair: "The Download page has the board's file and the module card.",
    }),
    stillToDo: "Pick your module first.",
    // Pick your module.
    presetsHeading: "Standard MSS modules",
    confirm: (title) => `Start this module as a ${title}?`,
    adds: "This adds:",
    sensors: (names) => `Sensors: ${names}.`,
    turnouts: (names) => `Turnouts: ${names}.`,
    masts: (names, pins) => `Signals: ${names}, each head a red, a yellow and a green LED on its own pin (${pins} pins in all).`,
    mastsStrip: (names, pins) => `Signals: ${names}, each head one WS2812B LED, each signal on its own data pin (${pins} pins in all).`,
    kept: (names) => `Already on this board, and used as they are: ${names}.`,
    useStrip: "Use one WS2812B LED for each head instead (one data pin for each signal)",
    shortOfPins: (need, safe) => `This board has ${safe} free pin${safe === 1 ? "" : "s"} that ${safe === 1 ? "is" : "are"} safe for an LED once the sensors are on theirs, and these signals need ${need}. Use WS2812B LEDs, or remove what this board does not need first.`,
    apply: "Add it",
    cancel: "Cancel",
    started: (title) => `Started a ${title}. Wire it next.`,
    yourModule: "Your module",
    nodeWords: (n, title, turned) => `${n}. ${title}${turned ? ", turned round" : ""}`,
    startAgain: "Start again",
    startAgainAsk: "Start again from the standard modules? The module goes; its sensors, turnouts and signals stay on their pages.",
    yes: "Yes, start again",
    // A module described by hand.
    handWritten: "This module was described by hand, which MSS Logic no longer does. It still runs as described. Start from a pattern to make it one of the standard MSS modules.",
    fromPattern: "Start from a pattern",
    fromPatternAsk: "Start from a pattern? The hand-written module goes; its sensors, turnouts and signals stay on their pages.",
    // Wire it and Signals.
    onPage: "on its page",
    missing: "not on its page yet",
    roles: Object.freeze({ block: "block detector", ir: "IR sensor", points: "points", signal: "signal" }),
    partLine: (name, role, status) => `${name} (${role}): ${status}`,
    // Pair.
    pairSteps: Object.freeze([
      "Press Pair on this module's end and on the end of the module beside it, within 30 seconds of each other. The board's web page has a Pair button for each end too.",
      "The end's LED goes steady when the two are paired and hearing each other.",
      "An end that is not paired, or cannot hear its neighbour, shows Stop on the signals facing out of it.",
    ]),
    // What MSS Logic made.
    viewsOpen: "Show what MSS Logic made",
    viewsClose: "Hide what MSS Logic made",
  });

  const ORDER = Object.freeze(["pick", "wire", "signals", "try", "download", "pair"]);

  // What the person is looking at: kept while the page is drawn again.
  const state = { board: null, step: null, settings: false, views: false, pending: "", style: null, ask: "" };

  const rowOf = (config) => (Array.isArray(config?.logic?.mss?.row) ? config.logic.mss.row : null);

  /** A module described by hand: ends, tracks or junctions, and no row. */
  function handWritten(config) {
    const mss = config?.logic?.mss;
    return isObject(mss) && !Array.isArray(mss.row) && ["ends", "tracks", "junctions"].some((key) => list(mss[key]).length > 0);
  }

  /** Each part of the row and whether it is on its page: [{ ...part, there }]. */
  function partsOf(config) {
    const row = rowOf(config);
    if (!row || !R()) return [];
    const have = {
      sensor: new Set(list(config?.blocks).map((b) => b?.name)),
      turnout: new Set(list(config?.points).map((p) => p?.name)),
      mast: new Set(list(config?.signals?.masts).map((m) => m?.name)),
    };
    return R().parts(row).map((part) => ({ ...part, there: have[part.kind].has(part.name) }));
  }

  // Which step a builder problem belongs to: the row's own, a signal's, or wiring.
  const stepOfProblem = (p) => (p.where?.row ? "pick" : p.where?.mast !== undefined ? "signals" : "wire");

  /**
   * The steps: [{ id, label, open, done, errors, warnings }]. Pick your module
   * is always open; the rest open once the row has no problems of its own.
   */
  function stepsOf(config) {
    const row = rowOf(config);
    const rowOk = !!row && !!R() && R().problems(row).length === 0;
    const problems = (row || handWritten(config)) && B() ? list(B().problems(config)) : [];
    const count = (step, level) => problems.filter((p) => stepOfProblem(p) === step && p.level === level).length;
    const parts = partsOf(config);
    const wired = parts.filter((p) => p.kind !== "mast").every((p) => p.there);
    const signalled = parts.filter((p) => p.kind === "mast").every((p) => p.there);
    const has = { pick: rowOk, wire: rowOk && wired, signals: rowOk && signalled, try: rowOk && wired && signalled, download: false, pair: false };
    return ORDER.map((id) => {
      const open = id === "pick" || rowOk;
      const errors = ["pick", "wire", "signals"].includes(id) ? count(id, "error") : 0;
      const warnings = ["pick", "wire", "signals"].includes(id) ? count(id, "warning") : 0;
      return { id, label: TEXT.steps[id], open, done: open && has[id] && !errors, errors, warnings };
    });
  }

  /** The step to show: the one picked, while it is open; else the first not done. */
  function currentStep(config) {
    const steps = stepsOf(config);
    const picked = steps.find((s) => s.id === state.step && s.open);
    if (picked && state.board === config) return picked.id;
    const first = steps.find((s) => s.open && !s.done);
    return (first || steps.filter((s) => s.open).pop()).id;
  }

  /** What the step asks for, and the button to the next one. */
  function guidance(config, step) {
    const steps = stepsOf(config);
    const at = ORDER.indexOf(step);
    const next = steps[at + 1];
    const empty = !rowOf(config);
    return {
      doing: step === "pick" && empty ? TEXT.doing.pickEmpty : TEXT.doing[step],
      note: TEXT.nextNote[step],
      next: TEXT.next[step],
      nextStep: next ? next.id : null,
      ready: step === "pair" || !!next?.open,
      waiting: next && !next.open ? TEXT.stillToDo : "",
    };
  }

  /** The names a step is about, to light on the picture. */
  function litFor(config, step) {
    const parts = partsOf(config);
    if (step === "wire") return new Set(parts.filter((p) => p.kind !== "mast").map((p) => p.name));
    if (step === "signals") return new Set(parts.filter((p) => p.kind === "mast").map((p) => p.name));
    return new Set();
  }

  /** The views of what MSS Logic made are shown only when unfolded. */
  const viewsOpen = (config) => state.board === config && state.views;
  /** The mode and Settings cards fold behind the line, as in Field Logic. */
  const settingsOpen = (config) => state.board === config && state.settings;

  // ===== The page ===========================================================

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

  function go(ctx, step) {
    state.step = step;
    ctx.render();
    document.querySelector(`#logic-step-${step}`)?.focus({ preventScroll: true });
  }

  function nextButton(config, ctx, step) {
    const g = guidance(config, step);
    const box = el("div", "plan-next");
    box.append(el("span", "hint", g.ready ? g.note : g.waiting || g.note));
    const b = button(g.next, () => (step === "pair" ? ctx.showView("yaml") : go(ctx, g.nextStep)), "primary");
    b.id = "logic-mss-next";
    b.disabled = !g.ready;
    box.append(b);
    return box;
  }

  // Ask first, in the panel: a sentence, then Cancel and the button that does it.
  function asking(ctx, text, yes, onYes) {
    const box = el("div", "mss-confirm");
    box.append(el("p", "", text));
    const actions = el("div", "dialog-actions");
    actions.append(button(TEXT.cancel, () => { state.ask = ""; ctx.render(); }),
      button(yes, () => { state.ask = ""; onYes(); }, "primary"));
    box.append(actions);
    return box;
  }

  // The style a preset starts with: LEDs while they fit, else WS2812B.
  function styleFor(config, ctx, row) {
    if (state.style) return state.style;
    const leds = R().needs(config, row, { style: "leds" });
    const safe = Math.max(0, (ctx.safeOutputPins?.() ?? Infinity) - leds.sensors.length);
    return leds.pins > safe ? "strip" : "leds";
  }

  function renderPresets(panel, config, ctx) {
    panel.append(el("h4", "", TEXT.presetsHeading));
    const cards = el("div", "mss-presets");
    for (const id of R().PRESET_IDS) {
      const words = R().TEXT.presets[id];
      const card = button("", () => {
        state.pending = state.pending === id ? "" : id;
        state.style = null;
        ctx.render();
      }, `mss-preset${state.pending === id ? " is-open" : ""}`);
      card.id = `logic-mss-preset-${id}`;
      card.setAttribute("aria-expanded", String(state.pending === id));
      card.append(el("strong", "", words.title));
      const picture = P().draw(R().preset(id));
      if (picture) card.append(picture);
      card.append(el("span", "hint", words.about));
      cards.append(card);
    }
    panel.append(cards);
    if (state.pending) panel.append(presetConfirm(config, ctx, state.pending));
  }

  function presetConfirm(config, ctx, id) {
    const row = R().preset(id);
    const title = R().TEXT.presets[id].title;
    const style = styleFor(config, ctx, row);
    const want = R().needs(config, row, { style });
    const box = el("div", "mss-confirm");
    box.append(el("strong", "", TEXT.confirm(title)), el("p", "hint", TEXT.adds));
    const items = el("ul");
    if (want.sensors.length) items.append(el("li", "", TEXT.sensors(want.sensors.join(", "))));
    if (want.turnouts.length) items.append(el("li", "", TEXT.turnouts(want.turnouts.join(", "))));
    if (want.masts.length) items.append(el("li", "", (style === "strip" ? TEXT.mastsStrip : TEXT.masts)(want.masts.map((m) => m.name).join(", "), want.pins)));
    if (want.kept.length) items.append(el("li", "", TEXT.kept(want.kept.join(", "))));
    box.append(items);
    if (want.masts.length) {
      const strip = ctx.field(TEXT.useStrip, style === "strip", (checked) => {
        state.style = checked ? "strip" : "leds";
        ctx.render();
      }, { checkbox: true });
      strip.querySelector("input")?.setAttribute("id", "logic-mss-strip");
      box.append(strip);
      const safe = Math.max(0, (ctx.safeOutputPins?.() ?? Infinity) - want.sensors.length);
      if (want.pins > safe) box.append(el("p", "mss-warning", TEXT.shortOfPins(want.pins, safe)));
    }
    const actions = el("div", "dialog-actions");
    const yes = button(TEXT.apply, () => {
      R().use(config, row, ctx.addItems, { style });
      Object.assign(state, { pending: "", style: null, step: "wire" });
      ctx.persist();
      ctx.render();
      ctx.flash?.("ok", TEXT.started(title));
    }, "primary");
    yes.id = "logic-mss-add";
    actions.append(button(TEXT.cancel, () => { state.pending = ""; ctx.render(); }), yes);
    box.append(actions);
    return box;
  }

  function renderPick(panel, config, ctx) {
    if (handWritten(config)) {
      panel.append(el("p", "mss-warning", TEXT.handWritten));
      if (state.ask === "pattern") {
        panel.append(asking(ctx, TEXT.fromPatternAsk, TEXT.fromPattern, () => {
          const mss = config.logic.mss;
          for (const key of ["ends", "tracks", "junctions", "masts"]) delete mss[key];
          ctx.persist();
          ctx.render();
        }));
      } else {
        const b = button(TEXT.fromPattern, () => { state.ask = "pattern"; ctx.render(); }, "primary");
        b.id = "logic-mss-from-pattern";
        panel.append(b);
      }
      return;
    }
    const row = rowOf(config);
    if (!row) return renderPresets(panel, config, ctx);
    panel.append(el("h4", "", TEXT.yourModule));
    const ol = el("ol", "mss-row-list");
    row.forEach((node, i) => ol.append(el("li", "", TEXT.nodeWords(i + 1, R().TEXT.nodes[node?.node]?.title || String(node?.node ?? ""), node?.turned === true))));
    panel.append(ol);
    for (const p of R().problems(row)) panel.append(el("p", "mss-warning", p.text));
    if (state.ask === "again") {
      panel.append(asking(ctx, TEXT.startAgainAsk, TEXT.yes, () => {
        delete config.logic.mss.row;
        state.step = "pick";
        ctx.persist();
        ctx.render();
      }));
    } else {
      const b = button(TEXT.startAgain, () => { state.ask = "again"; ctx.render(); });
      b.id = "logic-mss-start-again";
      panel.append(b);
    }
  }

  function renderParts(panel, config, kinds) {
    const ul = el("ul", "mss-parts");
    for (const p of partsOf(config).filter((x) => kinds.includes(x.kind))) {
      ul.append(el("li", p.there ? "is-there" : "is-missing", TEXT.partLine(p.name, TEXT.roles[p.role] || p.role, p.there ? TEXT.onPage : TEXT.missing)));
    }
    panel.append(ul);
  }

  function renderPage(root, config, ctx) {
    if (state.board !== config) Object.assign(state, { board: config, step: null, settings: false, views: false, pending: "", style: null, ask: "" });
    const line = el("div", "logic-field-line");
    line.id = PART;
    const mode = el("span");
    mode.append(el("strong", "", TEXT.line.mode), ` ${TEXT.line.mss}`);
    const toggle = button(state.settings ? TEXT.line.close : TEXT.line.open, () => {
      state.settings = !state.settings;
      ctx.render();
      document.querySelector("#logic-mss-settings")?.focus({ preventScroll: true });
    }, "link-button");
    toggle.id = "logic-mss-settings";
    toggle.setAttribute("aria-expanded", String(state.settings));
    line.append(mode, el("span", "hint", TEXT.line.share), toggle);
    root.append(line);

    const current = currentStep(config);
    state.step = current;
    const nav = el("ol", "logic-field-steps");
    nav.setAttribute("aria-label", TEXT.stepsLabel);
    stepsOf(config).forEach((step, i) => {
      const item = el("li");
      const b = button("", () => go(ctx, step.id), `step-pill${step.id === current ? " is-current" : ""}${step.done ? " is-done" : ""}`);
      b.id = `logic-step-${step.id}`;
      b.disabled = !step.open;
      if (step.id === current) b.setAttribute("aria-current", "step");
      b.append(el("span", "step-number", step.done ? "✓" : String(i + 1)), ` ${step.label}`);
      const counts = TEXT.problems(step.errors, step.warnings);
      if (counts) b.append(el("span", `step-count${step.errors ? " is-error" : " is-warning"}`, counts));
      b.title = !step.open ? TEXT.closed : step.done ? TEXT.done : "";
      item.append(b);
      nav.append(item);
    });
    root.append(nav);

    // The module's picture, then the step's panel.
    const card = el("section", "card mss-page");
    card.id = B()?.PARTS.row || "logic-mss-row";
    const row = rowOf(config);
    if (row) {
      const picture = P().draw(row, { lit: litFor(config, current) });
      if (picture) {
        picture.id = "logic-mss-picture";
        const wrap = el("div", "mss-row-wrap");
        wrap.append(picture);
        card.append(wrap);
      }
    }
    const panel = el("div", "mss-panel");
    const g = guidance(config, current);
    panel.append(el("p", "card-copy", g.doing));
    if (current === "pick") renderPick(panel, config, ctx);
    else if (current === "wire") renderParts(panel, config, ["sensor", "turnout"]);
    else if (current === "signals") renderParts(panel, config, ["mast"]);
    else if (current === "pair") {
      const ol = el("ol", "mss-pair");
      for (const words of TEXT.pairSteps) ol.append(el("li", "", words));
      panel.append(ol);
    }
    if (current !== "pick" || row) panel.append(nextButton(config, ctx, current));
    if (row || handWritten(config)) {
      const views = button(state.views ? TEXT.viewsClose : TEXT.viewsOpen, () => {
        state.views = !state.views;
        ctx.render();
        document.querySelector("#logic-mss-views")?.focus({ preventScroll: true });
      }, "link-button");
      views.id = "logic-mss-views";
      views.setAttribute("aria-expanded", String(state.views));
      panel.append(views);
    }
    card.append(panel);
    root.append(card);
  }

  global.EsphomeMrLogicUiMss = { TEXT, PART, ORDER, stepsOf, currentStep, guidance, handWritten, partsOf, litFor, viewsOpen, settingsOpen };

  if (global.EsphomeMrLogicUi) {
    global.EsphomeMrLogicUi.registerPart({ id: PART, order: 5, modes: ["mss"], text: TEXT, render: renderPage });
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
