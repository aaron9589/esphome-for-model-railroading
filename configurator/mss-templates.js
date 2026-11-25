// MSS Logic: start a module from one of the standard MSS module types (the
// node types of the MSS standard, as Iowa Scaled Engineering's boards build
// them). Each template is a module description (`logic.mss`) plus the
// sensors, turnouts and signal masts it names, so one click gives a module
// that works, waiting only for its pins to be checked.
//
//   crossover  MSS Crossover Node (ISE MSS-CROSSOVER): one block across the
//              module, one current detector, no signals.
//   cascade    MSS Cascade Node (ISE Block Signal): two blocks, an IR sensor at
//              the block boundary between them, and a signal facing each way.
//   switch     MSS Complex Cascade Node (ISE Switch Signal): Block A to a
//              turnout, then Block B on the main line and Block C on the
//              branch; an IR sensor at the turnout; Signal A (two heads)
//              facing the turnout, Signals B and C facing back.
//
// Signals are named for the end trains come in at, as on the ISE boards:
// Signal A faces trains coming in at end A. Each is a WS2812B searchlight head
// (one LED that shows red, amber or green), with the CATS aspects for the MSS
// indications it shows, so the Signals grid fills itself in. Signal A on the
// switch has two heads, upper and lower: the lower head shows the diverging
// route.
//
// Pure: plan(config, id) says what applying would add and what is already
// there; apply(config, id, add) writes the description and calls `add` with
// the items to create (the page gives them free pins). No DOM.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);

  const TEXT = Object.freeze({
    heading: "Or start from a standard MSS module",
    hint: "Fills in the ends, tracks and signals for one of the MSS module types, and adds the sensors and signals it needs. Check their pins afterwards.",
    templates: Object.freeze({
      crossover: Object.freeze({ title: "Crossover", about: "One block right across the module, with one current detector and no signals. Like the ISE MSS-CROSSOVER board." }),
      cascade: Object.freeze({ title: "Cascade", about: "Two blocks with an IR sensor between them, and a signal facing each way. Like the ISE Block Signal board." }),
      switch: Object.freeze({ title: "Complex cascade (turnout)", about: "Block A runs to a turnout, then Block B on the main line and Block C on the branch, with a signal facing the turnout from each. Like the ISE Switch Signal board." }),
    }),
    confirm: (title) => `Start this module as a ${title}?`,
    adds: "This adds:",
    sensors: (names) => `Sensors: ${names}.`,
    turnouts: (names) => `Turnouts: ${names}.`,
    masts: (names) => `Signal masts: ${names}, each a WS2812B LED on its own pin.`,
    kept: (names) => `Already on this board, and used as they are: ${names}.`,
    replaces: "It replaces the module described here now.",
    apply: "Add it",
    cancel: "Cancel",
    done: (title) => `Started a ${title}. Check the pins on the Sensors, Turnouts and Signal Masts pages.`,
    // Names, as the ISE boards label them.
    blockSensor: (block) => `Block ${block} current`,
    irSensor: "IR sensor",
    signal: (end) => `Signal ${end}`,
    turnout: "Turnout",
    // Aspect labels, and lamp names.
    aspects: Object.freeze({
      stop: "Stop", approach: "Approach", clear: "Clear",
      divergingClear: "Diverging Clear", divergingApproach: "Diverging Approach",
    }),
    head: "Head",
    upper: "Upper",
    lower: "Lower",
  });

  const IDS = Object.freeze(["crossover", "cascade", "switch"]);

  // A searchlight head's colour for each indication: one lamp, one LED.
  const ONE_HEAD = [
    ["stop", "R292", ["red"]],
    ["approach", "R285", ["amber"]],
    ["clear", "R281", ["green"]],
  ];
  // A single head that also stands on a diverging route (trains leaving
  // through it face no turnout signal of their own): the same colours.
  const ONE_HEAD_DIVERGING = [
    ...ONE_HEAD,
    ["divergingClear", "R283", ["green"]],
    ["divergingApproach", "R286", ["amber"]],
  ];
  // Two heads, lower then upper (LED 0 is the lowest lamp): the upper head is
  // the main line, the lower the diverging route.
  const TWO_HEADS = [
    ["stop", "R292", ["red", "red"]],
    ["approach", "R285", ["red", "amber"]],
    ["clear", "R281", ["red", "green"]],
    ["divergingClear", "R283", ["green", "red"]],
    ["divergingApproach", "R286", ["amber", "red"]],
  ];

  // A signal mast for the Signal Masts page, without its pin.
  function mast(name, rows, heads) {
    return {
      name,
      lamps: heads.map((lamp) => ({ name: lamp, count: 1 })),
      aspects: rows.map(([key, cats, colours], i) => ({
        label: TEXT.aspects[key],
        states: [`${cats}; Lit; Unheld`],
        ...(i === 0 ? { startup: true } : {}),
        lamps: colours.map((color) => ({ color, mode: "steady" })),
      })),
    };
  }

  const end = (name, track = 1) => ({ end: name, track });
  const block = (sensor) => ({ sensors: [sensor], turnouts: [] });

  // What each template describes, and the items it needs.
  function design(id) {
    const s = TEXT;
    if (id === "crossover") {
      return {
        mss: { ends: [{ name: "A", tracks: 1 }, { name: "B", tracks: 1 }], tracks: [{ from: end("A"), to: end("B"), blocks: [block(s.blockSensor("A"))], boundaries: [] }], junctions: [] },
        sensors: [s.blockSensor("A")],
        turnouts: [],
        masts: [],
      };
    }
    if (id === "cascade") {
      return {
        mss: {
          ends: [{ name: "A", tracks: 1 }, { name: "B", tracks: 1 }],
          tracks: [{
            from: end("A"), to: end("B"),
            blocks: [block(s.blockSensor("A")), block(s.blockSensor("B"))],
            // Signal A faces trains coming in at end A, heading towards B.
            boundaries: [{ sensors: [s.irSensor], towardsFrom: s.signal("B"), towardsTo: s.signal("A") }],
          }],
          junctions: [],
        },
        sensors: [s.blockSensor("A"), s.irSensor, s.blockSensor("B")],
        turnouts: [],
        masts: [mast(s.signal("A"), ONE_HEAD, [s.head]), mast(s.signal("B"), ONE_HEAD, [s.head])],
      };
    }
    if (id === "switch") {
      return {
        mss: {
          ends: [{ name: "A", tracks: 1 }, { name: "B", tracks: 1 }, { name: "C", tracks: 1 }],
          tracks: [
            { from: end("A"), to: { junction: "J1", leg: 1 }, blocks: [block(s.blockSensor("A"))], boundaries: [] },
            { from: { junction: "J1", leg: 2 }, to: end("B"), blocks: [block(s.blockSensor("B"))], boundaries: [] },
            { from: { junction: "J1", leg: 3 }, to: end("C"), blocks: [block(s.blockSensor("C"))], boundaries: [] },
          ],
          junctions: [{
            name: "J1", shape: "turnout-right", sensors: [s.irSensor],
            masts: { 1: s.signal("A"), 2: s.signal("B"), 3: s.signal("C") },
            routes: [
              { legs: [1, 2], turnouts: [{ turnout: s.turnout, position: "closed" }] },
              { legs: [1, 3], turnouts: [{ turnout: s.turnout, position: "thrown" }], diverging: true },
            ],
          }],
        },
        sensors: [s.blockSensor("A"), s.irSensor, s.blockSensor("B"), s.blockSensor("C")],
        turnouts: [s.turnout],
        masts: [
          mast(s.signal("A"), TWO_HEADS, [s.lower, s.upper]),
          mast(s.signal("B"), ONE_HEAD, [s.head]),
          mast(s.signal("C"), ONE_HEAD_DIVERGING, [s.head]),
        ],
      };
    }
    return null;
  }

  // Does the board already describe a module? Then a template replaces it.
  function described(config) {
    const mss = config?.logic?.mss;
    return !!isObject(mss) && ["ends", "tracks", "junctions"].some((key) => list(mss[key]).length > 0);
  }

  /**
   * What applying template `id` does: { title, sensors, turnouts, masts }
   * (names to add), kept (names already on the board, used as they are) and
   * replaces (true when a module is already described). Null for an unknown id.
   */
  function plan(config, id) {
    const d = design(id);
    if (!d) return null;
    const have = {
      sensors: new Set(list(config?.blocks).map((b) => b?.name)),
      turnouts: new Set(list(config?.points).map((p) => p?.name)),
      masts: new Set(list(config?.signals?.masts).map((m) => m?.name)),
    };
    const kept = [];
    const out = { title: TEXT.templates[id].title, sensors: [], turnouts: [], masts: [], kept, replaces: described(config) };
    for (const kind of ["sensors", "turnouts", "masts"]) {
      for (const item of d[kind]) {
        const name = typeof item === "string" ? item : item.name;
        if (have[kind].has(name)) kept.push(name);
        else out[kind].push(name);
      }
    }
    return out;
  }

  /**
   * Apply template `id`: write its description to `logic.mss` (keeping the
   * indication ticks), and hand `add({ sensors, turnouts, masts })` the
   * items the board does not have yet (sensors and turnouts by name, masts
   * as Signal Masts entries without a pin). Returns plan(config, id).
   */
  function apply(config, id, add) {
    const d = design(id);
    const p = plan(config, id);
    if (!d || !p) return null;
    const missing = {
      sensors: d.sensors.filter((name) => p.sensors.includes(name)),
      turnouts: d.turnouts.filter((name) => p.turnouts.includes(name)),
      masts: d.masts.filter((m) => p.masts.includes(m.name)).map((m) => JSON.parse(JSON.stringify(m))),
    };
    if (typeof add === "function") add(missing);
    if (!isObject(config.logic)) config.logic = {};
    const before = isObject(config.logic.mss) ? config.logic.mss : {};
    const keep = {};
    for (const key of ["advanceApproach", "approachDiverging"]) if (before[key] !== undefined) keep[key] = before[key];
    config.logic.mss = { ...keep, ...JSON.parse(JSON.stringify(d.mss)) };
    return p;
  }

  global.EsphomeMrMssTemplates = { TEXT, IDS, design, plan, apply, described };
})(typeof globalThis !== "undefined" ? globalThis : window);
