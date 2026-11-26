// Printable summary (docs/field-logic-spec.md, Something to keep, and a
// guide; work item 2.11). One page of plain HTML for the workbench or the
// underside of a module: each signal the logic sets with its Explain
// sentences, each block with its sensors and their pins, each section with
// when it is freed. Pure: config in, a self-contained document out, with its
// own small print CSS and no scripts. Made from the same config as the YAML,
// so the version code is the YAML's.
(function (global) {
  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const list = (value) => (Array.isArray(value) ? value : []);

  const CSS = `
body { font: 11pt/1.4 system-ui, sans-serif; color: #000; background: #fff; max-width: 190mm; margin: 12mm auto; padding: 0 6mm; }
h1 { font-size: 18pt; margin: 0 0 2mm; }
h2 { font-size: 13pt; margin: 6mm 0 2mm; border-bottom: 1px solid #000; }
h3 { font-size: 11pt; margin: 3mm 0 1mm; }
p, ul { margin: 1mm 0; }
ul { padding-left: 6mm; }
.meta { color: #333; }
.item { break-inside: avoid; margin-bottom: 3mm; }
code { font-family: ui-monospace, monospace; }
table { border-collapse: collapse; }
td { padding: 0 6mm 0 0; }
@media print { body { margin: 0; max-width: none; } }`;

  /** A block member and where it is wired: "GPIO14", "MCP 1 · B3", or "from <board>". */
  function pinOf(config, member) {
    const Y = global.EsphomeMrLogicYaml;
    const found = Y.blockMember(config, member);
    if (found.remote) {
      const ref = found.remote;
      return { name: String(ref[Y.remoteKind(ref)] ?? ""), pin: `from ${ref.board}` };
    }
    if (found.local) {
      const sensor = found.local;
      const pin = sensor.expander
        ? `${sensor.expander} · ${global.EsphomeMr.expanderPinLabel(sensor.pin)}`
        : String(sensor.gpio ?? "");
      return { name: String(sensor.name), pin };
    }
    return { name: String(member), pin: "not on the Sensors page" };
  }

  /** Signals the logic sets: Signal Masts page order, then signals with no lights. */
  function logicSignals(config) {
    const Y = global.EsphomeMrLogicYaml;
    const set = Y.fieldMastNames(config);
    const names = list(config.signals?.masts).map((mast) => String(mast.name)).filter((name) => set.has(name));
    for (const entry of Y.virtualMasts(config)) if (set.has(entry.name)) names.push(String(entry.name));
    return [...new Set(names)];
  }

  /**
   * The summary as a complete HTML document. `options.date` is the date made
   * (a Date or text; default now). Returns "" outside Field Logic.
   */
  function summaryHtml(config, options = {}) {
    const Y = global.EsphomeMrLogicYaml;
    const table = Y.logicTable(config);
    if (!table) return "";
    const logic = global.EsphomeMrLogic;
    const when = options.date === undefined || options.date instanceof Date ? options.date || new Date() : null;
    const date = when ? when.toISOString().slice(0, 10) : String(options.date);
    const name = String(config.board?.name || "board");
    const body = [];
    body.push(`<h1>${esc(name)}</h1>`);
    body.push(`<p class="meta">Logic version <code>${esc(Y.versionCode(config))}</code> · made ${esc(date)}</p>`);

    body.push("<h2>Signals</h2>");
    const noLights = new Set(Y.virtualMasts(config).map((entry) => String(entry.name)));
    const onPage = new Set(list(config.signals?.masts).map((mast) => String(mast.name)));
    const signals = logicSignals(config);
    if (!signals.length) body.push("<p>No signal is set by the logic.</p>");
    for (const mast of signals) {
      const kind = noLights.has(mast) && !onPage.has(mast) ? " (signal with no lights)" : "";
      const approach = table.masts?.[mast]?.approachLight;
      body.push(`<div class="item"><h3>${esc(mast)}${kind}</h3><ul>`);
      for (const sentence of logic.explainMast(table, mast)) body.push(`<li>${esc(sentence)}</li>`);
      body.push("</ul>");
      body.push(`<p>Approach lighting: ${approach !== undefined ? `on, lit when a train is in ${esc(approach)}` : "off"}.</p></div>`);
    }

    // A track plan's blocks and sections are built; MSS Logic lists them on
    // its module card.
    const items = (config.logic?.mode === "field" ? Y.logicItems(config) : config.logic) || {};
    body.push("<h2>Blocks</h2>");
    const blocks = list(items.blocks);
    if (!blocks.length) body.push("<p>No blocks.</p>");
    for (const block of blocks) {
      body.push(`<div class="item"><h3>${esc(block.name)}</h3>`);
      const members = list(block.sensors).filter((m) => m !== null && m !== undefined);
      if (!members.length) body.push("<p>No sensors.</p>");
      else {
        body.push("<table>");
        for (const member of members) {
          const { name: sensor, pin } = pinOf(config, member);
          body.push(`<tr><td>${esc(sensor)}</td><td><code>${esc(pin)}</code></td></tr>`);
        }
        body.push("</table>");
      }
      body.push("</div>");
    }

    const sections = list(items.resources).filter((res) => res && typeof res === "object");
    if (sections.length) {
      body.push("<h2>Sections</h2>");
      for (const section of sections) {
        const free = section.release === undefined ? "" : logic.explainRule({ trigger: section.release });
        const members = list(section.blocks).map((b) => esc(typeof b === "string" ? b : b?.block ?? ""));
        body.push(`<div class="item"><h3>${esc(section.name)}</h3>`);
        body.push(`<p>Blocks: ${members.join(", ") || "none"}.</p>`);
        body.push(`<p>Free the section when ${free ? esc(free) : "(not set yet)"}.</p></div>`);
      }
    }

    return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${esc(name)} logic summary</title>`
      + `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style></head>`
      + `<body>\n${body.join("\n")}\n</body></html>\n`;
  }

  global.EsphomeMrLogicSummary = { summaryHtml, logicSignals, pinOf };
})(typeof globalThis !== "undefined" ? globalThis : window);
