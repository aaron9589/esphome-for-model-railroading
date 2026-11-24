// Starters (docs/field-logic-spec.md, Starters; work item 2.8): each one asks
// a few questions and writes a group of rules, with any sections and signals
// with no lights it needs. The rules are ordinary rules afterwards.
//
// This file is the shared core: the registry, building and applying a
// starter's result, the helpers starters share, and the dialog their forms
// open in. The starters themselves are in logic-starters-sections.js (One-
// train section, Lock turnouts under a train) and
// logic-starters-signals.js (Block signals, Route signal).
//
// Building is plain JS with no DOM, so Node tests can call it:
//
//   const answers = EsphomeMrLogicStarters.defaults("one-train-section", config);
//   ... fill in answers ...
//   EsphomeMrLogicStarters.problems("one-train-section", config, answers); // [] when ready
//   EsphomeMrLogicStarters.build("one-train-section", config, answers);    // a Result, config untouched
//   EsphomeMrLogicStarters.apply("one-train-section", config, answers);    // adds the Result to config
//
// A Result is { groups, sections, virtualMasts, blocks }: groups in the stored
// shape (`{ name, starter, rules }`), sections (`logic.resources` entries),
// signals with no lights (`logic.masts` entries with `virtual: true`) and
// Logic page blocks to add. Any may be missing or empty.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const L = () => global.EsphomeMrLogicYaml;

  // Every word this core shows. Each starter file keeps its own TEXT and
  // passes it with its form, so the lint covers it.
  const TEXT = Object.freeze({
    add: "Add",
    cancel: "Cancel",
    fixFirst: "Fix these first:",
    nameTaken: (what, name) => `There is already a ${what} called "${name}". Pick another name.`,
    noName: (what) => `Give the ${what} a name.`,
    group: "group",
    section: "section",
    signal: "signal",
  });

  // ===== Registry ===========================================================

  const starters = new Map();

  /**
   * Define a starter. `def` is:
   *   defaults(config) -> answers     what the form starts with
   *   problems(config, answers) -> [] plain sentences; empty when it can be built
   *   build(config, answers) -> Result
   *   form(config, ctx, ui) (optional, browser only): opens the questions,
   *     usually with `dialog`; on Add it calls `apply` then ctx.persist() and
   *     ctx.render().
   *   text (optional): the form's TEXT, for the lint.
   * In the browser, a starter with a form turns its card on (logic-ui-start.js).
   */
  function defineStarter(key, def) {
    if (starters.has(key)) throw new Error(`Starter ${key} is defined twice.`);
    for (const fn of ["defaults", "problems", "build"]) {
      if (typeof def?.[fn] !== "function") throw new Error(`Starter ${key} needs ${fn}().`);
    }
    starters.set(key, def);
    const start = global.EsphomeMrLogicUiStart;
    if (start?.registerStarter && typeof def.form === "function") {
      start.registerStarter(key, { open: (config, ctx, ui) => def.form(config, ctx, ui), text: def.text });
    }
  }

  function starter(key) {
    const def = starters.get(key);
    if (!def) throw new Error(`There is no starter called ${key}.`);
    return def;
  }

  const copy = (value) => JSON.parse(JSON.stringify(value));

  function defaults(key, config) {
    return starter(key).defaults(config);
  }

  // The starter's own problems, then names that would clash with what the
  // board already has.
  function problems(key, config, answers) {
    const own = list(starter(key).problems(config, answers));
    if (own.length) return own;
    const result = starter(key).build(copy(config), copy(answers));
    const out = [];
    const taken = (items, nameOf) => new Set(list(items).filter(isObject).map(nameOf));
    const groups = taken(config.logic?.layers, (g) => String(g.name ?? ""));
    const sections = taken(config.logic?.resources, (s) => String(s.name ?? ""));
    const signals = new Set([...list(config.signals?.masts).map((m) => m.name), ...list(config.logic?.masts).filter((m) => isObject(m) && m.virtual === true).map((m) => m.name)]);
    for (const group of list(result.groups)) {
      if (!String(group.name ?? "").trim()) out.push(TEXT.noName(TEXT.group));
      else if (groups.has(group.name)) out.push(TEXT.nameTaken(TEXT.group, group.name));
    }
    for (const section of list(result.sections)) {
      if (!String(section.name ?? "").trim()) out.push(TEXT.noName(TEXT.section));
      else if (sections.has(section.name)) out.push(TEXT.nameTaken(TEXT.section, section.name));
    }
    for (const mast of list(result.virtualMasts)) {
      if (signals.has(mast.name)) out.push(TEXT.nameTaken(TEXT.signal, mast.name));
    }
    return out;
  }

  /** The Result, from copies: `config` and `answers` are not changed. */
  function build(key, config, answers) {
    return starter(key).build(copy(config), copy(answers));
  }

  /**
   * Add the starter's Result to `config`. Throws, with the first problem, when
   * it cannot be built. Masts the rules use join the Masts list with their
   * meanings prefilled. Returns the Result.
   */
  function apply(key, config, answers) {
    const found = problems(key, config, answers);
    if (found.length) throw new Error(found[0]);
    const result = build(key, config, answers);
    const logic = config.logic || (config.logic = {});
    const push = (key2, items) => {
      if (!list(items).length) return;
      if (!Array.isArray(logic[key2])) logic[key2] = [];
      logic[key2].push(...items);
    };
    push("blocks", result.blocks);
    push("masts", result.virtualMasts);
    push("resources", result.sections);
    push("layers", result.groups);
    global.EsphomeMrLogicUiMasts?.joinMasts?.(config);
    return result;
  }

  // ===== Helpers starters share =============================================

  const MEANINGS = Object.freeze(["stop", "restricting", "approach", "advance", "clear"]);

  /**
   * A mast's aspects and meanings, for prefilling answers: [{ aspect, meaning,
   * diverging }] in the mast's order. `ref` is a name on this board, or
   * { board, mast } on a linked board. A mast not yet under Masts gets the
   * meanings it would join with (CATS aspects tag themselves); a signal with
   * no lights, its own; a linked board's, what its snapshot carries.
   */
  function mastMeanings(config, ref) {
    if (isObject(ref)) {
      const board = L().linkedBoards(config).find((b) => b.name === ref.board);
      const mast = [...list(board?.signals?.masts), ...list(board?.logic?.masts)].find((m) => m.name === ref.mast);
      return list(mast?.aspects).map((aspect) => ({
        aspect,
        meaning: mast.tags?.[aspect] || "stop",
        diverging: list(mast.diverging).includes(aspect),
      }));
    }
    const entries = list(config.logic?.masts).filter(isObject);
    const real = list(config.signals?.masts).find((m) => m.name === ref);
    if (real) {
      const entry = entries.find((e) => e.virtual !== true && e.mast === ref)
        || global.EsphomeMrLogicUiMasts?.prefilledMastEntry?.(real) || {};
      return list(real.aspects).map((a) => String(a.label ?? "")).map((aspect) => ({
        aspect,
        meaning: MEANINGS.includes(entry.tags?.[aspect]) ? entry.tags[aspect] : "stop",
        diverging: list(entry.diverging).includes(aspect),
      }));
    }
    const virtual = entries.find((e) => e.virtual === true && e.name === ref);
    return list(virtual?.aspects).map(String).map((aspect) => ({
      aspect,
      meaning: MEANINGS.includes(virtual.tags?.[aspect]) ? virtual.tags[aspect] : "stop",
      diverging: list(virtual.diverging).includes(aspect),
    }));
  }

  /**
   * The aspect a mast shows for one meaning: the first with that meaning (and
   * diverging or not, when `diverging` is given), else "". For "stop", the
   * mast's stop aspect as the board picks it.
   */
  function aspectFor(config, ref, meaning, { diverging } = {}) {
    const aspects = mastMeanings(config, ref);
    const fits = (a) => a.meaning === meaning && (diverging === undefined || a.diverging === diverging);
    if (meaning === "stop") {
      const names = aspects.map((a) => a.aspect);
      const named = names.find((n) => n === "R292") || names.find((n) => n === "Stop");
      if (named) return named;
    }
    return (aspects.find(fits) || (diverging === false ? aspects.find((a) => a.meaning === meaning) : null))?.aspect || "";
  }

  // A name not in `taken`: base, then "base 2", "base 3", ...
  function freeName(base, taken) {
    const names = taken instanceof Set ? taken : new Set(taken);
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base} ${n}`)) n += 1;
    return `${base} ${n}`;
  }

  // ===== The form's dialog (browser only) ===================================

  /**
   * Open a starter's questions in a dialog. `fill(body, redraw)` draws the
   * questions into `body` (call redraw() after an answer changes what is
   * asked). On Add, `check()` returns the problems; with none, `done()` runs
   * and the dialog closes. Returns the dialog element.
   */
  function dialog({ title, intro, fill, check, done, addLabel = TEXT.add }) {
    const box = document.createElement("dialog");
    box.className = "paste-dialog starter-dialog";
    const form = document.createElement("form");
    form.method = "dialog";
    const h2 = document.createElement("h2");
    h2.textContent = title;
    form.append(h2);
    if (intro) {
      const p = document.createElement("p");
      p.className = "card-copy";
      p.textContent = intro;
      form.append(p);
    }
    const body = document.createElement("div");
    body.className = "fields starter-fields";
    const trouble = document.createElement("div");
    trouble.className = "starter-problems";
    trouble.setAttribute("aria-live", "polite");
    const redraw = () => {
      body.replaceChildren();
      fill(body, redraw);
    };
    redraw();
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "submit";
    cancel.value = "cancel";
    cancel.textContent = TEXT.cancel;
    const add = document.createElement("button");
    add.type = "button";
    add.className = "primary";
    add.textContent = addLabel;
    add.addEventListener("click", () => {
      const found = list(check());
      trouble.replaceChildren();
      if (found.length) {
        const lead = document.createElement("p");
        lead.textContent = TEXT.fixFirst;
        const ul = document.createElement("ul");
        for (const text of found) {
          const li = document.createElement("li");
          li.textContent = text;
          ul.append(li);
        }
        trouble.append(lead, ul);
        return;
      }
      done();
      box.close();
    });
    actions.append(cancel, add);
    form.append(body, trouble, actions);
    box.append(form);
    box.addEventListener("close", () => box.remove());
    document.body.append(box);
    if (typeof box.showModal === "function") box.showModal();
    else box.setAttribute("open", "");
    return box;
  }

  global.EsphomeMrLogicStarters = {
    TEXT, MEANINGS,
    defineStarter, defaults, problems, build, apply,
    mastMeanings, aspectFor, freeName, dialog,
    keys: () => [...starters.keys()],
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
