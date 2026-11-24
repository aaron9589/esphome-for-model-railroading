// MSS Logic's builder (docs/mss-emulation-spec.md; work item 4.1). An MSS
// module is described, not programmed: its ends, its tracks (blocks and block
// boundaries), its junctions and routes, and the aspect each signal shows for
// each MSS indication. This file turns that description (`logic.mss`) into
// ordinary Field Logic items, which the engine cannot tell from hand-made ones:
//
//   build(config) -> { blocks, masts, layers, ends, origins }
//     blocks  `logic.blocks` entries: one per MSS block, with the sensors of
//             the block boundary at each side, what an end hears, and a
//             junction's sensors
//     masts   `logic.masts` entries: each signal the module uses, with the
//             meaning of the aspect it shows for each indication, and a signal
//             with no lights for each boundary direction or leg with none
//     layers  one Block signals group per direction per track, one Route
//             signal group per junction leg (built by logic-starters-signals.js)
//     ends    `logic.ends` entries: the module's plant ends, filled in from
//             the tracks
//     origins which part of the description made each built block, signal
//             and group, so a problem with one can point back at it
//   problems(config) -> [{ level: "error" | "warning", text, where }]
//     MSS validation (spec, Validation). `where` is { view: "logic", part }
//     plus what in that part: { track, block } , { track, boundary },
//     { junction, route }, { end }, { mast }.
//
// The built items are never stored: only the description is. They are built
// again from it whenever it is read, so they are read-only. Plain JS with no
// DOM, so Node tests call it; it needs generator.js, logic-yaml.js,
// logic-starters.js and logic-starters-signals.js loaded first.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const S = () => global.EsphomeMrLogicStarters;
  const M = () => global.EsphomeMr;
  const Y = () => global.EsphomeMrLogicYaml;

  // The page's parts for MSS Logic (work item 4.2 draws them). Each problem
  // links to one.
  const PARTS = Object.freeze({
    ends: "logic-mss-ends",
    tracks: "logic-mss-tracks",
    junctions: "logic-mss-junctions",
    signals: "logic-mss-signals",
  });

  // MSS names indications, not aspects (spec, Masts): each gives its aspect a
  // meaning, and CATS masts are prefilled with the aspect named here.
  const INDICATIONS = Object.freeze([
    Object.freeze({ key: "stop", tag: "stop", cats: "R292" }),
    Object.freeze({ key: "approach", tag: "approach", cats: "R285" }),
    Object.freeze({ key: "advance", tag: "advance", cats: "ADV_NORM" }),
    Object.freeze({ key: "clear", tag: "clear", cats: "R281" }),
    Object.freeze({ key: "approachDiverging", tag: "approach", cats: "R282" }),
    Object.freeze({ key: "divergingClear", tag: "clear", diverging: true, cats: "R283" }),
    Object.freeze({ key: "divergingApproach", tag: "approach", diverging: true, cats: "R286" }),
  ]);
  const INDICATION = Object.freeze(Object.fromEntries(INDICATIONS.map((i) => [i.key, i])));

  // Every word this file shows: built names, and problems in the page's plain
  // MSS words (spec, Plain labels for MSS terms).
  const TEXT = Object.freeze({
    indications: Object.freeze({
      stop: "Stop",
      approach: "Approach",
      advance: "Advance Approach",
      clear: "Clear",
      approachDiverging: "Approach Diverging",
      divergingClear: "Diverging Clear",
      divergingApproach: "Diverging Approach",
    }),
    // Built names. A place is an end track (A1) or a junction leg (J1 leg 2).
    deadEnd: "dead end",
    endPlace: (end, track) => `${end}${track}`,
    legPlace: (junction, leg) => `${junction} leg ${leg}`,
    trackLabel: (from, to) => `${from} to ${to}`,
    blockName: (track, n) => `${track} block ${n}`,
    boundarySignal: (track, n, towards) => `${track} boundary ${n} towards ${towards}`,
    legSignal: (junction, leg) => `${junction} leg ${leg} signal`,
    groupName: (track, towards) => `${track} towards ${towards}`,
    // Where something is, in words.
    track: (n, label) => `Track ${n} (${label})`,
    block: (track, n) => `${track}, block ${n}`,
    boundary: (track, n) => `${track}, block boundary ${n}`,
    towards: (where, place) => `${where}, the signal towards ${place}`,
    junction: (name) => `Junction "${name}"`,
    route: (junction, n) => `Route ${n} of junction "${junction}"`,
    leg: (junction, leg) => `Leg ${leg} of junction "${junction}"`,
    legSignalWords: (junction, leg) => `the signal at leg ${leg} of junction "${junction}"`,
    endTrackWords: (end, track) => `End ${end} track ${track}`,
    madeFrom: (words) => `Made by MSS Logic from ${words}.`,
    signalRow: (mast) => `signal "${mast}" under Signals`,
    // Problems: ends.
    endNoName: "An end has no name. Call it A, B, C... as marked on the module.",
    endTwice: (name) => `Two ends are called "${name}". Give each end its own letter.`,
    badName: (what, name) => `${what} "${name}" has a /, + or # in its name, which MQTT topics cannot use. Use letters and numbers.`,
    endTracks: (name) => `End ${name} needs the number of tracks that cross it: 1 or more.`,
    endTrackUnused: (end, track) => `End ${end} track ${track} has no track. Describe the track through it under Tracks, or give end ${end} fewer tracks.`,
    // Problems: junctions.
    junctionNoName: "A junction has no name. Give it one, such as J1.",
    junctionTwice: (name) => `Two junctions are called "${name}". Give each its own name.`,
    fewRoutes: (name) => `Junction "${name}" needs at least two routes. Add the routes its turnouts can set.`,
    junctionNoSensor: (name) => `Junction "${name}" has no sensor, so a car standing on it is not seen. MSS asks for an optical sensor for each route: add one.`,
    routeLegs: (where) => `${where} needs two different legs. Pick the leg at each side.`,
    routeTurnout: (where, name) => `${where} has turnout "${name}", which is not on the Turnouts page. Add it there, or pick another.`,
    routeNoTurnout: (where) => `${where} has a turnout with nothing picked. Pick one, or remove it.`,
    routePosition: (where, name) => `${where}: pick whether ${name} is closed or thrown for the route.`,
    routesClash: (junction, a, b, leg) => `Routes ${a} and ${b} of junction "${junction}" both leave leg ${leg}, and their turnouts do not tell them apart, so both could be set at once. Give one of them a turnout in the other position.`,
    legNoRoute: (where) => `${where} is in no route, so a train could never pass. Add a route from it, or join the track elsewhere.`,
    legNoTrack: (where) => `${where} has no track. Describe the track that joins it under Tracks.`,
    // Problems: tracks.
    trackNotRead: (n) => `Track ${n} is not something this configurator can read. Remove it.`,
    trackNoFrom: (where) => `${where} has no From. Pick the end track or leg it starts at.`,
    noSuchEnd: (where, side, end) => `${where}: ${side} is end ${end}, which is not under Ends. Add it, or pick another.`,
    noSuchEndTrack: (where, side, end, track) => `${where}: ${side} is end ${end} track ${track}, but end ${end} has ${track === 1 ? "no tracks" : "fewer tracks"}. Pick another, or add the track under Ends.`,
    noSuchJunction: (where, side, junction) => `${where}: ${side} is a leg of junction "${junction}", which is not under Junctions. Add it, or pick another.`,
    badPlace: (where, side) => `${where}: ${side} is not an end track or a leg of a junction. Pick one.`,
    sameSides: (where) => `${where} starts and finishes at the same place. Pick a different To.`,
    throughLoop: (where, end) => `${where} is a through track (no signals) from end ${end} back to end ${end}, which would loop. A through track joins two different ends: add a block boundary with its signals, or pick another end.`,
    placeTwice: (place, a, b) => `${place} is used by tracks ${a} and ${b}. Each end track and leg joins one track: pick another for one of them.`,
    noBlocks: (where) => `${where} has no blocks. Add at least one block with its current sensor.`,
    boundaryCount: (where, boundaries, blocks) => `${where} has ${boundaries} block boundar${boundaries === 1 ? "y" : "ies"} for ${blocks} block${blocks === 1 ? "" : "s"}. There is one block boundary between each two blocks: add or remove one.`,
    blockNoSensor: (where) => `${where} has no sensor. Pick the current sensor that sees a train in it.`,
    boundaryNoSensor: (where) => `${where} has no sensor, so the signals there can clear while cars that draw no power are still on it. Add its optical sensor.`,
    noSensor: (where, name) => `${where} uses sensor "${name}", which is not on the Sensors page. Add it there, or pick another.`,
    blockTurnout: (where, name) => `${where} has turnout "${name}", which is not on the Turnouts page. Add it there, or pick another.`,
    blockNoTurnout: (where) => `${where} has a turnout with nothing picked. Pick one, or remove it.`,
    blockPosition: (where, name) => `${where}: pick whether ${name} is closed or thrown for the main line.`,
    // Problems: signals.
    noMast: (where, name) => `${where} is signal "${name}", which is not on the Signal Masts page. Add it there, pick another, or choose no signal.`,
    mastTwice: (name, a, b) => `Signal "${name}" is used twice: ${a}, and ${b}. A signal faces one way at one place: pick another for one of them.`,
    needAspect: (mast, indication) => `Pick what signal "${mast}" shows for ${indication} under Signals.`,
    notAspect: (mast, aspect, indication) => `Signal "${mast}" has no aspect called "${aspect}". Pick another for ${indication} under Signals.`,
    aspectTwice: (mast, aspect, a, b) => `Signal "${mast}" shows "${aspect}" for both ${a} and ${b}, which mean different things to the signal behind. Pick a different aspect for one of them under Signals.`,
  });

  // ===== Reading the description ============================================

  const strings = (value) => list(value).filter((item) => typeof item === "string" && item.trim() !== "");
  const signalName = (value) => (typeof value === "string" && value.trim() !== "" ? value : null);
  const wholeNumber = (value) => (typeof value === "number" || (typeof value === "string" && value.trim() !== "") ? Number(value) : NaN);

  // A place where a track starts or finishes: an end track, a junction leg,
  // or nothing (the track stops on the module).
  function placeOf(ref) {
    if (ref === null || ref === undefined) return null;
    if (isObject(ref) && ref.end !== undefined) return { kind: "end", end: String(ref.end), track: wholeNumber(ref.track) };
    if (isObject(ref) && ref.junction !== undefined) return { kind: "leg", junction: String(ref.junction), leg: wholeNumber(ref.leg) };
    return { kind: "bad" };
  }

  const placeKey = (place) => (place?.kind === "end" ? `end\u0000${place.end}\u0000${place.track}`
    : place?.kind === "leg" ? `leg\u0000${place.junction}\u0000${place.leg}` : "");
  const placeName = (place) => (place?.kind === "end" ? TEXT.endPlace(place.end, place.track)
    : place?.kind === "leg" ? TEXT.legPlace(place.junction, place.leg) : TEXT.deadEnd);
  const placeWords = (place) => (place?.kind === "end" ? TEXT.endTrackWords(place.end, place.track)
    : TEXT.leg(place.junction, place.leg));

  /**
   * The description, read defensively: anything missing or of the wrong
   * shape is empty, and indices stay as stored so problems can name them.
   */
  function readModel(config) {
    const mss = isObject(config?.logic?.mss) ? config.logic.mss : {};
    const ends = list(mss.ends).map((def, index) => {
      const e = isObject(def) ? def : {};
      return { index, def: e, name: String(e.name ?? "").trim(), tracks: wholeNumber(e.tracks) };
    });
    const junctions = list(mss.junctions).map((def, index) => {
      const j = isObject(def) ? def : {};
      return {
        index,
        def: j,
        name: String(j.name ?? "").trim(),
        sensors: strings(j.sensors),
        masts: isObject(j.masts) ? j.masts : {},
        routes: list(j.routes).map((r, ri) => {
          const route = isObject(r) ? r : {};
          return { index: ri, legs: list(route.legs).map(wholeNumber), turnouts: list(route.turnouts), diverging: route.diverging === true };
        }),
      };
    });
    const tracks = list(mss.tracks).map((def, index) => {
      const t = isObject(def) ? def : null;
      const from = placeOf(t?.from);
      const to = placeOf(t?.to);
      const label = TEXT.trackLabel(placeName(from), placeName(to));
      return {
        index,
        readable: !!t,
        from,
        to,
        label,
        words: TEXT.track(index + 1, label),
        blocks: list(t?.blocks).map((b) => ({ sensors: strings(b?.sensors), turnouts: list(b?.turnouts) })),
        boundaries: list(t?.boundaries).map((b) => ({ sensors: strings(b?.sensors), towardsFrom: signalName(b?.towardsFrom), towardsTo: signalName(b?.towardsTo) })),
      };
    });
    return {
      advance: mss.advanceApproach === true,
      diverging: mss.approachDiverging === true,
      grid: list(mss.masts).filter(isObject),
      ends,
      junctions,
      tracks,
    };
  }

  // Is this place one the module has? An end track within its end's count, or
  // a leg (a whole number from 1) of a junction by that name.
  function placeExists(model, place) {
    if (place?.kind === "end") {
      const end = model.ends.find((e) => e.name === place.end);
      return !!end && Number.isInteger(place.track) && place.track >= 1 && place.track <= end.tracks;
    }
    if (place?.kind === "leg") {
      return model.junctions.some((j) => j.name === place.junction) && Number.isInteger(place.leg) && place.leg >= 1;
    }
    return false;
  }

  // The tracks the builder can build: a From, and at least one block. A To
  // that is not a place is read as a dead end (validation reports it).
  const buildable = (track) => track.readable && track.from && track.from.kind !== "bad" && track.blocks.length > 0;

  // Each place's tracks: key -> [{ track, side }].
  function owners(model) {
    const out = new Map();
    for (const track of model.tracks) {
      if (!track.readable) continue;
      for (const side of ["from", "to"]) {
        const key = placeKey(track[side]);
        if (!key) continue;
        if (!out.has(key)) out.set(key, []);
        out.get(key).push({ track, side });
      }
    }
    return out;
  }

  // ===== Signals ============================================================

  // Every signal place in the description, in order: each boundary's two
  // directions, then each junction leg's signal. A signal is { name, virtual,
  // junction (with a diverging route from its leg), where, words }.
  function signalPlaces(model) {
    const out = [];
    for (const track of model.tracks.filter(buildable)) {
      // One boundary between each two blocks; a missing one (a validation
      // error) has no sensors and no signals.
      for (let k = 0; k < track.blocks.length - 1; k += 1) {
        const boundary = track.boundaries[k] || { sensors: [], towardsFrom: null, towardsTo: null };
        const words = TEXT.boundary(track.words, k + 1);
        for (const [key, towards] of [["towardsFrom", track.from], ["towardsTo", track.to]]) {
          const place = placeName(towards);
          const name = boundary[key];
          out.push({
            name: name || TEXT.boundarySignal(track.label, k + 1, place),
            virtual: !name,
            given: name,
            track, boundary: k, key,
            where: { view: "logic", part: PARTS.tracks, track: track.index, boundary: k },
            words: TEXT.towards(words, place),
          });
        }
      }
    }
    for (const junction of model.junctions) {
      if (!junction.name) continue;
      for (const leg of junctionLegs(junction)) {
        const given = signalName(junction.masts[String(leg)]);
        out.push({
          name: given || TEXT.legSignal(junction.name, leg),
          virtual: !given,
          given,
          junction, leg,
          divergingRoute: junction.routes.some((r) => r.diverging && r.legs.includes(leg)),
          where: { view: "logic", part: PARTS.junctions, junction: junction.index, leg },
          words: TEXT.legSignalWords(junction.name, leg),
        });
      }
    }
    return out;
  }

  // A junction's legs: every leg a route joins, in order.
  function junctionLegs(junction) {
    const legs = new Set();
    for (const route of junction.routes) for (const leg of route.legs) if (Number.isInteger(leg) && leg >= 1) legs.add(leg);
    return [...legs].sort((a, b) => a - b);
  }

  // The indications a signal shows (spec, Masts).
  function indicationsOf(model, signal) {
    return INDICATIONS.map((i) => i.key).filter((key) => {
      if (key === "advance") return model.advance;
      if (key === "approachDiverging") return model.diverging;
      if (key === "divergingClear" || key === "divergingApproach") return !!signal.divergingRoute;
      return true;
    });
  }

  // The JMRI name of an aspect on the Signal Masts page.
  function jmriName(aspect) {
    return Y()?.aspectName ? Y().aspectName(aspect) : String(aspect?.label ?? "");
  }

  /**
   * What a signal on the Signal Masts page shows for an indication, as the
   * Signals grid would fill it in: the CATS aspect, where the mast has one.
   * Empty when it has none.
   */
  function prefill(config, mastName, key) {
    const mast = list(config?.signals?.masts).find((m) => m.name === mastName);
    const cats = INDICATION[key]?.cats;
    const found = list(mast?.aspects).find((a) => jmriName(a) === cats);
    return found ? String(found.label ?? "") : "";
  }

  // A signal's aspect for each indication it shows: its Signals grid row,
  // else prefilled. A signal with no lights has one aspect per indication,
  // named for it.
  function aspectsOf(config, model, signal) {
    const out = {};
    const row = model.grid.find((r) => r.mast === signal.name);
    const given = isObject(row?.aspects) ? row.aspects : {};
    for (const key of indicationsOf(model, signal)) {
      if (signal.virtual) out[key] = TEXT.indications[key];
      else out[key] = typeof given[key] === "string" && given[key] ? given[key] : prefill(config, signal.name, key);
    }
    return out;
  }

  // The `logic.masts` entry for a signal: its meanings (a tag per aspect,
  // diverging ticks), and its stop aspect.
  function mastEntry(config, model, signal) {
    const aspects = aspectsOf(config, model, signal);
    const tags = {};
    const diverging = [];
    for (const key of indicationsOf(model, signal)) {
      const aspect = aspects[key];
      if (!aspect) continue;
      if (!Object.hasOwn(tags, aspect)) tags[aspect] = INDICATION[key].tag;
      if (INDICATION[key].diverging && !diverging.includes(aspect)) diverging.push(aspect);
    }
    if (signal.virtual) {
      const entry = { virtual: true, name: signal.name, topic: M().topicFor("signal", signal.name), aspects: Object.keys(tags), tags };
      if (diverging.length) entry.diverging = diverging;
      return entry;
    }
    const entry = { mast: signal.name, tags };
    if (diverging.length) entry.diverging = diverging;
    if (aspects.stop) entry.stopAspect = aspects.stop;
    const row = model.grid.find((r) => r.mast === signal.name);
    if (typeof row?.approachLight === "string" && row.approachLight) entry.approachLight = row.approachLight;
    return entry;
  }

  // ===== Building ===========================================================

  // A config the starters can build from: they only need it to prefill
  // aspects, and every aspect is given here.
  const STARTER_CONFIG = Object.freeze({ signals: { masts: [] }, logic: {} });

  /** The built items, from the description. `config` is not changed. */
  function build(config) {
    const model = readModel(config);
    const owned = owners(model);
    const signals = signalPlaces(model);
    const blocks = [];
    const layers = [];
    const origins = [];
    const groupNames = new Set();
    const origin = (kind, name, where, words) => origins.push({ kind, name, where, words });

    // Each track's built blocks, as { name, sensors, turnouts }.
    const trackBlocks = new Map();
    const signalAt = (track, k, key) => signals.find((s) => s.track === track && s.boundary === k && s.key === key);
    const junctionByName = (name) => model.junctions.find((j) => j.name === name);
    // What lies at a place for a train arriving at it: an end's own tracks,
    // or a junction's sensors.
    const sideMembers = (place) => {
      if (!placeExists(model, place)) return [];
      if (place.kind === "end") return [{ end: place.end, track: place.track }];
      return junctionByName(place.junction).sensors;
    };
    const unique = (members) => {
      const seen = new Set();
      return members.filter((m) => {
        const key = JSON.stringify(m);
        return !seen.has(key) && seen.add(key);
      });
    };
    for (const track of model.tracks.filter(buildable)) {
      const n = track.blocks.length;
      const built = track.blocks.map((block, i) => {
        const name = TEXT.blockName(track.label, i + 1);
        const own = [...block.sensors];
        if (i > 0) own.push(...(track.boundaries[i - 1]?.sensors || []));
        if (i < n - 1) own.push(...(track.boundaries[i]?.sensors || []));
        const sensors = [...own];
        if (i === 0) sensors.push(...sideMembers(track.from));
        if (i === n - 1) sensors.push(...sideMembers(track.to));
        const where = { view: "logic", part: PARTS.tracks, track: track.index, block: i };
        const words = TEXT.block(track.words, i + 1);
        origin("block", name, where, words);
        blocks.push({ name, topic: M().topicFor("block", name), sensors: unique(sensors) });
        return { name, own: unique(own), turnouts: block.turnouts.filter(isObject) };
      });
      trackBlocks.set(track, built);
    }

    // The signal a train meets next after leaving a track at a place: what an
    // end hears, the junction's signal on that leg, or nothing (a dead end).
    const layerSignals = new Set(); // junction signals that get a route layer
    const beyond = (place) => {
      if (!placeExists(model, place)) return "";
      if (place.kind === "end") return { end: place.end, track: place.track };
      const signal = signals.find((s) => s.junction?.name === place.junction && s.leg === place.leg);
      return signal && (!signal.virtual || layerSignals.has(signal)) ? signal.name : "";
    };
    // The first signal heading away from a place, into the track there.
    const headingAway = (place) => {
      const owner = owned.get(placeKey(place))?.[0];
      if (!owner || !buildable(owner.track)) return "";
      const { track, side } = owner;
      const k = track.blocks.length - 1;
      if (k === 0) return beyond(side === "from" ? track.to : track.from);
      return side === "from" ? signalAt(track, 0, "towardsTo").name : signalAt(track, k - 1, "towardsFrom").name;
    };
    // The block at a place's side of its track.
    const blockAt = (place) => {
      const owner = owned.get(placeKey(place))?.[0];
      if (!owner || !buildable(owner.track)) return null;
      const built = trackBlocks.get(owner.track);
      return owner.side === "from" ? built[0] : built[built.length - 1];
    };
    // Which junction signals have a route to follow: needed before the block
    // signals read them.
    for (const signal of signals) {
      if (!signal.junction) continue;
      const routes = signal.junction.routes.filter((r) => r.legs.includes(signal.leg));
      if (!owned.has(placeKey({ kind: "leg", junction: signal.junction.name, leg: signal.leg }))) continue;
      if (routes.some((r) => blockAt({ kind: "leg", junction: signal.junction.name, leg: r.legs.find((l) => l !== signal.leg) }))) layerSignals.add(signal);
    }

    // The aspects a rule shows for each indication (logic-starters-signals.js
    // answers), every one given so nothing is prefilled from the board.
    const ruleAspects = (signal, divergingRoute) => {
      const a = aspectsOf(config, model, signal);
      if (divergingRoute) return { clear: a.divergingClear || "", approach: a.divergingApproach || "", advance: a.divergingClear || "", diverging: a.divergingClear || "" };
      return { clear: a.clear || "", approach: a.approach || "", advance: (model.advance ? a.advance : a.clear) || "", diverging: (model.diverging ? a.approachDiverging : a.approach) || "" };
    };
    const freeGroup = (base) => {
      const name = S().freeName(base, groupNames);
      groupNames.add(name);
      return name;
    };
    const turnoutList = (turnouts) => turnouts.filter(isObject).map((t) => ({ turnout: t.turnout, position: t.position }));

    // One Block signals group per direction per track with boundaries.
    for (const track of model.tracks.filter(buildable)) {
      const built = trackBlocks.get(track);
      const k = built.length - 1;
      if (k === 0) continue;
      for (const [key, towards, order] of [["towardsTo", track.to, [...Array(k).keys()]], ["towardsFrom", track.from, [...Array(k).keys()].reverse()]]) {
        const rows = order.map((b) => {
          const signal = signalAt(track, b, key);
          const block = key === "towardsTo" ? built[b + 1] : built[b];
          return { mast: signal.name, noSignal: false, block: block.name, turnouts: turnoutList(block.turnouts), aspects: ruleAspects(signal, false) };
        });
        const next = beyond(towards);
        const name = freeGroup(TEXT.groupName(track.label, placeName(towards)));
        const answers = {
          name, rows, beyond: next ? "mast" : "end", nextMast: next,
          useAdvance: model.advance, useDiverging: model.diverging, bothWays: false,
        };
        const result = S().build("block-signals", STARTER_CONFIG, answers);
        layers.push(...result.groups);
        origin("group", name, { view: "logic", part: PARTS.tracks, track: track.index }, track.words);
      }
    }

    // One Route signal group per junction leg: a row per route from that leg,
    // following the next signal on the route, with its first block clear.
    for (const signal of signals) {
      if (!layerSignals.has(signal)) continue;
      const { junction, leg } = signal;
      const rows = [];
      for (const route of junction.routes) {
        if (!route.legs.includes(leg)) continue;
        const other = { kind: "leg", junction: junction.name, leg: route.legs.find((l) => l !== leg) };
        const first = blockAt(other);
        if (!first) continue;
        // The route's turnouts, then any in the first block (in its through
        // position): a reversed switch counts as an occupied block (spec,
        // How MSS maps to MSS Logic).
        const turnouts = turnoutList(route.turnouts);
        for (const t of turnoutList(first.turnouts)) {
          if (!turnouts.some((u) => u.turnout === t.turnout && u.position === t.position)) turnouts.push(t);
        }
        rows.push({
          turnouts, blocks: [first.name], diverging: route.diverging, follow: true,
          aspect: "", next: headingAway(other), aspects: ruleAspects(signal, route.diverging),
        });
      }
      const name = freeGroup(signal.name);
      const answers = {
        name, mast: signal.name, trigger: "", routeLocking: false,
        useAdvance: model.advance, useDiverging: model.diverging, rows,
      };
      const result = S().build("route-signal", STARTER_CONFIG, answers);
      layers.push(...result.groups);
      origin("group", name, signal.where, TEXT.junction(junction.name));
    }

    // Each signal once: a meaning for each aspect it shows, or a signal with
    // no lights. A junction signal with no route to follow is not built.
    const masts = [];
    const seen = new Set();
    for (const signal of signals) {
      if (signal.junction && signal.virtual && !layerSignals.has(signal)) continue;
      if (seen.has(signal.name)) continue;
      seen.add(signal.name);
      masts.push(mastEntry(config, model, signal));
      if (signal.virtual) origin("mast", signal.name, signal.where, signal.words);
      else origin("mast", signal.name, { view: "logic", part: PARTS.signals, mast: signal.name }, TEXT.signalRow(signal.name));
    }

    // The plant ends: what a train entering through each end track meets first.
    const ends = [];
    for (const end of model.ends) {
      if (!end.name || !Number.isInteger(end.tracks) || end.tracks < 1) continue;
      const tracks = [];
      for (let t = 1; t <= end.tracks; t += 1) {
        const place = { kind: "end", end: end.name, track: t };
        const owner = owned.get(placeKey(place))?.[0];
        if (!owner || !buildable(owner.track)) {
          tracks.push({ sensors: [] });
          continue;
        }
        const { track, side } = owner;
        const built = trackBlocks.get(track);
        const first = side === "from" ? built[0] : built[built.length - 1];
        const far = side === "from" ? track.to : track.from;
        const sensors = first.own.filter((s) => typeof s === "string");
        if (built.length > 1) {
          tracks.push({ sensors, mast: headingAway(place) });
        } else if (far?.kind === "end" && placeExists(model, far)) {
          tracks.push({ sensors, through: { end: far.end, track: far.track } });
        } else if (far?.kind === "leg" && placeExists(model, far)) {
          const next = beyond(far);
          tracks.push({ sensors: [...new Set([...sensors, ...junctionByName(far.junction).sensors])], ...(next ? { mast: next } : {}) });
        } else {
          tracks.push({ sensors });
        }
      }
      const out = { name: end.name, tracks };
      // An ESP pin is a GPIO name; an expander pin is its expander's name and 0-15.
      for (const [key, expander] of [["pairPin", "pairExpander"], ["ledPin", "ledExpander"]]) {
        if (typeof end.def[expander] === "string" && end.def[expander] && Number.isInteger(end.def[key])) {
          out[expander] = end.def[expander];
          out[key] = end.def[key];
        } else if (typeof end.def[key] === "string" && end.def[key]) out[key] = end.def[key];
      }
      ends.push(out);
    }

    return { blocks, masts, layers, ends, origins };
  }

  // ===== Validation =========================================================

  const TURNOUT_POSITIONS = ["closed", "thrown"];

  /** MSS validation: each problem points at the part of the description that caused it. */
  function problems(config) {
    const model = readModel(config);
    const out = [];
    const error = (where, text) => out.push({ level: "error", text, where });
    const warn = (where, text) => out.push({ level: "warning", text, where });
    const sensorNames = new Set(list(config?.blocks).map((b) => b.name));
    const turnoutNames = new Set(list(config?.points).map((p) => p.name));
    const mastNames = new Set(list(config?.signals?.masts).map((m) => m.name));
    const badChars = (name) => /[/+#]/.test(name);

    // Ends.
    const endNames = new Set();
    for (const end of model.ends) {
      const where = { view: "logic", part: PARTS.ends, end: end.index };
      if (!end.name) error(where, TEXT.endNoName);
      else if (endNames.has(end.name)) error(where, TEXT.endTwice(end.name));
      else if (badChars(end.name)) error(where, TEXT.badName("End", end.name));
      endNames.add(end.name);
      if (end.name && !(Number.isInteger(end.tracks) && end.tracks >= 1)) error(where, TEXT.endTracks(end.name));
    }

    // Junctions and routes.
    const junctionNames = new Set();
    for (const junction of model.junctions) {
      const where = { view: "logic", part: PARTS.junctions, junction: junction.index };
      if (!junction.name) {
        error(where, TEXT.junctionNoName);
        continue;
      }
      if (junctionNames.has(junction.name)) error(where, TEXT.junctionTwice(junction.name));
      else if (badChars(junction.name)) error(where, TEXT.badName("Junction", junction.name));
      junctionNames.add(junction.name);
      if (junction.routes.length < 2) error(where, TEXT.fewRoutes(junction.name));
      if (!junction.sensors.length) warn(where, TEXT.junctionNoSensor(junction.name));
      for (const s of junction.sensors) if (!sensorNames.has(s)) error(where, TEXT.noSensor(TEXT.junction(junction.name), s));
      for (const route of junction.routes) {
        const at = { ...where, route: route.index };
        const words = TEXT.route(junction.name, route.index + 1);
        const [a, b] = route.legs;
        if (route.legs.length !== 2 || !Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < 1 || a === b) error(at, TEXT.routeLegs(words));
        for (const t of route.turnouts) {
          if (!isObject(t) || typeof t.turnout !== "string" || !t.turnout) error(at, TEXT.routeNoTurnout(words));
          else if (!turnoutNames.has(t.turnout)) error(at, TEXT.routeTurnout(words, t.turnout));
          else if (!TURNOUT_POSITIONS.includes(t.position)) error(at, TEXT.routePosition(words, t.turnout));
        }
      }
      // Two routes from one leg must differ in some turnout's position.
      const differ = (r, s) => r.turnouts.some((t) => isObject(t) && s.turnouts.some((u) => isObject(u) && u.turnout === t.turnout && u.position !== t.position));
      junction.routes.forEach((r, i) => {
        junction.routes.slice(i + 1).forEach((s) => {
          const leg = r.legs.find((l) => s.legs.includes(l));
          if (leg === undefined || differ(r, s)) return;
          error({ ...where, route: s.index }, TEXT.routesClash(junction.name, r.index + 1, s.index + 1, leg));
        });
      });
    }

    // Tracks: places, blocks and boundaries.
    const owned = owners(model);
    const sideNames = { from: "From", to: "To" };
    for (const track of model.tracks) {
      const at = { view: "logic", part: PARTS.tracks, track: track.index };
      if (!track.readable) {
        error(at, TEXT.trackNotRead(track.index + 1));
        continue;
      }
      const words = track.words;
      if (!track.from) error(at, TEXT.trackNoFrom(words));
      for (const side of ["from", "to"]) {
        const place = track[side];
        if (!place) continue;
        if (place.kind === "bad") error(at, TEXT.badPlace(words, sideNames[side]));
        else if (place.kind === "end" && !model.ends.some((e) => e.name === place.end)) error(at, TEXT.noSuchEnd(words, sideNames[side], place.end));
        else if (place.kind === "leg" && !model.junctions.some((j) => j.name === place.junction)) error(at, TEXT.noSuchJunction(words, sideNames[side], place.junction));
        else if (!placeExists(model, place)) {
          if (place.kind === "end") error(at, TEXT.noSuchEndTrack(words, sideNames[side], place.end, place.track));
          else error(at, TEXT.badPlace(words, sideNames[side]));
        }
      }
      if (track.from && track.to && placeKey(track.from) && placeKey(track.from) === placeKey(track.to)) error(at, TEXT.sameSides(words));
      else if (track.blocks.length === 1 && track.from?.kind === "end" && track.to?.kind === "end" && track.from.end === track.to.end) {
        error(at, TEXT.throughLoop(words, track.from.end));
      }
      if (!track.blocks.length) error(at, TEXT.noBlocks(words));
      else if (track.boundaries.length !== track.blocks.length - 1) error(at, TEXT.boundaryCount(words, track.boundaries.length, track.blocks.length));
      track.blocks.forEach((block, i) => {
        const where = { ...at, block: i };
        const blockWords = TEXT.block(words, i + 1);
        if (!block.sensors.length) error(where, TEXT.blockNoSensor(blockWords));
        for (const s of block.sensors) if (!sensorNames.has(s)) error(where, TEXT.noSensor(blockWords, s));
        for (const t of block.turnouts) {
          if (!isObject(t) || typeof t.turnout !== "string" || !t.turnout) error(where, TEXT.blockNoTurnout(blockWords));
          else if (!turnoutNames.has(t.turnout)) error(where, TEXT.blockTurnout(blockWords, t.turnout));
          else if (!TURNOUT_POSITIONS.includes(t.position)) error(where, TEXT.blockPosition(blockWords, t.turnout));
        }
      });
      track.boundaries.forEach((boundary, k) => {
        const where = { ...at, boundary: k };
        const boundaryWords = TEXT.boundary(words, k + 1);
        if (!boundary.sensors.length) warn(where, TEXT.boundaryNoSensor(boundaryWords));
        for (const s of boundary.sensors) if (!sensorNames.has(s)) error(where, TEXT.noSensor(boundaryWords, s));
      });
    }
    // Each end track and leg joins exactly one track.
    for (const [, uses] of owned) {
      if (uses.length < 2) continue;
      const place = uses[0].track[uses[0].side];
      if (!placeExists(model, place)) continue;
      const [a, b] = uses;
      error({ view: "logic", part: PARTS.tracks, track: b.track.index }, TEXT.placeTwice(placeWords(place), a.track.index + 1, b.track.index + 1));
    }
    for (const end of model.ends) {
      if (!end.name || !Number.isInteger(end.tracks)) continue;
      for (let t = 1; t <= end.tracks; t += 1) {
        if (!owned.has(placeKey({ kind: "end", end: end.name, track: t }))) {
          error({ view: "logic", part: PARTS.ends, end: end.index }, TEXT.endTrackUnused(end.name, t));
        }
      }
    }
    for (const junction of model.junctions) {
      if (!junction.name) continue;
      const where = { view: "logic", part: PARTS.junctions, junction: junction.index };
      const legs = junctionLegs(junction);
      for (const leg of legs) {
        if (!owned.has(placeKey({ kind: "leg", junction: junction.name, leg }))) error({ ...where, leg }, TEXT.legNoTrack(TEXT.leg(junction.name, leg)));
      }
      for (const [key, uses] of owned) {
        const place = uses[0].track[uses[0].side];
        if (place.kind !== "leg" || place.junction !== junction.name || !Number.isInteger(place.leg) || legs.includes(place.leg)) continue;
        if (key) error({ ...where, leg: place.leg }, TEXT.legNoRoute(TEXT.leg(junction.name, place.leg)));
      }
    }

    // Signals: on the Signal Masts page, used once, with an aspect for each
    // indication they show, each meaning one thing.
    const signals = signalPlaces(model);
    const used = new Map();
    for (const signal of signals) {
      if (signal.virtual) continue;
      if (!mastNames.has(signal.name)) {
        error(signal.where, TEXT.noMast(capital(signal.words), signal.name));
        continue;
      }
      if (used.has(signal.name)) {
        error(signal.where, TEXT.mastTwice(signal.name, used.get(signal.name).words, signal.words));
        continue;
      }
      used.set(signal.name, signal);
    }
    for (const signal of used.values()) {
      const mast = list(config?.signals?.masts).find((m) => m.name === signal.name);
      const labels = list(mast?.aspects).map((a) => String(a.label ?? ""));
      const aspects = aspectsOf(config, model, signal);
      const where = { view: "logic", part: PARTS.signals, mast: signal.name };
      const meaning = new Map(); // aspect -> indication key
      for (const key of indicationsOf(model, signal)) {
        const aspect = aspects[key];
        const label = TEXT.indications[key];
        if (!aspect) {
          error(where, TEXT.needAspect(signal.name, label));
          continue;
        }
        if (!labels.includes(aspect)) {
          error(where, TEXT.notAspect(signal.name, aspect, label));
          continue;
        }
        const before = meaning.get(aspect);
        if (before && (INDICATION[before].tag !== INDICATION[key].tag || !!INDICATION[before].diverging !== !!INDICATION[key].diverging)) {
          error(where, TEXT.aspectTwice(signal.name, aspect, TEXT.indications[before], label));
        } else if (!before) meaning.set(aspect, key);
      }
    }
    return out;
  }

  const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

  // ===== Renames from the foundational pages ================================

  /**
   * A signal mast renamed on the Signal Masts page: the boundaries and
   * junction legs that name it follow. (Sensors, turnouts and Signals grid
   * rows are renamed by logic-yaml.js renameReferences, which walks the whole
   * description.) Returns how many were renamed.
   */
  function renameMast(config, from, to) {
    const mss = config?.logic?.mss;
    if (!isObject(mss) || !from || from === to || typeof to !== "string" || !to.trim()) return 0;
    let count = 0;
    for (const track of list(mss.tracks)) {
      for (const boundary of list(track?.boundaries)) {
        for (const key of ["towardsFrom", "towardsTo"]) {
          if (isObject(boundary) && boundary[key] === from) {
            boundary[key] = to;
            count += 1;
          }
        }
      }
    }
    for (const junction of list(mss.junctions)) {
      if (!isObject(junction?.masts)) continue;
      for (const leg of Object.keys(junction.masts)) {
        if (junction.masts[leg] === from) {
          junction.masts[leg] = to;
          count += 1;
        }
      }
    }
    return count;
  }

  /** An aspect renamed on the Signal Masts page: the Signals grid follows. */
  function renameAspect(config, mastName, from, to) {
    let count = 0;
    for (const row of list(config?.logic?.mss?.masts)) {
      if (!isObject(row) || row.mast !== mastName || !isObject(row.aspects)) continue;
      for (const key of Object.keys(row.aspects)) {
        if (row.aspects[key] === from) {
          row.aspects[key] = to;
          count += 1;
        }
      }
    }
    return count;
  }

  global.EsphomeMrMssBuilder = {
    TEXT, PARTS, INDICATIONS,
    build, problems, prefill, renameMast, renameAspect,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
