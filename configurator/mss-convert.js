// Convert to Field Logic (docs/mss-emulation-spec.md, "Where it lives"; work
// item 4.3). An MSS board's built items (mss-builder.js) are copied into the
// Field Logic keys as ordinary items, and the mode becomes Field Logic. The
// board's YAML and version code do not change. It goes one way: `logic.mss`
// is dropped, because nothing would keep it in step with the copies, and a
// leftover description would only mislead. Plain JS; the part at the bottom
// draws a button and needs the Logic page loaded.
(function (global) {
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);
  const plain = (value) => JSON.parse(JSON.stringify(value));

  const TEXT = {
    heading: "Convert to Field Logic",
    explain: "Turn this module into ordinary Field Logic. Its sections, signals, plant ends and rules are copied over so you can edit them. The board behaves the same and its version code does not change. You cannot go back to the MSS description afterwards.",
    button: "Convert to Field Logic",
    confirm: "Convert this board to Field Logic? The MSS description is replaced by editable items, and this cannot be undone.",
    yes: "Yes, convert",
    no: "Cancel",
    done: "Converted to Field Logic.",
    notMss: "This board is not in MSS Logic.",
    clash: (kind, name) => `Cannot convert yet: the Field Logic ${kind} "${name}" already has the same name as one MSS Logic would make. Rename one of them first.`,
    problems: "Cannot convert yet: the MSS description has an error. Fix it on the MSS pages first.",
  };

  const KINDS = [
    ["blocks", "block", (item) => item.name],
    ["masts", "signal", (item) => item.name ?? item.mast],
    ["layers", "rule group", (item) => item.name],
    ["ends", "plant end", (item) => item.name],
  ];

  /**
   * Convert an MSS board's config to Field Logic, in place. Returns
   * { ok: true } or { ok: false, text } and leaves the config as it was.
   */
  function convertToFieldLogic(config) {
    const M = global.EsphomeMr;
    if (!M || M.logicMode(config) !== "mss") return { ok: false, text: TEXT.notMss };
    const builder = global.EsphomeMrMssBuilder;
    if (builder.problems(config).some((p) => p.level === "error")) return { ok: false, text: TEXT.problems };
    const { blocks, masts, layers, ends } = builder.build(config);
    const built = plain({ blocks, masts, layers, ends });
    const logic = config.logic;
    for (const [key, kind, nameOf] of KINDS) {
      const have = new Set(list(logic[key]).filter(isObject).map(nameOf));
      for (const item of built[key]) {
        if (have.has(nameOf(item))) return { ok: false, text: TEXT.clash(kind, nameOf(item)) };
      }
    }
    for (const [key] of KINDS) logic[key] = [...list(logic[key]), ...built[key]];
    logic.mode = "field";
    logic.share = true; // MSS Logic always shares, so the YAML stays the same
    delete logic.mss;
    return { ok: true };
  }

  function renderConvert(root, config, ctx, ui) {
    const section = ui.card("logic-mss-convert", TEXT.heading);
    section.append(ui.paragraph(TEXT.explain));
    const row = document.createElement("div");
    row.className = "button-row";
    const button = (label, onClick, className = "") => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = className;
      el.textContent = label;
      el.addEventListener("click", onClick);
      return el;
    };
    row.append(button(TEXT.button, () => {
      row.replaceChildren(
        ui.paragraph(TEXT.confirm),
        button(TEXT.yes, () => {
          const result = convertToFieldLogic(config);
          if (!result.ok) return void ctx.flash("err", result.text);
          ctx.persist();
          ctx.render();
          ctx.flash("ok", TEXT.done);
        }),
        button(TEXT.no, () => ctx.render(), "secondary"),
      );
    }));
    section.append(row);
    root.append(section);
  }

  if (global.EsphomeMrLogicUi?.registerPart) {
    global.EsphomeMrLogicUi.registerPart({ id: "logic-mss-convert", order: 900, modes: ["mss"], text: TEXT, render: renderConvert });
  }

  global.EsphomeMrMssConvert = { TEXT, convertToFieldLogic };
})(typeof globalThis !== "undefined" ? globalThis : window);
