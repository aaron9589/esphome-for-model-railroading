// The Field Logic page's frame (docs/field-logic-plan-spec.md, The page;
// work item TP 6): one line for the mode, Share and linked boards, then the
// steps Draw, Sensors, Signals, Behaviour and rules, Try it and Download.
// An empty page offers Draw only; each later step opens once the one before
// has something in it, and a step with problems says how many. The drawing
// and its panel are logic-ui-plan.js, which asks here which step is open.
// The steps are worked out by a pure function (stepsOf), checked by
// test/plan-page.test.js; the render functions only draw them.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const PART = "logic-field";

  const TEXT = Object.freeze({
    line: Object.freeze({
      mode: "Logic:",
      field: "Field Logic",
      shareOn: "Share with other boards: on",
      shareOff: "Share with other boards: off",
      linked: (n) => (n ? `Linked boards: ${n}` : "Linked boards: none"),
      open: "Settings and linked boards",
      close: "Hide the settings",
    }),
    stepsLabel: "Steps",
    steps: Object.freeze({
      draw: "Draw",
      sensors: "Sensors",
      signals: "Signals",
      behaviour: "Behaviour and rules",
      try: "Try it",
      download: "Download",
    }),
    stepName: (n, name) => `${n} ${name}`,
    done: "done",
    closed: "not yet: finish the step before it",
    problems: (errors, warnings) => [
      errors ? `${errors} problem${errors === 1 ? "" : "s"}` : "",
      warnings ? `${warnings} warning${warnings === 1 ? "" : "s"}` : "",
    ].filter(Boolean).join(", "),
    // What each step asks for, and what comes after it.
    doing: Object.freeze({
      drawEmpty: "Draw your track. Start at one end and drag to the other.",
      draw: "Draw more track, or click each ? where three lines meet to say whether there is a turnout.",
      sensors: "Click a piece of track to name its block and give it sensors. Click a point on plain track to put a block break there.",
      signals: "Click a block break to stand a signal there, facing its trains. Click an end of the track to say what is beyond it.",
      behaviour: "The drawing already keeps trains apart: click a block to see which signals protect it, or a signal to see who asks for its routes.",
      try: "Put trains in blocks, throw turnouts and watch the signals.",
      download: "Everything is on the drawing. Download the board's file from the Download page.",
    }),
    next: Object.freeze({
      draw: "Next: blocks and sensors",
      sensors: "Next: signals",
      signals: "Next: behaviour and rules",
      behaviour: "Next: try it",
      try: "Next: download",
      download: "Go to Download",
    }),
    nextNote: Object.freeze({
      draw: "Track drawn and every ? settled? Then cut it into blocks.",
      sensors: "Each block that trains stop in has a sensor? Then place the signals.",
      signals: "Signals placed. The board now works out what each one shows from the track.",
      behaviour: "Read what the drawing does, then try it.",
      try: "Happy with how it runs? Then download it.",
      download: "The Download page has the board's file, the JMRI file, and the checks.",
    }),
    stillToDo: Object.freeze({
      draw: "Settle each ? first: the drawing can't tell what is there.",
      sensors: "Name at least one block first: the signals stand between blocks.",
      signals: "Place at least one signal first.",
    }),
  });

  const ORDER = Object.freeze(["draw", "sensors", "signals", "behaviour", "try", "download"]);
  const P = () => global.EsphomeMrPlanBuilder;

  // What the person is looking at: kept while the page is drawn again.
  const state = { board: null, step: null, settings: false };

  /**
   * The steps, from the drawing: [{ id, label, open, done, errors, warnings }].
   * A step opens once the one before has something in it: Sensors once there
   * is track, Signals once a block has a name, and the rest once a signal
   * stands on the drawing.
   */
  function stepsOf(config) {
    const plan = config?.logic?.plan;
    const track = list(plan?.track).length > 0;
    const blocks = list(plan?.blocks).filter(isObject).length > 0;
    const signals = list(plan?.breaks).some((brk) => isObject(brk) && list(brk.signals).some((s) => isObject(s) && s.mast));
    const problems = track && P() ? list(P().look(config).problems) : [];
    const count = (step, level) => problems.filter((p) => p.step === step && p.level === level).length;
    const opens = { draw: true, sensors: track, signals: blocks, behaviour: signals, try: signals, download: signals };
    const has = { draw: track, sensors: blocks, signals, behaviour: signals, try: signals, download: false };
    return ORDER.map((id, i) => {
      const open = opens[id] && (i === 0 || opens[ORDER[i - 1]]);
      const errors = id === "try" || id === "download" ? 0 : count(id, "error");
      const warnings = id === "try" || id === "download" ? 0 : count(id, "warning");
      return { id, label: TEXT.steps[id], open, done: open && has[id] && !errors, errors, warnings };
    });
  }

  /** The step to show: the one picked, while it is open; else the first not done. */
  function currentStep(config) {
    const steps = stepsOf(config);
    const picked = steps.find((s) => s.id === state.step && s.open);
    if (picked) return picked.id;
    const first = steps.find((s) => s.open && !s.done);
    return (first || steps.filter((s) => s.open).pop()).id;
  }

  /** What the step asks for: a sentence, then the button to the next one (with why it is not open yet). */
  function guidance(config, step) {
    const steps = stepsOf(config);
    const at = ORDER.indexOf(step);
    const next = steps[at + 1];
    const empty = !list(config?.logic?.plan?.track).length;
    return {
      doing: step === "draw" && empty ? TEXT.doing.drawEmpty : TEXT.doing[step],
      note: TEXT.nextNote[step],
      next: TEXT.next[step],
      nextStep: next ? next.id : null,
      ready: step === "download" || !!next?.open,
      waiting: next && !next.open ? TEXT.stillToDo[step] || "" : "",
    };
  }

  // ===== The page ===========================================================

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function go(ctx, step) {
    state.step = step;
    ctx.render();
    document.querySelector(`#logic-step-${step}`)?.focus({ preventScroll: true });
  }

  /** The button at the end of the panel: on to the next step, or to Download. */
  function nextButton(config, ctx, step) {
    const g = guidance(config, step);
    const box = el("div", "plan-next");
    box.append(el("span", "hint", g.ready ? g.note : g.waiting || g.note));
    const b = el("button", "primary", g.next);
    b.type = "button";
    b.id = "logic-plan-next";
    b.disabled = !g.ready;
    b.addEventListener("click", () => (step === "download" ? ctx.showView("yaml") : go(ctx, g.nextStep)));
    box.append(b);
    return box;
  }

  function renderField(root, config, ctx) {
    if (state.board !== config) Object.assign(state, { board: config, step: null, settings: false });
    const L = global.EsphomeMrLogicYaml;
    const line = el("div", "logic-field-line");
    line.id = PART;
    const mode = el("span");
    mode.append(el("strong", "", TEXT.line.mode), ` ${TEXT.line.field}`);
    line.append(mode,
      el("span", "hint", global.EsphomeMr.sharesWithOtherBoards(config) ? TEXT.line.shareOn : TEXT.line.shareOff),
      el("span", "hint", TEXT.line.linked(list(L?.linkedBoards(config)).length)));
    const toggle = el("button", "link-button", state.settings ? TEXT.line.close : TEXT.line.open);
    toggle.type = "button";
    toggle.id = "logic-field-settings";
    toggle.setAttribute("aria-expanded", String(state.settings));
    toggle.addEventListener("click", () => {
      state.settings = !state.settings;
      ctx.render();
      document.querySelector("#logic-field-settings")?.focus({ preventScroll: true });
    });
    line.append(toggle);
    root.append(line);

    // The step shown stays the step shown until the person moves on, or it
    // closes (its track erased): finishing a step never jumps ahead.
    const current = currentStep(config);
    state.step = current;
    const nav = el("ol", "logic-field-steps");
    nav.setAttribute("aria-label", TEXT.stepsLabel);
    stepsOf(config).forEach((step, i) => {
      const item = el("li");
      const b = el("button", `step-pill${step.id === current ? " is-current" : ""}${step.done ? " is-done" : ""}`);
      b.type = "button";
      b.id = `logic-step-${step.id}`;
      b.disabled = !step.open;
      if (step.id === current) b.setAttribute("aria-current", "step");
      b.append(el("span", "step-number", step.done ? "✓" : String(i + 1)), ` ${step.label}`);
      const counts = TEXT.problems(step.errors, step.warnings);
      if (counts) b.append(el("span", `step-count${step.errors ? " is-error" : " is-warning"}`, counts));
      b.title = !step.open ? TEXT.closed : step.done ? TEXT.done : "";
      b.addEventListener("click", () => go(ctx, step.id));
      item.append(b);
      nav.append(item);
    });
    root.append(nav);
  }

  /** Whether the mode, Share and Linked boards cards are open (folded in Field Logic). */
  function settingsOpen(config) {
    return state.board === config && state.settings;
  }

  global.EsphomeMrLogicUiField = { TEXT, PART, ORDER, stepsOf, currentStep, guidance, nextButton, settingsOpen };

  if (global.EsphomeMrLogicUi) {
    global.EsphomeMrLogicUi.registerPart({ id: PART, order: 5, modes: ["field"], text: TEXT, render: renderField });
    // After Try it: the way on to Download.
    global.EsphomeMrLogicUi.registerPart({
      id: "logic-field-next", order: 89, modes: ["field"], text: {},
      show: (config) => currentStep(config) === "try",
      render: (root, config, ctx) => root.append(nextButton(config, ctx, "try")),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
