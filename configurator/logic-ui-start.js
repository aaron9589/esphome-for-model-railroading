// The Logic page: the starters-first empty page (logic-starters, order 85),
// remote masts in Linked boards, and the Download page's warnings and version
// code. Work item 2.7d.
// Loaded after logic-ui.js, which draws the page; this file registers its
// parts with EsphomeMrLogicUi.registerPart. Every word it shows is in its
// TEXT, which test/logic-page.test.js lints for spec-only terms.
//
// The starters' forms are work item 2.8. Each fills in its card with
// registerStarter(key, { open }); until then the card says it is coming.
(function (global) {
  // Words a starter's form shows, by starter key, so the lint reads them too.
  // Filled by registerStarter.
  const starterText = {};

  const TEXT = Object.freeze({
    startCard: "Start here",
    startIntro: "Pick what you want this board's signals to do. Each starter asks a few questions and writes the rules for you, in a group you can change afterwards.",
    addFromStarter: "Add from starter",
    addFromStarterHint: "Each starter writes a new group of rules.",
    comingSoon: "Coming in a later version",
    starters: Object.freeze({
      "one-train-section": Object.freeze({
        title: "One-train section",
        about: "One train at a time on a gauntlet, a single-line bridge or tunnel, or a diamond, with a signal at each end.",
      }),
      "lock-turnouts": Object.freeze({
        title: "Lock turnouts under a train",
        about: "A turnout cannot be thrown while a train is on it.",
      }),
      "block-signals": Object.freeze({
        title: "Block signals",
        about: "Signals along plain track: Stop behind a train, then Approach, then Clear as it moves on.",
      }),
      "route-signal": Object.freeze({
        title: "Route signal",
        about: "A signal at turnouts that shows the route that is set, and Stop when the way ahead is not clear.",
      }),
      "level-crossing": Object.freeze({
        title: "Level crossing",
        about: "Flashing lights, and a gate if you have one, while a train is near the crossing.",
      }),
      "approach-lighting": Object.freeze({
        title: "Approach lighting",
        about: "Keep a signal dark until a train comes near it. Set it for each signal under Masts.",
      }),
      scratch: Object.freeze({
        title: "Write a rule from scratch",
        about: "Start with one blank rule: when this happens, show that.",
      }),
    }),
    newGroupName: (n) => `Group ${n}`,
    // The Download page, in Field Logic.
    versionTitle: "Logic version",
    versionHint: "Matches the board when it is running what you checked. The board shows it on its web page as Logic version.",
    warningsTitle: "Warnings about the logic",
    noWarnings: "No warnings about the logic.",
    warningsHint: "Warnings do not stop the download. Check each one is what you meant.",
    errorsNote: (n) => `${n} problem${n === 1 ? "" : "s"} must be fixed before you can download. ${n === 1 ? "It is" : "They are"} listed at the top of the page.`,
    starterForms: starterText,
  });

  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);

  // ===== Starters ===========================================================

  // The cards, in the spec's order (Starters), with Write a rule from scratch
  // last. Approach lighting is not a starter: its card takes the person to
  // Masts, where it is set for each signal.
  const STARTERS = Object.freeze(["one-train-section", "lock-turnouts", "block-signals", "route-signal", "level-crossing"]);
  const CARD_KEYS = Object.freeze([...STARTERS, "approach-lighting", "scratch"]);

  // Starters 2.8 has built, by key: { open(config, ctx, ui) }.
  const forms = new Map();

  /**
   * The hook work item 2.8 fills in. `form.open(config, ctx, ui)` is called
   * when the person clicks the starter's card: it shows the starter's
   * questions (in a dialog, or by drawing into the card), and when they are
   * answered, writes a new group to config.logic.layers (with `starter: key`)
   * and anything else it needs (blocks, masts entries, sections), then calls
   * ctx.persist() and ctx.render(). `form.text` holds every word the form
   * shows, for the lint.
   */
  function registerStarter(key, form) {
    if (!STARTERS.includes(key)) throw new Error(`There is no starter called ${key}.`);
    if (!form || typeof form.open !== "function") throw new Error("A starter needs an open function.");
    forms.set(key, form);
    if (form.text) starterText[key] = form.text;
  }

  // Start a starter: false when it is not built yet.
  function startStarter(key, config, ctx, ui) {
    const form = forms.get(key);
    if (!form) return false;
    form.open(config, ctx, ui);
    return true;
  }

  function groupsOf(config) {
    return list(config.logic?.layers).filter(isObject);
  }

  /**
   * What the starters part shows: { layout, cards }. `layout` is "empty" (no
   * groups yet: the big cards are the page) or "compact" (under Add from
   * starter). Each card is { key, title, about, action, ready, target }:
   * action "starter" (ready once 2.8 registers it), "scratch" or "goto"
   * (`target` is the part's id).
   */
  function starterCards(config) {
    const cards = CARD_KEYS.map((key) => {
      const words = TEXT.starters[key];
      if (key === "scratch") return { key, ...words, action: "scratch", ready: true, target: "logic-groups" };
      if (key === "approach-lighting") return { key, ...words, action: "goto", ready: true, target: "logic-masts" };
      return { key, ...words, action: "starter", ready: forms.has(key), target: "" };
    });
    return { layout: groupsOf(config).length ? "compact" : "empty", cards };
  }

  // Write a rule from scratch: a new group with one blank rule, named Group n
  // after the groups already there. Returns the group.
  function writeRuleFromScratch(config) {
    const ui = global.EsphomeMrLogicUi;
    const logic = ui.UI.logicOf(config);
    if (!Array.isArray(logic.layers)) logic.layers = [];
    const taken = new Set(logic.layers.filter(isObject).map((group) => String(group.name ?? "")));
    let n = logic.layers.length + 1;
    while (taken.has(TEXT.newGroupName(n))) n += 1;
    const group = ui.newGroup(TEXT.newGroupName(n));
    logic.layers.push(group);
    return group;
  }

  // ----- Pictures: simple strip diagrams, drawn in a 120 x 48 box. ---------

  const line = (x1, y1, x2, y2, cls = "sp-track") => `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  const path = (d, cls = "sp-track") => `<path class="${cls}" d="${d}"/>`;
  const train = (x, y, w) => `<rect class="sp-train" x="${x}" y="${y - 4}" width="${w}" height="8" rx="2"/>`;
  // A mast standing beside the track at x, its lamps top first.
  function mast(x, y, lamps) {
    const top = y - 8 - lamps.length * 7;
    const head = `<rect class="sp-head" x="${x - 4}" y="${top}" width="8" height="${lamps.length * 7 + 1}" rx="2"/>`;
    const dots = lamps.map((colour, i) => `<circle class="sp-${colour}" cx="${x}" cy="${top + 4 + i * 7}" r="2.4"/>`).join("");
    return line(x, y - 3, x, top + lamps.length * 7, "sp-post") + head + dots;
  }
  const tick = (x, y) => line(x, y - 5, x, y + 5, "sp-joint");

  const PICTURES = Object.freeze({
    // Double track narrowing to one through the section, a signal at each end.
    "one-train-section": [
      path("M4 20 H30 L42 30 H78 L90 20 H116"),
      path("M4 40 H30 L42 30"),
      path("M78 30 L90 40 H116"),
      line(42, 30, 78, 30, "sp-section"),
      mast(36, 20, ["red"]),
      mast(84, 20, ["green"]),
      train(6, 20, 20),
    ],
    // A train on a turnout, with a padlock over it.
    "lock-turnouts": [
      line(4, 38, 116, 38),
      path("M48 38 L76 24 H116"),
      train(40, 38, 36),
      '<rect class="sp-lock" x="55" y="12" width="12" height="9" rx="1.5"/>',
      path("M57.5 12 V9 a3.5 3.5 0 0 1 7 0 V12", "sp-shackle"),
    ],
    // Plain track in three blocks: Stop behind the train, then Approach, then Clear.
    "block-signals": [
      line(4, 38, 116, 38),
      tick(40, 38),
      tick(80, 38),
      mast(6, 38, ["green"]),
      mast(36, 38, ["amber"]),
      mast(76, 38, ["red"]),
      train(88, 38, 24),
    ],
    // A signal before a turnout, lit for the diverging route.
    "route-signal": [
      line(4, 38, 116, 38),
      path("M58 38 L84 22 H116"),
      mast(42, 38, ["green", "red"]),
      train(6, 38, 24),
    ],
    // A road over the track, with flashing lights each side.
    "level-crossing": [
      '<rect class="sp-road" x="52" y="4" width="16" height="42"/>',
      line(4, 30, 116, 30),
      line(44, 22, 44, 12, "sp-post"),
      line(76, 22, 76, 12, "sp-post"),
      '<circle class="sp-red" cx="44" cy="10" r="3"/>',
      '<circle class="sp-off" cx="76" cy="10" r="3"/>',
      train(10, 30, 28),
    ],
    // A signal that lights as a train comes near.
    "approach-lighting": [
      line(4, 38, 116, 38),
      line(50, 38, 86, 38, "sp-section"),
      mast(92, 38, ["green", "off"]),
      train(54, 38, 26),
    ],
    // A blank card: a plus.
    scratch: [
      '<rect class="sp-blank" x="40" y="6" width="40" height="36" rx="4"/>',
      line(60, 16, 60, 32, "sp-plus"),
      line(52, 24, 68, 24, "sp-plus"),
    ],
  });

  // The card's picture as SVG markup. No words: the card's title says it.
  function starterPicture(key) {
    const shapes = PICTURES[key];
    if (!shapes) return "";
    return `<svg class="starter-picture" viewBox="0 0 120 48" width="120" height="48" aria-hidden="true" focusable="false">${shapes.join("")}</svg>`;
  }

  function goTo(id) {
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }

  function cardEl(card, config, ctx, ui) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `starter-card starter-${card.key}`;
    button.disabled = !card.ready;
    const picture = document.createElement("span");
    picture.className = "starter-picture-wrap";
    picture.innerHTML = starterPicture(card.key);
    const title = document.createElement("strong");
    title.textContent = card.title;
    const about = document.createElement("span");
    about.className = "starter-about";
    about.textContent = card.about;
    button.append(picture, title, about);
    if (!card.ready) {
      const soon = document.createElement("span");
      soon.className = "starter-soon";
      soon.textContent = TEXT.comingSoon;
      button.append(soon);
    }
    button.addEventListener("click", () => {
      if (card.action === "scratch") {
        writeRuleFromScratch(config);
        ctx.persist();
        ctx.render();
        goTo(card.target);
      } else if (card.action === "goto") {
        goTo(card.target);
      } else {
        startStarter(card.key, config, ctx, ui);
      }
    });
    return button;
  }

  function renderStarters(root, config, ctx, ui) {
    const { layout, cards } = starterCards(config);
    const grid = document.createElement("div");
    grid.className = `starter-grid is-${layout}`;
    for (const card of cards) grid.append(cardEl(card, config, ctx, ui));
    if (layout === "empty") {
      const section = ui.card("logic-starters", TEXT.startCard);
      section.classList.add("logic-starters");
      section.append(ui.paragraph(TEXT.startIntro), grid);
      root.append(section);
      return;
    }
    const section = ui.card("logic-starters", TEXT.addFromStarter);
    section.classList.add("logic-starters", "is-compact");
    const fold = document.createElement("details");
    fold.className = "starter-fold";
    const summary = document.createElement("summary");
    summary.textContent = TEXT.addFromStarterHint;
    fold.append(summary, grid);
    section.append(fold);
    root.append(section);
  }

  // ===== The Download page ==================================================

  /**
   * What the Download page shows about the logic, or null outside Field
   * Logic: { title, version, hint, warningsTitle, warnings: [{ text, link }],
   * noWarnings, warningsHint, errorsNote }. `warnings` are validation's
   * warnings that point at the Logic page; the rest are in the box at the top
   * of every page. `errorsNote` is "" with no errors.
   */
  function downloadLogic(config, validation) {
    if (!["field", "mss"].includes(global.EsphomeMr.logicMode(config))) return null;
    const { warnings = [], errors = [], links } = validation || global.EsphomeMr.validateConfig(config);
    const linkOf = (text) => links?.get?.(text);
    return {
      title: TEXT.versionTitle,
      version: global.EsphomeMrLogicYaml.versionCode(config),
      hint: TEXT.versionHint,
      warningsTitle: TEXT.warningsTitle,
      warnings: warnings.filter((text) => linkOf(text)?.view === "logic").map((text) => ({ text, link: linkOf(text) })),
      noWarnings: TEXT.noWarnings,
      warningsHint: TEXT.warningsHint,
      errorsNote: errors.length ? TEXT.errorsNote(errors.length) : "",
    };
  }

  const api = global.EsphomeMrLogicUi;
  if (api) api.registerPart({ id: "logic-starters", order: 85, modes: ["field"], text: TEXT, render: renderStarters });

  global.EsphomeMrLogicUiStart = {
    TEXT, STARTERS, CARD_KEYS, registerStarter, startStarter, starterCards, writeRuleFromScratch, starterPicture, downloadLogic,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
