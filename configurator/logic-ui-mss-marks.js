// The Logic page in MSS Logic mode: red dots on whatever has a problem, and the
// shared mark convention the MSS part files use. Work item 4.2d.
// Loaded after mss-builder.js and before the other MSS part files.
//
// A builder problem (EsphomeMrMssBuilder.problems) has a `where`: { view:
// "logic", part, ...item keys }, such as { part, track: 0, block: 1 }. An
// element is marked with the same keys, and gets a dot when a problem's
// `where` has the element's part and every item key the element names.
// An element marked with the part alone gets a dot for any problem in it.
//
//   EsphomeMrLogicUiMssMarks.mark(el, { part, track: 0 })  // sets data-mss-* attributes
//
// or write the attributes yourself: data-mss-part="logic-mss-tracks"
// data-mss-track="0" (the item keys are track, block, boundary, junction,
// route, leg, end and mast; numbers are the builder's 0-based indexes, the
// mast is its name). The page calls apply() after it draws, so a part never
// has to. The pure parts (matches, statusOf, marksOf) need no DOM.
(function (global) {
  const TEXT = Object.freeze({
    hasError: "Needs fixing",
    hasWarning: "Worth a look",
  });

  const ITEM_KEYS = Object.freeze(["track", "block", "boundary", "junction", "route", "leg", "end", "mast"]);
  const dataName = (key) => `mss${key.charAt(0).toUpperCase()}${key.slice(1)}`; // dataset key
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

  /** Mark an element with a problem's `where` convention. Returns the element. */
  function mark(el, where) {
    if (!el || !isObject(where) || typeof where.part !== "string") return el;
    el.dataset.mssPart = where.part;
    for (const key of ITEM_KEYS) {
      if (where[key] !== undefined && where[key] !== null) el.dataset[dataName(key)] = String(where[key]);
      else delete el.dataset[dataName(key)];
    }
    return el;
  }

  /** The marks on an element (its dataset), as { part, <key>: "value" }, or null. */
  function marksOf(dataset) {
    if (!dataset || typeof dataset.mssPart !== "string" || !dataset.mssPart) return null;
    const marks = { part: dataset.mssPart };
    for (const key of ITEM_KEYS) if (dataset[dataName(key)] !== undefined) marks[key] = dataset[dataName(key)];
    return marks;
  }

  /** Does a problem's `where` fall inside what an element marks? */
  function matches(where, marks) {
    if (!isObject(where) || !marks || where.part !== marks.part) return false;
    return ITEM_KEYS.every((key) => marks[key] === undefined || String(where[key]) === String(marks[key]));
  }

  /**
   * The problems inside what an element marks, errors first. `status` is
   * "error", "warning" or "" for none.
   */
  function statusOf(problems, marks) {
    const found = (Array.isArray(problems) ? problems : []).filter((p) => matches(p?.where, marks));
    const errors = found.filter((p) => p.level === "error");
    return {
      status: errors.length ? "error" : found.length ? "warning" : "",
      texts: [...errors, ...found.filter((p) => p.level !== "error")].map((p) => p.text),
    };
  }

  /** The builder's problems for this board: none outside MSS Logic. */
  function problemsOf(config) {
    const builder = global.EsphomeMrMssBuilder;
    if (!builder || global.EsphomeMr.logicMode(config) !== "mss") return [];
    return builder.problems(config);
  }

  /**
   * Put a red dot (amber when only a warning) on every marked element in
   * `root` that has a problem, and take away stale ones. A card whose id is
   * one of the builder's parts is marked for you.
   */
  function apply(root, config) {
    const builder = global.EsphomeMrMssBuilder;
    if (!root || !builder) return;
    for (const dot of root.querySelectorAll(".mss-dot")) dot.remove();
    for (const el of root.querySelectorAll("[data-mss-problem]")) {
      delete el.dataset.mssProblem;
      el.classList.remove("has-problem");
    }
    for (const part of Object.values(builder.PARTS)) {
      const card = root.querySelector(`#${part}`);
      if (card && !card.dataset.mssPart) card.dataset.mssPart = part;
    }
    const problems = problemsOf(config);
    if (!problems.length) return;
    for (const el of root.querySelectorAll("[data-mss-part]")) {
      const { status, texts } = statusOf(problems, marksOf(el.dataset));
      if (!status) continue;
      el.dataset.mssProblem = status;
      el.classList.add("has-problem");
      const dot = document.createElement("span");
      dot.className = `mss-dot is-${status}`;
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", status === "error" ? TEXT.hasError : TEXT.hasWarning);
      dot.title = texts[0] || "";
      const heading = el.querySelector(":scope > h3, :scope > header > h3");
      (heading || el).prepend(dot, " ");
    }
  }

  global.EsphomeMrLogicUiMssMarks = { TEXT, ITEM_KEYS, mark, marksOf, matches, statusOf, problemsOf, apply };
})(typeof globalThis !== "undefined" ? globalThis : window);
