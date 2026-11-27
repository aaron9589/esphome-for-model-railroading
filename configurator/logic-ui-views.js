// The Logic page: the layers view (logic-layers-view, order 90) and the control
// table (logic-control-table, order 95). Work item 2.7c.
// Loaded after logic-ui.js, which draws the page; this file registers its
// parts with EsphomeMrLogicUi.registerPart. Every word it shows is in its
// TEXT, which test/logic-page.test.js lints for spec-only terms.
//
// Both are read-only. The work is in two pure functions, whoUses and
// controlTable, which test/logic-views.test.js checks without a DOM.
(function (global) {
  const TEXT = Object.freeze({
    whoCard: "Who uses what",
    whoIntro: "Each signal, turnout and block the rules use, and which groups use it. Highlighted rows are used by more than one group: a signal set by several groups shows the most restrictive of what they say, and a turnout stays locked while any group locks it.",
    whoShow: "Show who uses what",
    controlCard: "Control table",
    controlIntro: "The same rules the way signal engineers write them: one row for each signal and aspect a rule shows.",
    controlHint: "Read-only. Edits happen on the cards.",
    controlShow: "Show the control table",
    noRules: "No rules yet. Add a group, or start from a starter.",
    builtWhoIntro: "Each signal, turnout and block MSS Logic uses, and which groups use it. MSS Logic made the blocks and groups from your tracks and junctions, so they are read-only here: change them under Tracks, Junctions or Signals.",
    builtControlIntro: "The same signals the way signal engineers write them: one row for each signal and aspect MSS Logic shows.",
    builtControlHint: "Read-only. MSS Logic made every row from your tracks and junctions.",
    builtNone: "Nothing made yet. Describe the module's tracks first.",
    madeBy: "Made by MSS Logic",
    mastsHeading: "Signals",
    turnoutsHeading: "Turnouts",
    blocksHeading: "Blocks",
    colSignal: "Signal",
    colTurnout: "Turnout",
    colBlock: "Block",
    colSetBy: "Set by",
    colLockedBy: "Locked by",
    colTakenBy: "Taken by",
    colSection: "In the section",
    colReadBy: "Read by",
    colRule: "Rule",
    colAspect: "Aspect",
    colMeaning: "Meaning",
    colWhen: "When",
    colClear: "Blocks clear",
    colTurnouts: "Turnouts set",
    colOnlyIf: "Only if, also",
    colTakes: "Take the section",
    colRelease: "Free the section when…",
    colHold: "Hold after cancelling",
    colLocks: "Locks",
    none: "—",
    noSignal: "No signal",
    off: "Off",
    setByMany: (n) => `Set by ${n} groups`,
    lockedByMany: (n) => `Locked by ${n} groups`,
    usedByMany: (n) => `Used by ${n} groups`,
    groupNumber: (n) => `Group ${n}`,
    ruleLabel: (group, n) => `${group}, rule ${n}`,
    fromBoard: (name, board) => `${name} (from ${board})`,
    position: (name, is) => `${name} ${is}`,
    cancelWhen: (when) => `Cancel when ${when}`,
    seconds: (n) => `${n} second${n === 1 ? "" : "s"}`,
    meanings: Object.freeze({
      stop: "Stop", restricting: "Restricting", approach: "Approach", advance: "Advance Approach", clear: "Clear",
    }),
  });

  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  // A rule's lock: a turnout's name, or { turnout, with } (a track plan's route locking).
  const lockTurnout = (item) => (isObject(item) ? item.turnout : item);
  const capital = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);
  const unique = (items) => [...new Set(items)];

  // The page's name for a group: its name, else its place in the list.
  function groupName(layer, index) {
    return String(layer?.name || "").trim() || TEXT.groupNumber(index + 1);
  }

  // A stored reference (a name, or { board, <kind>: name }) in words.
  function refName(ref, kind) {
    if (!isObject(ref)) return String(ref ?? "");
    const name = String(ref[kind] ?? ref.block ?? ref.sensor ?? ref.turnout ?? ref.mast ?? "");
    return ref.board !== undefined ? TEXT.fromBoard(name, ref.board) : name;
  }

  // Every condition or moment in a trigger, checks list, cancel or release.
  function conditionsIn(value, found = []) {
    if (Array.isArray(value)) value.forEach((item) => conditionsIn(item, found));
    else if (isObject(value)) {
      if (["block", "sensor", "turnout", "mast"].some((kind) => value[kind] !== undefined)) found.push(value);
      else Object.values(value).forEach((inner) => conditionsIn(inner, found));
    }
    return found;
  }

  // What the engine runs: this board's Logic page for Field Logic, or what
  // MSS Logic built from its description (read-only).
  function itemsOf(config) {
    return global.EsphomeMrLogicYaml.logicItems(config);
  }

  const isMss = (config) => global.EsphomeMr.logicMode(config) === "mss";

  // Words for what made a built block, signal or group, else "".
  function madeBy(config, kind, name) {
    if (!isMss(config)) return "";
    const items = itemsOf(config);
    const origin = list(items.origins).find((o) => o.kind === kind && o.name === name);
    if (!origin) return "";
    // A signal on the Signal Masts page is the person's own; only signals with no lights are built.
    if (kind === "mast" && !list(items.masts).some((m) => isObject(m) && m.name === name && m.virtual === true)) return "";
    return String(origin.words || TEXT.madeBy);
  }

  function sections(config) {
    return new Map(list(itemsOf(config).resources).filter(isObject).map((res) => [String(res.name || ""), res]));
  }

  function layers(config) {
    return list(itemsOf(config).layers).filter(isObject);
  }

  /**
   * Who uses what (the spec's layers view): for each signal, turnout and block
   * a group's rules name, which groups set it and which read it.
   *
   * Returns rows { kind: "mast" | "turnout" | "block", name, board, setBy,
   * readBy, sections, groups, overlap }: `name` and `board` as stored (board ""
   * for this board); `setBy` the groups whose rules set the mast, lock the
   * turnout, or take a section holding the block; `readBy` the groups whose
   * rules read it in a When, Only if, cancel, or the release of a section they
   * take; `sections` the sections holding a block; `groups` how many groups
   * use it either way; `overlap` true for a mast set or a turnout locked by
   * more than one group, or a block used by more than one.
   *
   * Order: masts, turnouts, blocks; within each, this board's items in the
   * order of their pages, then the rest in the order the rules first name them.
   */
  function whoUses(config) {
    const rows = new Map();
    const row = (kind, ref) => {
      const board = isObject(ref) && ref.board !== undefined ? String(ref.board) : "";
      const name = isObject(ref) ? String(ref[kind] ?? (kind === "block" ? ref.sensor : undefined) ?? "") : String(ref ?? "");
      const key = JSON.stringify([kind, board, name]);
      if (!rows.has(key)) rows.set(key, { kind, name, board, setBy: [], readBy: [], sections: [] });
      return rows.get(key);
    };
    const add = (into, value) => {
      if (!into.includes(value)) into.push(value);
    };
    const kindOf = (cond) => (cond.block !== undefined || cond.sensor !== undefined ? "block" : cond.turnout !== undefined ? "turnout" : "mast");
    const byName = sections(config);
    layers(config).forEach((layer, li) => {
      const group = groupName(layer, li);
      for (const rule of list(layer.rules).filter(isObject)) {
        const then = isObject(rule.then) ? rule.then : {};
        // One section, or several at once (a track plan's move).
        const taken = [].concat(then.reserve ?? []).map((name) => byName.get(String(name))).filter(Boolean);
        for (const cond of conditionsIn([rule.trigger, rule.checks, rule.cancel, ...taken.map((section) => section.release)])) {
          add(row(kindOf(cond), cond).readBy, group);
        }
        if (typeof then.mast === "string" && then.mast) add(row("mast", then.mast).setBy, group);
        for (const name of list(then.lock).map(lockTurnout)) if (typeof name === "string" && name) add(row("turnout", name).setBy, group);
        for (const section of taken) {
          for (const ref of list(section.blocks)) {
            const block = row("block", ref);
            add(block.setBy, group);
            add(block.sections, String(section.name));
          }
        }
      }
    });

    const names = (items) => list(items).filter(isObject).map((item) => String(item.name ?? ""));
    const items = itemsOf(config);
    const own = {
      mast: [...names(config.signals?.masts), ...names(list(items.masts).filter((m) => isObject(m) && m.virtual === true))],
      turnout: names(config.points),
      block: [...names(items.blocks), ...names(config.blocks)],
    };
    const out = [];
    for (const kind of ["mast", "turnout", "block"]) {
      const ofKind = [...rows.values()].filter((r) => r.kind === kind);
      const place = (r) => (r.board === "" && own[kind].includes(r.name) ? own[kind].indexOf(r.name) : Infinity);
      ofKind
        .map((r, i) => [place(r), i, r])
        .sort((a, b) => a[0] - b[0] || a[1] - b[1])
        .forEach(([, , r]) => {
          const groups = unique([...r.setBy, ...r.readBy]).length;
          const overlap = kind === "block" ? groups > 1 : r.setBy.length > 1;
          const made = r.board === "" ? madeBy(config, kind, r.name) : "";
          out.push({ ...r, groups, overlap, ...(made ? { madeBy: made } : {}) });
        });
    }
    return out;
  }

  // A condition alone, in the engine's words: explainRule of a rule with just
  // that check says exactly that check.
  function sayCondition(cond) {
    return global.EsphomeMrLogic.explainRule({ checks: [cond] });
  }

  // "10s" as "10 seconds"; anything else as stored.
  function holdWords(text) {
    const value = global.EsphomeMrLogic.ms(text);
    return Number.isNaN(value) ? String(text) : TEXT.seconds(value / 1000);
  }

  // A rule's checks sorted into the control table's columns: blocks that must
  // be clear, turnout positions, and everything else in words. An "all of"
  // is opened up; "not occupied" is clear.
  function sortChecks(checks) {
    const clear = [];
    const turnouts = [];
    const other = [];
    const visit = (cond) => {
      if (!isObject(cond)) return;
      if (Array.isArray(cond.all)) {
        cond.all.forEach(visit);
        return;
      }
      const block = cond.block !== undefined || cond.sensor !== undefined;
      const notOccupied = isObject(cond.not) && (cond.not.block !== undefined || cond.not.sensor !== undefined) && cond.not.is === "occupied";
      if (block && cond.is === "clear") clear.push(refName(cond, cond.block !== undefined ? "block" : "sensor"));
      else if (notOccupied) clear.push(refName(cond.not, cond.not.block !== undefined ? "block" : "sensor"));
      else if (cond.turnout !== undefined && (cond.is === "closed" || cond.is === "thrown")) turnouts.push(TEXT.position(refName(cond, "turnout"), cond.is));
      else other.push(sayCondition(cond));
    };
    list(checks).forEach(visit);
    return { clear, turnouts, other };
  }

  /**
   * The control table: one row per rule that shows an aspect, grouped by
   * signal, then rules that only lock turnouts or take a section. Every cell
   * is a plain string ("" when empty; lists joined with ", "):
   * { mast, aspect, meaning, rule, when, clear, turnouts, onlyIf, section,
   *   release, hold, locks }.
   *
   * `clear` is the blocks the Only if needs clear, then the blocks of the
   * section the rule takes (a section is only taken when free, which means
   * its blocks are clear). `hold` is "Off" for a section without it, and ""
   * when the rule takes no section.
   *
   * Order: signals in the Signal Masts page's order, then signals with no
   * lights, then any others in the order rules name them; within a signal,
   * groups and rules in list order. Rules with no signal come last.
   */
  function controlTable(config) {
    const L = global.EsphomeMrLogic;
    const masts = global.EsphomeMrLogicYaml.logicTable(config)?.masts || {};
    const byName = sections(config);
    const join = (items) => unique(items.filter(Boolean)).join(", ");
    const rows = [];
    layers(config).forEach((layer, li) => {
      const group = groupName(layer, li);
      list(layer.rules).forEach((rule, ri) => {
        if (!isObject(rule)) return;
        const then = isObject(rule.then) ? rule.then : {};
        const mast = typeof then.mast === "string" ? then.mast : "";
        const locks = list(then.lock).map(lockTurnout).filter((name) => typeof name === "string" && name);
        const reserves = [].concat(then.reserve ?? []).filter((name) => name !== "").map(String);
        const reserve = reserves.join(", ");
        if (!mast && !locks.length && !reserve) return;
        const aspect = mast ? String(then.aspect ?? "") : "";
        const tag = masts[mast]?.aspects?.[aspect];
        const section = byName.get(reserves[0]);
        const checks = sortChecks(rule.checks);
        const sectionBlocks = reserves.flatMap((name) => list(byName.get(name)?.blocks)).map((ref) => refName(ref, "block"));
        const when = [capital(L.explainRule({ trigger: rule.trigger || {} }))];
        if (isObject(rule.cancel) && rule.cancel.when !== undefined) {
          when.push(TEXT.cancelWhen(L.explainRule({ trigger: { when: rule.cancel.when } })));
        }
        rows.push({
          mast,
          aspect,
          meaning: tag ? TEXT.meanings[tag] : "",
          rule: TEXT.ruleLabel(group, ri + 1),
          ...(isMss(config) ? { madeBy: TEXT.madeBy } : {}),
          when: when.filter(Boolean).join(". "),
          clear: join([...checks.clear, ...sectionBlocks]),
          turnouts: join(checks.turnouts),
          onlyIf: checks.other.map(capital).join("; "),
          section: reserve,
          release: section?.release !== undefined ? capital(L.explainRule({ trigger: section.release })) : "",
          hold: reserve ? (section?.approachLock ? holdWords(section.approachLock) : TEXT.off) : "",
          locks: join(locks),
          order: rows.length,
        });
      });
    });

    const names = (items) => list(items).filter(isObject).map((item) => String(item.name ?? ""));
    const own = [...names(config.signals?.masts), ...names(list(itemsOf(config).masts).filter((m) => isObject(m) && m.virtual === true))];
    const firstSeen = [];
    for (const r of rows) if (r.mast && !firstSeen.includes(r.mast)) firstSeen.push(r.mast);
    const place = (r) => {
      if (!r.mast) return Infinity;
      const at = own.indexOf(r.mast);
      return at >= 0 ? at : own.length + firstSeen.indexOf(r.mast);
    };
    return rows
      .sort((a, b) => place(a) - place(b) || a.order - b.order)
      .map(({ order, ...r }) => r);
  }

  // ===== Drawing =============================================================

  function cell(tag, text, className = "") {
    const el = document.createElement(tag);
    el.textContent = text === "" ? TEXT.none : text;
    if (className) el.className = className;
    return el;
  }

  function tableEl(headings, className) {
    const wrap = document.createElement("div");
    wrap.className = "logic-view-scroll";
    const table = document.createElement("table");
    table.className = `logic-view-table ${className}`.trim();
    const head = document.createElement("thead");
    const tr = document.createElement("tr");
    for (const heading of headings) {
      const th = cell("th", heading);
      th.scope = "col";
      tr.append(th);
    }
    head.append(tr);
    const body = document.createElement("tbody");
    table.append(head, body);
    wrap.append(table);
    return { wrap, body };
  }

  function foldEl(summaryText, open) {
    const details = document.createElement("details");
    details.className = "logic-view";
    details.open = open;
    const summary = document.createElement("summary");
    summary.textContent = summaryText;
    details.append(summary);
    return details;
  }

  const WHO_KINDS = Object.freeze({
    mast: { heading: "mastsHeading", columns: ["colSignal", "colSetBy", "colReadBy"], many: "setByMany" },
    turnout: { heading: "turnoutsHeading", columns: ["colTurnout", "colLockedBy", "colReadBy"], many: "lockedByMany" },
    block: { heading: "blocksHeading", columns: ["colBlock", "colSection", "colTakenBy", "colReadBy"], many: "usedByMany" },
  });

  // "Made by MSS Logic", with what it was made from as the tooltip.
  function builtBadge(words) {
    const badge = document.createElement("span");
    badge.className = "mss-built-badge";
    badge.textContent = TEXT.madeBy;
    badge.title = words;
    return badge;
  }

  function renderWhoUses(root, config, ctx, ui) {
    const section = ui.card("logic-layers-view", TEXT.whoCard);
    const mss = isMss(config);
    section.append(ui.paragraph(mss ? TEXT.builtWhoIntro : TEXT.whoIntro));
    const rows = whoUses(config);
    if (!rows.length) {
      section.append(ui.paragraph(mss ? TEXT.builtNone : TEXT.noRules, "empty"));
      root.append(section);
      return;
    }
    const fold = foldEl(TEXT.whoShow, rows.length <= 6);
    for (const [kind, spec] of Object.entries(WHO_KINDS)) {
      const ofKind = rows.filter((r) => r.kind === kind);
      if (!ofKind.length) continue;
      const h4 = document.createElement("h4");
      h4.textContent = TEXT[spec.heading];
      const { wrap, body } = tableEl(spec.columns.map((key) => TEXT[key]), "logic-who-table");
      for (const r of ofKind) {
        const tr = document.createElement("tr");
        tr.classList.toggle("is-shared", r.overlap);
        const name = cell("th", r.board ? TEXT.fromBoard(r.name, r.board) : r.name);
        name.scope = "row";
        if (r.madeBy) {
          tr.classList.add("is-built");
          name.append(" ", builtBadge(r.madeBy));
        }
        if (r.overlap) {
          const badge = document.createElement("span");
          badge.className = "logic-shared-badge";
          badge.textContent = TEXT[spec.many](kind === "block" ? r.groups : r.setBy.length);
          name.append(" ", badge);
        }
        tr.append(name);
        if (kind === "block") tr.append(cell("td", r.sections.join(", ")));
        tr.append(cell("td", r.setBy.join(", ")), cell("td", r.readBy.join(", ")));
        body.append(tr);
      }
      fold.append(h4, wrap);
    }
    section.append(fold);
    root.append(section);
  }

  const CONTROL_COLUMNS = Object.freeze([
    ["colSignal", "mast"], ["colAspect", "aspect"], ["colMeaning", "meaning"], ["colRule", "rule"], ["colWhen", "when"],
    ["colClear", "clear"], ["colTurnouts", "turnouts"], ["colOnlyIf", "onlyIf"], ["colTakes", "section"],
    ["colRelease", "release"], ["colHold", "hold"], ["colLocks", "locks"],
  ]);

  function renderControlTable(root, config, ctx, ui) {
    const section = ui.card("logic-control-table", TEXT.controlCard);
    const mss = isMss(config);
    section.append(ui.paragraph(mss ? TEXT.builtControlIntro : TEXT.controlIntro), ui.paragraph(mss ? TEXT.builtControlHint : TEXT.controlHint, "hint"));
    const rows = controlTable(config);
    if (!rows.length) {
      section.append(ui.paragraph(mss ? TEXT.builtNone : TEXT.noRules, "empty"));
      root.append(section);
      return;
    }
    const fold = foldEl(TEXT.controlShow, false);
    const { wrap, body } = tableEl(CONTROL_COLUMNS.map(([key]) => TEXT[key]), "logic-control");
    for (const r of rows) {
      const tr = document.createElement("tr");
      const mast = cell("th", r.mast || TEXT.noSignal);
      mast.scope = "row";
      const picture = r.mast && r.aspect ? ctx.mastPicture?.(r.mast, r.aspect) : null;
      if (picture) mast.prepend(picture, " ");
      tr.append(mast);
      for (const [, key] of CONTROL_COLUMNS.slice(1)) {
        const td = cell("td", r[key]);
        if (key === "rule" && r.madeBy) td.append(" ", builtBadge(r.madeBy));
        tr.append(td);
      }
      if (r.madeBy) tr.classList.add("is-built");
      body.append(tr);
    }
    fold.append(wrap);
    section.append(fold);
    root.append(section);
  }

  const api = global.EsphomeMrLogicUi;
  if (api) {
    api.registerPart({ id: "logic-layers-view", order: 90, modes: ["field", "mss"], text: TEXT, render: renderWhoUses });
    api.registerPart({ id: "logic-control-table", order: 95, modes: ["field", "mss"], text: TEXT, render: renderControlTable });
  }

  global.EsphomeMrLogicUiViews = { TEXT, whoUses, controlTable };
})(typeof globalThis !== "undefined" ? globalThis : window);
