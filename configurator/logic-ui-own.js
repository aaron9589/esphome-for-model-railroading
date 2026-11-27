// Your own pieces and rules on the Field Logic page (docs/field-logic-plan-
// spec.md, Your own pieces and rules; work item TP 7). Pure: the rule words,
// a rule as one sentence, what a rule reads (for the dotted lines on the
// drawing), the conditions the editor offers, and the examples, which write
// ordinary pieces and rules and are then forgotten. logic-ui-plan.js draws
// them; plan-builder.js turns them into the rule table. Checked by
// test/plan-rules.test.js.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const text = (value) => (typeof value === "string" ? value.trim() : "");

  const TEXT = Object.freeze({
    kinds: Object.freeze({ button: "Button", switch: "Switch", lamp: "Lamp" }),
    pieceHint: Object.freeze({
      button: "A push button on the fascia, wired to GND.",
      switch: "A toggle on the fascia, wired to GND: on when closed.",
      lamp: "An LED on the fascia.",
    }),
    // The rule words, by what a rule is on.
    rules: Object.freeze({
      stopWhile: "Keep at Stop while",
      stopUnless: "Keep at Stop unless",
      approachWhile: "No better than Approach while",
      lockWhile: "Lock it while",
      ownButtonsWhile: "Only its own buttons move it while",
      lightWhile: "Light while",
      flashWhile: "Flash while",
    }),
    ruleHint: Object.freeze({
      stopWhile: "A rule can only hold a signal back. It never clears one past what the drawing allows.",
      ownButtonsWhile: "JMRI, CATS and rules can't move it; its fascia buttons can.",
    }),
    and: "and",
    or: "or",
    // A condition, in words.
    says: Object.freeze({
      occupied: (b) => `${b} is occupied`,
      clear: (b) => `${b} is clear`,
      occupiedFor: (b, t) => `${b} has had a train in it for ${t}`,
      closed: (t) => `${t} is closed`,
      thrown: (t) => `${t} is thrown`,
      stop: (m) => `${m} is at Stop`,
      notStop: (m) => `${m} is not at Stop`,
      stopFor: (m, t) => `${m} has shown Stop for ${t}`,
      on: (w) => `${w} is on`,
      off: (w) => `${w} is off`,
      pressed: (b, t) => `${b} was pressed in the last ${t}`,
      something: "something the page can't put in words",
    }),
    seconds: (n) => (n === 1 ? "1 second" : `${n} seconds`),
    // The examples.
    examples: Object.freeze({
      hold: "Example: hold this signal until a button is pressed",
      holdButton: (mast) => `${mast} go`,
      local: "Example: hand this turnout to a local panel",
      localSwitch: (turnout) => `${turnout} local`,
      localLamp: (turnout) => `${turnout} lamp`,
      first: "Example: let this line go first at the crossing",
    }),
  });

  const ON = Object.freeze({ mast: ["stopWhile", "stopUnless", "approachWhile"], turnout: ["lockWhile", "ownButtonsWhile"], lamp: ["lightWhile", "flashWhile"] });

  const secondsOf = (t) => {
    const m = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(String(t || ""));
    if (!m) return String(t || "");
    const n = parseFloat(m[1]) / (m[2] === "ms" ? 1000 : 1);
    return TEXT.seconds(n);
  };

  /** One condition in words. */
  function sayCondition(c) {
    if (!isObject(c)) return TEXT.says.something;
    if (c.all || c.any) {
      const parts = list(c.all || c.any).map(sayCondition);
      return parts.join(` ${c.all ? TEXT.and : TEXT.or} `);
    }
    if (c.not && isObject(c.not) && c.not.mast !== undefined && [].concat(c.not.is)[0] === "stop") return TEXT.says.notStop(c.not.mast);
    if (c.block !== undefined || c.sensor !== undefined) {
      const name = c.block ?? c.sensor;
      if (c.for) return TEXT.says.occupiedFor(name, secondsOf(c.for));
      return c.is === "clear" ? TEXT.says.clear(name) : TEXT.says.occupied(name);
    }
    if (c.turnout !== undefined) return c.is === "thrown" ? TEXT.says.thrown(c.turnout) : TEXT.says.closed(c.turnout);
    if (c.mast !== undefined) return c.for ? TEXT.says.stopFor(c.mast, secondsOf(c.for)) : TEXT.says.stop(c.mast);
    if (c.switch !== undefined) return c.is === "off" ? TEXT.says.off(c.switch) : TEXT.says.on(c.switch);
    if (c.button !== undefined) return TEXT.says.pressed(c.button, secondsOf(c.within || "30s"));
    return TEXT.says.something;
  }

  /** A rule as one sentence, as the page shows it on its signal, turnout or lamp. */
  function sentence(rule) {
    return `${TEXT.rules[rule?.kind] || rule?.kind}: ${sayCondition(rule?.when)}.`;
  }

  /** What a rule is on: { kind: "mast" | "turnout" | "lamp", name }, or null. */
  function thingOf(rule) {
    const on = isObject(rule?.on) ? rule.on : {};
    const kind = ["mast", "turnout", "lamp"].find((k) => text(on[k]));
    return kind ? { kind, name: on[kind] } : null;
  }

  /** What a rule reads, each once: [{ kind: "block" | "turnout" | "mast" | "switch" | "button", name }]. */
  function readsOf(rule) {
    const out = [];
    const add = (kind, name) => { if (name && !out.some((r) => r.kind === kind && r.name === name)) out.push({ kind, name }); };
    const walk = (c) => {
      if (Array.isArray(c)) return c.forEach(walk);
      if (!isObject(c)) return;
      if (c.board !== undefined) return;
      if (c.block !== undefined || c.sensor !== undefined) add("block", c.block ?? c.sensor);
      else if (c.turnout !== undefined) add("turnout", c.turnout);
      else if (c.mast !== undefined) add("mast", c.mast);
      else if (c.switch !== undefined) add("switch", c.switch);
      else if (c.button !== undefined) add("button", c.button);
      Object.values(c).forEach(walk);
    };
    walk(rule?.when);
    return out;
  }

  /**
   * The conditions the editor offers, for one subject: [{ id, label, make(name, seconds) }].
   * `subject` is { kind, name }.
   */
  const CHOICES = Object.freeze({
    block: [
      { id: "occupied", make: (n) => ({ block: n, is: "occupied" }) },
      { id: "clear", make: (n) => ({ block: n, is: "clear" }) },
      { id: "occupiedFor", timed: true, make: (n, s) => ({ block: n, is: "occupied", for: `${s}s` }) },
    ],
    turnout: [
      { id: "closed", make: (n) => ({ turnout: n, is: "closed" }) },
      { id: "thrown", make: (n) => ({ turnout: n, is: "thrown" }) },
    ],
    mast: [
      { id: "stop", make: (n) => ({ mast: n, is: "stop" }) },
      { id: "notStop", make: (n) => ({ not: { mast: n, is: "stop" } }) },
      { id: "stopFor", timed: true, make: (n, s) => ({ mast: n, is: "stop", for: `${s}s` }) },
    ],
    switch: [
      { id: "on", make: (n) => ({ switch: n, is: "on" }) },
      { id: "off", make: (n) => ({ switch: n, is: "off" }) },
    ],
    button: [{ id: "pressed", timed: true, make: (n, s) => ({ button: n, is: "pressed", within: `${s}s` }) }],
  });

  /** A condition's subject, choice and seconds, for the editor: { kind, name, id, seconds }, or null. */
  function readCondition(c) {
    if (!isObject(c)) return null;
    const seconds = (t) => {
      const m = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(String(t || ""));
      return m ? parseFloat(m[1]) / (m[2] === "ms" ? 1000 : 1) : 30;
    };
    if (c.not && isObject(c.not) && c.not.mast !== undefined) return { kind: "mast", name: c.not.mast, id: "notStop", seconds: 30 };
    if (c.block !== undefined || c.sensor !== undefined) return { kind: "block", name: c.block ?? c.sensor, id: c.for ? "occupiedFor" : c.is === "clear" ? "clear" : "occupied", seconds: seconds(c.for) };
    if (c.turnout !== undefined) return { kind: "turnout", name: c.turnout, id: c.is === "thrown" ? "thrown" : "closed", seconds: 30 };
    if (c.mast !== undefined) return { kind: "mast", name: c.mast, id: c.for ? "stopFor" : "stop", seconds: seconds(c.for) };
    if (c.switch !== undefined) return { kind: "switch", name: c.switch, id: c.is === "off" ? "off" : "on", seconds: 30 };
    if (c.button !== undefined) return { kind: "button", name: c.button, id: "pressed", seconds: seconds(c.within) };
    return null;
  }

  /** A rule's conditions, one by one, and how they join: { join: "all" | "any", parts }. */
  function partsOf(when) {
    if (isObject(when) && (when.all || when.any)) return { join: when.any ? "any" : "all", parts: list(when.all || when.any) };
    return { join: "all", parts: isObject(when) ? [when] : [] };
  }

  /** The `when` for some conditions joined one way. */
  function joinParts(join, parts) {
    const kept = parts.filter(isObject);
    if (kept.length === 1) return kept[0];
    return { [join]: kept };
  }

  // ===== The examples ========================================================

  const freeName = (used, name) => {
    let candidate = name;
    let n = 2;
    while (used.has(candidate)) candidate = `${name} ${n++}`;
    return candidate;
  };
  const usedNames = (config) => new Set([
    ...list(config?.logic?.plan?.pieces).map((p) => p?.name),
    ...list(config?.blocks).map((b) => b?.name),
    ...list(config?.points).map((p) => p?.name),
    ...list(config?.signals?.masts).map((m) => m?.name),
  ].filter(Boolean));

  /**
   * Hold a signal until a button is pressed: a button beside it, and on the
   * signal, Keep at Stop unless the button was pressed in the last 30 seconds.
   * Returns { pieces, rules } to add.
   */
  function exampleHold(config, mast, at) {
    const button = freeName(usedNames(config), TEXT.examples.holdButton(mast));
    return {
      pieces: [{ kind: "button", name: button, at }],
      rules: [{ on: { mast }, kind: "stopUnless", when: { button, is: "pressed", within: "30s" } }],
    };
  }

  /**
   * Hand a turnout to a local panel: a switch and a lamp; on each signal whose
   * route crosses the turnout, Keep at Stop while the switch is on; on the
   * turnout, Only its own buttons move it while the switch is on and those
   * signals have shown Stop for 30 seconds; on the lamp, Light while that
   * holds, and Flash while the switch is off and the turnout is thrown.
   * `signals` are the masts whose routes cross the turnout.
   */
  function exampleLocalPanel(config, turnout, signals, at) {
    const used = usedNames(config);
    const sw = freeName(used, TEXT.examples.localSwitch(turnout));
    used.add(sw);
    const lamp = freeName(used, TEXT.examples.localLamp(turnout));
    const on = { switch: sw, is: "on" };
    const held = joinParts("all", [on, ...signals.map((mast) => ({ mast, is: "stop", for: "30s" }))]);
    return {
      pieces: [{ kind: "switch", name: sw, at, on: "Local" }, { kind: "lamp", name: lamp, at: [at[0], at[1] + 1] }],
      rules: [
        ...signals.map((mast) => ({ on: { mast }, kind: "stopWhile", when: on })),
        { on: { turnout }, kind: "ownButtonsWhile", when: held },
        { on: { lamp }, kind: "lightWhile", when: held },
        { on: { lamp }, kind: "flashWhile", when: { all: [{ switch: sw, is: "off" }, { turnout, is: "thrown" }] } },
      ],
    };
  }

  /**
   * Let one line go first at a crossing: on each signal of the other line,
   * Keep at Stop while a train waits on the first line (the block behind
   * each of the first line's signals is occupied).
   */
  function exampleFirst(firstBlocks, otherSignals) {
    const waits = joinParts("any", firstBlocks.map((block) => ({ block, is: "occupied" })));
    return { pieces: [], rules: otherSignals.map((mast) => ({ on: { mast }, kind: "stopWhile", when: waits })) };
  }

  global.EsphomeMrLogicUiOwn = { TEXT, ON, CHOICES, sayCondition, sentence, thingOf, readsOf, readCondition, partsOf, joinParts, exampleHold, exampleLocalPanel, exampleFirst };

  if (global.EsphomeMrLogicUi) {
    // Its words are linted with the page's; the page itself is logic-ui-plan.js.
    global.EsphomeMrLogicUi.registerPart({ id: "logic-own", order: 34, modes: [], text: TEXT, render: () => {} });
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
