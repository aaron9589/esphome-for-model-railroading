// The Logic page in MSS Logic mode: the MSS page's junction shapes and routes (logic-mss-junctions). Work item 4.2c.
// Loaded after mss-builder.js. Parts register with EsphomeMrLogicUi.registerPart
// (modes: ["mss"]), using the part ids in EsphomeMrMssBuilder.PARTS, and keep
// every word in their TEXT for the plain-words lint.
//
// What it stores (docs/mss-emulation-spec.md, Stored format), in logic.mss.junctions:
//   { name: "J1", sensors: ["J1 optical"],
//     masts: { "1": "J1 Leg 1", "2": null, "3": null },               a signal per leg, or null
//     routes: [ { legs: [1, 2], turnouts: [{ turnout: "P1", position: "closed" }] },
//               { legs: [1, 3], turnouts: [{ turnout: "P1", position: "thrown" }], diverging: true } ] }
// The logic (shapes, names, routes, the drawing, which problem belongs where)
// is in the pure functions below, which test/mss-junctions.test.js checks
// without a DOM. The render functions at the end only draw them.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const B = () => global.EsphomeMrMssBuilder;

  const TEXT = Object.freeze({
    card: "Junctions",
    intro: "A junction is where the track has more than one way through, set by turnouts. Pick the shape that matches yours and the legs and routes are filled in. A leg is where a track meets the junction. A route joins two legs, and says where each turnout must be for it.",
    empty: "No junctions yet. A module of plain track needs none.",
    addTitle: "Add a junction",
    shapeLabel: "Shape",
    turnoutPick: (n, count) => (count === 1 ? "Turnout" : `Turnout ${n}`),
    turnoutPickHint: "The turnout from the Turnouts page that sets this junction.",
    pickTurnout: "Pick a turnout",
    noTurnouts: "Add the turnouts on the Turnouts page first, then pick them here.",
    addJunction: "Add junction",
    newName: (n) => `J${n}`,
    title: (name) => `Junction ${name}`,
    unnamed: "Unnamed junction",
    remove: "Remove",
    nameLabel: "Name",
    nameHint: "Such as J1. Tracks refer to the junction by this name.",
    shapes: Object.freeze({
      "turnout-left": Object.freeze({ label: "Turnout, left", legs: "Leg 1 is the single end, leg 2 goes straight on, leg 3 branches off to the left.", routes: Object.freeze(["Straight", "Turnout"]) }),
      "turnout-right": Object.freeze({ label: "Turnout, right", legs: "Leg 1 is the single end, leg 2 goes straight on, leg 3 branches off to the right.", routes: Object.freeze(["Straight", "Turnout"]) }),
      wye: Object.freeze({ label: "Wye", legs: "Leg 1 is the single end, leg 2 goes left, leg 3 goes right.", routes: Object.freeze(["Left", "Right"]) }),
      siding: Object.freeze({ label: "Siding end", legs: "Leg 1 is the main line coming in, leg 2 carries on along the main line, leg 3 goes into the siding.", routes: Object.freeze(["Main", "Into siding"]) }),
      "single-double": Object.freeze({ label: "Single to double track", legs: "Leg 1 is the single track, legs 2 and 3 are the two tracks.", routes: Object.freeze(["To track at leg 2", "To track at leg 3"]) }),
      crossover: Object.freeze({ label: "Double-track crossover", legs: "Legs 1 and 2 are one track, legs 3 and 4 are the other, with leg 1 and leg 3 on the same side.", routes: Object.freeze(["First track straight", "Second track straight", "Cross from leg 1 to leg 4", "Cross from leg 3 to leg 2"]) }),
      custom: Object.freeze({ label: "Custom", legs: "Start empty and add the routes yourself.", routes: Object.freeze([]) }),
    }),
    sensorsLabel: "Sensors",
    sensorsHint: "The optical sensors at the junction. A car standing on the junction holds every leg, so each one is in the first block of every leg. MSS asks for one for each route.",
    sensorsEmpty: "No sensors yet.",
    addSensor: "Add a sensor…",
    noSensors: "Add sensors on the Sensors page, then pick them here.",
    sensorMissing: "not found",
    removeSensor: "Remove sensor",
    legsLabel: "Legs",
    legsHint: "The signal facing into the junction from each leg. Choose no signal and one is made so the signals behind it keep working.",
    legTitle: (leg) => `Leg ${leg}`,
    noSignal: "No signal",
    signalMissing: "not found",
    routesLabel: "Routes",
    routesHint: "A route is set while every turnout in it is in its position. Two routes from one leg need a turnout in a different position.",
    routesEmpty: "No routes yet.",
    routeTitle: (n) => `Route ${n}`,
    routeFrom: "From leg",
    routeTo: "To leg",
    legOption: (leg) => `Leg ${leg}`,
    divergingLabel: "Diverging",
    divergingHint: "Tick for a route that diverges. The signal behind then shows Approach Diverging, and this junction's signal shows Diverging Clear or Diverging Approach.",
    turnoutsLabel: "Turnouts for this route",
    routeNoTurnouts: "No turnouts: this route is always set.",
    positionLabel: "Position",
    positions: Object.freeze({ closed: "Closed", thrown: "Thrown" }),
    addRouteTurnout: "Add a turnout",
    removeTurnout: "Remove turnout",
    turnoutMissing: "not found",
    addRoute: "Add a route",
    removeRoute: "Remove route",
    connects: (a, b) => `Leg ${a} to leg ${b}`,
    setBy: (what) => `set when ${what}`,
    always: "always set",
    turnoutAt: (turnout, position) => `${turnout || "a turnout"} is ${position}`,
    diverges: "diverging",
    straight: "main",
    previewLabel: "Which legs join",
    pictureLabel: (name) => `Drawing of junction ${name}: the routes between its legs`,
    shapePictureLabel: (shape) => `Drawing of a ${shape}`,
    problemsLabel: "Needs attention",
  });

  // ===== Shapes =============================================================
  // Each shape: its turnouts (`slots`), where the legs sit in its picture
  // (`layout`, 0-120 wide and 0-60 tall) and its routes. A route's turnout
  // positions are given per slot: "closed" or "thrown".

  const L3 = { 1: [10, 30], 2: [110, 30], 3: [110, 8] };
  const SHAPES = Object.freeze([
    Object.freeze({ id: "turnout-left", slots: 1, layout: L3,
      routes: [{ legs: [1, 2], at: ["closed"] }, { legs: [1, 3], at: ["thrown"], diverging: true }] }),
    Object.freeze({ id: "turnout-right", slots: 1, layout: { 1: [10, 30], 2: [110, 30], 3: [110, 52] },
      routes: [{ legs: [1, 2], at: ["closed"] }, { legs: [1, 3], at: ["thrown"], diverging: true }] }),
    Object.freeze({ id: "wye", slots: 1, layout: { 1: [10, 30], 2: [110, 8], 3: [110, 52] },
      routes: [{ legs: [1, 2], at: ["closed"], diverging: true }, { legs: [1, 3], at: ["thrown"], diverging: true }] }),
    Object.freeze({ id: "siding", slots: 1, layout: { 1: [10, 30], 2: [110, 30], 3: [110, 52] },
      routes: [{ legs: [1, 2], at: ["closed"] }, { legs: [1, 3], at: ["thrown"], diverging: true }] }),
    Object.freeze({ id: "single-double", slots: 1, layout: { 1: [10, 30], 2: [110, 8], 3: [110, 52] },
      routes: [{ legs: [1, 2], at: ["closed"] }, { legs: [1, 3], at: ["thrown"] }] }),
    Object.freeze({ id: "crossover", slots: 2, layout: { 1: [10, 8], 2: [110, 8], 3: [10, 52], 4: [110, 52] },
      routes: [{ legs: [1, 2], at: ["closed", "closed"] }, { legs: [3, 4], at: ["closed", "closed"] },
        { legs: [1, 4], at: ["thrown", "thrown"], diverging: true }, { legs: [3, 2], at: ["thrown", "thrown"], diverging: true }] }),
    Object.freeze({ id: "custom", slots: 0, layout: null, routes: [] }),
  ]);

  const shapeOf = (id) => SHAPES.find((shape) => shape.id === id) || null;

  // ===== Pure logic =========================================================

  function junctionsOf(config) {
    const logic = config.logic || (config.logic = {});
    const mss = isObject(logic.mss) ? logic.mss : (logic.mss = {});
    if (!Array.isArray(mss.junctions)) mss.junctions = [];
    return mss.junctions;
  }

  const namedJunctions = (config) => list(config.logic?.mss?.junctions).filter(isObject);

  // J1, J2 ... the first not in use.
  function freeJunctionName(config) {
    const taken = new Set(namedJunctions(config).map((j) => String(j.name ?? "")));
    let n = 1;
    while (taken.has(TEXT.newName(n))) n += 1;
    return TEXT.newName(n);
  }

  // The turnouts on the Turnouts page that no junction uses yet, then the rest:
  // what a new junction's turnouts start as.
  function suggestTurnouts(config, count) {
    const all = list(config.points).filter(isObject).map((p) => String(p.name ?? "")).filter(Boolean);
    const used = new Set(namedJunctions(config).flatMap((j) => list(j.routes).flatMap((r) => list(r?.turnouts).map((t) => t?.turnout))));
    const free = all.filter((name) => !used.has(name));
    return Array.from({ length: count }, (_, i) => free[i] || "");
  }

  /**
   * A junction made from a shape: its legs, routes and each route's turnout
   * positions. `turnouts` names the shape's turnouts in order (a blank is
   * left for the person to pick); `sensors` and `name` are optional.
   */
  function fromShape(shapeId, { name = "", turnouts = [], sensors = [] } = {}) {
    const shape = shapeOf(shapeId);
    if (!shape) throw new Error(`No junction shape called ${shapeId}.`);
    const legs = [...new Set(shape.routes.flatMap((route) => route.legs))].sort((a, b) => a - b);
    const masts = {};
    for (const leg of legs) masts[String(leg)] = null;
    return {
      name,
      // Kept only so the card draws the junction the way its shape did.
      ...(shape.layout ? { shape: shape.id } : {}),
      sensors: [...sensors],
      masts,
      routes: shape.routes.map((route) => ({
        legs: [...route.legs],
        turnouts: route.at.map((position, slot) => ({ turnout: String(turnouts[slot] ?? ""), position })),
        ...(route.diverging ? { diverging: true } : {}),
      })),
    };
  }

  function addJunction(config, shapeId, turnouts = []) {
    const junction = fromShape(shapeId, { name: freeJunctionName(config), turnouts });
    junctionsOf(config).push(junction);
    return junction;
  }

  function removeJunction(config, index) {
    junctionsOf(config).splice(index, 1);
  }

  /** A junction renamed: the tracks that start or finish at its legs follow. Returns how many. */
  function renameJunction(config, from, to) {
    const mss = config.logic?.mss;
    if (!isObject(mss) || !from || from === to || typeof to !== "string" || !to.trim()) return 0;
    let count = 0;
    for (const track of list(mss.tracks)) {
      for (const side of ["from", "to"]) {
        if (isObject(track?.[side]) && track[side].junction === from) {
          track[side].junction = to;
          count += 1;
        }
      }
    }
    return count;
  }

  // A junction's legs: every leg a route joins, in order.
  function legsOf(junction) {
    const legs = new Set();
    for (const route of list(junction?.routes)) for (const leg of list(route?.legs)) if (Number.isInteger(leg) && leg >= 1) legs.add(leg);
    return [...legs].sort((a, b) => a - b);
  }

  // The legs a route's dropdown offers: those in use, and one more.
  function legChoices(junction) {
    const legs = legsOf(junction);
    const top = Math.max(3, ...legs) + 1;
    return Array.from({ length: top }, (_, i) => i + 1);
  }

  const mastOf = (junction, leg) => {
    const value = isObject(junction?.masts) ? junction.masts[String(leg)] : null;
    return typeof value === "string" && value.trim() !== "" ? value : null;
  };

  function setLegSignal(junction, leg, name) {
    if (!isObject(junction.masts)) junction.masts = {};
    junction.masts[String(leg)] = typeof name === "string" && name ? name : null;
  }

  function addSensor(junction, name) {
    if (!name) return false;
    if (!Array.isArray(junction.sensors)) junction.sensors = [];
    if (junction.sensors.includes(name)) return false;
    junction.sensors.push(name);
    return true;
  }

  function removeSensor(junction, index) {
    list(junction.sensors).splice(index, 1);
  }

  // A new route: the first two legs not already joined, no turnouts.
  function addRoute(junction) {
    if (!Array.isArray(junction.routes)) junction.routes = [];
    const legs = legsOf(junction);
    const route = { legs: legs.length >= 2 ? [legs[0], legs[1]] : [1, 2], turnouts: [] };
    junction.routes.push(route);
    return route;
  }

  function removeRoute(junction, index) {
    list(junction.routes).splice(index, 1);
  }

  function setRouteLeg(route, side, leg) {
    if (!Array.isArray(route.legs)) route.legs = [1, 2];
    route.legs[side] = Number(leg);
  }

  function setDiverging(route, on) {
    if (on) route.diverging = true;
    else delete route.diverging;
  }

  function addRouteTurnout(route, name = "") {
    if (!Array.isArray(route.turnouts)) route.turnouts = [];
    route.turnouts.push({ turnout: name, position: "closed" });
  }

  function removeRouteTurnout(route, index) {
    list(route.turnouts).splice(index, 1);
  }

  /** What each route joins and sets, in words, for the preview. */
  function connections(junction) {
    return list(junction?.routes).map((route, index) => {
      const [a, b] = list(route?.legs);
      const parts = list(route?.turnouts).filter(isObject).map((t) => TEXT.turnoutAt(t.turnout, TEXT.positions[t.position]?.toLowerCase() ?? "?"));
      return {
        route: index,
        legs: [a, b],
        diverging: !!route?.diverging,
        text: `${TEXT.connects(a, b)}, ${route?.diverging ? TEXT.diverges : TEXT.straight}, ${parts.length ? TEXT.setBy(parts.join(" and ")) : TEXT.always}`,
      };
    });
  }

  /**
   * The drawing of a junction: where each leg sits, and a path for each
   * route. A shape's own layout is used for its picture; otherwise the legs
   * are spread by count (one on the left and two on the right for three,
   * pairs left and right otherwise).
   */
  function legLayout(legs, layout = null) {
    const n = legs.length;
    return legs.map((leg, i) => {
      if (layout && layout[leg]) return { leg, x: layout[leg][0], y: layout[leg][1] };
      if (n === 1) return { leg, x: 10, y: 30 };
      if (n === 2) return { leg, x: i === 0 ? 10 : 110, y: 30 };
      if (n === 3) return { leg, x: i === 0 ? 10 : 110, y: i === 0 ? 30 : i === 1 ? 10 : 50 };
      const rows = Math.ceil(n / 2);
      const row = Math.floor(i / 2);
      return { leg, x: i % 2 === 0 ? 10 : 110, y: rows === 1 ? 30 : 8 + (44 * row) / (rows - 1) };
    });
  }

  // The layout of the shape a junction was made from, while every leg its
  // routes use is in it (routes edited past the shape fall back to spreading).
  function layoutFor(junction) {
    const layout = shapeOf(junction?.shape)?.layout;
    if (!layout) return null;
    const legs = list(junction.routes).flatMap((r) => list(r?.legs));
    return legs.every((leg) => layout[leg]) ? layout : null;
  }

  function diagram(routes, layout = null) {
    const legs = [...new Set(list(routes).flatMap((r) => list(r?.legs)).filter((l) => Number.isInteger(l) && l >= 1))].sort((a, b) => a - b);
    const points = legLayout(legs, layout);
    const at = (leg) => points.find((p) => p.leg === leg);
    const paths = list(routes).map((route, index) => {
      const a = at(route?.legs?.[0]);
      const b = at(route?.legs?.[1]);
      if (!a || !b || a.leg === b.leg) return { index, d: "", diverging: !!route?.diverging };
      let d;
      if (a.x === b.x) {
        const bulge = a.x < 60 ? 28 : -28;
        d = `M${a.x} ${a.y} C${a.x + bulge} ${a.y} ${b.x + bulge} ${b.y} ${b.x} ${b.y}`;
      } else if (a.y === b.y) {
        d = `M${a.x} ${a.y} L${b.x} ${b.y}`;
      } else {
        const mid = (a.x + b.x) / 2;
        d = `M${a.x} ${a.y} C${mid} ${a.y} ${mid} ${b.y} ${b.x} ${b.y}`;
      }
      return { index, d, diverging: !!route?.diverging };
    });
    return { width: 120, height: 60, legs: points, paths };
  }

  /**
   * The builder's problems that name junction `index`, sorted to what they
   * name: the junction itself, a route, or a leg.
   */
  function problemsFor(all, index) {
    const out = { junction: [], routes: {}, legs: {}, all: [] };
    for (const problem of list(all)) {
      const where = problem?.where;
      if (!where || where.part !== B().PARTS.junctions || where.junction !== index) continue;
      out.all.push(problem);
      if (where.route !== undefined) (out.routes[where.route] ||= []).push(problem);
      else if (where.leg !== undefined) (out.legs[where.leg] ||= []).push(problem);
      else out.junction.push(problem);
    }
    return out;
  }

  // ===== Drawing ============================================================

  const SVG = "http://www.w3.org/2000/svg";

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

  function svgPicture(d, label) {
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", `-6 -4 ${d.width + 12} ${d.height + 8}`);
    svg.setAttribute("class", "mssj-picture");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", label);
    const paths = d.paths.map((p) => {
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("d", p.d);
      path.setAttribute("class", p.diverging ? "mssj-route is-diverging" : "mssj-route");
      svg.append(path);
      return path;
    });
    for (const p of d.legs) {
      const dot = document.createElementNS(SVG, "circle");
      dot.setAttribute("cx", p.x);
      dot.setAttribute("cy", p.y);
      dot.setAttribute("r", 3.5);
      dot.setAttribute("class", "mssj-leg");
      const text = document.createElementNS(SVG, "text");
      text.setAttribute("x", p.x + (p.x < 60 ? -8 : 8));
      text.setAttribute("y", p.y + 3);
      text.setAttribute("text-anchor", p.x < 60 ? "end" : "start");
      text.setAttribute("class", "mssj-leg-number");
      text.textContent = String(p.leg);
      svg.append(dot, text);
    }
    return { svg, paths };
  }

  function problemList(problems) {
    if (!problems?.length) return null;
    const box = el("div", "mssj-problems");
    box.setAttribute("role", "list");
    for (const problem of problems) {
      const line = el("p", `msg ${problem.level === "error" ? "err" : "warn"}`, problem.text);
      line.setAttribute("role", "listitem");
      box.append(line);
    }
    return box;
  }

  // The add form's choice, kept across redraws.
  const draft = { shape: "turnout-left", turnouts: [] };

  function renderAdd(section, config, ctx, ui) {
    const form = el("div", "mssj-add");
    form.append(el("h4", "", TEXT.addTitle));
    const shapes = el("div", "mssj-shapes");
    shapes.setAttribute("role", "radiogroup");
    shapes.setAttribute("aria-label", TEXT.shapeLabel);
    for (const shape of SHAPES) {
      const words = TEXT.shapes[shape.id];
      const choice = el("button", "mssj-shape");
      choice.type = "button";
      choice.setAttribute("role", "radio");
      choice.setAttribute("aria-checked", String(draft.shape === shape.id));
      choice.classList.toggle("is-picked", draft.shape === shape.id);
      if (shape.layout) {
        const made = fromShape(shape.id);
        choice.append(svgPicture(diagram(made.routes, shape.layout), TEXT.shapePictureLabel(words.label)).svg);
      } else {
        choice.append(el("span", "mssj-picture mssj-custom", "+"));
      }
      choice.append(el("span", "mssj-shape-name", words.label));
      choice.addEventListener("click", () => {
        draft.shape = shape.id;
        draft.turnouts = [];
        ctx.render();
      });
      shapes.append(choice);
    }
    form.append(shapes, ui.paragraph(TEXT.shapes[draft.shape].legs, "hint"));
    const shape = shapeOf(draft.shape);
    if (shape.slots) {
      if (!list(config.points).length) form.append(ui.paragraph(TEXT.noTurnouts, "hint"));
      const defaults = suggestTurnouts(config, shape.slots);
      const fields = el("div", "fields");
      for (let slot = 0; slot < shape.slots; slot += 1) {
        if (draft.turnouts[slot] === undefined) draft.turnouts[slot] = defaults[slot];
        const label = el("label");
        label.append(el("span", "field-label", TEXT.turnoutPick(slot + 1, shape.slots)), ui.selectEl(ui.itemChoices(config, "turnout"), draft.turnouts[slot], (value) => {
          draft.turnouts[slot] = value;
        }, { prompt: TEXT.pickTurnout, label: TEXT.turnoutPick(slot + 1, shape.slots) }));
        fields.append(label);
      }
      form.append(fields);
    }
    form.append(button(TEXT.addJunction, () => {
      addJunction(config, draft.shape, draft.turnouts);
      draft.turnouts = [];
      ctx.persist();
      ctx.render();
      const inputs = document.querySelectorAll(`#${B().PARTS.junctions} .mssj-junction > .fields input[type=text]`);
      inputs[inputs.length - 1]?.select();
    }));
    section.append(form);
  }

  function renderRoute(holder, config, junction, route, index, problems, preview, ctx, ui) {
    const box = el("div", "mssj-route-card");
    const head = el("div", "mssj-route-head");
    head.append(el("strong", "", TEXT.routeTitle(index + 1)), button(TEXT.removeRoute, () => {
      removeRoute(junction, index);
      ctx.persist();
      ctx.render();
    }, "remove"));
    box.append(head);
    const fields = el("div", "fields");
    list(route.legs).concat(list(route.legs).length < 2 ? [undefined, undefined] : []).slice(0, 2).forEach((leg, side) => {
      const choices = legChoices(junction).map((n) => ({ value: String(n), label: TEXT.legOption(n) }));
      fields.append(ctx.field(side === 0 ? TEXT.routeFrom : TEXT.routeTo, leg === undefined ? "" : String(leg), (value) => {
        setRouteLeg(route, side, value);
        ctx.persist();
        ctx.render();
      }, { select: choices }));
    });
    box.append(fields);
    box.append(ctx.field(TEXT.divergingLabel, route.diverging === true, (checked) => {
      setDiverging(route, checked);
      ctx.persist();
      ctx.render();
    }, { checkbox: true, hint: TEXT.divergingHint }));
    const turnouts = el("div", "mssj-turnouts");
    turnouts.append(el("span", "field-label", TEXT.turnoutsLabel));
    if (!list(route.turnouts).length) turnouts.append(ui.paragraph(TEXT.routeNoTurnouts, "hint"));
    list(route.turnouts).forEach((t, at) => {
      const row = el("div", "mssj-turnout-row");
      const turnout = isObject(t) ? t : (route.turnouts[at] = { turnout: "", position: "closed" });
      row.append(ui.selectEl(ui.itemChoices(config, "turnout"), turnout.turnout, (value) => {
        turnout.turnout = value;
        ctx.persist();
        ctx.render();
      }, { prompt: TEXT.pickTurnout, label: TEXT.turnoutsLabel }));
      const position = el("select");
      position.setAttribute("aria-label", TEXT.positionLabel);
      for (const key of Object.keys(TEXT.positions)) {
        const o = el("option", "", TEXT.positions[key]);
        o.value = key;
        position.append(o);
      }
      position.value = turnout.position === "thrown" ? "thrown" : "closed";
      position.addEventListener("change", () => {
        turnout.position = position.value;
        ctx.persist();
        ctx.render();
      });
      row.append(position, button(TEXT.removeTurnout, () => {
        removeRouteTurnout(route, at);
        ctx.persist();
        ctx.render();
      }, "remove"));
      turnouts.append(row);
    });
    turnouts.append(button(TEXT.addRouteTurnout, () => {
      addRouteTurnout(route);
      ctx.persist();
      ctx.render();
    }));
    box.append(turnouts);
    const own = problemList(problems.routes[index]);
    if (own) box.append(own);
    const lit = (on) => preview.paths[index]?.classList.toggle("is-lit", on);
    box.addEventListener("mouseenter", () => lit(true));
    box.addEventListener("mouseleave", () => lit(false));
    box.addEventListener("focusin", () => lit(true));
    box.addEventListener("focusout", () => lit(false));
    holder.append(box);
  }

  function renderJunction(holder, config, junction, index, all, ctx, ui) {
    const { item: card, title } = ui.rowCard(junction.name ? TEXT.title(junction.name) : TEXT.unnamed, () => {
      removeJunction(config, index);
      ctx.persist();
      ctx.render();
    }, "mssj-junction");
    card.id = `${B().PARTS.junctions}-${index}`;
    const problems = problemsFor(all, index);
    const fields = el("div", "fields");
    const nameAtRender = String(junction.name ?? "");
    const nameField = ctx.field(TEXT.nameLabel, junction.name, (value) => {
      junction.name = value;
      title.textContent = value ? TEXT.title(value) : TEXT.unnamed;
      ctx.persist();
    }, { hint: TEXT.nameHint });
    nameField.querySelector("input").addEventListener("change", () => {
      renameJunction(config, nameAtRender, junction.name);
      ctx.persist();
      ctx.render();
    });
    fields.append(nameField);
    card.append(fields);
    const own = problemList(problems.junction);
    if (own) card.append(own);

    // Sensors.
    const sensors = el("div", "mssj-sensors");
    sensors.append(el("span", "field-label", TEXT.sensorsLabel), ctx.hintEl(TEXT.sensorsHint));
    const known = new Set(list(config.blocks).map((b) => b.name));
    list(junction.sensors).forEach((name, at) => {
      const row = el("div", "mssj-turnout-row");
      row.append(el("span", "", known.has(name) ? name : `${name} (${TEXT.sensorMissing})`), button(TEXT.removeSensor, () => {
        removeSensor(junction, at);
        ctx.persist();
        ctx.render();
      }, "remove"));
      sensors.append(row);
    });
    if (!list(junction.sensors).length) sensors.append(ui.paragraph(TEXT.sensorsEmpty, "hint"));
    const free = ui.itemChoices(config, "sensor").map((group) => ({ ...group, options: group.options.filter((o) => !list(junction.sensors).includes(o.value)) })).filter((g) => g.options.length);
    if (free.length) {
      sensors.append(ui.selectEl(free, "", (value) => {
        if (addSensor(junction, value)) {
          ctx.persist();
          ctx.render();
        }
      }, { prompt: TEXT.addSensor, label: TEXT.addSensor }));
    } else if (!known.size) sensors.append(ui.paragraph(TEXT.noSensors, "hint"));
    card.append(sensors);

    // Which legs join: a drawing, and a line for each route.
    const preview = svgPicture(diagram(junction.routes, layoutFor(junction)), TEXT.pictureLabel(junction.name || TEXT.unnamed));
    const joins = el("div", "mssj-preview");
    joins.append(el("span", "field-label", TEXT.previewLabel), preview.svg);
    const lines = el("ul", "mssj-joins");
    for (const c of connections(junction)) lines.append(el("li", "", c.text));
    joins.append(lines);
    card.append(joins);

    // Legs.
    const legs = el("div", "mssj-legs");
    legs.append(el("span", "field-label", TEXT.legsLabel), ctx.hintEl(TEXT.legsHint));
    const names = new Set(ui.itemChoices(config, "mast").flatMap((g) => g.options.map((o) => o.value)));
    for (const leg of legsOf(junction)) {
      const row = el("div", "mssj-leg-row");
      const label = el("label");
      const given = mastOf(junction, leg);
      label.append(el("span", "field-label", TEXT.legTitle(leg)), ui.selectEl(ui.itemChoices(config, "mast"), given ?? "", (value) => {
        setLegSignal(junction, leg, value);
        ctx.persist();
        ctx.render();
      }, { prompt: TEXT.noSignal, label: TEXT.legTitle(leg) }));
      row.append(label);
      if (given && names.has(given) && ctx.mastPicture) {
        const picture = ctx.mastPicture(given, B().prefill(config, given, "stop"));
        if (picture) row.append(picture);
      }
      const legOwn = problemList(problems.legs[leg]);
      if (legOwn) row.append(legOwn);
      legs.append(row);
    }
    card.append(legs);

    // Routes.
    const routes = el("div", "mssj-routes");
    routes.append(el("span", "field-label", TEXT.routesLabel), ctx.hintEl(TEXT.routesHint));
    list(junction.routes).forEach((route, at) => renderRoute(routes, config, junction, isObject(route) ? route : (junction.routes[at] = { legs: [1, 2], turnouts: [] }), at, problems, preview, ctx, ui));
    if (!list(junction.routes).length) routes.append(ui.paragraph(TEXT.routesEmpty, "hint"));
    routes.append(button(TEXT.addRoute, () => {
      addRoute(junction);
      ctx.persist();
      ctx.render();
    }));
    card.append(routes);
    holder.append(card);
  }

  function renderJunctions(root, config, ctx, ui) {
    const section = ui.card(B().PARTS.junctions, TEXT.card);
    section.append(ui.paragraph(TEXT.intro));
    const all = B().problems(config);
    const holder = el("div");
    const junctions = list(config.logic?.mss?.junctions);
    junctions.forEach((junction, i) => {
      if (isObject(junction)) renderJunction(holder, config, junction, i, all, ctx, ui);
    });
    if (!junctions.length) holder.append(ui.paragraph(TEXT.empty, "empty"));
    section.append(holder);
    renderAdd(section, config, ctx, ui);
    root.append(section);
  }

  global.EsphomeMrLogicUi.registerPart({ id: global.EsphomeMrMssBuilder.PARTS.junctions, order: 50, modes: ["mss"], text: TEXT, render: renderJunctions });

  global.EsphomeMrLogicUiMssJunctions = {
    TEXT,
    SHAPES, layoutFor,
    shapeOf,
    fromShape,
    freeJunctionName,
    suggestTurnouts,
    addJunction,
    removeJunction,
    renameJunction,
    legsOf,
    legChoices,
    mastOf,
    setLegSignal,
    addSensor,
    removeSensor,
    addRoute,
    removeRoute,
    setRouteLeg,
    setDiverging,
    addRouteTurnout,
    removeRouteTurnout,
    connections,
    legLayout,
    diagram,
    problemsFor,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
