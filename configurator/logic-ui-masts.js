// The Logic page: Masts (logic-masts, order 50) and Buttons (logic-buttons, order 60).
// Work item 2.7a.
// Loaded after logic-ui.js, which draws the page; this file registers its
// parts with EsphomeMrLogicUi.registerPart. Every word it shows is in its
// TEXT, which test/logic-page.test.js lints for spec-only terms.
//
// What the parts store (docs/field-logic-spec.md, Stored format):
//   logic.masts:   { mast, tags, diverging, stopAspect, approachLight } for a
//                  mast on the Signal Masts page, or { virtual: true, name,
//                  topic, aspects, tags, diverging, stopAspect } for a signal
//                  with no lights. Tags are keyed by aspect label; missing
//                  means stop.
//   logic.buttons: { name, pin } on an ESP pin, or { name, expander, pin }
//                  on an expander pin (0-15, shown A0-B7).
// The logic (what is listed, prefilling, renames, pin choices, Explain) is in
// the pure functions below, which test/logic-masts.test.js checks without a
// DOM. The render functions at the end only draw them.
(function (global) {
  const TEXT = Object.freeze({
    mastsCard: "Masts",
    mastsIntro: "Each signal that logic sets or reads, and what each of its aspects means. A signal joins this list when a rule first uses it. CATS aspects come with their meaning filled in; check the others.",
    mastsEmpty: "No signals yet. A signal shows up here when a rule sets it or reads it.",
    setByLogic: "Set by logic",
    setByLogicHint: "This signal is decided by this board, not by JMRI.",
    readOnly: "Rules read this signal. JMRI or CATS still sets it.",
    notOnPage: "This signal is not on the Signal Masts page. Add it there, or remove it here.",
    notUsed: "No rule uses this signal now. Remove it, or keep it for a rule you will add.",
    aspectsLabel: "Aspects",
    aspectsHint: "Meaning is what the aspect tells the driver. Diverging route: the train takes the turnout, at reduced speed. An aspect left at Stop is treated as Stop.",
    meanings: Object.freeze({
      stop: "Stop",
      restricting: "Restricting",
      approach: "Approach",
      advance: "Advance Approach",
      clear: "Clear",
    }),
    meaningFor: (aspect) => `Meaning of ${aspect}`,
    divergingLabel: "Diverging route",
    divergingFor: (aspect) => `${aspect}: diverging route`,
    noAspects: "This signal has no aspects yet. Add them on the Signal Masts page.",
    goneAspect: (aspect) => `${aspect}: not on this signal any more`,
    stopLabel: "At stop and at start-up",
    stopHint: "What this signal shows when the rules say Stop, and from power-on.",
    stopDefault: (aspect) => (aspect ? `Automatic (${aspect})` : "Automatic"),
    aspectMissing: (aspect) => `${aspect} (not found)`,
    approachLabel: "Approach lighting",
    approachHint: "Dark unless a train is in the block you pick. Leave it on Always lit to keep the signal lit.",
    alwaysLit: "Always lit",
    explain: "Explain",
    explainHide: "Hide",
    explainTitle: "What this signal shows",
    explainNone: "No rule sets this signal yet.",
    virtualTitle: "Signals with no lights",
    virtualIntro: "A pretend signal, so the signals behind it still work. It has aspects and meanings but no lamps. It never shows on the Signal Masts page or in JMRI, and a rule must set it.",
    virtualEmpty: "No signals with no lights.",
    addVirtual: "Add a signal with no lights",
    newVirtualName: (n) => `Signal ${n}`,
    newVirtualAspects: Object.freeze(["Stop", "Approach", "Clear"]),
    unnamed: "No name yet",
    virtualNotSet: "No rule sets this signal yet, so it would always show Stop. Add a rule that sets it, or remove it.",
    nameLabel: "Name",
    virtualNameHint: "Name in rules and the logs. The topic is filled in from this.",
    topicLabel: "MQTT topic",
    topicHint: "Other boards read what this signal shows from this topic, with /State on the end.",
    aspectNameFor: (n) => `Name of aspect ${n}`,
    addAspect: "Add an aspect",
    newAspectName: (n) => `Aspect ${n}`,
    remove: "Remove",
    buttonsCard: "Buttons",
    buttonsIntro: "Push buttons that rules use, such as a Depart button on the fascia. Wire each one between its pin and GND, like a turnout's button.",
    buttonsEmpty: "No buttons yet.",
    addButton: "Add a button",
    newButtonName: (n) => `Button ${n}`,
    buttonNameHint: "Name in rules and the logs.",
    buttonPinLabel: "Pin",
    buttonPinHint: "An ESP pin with a pull-up, or a pin on an expander (MCP23017).",
    pickPin: "Pick a pin",
    expanderPin: (expander, pin) => `${expander} · ${pin}`,
    noPinsLeft: "No free pins. Add an expander (MCP23017) on the Sensors page for 16 more.",
  });

  const M = () => global.EsphomeMr;
  const L = () => global.EsphomeMrLogicYaml;
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const label = (aspect) => String(aspect?.label ?? "");

  // ===== Masts ==============================================================

  // Masts entries for the Signal Masts page's masts (not signals with no lights).
  function realEntries(config) {
    return list(config.logic?.masts).filter((entry) => isObject(entry) && entry.virtual !== true);
  }

  function virtualEntries(config) {
    return list(config.logic?.masts).filter((entry) => isObject(entry) && entry.virtual === true);
  }

  // This board's masts that rules and sections set or read (no `board` key).
  function ruleMastNames(config) {
    const names = new Set();
    const walk = (value) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!isObject(value)) return;
      if (typeof value.mast === "string" && value.mast && value.board === undefined) names.add(value.mast);
      Object.values(value).forEach(walk);
    };
    walk([list(config.logic?.layers), list(config.logic?.resources)]);
    return names;
  }

  // Masts logic sets or reads, plus those already listed under Masts (as
  // logic-yaml.js's mastNamesUsed).
  function usedMastNames(config) {
    const names = ruleMastNames(config);
    for (const entry of realEntries(config)) if (typeof entry.mast === "string") names.add(entry.mast);
    return names;
  }

  /**
   * A new Masts entry for a Signal Masts page mast, with each aspect's meaning
   * and diverging route filled in from its JMRI aspect: a CATS aspect tags
   * itself, any other starts as stop.
   */
  function prefilledMastEntry(mast) {
    const tags = {};
    const diverging = [];
    for (const aspect of list(mast?.aspects)) {
      const name = label(aspect);
      if (!name || Object.hasOwn(tags, name)) continue;
      const jmri = L().aspectName(aspect);
      tags[name] = M().catsAspectTag(jmri);
      if (M().catsAspectDiverging(jmri)) diverging.push(name);
    }
    const entry = { mast: String(mast?.name ?? ""), tags };
    if (diverging.length) entry.diverging = diverging;
    return entry;
  }

  /**
   * A mast joins Masts when a rule or starter first uses it (spec, The Logic
   * page): give each Signal Masts page mast in `names` (default: every mast
   * logic sets or reads) an entry with its meanings prefilled, unless it has
   * one. Masts not on the Signal Masts page are skipped. Changes config;
   * returns the names added, so the caller knows whether to persist.
   */
  function joinMasts(config, names = usedMastNames(config)) {
    const have = new Set(realEntries(config).map((entry) => entry.mast));
    const added = [];
    for (const name of names) {
      if (typeof name !== "string" || !name || have.has(name)) continue;
      const mast = (config.signals?.masts || []).find((m) => m.name === name);
      if (!mast) continue;
      const logic = config.logic || (config.logic = {});
      if (!Array.isArray(logic.masts)) logic.masts = [];
      logic.masts.push(prefilledMastEntry(mast));
      have.add(name);
      added.push(name);
    }
    return added;
  }

  /**
   * What the Masts list shows for the Signal Masts page's masts, in that
   * page's order, then entries whose mast is gone: [{ name, entry, onPage,
   * used (a rule uses it), sets (a rule sets it), aspects (labels), jmri
   * (each aspect's JMRI name) }].
   */
  function mastRows(config) {
    const rules = ruleMastNames(config);
    const sets = L().fieldMastNames(config);
    const entries = realEntries(config);
    const rows = [];
    const seen = new Set();
    for (const mast of config.signals?.masts || []) {
      const name = String(mast.name ?? "");
      const entry = entries.find((e) => e.mast === name);
      if (seen.has(name) || (!entry && !rules.has(name))) continue;
      seen.add(name);
      rows.push({
        name, entry, onPage: true, used: rules.has(name), sets: sets.has(name),
        aspects: list(mast.aspects).map(label), jmri: list(mast.aspects).map((a) => L().aspectName(a)),
      });
    }
    for (const entry of entries) {
      const name = String(entry.mast ?? "");
      if (seen.has(name)) continue;
      seen.add(name);
      rows.push({ name, entry, onPage: false, used: rules.has(name), sets: sets.has(name), aspects: [], jmri: [] });
    }
    return rows;
  }

  // An aspect's meaning: as set, else stop.
  function meaningOf(entry, aspect) {
    const tag = isObject(entry?.tags) && Object.hasOwn(entry.tags, aspect) ? entry.tags[aspect] : undefined;
    return M().ASPECT_TAGS.includes(tag) ? tag : "stop";
  }

  function setMeaning(entry, aspect, tag) {
    if (!M().ASPECT_TAGS.includes(tag)) return;
    if (!isObject(entry.tags)) entry.tags = {};
    entry.tags[aspect] = tag;
  }

  function isDiverging(entry, aspect) {
    return list(entry?.diverging).includes(aspect);
  }

  function setDiverging(entry, aspect, on) {
    const now = list(entry.diverging).filter((name) => name !== aspect);
    if (on) now.push(aspect);
    if (now.length) entry.diverging = now;
    else delete entry.diverging;
  }

  function setStopAspect(entry, aspect) {
    if (typeof aspect === "string" && aspect) entry.stopAspect = aspect;
    else delete entry.stopAspect;
  }

  function setApproachLight(entry, block) {
    if (typeof block === "string" && block) entry.approachLight = block;
    else delete entry.approachLight;
  }

  /**
   * The stop aspect when none is chosen, as the rule table works it out: the
   * aspect named (or with the JMRI aspect) R292 or Stop that means stop, else
   * the first that means stop, else the first.
   */
  function defaultStopAspect(names, entry, jmriNames = []) {
    for (const held of ["R292", "Stop"]) {
      const at = names.findIndex((name, i) => (name === held || jmriNames[i] === held) && meaningOf(entry, name) === "stop");
      if (at >= 0) return names[at];
    }
    return names.find((name) => meaningOf(entry, name) === "stop") || names[0] || "";
  }

  // The "At stop and at start-up" choices: Automatic (with what that picks),
  // then each aspect. A chosen aspect that is gone stays, marked not found.
  function stopChoices(names, entry, jmriNames = []) {
    const choices = [{ value: "", label: TEXT.stopDefault(defaultStopAspect(names, entry, jmriNames)) }];
    for (const name of new Set(names)) if (name) choices.push({ value: name, label: name });
    const chosen = typeof entry?.stopAspect === "string" ? entry.stopAspect : "";
    if (chosen && !names.includes(chosen)) choices.push({ value: chosen, label: TEXT.aspectMissing(chosen) });
    return choices;
  }

  // Aspects given a meaning, a diverging tick or the stop choice that the
  // mast no longer has.
  function staleAspects(entry, names) {
    const named = [
      ...Object.keys(isObject(entry?.tags) ? entry.tags : {}),
      ...list(entry?.diverging).map(String),
      ...(typeof entry?.stopAspect === "string" && entry.stopAspect ? [entry.stopAspect] : []),
    ];
    return [...new Set(named.filter((name) => !names.includes(name)))];
  }

  // Forget everything Masts says about one aspect.
  function dropAspect(entry, aspect) {
    if (isObject(entry.tags)) delete entry.tags[aspect];
    setDiverging(entry, aspect, false);
    if (entry.stopAspect === aspect) delete entry.stopAspect;
  }

  function removeMastEntry(config, entry) {
    const masts = list(config.logic?.masts);
    const at = masts.indexOf(entry);
    if (at >= 0) masts.splice(at, 1);
  }

  /**
   * Explain this signal: one sentence per aspect, from the rules, as the
   * engine works it out (logic.js explainMast over the rule table). Empty when
   * the board has no Field Logic or no rule sets the mast.
   */
  function explainSentences(config, name) {
    let table = null;
    try {
      table = L().logicTable(config);
    } catch {
      return [];
    }
    if (!table || !isObject(table.masts) || !Object.hasOwn(table.masts, name)) return [];
    try {
      return [...global.EsphomeMrLogic.explainMast(table, name)];
    } catch {
      return [];
    }
  }

  // ----- Signals with no lights ---------------------------------------------

  function allMastNames(config, except) {
    return new Set([
      ...(config.signals?.masts || []).map((m) => String(m.name ?? "")),
      ...virtualEntries(config).filter((entry) => entry !== except).map((entry) => String(entry.name ?? "")),
    ]);
  }

  // A new signal with no lights, named so it clashes with no mast, with
  // Stop, Approach and Clear. Returns the entry.
  function addVirtualMast(config) {
    const logic = config.logic || (config.logic = {});
    if (!Array.isArray(logic.masts)) logic.masts = [];
    const taken = allMastNames(config);
    let n = virtualEntries(config).length + 1;
    while (taken.has(TEXT.newVirtualName(n))) n += 1;
    const name = TEXT.newVirtualName(n);
    const aspects = [...TEXT.newVirtualAspects];
    const tags = {};
    aspects.forEach((aspect, i) => { tags[aspect] = ["stop", "approach", "clear"][i]; });
    const entry = { virtual: true, name, topic: M().topicFor("signal", name), aspects, tags };
    logic.masts.push(entry);
    return entry;
  }

  // Name a signal with no lights. The topic follows the name unless it was
  // edited away from it, as a block's does. True when the topic changed.
  function setVirtualName(entry, name) {
    const { topicFor } = M();
    const follows = !entry.topic || entry.topic === topicFor("signal", entry.name);
    entry.name = name;
    if (!follows) return false;
    entry.topic = topicFor("signal", name);
    return true;
  }

  // Point rules at a renamed signal with no lights, once the name is
  // finished. Not when another mast has the old or the new name: those
  // references may be its. Returns how many were renamed.
  function renameVirtualMast(config, entry, from, to) {
    if (typeof from !== "string" || typeof to !== "string" || !from || !to.trim() || from === to) return 0;
    const others = allMastNames(config, entry);
    if (others.has(from) || others.has(to)) return 0;
    return L().renameReferences(config, "mast", from, to);
  }

  // Add an aspect to a signal with no lights, meaning Stop. Returns its name.
  function addVirtualAspect(entry) {
    if (!Array.isArray(entry.aspects)) entry.aspects = [];
    const taken = new Set(entry.aspects.map(String));
    let n = entry.aspects.length + 1;
    while (taken.has(TEXT.newAspectName(n))) n += 1;
    const name = TEXT.newAspectName(n);
    entry.aspects.push(name);
    setMeaning(entry, name, "stop");
    return name;
  }

  /**
   * Rename aspect `index` of a signal with no lights. Its meaning, diverging
   * tick and stop choice move with it, and so do the rules that show it on
   * this signal. Not when another of its aspects has the old or the new name,
   * or the new name is blank: then only the name changes. True when moved.
   */
  function renameVirtualAspect(config, entry, index, to) {
    if (!Array.isArray(entry.aspects) || index < 0 || index >= entry.aspects.length) return false;
    const from = String(entry.aspects[index]);
    entry.aspects[index] = to;
    if (from === to) return false;
    const others = entry.aspects.filter((_, i) => i !== index).map(String);
    if (!String(to).trim() || others.includes(from) || others.includes(to)) return false;
    if (isObject(entry.tags) && Object.hasOwn(entry.tags, from)) {
      entry.tags[to] = entry.tags[from];
      delete entry.tags[from];
    }
    if (Array.isArray(entry.diverging)) entry.diverging = entry.diverging.map((name) => (name === from ? to : name));
    if (entry.stopAspect === from) entry.stopAspect = to;
    for (const layer of list(config.logic?.layers)) {
      for (const rule of list(layer?.rules)) {
        const then = rule?.then;
        if (isObject(then) && then.board === undefined && then.mast === entry.name && then.aspect === from) then.aspect = to;
      }
    }
    return true;
  }

  // Remove aspect `index`, and what Masts says about it unless another
  // aspect has the same name. Rules that show it are left to validation.
  function removeVirtualAspect(entry, index) {
    if (!Array.isArray(entry.aspects) || index < 0 || index >= entry.aspects.length) return;
    const [name] = entry.aspects.splice(index, 1);
    if (!entry.aspects.includes(name)) dropAspect(entry, String(name));
  }

  // ===== Buttons ============================================================

  const onExpander = (button) => typeof button?.expander === "string" && button.expander !== "";

  function buttonsOf(config) {
    return list(config.logic?.buttons).filter(isObject);
  }

  // ESP pins other things on this board use (as app.js's usedPins), plus the
  // other rule buttons' pins.
  function usedEspPins(config, except) {
    const used = new Set();
    const add = (pin) => { if (pin) used.add(String(pin).toUpperCase()); };
    for (const block of config.blocks || []) if (!block.expander) add(block.gpio);
    for (const bus of M().i2cBuses(config)) {
      add(bus.sda);
      add(bus.scl);
    }
    for (const point of config.points || []) {
      if (config.pca9685 === false) add(point.servoPin);
      for (const control of point.controls || []) {
        add(control.buttonPin);
        add(control.closedLight);
        add(control.openLight);
      }
    }
    for (const mast of config.signals?.masts || []) {
      const gpio = mast.mode === "gpio" || (mast.mode !== "addressable" && config.signals?.mode === "gpio");
      if (gpio) for (const lamp of mast.lamps || []) add(lamp.pin);
      else add(mast.pin || config.signals?.pin);
    }
    for (const button of buttonsOf(config)) if (button !== except && !onExpander(button)) add(button.pin);
    // Plant ends: their Pair and LED pins.
    for (const pin of L().endPins(config)) if (pin.expander === undefined) add(pin.pin);
    return used;
  }

  // Expander pins in use, as "<expander>\0<pin>": sensors and other buttons.
  function usedExpanderPins(config, except) {
    const used = new Set();
    for (const block of config.blocks || []) if (block.expander) used.add(`${block.expander}\u0000${Number(block.pin)}`);
    for (const button of buttonsOf(config)) if (button !== except && onExpander(button)) used.add(`${button.expander}\u0000${Number(button.pin)}`);
    for (const pin of L().endPins(config)) if (pin.expander !== undefined) used.add(`${pin.expander}\u0000${Number(pin.pin)}`);
    return used;
  }

  // A new button's pin: a free ESP pin with a pull-up (not a strapping pin),
  // then a free expander pin, else none.
  function nextButtonPin(config) {
    const used = usedEspPins(config);
    const esp = M().PULLUP_PINS.find((pin) => !M().STRAPPING_PINS.has(pin) && !used.has(pin));
    if (esp) return { pin: esp };
    const usedExp = usedExpanderPins(config);
    for (const expander of config.expanders || []) {
      for (let pin = 0; pin < 16; pin += 1) {
        if (!usedExp.has(`${expander.name}\u0000${pin}`)) return { expander: expander.name, pin };
      }
    }
    return { pin: "" };
  }

  // A new button with a free name and pin. Returns it.
  function addButton(config) {
    const logic = config.logic || (config.logic = {});
    if (!Array.isArray(logic.buttons)) logic.buttons = [];
    const taken = new Set(buttonsOf(config).map((b) => String(b.name ?? "")));
    let n = logic.buttons.length + 1;
    while (taken.has(TEXT.newButtonName(n))) n += 1;
    const button = { name: TEXT.newButtonName(n), ...nextButtonPin(config) };
    logic.buttons.push(button);
    return button;
  }

  // The pin select's value: the ESP pin, "mcp:<expander index>:<pin>", or ""
  // when the button's expander or pin is gone.
  function buttonPinValue(config, button) {
    if (!onExpander(button)) return String(button.pin || "").toUpperCase();
    const at = (config.expanders || []).findIndex((expander) => expander.name === button.expander);
    const pin = Number(button.pin);
    return at >= 0 && Number.isInteger(pin) && pin >= 0 && pin < 16 ? `mcp:${at}:${pin}` : "";
  }

  function setButtonPin(config, button, value) {
    const match = /^mcp:(\d+):(\d+)$/.exec(String(value));
    const expander = match && (config.expanders || [])[Number(match[1])];
    if (expander) {
      button.expander = expander.name;
      button.pin = Number(match[2]);
    } else {
      delete button.expander;
      button.pin = String(value || "");
    }
  }

  /**
   * A button's pin choices, [{ value, label, disabled? }]: the free ESP pins
   * from `espChoices` (the pull-up pins), then every free expander pin, as a
   * sensor's pin list offers them. Its own pin is always there.
   */
  function buttonPinChoices(config, button, espChoices = M().PULLUP_PINS.map((pin) => ({ value: pin, label: pin }))) {
    const used = usedEspPins(config, button);
    const own = onExpander(button) ? "" : String(button.pin || "").toUpperCase();
    const choices = list(espChoices).filter((c) => c.value === own || !used.has(c.value)).map((c) => ({ value: c.value, label: c.label }));
    if (own && !choices.some((c) => c.value === own)) choices.push({ value: own, label: own });
    const usedExp = usedExpanderPins(config, button);
    (config.expanders || []).forEach((expander, i) => {
      for (let pin = 0; pin < 16; pin += 1) {
        if (usedExp.has(`${expander.name}\u0000${pin}`)) continue;
        choices.push({ value: `mcp:${i}:${pin}`, label: TEXT.expanderPin(expander.name, M().expanderPinLabel(pin)) });
      }
    });
    if (!buttonPinValue(config, button)) choices.unshift({ value: "", label: TEXT.pickPin, disabled: true });
    return choices;
  }

  // Point rules at a renamed button, once the name is finished. Not when
  // another button has the old or the new name. Returns how many changed.
  function renameButtonRefs(config, from, to) {
    if (typeof from !== "string" || typeof to !== "string" || !from || !to.trim() || from === to) return 0;
    const names = buttonsOf(config).map((b) => b.name);
    if (names.includes(from) || names.filter((name) => name === to).length > 1) return 0;
    let count = 0;
    const walk = (value) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!isObject(value)) return;
      if (value.button === from && value.board === undefined) {
        value.button = to;
        count += 1;
      }
      Object.values(value).forEach(walk);
    };
    for (const [key, value] of Object.entries(config.logic || {})) if (key !== "remoteBoards" && key !== "buttons") walk(value);
    return count;
  }

  global.EsphomeMrLogicUiMasts = {
    TEXT,
    ruleMastNames,
    usedMastNames,
    prefilledMastEntry,
    joinMasts,
    mastRows,
    meaningOf,
    setMeaning,
    isDiverging,
    setDiverging,
    setStopAspect,
    setApproachLight,
    defaultStopAspect,
    stopChoices,
    staleAspects,
    dropAspect,
    removeMastEntry,
    explainSentences,
    addVirtualMast,
    setVirtualName,
    renameVirtualMast,
    addVirtualAspect,
    renameVirtualAspect,
    removeVirtualAspect,
    usedEspPins,
    usedExpanderPins,
    nextButtonPin,
    addButton,
    buttonPinValue,
    setButtonPin,
    buttonPinChoices,
    renameButtonRefs,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
