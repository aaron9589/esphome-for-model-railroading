// Starters: Block signals and Route signal (docs/field-logic-spec.md,
// Starters; work item 2.8). Each is defined with
// EsphomeMrLogicStarters.defineStarter (block-signals, route-signal): pure
// defaults / problems / build for Node tests, and a form for the page.
//
// Block signals answers:
//   { name: "Up",                      the direction; the group's name
//     rows: [{ mast, noSignal, block, turnouts: [{ turnout, position }], aspects }],
//     beyond: "mast" | "end",          past the last block: the next signal, or
//     nextMast: name | { board, mast } end of signalled track (Ends: Release 3)
//     useAdvance, useDiverging,        Advance Approach, Approach Diverging
//     bothWays,                        a second group the other way, over the
//     back: { name, rows: [{ mast, noSignal, aspects }], beyond, nextMast } }
//   Each row is a signal and the block just beyond it, in the direction of
//   travel. back.rows[i] protects the blocks in reverse: rows[n - 1 - i].block.
//   noSignal makes a signal with no lights; its `mast` is its name, or empty
//   for "<direction> <block>". `aspects` is { clear, approach, advance,
//   diverging }: an empty one is prefilled from the mast's meanings.
//
// Route signal answers:
//   { name, mast, trigger,             group (default: the mast's name); the
//                                      block a train waits in (optional)
//     routeLocking, useAdvance, useDiverging,
//     rows: [{ turnouts: [{ turnout, position }], blocks: [...], diverging,
//              follow, aspect, next, aspects }] }
//   A row shows `aspect`, or with `follow` reads `next` as block signals do,
//   with `aspects` for each indication. `diverging` picks diverging aspects
//   when prefilling. Rows are written in table order: the first that matches
//   wins.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const S = () => global.EsphomeMrLogicStarters;
  const L = () => global.EsphomeMrLogicYaml;
  const M = () => global.EsphomeMr;

  const TEXT = Object.freeze({
    // Block signals.
    blockTitle: "Block signals",
    blockIntro: "List the signals in the direction trains run, each with the block just beyond it. Each signal shows Stop while its block has a train in it, then Approach, then Clear as the train moves on.",
    directionLabel: "Direction",
    directionHint: "For example Up or Eastbound. It names the group of rules.",
    signalTitle: (n) => `Signal ${n}`,
    signalLabel: "Signal",
    pickSignal: "Pick a signal",
    noSignal: "No signal here",
    noSignalHint: "Makes a signal with no lights, a pretend signal, so the signals behind it still work.",
    noSignalName: "Name of the signal with no lights",
    noSignalNameHint: (name) => `Leave empty for "${name}".`,
    blockLabel: "Block it protects",
    blockHint: "The block just beyond the signal.",
    pickBlock: "Pick a block",
    addSignal: "Add a signal",
    remove: "Remove",
    turnoutsLabel: "Turnouts in this block",
    turnoutsHint: "The signal shows Stop unless each is set for the main line.",
    pickTurnout: "Pick a turnout",
    addTurnout: "Add a turnout",
    positions: Object.freeze({ closed: "Closed", thrown: "Thrown" }),
    beyondLabel: "After the last block",
    beyondChoices: Object.freeze({ mast: "The next signal", end: "End of signalled track" }),
    beyondHint: "The next signal can be on this board, on a linked board, or one JMRI or CATS sets. Ends between boards come in a later version.",
    nextLabel: "Next signal",
    useAdvance: "Use Advance Approach",
    useAdvanceHint: "Two signals of warning: the signal before an Approach shows Advance Approach.",
    useDiverging: "Use Approach Diverging",
    useDivergingHint: "The signal before one showing a diverging route shows Approach Diverging. Without it, that signal shows Approach.",
    bothWays: "Both directions",
    bothWaysHint: "Adds a second group for the signals facing the other way, over the same blocks.",
    backName: "Other direction",
    backSignalTitle: (block) => `Signal that protects ${block || "?"}`,
    aspectsSummary: "What each signal shows",
    indications: Object.freeze({
      clear: "Clear",
      approach: "Approach",
      advance: "Advance Approach",
      diverging: "Approach Diverging",
    }),
    meanings: Object.freeze({ stop: "Stop", restricting: "Restricting", approach: "Approach", advance: "Advance Approach", clear: "Clear" }),
    pickAspect: "Pick an aspect",
    divergingWord: "diverging",
    // The aspects of a signal with no lights, and what each means.
    virtualAspects: Object.freeze({ stop: "Stop", approach: "Approach", advance: "Advance Approach", diverging: "Approach Diverging", clear: "Clear" }),
    // Route signal.
    routeTitle: "Route signal",
    routeIntro: "A signal at turnouts. List each route it can show, in order: the first route whose turnouts and blocks match is the one the signal shows. None means Stop.",
    groupLabel: "Group name",
    groupHint: "Leave empty to use the signal's name.",
    triggerLabel: "A train waits in (optional)",
    triggerHint: "Pick the block before the signal to clear it only for a waiting train. Leave empty to show the route whenever it is set and clear.",
    noBlock: "No block",
    routeLocking: "Lock the route",
    routeLockingHint: "Each route takes a section of its own and locks its turnouts until the train has passed. Needs the block a train waits in.",
    routeTitleN: (n) => `Route ${n}`,
    routeTurnouts: "Turnouts on the route",
    routeBlocks: "Blocks that must be clear",
    addBlock: "Add a block",
    divergingRoute: "Diverging route",
    divergingRouteHint: "The train takes a turnout at reduced speed, so the signal shows diverging aspects.",
    follow: "Follow the next signal",
    followHint: "The signal shows Clear, Advance Approach or Approach from what the next signal on this route shows, as block signals do.",
    showsLabel: "Shows",
    addRoute: "Add a route",
    routeSection: (group, n) => `${group} route ${n}`,
    // Problems.
    needRows: "Add at least one signal and the block it protects.",
    needSignal: (n) => `Signal ${n} has no signal. Pick one, or tick No signal here.`,
    needBlock: (n) => `Signal ${n} has no block. Pick the block just beyond it.`,
    needTurnout: (where) => `${where} has a turnout with nothing picked. Pick one, or remove it.`,
    needPosition: (where, name) => `${where}: pick the position of ${name} for the train's route.`,
    needAspect: (mast, indication) => `Pick what "${mast}" shows for ${indication}.`,
    notAspect: (mast, aspect) => `"${mast}" has no aspect called "${aspect}". Pick another.`,
    needNext: "Pick the next signal after the last block, or choose End of signalled track.",
    needBackNext: "Pick the next signal after the last block in the other direction, or choose End of signalled track.",
    twice: (mast) => `Signal "${mast}" is listed twice. Each signal protects one block in one direction.`,
    needBack: (block) => `Pick the signal facing the other way that protects ${block}, or tick No signal here.`,
    sameDirections: "The two directions need different names.",
    sameNoSignal: (name) => `Two signals with no lights would be called "${name}". Give one another name.`,
    needMast: "Pick the signal.",
    needRoutes: "Add at least one route.",
    routeNeedsBlock: (n) => `Route ${n} has no block that must be clear. Add one, or pick the block a train waits in.`,
    routeNeedsNext: (n) => `Route ${n} follows the next signal. Pick it.`,
    routeNeedsAspect: (n) => `Route ${n}: pick what the signal shows.`,
    lockingNeedsTrigger: "Lock the route needs the block a train waits in. Pick it, or untick Lock the route.",
    lockingNeedsBlocks: (n) => `Route ${n} has no blocks, so it has no section to take. Add its blocks, or untick Lock the route.`,
    lockingFollow: (n) => `Route ${n} follows the next signal, which Lock the route cannot do yet: once the route was taken, the signal would stop following. Untick one of them.`,
    lockingShared: (a, b, block) => `Routes ${a} and ${b} both have block "${block}". With Lock the route each route takes a section of its own, and a block can be in one section only. Leave it out of one route, or untick Lock the route.`,
  });

  // ===== References and conditions ==========================================

  // What a plant end hears as the next signal: { end, track } (the MSS
  // builder writes these; the engine reads them as `hears: "mast"`).
  const isEndRef = (ref) => isObject(ref) && ref.end !== undefined && ref.track !== undefined;
  const filled = (ref) => (typeof ref === "string" ? ref.trim() !== "" : isObject(ref) && (!!ref.board || isEndRef(ref)));
  const nameOf = (ref) => (typeof ref === "string" ? ref : String(ref?.mast ?? ref?.block ?? ref?.sensor ?? ref?.turnout ?? ""));
  const sameRef = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const blockIs = (ref, is) => (typeof ref === "string" ? { block: ref, is } : { ...ref, is });
  const mastIs = (ref, is) => (typeof ref === "string" ? { mast: ref, is }
    : isEndRef(ref) ? { end: ref.end, track: ref.track, hears: "mast", is }
      : { board: ref.board, mast: ref.mast, is });
  const turnoutIs = (t) => (typeof t.turnout === "string" ? { turnout: t.turnout, is: t.position } : { ...t.turnout, is: t.position });
  const turnoutChecks = (turnouts) => list(turnouts).filter((t) => isObject(t) && filled(t.turnout)).map(turnoutIs);

  // ===== Aspects ============================================================

  const INDICATIONS = Object.freeze(["clear", "approach", "advance", "diverging"]);
  // What a CATS mast shows for each indication (spec, Block signals); for a
  // diverging route, Medium Clear, Medium Approach and Medium Approach Medium.
  const CATS = Object.freeze({ clear: "R281", approach: "R285", advance: "ADV_NORM", diverging: "R282" });
  const CATS_DIVERGING = Object.freeze({ clear: "R283", approach: "R286", advance: "", diverging: "R283A" });

  // The aspect of `ref` whose JMRI name is `jmri`, by its label here.
  function namedAspect(config, ref, jmri) {
    if (!jmri) return "";
    const real = typeof ref === "string" ? list(config.signals?.masts).find((m) => m.name === ref) : null;
    if (real) {
      const found = list(real.aspects).find((a) => L().aspectName(a) === jmri);
      return found ? String(found.label ?? "") : "";
    }
    return S().mastMeanings(config, ref).some((a) => a.aspect === jmri) ? jmri : "";
  }

  /**
   * What `ref` shows for one indication, prefilled: the CATS aspect where the
   * mast has it, else the first aspect with that meaning. Approach Diverging
   * has no meaning of its own (it is a Clear), so off CATS it is the aspect
   * named for it. `diverging` (a diverging route) prefers diverging aspects.
   */
  function prefillAspect(config, ref, indication, { diverging = false } = {}) {
    if (!filled(ref)) return "";
    const named = namedAspect(config, ref, (diverging ? CATS_DIVERGING : CATS)[indication]);
    if (named) return named;
    const pick = (meaning) => (diverging
      ? S().aspectFor(config, ref, meaning, { diverging: true }) || S().aspectFor(config, ref, meaning)
      : S().aspectFor(config, ref, meaning, { diverging: false }));
    if (indication === "diverging") {
      const own = S().mastMeanings(config, ref).find((a) => /diverging/i.test(a.aspect));
      return own?.aspect || (diverging ? pick("approach") : "");
    }
    // No diverging Advance Approach (CATS has none): the diverging Clear.
    if (indication === "advance") return diverging ? S().aspectFor(config, ref, "advance", { diverging: true }) || prefillAspect(config, ref, "clear", { diverging }) : pick("advance");
    return pick(indication);
  }

  function prefillAspects(config, ref, { diverging = false } = {}) {
    return Object.fromEntries(INDICATIONS.map((i) => [i, prefillAspect(config, ref, i, { diverging })]));
  }

  // The answers' aspects, with empty ones prefilled.
  function aspectsOf(config, ref, given, { diverging = false } = {}) {
    const own = isObject(given) ? given : {};
    return Object.fromEntries(INDICATIONS.map((i) => [i, String(own[i] || "") || prefillAspect(config, ref, i, { diverging })]));
  }

  // The indications a starter writes rules for.
  const usedIndications = (a) => INDICATIONS.filter((i) => (i === "advance" ? a.useAdvance : i === "diverging" ? a.useDiverging : true));

  // A signal with no lights, as Masts stores it.
  function virtualEntry(name, a) {
    const V = TEXT.virtualAspects;
    const pairs = [[V.stop, "stop"], [V.approach, "approach"]];
    if (a.useAdvance) pairs.push([V.advance, "advance"]);
    if (a.useDiverging) pairs.push([V.diverging, "clear"]);
    pairs.push([V.clear, "clear"]);
    return {
      virtual: true, name, topic: M().topicFor("signal", name),
      aspects: pairs.map(([aspect]) => aspect),
      tags: Object.fromEntries(pairs),
    };
  }
  const virtualAspects = () => {
    const V = TEXT.virtualAspects;
    return { clear: V.clear, approach: V.approach, advance: V.advance, diverging: V.diverging };
  };

  // ===== The rules both starters write ======================================

  /**
   * A signal that reads the next one (spec, Block signals, rules 1 to 4), each
   * rule with `trigger` and `checks` first. With no next signal (end of
   * signalled track), only rule 4, with no next-signal check.
   */
  function followRules({ trigger, checks, mast, aspects, next, useAdvance, useDiverging, then = {} }) {
    const rule = (extra, aspect) => ({
      trigger: JSON.parse(JSON.stringify(trigger)),
      checks: [...checks.map((c) => ({ ...c })), ...extra],
      then: { mast, aspect, ...then },
    });
    if (!filled(next)) return [rule([], aspects.approach)];
    const n = (is) => mastIs(next, is);
    // What an end hears is a meaning only, never diverging, so rule 1 could
    // never apply there and is left out.
    const divergingRule = isEndRef(next) ? [] : [rule([n("diverging"), { not: n(["stop", "restricting"]) }], useDiverging ? aspects.diverging : aspects.approach)];
    return [
      ...divergingRule,
      rule([n(["advance", "clear"])], aspects.clear),
      rule([n("approach")], useAdvance ? aspects.advance : aspects.clear),
      rule([n(["stop", "restricting"])], aspects.approach),
    ];
  }

  // Signal names taken on this board: Signal Masts page and signals with no lights.
  const signalNames = (config) => new Set([
    ...list(config.signals?.masts).map((m) => String(m.name ?? "")),
    ...list(config.logic?.masts).filter((m) => isObject(m) && m.virtual === true).map((m) => String(m.name ?? "")),
  ]);

  // ===== Block signals ======================================================

  const newSignalRow = () => ({ mast: "", noSignal: false, block: "", turnouts: [], aspects: {} });
  const newBackRow = () => ({ mast: "", noSignal: false, aspects: {} });

  function blockSignalsDefaults(config) {
    const groups = list(config.logic?.layers).filter(isObject).map((g) => String(g.name ?? ""));
    return {
      name: S().freeName("Up", groups),
      rows: [newSignalRow()],
      beyond: "mast",
      nextMast: "",
      useAdvance: false,
      useDiverging: false,
      bothWays: false,
      back: { name: S().freeName("Down", groups), rows: [newBackRow()], beyond: "end", nextMast: "" },
    };
  }

  // Each direction as { name, blocks: [{ block, turnouts }], masts: [row], beyond, nextMast }.
  function directions(a) {
    const rows = list(a.rows).filter(isObject);
    const out = [{
      name: String(a.name ?? "").trim(),
      blocks: rows.map((r) => ({ block: r.block, turnouts: r.turnouts })),
      masts: rows,
      beyond: a.beyond, nextMast: a.nextMast,
    }];
    if (a.bothWays) {
      const back = isObject(a.back) ? a.back : {};
      out.push({
        name: String(back.name ?? "").trim(),
        blocks: [...out[0].blocks].reverse(),
        masts: list(back.rows).filter(isObject),
        beyond: back.beyond, nextMast: back.nextMast,
        back: true,
      });
    }
    return out;
  }

  // The signal each row sets: its mast, or a signal with no lights, named here.
  function rowSignals(config, a) {
    const taken = signalNames(config);
    const out = [];
    for (const dir of directions(a)) {
      const masts = dir.blocks.map((b, i) => {
        const row = dir.masts[i] || {};
        if (row.noSignal) {
          const typed = String(row.mast ?? "").trim();
          const name = typed || S().freeName(`${dir.name} ${nameOf(b.block)}`.trim(), taken);
          taken.add(name);
          return { name, virtual: true, aspects: virtualAspects() };
        }
        return { name: typeof row.mast === "string" ? row.mast : "", virtual: false, aspects: aspectsOf(config, row.mast, row.aspects) };
      });
      out.push({ dir, masts });
    }
    return out;
  }

  function blockSignalsProblems(config, a) {
    const out = [];
    const rows = list(a.rows).filter(isObject);
    if (!rows.length) return [TEXT.needRows];
    const own = new Set(list(config.signals?.masts).map((m) => m.name));
    const seen = new Set();
    rows.forEach((row, i) => {
      const where = TEXT.signalTitle(i + 1);
      if (!row.noSignal && !filled(row.mast)) out.push(TEXT.needSignal(i + 1));
      if (!filled(row.block)) out.push(TEXT.needBlock(i + 1));
      for (const t of list(row.turnouts)) {
        if (!isObject(t) || !filled(t.turnout)) out.push(TEXT.needTurnout(where));
        else if (!["closed", "thrown"].includes(t.position)) out.push(TEXT.needPosition(where, nameOf(t.turnout)));
      }
    });
    if (a.beyond !== "end" && !filled(a.nextMast)) out.push(TEXT.needNext);
    if (a.bothWays) {
      const back = isObject(a.back) ? a.back : {};
      const backRows = list(back.rows);
      [...rows].reverse().forEach((row, i) => {
        const b = backRows[i];
        if (!isObject(b) || (!b.noSignal && !filled(b.mast))) out.push(TEXT.needBack(nameOf(row.block) || "?"));
      });
      if (back.beyond !== "end" && !filled(back.nextMast)) out.push(TEXT.needBackNext);
      if (String(back.name ?? "").trim() && String(back.name).trim() === String(a.name ?? "").trim()) out.push(TEXT.sameDirections);
    }
    if (out.length) return out;
    // Each signal once, with an aspect for each indication used.
    const used = usedIndications(a);
    const virtualNames = new Set();
    for (const { masts } of rowSignals(config, a)) {
      for (const mast of masts) {
        if (mast.virtual) {
          if (virtualNames.has(mast.name)) out.push(TEXT.sameNoSignal(mast.name));
          virtualNames.add(mast.name);
          continue;
        }
        if (seen.has(mast.name)) out.push(TEXT.twice(mast.name));
        seen.add(mast.name);
        if (!own.has(mast.name)) continue;
        const names = S().mastMeanings(config, mast.name).map((x) => x.aspect);
        for (const i of used) {
          const aspect = mast.aspects[i];
          if (!aspect) out.push(TEXT.needAspect(mast.name, TEXT.indications[i]));
          else if (!names.includes(aspect)) out.push(TEXT.notAspect(mast.name, aspect));
        }
      }
    }
    return [...new Set(out)];
  }

  function blockSignalsBuild(config, a) {
    const groups = [];
    const virtualMasts = [];
    for (const { dir, masts } of rowSignals(config, a)) {
      const rules = [];
      dir.blocks.forEach((b, i) => {
        const mast = masts[i];
        if (mast.virtual) virtualMasts.push(virtualEntry(mast.name, a));
        const next = i + 1 < masts.length ? masts[i + 1].name : (dir.beyond === "end" ? "" : dir.nextMast);
        rules.push(...followRules({
          trigger: { while: blockIs(b.block, "clear") },
          checks: turnoutChecks(b.turnouts),
          mast: mast.name, aspects: mast.aspects, next,
          useAdvance: !!a.useAdvance, useDiverging: !!a.useDiverging,
        }));
      });
      groups.push({ name: dir.name, starter: "block-signals", rules });
    }
    return { groups, virtualMasts };
  }

  // ===== Route signal =======================================================

  const newRouteRow = () => ({ turnouts: [], blocks: [""], diverging: false, follow: false, aspect: "", next: "", aspects: {} });

  function routeSignalDefaults() {
    return { name: "", mast: "", trigger: "", routeLocking: false, useAdvance: false, useDiverging: false, rows: [newRouteRow()] };
  }

  const routeBlocks = (row) => list(row.blocks).filter(filled);
  const routeName = (a) => String(a.name ?? "").trim() || (typeof a.mast === "string" ? a.mast : "");

  // With Lock the route, each route's section: rows with the same blocks share
  // one. Returns [{ name, blocks }] by row (null for a row with no blocks).
  function routeSections(config, a) {
    const taken = new Set(list(config.logic?.resources).filter(isObject).map((s) => String(s.name ?? "")));
    const made = [];
    return list(a.rows).filter(isObject).map((row, i) => {
      const blocks = routeBlocks(row);
      if (!blocks.length) return null;
      const key = JSON.stringify([...blocks.map((b) => JSON.stringify(b))].sort());
      const same = made.find((s) => s.key === key);
      if (same) return same;
      const name = S().freeName(TEXT.routeSection(routeName(a), i + 1), taken);
      taken.add(name);
      const section = { key, name, blocks };
      made.push(section);
      return section;
    });
  }

  function routeSignalProblems(config, a) {
    const out = [];
    if (!filled(a.mast)) out.push(TEXT.needMast);
    const rows = list(a.rows).filter(isObject);
    if (!rows.length) out.push(TEXT.needRoutes);
    const trigger = filled(a.trigger);
    if (a.routeLocking && !trigger) out.push(TEXT.lockingNeedsTrigger);
    const names = filled(a.mast) ? S().mastMeanings(config, a.mast).map((x) => x.aspect) : [];
    rows.forEach((row, i) => {
      const where = TEXT.routeTitleN(i + 1);
      for (const t of list(row.turnouts)) {
        if (!isObject(t) || !filled(t.turnout)) out.push(TEXT.needTurnout(where));
        else if (!["closed", "thrown"].includes(t.position)) out.push(TEXT.needPosition(where, nameOf(t.turnout)));
      }
      const blocks = routeBlocks(row);
      if (!blocks.length && !trigger) out.push(TEXT.routeNeedsBlock(i + 1));
      if (a.routeLocking && !blocks.length) out.push(TEXT.lockingNeedsBlocks(i + 1));
      if (a.routeLocking && row.follow) out.push(TEXT.lockingFollow(i + 1));
      if (!filled(a.mast)) return;
      if (row.follow) {
        if (!filled(row.next)) out.push(TEXT.routeNeedsNext(i + 1));
        const aspects = aspectsOf(config, a.mast, row.aspects, { diverging: !!row.diverging });
        for (const ind of usedIndications(a)) {
          if (!aspects[ind]) out.push(TEXT.needAspect(a.mast, TEXT.indications[ind]));
          else if (!names.includes(aspects[ind])) out.push(TEXT.notAspect(a.mast, aspects[ind]));
        }
      } else if (!String(row.aspect || "")) out.push(TEXT.routeNeedsAspect(i + 1));
      else if (!names.includes(row.aspect)) out.push(TEXT.notAspect(a.mast, row.aspect));
    });
    if (a.routeLocking && !out.length) {
      // A block can be in one section only (spec, Sharing inputs).
      const sections = routeSections(config, a);
      for (let i = 0; i < rows.length; i += 1) {
        for (let j = i + 1; j < rows.length; j += 1) {
          if (!sections[i] || !sections[j] || sections[i] === sections[j]) continue;
          const shared = sections[i].blocks.find((b) => sections[j].blocks.some((c) => sameRef(b, c)));
          if (shared) out.push(TEXT.lockingShared(i + 1, j + 1, nameOf(shared)));
        }
      }
    }
    return [...new Set(out)];
  }

  function routeSignalBuild(config, a) {
    const mast = a.mast;
    const trigger = filled(a.trigger);
    const sections = a.routeLocking ? routeSections(config, a) : [];
    const rules = [];
    list(a.rows).filter(isObject).forEach((row, i) => {
      const blocks = routeBlocks(row);
      // The When: a train waiting, or else the route's first block clear.
      const when = trigger
        ? { while: blockIs(a.trigger, "occupied"), for: "0.5s" }
        : { while: blockIs(blocks[0], "clear") };
      const checks = [...turnoutChecks(row.turnouts), ...(trigger ? blocks : blocks.slice(1)).map((b) => blockIs(b, "clear"))];
      if (row.follow) {
        rules.push(...followRules({
          trigger: when, checks, mast, next: row.next,
          aspects: aspectsOf(config, mast, row.aspects, { diverging: !!row.diverging }),
          useAdvance: !!a.useAdvance, useDiverging: !!a.useDiverging,
        }));
        return;
      }
      const then = { mast, aspect: row.aspect };
      const section = sections[i];
      if (section) {
        then.reserve = section.name;
        const lock = list(row.turnouts).filter((t) => isObject(t) && typeof t.turnout === "string" && t.turnout).map((t) => t.turnout);
        if (lock.length) then.lock = lock;
      }
      rules.push({ trigger: when, checks, then });
    });
    const used = [...new Set(sections.filter(Boolean))];
    return {
      groups: [{ name: routeName(a), starter: "route-signal", rules }],
      sections: used.map((s) => ({
        name: s.name,
        blocks: s.blocks,
        release: { while: { all: s.blocks.map((b) => blockIs(b, "clear")) }, for: "3s" },
      })),
    };
  }

  // ===== The forms (browser only) ===========================================

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

  // A picker with a label, from ui.itemChoices groups.
  function picker(ui, label, groups, current, onChange, prompt, hint) {
    const wrap = el("label", "starter-signals-field");
    wrap.append(el("span", "field-label", label), ui.selectEl(groups, current, onChange, { prompt, label }));
    if (hint) wrap.append(el("span", "hint", hint));
    return wrap;
  }

  // An aspect of `ref` for one indication, with the mast drawn beside it.
  function aspectPicker(config, ctx, label, ref, value, onChange) {
    const options = [{ value: "", label: TEXT.pickAspect }, ...S().mastMeanings(config, ref).map((x) => ({
      value: x.aspect,
      label: `${x.aspect} (${TEXT.meanings[x.meaning] || x.meaning}${x.diverging ? `, ${TEXT.divergingWord}` : ""})`,
    }))];
    const row = el("div", "starter-signals-aspect");
    row.append(ctx.field(label, value, onChange, { select: options }));
    const picture = typeof ref === "string" ? ctx.mastPicture?.(ref, value) : null;
    if (picture) row.append(picture);
    return row;
  }

  function aspectsFold(config, ctx, a, ref, aspects, redraw) {
    const fold = el("details", "starter-signals-more");
    fold.append(el("summary", "", TEXT.aspectsSummary));
    for (const ind of usedIndications(a)) {
      fold.append(aspectPicker(config, ctx, TEXT.indications[ind], ref, aspects[ind] || "", (value) => {
        aspects[ind] = value;
        redraw();
      }));
    }
    return fold;
  }

  // Turnouts and their positions, with Add and Remove.
  function turnoutsEl(ui, ctx, config, label, hint, turnouts, redraw) {
    const box = el("div", "starter-signals-list");
    box.append(el("span", "field-label", label));
    if (hint) box.append(el("span", "hint", hint));
    const choices = ui.itemChoices(config, "turnout");
    turnouts.forEach((t, i) => {
      const row = el("div", "starter-signals-inline");
      row.append(ui.selectEl(choices, t.turnout, (value) => { t.turnout = value; }, { prompt: TEXT.pickTurnout, label }));
      const positions = Object.entries(TEXT.positions).map(([value, text]) => ({ value, label: text }));
      row.append(ctx.field("", t.position, (value) => { t.position = value; }, { select: positions }));
      row.append(button(TEXT.remove, () => { turnouts.splice(i, 1); redraw(); }, "remove"));
      box.append(row);
    });
    box.append(button(TEXT.addTurnout, () => { turnouts.push({ turnout: "", position: "closed" }); redraw(); }));
    return box;
  }

  function beyondEl(ctx, ui, config, target, redraw) {
    const box = el("div", "starter-signals-list");
    const options = Object.entries(TEXT.beyondChoices).map(([value, label]) => ({ value, label }));
    box.append(ctx.field(TEXT.beyondLabel, target.beyond === "end" ? "end" : "mast", (value) => { target.beyond = value; redraw(); }, { select: options, hint: TEXT.beyondHint }));
    if (target.beyond !== "end") {
      box.append(picker(ui, TEXT.nextLabel, ui.itemChoices(config, "mast", { remote: true }), target.nextMast, (value) => { target.nextMast = value; }, TEXT.pickSignal));
    }
    return box;
  }

  // A signal row's mast, or its signal with no lights.
  function signalEl(ctx, ui, config, a, row, defaultName, redraw) {
    const box = el("div", "starter-signals-list");
    if (!row.noSignal) {
      box.append(picker(ui, TEXT.signalLabel, ui.itemChoices(config, "mast"), row.mast, (value) => {
        row.mast = value;
        row.aspects = prefillAspects(config, value);
        redraw();
      }, TEXT.pickSignal));
    }
    box.append(ctx.field(TEXT.noSignal, !!row.noSignal, (checked) => {
      row.noSignal = checked;
      row.mast = "";
      row.aspects = {};
      redraw();
    }, { checkbox: true, hint: TEXT.noSignalHint }));
    if (row.noSignal) {
      box.append(ctx.field(TEXT.noSignalName, row.mast, (value) => { row.mast = value; }, { hint: TEXT.noSignalNameHint(defaultName) }));
    } else if (filled(row.mast)) {
      box.append(aspectsFold(config, ctx, a, row.mast, row.aspects || (row.aspects = {}), redraw));
    }
    return box;
  }

  function blockSignalsForm(config, ctx, ui) {
    const a = S().defaults("block-signals", config);
    const blocks = ui.itemChoices(config, "block", { remote: true });
    // The other direction has one signal for each block.
    const syncBack = () => {
      while (a.back.rows.length < a.rows.length) a.back.rows.push(newBackRow());
      a.back.rows.length = a.rows.length;
    };
    S().dialog({
      title: TEXT.blockTitle,
      intro: TEXT.blockIntro,
      fill(body, redraw) {
        body.append(ctx.field(TEXT.directionLabel, a.name, (value) => { a.name = value; }, { hint: TEXT.directionHint }));
        a.rows.forEach((row, i) => {
          const card = ui.rowCard(TEXT.signalTitle(i + 1), a.rows.length > 1 ? () => { a.rows.splice(i, 1); a.back.rows.splice(a.rows.length - i, 1); syncBack(); redraw(); } : null, "starter-signals-row");
          card.item.append(signalEl(ctx, ui, config, a, row, `${a.name} ${nameOf(row.block)}`, redraw));
          card.item.append(picker(ui, TEXT.blockLabel, blocks, row.block, (value) => { row.block = value; }, TEXT.pickBlock, TEXT.blockHint));
          card.item.append(turnoutsEl(ui, ctx, config, TEXT.turnoutsLabel, TEXT.turnoutsHint, row.turnouts, redraw));
          body.append(card.item);
        });
        body.append(button(TEXT.addSignal, () => { a.rows.push(newSignalRow()); a.back.rows.unshift(newBackRow()); syncBack(); redraw(); }));
        body.append(beyondEl(ctx, ui, config, a, redraw));
        body.append(ctx.field(TEXT.useAdvance, !!a.useAdvance, (checked) => { a.useAdvance = checked; redraw(); }, { checkbox: true, hint: TEXT.useAdvanceHint }));
        body.append(ctx.field(TEXT.useDiverging, !!a.useDiverging, (checked) => { a.useDiverging = checked; redraw(); }, { checkbox: true, hint: TEXT.useDivergingHint }));
        body.append(ctx.field(TEXT.bothWays, !!a.bothWays, (checked) => { a.bothWays = checked; syncBack(); redraw(); }, { checkbox: true, hint: TEXT.bothWaysHint }));
        if (!a.bothWays) return;
        body.append(ctx.field(TEXT.backName, a.back.name, (value) => { a.back.name = value; }, { hint: TEXT.directionHint }));
        const reversed = [...a.rows].reverse();
        a.back.rows.forEach((row, i) => {
          const block = nameOf(reversed[i]?.block);
          const card = ui.rowCard(TEXT.backSignalTitle(block), null, "starter-signals-row");
          card.item.append(signalEl(ctx, ui, config, a, row, `${a.back.name} ${block}`, redraw));
          body.append(card.item);
        });
        body.append(beyondEl(ctx, ui, config, a.back, redraw));
      },
      check: () => S().problems("block-signals", config, a),
      done() {
        S().apply("block-signals", config, a);
        ctx.persist();
        ctx.render();
      },
    });
  }

  function routeSignalForm(config, ctx, ui) {
    const a = S().defaults("route-signal", config);
    const blocks = ui.itemChoices(config, "block", { remote: true });
    const refill = (row) => {
      row.aspects = prefillAspects(config, a.mast, { diverging: !!row.diverging });
      row.aspect = prefillAspect(config, a.mast, "clear", { diverging: !!row.diverging });
    };
    S().dialog({
      title: TEXT.routeTitle,
      intro: TEXT.routeIntro,
      fill(body, redraw) {
        body.append(picker(ui, TEXT.signalLabel, ui.itemChoices(config, "mast"), a.mast, (value) => {
          a.mast = value;
          a.rows.forEach(refill);
          redraw();
        }, TEXT.pickSignal));
        body.append(ctx.field(TEXT.groupLabel, a.name, (value) => { a.name = value; }, { hint: TEXT.groupHint }));
        body.append(picker(ui, TEXT.triggerLabel, blocks, a.trigger, (value) => { a.trigger = value; }, TEXT.noBlock, TEXT.triggerHint));
        body.append(ctx.field(TEXT.routeLocking, !!a.routeLocking, (checked) => { a.routeLocking = checked; }, { checkbox: true, hint: TEXT.routeLockingHint }));
        body.append(ctx.field(TEXT.useAdvance, !!a.useAdvance, (checked) => { a.useAdvance = checked; redraw(); }, { checkbox: true, hint: TEXT.useAdvanceHint }));
        body.append(ctx.field(TEXT.useDiverging, !!a.useDiverging, (checked) => { a.useDiverging = checked; redraw(); }, { checkbox: true, hint: TEXT.useDivergingHint }));
        a.rows.forEach((row, i) => {
          const card = ui.rowCard(TEXT.routeTitleN(i + 1), a.rows.length > 1 ? () => { a.rows.splice(i, 1); redraw(); } : null, "starter-signals-row");
          card.item.append(turnoutsEl(ui, ctx, config, TEXT.routeTurnouts, "", row.turnouts, redraw));
          const list_ = el("div", "starter-signals-list");
          list_.append(el("span", "field-label", TEXT.routeBlocks));
          row.blocks.forEach((block, j) => {
            const line = el("div", "starter-signals-inline");
            line.append(ui.selectEl(blocks, block, (value) => { row.blocks[j] = value; }, { prompt: TEXT.pickBlock, label: TEXT.routeBlocks }));
            line.append(button(TEXT.remove, () => { row.blocks.splice(j, 1); redraw(); }, "remove"));
            list_.append(line);
          });
          list_.append(button(TEXT.addBlock, () => { row.blocks.push(""); redraw(); }));
          card.item.append(list_);
          card.item.append(ctx.field(TEXT.divergingRoute, !!row.diverging, (checked) => { row.diverging = checked; refill(row); redraw(); }, { checkbox: true, hint: TEXT.divergingRouteHint }));
          card.item.append(ctx.field(TEXT.follow, !!row.follow, (checked) => { row.follow = checked; redraw(); }, { checkbox: true, hint: TEXT.followHint }));
          if (row.follow) {
            card.item.append(picker(ui, TEXT.nextLabel, ui.itemChoices(config, "mast", { remote: true }), row.next, (value) => { row.next = value; }, TEXT.pickSignal));
            if (filled(a.mast)) card.item.append(aspectsFold(config, ctx, a, a.mast, row.aspects || (row.aspects = {}), redraw));
          } else if (filled(a.mast)) {
            card.item.append(aspectPicker(config, ctx, TEXT.showsLabel, a.mast, row.aspect || "", (value) => { row.aspect = value; redraw(); }));
          }
          body.append(card.item);
        });
        body.append(button(TEXT.addRoute, () => {
          const row = newRouteRow();
          if (filled(a.mast)) refill(row);
          a.rows.push(row);
          redraw();
        }));
      },
      check: () => S().problems("route-signal", config, a),
      done() {
        S().apply("route-signal", config, a);
        ctx.persist();
        ctx.render();
      },
    });
  }

  // ===== Registration =======================================================

  S().defineStarter("block-signals", {
    defaults: blockSignalsDefaults,
    problems: blockSignalsProblems,
    build: blockSignalsBuild,
    form: blockSignalsForm,
    text: TEXT,
  });

  S().defineStarter("route-signal", {
    defaults: routeSignalDefaults,
    problems: routeSignalProblems,
    build: routeSignalBuild,
    form: routeSignalForm,
    text: TEXT,
  });

  global.EsphomeMrLogicStartersSignals = { TEXT, prefillAspect, prefillAspects, followRules };
})(typeof globalThis !== "undefined" ? globalThis : window);
