// The Logic page: Plant ends (logic-ends, order 35). Work item 3.3.
// Field Logic shows it only for a board that already has ends, such as one made
// by Convert to Field Logic: linked boards cover a permanent layout (track plan
// spec). MSS Logic builds its own ends.
// Loaded after logic-ui.js and logic-ui-masts.js; registers its part with
// EsphomeMrLogicUi.registerPart. Every word it shows is in its TEXT, which
// test/logic-page.test.js lints for spec-only terms.
//
// What it stores (docs/field-logic-spec.md, Stored format), in logic.ends:
//   { name: "A",
//     tracks: [ { sensors: ["Up East optical"], mast: "Up Home" },       first signal
//               { sensors: [], through: { end: "B", track: 2 } } ],      or pass through
//     pairPin: "GPIO32", ledPin: "GPIO33" }                              both optional
// A Pair or LED pin on an expander is { pairExpander: "<expander>", pairPin: 0-15 }
// (and ledExpander / ledPin). The logic (names, tracks, renames, pin choices) is
// in the pure functions below, which test/logic-ends.test.js checks without a
// DOM. The render functions at the end only draw them.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const M = () => global.EsphomeMr;
  const L = () => global.EsphomeMrLogicYaml;

  const TEXT = Object.freeze({
    endsCard: "Plant ends",
    endsIntro: "An end is where track leaves this board and meets the board next door. Each track through an end lists the sensors between the end and the first signal facing a train coming in, and that signal. A track with no signal of its own can pass through to a track at another end.",
    endsIntro2: "Press Pair on both sides of a joint to join two boards. Each end can have a Pair button and an LED on this board. The LED blinks slowly while pairing, stays on when the other board is heard, and blinks fast when there is a problem.",
    addEnd: "Add an end",
    newEndName: (n) => `End ${n}`,
    endTitle: (name) => `End ${name}`,
    unnamed: "Unnamed end",
    nameLabel: "Name",
    nameHint: "Usually A, B, C. Name it so you know which side of the board it is on.",
    tracksLabel: "Tracks",
    tracksHint: "In order, left to right, looking out through the end.",
    trackTitle: (n) => `Track ${n}`,
    addTrack: "Add a track",
    removeTrack: "Remove track",
    remove: "Remove",
    sensorsLabel: "End sensors",
    sensorsHint: "The sensors between the end and the first signal, including the one at that signal.",
    sensorsEmpty: "No sensors yet.",
    addSensor: "Add a sensor…",
    noSensors: "Add sensors on the Sensors page, then pick them here.",
    sensorMissing: "not found",
    startsAt: "What the track meets first",
    kinds: Object.freeze({
      mast: "A signal on this board",
      through: "Passes through to another end",
    }),
    mastLabel: "First signal",
    mastHint: "The signal facing a train coming in through this end.",
    pickSignal: "Pick a signal",
    throughLabel: "Passes through to",
    throughHint: "A block can run across several boards this way: this track offers its own sensors, or what the far track hears.",
    pickTrack: "Pick a track",
    throughGroup: "Tracks at ends",
    throughTrack: (end, track) => `End ${end}, track ${track}`,
    pairLabel: "Pair button pin",
    pairHint: "Optional. A push button between the pin and GND, like a turnout's button. The Pair button on this board's web page always works.",
    ledLabel: "LED pin",
    ledHint: "Optional. An LED that shows the state of this end.",
    noPin: "No pin",
    expanderPin: (expander, pin) => `${expander} · ${pin}`,
    espGroup: "On the board",
    noPinsLeft: "No free pins left. Free one on its own page.",
  });

  // ===== Pure logic =========================================================

  function endsOf(config) {
    const logic = config.logic || (config.logic = {});
    if (!Array.isArray(logic.ends)) logic.ends = [];
    return logic.ends;
  }

  const namedEnds = (config) => list(config.logic?.ends).filter(isObject);

  // A free name: A, B, C ... then "End 27" and so on.
  function freeEndName(config) {
    const taken = new Set(namedEnds(config).map((end) => String(end.name ?? "")));
    for (let code = 65; code <= 90; code += 1) if (!taken.has(String.fromCharCode(code))) return String.fromCharCode(code);
    let n = taken.size + 1;
    while (taken.has(TEXT.newEndName(n))) n += 1;
    return TEXT.newEndName(n);
  }

  const newTrack = () => ({ sensors: [], mast: "" });

  /** Add an end with one track; returns it. */
  function addEnd(config) {
    const end = { name: freeEndName(config), tracks: [newTrack()] };
    endsOf(config).push(end);
    return end;
  }

  /** Remove an end. Rules and blocks that named it are left for validation to report. */
  function removeEnd(config, index) {
    endsOf(config).splice(index, 1);
    return config;
  }

  /** Add a track at the end of an end's list; returns it. */
  function addTrack(end) {
    if (!Array.isArray(end.tracks)) end.tracks = [];
    const track = newTrack();
    end.tracks.push(track);
    return track;
  }

  /**
   * Remove an end's track. Later tracks are numbered one less, so the rules,
   * block members and pass-throughs that name them follow. Ones that named the
   * removed track are left for validation to report.
   */
  function removeTrack(config, end, index) {
    list(end.tracks).splice(index, 1);
    const number = index + 1;
    const walk = (value) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!isObject(value)) return;
      if (value.end === end.name && value.board === undefined && Number.isInteger(value.track) && value.track > number) value.track -= 1;
      Object.values(value).forEach(walk);
    };
    for (const [key, value] of Object.entries(config.logic || {})) if (key !== "remoteBoards") walk(value);
    return config;
  }

  /** What a track meets first: "mast" (its signal) or "through". */
  const trackKind = (track) => (isObject(track?.through) ? "through" : "mast");

  /** Switch a track between its own signal and a pass-through, keeping its sensors. */
  function setTrackKind(track, kind) {
    if (kind === "through") {
      delete track.mast;
      track.through = { end: "", track: 1 };
    } else {
      delete track.through;
      track.mast = typeof track.mast === "string" ? track.mast : "";
    }
    return track;
  }

  function addTrackSensor(track, name) {
    if (!name) return track;
    if (!Array.isArray(track.sensors)) track.sensors = [];
    if (!track.sensors.includes(name)) track.sensors.push(name);
    return track;
  }

  function removeTrackSensor(track, index) {
    list(track.sensors).splice(index, 1);
    return track;
  }

  /** Sensors a track can still add: this board's, not already on it. */
  function sensorChoices(config, track) {
    const taken = new Set(list(track.sensors));
    return (config.blocks || []).map((sensor) => sensor.name).filter((name) => name && !taken.has(name));
  }

  /**
   * Tracks a pass-through can point at: every track at any end but the track
   * itself, as [{ value: { end, track }, text }]. Named ends only.
   */
  function throughChoices(config, end, trackIndex) {
    const out = [];
    for (const other of namedEnds(config)) {
      if (!String(other.name ?? "").trim()) continue;
      list(other.tracks).forEach((_, i) => {
        if (other === end && i === trackIndex) return;
        out.push({ value: { end: other.name, track: i + 1 }, text: TEXT.throughTrack(other.name, i + 1) });
      });
    }
    return out;
  }

  // ----- Pins ---------------------------------------------------------------

  /** The pin select's value: the ESP pin, "mcp:<expander index>:<pin>", or "". */
  function pinValue(config, end, which) {
    const pin = L().endPin(end, which);
    if (!pin) return "";
    if (pin.expander === undefined) return pin.pin;
    const at = (config.expanders || []).findIndex((expander) => expander.name === pin.expander);
    const number = Number(pin.pin);
    return at >= 0 && Number.isInteger(number) && number >= 0 && number < 16 ? `mcp:${at}:${number}` : "";
  }

  /** Set (or clear, with "") an end's Pair or LED pin from the select's value. */
  function setPin(config, end, which, value) {
    const match = /^mcp:(\d+):(\d+)$/.exec(String(value));
    const expander = match && (config.expanders || [])[Number(match[1])];
    delete end[`${which}Expander`];
    if (expander) {
      end[`${which}Expander`] = expander.name;
      end[`${which}Pin`] = Number(match[2]);
    } else if (value) {
      end[`${which}Pin`] = String(value);
    } else {
      delete end[`${which}Pin`];
    }
    return end;
  }

  /**
   * The pin choices, [{ value, label }]: "No pin", the free ESP pins from
   * `espChoices`, then every free expander pin. This end's own pin stays in
   * the list. Pins the other parts use (sensors, buttons, turnouts, signals,
   * other ends) are left out, as the buttons' pin list does.
   */
  function pinChoices(config, end, which, espChoices = M().PULLUP_PINS.map((pin) => ({ value: pin, label: pin }))) {
    const Masts = global.EsphomeMrLogicUiMasts;
    const usedEsp = Masts.usedEspPins(config);
    const usedExp = Masts.usedExpanderPins(config);
    const own = L().endPin(end, which);
    if (own && own.expander === undefined) usedEsp.delete(own.pin);
    if (own && own.expander !== undefined) usedExp.delete(`${own.expander}\u0000${Number(own.pin)}`);
    const choices = [{ value: "", label: TEXT.noPin }];
    const ownValue = pinValue(config, end, which);
    for (const choice of list(espChoices)) if (choice.value === ownValue || !usedEsp.has(choice.value)) choices.push({ value: choice.value, label: choice.label });
    if (ownValue && !ownValue.startsWith("mcp:") && !choices.some((c) => c.value === ownValue)) choices.push({ value: ownValue, label: ownValue });
    (config.expanders || []).forEach((expander, i) => {
      for (let pin = 0; pin < 16; pin += 1) {
        if (usedExp.has(`${expander.name}\u0000${pin}`)) continue;
        choices.push({ value: `mcp:${i}:${pin}`, label: TEXT.expanderPin(expander.name, M().expanderPinLabel(pin)) });
      }
    });
    return choices;
  }

  /** Whether the Plant ends card is drawn: only when the board has ends. */
  function shown(config) {
    return list(config.logic?.ends).some(isObject);
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

  function renderTrack(box, config, end, track, index, ctx, ui) {
    const card = el("div", "row-card logic-end-track");
    const header = el("header");
    header.append(el("h3", "", TEXT.trackTitle(index + 1)));
    const actions = el("div", "row-actions");
    actions.append(button(TEXT.removeTrack, () => {
      removeTrack(config, end, index);
      ctx.persist();
      ctx.render();
    }, "remove"));
    header.append(actions);
    card.append(header);
    const fields = el("div", "fields");

    // The sensors.
    const wrap = el("div", "block-members-field");
    wrap.append(el("span", "field-label", TEXT.sensorsLabel));
    const sensors = el("ul", "block-members");
    list(track.sensors).forEach((name, at) => {
      const row = el("li");
      const found = (config.blocks || []).some((sensor) => sensor.name === name);
      row.classList.toggle("is-missing", !found);
      row.append(el("span", "", name));
      if (!found) row.append(" ", el("span", "linked-warning", TEXT.sensorMissing));
      row.append(button(TEXT.remove, () => {
        removeTrackSensor(track, at);
        ctx.persist();
        ctx.render();
      }, "remove"));
      sensors.append(row);
    });
    if (!list(track.sensors).length) sensors.append(el("li", "empty", TEXT.sensorsEmpty));
    wrap.append(sensors);
    const choices = sensorChoices(config, track);
    if (choices.length) {
      const select = el("select", "block-add-member");
      select.setAttribute("aria-label", TEXT.addSensor);
      select.append(Object.assign(el("option", "", TEXT.addSensor), { value: "" }));
      for (const name of choices) select.append(Object.assign(el("option", "", name), { value: name }));
      select.addEventListener("change", () => {
        if (!select.value) return;
        addTrackSensor(track, select.value);
        ctx.persist();
        ctx.render();
      });
      wrap.append(select);
    } else if (!(config.blocks || []).length) {
      wrap.append(ctx.hintEl(TEXT.noSensors));
    }
    wrap.append(ctx.hintEl(TEXT.sensorsHint));
    fields.append(wrap);

    // What the track meets first.
    fields.append(ctx.field(TEXT.startsAt, trackKind(track), (value) => {
      setTrackKind(track, value);
      ctx.persist();
      ctx.render();
    }, { select: Object.entries(TEXT.kinds).map(([value, label]) => ({ value, label })) }));
    if (trackKind(track) === "mast") {
      const label = el("label", "starter-signals-field");
      label.append(el("span", "field-label", TEXT.mastLabel), ui.selectEl(ui.itemChoices(config, "mast"), track.mast, (value) => {
        track.mast = value;
        ctx.persist();
      }, { prompt: TEXT.pickSignal, label: TEXT.mastLabel }), ctx.hintEl(TEXT.mastHint));
      fields.append(label);
    } else {
      const options = throughChoices(config, end, index);
      const label = el("label", "starter-signals-field");
      const current = isObject(track.through) && track.through.end ? { end: track.through.end, track: track.through.track } : "";
      label.append(el("span", "field-label", TEXT.throughLabel), ui.selectEl(options.length ? [{ label: TEXT.throughGroup, options }] : [], current, (value) => {
        track.through = value && value.end !== undefined ? { end: value.end, track: value.track } : { end: "", track: 1 };
        ctx.persist();
      }, { prompt: TEXT.pickTrack, label: TEXT.throughLabel }), ctx.hintEl(TEXT.throughHint));
      fields.append(label);
    }
    card.append(fields);
    box.append(card);
  }

  function renderPin(fields, config, end, which, label, hint, i, ctx) {
    const choices = pinChoices(config, end, which, ctx.pinChoices());
    const field = ctx.field(label, pinValue(config, end, which), (value) => {
      setPin(config, end, which, value);
      ctx.persist();
      ctx.render();
    }, { select: choices, hint: choices.length > 1 ? hint : TEXT.noPinsLeft });
    field.querySelector("select").id = `logic-end-${i}-${which}`;
    fields.append(field);
  }

  function renderEnd(holder, end, i, config, ctx, ui) {
    const { item: card, title } = ui.rowCard(end.name ? TEXT.endTitle(end.name) : TEXT.unnamed, () => {
      removeEnd(config, i);
      ctx.persist();
      ctx.render();
    }, "logic-end");
    card.id = `logic-end-${i}`;
    const fields = el("div", "fields");
    const nameAtRender = String(end.name ?? "");
    const nameField = ctx.field(TEXT.nameLabel, end.name, (value) => {
      end.name = value;
      title.textContent = value ? TEXT.endTitle(value) : TEXT.unnamed;
      ctx.persist();
    }, { hint: TEXT.nameHint });
    // References follow the name once it is finished, not on every key.
    nameField.querySelector("input").addEventListener("change", () => {
      L().renameEnd(config, nameAtRender, end.name);
      ctx.persist();
      ctx.render();
    });
    fields.append(nameField);
    renderPin(fields, config, end, "pair", TEXT.pairLabel, TEXT.pairHint, i, ctx);
    renderPin(fields, config, end, "led", TEXT.ledLabel, TEXT.ledHint, i, ctx);
    card.append(fields);
    const tracks = el("div", "logic-end-tracks");
    tracks.append(el("span", "field-label", TEXT.tracksLabel), ctx.hintEl(TEXT.tracksHint));
    list(end.tracks).forEach((track, at) => renderTrack(tracks, config, end, isObject(track) ? track : (end.tracks[at] = newTrack()), at, ctx, ui));
    tracks.append(button(TEXT.addTrack, () => {
      addTrack(end);
      ctx.persist();
      ctx.render();
    }));
    card.append(tracks);
    holder.append(card);
  }

  function renderEnds(root, config, ctx, ui) {
    if (!shown(config)) return;
    const section = ui.card("logic-ends", TEXT.endsCard);
    section.append(ui.paragraph(TEXT.endsIntro), ui.paragraph(TEXT.endsIntro2));
    const holder = el("div");
    const ends = list(config.logic?.ends).filter(isObject);
    ends.forEach((end, i) => renderEnd(holder, end, i, config, ctx, ui));
    section.append(holder, button(TEXT.addEnd, () => {
      addEnd(config);
      ctx.persist();
      ctx.render();
      const inputs = document.querySelectorAll("#logic-ends .logic-end > .fields input[type=text]");
      inputs[inputs.length - 1]?.select();
    }));
    root.append(section);
  }

  global.EsphomeMrLogicUi.registerPart({ id: "logic-ends", order: 35, modes: ["field"], text: TEXT, render: renderEnds });

  global.EsphomeMrLogicUiEnds = {
    TEXT,
    shown,
    freeEndName,
    addEnd,
    removeEnd,
    addTrack,
    removeTrack,
    trackKind,
    setTrackKind,
    addTrackSensor,
    removeTrackSensor,
    sensorChoices,
    throughChoices,
    pinValue,
    setPin,
    pinChoices,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
