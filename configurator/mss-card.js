// Printable module card (docs/mss-emulation-spec.md, The module card; work
// item 4.4). One page of plain HTML for the underside of a module or the meet
// paperwork: the module's ends, every sensor, signal and turnout with its pin
// and where it sits, and the steps for Wi-Fi and pairing at a meet. Pure:
// config in, a self-contained document out, with its own small print CSS and
// no scripts. Made from the same config as the YAML, so the version code is
// the YAML's. Every name is escaped.
//
// Left out on purpose: the spec's drawing of the strips and junctions, and a
// first-checks list beyond the few lines below. The sensor and signal tables
// say where each one sits.
(function (global) {
  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const list = (value) => (Array.isArray(value) ? value : []);
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

  const CSS = `
body { font: 11pt/1.4 system-ui, sans-serif; color: #000; background: #fff; max-width: 190mm; margin: 12mm auto; padding: 0 6mm; }
h1 { font-size: 18pt; margin: 0 0 2mm; }
h2 { font-size: 13pt; margin: 6mm 0 2mm; border-bottom: 1px solid #000; }
p, ul, ol { margin: 1mm 0; }
ul, ol { padding-left: 6mm; }
li { margin-bottom: 1mm; }
.meta { color: #333; }
section { break-inside: avoid; }
code { font-family: ui-monospace, monospace; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 1mm 4mm 1mm 0; border-bottom: 1px solid #bbb; vertical-align: top; }
@media print { body { margin: 0; max-width: none; } }`;

  const TEXT = {
    meetHeading: "At a meet",
    wifiHeading: "Join the meet's Wi-Fi",
    wifi: (hotspot) => [
      `If the board cannot find its Wi-Fi, it starts its own hotspot called ${hotspot}.`,
      "On a phone, join that hotspot. The sign-in page opens by itself.",
      "Pick the meet's Wi-Fi network and type its password.",
    ],
    pairHeading: "Pair at each joint",
    pair: [
      "Check both modules are on the same Wi-Fi and the same MQTT broker.",
      "Press Pair on both sides of the joint within 30 seconds. Use the Pair button on the end, or the Pair button on the board's web page.",
      "The end LED goes steady when the joint is working.",
    ],
    ledHeading: "End LED",
    led: ["Slow blink: pairing.", "Steady: paired and the other side is heard.", "Fast blink: a problem. The other side is not heard, does not agree, or refused."],
    checkHeading: "A joint shows Stop",
    check: ["Is the other module powered and on the same Wi-Fi?", "Press Pair on both sides again within 30 seconds.", "Look at the end's state on the board's web page."],
  };

  /** A pin as written: "GPIO14", or "<expander> · B3" on an expander. */
  function pinText(expander, pin, label) {
    if (typeof expander === "string" && expander) return `${expander} · ${label(pin)}`;
    return String(pin ?? "").trim().toUpperCase();
  }

  /** Where each sensor and signal sits, from the description: name -> [text]. */
  function places(config) {
    const sensors = new Map();
    const signals = new Map();
    const add = (map, name, text) => {
      if (typeof name !== "string" || !name) return;
      if (!map.has(name)) map.set(name, []);
      map.get(name).push(text);
    };
    const mss = isObject(config.logic?.mss) ? (global.EsphomeMrMssBuilder?.descriptionOf(config.logic.mss) || config.logic.mss) : {};
    const place = (ref) => {
      if (isObject(ref) && ref.end !== undefined) return `end ${ref.end} track ${ref.track}`;
      if (isObject(ref) && ref.junction !== undefined) return `junction ${ref.junction} leg ${ref.leg}`;
      return "";
    };
    list(mss.tracks).filter(isObject).forEach((track, t) => {
      const label = `Track ${t + 1} (${place(track.from) || "?"} to ${place(track.to) || "dead end"})`;
      list(track.blocks).filter(isObject).forEach((block, b) => {
        for (const sensor of list(block.sensors)) add(sensors, sensor, `${label}, block ${b + 1}`);
      });
      list(track.boundaries).filter(isObject).forEach((boundary, k) => {
        const where = `${label}, boundary ${k + 1} (between block ${k + 1} and block ${k + 2})`;
        for (const sensor of list(boundary.sensors)) add(sensors, sensor, where);
        add(signals, boundary.towardsFrom, `${where}, facing ${place(track.from) || "the start"}`);
        add(signals, boundary.towardsTo, `${where}, facing ${place(track.to) || "the far side"}`);
      });
    });
    for (const junction of list(mss.junctions).filter(isObject)) {
      for (const sensor of list(junction.sensors)) add(sensors, sensor, `Junction ${junction.name}`);
      for (const [leg, mast] of Object.entries(isObject(junction.masts) ? junction.masts : {})) add(signals, mast, `Junction ${junction.name}, leg ${leg}`);
    }
    return { sensors, signals };
  }

  const row = (cells) => `<tr>${cells.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`;
  const table = (heads, rows) =>
    `<table><tr>${heads.map((head) => `<th>${esc(head)}</th>`).join("")}</tr>${rows.join("")}</table>`;

  /**
   * The card as a complete HTML document. `options.date` is the date made (a
   * Date or text; default now). Returns "" outside MSS Logic.
   */
  function cardHtml(config, options = {}) {
    const M = global.EsphomeMr;
    const Y = global.EsphomeMrLogicYaml;
    if (M.logicMode(config) !== "mss") return "";
    const when = options.date === undefined || options.date instanceof Date ? options.date || new Date() : null;
    const date = when ? when.toISOString().slice(0, 10) : String(options.date);
    const name = String(config.board?.name || "board");
    const hotspot = `${name} setup`;
    const where = places(config);
    const body = [];
    body.push(`<h1>${esc(name)}</h1>`);
    body.push(`<p class="meta">Logic version <code>${esc(Y.versionCode(config))}</code> · made ${esc(date)}</p>`);

    // Ends: the built plant ends, so the names match the YAML.
    body.push("<h2>Ends</h2>");
    const ends = Y.endsOf(config);
    if (!ends.length) body.push("<p>No ends.</p>");
    else {
      body.push(table(["End", "Tracks", "Pair button", "LED"], ends.map((end) => row([
        end.name, list(end.tracks).length,
        pinText(end.pairExpander, end.pairPin, M.expanderPinLabel) || "web page only",
        pinText(end.ledExpander, end.ledPin, M.expanderPinLabel) || "none",
      ]))));
    }

    body.push("<h2>Sensors</h2>");
    const sensors = list(config.blocks).filter(isObject);
    if (!sensors.length) body.push("<p>No sensors.</p>");
    else {
      body.push(table(["Sensor", "Pin", "Where it sits"], sensors.map((sensor) => row([
        sensor.name,
        pinText(sensor.expander, sensor.expander ? sensor.pin : sensor.gpio, M.expanderPinLabel),
        (where.sensors.get(sensor.name) || ["not used by the module"]).join("; "),
      ]))));
    }

    body.push("<h2>Signals</h2>");
    const masts = list(config.signals?.masts).filter(isObject);
    if (!masts.length) body.push("<p>No signals.</p>");
    else {
      body.push(table(["Signal", "Pin", "Where it sits"], masts.map((mast) => {
        const pins = mast.mode === "gpio"
          ? list(mast.lamps).filter(isObject).map((lamp) => `${lamp.name}: ${String(lamp.pin ?? "").toUpperCase()}`).join(", ")
          : `data ${String(mast.pin ?? "").toUpperCase()}`;
        return row([mast.name, pins, (where.signals.get(mast.name) || ["not used by the module"]).join("; ")]);
      })));
    }

    const points = list(config.points).filter(isObject);
    if (points.length) {
      body.push("<h2>Turnouts</h2>");
      body.push(table(["Turnout", "Servo", "Buttons"], points.map((point) => row([
        point.name,
        config.pca9685 !== false ? `PCA9685 board ${Number(point.pcaBoard || 0) + 1}, channel ${point.channel}` : String(point.servoPin ?? "").toUpperCase(),
        list(point.controls).filter((c) => isObject(c) && c.buttonPin).map((c) => String(c.buttonPin).toUpperCase()).join(", ") || "none",
      ]))));
    }

    body.push(`<h2>${esc(TEXT.meetHeading)}</h2>`);
    const steps = (items, tag = "ol") => `<${tag}>${items.map((item) => `<li>${esc(item)}</li>`).join("")}</${tag}>`;
    body.push(`<section><h3>${esc(TEXT.wifiHeading)}</h3>${steps(TEXT.wifi(hotspot))}</section>`);
    body.push(`<section><h3>${esc(TEXT.pairHeading)}</h3>${steps(TEXT.pair)}</section>`);
    body.push(`<section><h3>${esc(TEXT.ledHeading)}</h3>${steps(TEXT.led, "ul")}</section>`);
    body.push(`<section><h3>${esc(TEXT.checkHeading)}</h3>${steps(TEXT.check, "ul")}</section>`);

    return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${esc(name)} module card</title>`
      + `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${CSS}</style></head>`
      + `<body>\n${body.join("\n")}\n</body></html>\n`;
  }

  global.EsphomeMrMssCard = { TEXT, cardHtml, places };
})(typeof globalThis !== "undefined" ? globalThis : window);
