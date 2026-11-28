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
    closed: "not yet: pick your module, and make it, first",
    problems: (errors, warnings) => [
      errors ? `${errors} problem${errors === 1 ? "" : "s"}` : "",
      warnings ? `${warnings} warning${warnings === 1 ? "" : "s"}` : "",
    ].filter(Boolean).join(", "),
    doing: Object.freeze({
      pickEmpty: "Build your module from the three node types of MSS, the open Modular Signal System standard: start with one, then stitch more onto it. Or start from a sample.",
      pick: "This is your module: its MSS boards, stitched left to right. Drag boards in, move them, flip a Complex cascade or take one out. When it is right, make the module, then wire it.",
      wire: "Wire each part in turn: it is lit on the picture, with how to wire it and its pin. Click a part on the picture to go to it.",
      signals: "Each signal in turn, lit on the picture: its lamps and their pins. What it shows is the MSS pattern's: point at one to see it.",
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
    stillToDo: "Pick your module, and make it, first.",
    make: "Make the module",
    makeNote: "Happy with the boards? Make the module: its sensors, turnouts and signals are added with free pins, and then you wire it.",
    // Pick your module.
    boardsHeading: "MSS boards",
    paletteHint: "Drag a board into your module, into any gap that lights up green. Or click one to add it on the right. A Complex cascade turns the way it fits.",
    samplesHeading: "Samples",
    dropHere: "Drag an MSS board or a sample here",
    dropToRemove: "Drop a board here to take it out of the module",
    doesNotFit: (title) => `A ${title} does not fit on the right of the module: drag it into a gap that lights up green.`,
    sampleAsk: (title) => `Replace your module with the ${title} sample?`,
    sampleYes: "Yes, replace it",
    onNext: "Make the module adds these to the board:",
    adds: "This adds:",
    sensors: (names) => `Sensors: ${names}.`,
    turnouts: (names) => `Turnouts: ${names}.`,
    masts: (names, pins) => `Signals: ${names}, each head a red, a yellow and a green LED on its own pin (${pins} pins in all).`,
    mastsStrip: (names, pins) => `Signals: ${names}, each head one WS2812B LED, each signal on its own data pin (${pins} pins in all).`,
    kept: (names) => `Already on this board, and used as they are: ${names}.`,
    useStrip: "Use one WS2812B LED for each head instead (one data pin for each signal)",
    shortOfPins: (need, safe) => `This board has ${safe} free pin${safe === 1 ? "" : "s"} that ${safe === 1 ? "is" : "are"} safe for an LED once the sensors are on theirs, and these signals need ${need}. Use WS2812B LEDs, or remove what this board does not need first.`,
    cancel: "Cancel",
    yourModule: "Your module",
    nodeWords: (n, title, turned) => `${n}. ${title}${turned ? ", flipped" : ""}`,
    startAgain: "Start again",
    startAgainAsk: "Start again from the MSS boards? The module goes; its sensors, turnouts and signals stay on their pages.",
    yes: "Yes, start again",
    // Changing the row.
    turn: "Flip",
    remove: "Remove",
    cannotRemove: "Removing it would leave boards whose tracks do not meet: remove the boards beside it first.",
    cannotTurn: "Flipped, its tracks would not meet the boards beside it.",
    left: (names) => `These stay on their pages, no longer used by the module: ${names}. Remove them there if this board no longer has them.`,
    // A module described by hand.
    handWritten: "This module was described by hand, which MSS Logic no longer does. It still runs as described. Start from a pattern to make it one of the standard MSS modules.",
    fromPattern: "Start from a pattern",
    fromPatternAsk: "Start from a pattern? The hand-written module goes; its sensors, turnouts and signals stay on their pages.",
    // Wire it and Signals.
    onPage: "on its page",
    missing: "not on its page yet",
    roles: Object.freeze({ block: "block detector", ir: "IR sensor", points: "points", signal: "signal" }),
    partLine: (name, role, status) => `${name} (${role}): ${status}`,
    // Wire it: each part in turn.
    wireOf: (n, total) => `${n} of ${total}`,
    endPart: Object.freeze({ pair: (end) => `End ${end} Pair button`, led: (end) => `End ${end} LED` }),
    wireRoles: Object.freeze({ block: "block detector", ir: "IR sensor", points: "points", pair: "Pair button", led: "end LED" }),
    howTo: Object.freeze({
      block: "A current detector: its output to this pin, its GND to the board's GND. It sees a train in the block by the current it draws.",
      ir: "An IR (optical) sensor at the block boundary: its output to this pin, its GND to GND. It sees any car standing there, powered or not.",
      pointsPca: "The points' servo, plugged into this channel of the PCA9685 board.",
      pointsEsp: "The points' servo: its signal wire to this pin. Power the servo from 5V, not from the ESP32.",
      pair: (end) => `A push button between this pin and GND, beside end ${end}. Optional: the board's web page has a Pair button too.`,
      led: (end) => `An LED and a resistor (about 330 Ω) from this pin to GND, beside end ${end}. Optional: it shows whether the end is paired.`,
    }),
    pin: "Pin",
    channel: "Channel",
    pcaBoard: "PCA9685 board",
    pcaBoardN: (n) => `Board ${n}`,
    noPin: "No pin",
    pickPin: "Pick a pin…",
    onExpander: (expander, pin) => `On expander ${expander}, pin ${pin}. Change it on the Sensors page.`,
    pinMissing: "No pin yet.",
    pinShared: (pin) => `${pin} is used by something else too. A pin can do one job.`,
    notOnPage: "Not on its page: start the module again, or add it there.",
    previous: "Previous",
    nextPart: "Next part",
    // Signals: each signal in turn.
    ticks: Object.freeze({
      advance: "Advance Approach",
      advanceHint: "The signal two before a Stop shows Advance Approach (flashing yellow) instead of Clear. Off in MSS unless every module at the meet uses it.",
      approachDiverging: "Approach Diverging",
      approachDivergingHint: "The signal before one set for the siding shows Approach Diverging (flashing yellow; yellow over yellow on two heads) instead of Approach.",
    }),
    signalOf: (n, total) => `${n} of ${total}`,
    heads: Object.freeze({ plain: "one head", diverging: "one head, for the siding", twoHeads: "two heads: upper the main line, lower the siding" }),
    style: "Its lamps",
    styles: Object.freeze({
      leds: "Individual LEDs: a red, a yellow and a green for each head, each on its own pin",
      strip: "WS2812B: one LED for each head, all on one data pin",
    }),
    restyled: "Its lamps are made again for this choice, with free pins.",
    dataPin: "Data pin",
    lampPin: (lamp) => `${lamp} pin`,
    shows: "What it shows (point at one to see it on the picture)",
    notOnPageSignal: "Not on the Signal Masts page: start the module again, or add it there.",
    nextSignal: "Next signal",
    strapping: (pins) => `${pins} ${pins.includes(",") ? "are start-up pins" : "is a start-up pin"}: an LED on one can stop the board starting. Use WS2812B LEDs, or free a pin that is not a start-up pin.`,
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
  const state = { board: null, step: null, settings: false, views: false, style: null, ask: "", wireAt: "", signalAt: "" };

  const rowOf = (config) => (Array.isArray(config?.logic?.mss?.row) ? config.logic.mss.row : null);

  /**
   * A module described by hand: tracks, junctions or ends with a track
   * count, and no row. Ends kept only for their Pair and LED pins (a row's,
   * after Start again) are not one.
   */
  function handWritten(config) {
    const mss = config?.logic?.mss;
    if (!isObject(mss) || Array.isArray(mss.row)) return false;
    return list(mss.tracks).length > 0 || list(mss.junctions).length > 0 || list(mss.ends).some((e) => isObject(e) && e.tracks !== undefined);
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
    // A module not made yet (going on makes it) is not counted as a problem on the steps.
    const count = (step, level) => problems.filter((p) => !p.where?.notMade && stepOfProblem(p) === step && p.level === level).length;
    const parts = partsOf(config);
    const wired = parts.filter((p) => p.kind !== "mast").every((p) => p.there) && wireList(config).every((w) => w.done);
    const signalled = parts.filter((p) => p.kind === "mast").every((p) => p.there) && signalList(config).every((x) => x.done);
    // Plot, then make, then configure: the steps after Pick your module open
    // once every part of the module is made (Make the module).
    const made = rowOk && parts.every((p) => p.there);
    const has = { pick: made, wire: rowOk && wired, signals: rowOk && signalled, try: rowOk && wired && signalled, download: false, pair: false };
    return ORDER.map((id) => {
      const open = id === "pick" || made;
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
    // A module plotted and not made yet: its button makes it.
    const row = rowOf(config);
    if (step === "pick" && row && R() && !R().problems(row).length && !next?.open) {
      return { doing: TEXT.doing.pick, note: TEXT.makeNote, next: TEXT.make, nextStep: "wire", ready: true, waiting: "", make: true };
    }
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

  // Every pin this board uses, and how many times, for spotting a shared one.
  function pinUses(config) {
    const uses = new Map();
    const add = (pin) => { if (typeof pin === "string" && pin) uses.set(pin.toUpperCase(), (uses.get(pin.toUpperCase()) || 0) + 1); };
    for (const b of list(config?.blocks)) if (!b?.expander) add(b?.gpio);
    if (config?.pca9685 === false) for (const p of list(config?.points)) add(p?.servoPin);
    for (const m of list(config?.signals?.masts)) {
      if (m?.mode === "gpio") for (const lamp of list(m.lamps)) add(lamp?.pin);
      else add(m?.pin);
    }
    for (const e of list(config?.logic?.mss?.ends)) { add(e?.pairPin); add(e?.ledPin); }
    return uses;
  }

  /**
   * Wire it, in order: every block, the IR sensors, the points, then each
   * end's Pair button and LED. [{ key, name, role, kind, end?, pin, place,
   * done, problem }]: `pin` is the ESP pin (or "" for none), `place` a
   * PCA9685 board and channel, an expander and its pin; `problem` one of
   * missing, shared, notThere (or "").
   */
  function wireList(config) {
    const row = rowOf(config);
    if (!row || !R() || R().problems(row).length) return [];
    const uses = pinUses(config);
    const pca = config?.pca9685 !== false;
    const out = [];
    for (const part of R().parts(row).filter((p) => p.kind !== "mast")) {
      const item = { key: part.name, name: part.name, role: part.role, kind: part.kind, pin: "", place: null, done: false, problem: "" };
      if (part.kind === "sensor") {
        const b = list(config?.blocks).find((x) => x?.name === part.name);
        if (!b) item.problem = "notThere";
        else if (b.expander) item.place = { expander: b.expander, pin: b.pin };
        else item.pin = String(b.gpio || "");
      } else {
        const p = list(config?.points).find((x) => x?.name === part.name);
        if (!p) item.problem = "notThere";
        else if (pca) item.place = { board: Number(p.pcaBoard) || 0, channel: p.channel };
        else item.pin = String(p.servoPin || "");
      }
      if (!item.problem && !item.place && !item.pin) item.problem = "missing";
      if (!item.problem && item.pin && (uses.get(item.pin.toUpperCase()) || 0) > 1) item.problem = "shared";
      item.done = !item.problem;
      out.push(item);
    }
    const ends = list(config?.logic?.mss?.ends);
    for (const end of ["A", "B"]) {
      const def = ends.find((e) => e?.name === end) || {};
      for (const which of ["pair", "led"]) {
        const pin = String(def[which === "pair" ? "pairPin" : "ledPin"] || "");
        const shared = pin && (uses.get(pin.toUpperCase()) || 0) > 1;
        // Optional: no pin is done too.
        out.push({ key: `end:${end}:${which}`, name: TEXT.endPart[which](end), role: which, kind: "end", end, pin, place: null, done: !shared, problem: shared ? "shared" : "" });
      }
    }
    return out;
  }

  const MT = () => global.EsphomeMrMssTemplates;
  const INDICATION_ORDER = ["stop", "approach", "advance", "clear", "approachDiverging", "divergingClear", "divergingApproach"];

  /**
   * What a pattern signal shows, in order, with the ticks: [{ key, label,
   * heads: [{ color, blink }] }], the upper head first.
   */
  function indicationsFor(config, heads) {
    const mss = config?.logic?.mss || {};
    const rows = list(MT()?.MSS_ROWS?.[heads]);
    return rows
      .filter(([key]) => (key === "advance" ? mss.advanceApproach === true : key === "approachDiverging" ? mss.approachDiverging === true : true))
      .sort((a, b) => INDICATION_ORDER.indexOf(a[0]) - INDICATION_ORDER.indexOf(b[0]))
      .map(([key, , colours]) => ({
        key,
        label: MT().TEXT.aspects[key],
        heads: [...colours].reverse().map((c) => ({ color: String(c).replace(/\*$/, ""), blink: String(c).endsWith("*") })),
      }));
  }

  /**
   * Signals, in order: [{ name, heads, there, style ("leds" | "strip"),
   * pins: [{ key, label, pin }], done, problem }]: `pins` the data pin, or a
   * pin for each LED; `problem` notThere, missing or shared.
   */
  function signalList(config) {
    const row = rowOf(config);
    if (!row || !R() || R().problems(row).length) return [];
    const uses = pinUses(config);
    return R().parts(row).filter((p) => p.kind === "mast").map((part) => {
      const m = list(config?.signals?.masts).find((x) => x?.name === part.name);
      const item = { name: part.name, heads: part.heads, there: !!m, style: m?.mode === "gpio" ? "leds" : "strip", pins: [], done: false, problem: "" };
      if (!m) {
        item.problem = "notThere";
        return item;
      }
      item.pins = m.mode === "gpio"
        ? list(m.lamps).map((lamp, i) => ({ key: `lamp:${i}`, label: TEXT.lampPin(lamp?.name || String(i + 1)), pin: String(lamp?.pin || "") }))
        : [{ key: "data", label: TEXT.dataPin, pin: String(m.pin || "") }];
      if (item.pins.some((p) => !p.pin)) item.problem = "missing";
      else if (item.pins.some((p) => (uses.get(p.pin.toUpperCase()) || 0) > 1)) item.problem = "shared";
      item.done = !item.problem;
      return item;
    });
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
    const b = button(g.next, () => {
      if (step === "pair") return ctx.showView("yaml");
      if (g.make) makeParts(config, ctx);
      go(ctx, g.nextStep);
    }, "primary");
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

  // A card with a small picture of its boards.
  function boardCard(row, title, about, className) {
    const card = el("div", `mss-preset ${className}`.trim());
    card.append(el("strong", "", title));
    // Named, so its signals are drawn too (the names are left off).
    const picture = P().draw(R().named(row), { bare: true });
    if (picture) card.append(picture);
    if (about) card.title = about;
    return card;
  }

  // What a row adds to the board's pages, with the LEDs or WS2812B choice
  // and a warning when its signals would not fit. `kept`: list what is there.
  function addsList(box, config, ctx, row, style, { kept = true } = {}) {
    const want = R().needs(config, row, { style });
    const items = el("ul");
    if (want.sensors.length) items.append(el("li", "", TEXT.sensors(want.sensors.join(", "))));
    if (want.turnouts.length) items.append(el("li", "", TEXT.turnouts(want.turnouts.join(", "))));
    if (want.masts.length) items.append(el("li", "", (style === "strip" ? TEXT.mastsStrip : TEXT.masts)(want.masts.map((m) => m.name).join(", "), want.pins)));
    if (kept && want.kept.length) items.append(el("li", "", TEXT.kept(want.kept.join(", "))));
    if (!items.childNodes.length) return want;
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
    return want;
  }

  // What goes into the module while it is being built: kept on the page,
  // not saved; the board's parts are made when the person goes on.
  let drag = null; // { kind: "board", id } | { kind: "move", from } | { kind: "sample", id }

  function setRow(config, ctx, row) {
    if (!isObject(config.logic.mss)) config.logic.mss = {};
    config.logic.mss.row = row;
    ctx.persist();
    ctx.render();
  }

  // Flip: the signals still named as the pattern names them are renamed, on their page too.
  function flip(config, ctx, row, i) {
    const out = R().turnNode(row, i);
    const taken = new Set(list(config?.signals?.masts).map((m) => m?.name));
    for (const [from, to] of out.renames) {
      if (taken.has(to)) {
        R().rename(out.row, to, from, "mast");
        continue;
      }
      const mast = list(config.signals?.masts).find((m) => m?.name === from);
      if (!mast) continue;
      mast.name = to;
      if (!mast.topicCustom) mast.topic = global.EsphomeMr.topicFor("signal", to);
    }
    setRow(config, ctx, out.row);
  }

  // Remove a board: its parts on the pages stay, and the page says which.
  function removeAt(config, ctx, row, i) {
    const next = R().removeNode(row, i);
    const still = new Set(R().parts(next).map((p) => p.name));
    const onPages = new Set([...list(config.blocks), ...list(config.points), ...list(config.signals?.masts)].map((x) => x?.name));
    const left = R().parts(row).map((p) => p.name).filter((name) => !still.has(name) && onPages.has(name));
    setRow(config, ctx, next);
    if (left.length) ctx.flash?.("ok", TEXT.left(left.join(", ")));
  }

  /** Going on from Pick your module: the board's parts are made, with free pins. */
  function makeParts(config, ctx) {
    const row = rowOf(config);
    if (!row || !R() || R().problems(row).length) return;
    const want = R().needs(config, row, { style: styleFor(config, ctx, row) });
    if (!want.sensors.length && !want.turnouts.length && !want.masts.length) return;
    R().use(config, row, ctx.addItems, { style: styleFor(config, ctx, row) });
    state.style = null;
    ctx.persist();
  }

  // Each gap in the module lights up while a board is dragged: green where
  // it fits, grey where it does not.
  function lightZones(root, row) {
    for (const zone of root.querySelectorAll(".mss-drop")) {
      const at = Number(zone.dataset.at);
      let ok = false;
      if (drag?.kind === "board") ok = !!R().orientFor(row, at, drag.id);
      else if (drag?.kind === "sample") ok = row.length === 0;
      else if (drag?.kind === "move") ok = at !== drag.from && at !== drag.from + 1 && R().canMove(row, drag.from, at > drag.from ? at - 1 : at);
      zone.classList.toggle("is-valid", ok);
      zone.classList.toggle("is-invalid", !ok);
    }
    root.classList.toggle("is-dragging", !!drag);
    root.classList.toggle("is-moving", drag?.kind === "move");
  }

  function dropAt(config, ctx, row, at) {
    if (drag?.kind === "board") {
      const node = R().orientFor(row, at, drag.id);
      if (node) setRow(config, ctx, R().insertNode(row, at, node));
    } else if (drag?.kind === "sample" && !row.length) setRow(config, ctx, R().preset(drag.id));
    else if (drag?.kind === "move") setRow(config, ctx, R().moveNode(row, drag.from, at > drag.from ? at - 1 : at));
    drag = null;
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
    const row = rowOf(config) || [];
    const rowOk = row.length > 0 && R().problems(row).length === 0;
    const builder = el("div", "mss-builder");
    builder.id = "logic-mss-builder";
    const start = (event, what) => {
      drag = what;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", JSON.stringify(what));
      lightZones(builder, row);
    };
    const stop = () => {
      drag = null;
      lightZones(builder, row);
      for (const z of builder.querySelectorAll(".is-over")) z.classList.remove("is-over");
    };

    // The palette: the three MSS boards, then the samples.
    const palette = el("div", "mss-palette");
    palette.append(el("p", "hint", TEXT.paletteHint));
    const boardsGroup = el("div", "mss-palette-group");
    boardsGroup.append(el("h5", "", TEXT.boardsHeading));
    const boards = el("div", "mss-presets is-boards");
    for (const id of R().BOARD_IDS) {
      const words = R().TEXT.presets[id];
      const card = boardCard(R().preset(id), words.title, R().TEXT.nodes[id].about, "is-palette");
      card.id = `logic-mss-preset-${id}`;
      card.draggable = true;
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.addEventListener("dragstart", (event) => start(event, { kind: "board", id }));
      card.addEventListener("dragend", stop);
      // Without a mouse: click (or Enter) adds it on the right, the way round that fits.
      const add = () => {
        const node = R().orientFor(row, row.length, id);
        if (!node) return ctx.flash?.("err", TEXT.doesNotFit(words.title));
        setRow(config, ctx, R().insertNode(row, row.length, node));
      };
      card.addEventListener("click", add);
      card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); add(); } });
      boards.append(card);
    }
    boardsGroup.append(boards);
    const samplesGroup = el("div", "mss-palette-group is-samples");
    samplesGroup.append(el("h5", "", TEXT.samplesHeading));
    const samples = el("div", "mss-presets is-samples");
    for (const id of R().SAMPLE_IDS) {
      const words = R().TEXT.presets[id];
      const card = boardCard(R().preset(id), words.title, words.about, "is-palette");
      card.id = `logic-mss-preset-${id}`;
      card.draggable = true;
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.addEventListener("dragstart", (event) => start(event, { kind: "sample", id }));
      card.addEventListener("dragend", stop);
      const load = () => {
        if (row.length) {
          state.ask = `sample:${id}`;
          return ctx.render();
        }
        setRow(config, ctx, R().preset(id));
      };
      card.addEventListener("click", load);
      card.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); load(); } });
      samples.append(card);
    }
    samplesGroup.append(samples);
    const groups = el("div", "mss-palette-groups");
    groups.append(boardsGroup, samplesGroup);
    palette.append(groups);

    // The module: its cards, with a gap before, between and after them to drop into.
    const canvas = el("div", "mss-canvas");
    canvas.append(el("h4", "", TEXT.yourModule));
    const lane = el("div", "mss-row-cards");
    lane.id = "logic-mss-lane";
    const zone = (at, big = false) => {
      const z = el("div", `mss-drop${big ? " is-empty" : ""}`, big ? TEXT.dropHere : "");
      z.dataset.at = String(at);
      z.addEventListener("dragover", (event) => {
        if (!z.classList.contains("is-valid")) return;
        event.preventDefault();
        z.classList.add("is-over");
      });
      z.addEventListener("dragleave", () => z.classList.remove("is-over"));
      z.addEventListener("drop", (event) => {
        event.preventDefault();
        dropAt(config, ctx, row, at);
      });
      return z;
    };
    const titleOf = (node) => R().TEXT.nodes[node?.node]?.title || String(node?.node ?? "");
    if (!row.length) lane.append(zone(0, true));
    row.forEach((node, i) => {
      lane.append(zone(i));
      const card = el("div", "mss-board-card");
      card.dataset.board = String(i);
      card.draggable = true;
      card.addEventListener("dragstart", (event) => start(event, { kind: "move", from: i }));
      card.addEventListener("dragend", stop);
      card.append(el("strong", "", TEXT.nodeWords(i + 1, titleOf(node), node?.turned === true)));
      const picture = R().NODE_IDS.includes(node?.node) ? P().draw(R().named([{ node: node.node, ...(node.turned ? { turned: true } : {}) }]), { bare: true }) : null;
      if (picture) card.append(picture);
      const actions = el("div", "mss-board-actions");
      if (node?.node === "complex") {
        const turn = button(TEXT.turn, () => flip(config, ctx, row, i));
        turn.id = `logic-mss-flip-${i}`;
        turn.disabled = !R().canTurn(row, i);
        if (turn.disabled) turn.title = TEXT.cannotTurn;
        actions.append(turn);
      }
      const remove = button(TEXT.remove, () => removeAt(config, ctx, row, i));
      remove.id = `logic-mss-remove-${i}`;
      remove.disabled = row.length > 1 && !R().canRemove(row, i);
      if (remove.disabled) remove.title = TEXT.cannotRemove;
      actions.append(remove);
      card.append(actions);
      lane.append(card);
    });
    if (row.length) lane.append(zone(row.length));
    canvas.append(lane);
    // Drop a card of the module here to take it off.
    const bin = el("div", "mss-bin", TEXT.dropToRemove);
    bin.id = "logic-mss-bin";
    bin.addEventListener("dragover", (event) => {
      if (drag?.kind !== "move" || (row.length > 1 && !R().canRemove(row, drag.from))) return;
      event.preventDefault();
      bin.classList.add("is-over");
    });
    bin.addEventListener("dragleave", () => bin.classList.remove("is-over"));
    bin.addEventListener("drop", (event) => {
      event.preventDefault();
      const from = drag?.from;
      drag = null;
      if (from !== undefined) removeAt(config, ctx, row, from);
    });
    canvas.append(bin);
    for (const p of row.length ? R().problems(row) : []) canvas.append(el("p", "mss-warning", p.text));
    if (state.ask?.startsWith("sample:")) {
      const id = state.ask.slice(7);
      canvas.append(asking(ctx, TEXT.sampleAsk(R().TEXT.presets[id]?.title || id), TEXT.sampleYes, () => setRow(config, ctx, R().preset(id))));
    }
    // What going on will add to the pages, with the LEDs or WS2812B choice.
    if (rowOk) {
      const adds = el("div", "mss-adds");
      const shown = el("div");
      const want = addsList(shown, config, ctx, row, styleFor(config, ctx, row), { kept: false });
      if (want.sensors.length || want.turnouts.length || want.masts.length) {
        adds.append(el("strong", "", TEXT.onNext), ...shown.childNodes);
        canvas.append(adds);
      }
    }
    if (row.length) {
      if (state.ask === "again") {
        canvas.append(asking(ctx, TEXT.startAgainAsk, TEXT.yes, () => {
          delete config.logic.mss.row;
          state.step = "pick";
          ctx.persist();
          ctx.render();
        }));
      } else {
        const b = button(TEXT.startAgain, () => { state.ask = "again"; ctx.render(); });
        b.id = "logic-mss-start-again";
        const again = el("p", "mss-start-again");
        again.append(b);
        canvas.append(again);
      }
    }
    // The module on top, the palette under it: both in view while dragging.
    builder.append(canvas, palette);
    panel.append(builder);
  }

  // The part being wired: the one picked, else the first not done.
  function wireAt(list_) {
    return list_.find((w) => w.key === state.wireAt) || list_.find((w) => !w.done) || list_[0];
  }

  function renderWire(panel, config, ctx) {
    const items = wireList(config);
    if (!items.length) return;
    const at = wireAt(items);
    const index = items.indexOf(at);
    const pick = (key) => {
      state.wireAt = key;
      ctx.render();
      document.querySelector("#logic-mss-wire-pin")?.focus({ preventScroll: true });
    };
    const box = el("div", "mss-wire");
    box.id = "logic-mss-wire";
    box.append(el("span", "mss-wire-count", TEXT.wireOf(index + 1, items.length)));
    box.append(el("h4", "", `${at.name} (${TEXT.wireRoles[at.role] || at.role})`));
    const pca = config?.pca9685 !== false;
    const how = at.role === "points" ? (pca ? TEXT.howTo.pointsPca : TEXT.howTo.pointsEsp) : typeof TEXT.howTo[at.role] === "function" ? TEXT.howTo[at.role](at.end) : TEXT.howTo[at.role];
    box.append(el("p", "card-copy", how));
    const changed = () => { ctx.persist(); ctx.render(); document.querySelector("#logic-mss-wire-pin")?.focus({ preventScroll: true }); };
    const select = (label, value, choices, onChange) => {
      const field = ctx.field(label, value, onChange, { select: choices });
      return field;
    };
    if (at.problem === "notThere") box.append(el("p", "mss-warning", TEXT.notOnPage));
    else if (at.kind === "sensor" && at.place?.expander) box.append(el("p", "hint", TEXT.onExpander(at.place.expander, at.place.pin)));
    else if (at.kind === "sensor") {
      const b = config.blocks.find((x) => x?.name === at.name);
      const f = select(TEXT.pin, at.pin, [{ value: "", label: TEXT.pickPin }, ...ctx.blockPinChoices(at.pin)], (v) => { b.gpio = v; changed(); });
      f.querySelector("select").id = "logic-mss-wire-pin";
      box.append(f);
    } else if (at.kind === "turnout" && pca) {
      const p = config.points.find((x) => x?.name === at.name);
      const boards = list(config.pcaBoards).length || 1;
      if (boards > 1) box.append(select(TEXT.pcaBoard, String(Number(p.pcaBoard) || 0), Array.from({ length: boards }, (_, i) => ({ value: String(i), label: TEXT.pcaBoardN(i + 1) })), (v) => { p.pcaBoard = Number(v); changed(); }));
      const f = select(TEXT.channel, String(p.channel ?? ""), Array.from({ length: 16 }, (_, i) => ({ value: String(i), label: String(i) })), (v) => { p.channel = Number(v); changed(); });
      f.querySelector("select").id = "logic-mss-wire-pin";
      box.append(f);
    } else if (at.kind === "turnout") {
      const p = config.points.find((x) => x?.name === at.name);
      const f = select(TEXT.pin, at.pin, [{ value: "", label: TEXT.pickPin }, ...ctx.freePinChoices(at.pin)], (v) => { p.servoPin = v; changed(); });
      f.querySelector("select").id = "logic-mss-wire-pin";
      box.append(f);
    } else {
      const key = at.role === "pair" ? "pairPin" : "ledPin";
      const f = select(TEXT.pin, at.pin, [{ value: "", label: TEXT.noPin }, ...ctx.freePinChoices(at.pin)], (v) => {
        const mss = config.logic.mss;
        mss.ends = list(mss.ends).filter((e) => isObject(e));
        let def = mss.ends.find((e) => e.name === at.end);
        if (!def) mss.ends.push(def = { name: at.end });
        if (v) def[key] = v;
        else delete def[key];
        if (!def.pairPin && !def.ledPin) mss.ends = mss.ends.filter((e) => e !== def);
        if (!mss.ends.length) delete mss.ends;
        changed();
      });
      f.querySelector("select").id = "logic-mss-wire-pin";
      box.append(f);
    }
    if (at.problem === "missing") box.append(el("p", "mss-warning", TEXT.pinMissing));
    if (at.problem === "shared") box.append(el("p", "mss-warning", TEXT.pinShared(at.pin)));
    const nav = el("div", "dialog-actions");
    const prev = button(TEXT.previous, () => pick(items[index - 1].key));
    prev.disabled = index === 0;
    prev.id = "logic-mss-wire-previous";
    const next = button(TEXT.nextPart, () => pick(items[index + 1].key));
    next.disabled = index === items.length - 1;
    next.id = "logic-mss-wire-next";
    nav.append(prev, next);
    box.append(nav);
    panel.append(box);
    // Every part, to jump to.
    const ol = el("ol", "mss-wire-list");
    items.forEach((w, i) => {
      const li = el("li", w.key === at.key ? "is-current" : "");
      const b = button(`${w.done ? "✓" : w.problem ? "!" : String(i + 1)} ${w.name}`, () => pick(w.key), `link-button${w.problem ? " is-problem" : ""}`);
      b.dataset.wire = w.key;
      li.append(b);
      ol.append(li);
    });
    panel.append(ol);
  }

  // The signal being set up: the one picked, else the first not done.
  function signalAt(items) {
    return items.find((x) => x.name === state.signalAt) || items.find((x) => !x.done) || items[0];
  }

  // A free pin for a new LED or data pin: not a start-up pin, if one is free.
  function freePin(ctx) {
    const choices = ctx.freePinChoices("");
    return (choices.find((c) => !/strapping/.test(c.label)) || choices[0])?.value || "";
  }

  // Light a signal's heads on the picture as an indication shows them (null: as drawn).
  const COLOURS = Object.freeze({ red: "#dc2626", amber: "#f59e0b", green: "#16a34a", white: "#f9fafb", off: "#1f2937" });
  function preview(name, indication) {
    const heads = [...document.querySelectorAll(`#logic-mss-picture [data-part="${CSS.escape(name)}"] .mss-row-head`)];
    heads.forEach((head, h) => {
      const look = indication?.heads[h];
      head.style.fill = look ? COLOURS[look.color] || COLOURS.off : "";
      head.classList.toggle("is-blink", !!look?.blink && look.color !== "off");
    });
  }

  function renderSignals(panel, config, ctx) {
    const mss = config.logic.mss;
    const changed = (focus = "#logic-mss-signal-style") => { ctx.persist(); ctx.render(); document.querySelector(focus)?.focus({ preventScroll: true }); };
    // The two ticks, for the whole module.
    const ticks = el("div", "mss-ticks");
    for (const [key, field] of [["advance", "advanceApproach"], ["approachDiverging", "approachDiverging"]]) {
      const f = ctx.field(TEXT.ticks[key], mss[field] === true, (checked) => {
        if (checked) mss[field] = true;
        else delete mss[field];
        changed(`#logic-mss-tick-${key}`);
      }, { checkbox: true, hint: TEXT.ticks[`${key}Hint`] });
      f.querySelector("input")?.setAttribute("id", `logic-mss-tick-${key}`);
      ticks.append(f);
    }
    panel.append(ticks);
    const items = signalList(config);
    if (!items.length) return;
    const at = signalAt(items);
    const index = items.indexOf(at);
    const pick = (name) => {
      state.signalAt = name;
      ctx.render();
      document.querySelector("#logic-mss-signal-style")?.focus({ preventScroll: true });
    };
    const box = el("div", "mss-wire");
    box.id = "logic-mss-signal";
    box.append(el("span", "mss-wire-count", TEXT.signalOf(index + 1, items.length)));
    box.append(el("h4", "", `${at.name} (${TEXT.heads[at.heads] || at.heads})`));
    if (!at.there) box.append(el("p", "mss-warning", TEXT.notOnPageSignal));
    else {
      const m = config.signals.masts.find((x) => x?.name === at.name);
      const style = ctx.field(TEXT.style, at.style, (v) => {
        if (v === at.style) return;
        // Made again for the choice: the pattern's lamps and aspects, with free pins.
        const part = R().parts(rowOf(config)).find((p) => p.name === at.name);
        const fresh = MT().mast(at.name, MT().MSS_ROWS[part.heads], part.heads === "twoHeads" ? MT().HEADS.twoHeads : MT().HEADS.oneHead, v);
        const i = config.signals.masts.indexOf(m);
        const next = { ...fresh, topic: m.topic, topicCustom: m.topicCustom, pin: "", numLeds: fresh.lamps.reduce((n, lamp) => n + (Number(lamp.count) || 1), 0) };
        config.signals.masts[i] = next;
        if (next.mode === "gpio") for (const lamp of next.lamps) lamp.pin = freePin(ctx);
        else next.pin = freePin(ctx);
        ctx.flash?.("ok", TEXT.restyled);
        changed();
      }, { select: [{ value: "leds", label: TEXT.styles.leds }, { value: "strip", label: TEXT.styles.strip }] });
      style.querySelector("select").id = "logic-mss-signal-style";
      box.append(style);
      const pins = el("div", "mss-signal-pins");
      for (const p of at.pins) {
        const f = ctx.field(p.label, p.pin, (v) => {
          if (p.key === "data") m.pin = v;
          else m.lamps[Number(p.key.split(":")[1])].pin = v;
          changed(`[data-signal-pin="${p.key}"]`);
        }, { select: [{ value: "", label: TEXT.pickPin }, ...ctx.freePinChoices(p.pin)] });
        f.querySelector("select").dataset.signalPin = p.key;
        pins.append(f);
      }
      box.append(pins);
      const strapping = at.pins.map((p) => p.pin).filter((pin) => /^GPIO(0|2|5|12|15)$/i.test(pin));
      if (strapping.length) box.append(el("p", "mss-warning", TEXT.strapping(strapping.join(", "))));
      if (at.problem === "missing") box.append(el("p", "mss-warning", TEXT.pinMissing));
      if (at.problem === "shared") box.append(el("p", "mss-warning", TEXT.pinShared(at.pins.find((p) => (pinUses(config).get(p.pin.toUpperCase()) || 0) > 1)?.pin || "")));
      // What it shows: point at one, and the picture shows it.
      box.append(el("p", "hint", TEXT.shows));
      const chips = el("div", "mss-indications");
      for (const ind of indicationsFor(config, at.heads)) {
        const chip = button("", () => preview(at.name, ind), "mss-indication");
        chip.dataset.indication = ind.key;
        for (const head of ind.heads) chip.append(el("span", `mss-lamp is-${head.color}${head.blink ? " is-blink" : ""}`));
        chip.append(` ${ind.label}`);
        for (const on of ["mouseenter", "focus"]) chip.addEventListener(on, () => preview(at.name, ind));
        for (const off of ["mouseleave", "blur"]) chip.addEventListener(off, () => preview(at.name, null));
        chips.append(chip);
      }
      box.append(chips);
    }
    const nav = el("div", "dialog-actions");
    const prev = button(TEXT.previous, () => pick(items[index - 1].name));
    prev.disabled = index === 0;
    prev.id = "logic-mss-signal-previous";
    const next = button(TEXT.nextSignal, () => pick(items[index + 1].name));
    next.disabled = index === items.length - 1;
    next.id = "logic-mss-signal-next";
    nav.append(prev, next);
    box.append(nav);
    panel.append(box);
    const ol = el("ol", "mss-wire-list");
    items.forEach((x, i) => {
      const li = el("li", x.name === at.name ? "is-current" : "");
      const b = button(`${x.done ? "✓" : x.problem ? "!" : String(i + 1)} ${x.name}`, () => pick(x.name), `link-button${x.problem ? " is-problem" : ""}`);
      b.dataset.signal = x.name;
      li.append(b);
      ol.append(li);
    });
    panel.append(ol);
  }

  function renderParts(panel, config, kinds) {
    const ul = el("ul", "mss-parts");
    for (const p of partsOf(config).filter((x) => kinds.includes(x.kind))) {
      ul.append(el("li", p.there ? "is-there" : "is-missing", TEXT.partLine(p.name, TEXT.roles[p.role] || p.role, p.there ? TEXT.onPage : TEXT.missing)));
    }
    panel.append(ul);
  }

  function renderPage(root, config, ctx) {
    if (state.board !== config) Object.assign(state, { board: config, step: null, settings: false, views: false, style: null, ask: "", wireAt: "", signalAt: "" });
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
      let options = { lit: litFor(config, current) };
      if (current === "wire") {
        const items = wireList(config);
        const at = items.length ? wireAt(items) : null;
        options = {
          lit: new Set(at ? [at.key] : []),
          badges: Object.fromEntries(items.map((w, i) => [w.key, w.done ? "✓" : String(i + 1)])),
          marks: Object.fromEntries(items.map((w) => [w.key, w.problem ? "error" : w.done ? "done" : ""]).filter(([, m]) => m)),
        };
      }
      if (current === "signals") {
        const items = signalList(config);
        const at = items.length ? signalAt(items) : null;
        options = {
          lit: new Set(at ? [at.name] : []),
          badges: Object.fromEntries(items.map((x, i) => [x.name, x.done ? "✓" : String(i + 1)])),
          marks: Object.fromEntries(items.map((x) => [x.name, x.problem ? "error" : x.done ? "done" : ""]).filter(([, m]) => m)),
        };
      }
      const picture = P().draw(row, options);
      if (picture) {
        picture.id = "logic-mss-picture";
        // Click a part to wire it.
        if (current === "signals") {
          picture.classList.add("is-pickable");
          picture.addEventListener("click", (event) => {
            const name = event.target.closest?.(".mss-row-signal")?.dataset.part;
            if (!name) return;
            state.signalAt = name;
            ctx.render();
            document.querySelector("#logic-mss-signal-style")?.focus({ preventScroll: true });
          });
        }
        if (current === "wire") {
          picture.classList.add("is-pickable");
          picture.addEventListener("click", (event) => {
            const key = event.target.closest?.("[data-part]")?.dataset.part;
            if (!key) return;
            state.wireAt = key.startsWith("end:") && !key.includes(":pair") && !key.includes(":led") ? `${key}:pair` : key;
            ctx.render();
            document.querySelector("#logic-mss-wire-pin")?.focus({ preventScroll: true });
          });
        }
        const wrap = el("div", "mss-row-wrap");
        wrap.append(picture);
        card.append(wrap);
      }
    }
    const panel = el("div", "mss-panel");
    const g = guidance(config, current);
    panel.append(el("p", "card-copy", g.doing));
    if (current === "pick") renderPick(panel, config, ctx);
    else if (current === "wire") renderWire(panel, config, ctx);
    else if (current === "signals") renderSignals(panel, config, ctx);
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

  global.EsphomeMrLogicUiMss = { TEXT, PART, ORDER, stepsOf, currentStep, guidance, handWritten, partsOf, litFor, wireList, signalList, indicationsFor, viewsOpen, settingsOpen };

  if (global.EsphomeMrLogicUi) {
    global.EsphomeMrLogicUi.registerPart({ id: PART, order: 5, modes: ["mss"], text: TEXT, render: renderPage });
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
