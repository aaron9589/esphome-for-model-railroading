// Starter: Lock turnouts under a train (docs/field-logic-spec.md, Starters;
// work item 2.8; the drawing builds its turnout locks with it). Defined with
// EsphomeMrLogicStarters.defineStarter: pure defaults / problems / build for
// Node tests, and a form for the page. The One-train section starter went in
// TP 9: the track plan's routes replace it.
//
// Answers, as the tests and the forms pass them:
//   lock-turnouts:     { name, rows: [{ turnout: name, block: member }] }
// A member is a name on this board, or { board, sensor | block } on a linked one.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const S = () => global.EsphomeMrLogicStarters;

  const TEXT = Object.freeze({
    remove: "Remove",
    pickBlock: "Pick a block…",
    pickTurnout: "Pick a turnout…",
    // lock-turnouts
    locksTitle: "Lock turnouts under a train",
    locksIntro: "Each turnout is locked while its block is occupied, and unlocked once it clears.",
    groupName: "Group name",
    turnout: "Turnout",
    blockUnder: "Block it sits in",
    addTurnout: "Add a turnout",
    // problems
    needGroupName: "Give the group a name.",
    needRows: "Add at least one turnout.",
    needRowTurnout: (n) => `Row ${n}: pick the turnout.`,
    needRowBlock: (n) => `Row ${n}: pick the block it sits in.`,
  });


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


  function takenNames(config, key) {
    return new Set(list(config.logic?.[key]).filter(isObject).map((item) => String(item.name ?? "")));
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


  function picker(ui, config, kind, current, onChange, prompt, label, remote = true) {
    return ui.selectEl(ui.itemChoices(config, kind, { remote }), current, onChange, { prompt, label });
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
    defineStarter("lock-turnouts", { defaults: locksDefaults, problems: locksProblems, build: locksBuild, form: form(locksForm), text: TEXT });
  }

  global.EsphomeMrLogicStartersSections = { TEXT };
})(typeof globalThis !== "undefined" ? globalThis : window);
