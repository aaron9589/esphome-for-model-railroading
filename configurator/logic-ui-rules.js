// The Logic page: Sections (logic-sections, order 70) and Groups with the
// rule-card editor (logic-groups, order 80). Work item 2.7b.
// Loaded after logic-ui.js, which draws the page; this file registers its
// parts with EsphomeMrLogicUi.registerPart. Every word it shows is in its
// TEXT, which test/logic-page.test.js lints for spec-only terms.
//
// The editing is done by the pure functions at the top (no DOM), which
// test/logic-rules.test.js checks; the drawing below them stays thin. They
// keep rules in the stored shapes of test/cases/README.md, "Rules".
//   - Functions on one condition (a state or a moment) return a new one.
//   - Functions on a rule, group, section or config change it in place.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const andList = (names) => {
    const words = [].concat(names).map(String);
    return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
  };
  const capital = (text) => String(text).charAt(0).toUpperCase() + String(text).slice(1);

  const TEXT = Object.freeze({
    // Sections
    sectionsCard: "Sections",
    sectionsIntro: "A section is track only one train may use at a time, such as a single-line bridge. A rule takes the section before its signal clears, and the section is freed once the train has gone through.",
    sectionsEmpty: "No sections yet.",
    addSection: "Add a section",
    newSectionName: (n) => `Section ${n}`,
    sectionNameLabel: "Name",
    sectionNameHint: "Rules take the section by this name.",
    sectionBlocksLabel: "Blocks in this section",
    sectionBlocksEmpty: "No blocks yet. Add the blocks only one train may be in at a time.",
    addSectionBlock: "Add a block…",
    noBlocksYet: "Add blocks above, or sensors on the Sensors page, or link a board, then pick them here.",
    releaseLabel: "Free the section when…",
    releaseSentence: (words) => `Free the section when ${words}.`,
    releaseEmpty: "Add the section's blocks: it is freed once they are all clear for 3 seconds.",
    releaseUseDefault: "Use: all its blocks clear for 3 seconds",
    releaseKindLabel: "Free it",
    releaseKinds: Object.freeze({
      while: "While something is so",
      when: "After things happen, in order",
    }),
    holdLabel: "Hold after cancelling",
    holdHint: "Keep the section for a while if a signal drops in front of a train. Railways call this approach locking.",
    // Groups and rules
    groupsCard: "Groups",
    groupsIntro: "A rule is one sentence: when this happens, show that. A group is rules that work together, such as one starter.",
    groupsIntro2: "Order matters: in each group, the first rule that applies sets its signal. When groups disagree about a signal, it shows the most cautious answer.",
    groupsEmpty: "No groups yet. Add a group to write your first rule.",
    addGroup: "Add a group",
    newGroupName: (n) => `Group ${n}`,
    groupNameLabel: "Group name",
    groupNameHint: "Shown in the logs and in what each signal is explained with.",
    rulesEmpty: "No rules in this group yet.",
    addRule: "Add a rule",
    ruleTitle: (n) => `Rule ${n}`,
    moveUp: "Up",
    moveDown: "Down",
    moveUpHint: "Earlier rules win: move this rule up.",
    moveDownHint: "Move this rule down.",
    // A rule card's parts
    whenPart: "When",
    onlyIfPart: "Only if",
    thenPart: "Then",
    kindLabel: "When or while",
    kinds: Object.freeze({
      while: "While",
      when: "When",
    }),
    kindHint: "While: for as long as something is so. When: the moment something happens.",
    checksEmpty: "Nothing else: the rule needs only its When.",
    addCheck: "Add a check",
    signalLabel: "Signal",
    noSignal: "No signal",
    aspectLabel: "Shows",
    pickAspect: "Pick an aspect…",
    sectionLabel: "Take the section",
    noSection: "No section",
    sectionHint: "The signal clears only when the section is free, and holds it until the train has gone through.",
    noSectionsYet: "Add a section under Sections to take one here.",
    locksLabel: "Lock turnouts",
    locksHint: "Locked turnouts ignore buttons and JMRI while this rule applies.",
    moreOptions: "More options",
    forLabel: "For",
    forHint: "How long it must hold before the rule asks, and stop holding before the request is dropped. Stops a flicker from a detector counting.",
    releaseForHint: "How long it must hold before the section is freed.",
    atOnce: "At once",
    off: "Off",
    leavingLabel: "Trains also leave through here",
    leavingHint: "A train that arrives while the section is taken is leaving, so it cannot ask for the section until this block has been clear once.",
    followedByLabel: "Then, in order",
    followedByHint: "Moments that must follow the first one, in this order.",
    addMoment: "Add what happens next",
    cancelLabel: "Cancel when…",
    cancelHint: "What drops the request if the train does not come. Without one, only getting the signal ends it.",
    cancelWhileHint: "A rule that runs while something is so cancels itself when it stops being so.",
    // Conditions
    itemLabel: "What",
    pickItem: "Pick…",
    isLabel: "Is",
    kindGroups: Object.freeze({
      block: "Blocks and sensors",
      turnout: "Turnouts",
      mast: "Signals",
      button: "Buttons",
    }),
    fromBoard: (kind, board) => `${kind} on ${board}`,
    isWords: Object.freeze({
      occupied: "occupied", clear: "clear", closed: "closed", thrown: "thrown", pressed: "pressed",
    }),
    becomesWords: Object.freeze({
      occupied: "becomes occupied", clear: "becomes clear", closed: "becomes closed", thrown: "becomes thrown", pressed: "is pressed",
    }),
    shows: "shows",
    meanings: Object.freeze({
      stop: "Stop", restricting: "Restricting", approach: "Approach", advance: "Advance Approach", clear: "Clear",
    }),
    diverging: "Diverging route",
    meaningHint: "Tick one meaning or several. Diverging route: the train takes the turnout, at reduced speed.",
    combineLabel: "Combine…",
    combine: Object.freeze({
      all: "All of",
      any: "Any of",
      not: "Not",
    }),
    combineHint: (how) => (how === "any" ? "At least one of these" : "Every one of these"),
    addBranch: "Add another",
    dropNot: "Remove Not",
    // Sentences
    sentence: (actions, when) => `${capital(andList(actions))} when ${when}.`,
    saysShows: (mast, aspect) => `${mast} shows ${aspect}`,
    saysLocks: (names) => `${andList(names)} ${[].concat(names).length === 1 ? "stays" : "stay"} locked`,
    saysTakes: (section) => `the ${section} section is taken`,
    sentenceNoThen: "This rule does nothing yet: pick a signal, a section or turnouts under Then.",
    sentenceUnfinished: "Fill in each empty choice to read this rule as a sentence.",
    halfSecond: "half a second",
    seconds: (n) => (n === 1 ? "1 second" : `${n} seconds`),
    minutes: (n) => (n === 1 ? "1 minute" : `${n} minutes`),
  });

  const MEANINGS = Object.freeze(["stop", "restricting", "approach", "advance", "clear"]);
  const LEAF_KINDS = Object.freeze(["block", "sensor", "turnout", "mast", "button", "end"]);
  const IS_WORDS = Object.freeze({
    block: ["occupied", "clear"],
    sensor: ["occupied", "clear"],
    turnout: ["closed", "thrown"],
    button: ["pressed"],
  });
  // Times offered for "for" and "Hold after cancelling".
  const TIMES = Object.freeze(["0.5s", "1s", "2s", "3s", "5s", "10s", "20s", "30s", "60s"]);
  const DEFAULT_RELEASE_FOR = "3s";

  // ===== Conditions (states and moments) ====================================

  function blankCondition() {
    return { block: "", is: "occupied" };
  }

  /** "all", "any", "not", a leaf's kind ("block", "turnout", ...), or "". */
  function conditionKind(cond) {
    if (!isObject(cond)) return "";
    if (Array.isArray(cond.all)) return "all";
    if (Array.isArray(cond.any)) return "any";
    if (cond.not !== undefined) return "not";
    return LEAF_KINDS.find((kind) => cond[kind] !== undefined) || "";
  }

  const isLeaf = (cond) => !["all", "any", "not", ""].includes(conditionKind(cond));

  /**
   * The item a leaf names, as the condition item dropdown's values have it:
   * { block | turnout | mast | button: name } on this board, or
   * { board, sensor | block | turnout | mast: name }. A sensor on this board
   * is offered as a block (a block of one).
   */
  function conditionRef(cond) {
    const kind = conditionKind(cond);
    if (!isLeaf(cond)) return "";
    if (cond.board !== undefined) return { board: cond.board, [kind]: cond[kind] };
    if (kind === "end") return { end: cond.end, track: cond.track, hears: cond.hears };
    return { [kind === "sensor" ? "block" : kind]: cond[kind] };
  }

  const refKind = (ref) => (isObject(ref) ? LEAF_KINDS.find((kind) => ref[kind] !== undefined) || "" : "");
  const family = (kind) => (kind === "sensor" ? "block" : kind);

  /**
   * Every item a condition can read, grouped by kind and board, as
   * EsphomeMrLogicUi.selectEl takes them. Values are conditionRef shapes.
   */
  function conditionItemChoices(config) {
    const ui = global.EsphomeMrLogicUi;
    const groups = [];
    for (const kind of ["block", "turnout", "mast", "button", "end"]) {
      if (kind === "end") {
        // What an end of this board hears: values are { end, track, hears }.
        groups.push(...ui.itemChoices(config, "end"));
        continue;
      }
      for (const group of ui.itemChoices(config, kind, { remote: kind !== "button" })) {
        const own = group.options.length && typeof group.options[0].value === "string";
        groups.push({
          label: own ? TEXT.kindGroups[kind] : TEXT.fromBoard(TEXT.kindGroups[kind], group.label),
          options: group.options.map((option) => ({ value: own ? { [kind]: option.value } : option.value, text: option.text })),
        });
      }
    }
    return groups;
  }

  /** What a leaf of this kind can be: its `is` words, or meanings for a mast. */
  function isWords(kind) {
    if (kind === "mast") return [...MEANINGS, "diverging"];
    return [...(IS_WORDS[kind] || [])];
  }

  /** The `is` words for one leaf: what an end hears has a block's or a signal's (no diverging). */
  function isWordsOf(leaf) {
    const kind = conditionKind(leaf);
    if (kind === "end") return leaf.hears === "mast" ? [...MEANINGS] : [...IS_WORDS.block];
    return isWords(kind);
  }

  /** A leaf on a newly picked item, keeping `is` when the new item can have it. */
  function setConditionItem(cond, ref) {
    const kind = refKind(ref);
    if (!kind) return { block: "", is: isObject(cond) && IS_WORDS.block.includes(cond.is) ? cond.is : "occupied" };
    const before = conditionKind(cond);
    const out = { ...ref };
    if (kind === "end") {
      // Keep `is` when it still means something for what this end track hears.
      const words = isWordsOf(out);
      const kept = isObject(cond) ? [].concat(cond.is ?? []) : [];
      out.is = before === "end" && cond.hears === ref.hears && kept.length && kept.every((w) => words.includes(w))
        ? cond.is
        : (ref.hears === "mast" ? "clear" : "occupied");
      return out;
    }
    if (before && family(before) === family(kind) && cond.is !== undefined) out.is = cond.is;
    else out.is = kind === "mast" ? "clear" : IS_WORDS[kind][0];
    return out;
  }

  function setConditionIs(cond, is) {
    return { ...cond, is };
  }

  /** A mast condition's meanings, as a list ("diverging" alone, or tags in order). */
  function meaningsOf(cond) {
    if (!isObject(cond)) return [];
    return [].concat(cond.is ?? []).filter((word) => word === "diverging" || MEANINGS.includes(word));
  }

  /**
   * Tick or untick one meaning on a mast condition. Diverging route stands
   * alone; meanings are kept in order, one as a word, several as a list. The
   * last one cannot be unticked.
   */
  function toggleMeaning(cond, word, on) {
    let words = meaningsOf(cond).filter((w) => w !== "diverging");
    if (word === "diverging") {
      if (on) return { ...cond, is: "diverging" };
      return cond.is === "diverging" ? { ...cond, is: "clear" } : cond;
    }
    if (on) words = [...new Set([...words, word])];
    else words = words.filter((w) => w !== word);
    words = MEANINGS.filter((w) => words.includes(w));
    if (!words.length) return cond;
    return { ...cond, is: words.length === 1 ? words[0] : words };
  }

  /** Wrap in all of / any of (with a second, blank branch) or not. */
  function wrapCondition(cond, how) {
    if (how === "not") return { not: cond };
    if (how === "all" || how === "any") return { [how]: [cond, blankCondition()] };
    return cond;
  }

  /** Not → what it negates; all of / any of with one branch → that branch. */
  function unwrapCondition(cond) {
    const kind = conditionKind(cond);
    if (kind === "not") return cond.not;
    if ((kind === "all" || kind === "any") && cond[kind].length === 1) return cond[kind][0];
    return cond;
  }

  /** Switch all of ↔ any of, keeping the branches. */
  function setCombine(cond, how) {
    const kind = conditionKind(cond);
    if ((kind !== "all" && kind !== "any") || (how !== "all" && how !== "any")) return cond;
    return { [how]: [...cond[kind]] };
  }

  function addBranch(cond) {
    const kind = conditionKind(cond);
    if (kind !== "all" && kind !== "any") return cond;
    return { [kind]: [...cond[kind], blankCondition()] };
  }

  /** Remove one branch; a combination left with one branch becomes it. */
  function removeBranch(cond, index) {
    const kind = conditionKind(cond);
    if (kind !== "all" && kind !== "any") return cond;
    const branches = cond[kind].filter((_, i) => i !== index);
    if (branches.length === 1) return branches[0];
    return { [kind]: branches };
  }

  function setBranch(cond, index, child) {
    const kind = conditionKind(cond);
    if (kind !== "all" && kind !== "any") return cond;
    const branches = [...cond[kind]];
    branches[index] = child;
    return { [kind]: branches };
  }

  // The first leaf in a condition tree, or undefined.
  function firstLeaf(cond) {
    const kind = conditionKind(cond);
    if (kind === "all" || kind === "any") {
      for (const branch of cond[kind]) {
        const leaf = firstLeaf(branch);
        if (leaf) return leaf;
      }
      return undefined;
    }
    if (kind === "not") return firstLeaf(cond.not);
    return kind ? cond : undefined;
  }

  // Every leaf in a value (a trigger, checks, cancel, release).
  function leavesIn(value) {
    const found = [];
    const walk = (v) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (!isObject(v)) return undefined;
      if (isLeaf(v)) found.push(v);
      else Object.values(v).forEach(walk);
      return undefined;
    };
    walk(value);
    return found;
  }

  const blankLeaf = (leaf) => !String(leaf[conditionKind(leaf)] ?? "").trim();

  // ===== Triggers ===========================================================

  /** "while" or "when". */
  function triggerKind(trigger) {
    return isObject(trigger) && trigger.when !== undefined ? "when" : "while";
  }

  /**
   * Switch a rule's When between while (a state) and when (a moment), keeping
   * the item it reads. A while drops its moments and Cancel (only a when has
   * one); a when drops for and the leaving guard.
   */
  function setTriggerKind(rule, kind) {
    const trigger = isObject(rule.trigger) ? rule.trigger : {};
    if (triggerKind(trigger) === kind) return rule;
    if (kind === "when") {
      const leaf = firstLeaf(trigger.while);
      rule.trigger = { when: leaf ? { ...leaf } : blankCondition() };
    } else {
      rule.trigger = { while: isObject(trigger.when) ? trigger.when : blankCondition() };
      delete rule.cancel;
    }
    return rule;
  }

  /** Set or clear (empty) a while's for time, on a trigger or release. */
  function setFor(trigger, time) {
    if (time) trigger.for = time;
    else delete trigger.for;
    return trigger;
  }

  function setLeavingGuard(trigger, on) {
    if (on) trigger.leavingGuard = true;
    else delete trigger.leavingGuard;
    return trigger;
  }

  /** A when's following moments ("then"): add, set, remove. */
  function addThenMoment(trigger) {
    const last = [trigger.when, ...list(trigger.then)].filter(isObject).pop();
    const next = last && isLeaf(last) ? { ...last, is: IS_WORDS[conditionKind(last)]?.find((w) => w !== last.is) ?? last.is } : blankCondition();
    trigger.then = [...list(trigger.then), next];
    return trigger;
  }

  function setThenMoment(trigger, index, moment) {
    const moments = [...list(trigger.then)];
    moments[index] = moment;
    trigger.then = moments;
    return trigger;
  }

  function removeThenMoment(trigger, index) {
    const moments = list(trigger.then).filter((_, i) => i !== index);
    if (moments.length) trigger.then = moments;
    else delete trigger.then;
    return trigger;
  }

  // ===== Checks =============================================================

  function addCheck(rule) {
    rule.checks = [...list(rule.checks), blankCondition()];
    return rule;
  }

  function setCheck(rule, index, cond) {
    const checks = [...list(rule.checks)];
    checks[index] = cond;
    rule.checks = checks;
    return rule;
  }

  function removeCheck(rule, index) {
    rule.checks = list(rule.checks).filter((_, i) => i !== index);
    return rule;
  }

  // ===== Then ===============================================================

  /**
   * A mast's aspects in order, each with its meaning from Masts when it has
   * one: [{ aspect, meaning }]. A Signal Masts page mast, or a signal with
   * no lights.
   */
  function mastAspects(config, name) {
    const real = (config.signals?.masts || []).find((mast) => mast.name === name);
    const entries = list(config.logic?.masts).filter(isObject);
    const entry = real
      ? entries.find((e) => e.virtual !== true && e.mast === name)
      : entries.find((e) => e.virtual === true && e.name === name);
    const tags = isObject(entry?.tags) ? entry.tags : {};
    const names = real ? (real.aspects || []).map((aspect) => String(aspect.label ?? "")) : list(entry?.aspects).map(String);
    return [...new Set(names.filter(Boolean))].map((aspect) => ({ aspect, meaning: tags[aspect] }));
  }

  /** The aspect a rule shows when its signal is first picked: the clearest one. */
  function defaultAspect(config, name) {
    const aspects = mastAspects(config, name);
    const byMeaning = (meaning) => aspects.find((a) => a.meaning === meaning)?.aspect;
    return byMeaning("clear") || aspects.find((a) => a.aspect === "Clear")?.aspect
      || aspects.find((a) => a.meaning !== "stop" && !["Stop", "R292"].includes(a.aspect))?.aspect || "";
  }

  /**
   * A signal joins the Masts list, meanings prefilled, when a rule first uses
   * it (spec, The Logic page). Masts (logic-ui-masts.js) does the joining.
   */
  function joinMasts(config, name) {
    if (typeof name !== "string" || !name) return;
    global.EsphomeMrLogicUiMasts?.joinMasts?.(config, [name]);
  }

  /** Pick (or clear, with "") the signal a rule sets; its aspect follows. */
  function setThenMast(config, rule, name) {
    const then = isObject(rule.then) ? rule.then : (rule.then = {});
    if (!name) {
      delete then.mast;
      delete then.aspect;
      return rule;
    }
    joinMasts(config, name);
    then.mast = name;
    const have = mastAspects(config, name).map((a) => a.aspect);
    if (!have.includes(then.aspect)) {
      const aspect = defaultAspect(config, name);
      if (aspect) then.aspect = aspect;
      else delete then.aspect;
    }
    return rule;
  }

  function setThenAspect(rule, aspect) {
    const then = isObject(rule.then) ? rule.then : (rule.then = {});
    if (aspect) then.aspect = aspect;
    else delete then.aspect;
    return rule;
  }

  /** Take a section ("" for none). */
  function setThenSection(rule, name) {
    const then = isObject(rule.then) ? rule.then : (rule.then = {});
    if (name) then.reserve = name;
    else delete then.reserve;
    return rule;
  }

  /** Lock or unlock one turnout, keeping the Turnouts page's order. */
  function setThenLock(config, rule, turnout, on) {
    const then = isObject(rule.then) ? rule.then : (rule.then = {});
    const now = new Set(list(then.lock));
    if (on) now.add(turnout);
    else now.delete(turnout);
    const order = (config.points || []).map((p) => p.name);
    const locks = [...order.filter((name) => now.has(name)), ...[...now].filter((name) => !order.includes(name))];
    if (locks.length) then.lock = locks;
    else delete then.lock;
    return rule;
  }

  // ===== Cancel =============================================================

  const OPPOSITE = Object.freeze({ occupied: "clear", clear: "occupied", closed: "thrown", thrown: "closed" });

  /** A Cancel's first guess: the trigger's item the other way round (a button: pressed again). */
  function defaultCancel(trigger) {
    const leaf = firstLeaf(trigger?.when);
    if (!leaf) return { when: blankCondition() };
    const kind = conditionKind(leaf);
    if (kind === "mast") return { when: { ...leaf, is: "stop" } };
    return { when: { ...leaf, is: OPPOSITE[leaf.is] ?? leaf.is } };
  }

  /** Cancel on (a when trigger only) or off. */
  function setCancel(rule, on) {
    if (on && triggerKind(rule.trigger) === "when") rule.cancel = isObject(rule.cancel) ? rule.cancel : defaultCancel(rule.trigger);
    else delete rule.cancel;
    return rule;
  }

  // ===== Rules and groups ===================================================

  function layersOf(config) {
    const logic = global.EsphomeMrLogicUi.UI.logicOf(config);
    if (!Array.isArray(logic.layers)) logic.layers = [];
    return logic.layers;
  }

  function rulesOf(group) {
    if (!Array.isArray(group.rules)) group.rules = [];
    return group.rules;
  }

  function addRule(group) {
    rulesOf(group).push(global.EsphomeMrLogicUi.newRule());
    return group;
  }

  function removeRule(group, index) {
    rulesOf(group).splice(index, 1);
    return group;
  }

  /** Move a rule up (-1) or down (+1); order matters, the first active rule wins. */
  function moveRule(group, index, delta) {
    const rules = rulesOf(group);
    const to = index + delta;
    if (index < 0 || index >= rules.length || to < 0 || to >= rules.length) return group;
    const [rule] = rules.splice(index, 1);
    rules.splice(to, 0, rule);
    return group;
  }

  function newName(taken, make) {
    let n = taken.size + 1;
    while (taken.has(make(n))) n += 1;
    return make(n);
  }

  /** Add a group with one blank rule; returns it. */
  function addGroup(config) {
    const layers = layersOf(config);
    const taken = new Set(layers.filter(isObject).map((layer) => String(layer.name ?? "")));
    const group = global.EsphomeMrLogicUi.newGroup(newName(taken, TEXT.newGroupName));
    layers.push(group);
    return group;
  }

  function removeGroup(config, index) {
    layersOf(config).splice(index, 1);
    return config;
  }

  // ===== Sections ===========================================================

  function sectionsOf(config) {
    const logic = global.EsphomeMrLogicUi.UI.logicOf(config);
    if (!Array.isArray(logic.resources)) logic.resources = [];
    return logic.resources;
  }

  // A section member as a clear state: a name here, or { board, sensor | block }.
  function clearOf(member) {
    if (typeof member === "string") return { block: member, is: "clear" };
    const kind = refKind(member) || "block";
    return { board: member.board, [kind]: member[kind], is: "clear" };
  }

  /** "All its blocks clear for 3s": one block as itself, several under all of. */
  function defaultRelease(blocks, time = DEFAULT_RELEASE_FOR) {
    const states = list(blocks).map(clearOf);
    const release = { while: states.length === 1 ? states[0] : { all: states } };
    if (time) release.for = time;
    return release;
  }

  /** Is this release "all these blocks clear" (for any time)? */
  function isDefaultRelease(release, blocks) {
    if (!isObject(release) || release.when !== undefined || release.leavingGuard !== undefined) return false;
    const { for: _time, ...rest } = release;
    return JSON.stringify(canonical(rest)) === JSON.stringify(canonical({ while: defaultRelease(blocks, "").while }));
  }

  // Keys sorted, so two shapes compare whatever their key order.
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!isObject(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }

  /** Add a section with no blocks, freed when its blocks are clear for 3s; returns it. */
  function addSection(config) {
    const sections = sectionsOf(config);
    const taken = new Set(sections.filter(isObject).map((res) => String(res.name ?? "")));
    const section = { name: newName(taken, TEXT.newSectionName), blocks: [], release: defaultRelease([]) };
    sections.push(section);
    return section;
  }

  /** Set a section's blocks. A release that was "all its blocks clear" follows them. */
  function setSectionBlocks(section, blocks) {
    const follow = section.release === undefined || isDefaultRelease(section.release, section.blocks);
    const time = isObject(section.release) && section.release.for !== undefined ? section.release.for : DEFAULT_RELEASE_FOR;
    section.blocks = [...blocks];
    if (follow) section.release = defaultRelease(section.blocks, time);
    return section;
  }

  const memberKey = (member) => JSON.stringify(canonical(member));

  function addSectionBlock(section, member) {
    const blocks = list(section.blocks);
    if (blocks.some((other) => memberKey(other) === memberKey(member))) return section;
    return setSectionBlocks(section, [...blocks, member]);
  }

  function removeSectionBlock(section, index) {
    return setSectionBlocks(section, list(section.blocks).filter((_, i) => i !== index));
  }

  /** What a section's block list can add: block choices not already in it. */
  function sectionBlockChoices(config, section) {
    const taken = new Set(list(section.blocks).map(memberKey));
    return global.EsphomeMrLogicUi.itemChoices(config, "block", { remote: true })
      .map((group) => ({ ...group, options: group.options.filter((option) => !taken.has(memberKey(option.value))) }))
      .filter((group) => group.options.length);
  }

  /** Back to "all its blocks clear for 3s". */
  function useDefaultRelease(section) {
    section.release = defaultRelease(section.blocks);
    return section;
  }

  /** Free the section while a state holds, or after moments in order. */
  function setReleaseKind(section, kind) {
    if (triggerKind(section.release) === kind && isObject(section.release)) return section;
    if (kind === "when") {
      const first = list(section.blocks)[0];
      section.release = { when: first !== undefined ? clearOf(first) : { block: "", is: "clear" } };
    } else {
      section.release = defaultRelease(section.blocks);
    }
    return section;
  }

  /** Hold after cancelling: a time, or "" for off. */
  function setHold(section, time) {
    if (time) section.approachLock = time;
    else delete section.approachLock;
    return section;
  }

  /**
   * Rename a section and the rules that take it. The rules are left alone
   * when another section has the old or the new name: those are its rules,
   * or would become them. Returns how many rules were renamed.
   */
  function renameSection(config, section, to) {
    const from = section.name;
    section.name = to;
    if (from === to || typeof from !== "string" || !from || typeof to !== "string" || !to.trim()) return 0;
    if (sectionsOf(config).some((other) => other !== section && isObject(other) && (other.name === from || other.name === to))) return 0;
    let count = 0;
    for (const layer of layersOf(config)) {
      for (const rule of list(layer?.rules)) {
        if (isObject(rule?.then) && rule.then.reserve === from) {
          rule.then.reserve = to;
          count += 1;
        }
      }
    }
    return count;
  }

  function removeSection(config, index) {
    sectionsOf(config).splice(index, 1);
    return config;
  }

  // ===== Words ==============================================================

  /** "half a second", "3 seconds"; "" for none. */
  function sayTime(time) {
    if (time === undefined || time === null || time === "") return "";
    const value = global.EsphomeMrLogic.ms(time);
    if (Number.isNaN(value)) return String(time);
    if (value === 500) return TEXT.halfSecond;
    if (value >= 60000 && value % 60000 === 0) return TEXT.minutes(value / 60000);
    return TEXT.seconds(value / 1000);
  }

  /** The times a for or hold select offers, keeping one the file already has. */
  function timeChoices(current, noneLabel) {
    const values = [...TIMES];
    if (current && !values.includes(current)) values.push(current);
    return [{ value: "", label: noneLabel }, ...values.map((value) => ({ value, label: sayTime(value) }))];
  }

  /** A rule as one sentence, from the engine's own words (EsphomeMrLogic.explainRule). */
  function ruleSentence(rule) {
    if (!isObject(rule)) return TEXT.sentenceUnfinished;
    const trigger = isObject(rule.trigger) ? rule.trigger : {};
    const leaves = leavesIn([trigger, rule.checks, rule.cancel]);
    if ((!trigger.while && !trigger.when) || leaves.some(blankLeaf)) return TEXT.sentenceUnfinished;
    const then = isObject(rule.then) ? rule.then : {};
    const actions = [];
    if (then.mast && then.aspect) actions.push(TEXT.saysShows(then.mast, then.aspect));
    if (then.reserve && !(then.mast && then.aspect)) actions.push(TEXT.saysTakes(then.reserve));
    if (list(then.lock).length) actions.push(TEXT.saysLocks(then.lock));
    if (!actions.length) return TEXT.sentenceNoThen;
    return TEXT.sentence(actions, global.EsphomeMrLogic.explainRule(rule));
  }

  /** A section's release as one sentence. */
  function releaseSentence(section) {
    const release = section.release;
    if (!isObject(release)) return TEXT.releaseEmpty;
    const leaves = leavesIn(release);
    if (!leaves.length || leaves.some(blankLeaf)) return TEXT.releaseEmpty;
    return TEXT.releaseSentence(global.EsphomeMrLogic.explainRule({ trigger: release }));
  }

  // ===== Drawing ============================================================

  // The env each drawing function gets: config, ctx, ui, the item choices.
  function commit(env, key) {
    env.ctx.persist();
    if (key) env.ui.rerender(env.ctx, `[data-focus="${key}"]`);
    else env.ctx.render();
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(text, onClick, { className = "", key = "", title = "" } = {}) {
    const b = el("button", className, text);
    b.type = "button";
    if (key) b.dataset.focus = key;
    if (title) b.title = title;
    b.addEventListener("click", onClick);
    return b;
  }

  // A plain <select> over [{ value, label }].
  function plainSelect(options, value, onChange, { label = "", key = "" } = {}) {
    const select = el("select");
    if (label) select.setAttribute("aria-label", label);
    if (key) select.dataset.focus = key;
    for (const option of options) {
      const o = el("option", "", option.label);
      o.value = option.value;
      select.append(o);
    }
    select.value = value ?? "";
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  function itemSelect(groups, current, onChange, { prompt = TEXT.pickItem, label = TEXT.itemLabel, key = "" } = {}) {
    const select = global.EsphomeMrLogicUi.UI.selectEl(groups, current, onChange, { prompt, label });
    if (key) select.dataset.focus = key;
    return select;
  }

  // Tick boxes for a mast condition's meanings.
  function meaningPicker(cond, set, env, key, heard = false) {
    const box = el("span", "rule-meanings");
    box.title = TEXT.meaningHint;
    const chosen = meaningsOf(cond);
    // A signal an end hears is its meaning only, never a diverging route.
    for (const word of heard ? MEANINGS : [...MEANINGS, "diverging"]) {
      const label = el("label", "rule-tick");
      const input = el("input");
      input.type = "checkbox";
      input.checked = chosen.includes(word);
      input.dataset.focus = `${key}-${word}`;
      input.addEventListener("change", () => {
        set(toggleMeaning(cond, word, input.checked));
        commit(env, `${key}-${word}`);
      });
      label.append(input, ` ${word === "diverging" ? TEXT.diverging : TEXT.meanings[word]}`);
      box.append(label);
    }
    return box;
  }

  /**
   * One condition, drawn as itself: a leaf is an item and its state; all of,
   * any of and not are boxes around their branches. `set` stores a new one.
   * `moment` draws "becomes occupied"; `combine` offers all of / any of / not.
   */
  function renderCondition(cond, set, env, key, { moment = false, combine = true } = {}) {
    const kind = conditionKind(cond);
    if (kind === "all" || kind === "any") {
      const box = el("div", `rule-combo is-${kind}`);
      const head = el("div", "rule-combo-head");
      head.append(plainSelect(
        ["all", "any"].map((how) => ({ value: how, label: TEXT.combine[how] })),
        kind,
        (how) => { set(setCombine(cond, how)); commit(env, `${key}-how`); },
        { label: TEXT.combineHint(kind), key: `${key}-how` },
      ));
      head.append(el("span", "hint", TEXT.combineHint(kind)));
      box.append(head);
      cond[kind].forEach((branch, i) => {
        const row = el("div", "rule-branch");
        row.append(renderCondition(branch, (next) => set(setBranch(cond, i, next)), env, `${key}-${i}`, { moment, combine }));
        row.append(button(env.ui.TEXT.remove, () => { set(removeBranch(cond, i)); commit(env); }, { className: "remove" }));
        box.append(row);
      });
      box.append(button(TEXT.addBranch, () => { set(addBranch(cond)); commit(env, `${key}-${cond[kind].length}-item`); }, { key: `${key}-add` }));
      return box;
    }
    if (kind === "not") {
      const box = el("div", "rule-combo is-not");
      const head = el("div", "rule-combo-head");
      head.append(el("strong", "", TEXT.combine.not));
      head.append(button(TEXT.dropNot, () => { set(unwrapCondition(cond)); commit(env, `${key}-item`); }, { className: "remove", key: `${key}-drop` }));
      box.append(head, renderCondition(cond.not, (next) => set({ not: next }), env, `${key}-n`, { moment, combine }));
      return box;
    }
    const row = el("div", "rule-leaf");
    const leaf = isObject(cond) ? cond : blankCondition();
    row.append(itemSelect(env.choices, conditionRef(leaf), (ref) => {
      const next = setConditionItem(leaf, ref);
      if (refKind(ref) === "mast" && next.board === undefined) joinMasts(env.config, next.mast);
      set(next);
      commit(env, `${key}-item`);
    }, { key: `${key}-item` }));
    if (kind === "mast" || (kind === "end" && leaf.hears === "mast")) {
      row.append(el("span", "rule-word", TEXT.shows), meaningPicker(leaf, set, env, `${key}-is`, kind === "end"));
    } else if (kind) {
      const words = moment ? TEXT.becomesWords : TEXT.isWords;
      row.append(plainSelect(
        isWordsOf(leaf).map((word) => ({ value: word, label: words[word] })),
        [].concat(leaf.is)[0],
        (is) => { set(setConditionIs(leaf, is)); commit(env, `${key}-is`); },
        { label: TEXT.isLabel, key: `${key}-is` },
      ));
    }
    if (combine) {
      row.append(plainSelect(
        [{ value: "", label: TEXT.combineLabel }, ...["all", "any", "not"].map((how) => ({ value: how, label: TEXT.combine[how] }))],
        "",
        (how) => { if (how) { set(wrapCondition(leaf, how)); commit(env, `${key}-${how === "not" ? "n" : "1"}-item`); } },
        { label: TEXT.combineLabel, key: `${key}-combine` },
      ));
    }
    return row;
  }

  function part(title, hint) {
    const box = el("div", "rule-part");
    box.append(el("div", "rule-part-title", title));
    if (hint) box.append(el("span", "hint", hint));
    return box;
  }

  // A when's first moment and the ones that follow it.
  function renderMoments(trigger, env, key, holder) {
    const box = el("div", "rule-moments");
    list(trigger.then).forEach((moment, i) => {
      const row = el("div", "rule-branch");
      row.append(renderCondition(moment, (next) => setThenMoment(trigger, i, next), env, `${key}-t${i}`, { moment: true, combine: false }));
      row.append(button(env.ui.TEXT.remove, () => { removeThenMoment(trigger, i); commit(env); }, { className: "remove" }));
      box.append(row);
    });
    box.append(button(TEXT.addMoment, () => { addThenMoment(trigger); commit(env, `${key}-t${list(trigger.then).length - 1}-item`); }, { key: `${key}-addt` }));
    holder.append(box);
  }

  // Which rule cards have More options open, so a redraw keeps them open.
  const opened = new WeakSet();

  function moreOptions(owner) {
    const details = el("details", "rule-more");
    details.open = opened.has(owner);
    details.addEventListener("toggle", () => (details.open ? opened.add(owner) : opened.delete(owner)));
    details.append(el("summary", "", TEXT.moreOptions));
    return details;
  }

  function renderThen(rule, env, key) {
    const { config, ctx, ui } = env;
    const then = isObject(rule.then) ? rule.then : {};
    const box = part(TEXT.thenPart);
    const fields = el("div", "fields");

    const signalRow = el("label", "full");
    signalRow.append(el("span", "field-label", TEXT.signalLabel));
    const signalLine = el("div", "rule-signal");
    signalLine.append(itemSelect(ui.itemChoices(config, "mast"), then.mast ?? "", (name) => {
      setThenMast(config, rule, name);
      commit(env, `${key}-mast`);
    }, { prompt: TEXT.noSignal, label: TEXT.signalLabel, key: `${key}-mast` }));
    if (then.mast) {
      const aspects = mastAspects(config, then.mast).map((a) => ({ value: a.aspect, label: a.meaning ? `${a.aspect} (${TEXT.meanings[a.meaning] || a.meaning})` : a.aspect }));
      if (then.aspect && !aspects.some((a) => a.value === then.aspect)) aspects.push({ value: then.aspect, label: `${then.aspect} (${ui.TEXT.memberMissing})` });
      signalLine.append(el("span", "rule-word", TEXT.aspectLabel), plainSelect([{ value: "", label: TEXT.pickAspect }, ...aspects], then.aspect ?? "", (aspect) => {
        setThenAspect(rule, aspect);
        commit(env, `${key}-aspect`);
      }, { label: TEXT.aspectLabel, key: `${key}-aspect` }));
      const picture = then.aspect ? ctx.mastPicture?.(then.mast, then.aspect) : null;
      if (picture) signalLine.append(picture);
    }
    signalRow.append(signalLine);
    fields.append(signalRow);

    const sections = ui.itemChoices(config, "section");
    const sectionRow = el("label", "full");
    sectionRow.append(el("span", "field-label", TEXT.sectionLabel));
    if (sections.length || then.reserve) {
      sectionRow.append(itemSelect(sections, then.reserve ?? "", (name) => {
        setThenSection(rule, name);
        commit(env, `${key}-section`);
      }, { prompt: TEXT.noSection, label: TEXT.sectionLabel, key: `${key}-section` }), ctx.hintEl(TEXT.sectionHint));
    } else {
      sectionRow.append(ctx.hintEl(TEXT.noSectionsYet));
    }
    fields.append(sectionRow);

    const turnouts = ui.itemChoices(config, "turnout").flatMap((group) => group.options.map((option) => option.value));
    const locked = list(then.lock);
    const all = [...turnouts, ...locked.filter((name) => !turnouts.includes(name))];
    if (all.length) {
      const lockRow = el("div", "rule-locks full");
      lockRow.append(el("span", "field-label", TEXT.locksLabel));
      const boxes = el("div", "rule-lock-boxes");
      for (const name of all) {
        const label = el("label", "rule-tick");
        const input = el("input");
        input.type = "checkbox";
        input.checked = locked.includes(name);
        input.dataset.focus = `${key}-lock-${all.indexOf(name)}`;
        input.addEventListener("change", () => {
          setThenLock(config, rule, name, input.checked);
          commit(env, `${key}-lock-${all.indexOf(name)}`);
        });
        label.append(input, ` ${turnouts.includes(name) ? name : `${name} (${ui.TEXT.memberMissing})`}`);
        boxes.append(label);
      }
      lockRow.append(boxes, ctx.hintEl(TEXT.locksHint));
      fields.append(lockRow);
    }
    box.append(fields);
    return box;
  }

  function renderRule(group, rule, index, count, env, key) {
    const { ui } = env;
    const { item, actions } = ui.rowCard(TEXT.ruleTitle(index + 1), () => {
      removeRule(group, index);
      commit(env);
    }, "logic-rule");
    if (index > 0) actions.prepend(button(TEXT.moveUp, () => { moveRule(group, index, -1); commit(env, `${key.replace(/r\d+$/, `r${index - 1}`)}-up`); }, { key: `${key}-up`, title: TEXT.moveUpHint }));
    if (index < count - 1) actions.insertBefore(button(TEXT.moveDown, () => { moveRule(group, index, 1); commit(env, `${key.replace(/r\d+$/, `r${index + 1}`)}-down`); }, { key: `${key}-down`, title: TEXT.moveDownHint }), actions.lastChild);
    item.append(el("p", "rule-sentence", ruleSentence(rule)));

    if (!isObject(rule.trigger)) rule.trigger = { while: blankCondition() };
    const trigger = rule.trigger;
    const kind = triggerKind(trigger);

    // When
    const when = part(TEXT.whenPart);
    const whenRow = el("div", "rule-when");
    whenRow.append(plainSelect(["while", "when"].map((k) => ({ value: k, label: TEXT.kinds[k] })), kind, (k) => {
      setTriggerKind(rule, k);
      commit(env, `${key}-kind`);
    }, { label: TEXT.kindLabel, key: `${key}-kind` }));
    whenRow.append(renderCondition(trigger[kind], (next) => { trigger[kind] = next; }, env, `${key}-w`, { moment: kind === "when", combine: kind === "while" }));
    when.append(whenRow, env.ctx.hintEl(TEXT.kindHint));
    item.append(when);

    // Only if
    const onlyIf = part(TEXT.onlyIfPart);
    const checks = list(rule.checks);
    checks.forEach((check, i) => {
      const row = el("div", "rule-branch");
      row.append(renderCondition(check, (next) => setCheck(rule, i, next), env, `${key}-c${i}`));
      row.append(button(ui.TEXT.remove, () => { removeCheck(rule, i); commit(env); }, { className: "remove" }));
      onlyIf.append(row);
    });
    if (!checks.length) onlyIf.append(el("p", "hint", TEXT.checksEmpty));
    onlyIf.append(button(TEXT.addCheck, () => { addCheck(rule); commit(env, `${key}-c${checks.length}-item`); }, { key: `${key}-addc` }));
    item.append(onlyIf);

    // Then
    item.append(renderThen(rule, env, key));

    // More options: for, the leaving guard, following moments, Cancel.
    const more = moreOptions(rule);
    const inner = el("div", "fields");
    if (kind === "while") {
      const forRow = el("label");
      forRow.append(el("span", "field-label", TEXT.forLabel), plainSelect(timeChoices(trigger.for, TEXT.atOnce), trigger.for ?? "", (time) => {
        setFor(trigger, time);
        commit(env, `${key}-for`);
      }, { label: TEXT.forLabel, key: `${key}-for` }), env.ctx.hintEl(TEXT.forHint));
      inner.append(forRow);
      const guard = env.ctx.field(TEXT.leavingLabel, trigger.leavingGuard === true, (on) => {
        setLeavingGuard(trigger, on);
        commit(env, `${key}-guard`);
      }, { checkbox: true, hint: TEXT.leavingHint });
      guard.querySelector("input").dataset.focus = `${key}-guard`;
      inner.append(guard);
      inner.append(el("p", "hint full", TEXT.cancelWhileHint));
    } else {
      const follow = el("div", "full");
      follow.append(el("span", "field-label", TEXT.followedByLabel), env.ctx.hintEl(TEXT.followedByHint));
      renderMoments(trigger, env, `${key}-w`, follow);
      inner.append(follow);
      const cancel = el("div", "full rule-cancel");
      const toggle = env.ctx.field(TEXT.cancelLabel, isObject(rule.cancel), (on) => {
        setCancel(rule, on);
        commit(env, `${key}-cancel`);
      }, { checkbox: true, hint: TEXT.cancelHint });
      toggle.querySelector("input").dataset.focus = `${key}-cancel`;
      cancel.append(toggle);
      if (isObject(rule.cancel)) {
        cancel.append(renderCondition(rule.cancel.when, (next) => { rule.cancel.when = next; }, env, `${key}-x`, { moment: true, combine: false }));
      }
      inner.append(cancel);
    }
    more.append(inner);
    item.append(more);
    return item;
  }

  function renderGroup(list_, group, index, env) {
    const { ui, ctx } = env;
    const key = `g${index}`;
    const { item, title } = ui.rowCard(group.name || TEXT.newGroupName(index + 1), () => {
      removeGroup(env.config, index);
      commit(env);
    }, "logic-group");
    const fields = el("div", "fields");
    const name = ctx.field(TEXT.groupNameLabel, group.name ?? "", (value) => {
      group.name = value;
      title.textContent = value || TEXT.newGroupName(index + 1);
      ctx.persist();
    }, { hint: TEXT.groupNameHint, full: true });
    fields.append(name);
    item.append(fields);
    const rules = rulesOf(group);
    rules.forEach((rule, i) => {
      if (isObject(rule)) item.append(renderRule(group, rule, i, rules.length, env, `${key}-r${i}`));
    });
    if (!rules.length) item.append(el("p", "empty", TEXT.rulesEmpty));
    item.append(button(TEXT.addRule, () => { addRule(group); commit(env, `${key}-r${rules.length - 1}-w-item`); }, { key: `${key}-addr` }));
    list_.append(item);
  }

  function renderGroups(root, config, ctx, ui) {
    // An empty page leads with the starters card (logic-ui-start.js), whose
    // last card writes a group from scratch.
    if (!list(config.logic?.layers).length) return;
    const section = ui.card("logic-groups", TEXT.groupsCard);
    section.append(ui.paragraph(TEXT.groupsIntro), ui.paragraph(TEXT.groupsIntro2));
    const env = { config, ctx, ui, choices: conditionItemChoices(config) };
    const groups = list(config.logic?.layers);
    const holder = el("div");
    groups.forEach((group, index) => {
      if (isObject(group)) renderGroup(holder, group, index, env);
    });
    if (!groups.length) holder.append(el("p", "empty", TEXT.groupsEmpty));
    section.append(holder, button(TEXT.addGroup, () => {
      addGroup(config);
      ctx.persist();
      ctx.render();
      const inputs = document.querySelectorAll("#logic-groups .logic-group > .fields input[type=text]");
      inputs[inputs.length - 1]?.select();
    }));
    root.append(section);
  }

  // ----- Sections -----

  function renderRelease(res, env, key, holder) {
    const { ctx } = env;
    const release = isObject(res.release) ? res.release : (res.release = defaultRelease(res.blocks));
    const kind = triggerKind(release);
    const box = el("div", "rule-part full");
    box.append(el("div", "rule-part-title", TEXT.releaseLabel));
    box.append(el("p", "rule-sentence", releaseSentence(res)));
    const row = el("div", "rule-when");
    if (kind === "while") {
      row.append(renderCondition(release.while, (next) => { release.while = next; }, env, `${key}-w`));
      box.append(row);
      const forRow = el("label");
      forRow.append(el("span", "field-label", TEXT.forLabel), plainSelect(timeChoices(release.for, TEXT.atOnce), release.for ?? "", (time) => {
        setFor(release, time);
        commit(env, `${key}-for`);
      }, { label: TEXT.forLabel, key: `${key}-for` }), ctx.hintEl(TEXT.releaseForHint));
      box.append(forRow);
    } else {
      row.append(renderCondition(release.when, (next) => { release.when = next; }, env, `${key}-w`, { moment: true, combine: false }));
      box.append(row);
      renderMoments(release, env, `${key}-w`, box);
    }
    if (!isDefaultRelease(release, res.blocks) && list(res.blocks).length) {
      box.append(button(TEXT.releaseUseDefault, () => { useDefaultRelease(res); commit(env, `${key}-w-item`); }));
    }
    holder.append(box);
  }

  function renderSection(holder, res, index, env) {
    const { config, ctx, ui } = env;
    const key = `s${index}`;
    const { item, title } = ui.rowCard(res.name || TEXT.newSectionName(index + 1), () => {
      removeSection(config, index);
      commit(env);
    }, "logic-section");
    const fields = el("div", "fields");
    const nameAtRender = res.name;
    const nameField = ctx.field(TEXT.sectionNameLabel, res.name ?? "", (value) => {
      res.name = value;
      title.textContent = value || TEXT.newSectionName(index + 1);
      ctx.persist();
    }, { hint: TEXT.sectionNameHint, full: true });
    // Rules follow the name once it is finished (change), not on every key.
    nameField.querySelector("input").addEventListener("change", () => {
      const typed = res.name;
      res.name = nameAtRender;
      renameSection(config, res, typed);
      ctx.persist();
      ctx.render();
    });
    fields.append(nameField);

    const wrap = el("div", "block-members-field");
    wrap.append(el("span", "field-label", TEXT.sectionBlocksLabel));
    const members = el("ul", "block-members");
    list(res.blocks).forEach((member, at) => {
      const row = el("li");
      const words = typeof member === "string" ? member : ui.TEXT.remoteBlock(member.board, member.block ?? member.sensor);
      row.append(el("span", "", typeof member === "object" && member.sensor !== undefined ? ui.TEXT.remoteSensor(member.board, member.sensor) : words));
      row.append(button(ui.TEXT.remove, () => { removeSectionBlock(res, at); commit(env); }, { className: "remove" }));
      members.append(row);
    });
    if (!list(res.blocks).length) members.append(el("li", "empty", TEXT.sectionBlocksEmpty));
    wrap.append(members);
    const choices = sectionBlockChoices(config, res);
    if (choices.length) {
      wrap.append(itemSelect(choices, "", (member) => {
        if (member === "") return;
        addSectionBlock(res, member);
        commit(env, `${key}-add`);
      }, { prompt: TEXT.addSectionBlock, label: TEXT.addSectionBlock, key: `${key}-add` }));
    } else {
      wrap.append(ctx.hintEl(TEXT.noBlocksYet));
    }
    fields.append(wrap);
    renderRelease(res, env, `${key}-rel`, fields);

    const more = moreOptions(res);
    const inner = el("div", "fields");
    const holdRow = el("label");
    holdRow.append(el("span", "field-label", TEXT.holdLabel), plainSelect(timeChoices(res.approachLock, TEXT.off), res.approachLock ?? "", (time) => {
      setHold(res, time);
      commit(env, `${key}-hold`);
    }, { label: TEXT.holdLabel, key: `${key}-hold` }), ctx.hintEl(TEXT.holdHint));
    const kindRow = el("label");
    kindRow.append(el("span", "field-label", TEXT.releaseKindLabel), plainSelect(["while", "when"].map((k) => ({ value: k, label: TEXT.releaseKinds[k] })), triggerKind(res.release), (k) => {
      setReleaseKind(res, k);
      commit(env, `${key}-relkind`);
    }, { label: TEXT.releaseKindLabel, key: `${key}-relkind` }));
    inner.append(holdRow, kindRow);
    more.append(inner);
    fields.append(more);
    item.append(fields);
    holder.append(item);
  }

  function renderSections(root, config, ctx, ui) {
    const section = ui.card("logic-sections", TEXT.sectionsCard);
    section.append(ui.paragraph(TEXT.sectionsIntro));
    const env = { config, ctx, ui, choices: conditionItemChoices(config) };
    const sections = list(config.logic?.resources);
    const holder = el("div");
    sections.forEach((res, index) => {
      if (isObject(res)) renderSection(holder, res, index, env);
    });
    if (!sections.length) holder.append(el("p", "empty", TEXT.sectionsEmpty));
    section.append(holder, button(TEXT.addSection, () => {
      addSection(config);
      ctx.persist();
      ctx.render();
      const inputs = document.querySelectorAll("#logic-sections .logic-section > .fields > label input[type=text]");
      inputs[inputs.length - 1]?.select();
    }));
    root.append(section);
  }

  global.EsphomeMrLogicUiRules = {
    TEXT, MEANINGS, TIMES,
    // conditions
    blankCondition, conditionKind, conditionRef, conditionItemChoices, isWords, isWordsOf, setConditionItem, setConditionIs,
    meaningsOf, toggleMeaning, wrapCondition, unwrapCondition, setCombine, addBranch, removeBranch, setBranch,
    // triggers, checks, then, cancel
    triggerKind, setTriggerKind, setFor, setLeavingGuard, addThenMoment, setThenMoment, removeThenMoment,
    addCheck, setCheck, removeCheck,
    mastAspects, defaultAspect, setThenMast, setThenAspect, setThenSection, setThenLock,
    defaultCancel, setCancel,
    // rules and groups
    addRule, removeRule, moveRule, addGroup, removeGroup,
    // sections
    defaultRelease, isDefaultRelease, addSection, setSectionBlocks, addSectionBlock, removeSectionBlock,
    sectionBlockChoices, useDefaultRelease, setReleaseKind, setHold, renameSection, removeSection,
    // words
    sayTime, timeChoices, ruleSentence, releaseSentence,
  };

  global.EsphomeMrLogicUi.registerPart({ id: "logic-sections", order: 70, modes: ["field"], text: TEXT, render: renderSections });
  global.EsphomeMrLogicUi.registerPart({ id: "logic-groups", order: 80, modes: ["field"], text: TEXT, render: renderGroups });
})(typeof globalThis !== "undefined" ? globalThis : window);
