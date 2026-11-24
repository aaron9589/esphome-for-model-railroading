// Starters: One-train section and Lock turnouts under a train
// (docs/field-logic-spec.md, Starters; work item 2.8). Each is defined with
// EsphomeMrLogicStarters.defineStarter (one-train-section, lock-turnouts): pure
// defaults / problems / build for Node tests, and a form for the page.
//
// Answers, as the tests and the forms pass them:
//   one-train-section: { name, blocks: [member], releaseFor: "3s", approachLock: "" | time,
//     entrances: [{ block: member, mast: name, aspect, leave: bool }] }
//   lock-turnouts:     { name, rows: [{ turnout: name, block: member }] }
// A member is a name on this board, or { board, sensor | block } on a linked one.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const S = () => global.EsphomeMrLogicStarters;

  const TEXT = Object.freeze({
    // one-train-section
    sectionTitle: "One-train section",
    sectionIntro: "A stretch of track that only one train may be on at a time, with a protected entrance at each end.",
    sectionName: "Name",
    sectionBlocks: "Blocks in the section",
    addBlock: "Add a block",
    remove: "Remove",
    entrances: "Entrances",
    entrance: (n) => `Entrance ${n}`,
    triggerBlock: "A train waiting in",
    signal: "Signal",
    shows: "shows",
    addEntrance: "Add an entrance",
    moreOptions: "More options",
    freeAfter: "Free the section when its blocks are clear for",
    holdAfter: "Hold after cancelling",
    holdOff: "Off",
    leaves: (n) => `Trains also leave through entrance ${n}`,
    leavesHelp: "Tick this for a single line, where trains leave the section through the same block they came in by.",
    pickBlock: "Pick a block…",
    pickSignal: "Pick a signal…",
    pickAspect: "Pick an aspect…",
    pickTurnout: "Pick a turnout…",
    seconds: (n) => (n === 1 ? "1 second" : `${n} seconds`),
    // lock-turnouts
    locksTitle: "Lock turnouts under a train",
    locksIntro: "Each turnout is locked while its block is occupied, and unlocked once it clears.",
    groupName: "Group name",
    turnout: "Turnout",
    blockUnder: "Block it sits in",
    addTurnout: "Add a turnout",
    // problems
    needName: "Give the section a name.",
    needBlocks: "Pick at least one block for the section.",
    entranceCount: "A section needs between 2 and 4 entrances.",
    needTrigger: (n) => `Entrance ${n}: pick the block a waiting train stands in.`,
    needSignal: (n) => `Entrance ${n}: pick the signal.`,
    needAspect: (n) => `Entrance ${n}: pick what the signal shows.`,
    sameTrigger: (name) => `Two entrances wait in ${name}. Each entrance needs its own block.`,
    badTime: (what) => `${what} is not a time like 3s.`,
    needGroupName: "Give the group a name.",
    needRows: "Add at least one turnout.",
    needRowTurnout: (n) => `Row ${n}: pick the turnout.`,
    needRowBlock: (n) => `Row ${n}: pick the block it sits in.`,
  });

  const TIME = /^\d+(\.\d+)?(ms|s)$/;
  const HOLDS = Object.freeze(["5s", "10s", "20s", "30s", "60s"]);
  const RELEASES = Object.freeze(["1s", "2s", "3s", "5s", "10s", "20s"]);

  const copy = (value) => JSON.parse(JSON.stringify(value));
  const blank = (value) => value === undefined || value === null || value === "";
  const memberName = (member) => (isObject(member) ? Object.entries(member).find(([k]) => k !== "board")?.[1] : member);
  const memberKey = (member) => JSON.stringify(member);

  // A block or sensor as a state: a name here, or { board, sensor | block } on a linked board.
  function state(member, is) {
    if (isObject(member)) {
      const kind = ["sensor", "block"].find((k) => member[k] !== undefined) || "block";
      return { board: member.board, [kind]: member[kind], is };
    }
    return { block: member, is };
  }

  // "All the blocks clear for 3s": one block as itself, several under all of.
  function clearRelease(blocks, time) {
    const states = blocks.map((member) => state(member, "clear"));
    const release = { while: states.length === 1 ? states[0] : { all: states } };
    if (time) release.for = time;
    return release;
  }

  function takenNames(config, key) {
    return new Set(list(config.logic?.[key]).filter(isObject).map((item) => String(item.name ?? "")));
  }

  // The proceed aspect a mast starts with: the one that means clear, else one called Clear.
  function proceedFor(config, mast) {
    if (!mast) return "";
    const clear = S().aspectFor(config, mast, "clear");
    return clear || (S().mastMeanings(config, mast).find((a) => a.aspect === "Clear")?.aspect ?? "");
  }

  // ===== One-train section ==================================================

  const entranceDefaults = () => ({ block: "", mast: "", aspect: "", leave: false });

  function sectionDefaults(config) {
    return {
      name: S().freeName("Section", new Set([...takenNames(config, "resources"), ...takenNames(config, "layers")])),
      blocks: [],
      releaseFor: "3s",
      approachLock: "",
      entrances: [entranceDefaults(), entranceDefaults()],
    };
  }

  function sectionProblems(config, a) {
    const out = [];
    if (!String(a.name ?? "").trim()) out.push(TEXT.needName);
    if (!list(a.blocks).length) out.push(TEXT.needBlocks);
    const entrances = list(a.entrances);
    if (entrances.length < 2 || entrances.length > 4) out.push(TEXT.entranceCount);
    const seen = new Set();
    entrances.forEach((e, i) => {
      const n = i + 1;
      if (blank(memberName(e.block))) out.push(TEXT.needTrigger(n));
      else if (seen.has(memberKey(e.block))) out.push(TEXT.sameTrigger(memberName(e.block)));
      else seen.add(memberKey(e.block));
      if (blank(e.mast)) out.push(TEXT.needSignal(n));
      else if (blank(e.aspect)) out.push(TEXT.needAspect(n));
    });
    if (!TIME.test(String(a.releaseFor ?? ""))) out.push(TEXT.badTime(TEXT.freeAfter));
    if (!blank(a.approachLock) && !TIME.test(String(a.approachLock))) out.push(TEXT.badTime(TEXT.holdAfter));
    return out;
  }

  function sectionBuild(config, a) {
    const entrances = list(a.entrances);
    const rules = entrances.map((e, i) => {
      const trigger = { while: state(e.block, "occupied"), for: "0.5s" };
      if (e.leave) trigger.leavingGuard = true;
      const checks = entrances.filter((other, j) => j !== i && other.leave).map((other) => state(other.block, "clear"));
      return { trigger, checks, then: { mast: e.mast, aspect: e.aspect, reserve: a.name } };
    });
    const section = { name: a.name, blocks: copy(list(a.blocks)), release: clearRelease(list(a.blocks), a.releaseFor) };
    if (!blank(a.approachLock)) section.approachLock = a.approachLock;
    return { groups: [{ name: a.name, starter: "one-train-section", rules }], sections: [section] };
  }

  // ===== Lock turnouts under a train ========================================

  function locksDefaults(config) {
    return {
      name: S().freeName("Turnout locks", takenNames(config, "layers")),
      rows: [{ turnout: "", block: "" }],
    };
  }

  function locksProblems(config, a) {
    const out = [];
    if (!String(a.name ?? "").trim()) out.push(TEXT.needGroupName);
    const rows = list(a.rows);
    if (!rows.length) out.push(TEXT.needRows);
    rows.forEach((row, i) => {
      if (blank(row.turnout)) out.push(TEXT.needRowTurnout(i + 1));
      if (blank(memberName(row.block))) out.push(TEXT.needRowBlock(i + 1));
    });
    return out;
  }

  function locksBuild(config, a) {
    const rules = list(a.rows).map((row) => ({ trigger: { while: state(row.block, "occupied") }, checks: [], then: { lock: [row.turnout] } }));
    return { groups: [{ name: a.name, starter: "lock-turnouts", rules }] };
  }

  // ===== Forms (browser only) ===============================================

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function labelled(text, control) {
    const label = el("label", "field");
    label.append(el("span", "", text), control);
    return label;
  }

  function button(text, onClick, className = "") {
    const b = el("button", className, text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  function textInput(value, onInput) {
    const input = el("input");
    input.type = "text";
    input.value = value ?? "";
    input.addEventListener("input", () => onInput(input.value));
    return input;
  }

  function choose(options, current, onChange, label) {
    const select = el("select");
    select.setAttribute("aria-label", label);
    for (const [value, text] of options) {
      const o = el("option", "", text);
      o.value = value;
      select.append(o);
    }
    select.value = current;
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  const secondsOptions = (values) => values.map((v) => [v, TEXT.seconds(parseFloat(v))]);

  function picker(ui, config, kind, current, onChange, prompt, label, remote = true) {
    return ui.selectEl(ui.itemChoices(config, kind, { remote }), current, onChange, { prompt, label });
  }

  function aspectPick(config, ctx, mast, current, onChange) {
    const wrap = el("span", "starter-aspect");
    const aspects = mast ? S().mastMeanings(config, mast).map((a) => a.aspect) : [];
    const keep = current && !aspects.includes(current) ? [current] : [];
    wrap.append(choose([["", TEXT.pickAspect], ...[...aspects, ...keep].map((a) => [a, a])], current || "", onChange, TEXT.shows));
    const picture = current && mast ? ctx.mastPicture?.(mast, current) : null;
    if (picture) wrap.append(picture);
    return wrap;
  }

  function fold(...children) {
    const details = el("details", "starter-more");
    details.append(el("summary", "", TEXT.moreOptions), ...children);
    return details;
  }

  function open(key, title, intro, config, ctx, ui, answers, draw) {
    S().dialog({
      title, intro,
      fill: (body, redraw) => draw(body, redraw),
      check: () => S().problems(key, config, answers),
      done: () => {
        S().apply(key, config, answers);
        ctx.persist();
        ctx.render();
      },
    });
  }

  function sectionForm(config, ctx, ui) {
    const a = sectionDefaults(config);
    open("one-train-section", TEXT.sectionTitle, TEXT.sectionIntro, config, ctx, ui, a, (body, redraw) => {
      body.append(labelled(TEXT.sectionName, textInput(a.name, (v) => { a.name = v; })));
      const blocks = el("div", "starter-rows");
      blocks.append(el("h3", "", TEXT.sectionBlocks));
      a.blocks.forEach((member, i) => {
        const row = el("div", "starter-row");
        row.append(picker(ui, config, "block", member, (v) => { a.blocks[i] = v; }, TEXT.pickBlock, TEXT.sectionBlocks),
          button(TEXT.remove, () => { a.blocks.splice(i, 1); redraw(); }, "remove"));
        blocks.append(row);
      });
      blocks.append(button(TEXT.addBlock, () => { a.blocks.push(""); redraw(); }));
      body.append(blocks);

      const entrances = el("div", "starter-rows");
      entrances.append(el("h3", "", TEXT.entrances));
      a.entrances.forEach((e, i) => {
        const row = el("div", "starter-row starter-entrance");
        row.append(el("strong", "", TEXT.entrance(i + 1)),
          labelled(TEXT.triggerBlock, picker(ui, config, "block", e.block, (v) => { e.block = v; }, TEXT.pickBlock, TEXT.triggerBlock)),
          labelled(TEXT.signal, picker(ui, config, "mast", e.mast, (v) => {
            e.mast = v;
            e.aspect = proceedFor(config, v);
            redraw();
          }, TEXT.pickSignal, TEXT.signal, false)),
          labelled(TEXT.shows, aspectPick(config, ctx, e.mast, e.aspect, (v) => { e.aspect = v; redraw(); })));
        if (a.entrances.length > 2) row.append(button(TEXT.remove, () => { a.entrances.splice(i, 1); redraw(); }, "remove"));
        entrances.append(row);
      });
      if (a.entrances.length < 4) entrances.append(button(TEXT.addEntrance, () => { a.entrances.push(entranceDefaults()); redraw(); }));
      body.append(entrances);

      const more = [];
      more.push(labelled(TEXT.freeAfter, choose(secondsOptions([...new Set([...RELEASES, a.releaseFor])]), a.releaseFor, (v) => { a.releaseFor = v; }, TEXT.freeAfter)));
      more.push(labelled(TEXT.holdAfter, choose([["", TEXT.holdOff], ...secondsOptions(HOLDS)], a.approachLock || "", (v) => { a.approachLock = v; }, TEXT.holdAfter)));
      more.push(el("p", "card-copy", TEXT.leavesHelp));
      a.entrances.forEach((e, i) => {
        const box = el("input");
        box.type = "checkbox";
        box.checked = !!e.leave;
        box.addEventListener("change", () => { e.leave = box.checked; });
        const label = el("label", "check");
        label.append(box, el("span", "", TEXT.leaves(i + 1)));
        more.push(label);
      });
      body.append(fold(...more));
    });
  }

  function locksForm(config, ctx, ui) {
    const a = locksDefaults(config);
    open("lock-turnouts", TEXT.locksTitle, TEXT.locksIntro, config, ctx, ui, a, (body, redraw) => {
      body.append(labelled(TEXT.groupName, textInput(a.name, (v) => { a.name = v; })));
      a.rows.forEach((row, i) => {
        const line = el("div", "starter-row");
        line.append(labelled(TEXT.turnout, picker(ui, config, "turnout", row.turnout, (v) => { row.turnout = v; }, TEXT.pickTurnout, TEXT.turnout, false)),
          labelled(TEXT.blockUnder, picker(ui, config, "block", row.block, (v) => { row.block = v; }, TEXT.pickBlock, TEXT.blockUnder)));
        if (a.rows.length > 1) line.append(button(TEXT.remove, () => { a.rows.splice(i, 1); redraw(); }, "remove"));
        body.append(line);
      });
      body.append(button(TEXT.addTurnout, () => { a.rows.push({ turnout: "", block: "" }); redraw(); }));
    });
  }

  // ===== Definitions ========================================================

  const hasDom = typeof document !== "undefined";
  const form = (fn) => (hasDom ? (config, ctx, ui) => fn(config, ctx, ui) : undefined);

  if (global.EsphomeMrLogicStarters) {
    const { defineStarter } = global.EsphomeMrLogicStarters;
    defineStarter("one-train-section", { defaults: sectionDefaults, problems: sectionProblems, build: sectionBuild, form: form(sectionForm), text: TEXT });
    defineStarter("lock-turnouts", { defaults: locksDefaults, problems: locksProblems, build: locksBuild, form: form(locksForm), text: TEXT });
  }

  global.EsphomeMrLogicStartersSections = { TEXT };
})(typeof globalThis !== "undefined" ? globalThis : window);
