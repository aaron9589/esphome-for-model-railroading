// The Logic page in MSS Logic mode: the MSS page's guided steps, Ends (logic-mss-ends) and the Signals grid with
// approach lighting (logic-mss-signals). Work item 4.2a.
// Loaded after mss-builder.js. Parts register with EsphomeMrLogicUi.registerPart
// (modes: ["mss"]), using the part ids in EsphomeMrMssBuilder.PARTS, and keep
// every word in their TEXT for the plain-words lint.
//
// What they store, in logic.mss (docs/mss-emulation-spec.md, Stored format):
//   ends:  [ { name: "A", tracks: 1, pairPin: "GPIO32", ledPin: "GPIO33" } ]
//          (a pin on an expander is pairExpander + pairPin 0-15, ledExpander + ledPin, as Field Logic's ends)
//   masts: [ { mast: "Home", aspects: { stop: "R292", ... }, approachLight: "<block or sensor>" } ]
//   advanceApproach, approachDiverging: which optional indications are used
// The logic is in the pure functions below, which test/mss-steps.test.js checks
// without a DOM. The render functions at the end only draw them.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const B = () => global.EsphomeMrMssBuilder;
  const E = () => global.EsphomeMrLogicUiEnds;
  const PART = (key) => B().PARTS[key];

  const TEXT = Object.freeze({
    // The guided steps.
    stepsCard: "Set up this module",
    stepsIntro: "Describe the module in these steps. You can come back to any of them in any order.",
    steps: Object.freeze({
      ends: Object.freeze({ title: "Ends", hint: "Say how many ends the module has and how many tracks cross each." }),
      tracks: Object.freeze({ title: "Tracks", hint: "Describe each track: its blocks, block boundaries and sensors." }),
      junctions: Object.freeze({ title: "Junctions", hint: "If the module has turnouts, add each junction and its routes. Skip this for plain track." }),
      signals: Object.freeze({ title: "Signals", hint: "Choose the indications to use and pick what each signal shows." }),
      tryIt: Object.freeze({ title: "Try it", hint: "Run a train through, and play with pretend neighbours." }),
      download: Object.freeze({ title: "Download", hint: "Get the YAML for the board." }),
    }),
    stepDone: "Done",
    stepNext: "Next",
    stepOptional: "Optional",
    stepProblems: (n) => (n === 1 ? "1 thing to fix" : `${n} things to fix`),
    // Ends.
    endsCard: "Ends",
    endsIntro: "An end is where track leaves this module and meets the next one. Name each end with the letter marked on the module (A, B, C) and say how many tracks cross it. Describe the track through each end under Tracks.",
    endsIntro2: "Press Pair on both sides of a joint to join two modules. Each end can have a Pair button and an LED on this board. The LED blinks slowly while pairing, stays on when the other module is heard, and blinks fast when there is a problem.",
    endsEmpty: "No ends yet. Add one for each side of the module that joins another.",
    addEnd: "Add an end",
    endTitle: (name) => `End ${name}`,
    unnamed: "Unnamed end",
    remove: "Remove",
    nameLabel: "Name",
    nameHint: "Usually A, B, C, as marked on the module.",
    tracksLabel: "Tracks across this end",
    tracksHint: "One for single track, two for double track.",
    pairLabel: "Pair button pin",
    pairHint: "Optional. A push button between the pin and GND. The Pair button on this board's web page always works.",
    ledLabel: "LED pin",
    ledHint: "Optional. An LED that shows the state of this end.",
    noPinsLeft: "No free pins left. Free one on its own page.",
    // Signals.
    signalsCard: "Signals",
    signalsIntro: "One row for each signal the module uses, and one column for each indication. Pick the aspect the signal shows for each. The aspects named in the CATS signal template are filled in already.",
    signalsIntro2: "A place with no signal gets one with no lights, so the signals behind it keep working. It needs nothing here.",
    optionalHeading: "Indications to use",
    advanceLabel: "Advance Approach",
    advanceHint: "A fourth indication, shown by the signal two blocks behind a Stop. Off by default, as in MSS.",
    divergingLabel: "Approach Diverging",
    divergingHint: "Shown by the signal behind one that shows a diverging aspect. Off by default, as in MSS.",
    signalsEmpty: "No signals yet. Pick a signal for a block boundary under Tracks, or for a leg under Junctions.",
    signalColumn: "Signal",
    approachColumn: "Approach lighting",
    approachHint: "Dark unless a train is in the block you pick.",
    alwaysLit: "Always lit",
    approachGroupBlocks: "Blocks",
    approachGroupSensors: "Sensors",
    notPicked: "Pick an aspect",
    notOnPage: "This signal is not on the Signal Masts page.",
    notShown: "Not used",
    sameAsAbove: "Same as above",
    sameAsAboveHint: "Copy the aspects from the row above where this signal has them.",
    needsLook: "To fix",
    indications: Object.freeze({ ...global.EsphomeMrMssBuilder.TEXT.indications }),
  });

  // ===== Pure logic: the steps ==============================================

  // The description, made when first needed.
  function mssOf(config) {
    const logic = config.logic || (config.logic = {});
    if (!isObject(logic.mss)) logic.mss = {};
    return logic.mss;
  }

  const readMss = (config) => (isObject(config?.logic?.mss) ? config.logic.mss : {});

  /** Do the builder's problems for one part (and, with `match`, one item of it) apply? */
  function problemsFor(config, part, match = {}) {
    return B().problems(config).filter((problem) => problem.where?.part === part
      && Object.entries(match).every(([key, value]) => problem.where[key] === value));
  }

  /**
   * The guided steps, in order: [{ key, part, view, done, optional, problems }].
   * `part` is the card the step links to, `view` a page of the configurator
   * (Download). `tryIt` is whether the page has a Try it part to link to. Try it is
   * registered for Field Logic only, so the step stays off until a `logic-try`
   * part is registered for `mss` (turn it on with MSS Try it).
   */
  function guidedSteps(config, { tryIt = true } = {}) {
    const mss = readMss(config);
    const all = B().problems(config);
    const count = (part) => all.filter((problem) => problem.where?.part === part).length;
    const have = (key) => list(mss[key]).filter(isObject).length;
    const steps = [
      { key: "ends", part: PART("ends"), done: have("ends") > 0 && count(PART("ends")) === 0 },
      { key: "tracks", part: PART("tracks"), done: have("tracks") > 0 && count(PART("tracks")) === 0 },
      { key: "junctions", part: PART("junctions"), optional: true, done: have("junctions") > 0 && count(PART("junctions")) === 0 },
      { key: "signals", part: PART("signals"), done: have("tracks") > 0 && count(PART("signals")) === 0 },
    ];
    if (tryIt) steps.push({ key: "tryIt", part: "logic-try", done: false });
    steps.push({ key: "download", view: "yaml", done: false });
    for (const step of steps) step.problems = step.part ? count(step.part) : 0;
    return steps;
  }

  /** The first step not done, skipping optional ones; null when all are. */
  function nextStep(steps) {
    return steps.find((step) => !step.done && !step.optional) || null;
  }

  // ===== Pure logic: ends ===================================================

  const endList = (config) => list(readMss(config).ends);

  // A free name: A, B, C ... then "End 27" and so on.
  function freeEndName(config) {
    const taken = new Set(endList(config).filter(isObject).map((end) => String(end.name ?? "")));
    for (let code = 65; code <= 90; code += 1) if (!taken.has(String.fromCharCode(code))) return String.fromCharCode(code);
    let n = taken.size + 1;
    while (taken.has(`End ${n}`)) n += 1;
    return `End ${n}`;
  }

  /** Add an end with one track across it; returns it. */
  function addEnd(config) {
    const mss = mssOf(config);
    if (!Array.isArray(mss.ends)) mss.ends = [];
    const end = { name: freeEndName(config), tracks: 1 };
    mss.ends.push(end);
    return end;
  }

  /** Remove an end. Tracks that named it are left for validation to report. */
  function removeEnd(config, index) {
    if (Array.isArray(readMss(config).ends)) config.logic.mss.ends.splice(index, 1);
    return config;
  }

  /** Set how many tracks cross an end: a whole number from 1; anything else is ignored. */
  function setEndTracks(end, value) {
    const n = typeof value === "number" || (typeof value === "string" && value.trim() !== "") ? Number(value) : NaN;
    if (!Number.isInteger(n) || n < 1) return false;
    end.tracks = n;
    return true;
  }

  /**
   * An end renamed, once the name is finished: the From and To of tracks that
   * named it follow. The caller has already changed the end's own name. Not when
   * another end still has the old name, or two have the new one. Returns how
   * many moved.
   */
  function renameEnd(config, from, to) {
    if (typeof from !== "string" || typeof to !== "string" || !from || !to.trim() || from === to) return 0;
    const names = endList(config).filter(isObject).map((end) => end.name);
    if (names.includes(from) || names.filter((name) => name === to).length > 1) return 0;
    let count = 0;
    for (const track of list(readMss(config).tracks)) {
      if (!isObject(track)) continue;
      for (const side of ["from", "to"]) {
        if (isObject(track[side]) && track[side].end === from) {
          track[side].end = to;
          count += 1;
        }
      }
    }
    return count;
  }

  /**
   * An end's Pair or LED pin choices, [{ value, label }]: no pin, the free ESP
   * pins, then free expander pins. Same lists as Field Logic's ends.
   */
  const pinChoices = (config, end, which, espChoices) => E().pinChoices(config, end, which, espChoices);
  const pinValue = (config, end, which) => E().pinValue(config, end, which);
  const setPin = (config, end, which, value) => E().setPin(config, end, which, value);

  // ===== Pure logic: signals ================================================

  /**
   * The signals the module uses, in order, as the Signals grid rows:
   * [{ mast, diverging, where }]. A boundary's two signals, then each
   * junction leg's, as the builder reads them. A place with no signal has no
   * row. `diverging` is a junction leg with a diverging route, which shows
   * the two diverging indications. A signal used twice is one row.
   */
  function signalList(config) {
    const mss = readMss(config);
    const rows = [];
    const add = (name, diverging, words) => {
      if (typeof name !== "string" || !name.trim()) return;
      const found = rows.find((row) => row.mast === name);
      if (found) {
        found.diverging = found.diverging || diverging;
        return;
      }
      rows.push({ mast: name, diverging, words });
    };
    list(mss.tracks).forEach((track) => {
      if (!isObject(track)) return;
      const blocks = list(track.blocks).length;
      list(track.boundaries).forEach((boundary, k) => {
        if (!isObject(boundary) || k >= Math.max(blocks - 1, 0)) return;
        add(boundary.towardsFrom, false);
        add(boundary.towardsTo, false);
      });
    });
    for (const junction of list(mss.junctions)) {
      if (!isObject(junction) || !String(junction.name ?? "").trim() || !isObject(junction.masts)) continue;
      const diverging = new Set();
      for (const route of list(junction.routes)) {
        if (isObject(route) && route.diverging === true) for (const leg of list(route.legs)) diverging.add(Number(leg));
      }
      for (const leg of Object.keys(junction.masts).sort((a, b) => Number(a) - Number(b))) {
        add(junction.masts[leg], diverging.has(Number(leg)));
      }
    }
    return rows;
  }

  /** Is an indication used on this module? Optional ones are, if ticked. */
  function indicationOn(config, key) {
    const mss = readMss(config);
    if (key === "advance") return mss.advanceApproach === true;
    if (key === "approachDiverging") return mss.approachDiverging === true;
    return true;
  }

  /** The indications a signal shows, in the grid's order (spec, Masts). */
  function indicationsFor(config, row) {
    return B().INDICATIONS.map((i) => i.key).filter((key) => {
      if (key === "divergingClear" || key === "divergingApproach") return !!row.diverging;
      return indicationOn(config, key);
    });
  }

  /** The grid's columns: every indication some signal shows, in order. */
  function gridColumns(config) {
    const rows = signalList(config);
    return B().INDICATIONS.map((i) => i.key).filter((key) => rows.some((row) => indicationsFor(config, row).includes(key)));
  }

  /** The aspect labels a signal on the Signal Masts page has. Empty if it is not there. */
  function mastAspects(config, mastName) {
    const mast = list(config?.signals?.masts).find((m) => m.name === mastName);
    return list(mast?.aspects).map((aspect) => String(aspect?.label ?? ""));
  }

  const gridRowOf = (config, mastName) => list(readMss(config).masts).find((row) => isObject(row) && row.mast === mastName);

  /** What a signal shows for an indication: the grid's pick, else the CATS aspect, else "". */
  function cellValue(config, mastName, key) {
    const given = gridRowOf(config, mastName)?.aspects?.[key];
    return typeof given === "string" && given ? given : B().prefill(config, mastName, key);
  }

  /**
   * Pick the aspect a signal shows for an indication; "" goes back to the
   * prefilled one. A row with nothing left in it is dropped.
   */
  function setCell(config, mastName, key, value) {
    const mss = mssOf(config);
    if (!Array.isArray(mss.masts)) mss.masts = [];
    let row = gridRowOf(config, mastName);
    if (!row) {
      if (!value) return config;
      row = { mast: mastName, aspects: {} };
      mss.masts.push(row);
    }
    if (!isObject(row.aspects)) row.aspects = {};
    if (value) row.aspects[key] = value;
    else delete row.aspects[key];
    return tidyRow(config, row);
  }

  function tidyRow(config, row) {
    if (!Object.keys(row.aspects || {}).length) delete row.aspects;
    if (row.aspects === undefined && !(typeof row.approachLight === "string" && row.approachLight)) {
      const rows = config.logic.mss.masts;
      rows.splice(rows.indexOf(row), 1);
    }
    return config;
  }

  /**
   * Same as above: copy the row above's aspects into this one, for each
   * indication both show, where this signal has an aspect of that name.
   * Returns how many cells changed.
   */
  function copyRowAbove(config, index) {
    const rows = signalList(config);
    const row = rows[index];
    const above = rows[index - 1];
    if (!row || !above) return 0;
    const have = new Set(mastAspects(config, row.mast));
    const shared = new Set(indicationsFor(config, above));
    let changed = 0;
    for (const key of indicationsFor(config, row)) {
      if (!shared.has(key)) continue;
      const value = cellValue(config, above.mast, key);
      if (!value || !have.has(value) || cellValue(config, row.mast, key) === value) continue;
      setCell(config, row.mast, key, value);
      changed += 1;
    }
    return changed;
  }

  /** Turn an optional indication on or off. Aspects picked for it are kept. */
  function setIndication(config, key, on) {
    const mss = mssOf(config);
    if (key === "advance") mss.advanceApproach = !!on;
    else if (key === "approachDiverging") mss.approachDiverging = !!on;
    return config;
  }

  /** A signal's approach lighting: the block or sensor it is lit for, or "" for always lit. */
  function approachLight(config, mastName) {
    const value = gridRowOf(config, mastName)?.approachLight;
    return typeof value === "string" ? value : "";
  }

  function setApproachLight(config, mastName, block) {
    const mss = mssOf(config);
    if (!Array.isArray(mss.masts)) mss.masts = [];
    let row = gridRowOf(config, mastName);
    if (!row) {
      if (!block) return config;
      row = { mast: mastName };
      mss.masts.push(row);
    }
    if (block) row.approachLight = block;
    else delete row.approachLight;
    return tidyRow(config, row);
  }

  /**
   * What a signal can be lit for: the blocks MSS Logic makes from the tracks,
   * then the sensors, as [{ label, options: [{ value, text }] }].
   */
  function approachChoices(config) {
    let blocks = [];
    try {
      blocks = list(B().build(config).blocks).map((block) => String(block?.name ?? "")).filter(Boolean);
    } catch (error) {
      blocks = [];
    }
    const sensors = list(config.blocks).map((sensor) => String(sensor?.name ?? "")).filter(Boolean);
    const groups = [];
    if (blocks.length) groups.push({ label: TEXT.approachGroupBlocks, options: [...new Set(blocks)].map((name) => ({ value: name, text: name })) });
    if (sensors.length) groups.push({ label: TEXT.approachGroupSensors, options: [...new Set(sensors)].map((name) => ({ value: name, text: name })) });
    return groups;
  }

  /**
   * The Signals grid as data: { columns, rows } with a row for each signal:
   * { mast, onPage, diverging, cells: { <key>: { value, aspects } }, approachLight, problems }.
   * A cell exists only for an indication that signal shows.
   */
  function signalsGrid(config) {
    const all = B().problems(config);
    const columns = gridColumns(config);
    const rows = signalList(config).map((row) => {
      const aspects = mastAspects(config, row.mast);
      const cells = {};
      for (const key of indicationsFor(config, row)) cells[key] = { value: cellValue(config, row.mast, key), aspects };
      return {
        mast: row.mast,
        onPage: list(config?.signals?.masts).some((m) => m.name === row.mast),
        diverging: !!row.diverging,
        cells,
        approachLight: approachLight(config, row.mast),
        problems: all.filter((p) => p.where?.part === PART("signals") && p.where.mast === row.mast),
      };
    });
    return { columns, rows };
  }

  // ===== Drawing ============================================================

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

  function problemList(problems) {
    if (!problems.length) return null;
    const ul = el("ul", "mss-problems");
    for (const problem of problems) ul.append(el("li", problem.level === "warning" ? "is-warning" : "is-error", problem.text));
    return ul;
  }

  // ----- Guided steps -----

  function renderSteps(root, config, ctx, ui) {
    const steps = guidedSteps(config, { tryIt: !!global.EsphomeMrLogicUi?.FEATURES?.tryIt && !!global.EsphomeMrLogicUi?.hasPart?.("logic-try", "mss") });
    const next = nextStep(steps);
    const section = ui.card("logic-mss-steps", TEXT.stepsCard);
    section.classList.add("logic-steps");
    section.append(ui.paragraph(TEXT.stepsIntro));
    const ol = el("ol", "logic-checklist mss-steps");
    for (const step of steps) {
      const words = TEXT.steps[step.key];
      const item = el("li");
      item.classList.toggle("is-done", step.done);
      item.classList.toggle("is-next", step === next);
      const link = el("a", "", words.title);
      link.href = `#${step.part || step.view}`;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        if (step.view) ctx.showView(step.view);
        else document.getElementById(step.part)?.scrollIntoView({ block: "start" });
      });
      const status = el("span", "step-status", step.problems ? TEXT.stepProblems(step.problems) : step.done ? TEXT.stepDone : step === next ? TEXT.stepNext : step.optional ? TEXT.stepOptional : "");
      if (step.problems) status.classList.add("has-problems");
      item.append(link, status, ctx.hintEl(words.hint));
      ol.append(item);
    }
    section.append(ol);
    if (!global.EsphomeMrMssTemplates?.described(config)) section.append(templatePicker(config, ctx, ui));
    root.append(section);
  }

  // ===== Templates: a standard MSS module in one click ======================

  let pendingTemplate = ""; // the template whose confirm panel is open
  let templateStyle = "leds"; // its signals: individual LEDs, or WS2812B ("strip")

  function templatePicker(config, ctx, ui) {
    const MT = global.EsphomeMrMssTemplates;
    const T = MT.TEXT;
    const box = el("div", "mss-templates");
    box.append(el("h4", "", T.heading), ui.paragraph(T.hint, "hint"));
    const choices = el("div", "mss-template-choices");
    for (const id of MT.IDS) {
      const choice = el("div", `mss-template${pendingTemplate === id ? " is-open" : ""}`);
      const pick = el("button", "", T.templates[id].title);
      pick.type = "button";
      pick.addEventListener("click", () => {
        pendingTemplate = pendingTemplate === id ? "" : id;
        ctx.render();
      });
      choice.append(pick, ctx.hintEl(T.templates[id].about));
      choices.append(choice);
    }
    box.append(choices);
    if (pendingTemplate) box.append(templateConfirm(config, ctx, ui, pendingTemplate));
    return box;
  }

  function templateConfirm(config, ctx, ui, id) {
    const MT = global.EsphomeMrMssTemplates;
    const T = MT.TEXT;
    const plan = MT.plan(config, id, { style: templateStyle });
    const panel = el("div", "mss-template-confirm");
    panel.append(el("strong", "", T.confirm(plan.title)), ui.paragraph(T.adds, "hint"));
    const items = el("ul", "");
    if (plan.sensors.length) items.append(el("li", "", T.sensors(plan.sensors.join(", "))));
    if (plan.turnouts.length) items.append(el("li", "", T.turnouts(plan.turnouts.join(", "))));
    if (plan.masts.length) items.append(el("li", "", (plan.style === "strip" ? T.mastsStrip : T.masts)(plan.masts.join(", "), plan.pins)));
    if (plan.kept.length) items.append(el("li", "", T.kept(plan.kept.join(", "))));
    panel.append(items);
    if (plan.masts.length) {
      panel.append(ctx.field(T.useStrip, templateStyle === "strip", (checked) => {
        templateStyle = checked ? "strip" : "leds";
        ctx.render();
      }, { checkbox: true }));
      // Pins safe for an LED, once the new sensors have taken theirs.
      const safe = Math.max(0, (ctx.safeOutputPins?.() ?? Infinity) - plan.sensors.length);
      if (plan.pins > safe) panel.append(ui.paragraph(T.shortOfPins(plan.pins, safe), "mss-template-warning"));
    }
    if (plan.replaces) panel.append(ui.paragraph(T.replaces, "hint"));
    const yes = el("button", "primary", T.apply);
    yes.type = "button";
    yes.addEventListener("click", () => {
      MT.apply(config, id, ctx.addItems, { style: templateStyle });
      pendingTemplate = "";
      ctx.persist();
      ctx.render();
      ctx.flash?.("ok", T.done(plan.title));
    });
    const no = el("button", "", T.cancel);
    no.type = "button";
    no.addEventListener("click", () => {
      pendingTemplate = "";
      ctx.render();
    });
    const row = el("div", "dialog-actions");
    row.append(no, yes);
    panel.append(row);
    return panel;
  }

  // ----- Ends -----

  function renderPin(fields, config, end, which, label, hint, i, ctx) {
    const choices = pinChoices(config, end, which, ctx.pinChoices());
    const field = ctx.field(label, pinValue(config, end, which), (value) => {
      setPin(config, end, which, value);
      ctx.persist();
      ctx.render();
    }, { select: choices, hint: choices.length > 1 ? hint : TEXT.noPinsLeft });
    field.querySelector("select").id = `logic-mss-end-${i}-${which}`;
    fields.append(field);
  }

  function renderEnd(holder, end, i, config, ctx, ui, problems) {
    const { item: card, title } = ui.rowCard(end.name ? TEXT.endTitle(end.name) : TEXT.unnamed, () => {
      removeEnd(config, i);
      ctx.persist();
      ctx.render();
    }, "logic-end mss-end");
    card.id = `logic-mss-end-${i}`;
    const fields = el("div", "fields");
    const nameAtRender = String(end.name ?? "");
    const nameField = ctx.field(TEXT.nameLabel, end.name, (value) => {
      end.name = value;
      title.textContent = value ? TEXT.endTitle(value) : TEXT.unnamed;
      ctx.persist();
    }, { hint: TEXT.nameHint });
    // Tracks follow the name once it is finished, not on every key.
    nameField.querySelector("input").addEventListener("change", () => {
      renameEnd(config, nameAtRender, end.name);
      ctx.persist();
      ctx.render();
    });
    fields.append(nameField);
    const tracks = ctx.field(TEXT.tracksLabel, end.tracks ?? "", (value) => {
      if (setEndTracks(end, value)) ctx.persist();
    }, { type: "number", hint: TEXT.tracksHint });
    const input = tracks.querySelector("input");
    input.min = "1";
    input.step = "1";
    input.addEventListener("change", () => ctx.render());
    fields.append(tracks);
    renderPin(fields, config, end, "pair", TEXT.pairLabel, TEXT.pairHint, i, ctx);
    renderPin(fields, config, end, "led", TEXT.ledLabel, TEXT.ledHint, i, ctx);
    card.append(fields);
    const mine = problems.filter((p) => p.where.end === i);
    card.classList.toggle("has-problems", mine.length > 0);
    const notes = problemList(mine);
    if (notes) card.append(notes);
    holder.append(card);
  }

  function renderEnds(root, config, ctx, ui) {
    const section = ui.card(PART("ends"), TEXT.endsCard);
    section.append(ui.paragraph(TEXT.endsIntro), ui.paragraph(TEXT.endsIntro2));
    const holder = el("div");
    const ends = endList(config);
    const problems = problemsFor(config, PART("ends"));
    ends.forEach((def, i) => {
      if (!isObject(def)) config.logic.mss.ends[i] = {};
      renderEnd(holder, config.logic.mss.ends[i], i, config, ctx, ui, problems);
    });
    if (!ends.length) holder.append(ui.paragraph(TEXT.endsEmpty, "empty"));
    section.append(holder, button(TEXT.addEnd, () => {
      addEnd(config);
      ctx.persist();
      ctx.render();
      const inputs = document.querySelectorAll(`#${PART("ends")} .mss-end > .fields input[type=text]`);
      inputs[inputs.length - 1]?.select();
    }));
    root.append(section);
  }

  // ----- Signals grid -----

  function aspectSelect(config, row, key, cell, ctx) {
    const select = el("select", "mss-aspect");
    select.setAttribute("aria-label", `${row.mast}: ${TEXT.indications[key]}`);
    const have = new Set(cell.aspects);
    if (!cell.value) select.append(Object.assign(el("option", "", TEXT.notPicked), { value: "" }));
    if (cell.value && !have.has(cell.value)) select.append(Object.assign(el("option", "", cell.value), { value: cell.value }));
    for (const label of cell.aspects) select.append(Object.assign(el("option", "", label), { value: label }));
    select.value = cell.value || "";
    select.addEventListener("change", () => {
      setCell(config, row.mast, key, select.value);
      ctx.persist();
      ctx.render();
    });
    return select;
  }

  function renderOptional(section, config, ctx, ui) {
    const box = el("div", "mss-optional fields");
    box.append(el("span", "field-label", TEXT.optionalHeading));
    for (const [key, label, hint, on] of [
      ["advance", TEXT.advanceLabel, TEXT.advanceHint, readMss(config).advanceApproach === true],
      ["approachDiverging", TEXT.divergingLabel, TEXT.divergingHint, readMss(config).approachDiverging === true],
    ]) {
      box.append(ctx.field(label, on, (checked) => {
        setIndication(config, key, checked);
        ctx.persist();
        ctx.render();
      }, { checkbox: true, hint }));
    }
    section.append(box);
  }

  function renderSignals(root, config, ctx, ui) {
    const section = ui.card(PART("signals"), TEXT.signalsCard);
    section.append(ui.paragraph(TEXT.signalsIntro), ui.paragraph(TEXT.signalsIntro2));
    renderOptional(section, config, ctx, ui);
    const { columns, rows } = signalsGrid(config);
    if (!rows.length) {
      section.append(ui.paragraph(TEXT.signalsEmpty, "empty"));
      root.append(section);
      return;
    }
    const wrap = el("div", "mss-signals-wrap");
    const table = el("table", "mss-signals");
    const head = el("tr");
    head.append(el("th", "", TEXT.signalColumn));
    for (const key of columns) head.append(el("th", "", TEXT.indications[key]));
    head.append(el("th", "", TEXT.approachColumn));
    const thead = el("thead");
    thead.append(head);
    table.append(thead, el("tbody"));
    const choices = approachChoices(config);
    rows.forEach((row, i) => {
      const tr = el("tr", "mss-signal-row");
      tr.id = `logic-mss-signal-${i}`;
      tr.classList.toggle("has-problems", row.problems.length > 0);
      const name = el("th", "mss-signal-name");
      name.scope = "row";
      name.append(el("span", "", row.mast));
      if (!row.onPage) name.append(ctx.hintEl(TEXT.notOnPage));
      if (i > 0) {
        const same = button(TEXT.sameAsAbove, () => {
          copyRowAbove(config, i);
          ctx.persist();
          ctx.render();
        }, "mss-same");
        same.title = TEXT.sameAsAboveHint;
        name.append(same);
      }
      tr.append(name);
      for (const key of columns) {
        const td = el("td", "mss-cell");
        const cell = row.cells[key];
        if (!cell) {
          td.classList.add("is-unused");
          td.append(el("span", "mss-unused", TEXT.notShown));
        } else {
          const picture = cell.value ? ctx.mastPicture?.(row.mast, cell.value) : null;
          if (picture) td.append(picture);
          td.append(aspectSelect(config, row, key, cell, ctx));
        }
        tr.append(td);
      }
      const approach = el("td", "mss-cell mss-approach");
      const select = ui.selectEl(choices, row.approachLight, (value) => {
        setApproachLight(config, row.mast, typeof value === "string" ? value : "");
        ctx.persist();
        ctx.render();
      }, { prompt: TEXT.alwaysLit, label: `${row.mast}: ${TEXT.approachColumn}` });
      approach.append(select);
      tr.append(approach);
      table.tBodies[0].append(tr);
      if (row.problems.length) {
        const note = el("tr", "mss-signal-problems");
        const td = el("td");
        td.colSpan = columns.length + 2;
        td.append(problemList(row.problems));
        note.append(td);
        table.tBodies[0].append(note);
      }
    });
    wrap.append(table);
    section.append(wrap, ctx.hintEl(TEXT.approachHint));
    root.append(section);
  }

  const register = global.EsphomeMrLogicUi?.registerPart;
  if (register) {
    register({ id: "logic-mss-steps", order: 12, modes: ["mss"], text: TEXT, render: renderSteps });
    // The Ends part has no words of its own: it hands the lint the templates'
    // (mss-templates.js), which the steps card shows.
    register({ id: PART("ends"), order: 34, modes: ["mss"], text: global.EsphomeMrMssTemplates?.TEXT, render: renderEnds });
    register({ id: PART("signals"), order: 60, modes: ["mss"], render: renderSignals });
  }

  global.EsphomeMrLogicUiMssSteps = {
    TEXT,
    problemsFor, guidedSteps, nextStep,
    freeEndName, addEnd, removeEnd, setEndTracks, renameEnd, pinChoices, pinValue, setPin,
    signalList, indicationOn, indicationsFor, gridColumns, mastAspects, cellValue, setCell, copyRowAbove,
    setIndication, approachLight, setApproachLight, approachChoices, signalsGrid,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
