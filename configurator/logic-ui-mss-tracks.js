// The Logic page in MSS Logic mode: the MSS page's strip editor for tracks (logic-mss-tracks). Work item 4.2b.
// Loaded after mss-builder.js. Parts register with EsphomeMrLogicUi.registerPart
// (modes: ["mss"]), using the part ids in EsphomeMrMssBuilder.PARTS, and keep
// every word in their TEXT for the plain-words lint.
//
// What it edits (docs/mss-emulation-spec.md, Stored format), in logic.mss.tracks:
//   { from: { end: "A", track: 1 } | { junction: "J1", leg: 1 },
//     to:   { end, track } | { junction, leg } | null,                     null: stops on the module
//     blocks:     [ { sensors: ["S1 current"], turnouts: [ { turnout: "P1", position: "closed" } ] } ],
//     boundaries: [ { sensors: ["S1/S2 optical"], towardsFrom: "Mast" | null, towardsTo: "Mast" | null } ] }
// There is one boundary between each two blocks (boundary k sits between block k
// and block k + 1). The logic is in the pure functions below, which
// test/mss-tracks.test.js checks without a DOM; the render functions at the end
// only draw them.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const B = () => global.EsphomeMrMssBuilder;
  const UI = () => global.EsphomeMrLogicUi;

  const TEXT = Object.freeze({
    card: "Tracks",
    intro: "Draw each track from one place to another, the way it lies on the module. Each track is a row of blocks. Each block has a current sensor that sees a train in it. Between two blocks is a block boundary, with an optical sensor and a signal facing each way. The tracks are drawn in the picture of the module at the top: click a block or a block boundary there to edit it here.",
    pickOnPicture: "Click a block or block boundary of this track in the picture of the module to edit it.",
    editTrack: "Edit its first block",
    inTrack: (n, title) => `Track ${n}: ${title}`,
    signalNote: "A side with no signal gets a signal with no lights, so the signals behind keep working.",
    empty: "No tracks yet. Add a track for each end track and each leg of a junction.",
    addTrack: "Add a track",
    trackTitle: (n, from, to) => `Track ${n}: ${from} to ${to}`,
    removeTrack: "Remove",
    fromLabel: "From",
    toLabel: "To",
    fromHint: "Where the track starts: an end track, or a leg of a junction.",
    toHint: "Where it finishes. Pick a dead end if the track stops on the module.",
    pickPlace: "Pick a place",
    endPlace: (end, track) => `End ${end}, track ${track}`,
    legPlace: (junction, leg) => `Junction ${junction}, leg ${leg}`,
    deadEnd: "Dead end (stops on the module)",
    endsGroup: "End tracks",
    legsGroup: "Legs at junctions",
    placeMissing: "not found",
    through: "Through track (no signals)",
    stripLabel: (label) => `Strip for ${label}`,
    blockLabel: (n) => `Block ${n}`,
    boundaryLabel: (n) => `Block boundary ${n}`,
    noSensor: "no sensor",
    noSignal: "no signal",
    optical: (names) => `optical: ${names}`,
    towardsFromArrow: (name) => `◀ ${name}`,
    towardsToArrow: (name) => `${name} ▶`,
    turnoutMark: (name, position) => `${name} ${position}`,
    problemCount: (n) => `${n} to fix`,
    // The form for a block.
    blockTitle: (n) => `Block ${n}`,
    blockHint: "Pick the current sensor, and any turnouts in this block with the position that is the main line.",
    sensorsLabel: "Sensors",
    sensorsEmpty: "No sensors yet.",
    addSensor: "Add a sensor…",
    noSensors: "Add sensors on the Sensors page, then pick them here.",
    removeSensor: (name) => `Remove ${name}`,
    turnoutsLabel: "Turnouts in this block",
    turnoutsHint: "A turnout set against the main line counts as an occupied block.",
    addTurnout: "Add a turnout",
    pickTurnout: "Pick a turnout",
    positionLabel: "Main line is",
    closed: "Closed",
    thrown: "Thrown",
    removeTurnout: "Remove turnout",
    // The form for a block boundary.
    boundaryTitle: (n) => `Block boundary ${n}`,
    boundaryHint: "Pick its optical sensor, and the signal a train sees going each way.",
    towardsFromLabel: (place) => `Signal for trains heading towards ${place}`,
    towardsToLabel: (place) => `Signal for trains heading towards ${place}`,
    towardsFromShort: "From",
    towardsToShort: "To",
    // Blocks.
    blocksLabel: "Blocks",
    splitBlock: "Split this block in two",
    addBoundary: "Add a block boundary",
    addBoundaryHint: "Splits the last block in two.",
    moveBefore: "Move earlier",
    moveAfter: "Move later",
    removeBlock: "Remove this block",
    removeBlockHint: "The block boundary next to it goes too.",
    problemsLabel: "To fix",
  });

  // ===== Pure logic: reading and editing =====================================

  function mssOf(config) {
    const logic = config.logic || (config.logic = {});
    if (!isObject(logic.mss)) logic.mss = {};
    return logic.mss;
  }

  function tracksOf(config) {
    const mss = mssOf(config);
    if (!Array.isArray(mss.tracks)) mss.tracks = [];
    return mss.tracks;
  }

  // A track with the arrays the editor needs, in place.
  function tidyTrack(track) {
    if (!Array.isArray(track.blocks)) track.blocks = [];
    if (!Array.isArray(track.boundaries)) track.boundaries = [];
    track.blocks.forEach((block, i) => {
      if (!isObject(block)) track.blocks[i] = { sensors: [], turnouts: [] };
      if (!Array.isArray(track.blocks[i].sensors)) track.blocks[i].sensors = [];
      if (!Array.isArray(track.blocks[i].turnouts)) track.blocks[i].turnouts = [];
    });
    track.boundaries.forEach((boundary, i) => {
      if (!isObject(boundary)) track.boundaries[i] = { sensors: [], towardsFrom: null, towardsTo: null };
      if (!Array.isArray(track.boundaries[i].sensors)) track.boundaries[i].sensors = [];
    });
    return track;
  }

  const newBlock = () => ({ sensors: [], turnouts: [] });
  const newBoundary = () => ({ sensors: [], towardsFrom: null, towardsTo: null });

  const samePlace = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  // The legs a junction has: the legs its routes name, then any a track uses.
  function junctionLegs(config, junction) {
    const legs = new Set();
    for (const route of list(junction.routes)) for (const leg of list(route?.legs)) if (Number.isInteger(Number(leg)) && Number(leg) >= 1) legs.add(Number(leg));
    return [...legs].sort((a, b) => a - b);
  }

  /**
   * Every place a track can start or finish, as groups for a dropdown:
   * [{ label, options: [{ value: { end, track } | { junction, leg } | null, text }] }].
   * `to` adds the dead end, which stores null.
   */
  function placeChoices(config, { to = false } = {}) {
    const mss = mssOf(config);
    const groups = [];
    const ends = [];
    for (const end of list(mss.ends).filter(isObject)) {
      const name = String(end.name ?? "").trim();
      const count = Number(end.tracks);
      if (!name || !Number.isInteger(count)) continue;
      for (let track = 1; track <= count; track += 1) ends.push({ value: { end: name, track }, text: TEXT.endPlace(name, track) });
    }
    if (ends.length) groups.push({ label: TEXT.endsGroup, options: ends });
    const legs = [];
    for (const junction of list(mss.junctions).filter(isObject)) {
      const name = String(junction.name ?? "").trim();
      if (!name) continue;
      for (const leg of junctionLegs(config, junction)) legs.push({ value: { junction: name, leg }, text: TEXT.legPlace(name, leg) });
    }
    if (legs.length) groups.push({ label: TEXT.legsGroup, options: legs });
    if (to) groups.unshift({ label: "", options: [{ value: null, text: TEXT.deadEnd }] });
    return groups;
  }

  // A place in words, from its stored value.
  function placeText(place) {
    if (isObject(place) && place.end !== undefined) return TEXT.endPlace(place.end, place.track);
    if (isObject(place) && place.junction !== undefined) return TEXT.legPlace(place.junction, place.leg);
    return TEXT.deadEnd;
  }

  const placeKey = (place) => (isObject(place) && place.end !== undefined ? `e:${place.end}:${place.track}`
    : isObject(place) && place.junction !== undefined ? `l:${place.junction}:${place.leg}` : "");

  // The end tracks and legs no track uses yet, in order.
  function freePlaces(config) {
    const used = new Set();
    for (const track of tracksOf(config)) {
      if (!isObject(track)) continue;
      used.add(placeKey(track.from));
      used.add(placeKey(track.to));
    }
    return placeChoices(config).flatMap((group) => group.options).map((o) => o.value).filter((value) => !used.has(placeKey(value)));
  }

  // A new track: one block, from the first end track or leg nobody uses, to
  // the next one (or a dead end).
  function addTrack(config) {
    const free = freePlaces(config);
    const track = { from: free[0] ? { ...free[0] } : null, to: free[1] ? { ...free[1] } : null, blocks: [newBlock()], boundaries: [] };
    tracksOf(config).push(track);
    return track;
  }

  function removeTrack(config, index) {
    const tracks = tracksOf(config);
    if (index >= 0 && index < tracks.length) tracks.splice(index, 1);
  }

  function setPlace(track, side, value) {
    track[side] = value === null || value === undefined || value === "" ? null : { ...value };
  }

  /** Split block `i` in two: the new block follows it, and a boundary goes between. Returns the new boundary's index. */
  function splitBlock(track, i) {
    tidyTrack(track);
    if (i < 0 || i >= track.blocks.length) return -1;
    track.blocks.splice(i + 1, 0, newBlock());
    track.boundaries.splice(i, 0, newBoundary());
    return i;
  }

  // Add a block boundary: split the last block.
  const addBoundary = (track) => splitBlock(track, Math.max(0, tidyTrack(track).blocks.length - 1));

  /** Remove block `i` and the boundary after it (before it, for the last). The last block cannot be removed. */
  function removeBlock(track, i) {
    tidyTrack(track);
    if (track.blocks.length < 2 || i < 0 || i >= track.blocks.length) return false;
    track.blocks.splice(i, 1);
    track.boundaries.splice(Math.min(i, track.boundaries.length - 1), 1);
    return true;
  }

  // Swap block `i` with its neighbour (dir -1 earlier, 1 later); boundaries stay where they are. Returns the block's new index, or -1.
  function moveBlock(track, i, dir) {
    tidyTrack(track);
    const j = i + dir;
    if (i < 0 || j < 0 || i >= track.blocks.length || j >= track.blocks.length) return -1;
    [track.blocks[i], track.blocks[j]] = [track.blocks[j], track.blocks[i]];
    return j;
  }

  function addSensor(item, name) {
    if (!Array.isArray(item.sensors)) item.sensors = [];
    if (typeof name !== "string" || !name || item.sensors.includes(name)) return false;
    item.sensors.push(name);
    return true;
  }

  function removeSensor(item, name) {
    item.sensors = list(item.sensors).filter((s) => s !== name);
  }

  function addTurnout(block) {
    if (!Array.isArray(block.turnouts)) block.turnouts = [];
    const entry = { turnout: "", position: "closed" };
    block.turnouts.push(entry);
    return entry;
  }

  function removeTurnout(block, index) {
    if (Array.isArray(block.turnouts)) block.turnouts.splice(index, 1);
  }

  // Set one boundary signal; "" and null both mean no signal.
  function setSignal(boundary, side, mast) {
    boundary[side === "from" ? "towardsFrom" : "towardsTo"] = typeof mast === "string" && mast ? mast : null;
  }

  // ===== Pure logic: the strip ===============================================

  const shorten = (text, max = 16) => (String(text).length > max ? `${String(text).slice(0, max - 1)}…` : String(text));

  /**
   * The strip, left to right: { width, from, to, through, items }, where each
   * item is a block { kind: "block", index, x, w, label, sensors, turnouts }
   * or a boundary { kind: "boundary", index, x (its centre), label, sensors,
   * towardsFrom, towardsTo }. `through` is true for a track with no boundaries
   * between two end tracks (the spec's pass-through).
   */
  function stripShape(track, { blockWidth = 130, gap = 130, margin = 90 } = {}) {
    const t = tidyTrack(track);
    const items = [];
    let x = margin;
    t.blocks.forEach((block, i) => {
      items.push({
        kind: "block", index: i, x, w: blockWidth, label: TEXT.blockLabel(i + 1),
        sensors: block.sensors.slice(), turnouts: block.turnouts.filter(isObject).map((u) => ({ turnout: u.turnout, position: u.position })),
      });
      x += blockWidth;
      const boundary = t.boundaries[i];
      if (i < t.blocks.length - 1) {
        items.push({
          kind: "boundary", index: i, x: x + gap / 2, w: gap, label: TEXT.boundaryLabel(i + 1),
          sensors: boundary ? boundary.sensors.slice() : [], towardsFrom: boundary?.towardsFrom ?? null, towardsTo: boundary?.towardsTo ?? null,
        });
        x += gap;
      }
    });
    return {
      width: x + margin,
      from: placeText(t.from),
      to: placeText(t.to),
      through: t.boundaries.length === 0 && isObject(t.from) && t.from.end !== undefined && isObject(t.to) && t.to.end !== undefined,
      items,
    };
  }

  /**
   * The builder's problems for each track, sorted by what they name:
   * { track: [..], blocks: { 0: [..] }, boundaries: { 0: [..] } }, for the
   * track at `index`.
   */
  function trackProblems(problems, index) {
    const out = { track: [], blocks: {}, boundaries: {} };
    for (const problem of list(problems)) {
      const where = problem.where || {};
      if (where.part !== B().PARTS.tracks || where.track !== index) continue;
      if (Number.isInteger(where.block)) (out.blocks[where.block] = out.blocks[where.block] || []).push(problem);
      else if (Number.isInteger(where.boundary)) (out.boundaries[where.boundary] = out.boundaries[where.boundary] || []).push(problem);
      else out.track.push(problem);
    }
    return out;
  }

  const problemTotal = (found) => found.track.length + Object.values(found.blocks).flat().length + Object.values(found.boundaries).flat().length;

  // The selected block or boundary, kept inside the track: { kind, index }.
  function fixSelection(track, selection) {
    const t = tidyTrack(track);
    if (selection?.kind === "boundary" && selection.index < t.boundaries.length) return { kind: "boundary", index: selection.index };
    if (selection?.kind === "block" && selection.index < t.blocks.length) return { kind: "block", index: selection.index };
    return { kind: "block", index: 0 };
  }

  // ===== The page ============================================================

  const selected = new Map(); // track index -> { kind, index }
  let active = null; // the track whose form is open, picked on the module picture

  /** Open a block's or block boundary's form: { kind, index } on track `track`. */
  function pick(track, item) {
    active = track;
    if (item) selected.set(track, { kind: item.kind, index: item.index });
  }

  /** What the module picture shows as picked: { track, kind, index }, or null. */
  function picked() {
    if (active === null || !selected.has(active)) return null;
    return { track: active, ...selected.get(active) };
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, onClick, className = "") {
    const b = el("button", className, label);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  }

  function problemList(problems) {
    const ul = el("ul", "mss-problems");
    for (const problem of problems) ul.append(el("li", `mss-problem is-${problem.level}`, problem.text));
    return ul;
  }

  function sensorPicker(item, config, ctx, ui, redraw) {
    const box = el("div", "mss-sensors");
    box.append(el("span", "field-label", TEXT.sensorsLabel));
    const chips = el("div", "mss-chips");
    for (const name of list(item.sensors)) {
      const chip = el("span", "mss-chip", name);
      const remove = button("×", () => { removeSensor(item, name); redraw(); });
      remove.setAttribute("aria-label", TEXT.removeSensor(name));
      chip.append(remove);
      chips.append(chip);
    }
    if (!list(item.sensors).length) chips.append(el("span", "hint", TEXT.sensorsEmpty));
    box.append(chips);
    const groups = ui.itemChoices(config, "sensor");
    if (!groups.length) box.append(ctx.hintEl(TEXT.noSensors));
    else {
      const taken = new Set(item.sensors);
      const open = groups.map((g) => ({ ...g, options: g.options.filter((o) => !taken.has(o.value)) })).filter((g) => g.options.length);
      if (open.length) box.append(ui.selectEl(open, "", (name) => { if (addSensor(item, name)) { redraw(); } }, { prompt: TEXT.addSensor, label: TEXT.addSensor }));
    }
    return box;
  }

  function blockForm(track, i, config, ctx, ui, redraw, found) {
    const block = track.blocks[i];
    const form = el("div", "mss-form");
    form.append(el("h4", "", TEXT.blockTitle(i + 1)), ctx.hintEl(TEXT.blockHint));
    if (found.blocks[i]) form.append(problemList(found.blocks[i]));
    form.append(sensorPicker(block, config, ctx, ui, redraw));
    const turnouts = el("div", "mss-turnouts");
    turnouts.append(el("span", "field-label", TEXT.turnoutsLabel), ctx.hintEl(TEXT.turnoutsHint));
    block.turnouts.forEach((entry, k) => {
      if (!isObject(entry)) block.turnouts[k] = { turnout: "", position: "closed" };
      const row = el("div", "mss-turnout-row");
      row.append(ui.selectEl(ui.itemChoices(config, "turnout"), block.turnouts[k].turnout, (name) => { block.turnouts[k].turnout = name || ""; redraw(); }, { prompt: TEXT.pickTurnout, label: TEXT.pickTurnout }));
      row.append(ctx.field(TEXT.positionLabel, block.turnouts[k].position === "thrown" ? "thrown" : "closed", (value) => { block.turnouts[k].position = value; redraw(); }, { select: [{ value: "closed", label: TEXT.closed }, { value: "thrown", label: TEXT.thrown }] }));
      row.append(button(TEXT.removeTurnout, () => { removeTurnout(block, k); redraw(); }, "remove"));
      turnouts.append(row);
    });
    turnouts.append(button(TEXT.addTurnout, () => { addTurnout(block); redraw(); }));
    form.append(turnouts);
    const actions = el("div", "row-actions");
    actions.append(
      button(TEXT.splitBlock, () => { splitBlock(track, i); redraw({ kind: "block", index: i }); }),
      button(TEXT.moveBefore, () => { const j = moveBlock(track, i, -1); if (j >= 0) { redraw({ kind: "block", index: j }); } }),
      button(TEXT.moveAfter, () => { const j = moveBlock(track, i, 1); if (j >= 0) { redraw({ kind: "block", index: j }); } }),
    );
    if (track.blocks.length > 1) {
      actions.append(button(TEXT.removeBlock, () => { removeBlock(track, i); redraw({ kind: "block", index: Math.max(0, i - 1) }); }, "remove"));
      form.append(actions, ctx.hintEl(TEXT.removeBlockHint));
    } else form.append(actions);
    return form;
  }

  function boundaryForm(track, k, config, ctx, ui, redraw, found) {
    const boundary = track.boundaries[k];
    const form = el("div", "mss-form");
    form.append(el("h4", "", TEXT.boundaryTitle(k + 1)), ctx.hintEl(TEXT.boundaryHint));
    if (found.boundaries[k]) form.append(problemList(found.boundaries[k]));
    form.append(sensorPicker(boundary, config, ctx, ui, redraw));
    const signals = el("div", "fields");
    for (const [side, key, label] of [["from", "towardsFrom", TEXT.towardsFromLabel(placeText(track.from))], ["to", "towardsTo", TEXT.towardsToLabel(placeText(track.to))]]) {
      const wrap = el("label");
      wrap.append(el("span", "field-label", label));
      wrap.append(ui.selectEl(ui.itemChoices(config, "mast"), boundary[key] || "", (mast) => { setSignal(boundary, side, mast); redraw(); }, { prompt: TEXT.noSignal, label }));
      signals.append(wrap);
    }
    form.append(signals, ctx.hintEl(TEXT.signalNote));
    return form;
  }

  function placeSelect(config, current, onChange, to, label) {
    const groups = placeChoices(config, { to });
    const key = (value) => JSON.stringify(value ?? null);
    const select = el("select");
    select.setAttribute("aria-label", label);
    if (!to) {
      const blank = el("option", "", TEXT.pickPlace);
      blank.value = key(null);
      select.append(blank);
    }
    const have = new Set(groups.flatMap((g) => g.options.map((o) => key(o.value))));
    if (current && !have.has(key(current))) {
      const missing = el("option", "", `${placeText(current)} (${TEXT.placeMissing})`);
      missing.value = key(current);
      select.append(missing);
    }
    for (const group of groups) {
      const parent = group.label ? el("optgroup") : select;
      if (group.label) parent.label = group.label;
      for (const option of group.options) {
        const o = el("option", "", option.text);
        o.value = key(option.value);
        parent.append(o);
      }
      if (group.label) select.append(parent);
    }
    select.value = key(current ?? null);
    select.addEventListener("change", () => onChange(JSON.parse(select.value)));
    return select;
  }

  function renderTrack(holder, config, track, index, problems, ctx, ui) {
    tidyTrack(track);
    const found = trackProblems(problems, index);
    const total = problemTotal(found);
    const title = TEXT.trackTitle(index + 1, placeText(track.from), placeText(track.to));
    const { item: card } = ui.rowCard(total ? `${title} (${TEXT.problemCount(total)})` : title, () => {
      removeTrack(config, index);
      // Later tracks move up one: their picks follow.
      const after = [...selected.entries()].filter(([k]) => k > index);
      selected.delete(index);
      for (const [k, v] of after) {
        selected.delete(k);
        selected.set(k - 1, v);
      }
      if (active === index) active = null;
      else if (active !== null && active > index) active -= 1;
      ctx.persist();
      ctx.render();
    }, "mss-track");
    card.id = `logic-mss-track-${index}`;
    const places = el("div", "fields");
    for (const [side, label, hint] of [["from", TEXT.fromLabel, TEXT.fromHint], ["to", TEXT.toLabel, TEXT.toHint]]) {
      const wrap = el("label");
      wrap.append(el("span", "field-label", label), placeSelect(config, track[side], (value) => {
        setPlace(track, side, value);
        ctx.persist();
        ctx.render();
      }, side === "to", label), ctx.hintEl(hint));
      places.append(wrap);
    }
    card.append(places);
    if (found.track.length) card.append(problemList(found.track));
    const body = el("div", "mss-body");
    card.append(body);
    // A change saves and draws the whole page again, so the picture, the
    // problems, the steps and the Signals grid follow it; the picked block
    // or boundary is kept.
    const changed = (next) => {
      pick(index, next || null);
      ctx.persist();
      ctx.render();
    };
    if (active === index) {
      const current = fixSelection(track, selected.get(index));
      selected.set(index, current);
      const form = current.kind === "boundary"
        ? boundaryForm(track, current.index, config, ctx, ui, changed, found)
        : blockForm(track, current.index, config, ctx, ui, changed, found);
      // The form scrolls up under the picture, past its track's title: say which track.
      const heading = form.querySelector("h4");
      if (heading) heading.textContent = TEXT.inTrack(index + 1, heading.textContent);
      body.append(form);
    } else {
      const inside = [...Object.values(found.blocks), ...Object.values(found.boundaries)].flat();
      if (inside.length) body.append(problemList(inside));
      body.append(ui.paragraph(TEXT.pickOnPicture, "hint"), button(TEXT.editTrack, () => changed({ kind: "block", index: 0 })));
    }
    body.append(button(TEXT.addBoundary, () => changed({ kind: "boundary", index: addBoundary(track) })), ctx.hintEl(TEXT.addBoundaryHint));
    holder.append(card);
  }

  function renderTracks(root, config, ctx, ui) {
    const card = ui.card("logic-mss-tracks", TEXT.card);
    card.append(ui.paragraph(TEXT.intro));
    const tracks = tracksOf(config);
    const problems = B().problems(config);
    if (!tracks.length) card.append(ctx.hintEl(TEXT.empty));
    tracks.forEach((track, i) => {
      if (!isObject(track)) tracks[i] = { from: null, to: null, blocks: [newBlock()], boundaries: [] };
      renderTrack(card, config, tracks[i], i, problems, ctx, ui);
    });
    card.append(button(TEXT.addTrack, () => {
      addTrack(config);
      pick(tracks.length - 1, { kind: "block", index: 0 });
      ctx.persist();
      ctx.render();
    }));
    root.append(card);
  }

  global.EsphomeMrLogicUiMssTracks = {
    TEXT, tracksOf, tidyTrack, placeChoices, placeText, freePlaces, addTrack, removeTrack, setPlace,
    splitBlock, addBoundary, removeBlock, moveBlock, addSensor, removeSensor, addTurnout, removeTurnout,
    setSignal, stripShape, trackProblems, problemTotal, fixSelection, samePlace, pick, picked,
  };

  // MP 2: no longer a card on the page (logic-ui-mss-page.js); the picture Try it draws still uses its helpers until MP 6.
})(typeof globalThis !== "undefined" ? globalThis : window);
