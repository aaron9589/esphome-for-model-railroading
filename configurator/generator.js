/**
 * ESPHome for Model Railroading — board.yaml generator
 * Config schema version: 1
 * Minimum ESPHome: 2026.9.0 (ota encryption reuses the API key)
 * web_server.local is older than that, so the calibration page can load with no internet.
 */

(function (global) {
const CONFIG_MARKER = "esphome-mr-config:1";
const MIN_ESPHOME_VERSION = "2026.9.0";

const PULLUP_PINS = Object.freeze([
  "GPIO0", "GPIO2", "GPIO4", "GPIO5",
  "GPIO12", "GPIO13", "GPIO14", "GPIO15",
  "GPIO16", "GPIO17", "GPIO18", "GPIO19",
  "GPIO21", "GPIO22", "GPIO23",
  "GPIO25", "GPIO26", "GPIO27",
  "GPIO32", "GPIO33",
]);
const PULLUP_PIN_SET = new Set(PULLUP_PINS);
// Original ESP32, from ESPHome 2026.9.0 gpio_esp32.py: {0, 2, 5, 12, 15}.
const STRAPPING_PINS = new Set(["GPIO0", "GPIO2", "GPIO5", "GPIO12", "GPIO15"]);
const NO_PULLUP_PINS = {
  GPIO34: "34",
  GPIO35: "35",
  GPIO36: "VP",
  GPIO39: "VN",
};
const SERIAL_PINS = { GPIO1: "TX", GPIO3: "RX" };
const FLASH_PINS = new Set(["GPIO6", "GPIO7", "GPIO8", "GPIO9", "GPIO10", "GPIO11"]);
const MODULE_VARIANTS = {
  "nodemcu-32s": "esp32",
  esp32dev: "esp32",
  "esp32-s3-devkitc-1": "esp32s3",
};

function sanitizeId(name) {
  const base = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return base || "item";
}

function uniqueIds(items, nameKey = "name") {
  const seen = new Map();
  return items.map((item, index) => {
    let id = sanitizeId(item[nameKey]);
    if (seen.has(id)) {
      const n = seen.get(id) + 1;
      seen.set(id, n);
      id = `${id}_${n}`;
    } else {
      seen.set(id, 1);
    }
    return { ...item, id: item.id || id, _index: index };
  });
}

const SIGNAL_COLORS = Object.freeze({
  off: "000000",
  red: "ff0000",
  amber: "ffc800",
  green: "1fff87",
  white: "ffffff",
});
const SIGNAL_COLOR_ORDER = Object.freeze(["off", "red", "amber", "green", "white"]);
const CATS_ASPECTS = Object.freeze([
  "R288", "RES_LIM", "C424", "ADV_SLO", "C423", "C422",
  "R281D", "R281C", "R281B", "RES_MED", "ADV_NORM", "R283B", "R283A",
  "R291", "R292", "ADV_LIM", "ADV_MED", "C417", "C414", "C413",
  "RES_SLO", "C412", "RES_NORM", "R286", "R287", "R284", "R285",
  "R282", "R283", "R281",
]);
const SIGNAL_BRIGHTNESS = 44.6;
const BLINK_BRIGHTNESS = 66.6;
const PULSE_BRIGHTNESS = 88.5;
const BLINK_ON_S = 0.6;
const BLINK_OFF_S = 0.2;
const PULSE_LENGTH_S = 0.5;
const PULSE_PAUSE_S = 0.3;

function topicFor(kind, name) {
  const prefix = kind === "block"
    ? "trains/track/sensor/"
    : kind === "signal"
      ? "trains/track/signalmast/"
      : "trains/track/turnout/";
  const trimmed = String(name || "").trim();
  if (!trimmed) return "";
  return prefix + trimmed;
}

function signalDefaults() {
  return { masts: [] };
}

function mssDefaults() {
  return { line: "main", opticals: [], blocks: [], junctions: [] };
}

function mssEndDefaults() {
  return {
    optical: "",
    link: "",
    configurable: false,
    mast: "",
    stop: "Stop",
    approach: "Approach",
    advance: "",
    diverging: "",
    clear: "Clear",
    dark: "",
    approachLighting: false,
    divergingFrom: "",
    outMast: "",
    outStop: "Stop",
    outApproach: "Approach",
    outAdvance: "",
    outDiverging: "",
    outClear: "Clear",
    outDark: "",
    outApproachLighting: false,
    outDivergingFrom: "",
    remotes: [],
  };
}

function mssFacing(end, facing) {
  const outward = facing === "out";
  const value = end || {};
  const pick = (outKey, inKey, fallback) => {
    const raw = outward ? value[outKey] : value[inKey];
    return raw === undefined || raw === null ? fallback : raw;
  };
  return {
    mast: String(pick("outMast", "mast", "") || "").trim(),
    stop: pick("outStop", "stop", "Stop"),
    approach: pick("outApproach", "approach", "Approach"),
    advance: pick("outAdvance", "advance", ""),
    diverging: pick("outDiverging", "diverging", ""),
    clear: pick("outClear", "clear", "Clear"),
    dark: pick("outDark", "dark", ""),
    approachLighting: pick("outApproachLighting", "approachLighting", false) === true,
    divergingFrom: pick("outDivergingFrom", "divergingFrom", "") || "",
  };
}

function mastMode(mast, signals) {
  if (mast?.mode === "gpio" || mast?.mode === "addressable") return mast.mode;
  return signals?.mode === "gpio" ? "gpio" : "addressable";
}

function catsAspectState(name) {
  return `${name}; Lit; Unheld`;
}

function blankSignalCell() {
  return { color: "off", mode: "steady" };
}

function stateTopic(topic) {
  const base = String(topic || "").replace(/\/+$/, "");
  if (!base) return "";
  return `${base}/State`;
}

function variantFor(moduleName) {
  return MODULE_VARIANTS[moduleName] || "esp32";
}

function boardDefaults() {
  return {
    name: "my-first-board",
    module: "nodemcu-32s",
    wifiSsid: "",
    wifiPassword: "",
    mqttBroker: "",
    mqttEnabled: true,
    apPassword: "",
    apiKey: "",
  };
}

function myFirstBoardPreset() {
  return {
    board: boardDefaults(),
    blocks: [
      {
        name: "Kiama/Up XOver",
        topic: "trains/track/sensor/Kiama/Up XOver",
        gpio: "GPIO14",
        inverted: true,
        debounce: "500ms",
      },
    ],
    points: [
      {
        name: "Kiama/Up Loop",
        topic: "trains/track/turnout/Kiama/Up Loop",
        channel: 0,
        travelTime: "10s",
        controls: [],
      },
    ],
    i2c: { sda: "GPIO21", scl: "GPIO22" },
    signals: signalDefaults(),
    mss: mssDefaults(),
  };
}

function emptyConfig() {
  return {
    board: boardDefaults(),
    blocks: [],
    points: [],
    i2c: { sda: "GPIO21", scl: "GPIO22" },
    signals: signalDefaults(),
    mss: mssDefaults(),
  };
}

function normalizeConfig(config) {
  if (!config.board) config.board = {};
  const board = config.board;
  if (!board.module && board.boardType) board.module = board.boardType;
  if (!board.module) board.module = "nodemcu-32s";
  delete board.boardType;
  delete board.fallbackHotspot;
  delete board.apiEnabled;
  delete board.otaPassword;
  if (typeof board.mqttEnabled !== "boolean") board.mqttEnabled = true;
  if (typeof config.pca9685 !== "boolean") config.pca9685 = true;
  if (!config.i2c) config.i2c = { sda: "GPIO21", scl: "GPIO22" };
  for (const block of config.blocks || []) {
    if (block.gpio) block.gpio = String(block.gpio).toUpperCase();
  }
  for (const point of config.points || []) {
    if (point.servoPin) point.servoPin = String(point.servoPin).toUpperCase();
    if (!Array.isArray(point.controls)) point.controls = [];
    for (const control of point.controls) {
      if (control.action !== "closed" && control.action !== "thrown") control.action = "toggle";
      if (!control.closedLight && !control.openLight && control.lightPin) {
        const pin = String(control.lightPin).toUpperCase();
        if (control.lightOn === "closed") control.closedLight = pin;
        else control.openLight = pin;
      }
      delete control.lightPin;
      delete control.lightOn;
      if (control.buttonPin) control.buttonPin = String(control.buttonPin).toUpperCase();
      if (control.closedLight) control.closedLight = String(control.closedLight).toUpperCase();
      if (control.openLight) control.openLight = String(control.openLight).toUpperCase();
    }
  }
  if (!config.signals || typeof config.signals !== "object") config.signals = signalDefaults();
  const signals = config.signals;
  const legacyMode = signals.mode === "gpio" ? "gpio" : "addressable";
  const legacyPin = String(signals.pin || "GPIO16").toUpperCase();
  delete signals.mode;
  delete signals.pin;
  delete signals.numLeds;
  if (!Array.isArray(signals.masts)) signals.masts = [];
  for (const mast of signals.masts) {
    if (!mast.name) mast.name = "Mast";
    delete mast.start;
    mast.mode = mast.mode === "gpio" || mast.mode === "addressable" ? mast.mode : legacyMode;
    mast.pin = String(mast.pin || legacyPin).toUpperCase();
    if (typeof mast.topicCustom !== "boolean") mast.topicCustom = false;
    if (!mast.topic) mast.topic = topicFor("signal", mast.name);
    if (!Array.isArray(mast.lamps)) mast.lamps = [];
    for (const lamp of mast.lamps) {
      if (!lamp.name) lamp.name = "Lamp";
      let count = Math.floor(Number(lamp.count) || 1);
      if (count < 1) count = 1;
      if (count > 32) count = 32;
      lamp.count = mast.mode === "gpio" ? 1 : count;
      lamp.pin = String(lamp.pin || "").toUpperCase();
    }
    const leds = mast.lamps.reduce((sum, lamp) => sum + lamp.count, 0);
    mast.numLeds = Math.max(leds, 1);
    if (!Array.isArray(mast.aspects)) mast.aspects = [];
    for (const aspect of mast.aspects) {
      if (!aspect.label) aspect.label = "Aspect";
      if (!Array.isArray(aspect.states)) aspect.states = aspect.state ? [String(aspect.state)] : [""];
      aspect.states = aspect.states.map((state) => String(state ?? ""));
      if (!aspect.states.length) aspect.states = [""];
      delete aspect.state;
      if (!Array.isArray(aspect.lamps)) aspect.lamps = [];
      while (aspect.lamps.length < mast.lamps.length) aspect.lamps.push(blankSignalCell());
      aspect.lamps.length = mast.lamps.length;
      for (const cell of aspect.lamps) {
        if (!SIGNAL_COLORS[cell.color]) cell.color = "off";
        if (cell.color === "off" || (cell.mode !== "blink" && cell.mode !== "pulse")) cell.mode = "steady";
      }
    }
    let startupSeen = false;
    for (const aspect of mast.aspects) {
      aspect.startup = aspect.startup === true && !startupSeen;
      if (aspect.startup) startupSeen = true;
    }
  }
  normalizeMss(config);
  return config;
}

function mssSlug(value) {
  return String(value || "").trim().toLowerCase();
}

function mssSlugOk(value) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function mssDelayOk(value) {
  return /^\d+(\.\d+)?(ms|s|min)$/.test(String(value || ""));
}

function mssCppName(slug) {
  return String(slug || "").replace(/-/g, "_");
}

function cString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function parseMssRemote(text) {
  const parts = String(text || "").trim().split("/");
  if (parts.length !== 3) return null;
  const [node, kind, name] = parts;
  if (!mssSlugOk(node) || !mssSlugOk(name)) return null;
  if (kind !== "current" && kind !== "optical" && kind !== "turnout" && kind !== "route") return null;
  return { node, kind, name };
}

function parseMssDiverging(text) {
  const parts = String(text || "").trim().split("/");
  if (parts.length !== 2) return null;
  const [node, name] = parts;
  if (!mssSlugOk(node) || !mssSlugOk(name)) return null;
  return { node, name };
}

function normalizeMssEnd(end) {
  // The page keeps this object. Replacing it makes the next edit write to the old one.
  const source = end && typeof end === "object" ? end : {};
  const optical = mssSlug(source.optical);
  const configurable = source.configurable === true;
  const link = configurable ? "" : mssSlug(source.link);
  const mast = String(source.mast || "").trim();
  const stop = String(source.stop || "Stop").trim();
  const approach = String(source.approach || "Approach").trim();
  const advance = String(source.advance || "").trim();
  const diverging = String(source.diverging || "").trim();
  const clear = String(source.clear || "Clear").trim();
  const dark = String(source.dark || "").trim();
  const approachLighting = source.approachLighting === true;
  const divergingFrom = mssSlug(source.divergingFrom).replace(/\/+/g, "/");
  const outMast = String(source.outMast || "").trim();
  const outStop = String(source.outStop || "Stop").trim();
  const outApproach = String(source.outApproach || "Approach").trim();
  const outAdvance = String(source.outAdvance || "").trim();
  const outDiverging = String(source.outDiverging || "").trim();
  const outClear = String(source.outClear || "Clear").trim();
  const outDark = String(source.outDark || "").trim();
  const outApproachLighting = source.outApproachLighting === true;
  const outDivergingFrom = mssSlug(source.outDivergingFrom).replace(/\/+/g, "/");
  const remotes = Array.isArray(source.remotes)
    ? source.remotes.map((item) => mssSlug(typeof item === "string" ? item : item?.source).replace(/\/+/g, "/")).filter(Boolean)
    : [];
  const out = source === end && end ? end : mssEndDefaults();
  out.optical = optical;
  out.configurable = configurable;
  out.link = link;
  out.mast = mast;
  out.stop = stop;
  out.approach = approach;
  out.advance = advance;
  out.diverging = diverging;
  out.clear = clear;
  out.dark = dark;
  out.approachLighting = approachLighting;
  out.divergingFrom = divergingFrom;
  out.outMast = outMast;
  out.outStop = outStop;
  out.outApproach = outApproach;
  out.outAdvance = outAdvance;
  out.outDiverging = outDiverging;
  out.outClear = outClear;
  out.outDark = outDark;
  out.outApproachLighting = outApproachLighting;
  out.outDivergingFrom = outDivergingFrom;
  out.remotes = remotes;
  return out;
}

function normalizeMss(config) {
  if (!config.mss || typeof config.mss !== "object" || Array.isArray(config.mss)) config.mss = mssDefaults();
  const mss = config.mss;
  mss.line = mssSlug(mss.line || "main") || "main";
  if (!Array.isArray(mss.opticals)) mss.opticals = [];
  if (!Array.isArray(mss.blocks)) mss.blocks = [];
  if (!Array.isArray(mss.junctions)) mss.junctions = [];
  if (!mss.blocks.length && (Array.isArray(mss.sources) || Array.isArray(mss.signals))) {
    const oldSources = Array.isArray(mss.sources) ? mss.sources : [];
    const oldSignals = Array.isArray(mss.signals) ? mss.signals : [];
    const seenOpt = new Set(mss.opticals.map((item) => mssSlug(item.name)));
    for (const source of oldSources) {
      if (source?.kind !== "optical" || !source.name || seenOpt.has(mssSlug(source.name))) continue;
      seenOpt.add(mssSlug(source.name));
      mss.opticals.push({
        name: source.name,
        pin: source.pin,
        inverted: source.inverted,
        debounce: source.debounce,
      });
    }
    const names = new Set(mss.blocks.map((block) => block.name));
    for (const source of oldSources) if (source?.block) names.add(mssSlug(source.block));
    for (const signal of oldSignals) if (signal?.stopBlock) names.add(mssSlug(signal.stopBlock));
    for (const name of names) {
      if (!name || mss.blocks.some((block) => block.name === name)) continue;
      mss.blocks.push({ name, currents: [], begin: {}, end: {} });
    }
    const byName = new Map(mss.blocks.map((block) => [block.name, block]));
    for (const source of oldSources) {
      if (source?.kind !== "optical") continue;
      const block = byName.get(mssSlug(source.block));
      if (!block) continue;
      const side = block.begin?.optical ? "end" : "begin";
      if (!block[side]) block[side] = {};
      block[side].optical = source.name;
      if (source.alsoBlock && !block[side].link) block[side].link = source.alsoBlock;
    }
    for (const signal of oldSignals) {
      const block = byName.get(mssSlug(signal?.stopBlock));
      if (!block) continue;
      const side = block.begin?.mast ? "end" : "begin";
      if (!block[side]) block[side] = {};
      Object.assign(block[side], {
        mast: signal.mast,
        stop: signal.stop,
        approach: signal.approach,
        advance: signal.advance,
        diverging: signal.diverging,
        clear: signal.clear,
        dark: signal.dark,
        approachLighting: signal.approachLighting,
        divergingFrom: signal.divergingFrom,
      });
    }
  }
  delete mss.sources;
  delete mss.signals;
  for (const optical of mss.opticals) {
    optical.name = mssSlug(optical.name);
    optical.pin = String(optical.pin || "").toUpperCase();
    optical.inverted = optical.inverted !== false;
    optical.debounce = String(optical.debounce || "").trim() || "200ms";
  }
  for (const block of mss.blocks) {
    block.name = mssSlug(block.name);
    block.currents = Array.isArray(block.currents)
      ? block.currents.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    block.begin = normalizeMssEnd(block.begin);
    block.end = normalizeMssEnd(block.end);
    block.diverge = normalizeMssEnd(block.diverge);
    if (block.junction && typeof block.junction === "object") {
      const junction = block.junction;
      block.junction = {
        name: mssSlug(junction.name) || block.name,
        point: String(junction.point || "").trim(),
        pin: junction.point ? "" : String(junction.pin || "").toUpperCase(),
        inverted: junction.inverted !== false,
        thrownIsDiverging: junction.thrownIsDiverging !== false,
        divergingBlock: mssSlug(junction.divergingBlock),
      };
    } else {
      block.junction = null;
    }
  }
  for (const junction of mss.junctions) {
    const main = mssSlug(junction.mainBlock);
    const block = mss.blocks.find((item) => item.name === main);
    if (!block || block.junction) continue;
    block.junction = {
      name: mssSlug(junction.name) || block.name,
      point: String(junction.point || "").trim(),
      pin: junction.point ? "" : String(junction.pin || "").toUpperCase(),
      inverted: junction.inverted !== false,
      thrownIsDiverging: junction.thrownIsDiverging !== false,
      divergingBlock: mssSlug(junction.divergingBlock),
    };
  }
  mss.junctions = [];
  return config;
}

function emptyMssPlan() {
  return {
    active: false,
    needsApply: false,
    line: "main",
    node: "",
    onlineTopic: "",
    sources: [],
    junctions: [],
    signals: [],
    subscriptions: [],
    globals: [],
    lambda: [],
    pointIds: new Set(),
    ownedMastIds: new Set(),
    links: [],
    dynamics: [],
    feeds: new Map(),
    sensorNames: new Set(),
  };
}

function mssEndForBlob(end) {
  const value = end || mssEndDefaults();
  return {
    optical: value.optical || "",
    link: value.link || "",
    configurable: value.configurable === true,
    mast: value.mast || "",
    stop: value.stop || "Stop",
    approach: value.approach || "Approach",
    advance: value.advance || "",
    diverging: value.diverging || "",
    clear: value.clear || "Clear",
    dark: value.dark || "",
    approachLighting: value.approachLighting === true,
    divergingFrom: value.divergingFrom || "",
    outMast: value.outMast || "",
    outStop: value.outStop || "Stop",
    outApproach: value.outApproach || "Approach",
    outAdvance: value.outAdvance || "",
    outDiverging: value.outDiverging || "",
    outClear: value.outClear || "Clear",
    outDark: value.outDark || "",
    outApproachLighting: value.outApproachLighting === true,
    outDivergingFrom: value.outDivergingFrom || "",
    remotes: [...(value.remotes || [])],
  };
}

function mssForBlob(mss) {
  const source = mss || mssDefaults();
  return {
    line: source.line || "main",
    opticals: (source.opticals || []).map((item) => ({
      name: item.name,
      pin: item.pin || "",
      inverted: item.inverted !== false,
      debounce: item.debounce || "200ms",
    })),
    blocks: (source.blocks || []).map((item) => ({
      name: item.name,
      currents: [...(item.currents || [])],
      begin: mssEndForBlob(item.begin),
      end: mssEndForBlob(item.end),
      diverge: mssEndForBlob(item.diverge),
      junction: item.junction ? {
        name: item.junction.name || item.name,
        point: item.junction.point || "",
        pin: item.junction.pin || "",
        inverted: item.junction.inverted !== false,
        thrownIsDiverging: item.junction.thrownIsDiverging !== false,
        divergingBlock: item.junction.divergingBlock || "",
      } : null,
    })),
    junctions: [],
  };
}

function activeJunctions(mss) {
  const list = [];
  for (const block of mss?.blocks || []) {
    const junction = block.junction;
    if (!junction || typeof junction !== "object") continue;
    list.push({
      name: mssSlug(junction.name) || block.name,
      point: String(junction.point || "").trim(),
      pin: junction.point ? "" : String(junction.pin || "").toUpperCase(),
      inverted: junction.inverted !== false,
      thrownIsDiverging: junction.thrownIsDiverging !== false,
      mainBlock: block.name,
      divergingBlock: mssSlug(junction.divergingBlock),
      remotes: [],
    });
  }
  return list;
}

function mssInUse(mss) {
  const source = mss || {};
  return (source.opticals || []).length > 0
    || (source.blocks || []).length > 0
    || (source.junctions || []).length > 0;
}

function compileMss(config) {
  const mss = config.mss || mssDefaults();
  const node = mssSlug(config.board?.name);
  const blocks = (mss.blocks || []).filter((block) => mssSlugOk(block.name));
  const byName = new Map(blocks.map((block) => [block.name, block]));
  const detectors = new Map((config.blocks || []).map((block) => [block.name, block]));
  const opticalByName = new Map((mss.opticals || []).filter((item) => mssSlugOk(item.name)).map((item) => [item.name, item]));
  const sources = [];
  const ports = [];
  const signals = [];
  const detect = new Map(blocks.map((block) => [block.name, []]));

  for (const block of blocks) {
    for (const currentName of block.currents || []) {
      const detector = detectors.get(currentName);
      if (!detector) continue;
      const sensorId = `${sanitizeId(detector.name)}_sensor`;
      sources.push({
        name: sanitizeId(detector.name).replace(/_/g, "-"),
        kind: "current",
        block: block.name,
        blocks: [block.name],
        reused: true,
        detectorName: detector.name,
        existingSensorId: sensorId,
        pin: "",
        point: "",
        inverted: true,
        debounce: detector.debounce || "500ms",
      });
      detect.get(block.name).push(`id(${sensorId}).state`);
    }
  }

  function addOptical(blockName, opticalName) {
    if (!blockName || !opticalByName.has(opticalName)) return;
    const sensorId = `mss_src_${sanitizeId(opticalName)}`;
    const expr = `id(${sensorId}).state`;
    const list = detect.get(blockName);
    if (list && !list.includes(expr)) list.push(expr);
  }

  for (const block of blocks) {
    const sides = block.junction ? ["begin", "end", "diverge"] : ["begin", "end"];
    for (const side of sides) {
      const end = block[side] || {};
      const link = end.link && byName.has(end.link) && end.link !== block.name ? end.link : "";
      const role = end.mast || (!block.junction && end.outMast) || end.optical || link ? "cascade" : "pass";
      const meet = end.configurable === true && !link;
      const key = `${mssCppName(block.name)}_${side}`;
      ports.push({
        key,
        block: block.name,
        side,
        role,
        meet,
        link,
        optical: end.optical && opticalByName.has(end.optical) ? end.optical : "",
        textId: meet ? `mss_link_${key}` : "",
        address: `${node}/${block.name}/${side}`,
      });
      addOptical(block.name, end.optical);
      if (link && end.optical) addOptical(link, end.optical);
      const farSide = side === "begin" ? "end" : "begin";
      for (const facing of (block.junction ? ["in"] : ["in", "out"])) {
        const face = mssFacing(end, facing);
        if (!(role === "cascade" && face.mast)) continue;
        signals.push({
          name: facing === "out" ? `${block.name} ${side} out` : `${block.name} ${side}`,
          facing,
          portKey: key,
          farKey: `${mssCppName(block.name)}_${farSide}`,
          block: block.name,
          ...face,
          stopBlock: block.name,
        });
      }
    }
  }

  const seenOpt = new Set();
  for (const port of ports) {
    if (!port.optical || seenOpt.has(port.optical)) continue;
    seenOpt.add(port.optical);
    const optical = opticalByName.get(port.optical);
    sources.push({
      name: port.optical,
      kind: "optical",
      block: port.block,
      blocks: [port.block],
      pin: optical.pin,
      inverted: optical.inverted !== false,
      debounce: optical.debounce || "200ms",
      point: "",
      reused: false,
    });
  }

  function otherEnd(blockName, comingFrom) {
    return ports.find((port) => port.block === blockName && port.link !== comingFrom) || null;
  }
  for (const signal of signals) {
    const near = ports.find((port) => port.key === signal.portKey);
    const far = ports.find((port) => port.key === signal.farKey);
    const ahead = signal.facing === "out" ? near : far;
    signal.approachBlock = ahead?.link || "";
    signal.approachOcc = ahead?.meet ? "wire" : "";
    signal.behindBlock = signal.facing === "out" ? signal.block : (near?.link || "");
    signal.behindOcc = signal.facing === "out" ? "" : (near?.meet ? "wire" : "");
    signal.advanceBlock = "";
    signal.advanceOcc = "";
    if (ahead?.link) {
      const beyond = otherEnd(ahead.link, ahead.block);
      if (beyond?.link) signal.advanceBlock = beyond.link;
      else if (beyond?.meet) signal.advanceOcc = "wire";
    } else if (ahead?.meet) {
      signal.advanceOcc = "wire";
    }
  }

  return { sources, ports, signals, detect };
}

function validateMss(config, errors, warnings, notePin) {
  const mss = config.mss || mssDefaults();
  if (!mssInUse(mss)) return;
  if (config.board?.mqttEnabled === false) {
    errors.push("Modular signals need MQTT. Turn it back on under Board.");
  }
  if (!mssSlugOk(mss.line)) {
    errors.push("Signaled track name should be lowercase letters, numbers, and dashes, like main.");
  }
  const pointNames = new Set((config.points || []).map((point) => point.name));
  const detectorNames = new Set((config.blocks || []).map((block) => block.name));
  const opticalNames = new Set();
  for (const optical of mss.opticals || []) {
    const who = `Optical detector "${optical.name || "detector"}"`;
    if (!mssSlugOk(optical.name)) errors.push(`${who} needs a name like gap.`);
    else if (opticalNames.has(optical.name)) errors.push(`${who} is already used.`);
    else opticalNames.add(optical.name);
    if (!mssDelayOk(optical.debounce)) errors.push(`${who} debounce should look like 200ms.`);
    const issue = detectorPinProblem(optical.pin);
    if (issue) errors.push(`${who} ${issue}.`);
    else notePin(optical.pin, who);
  }
  const blockNames = new Set();
  for (const block of mss.blocks || []) {
    const who = `Signal block "${block.name || "block"}"`;
    if (!mssSlugOk(block.name)) errors.push(`${who} needs a name like mid.`);
    else if (blockNames.has(block.name)) errors.push(`${who} is already used.`);
    else blockNames.add(block.name);
    for (const current of block.currents || []) {
      if (!detectorNames.has(current)) {
        errors.push(`${who} uses current sensor "${current}", which is not on the Blocks page.`);
      }
    }
  }
  if ((mss.blocks || []).filter((block) => mssSlugOk(block.name)).length > 1) {
    for (const block of mss.blocks || []) {
      if (!mssSlugOk(block.name)) continue;
      const sides = block.junction ? ["begin", "end", "diverge"] : ["begin", "end"];
      const tied = sides.some((side) => {
        const end = block[side] || {};
        return end.configurable || (end.link && end.link !== block.name);
      });
      if (!tied) {
        errors.push(`Signal block "${block.name}" needs an end connected to another block on this board, or set on the web page.`);
      }
    }
  }
  for (const block of mss.blocks || []) {
    if (!mssSlugOk(block.name)) continue;
    const sides = block.junction ? ["begin", "end", "diverge"] : ["begin", "end"];
    for (const side of sides) {
      const end = block[side] || {};
      const where = `${block.name} ${side === "begin" ? "beginning" : side === "end" ? "end" : "diverging"}`;
      if (end.optical && !opticalNames.has(end.optical)) {
        errors.push(`Signal block ${where} uses optical detector "${end.optical}", which is not listed.`);
      }
      if (end.link && !blockNames.has(end.link)) {
        errors.push(`Signal block ${where} connects to "${end.link}", which is not a signal block on this board.`);
      }
      if (end.link === block.name) errors.push(`Signal block ${where} cannot connect to itself.`);
    }
  }
  const compiled = compileMss(config);
  const masts = config.signals?.masts || [];
  const mastByName = new Map(masts.map((mast) => [mast.name, mast]));
  const usedMasts = new Set();
  for (const signal of compiled.signals) {
    const who = `Signal "${signal.name}"`;
    if (signal.mast && usedMasts.has(signal.mast)) {
      errors.push(`${who} uses mast "${signal.mast}", which another MSS signal already uses.`);
    }
    if (signal.mast) usedMasts.add(signal.mast);
    const mast = mastByName.get(signal.mast);
    if (!mast) {
      errors.push(`${who} needs a mast from the Signals page.`);
      continue;
    }
    warnings.push(`${who} drives mast "${mast.name}", so JMRI messages on that mast topic are ignored.`);
    const labels = new Set((mast.aspects || []).map((aspect) => aspect.label));
    for (const [key, title] of [["stop", "Stop"], ["approach", "Approach"], ["clear", "Clear"]]) {
      if (!signal[key] || !labels.has(signal[key])) {
        errors.push(`${who} needs the ${title} aspect on mast "${mast.name}".`);
      }
    }
    if (signal.advance && !labels.has(signal.advance)) {
      errors.push(`${who} Advance Approach aspect "${signal.advance}" is not on mast "${mast.name}".`);
    }
    if (signal.diverging && !labels.has(signal.diverging)) {
      errors.push(`${who} Approach Diverging aspect "${signal.diverging}" is not on mast "${mast.name}".`);
    }
    if (signal.advance && !signal.advanceBlock && !signal.advanceOcc) {
      errors.push(`${who} Advance Approach needs the block two ahead on this board, or a web-page connection that far.`);
    }
    if (!signal.advance && (signal.advanceBlock || signal.advanceOcc)) {
      errors.push(`${who} has a block two ahead but no Advance Approach aspect.`);
    }
    if (signal.approachLighting) {
      if (!signal.dark || !labels.has(signal.dark)) {
        errors.push(`${who} approach lighting needs a Dark aspect with every lamp off.`);
      }
      if (!signal.behindBlock && !signal.behindOcc) {
        errors.push(`${who} approach lighting needs the block connected at that end.`);
      }
    }
    if (!mssSlugOk(signal.stopBlock)) errors.push(`${who} needs the block it protects.`);
    if (signal.diverging) {
      const from = parseMssDiverging(signal.divergingFrom);
      if (!from) errors.push(`${who} Approach Diverging needs the junction ahead, like north/wye.`);
    } else if (signal.divergingFrom) {
      errors.push(`${who} has a junction ahead but no Approach Diverging aspect.`);
    }
  }
  for (const junction of activeJunctions(mss)) {
    const who = `Junction "${junction.name || "junction"}"`;
    if (!mssSlugOk(junction.name)) errors.push(`${who} needs a name like wye.`);
    if (!mssSlugOk(junction.mainBlock) || !mssSlugOk(junction.divergingBlock)) {
      errors.push(`${who} needs a main block and a diverging block.`);
    }
    if (junction.mainBlock && junction.mainBlock === junction.divergingBlock) {
      errors.push(`${who} main and diverging blocks have to be different.`);
    }
    if (junction.point) {
      if (!pointNames.has(junction.point)) errors.push(`${who} follows point "${junction.point}", which is not on this board.`);
    } else {
      const issue = pinProblem(junction.pin, "junction");
      if (issue) errors.push(`${who} ${issue}.`);
      else notePin(junction.pin, who);
    }
  }
  function hasTrainDetector(block) {
    if (!mssSlugOk(block)) return true;
    return compiled.sources.some((source) => (source.blocks || [source.block]).includes(block));
  }
  const watched = new Set();
  for (const signal of compiled.signals) {
    for (const block of [signal.stopBlock, signal.approachBlock, signal.advanceBlock, signal.behindBlock]) {
      if (!mssSlugOk(block) || watched.has(`${signal.name}:${block}`)) continue;
      watched.add(`${signal.name}:${block}`);
      if (!hasTrainDetector(block)) {
        warnings.push(`Signal "${signal.name}" watches block "${block}", but no current, optical, or turnout detector reports it, so that block stays occupied.`);
      }
    }
  }
  for (const junction of activeJunctions(mss)) {
    if (mssSlugOk(junction.divergingBlock) && !hasTrainDetector(junction.divergingBlock)) {
      warnings.push(`Junction "${junction.name}" has no detector for diverging block "${junction.divergingBlock}", so Approach Diverging stays off.`);
    }
  }
}

function buildMssPlan(config, masts, points) {
  if (config.board?.mqttEnabled === false) return emptyMssPlan();
  const mss = config.mss || mssDefaults();
  const node = String(config.board?.name || "");
  const line = mss.line || "main";
  if (!mssSlugOk(line) || !mssSlugOk(node) || !mssInUse(mss)) return emptyMssPlan();

  const compiled = compileMss(config);
  const plan = emptyMssPlan();
  plan.line = line;
  plan.node = node;
  plan.onlineTopic = `mss/${line}/node/${node}/online`;
  plan.links = [{ id: "mss_track", label: "Signaled track", initial: line }];
  const pointByName = new Map((points || []).map((point) => [point.name, point]));
  const mastByName = new Map((masts || []).map((mast) => [mast.name, mast]));
  const portByKey = new Map(compiled.ports.map((port) => [port.key, port]));

  for (const source of uniqueIds(compiled.sources)) {
    if (!mssSlugOk(source.name) || !mssSlugOk(source.block)) continue;
    if (!source.reused && !mssDelayOk(source.debounce)) continue;
    if (!source.reused && !source.pin) continue;
    const item = {
      ...source,
      pointId: "",
      topics: [],
      sensorId: source.existingSensorId || `mss_src_${source.id}`,
    };
    plan.sources.push(item);
    if (source.detectorName) plan.sensorNames.add(source.detectorName);
  }

  for (const junction of uniqueIds(activeJunctions(mss))) {
    if (!mssSlugOk(junction.name) || !mssSlugOk(junction.mainBlock) || !mssSlugOk(junction.divergingBlock)) continue;
    if (junction.mainBlock === junction.divergingBlock) continue;
    const point = junction.point ? pointByName.get(junction.point) : null;
    if (junction.point && !point) continue;
    if (!junction.point && !junction.pin) continue;
    const item = {
      ...junction,
      cpp: mssCppName(junction.name),
      pointId: point ? point.id : "",
      sensorId: `mss_junc_${junction.id}`,
    };
    plan.junctions.push(item);
    if (point) plan.pointIds.add(point.id);
  }

  function aspectIndex(mast, label) {
    const want = String(label || "").trim();
    if (!want || !mast) return -1;
    return (mast.aspects || []).findIndex((aspect) => aspect.label === want);
  }

  for (const port of compiled.ports) {
    if (!port.meet) continue;
    plan.links.push({ id: port.textId, label: `${port.address} neighbor`, initial: "" });
    for (const kind of ["local", "approach", "advance", "diverging", "online"]) {
      plan.globals.push({ id: `mss_rx_${port.key}_${kind}`, type: "int", initial: "0" });
    }
  }

  const signals = [];
  for (const signal of uniqueIds(compiled.signals)) {
    const mast = mastByName.get(signal.mast);
    if (!mast) continue;
    const indexes = {
      stop: aspectIndex(mast, signal.stop),
      approach: aspectIndex(mast, signal.approach),
      advance: aspectIndex(mast, signal.advance),
      diverging: aspectIndex(mast, signal.diverging),
      clear: aspectIndex(mast, signal.clear),
      dark: aspectIndex(mast, signal.dark),
    };
    if (indexes.stop < 0 || indexes.approach < 0 || indexes.clear < 0) continue;
    if (signal.advance && indexes.advance < 0) continue;
    if (signal.approachLighting && indexes.dark < 0) continue;
    const item = {
      ...signal,
      cpp: mssCppName(signal.id),
      mastId: mast.id,
      indexes,
      dirtyId: `mss_dirty_${signal.id}`,
    };
    signals.push(item);
    plan.signals.push(item);
    plan.ownedMastIds.add(mast.id);
    plan.globals.push({ id: item.dirtyId, type: "bool", initial: "false" });
  }

  function rx(port, kind) {
    return `mss_rx_${port.key}_${kind}`;
  }
  function rxOcc(port, kind) {
    return `!(id(${rx(port, "online")}) == 1 && id(${rx(port, kind)}) == 2)`;
  }
  function otherEnd(blockName, comingFrom) {
    const ends = compiled.ports.filter((port) => port.block === blockName);
    return ends.find((port) => port.link !== comingFrom) || null;
  }
  function nextExpr(port) {
    if (!port) return "false";
    if (port.meet) return rxOcc(port, "approach");
    if (port.link) return `occ_${mssCppName(port.link)}`;
    return "false";
  }
  function advanceExpr(port) {
    if (!port) return "false";
    if (port.meet) return rxOcc(port, "advance");
    if (port.link) return nextExpr(otherEnd(port.link, port.block));
    return "false";
  }

  for (const signal of signals) {
    const near = portByKey.get(signal.portKey);
    const far = portByKey.get(signal.farKey);
    const ahead = signal.facing === "out" ? near : far;
    signal.approachBlock = ahead?.link || "";
    signal.approachOcc = ahead?.meet ? "wire" : "";
    signal.advanceBlock = "";
    signal.advanceOcc = "";
    if (ahead?.link) {
      const beyond = otherEnd(ahead.link, ahead.block);
      if (beyond?.link) signal.advanceBlock = beyond.link;
      else if (beyond?.meet) signal.advanceOcc = "wire";
    } else if (ahead?.meet && signal.advance) {
      signal.advanceOcc = "wire";
    }
    signal.behindBlock = signal.facing === "out" ? signal.block : (near?.link || "");
    signal.behindOcc = signal.facing === "out" ? "" : (near?.meet ? "wire" : "");
  }

  const rows = [];
  const nodeLit = cString(node);
  rows.push("auto mss_split = [](const std::string &in, std::string &board, std::string &block, std::string &end) {");
  rows.push("  const auto slash1 = in.find('/');");
  rows.push("  if (slash1 == std::string::npos || slash1 == 0) return false;");
  rows.push("  const auto slash2 = in.find('/', slash1 + 1);");
  rows.push("  if (slash2 == std::string::npos || slash2 == slash1 + 1) return false;");
  rows.push("  if (in.find('/', slash2 + 1) != std::string::npos || slash2 + 1 >= in.size()) return false;");
  rows.push("  board = in.substr(0, slash1);");
  rows.push("  block = in.substr(slash1 + 1, slash2 - slash1 - 1);");
  rows.push("  end = in.substr(slash2 + 1);");
  rows.push("  return true;");
  rows.push("};");
  rows.push("static std::string prev_mss_track;");
  rows.push("const std::string track = id(mss_track).state;");
  rows.push("const bool track_changed = track != prev_mss_track;");

  for (const port of compiled.ports.filter((port) => port.meet)) {
    const prev = `prev_${port.textId}`;
    rows.push("{");
    rows.push(`  static std::string ${prev};`);
    rows.push(`  const std::string addr = id(${port.textId}).state;`);
    rows.push(`  if (track_changed || addr != ${prev}) {`);
    rows.push(`    if (!${prev}.empty() && !prev_mss_track.empty()) {`);
    rows.push("      std::string board, block, end;");
    rows.push(`      if (mss_split(${prev}, board, block, end)) {`);
    for (const kind of ["local", "approach", "advance", "diverging"]) {
      rows.push(`        id(mqtt_server).unsubscribe(std::string("mss/") + prev_mss_track + "/" + board + "/" + block + "/" + end + "/${kind}");`);
    }
    rows.push('        id(mqtt_server).unsubscribe(std::string("mss/") + prev_mss_track + "/node/" + board + "/online");');
    rows.push("      }");
    rows.push("    }");
    for (const kind of ["local", "approach", "advance", "diverging", "online"]) {
      rows.push(`    id(${rx(port, kind)}) = 0;`);
    }
    rows.push(`    ${prev} = addr;`);
    rows.push("    std::string board, block, end;");
    rows.push("    if (!track.empty() && mss_split(addr, board, block, end)) {");
    for (const kind of ["local", "approach", "advance", "diverging"]) {
      const flag = kind === "diverging" ? "payload == \"ACTIVE\"" : "payload == \"ACTIVE\"";
      rows.push(`      id(mqtt_server).subscribe(std::string("mss/") + track + "/" + board + "/" + block + "/" + end + "/${kind}", [](const std::string &, const std::string &payload) {`);
      rows.push(`        id(${rx(port, kind)}) = ${flag} ? 1 : 2;`);
      rows.push("        id(mss_apply).execute();");
      rows.push("      }, 1);");
    }
    rows.push('      id(mqtt_server).subscribe(std::string("mss/") + track + "/node/" + board + "/online", [](const std::string &, const std::string &payload) {');
    rows.push(`        id(${rx(port, "online")}) = payload == "ONLINE" ? 1 : 2;`);
    rows.push("        id(mss_apply).execute();");
    rows.push("      }, 1);");
    rows.push("    }");
    rows.push("  }");
    rows.push("}");
  }
  rows.push("if (track_changed && !prev_mss_track.empty()) {");
  rows.push(`  id(mqtt_server).publish(std::string("mss/") + prev_mss_track + "/node/${nodeLit}/online", std::string("OFFLINE"), 1, true);`);
  rows.push("}");
  rows.push("prev_mss_track = track;");
  rows.push(`if (!track.empty()) id(mqtt_server).publish(std::string("mss/") + track + "/node/${nodeLit}/online", std::string("ONLINE"), 1, true);`);

  const blockNames = [...new Set(compiled.ports.map((port) => port.block))];
  for (const name of blockNames) {
    const cpp = mssCppName(name);
    const parts = compiled.detect.get(name) || [];
    rows.push(`bool real_${cpp} = ${parts.length ? parts.join(" || ") : "false"};`);
    for (const port of compiled.ports.filter((port) => port.block === name && port.meet)) {
      rows.push(`if (${rxOcc(port, "local")}) real_${cpp} = true;`);
    }
  }

  for (const junction of plan.junctions) {
    const thrown = junction.pointId
      ? `id(${junction.pointId}_thrown)`
      : `id(${junction.sensorId}).state`;
    const sense = junction.thrownIsDiverging === false ? `!(${thrown})` : thrown;
    rows.push(`const bool jdiv_${junction.cpp} = ${sense};`);
    rows.push(`const bool force_main_${junction.cpp} = jdiv_${junction.cpp};`);
    rows.push(`const bool force_div_${junction.cpp} = !jdiv_${junction.cpp};`);
  }
  for (const name of blockNames) {
    const cpp = mssCppName(name);
    rows.push(`bool occ_${cpp} = real_${cpp};`);
    for (const junction of plan.junctions) {
      if (junction.mainBlock === name) rows.push(`if (force_main_${junction.cpp}) occ_${cpp} = true;`);
      if (junction.divergingBlock === name) rows.push(`if (force_div_${junction.cpp}) occ_${cpp} = true;`);
    }
  }

  function publishTopic(port, kind, expr) {
    const suffix = cString(`/${port.address}/${kind}`);
    rows.push(`if (!track.empty()) id(mqtt_server).publish(std::string("mss/") + track + "${suffix}", std::string((${expr}) ? "ACTIVE" : "INACTIVE"), 1, true);`);
  }

  for (const port of compiled.ports.filter((port) => port.meet)) {
    const other = compiled.ports.find((item) => item.block === port.block && item.side !== port.side);
    const occExcept = `occ_except_${port.key}`;
    const parts = [...(compiled.detect.get(port.block) || [])];
    for (const item of compiled.ports.filter((item) => item.block === port.block && item.meet && item.key !== port.key)) {
      parts.push(rxOcc(item, "local"));
    }
    for (const junction of plan.junctions) {
      if (junction.mainBlock === port.block) parts.push(`force_main_${junction.cpp}`);
      if (junction.divergingBlock === port.block) parts.push(`force_div_${junction.cpp}`);
    }
    rows.push(`const bool ${occExcept} = ${parts.length ? parts.join(" || ") : "false"};`);
    if (port.role === "pass") {
      publishTopic(port, "local", occExcept);
      publishTopic(port, "approach", other ? nextExpr(other) : "false");
      publishTopic(port, "advance", other?.meet ? rxOcc(other, "advance") : "false");
      const passed = other?.meet ? `(id(${rx(other, "online")}) == 1 && id(${rx(other, "diverging")}) == 1)` : "false";
      publishTopic(port, "diverging", passed);
    } else {
      const optical = port.optical ? `id(mss_src_${sanitizeId(port.optical)}).state` : "false";
      publishTopic(port, "local", optical);
      publishTopic(port, "approach", occExcept);
      publishTopic(port, "advance", other ? nextExpr(other) : "false");
      const trunks = plan.junctions.filter((junction) => junction.mainBlock === port.block);
      const diverging = trunks.length
        ? trunks.map((junction) => `(jdiv_${junction.cpp} && !real_${mssCppName(junction.divergingBlock)})`).join(" || ")
        : "false";
      publishTopic(port, "diverging", diverging);
    }
  }

  for (const signal of signals) {
    const near = portByKey.get(signal.portKey);
    const far = portByKey.get(signal.farKey);
    const from = parseMssDiverging(signal.divergingFrom);
    const localJunction = from && plan.junctions.find((junction) => junction.name === from.name && from.node === node);
    const outward = signal.facing === "out";
    const ahead = outward ? near : far;
    let ad = "false";
    if (localJunction) ad = `(jdiv_${localJunction.cpp} && !real_${mssCppName(localJunction.divergingBlock)})`;
    else if (ahead?.meet) ad = `(id(${rx(ahead, "online")}) == 1 && id(${rx(ahead, "diverging")}) == 1)`;
    const stop = outward
      ? (near?.meet ? rxOcc(near, "local") : near?.link ? `occ_${mssCppName(near.link)}` : "false")
      : `occ_${mssCppName(signal.block)}`;
    const approach = outward
      ? (near?.meet ? rxOcc(near, "approach") : near?.link ? nextExpr(otherEnd(near.link, near.block)) : "false")
      : nextExpr(far);
    const advance = outward
      ? (near?.meet ? rxOcc(near, "advance") : near?.link ? advanceExpr(otherEnd(near.link, near.block)) : "false")
      : advanceExpr(far);
    const behind = outward ? `occ_${mssCppName(signal.block)}` : nextExpr(near);
    const next = `next_${signal.cpp}`;
    rows.push(`const bool ad_${signal.cpp} = ${ad};`);
    rows.push(`int ${next} = ${signal.indexes.clear};`);
    rows.push(`if (${stop}) ${next} = ${signal.indexes.stop};`);
    if (signal.indexes.diverging >= 0) {
      rows.push(`else if ((${approach}) && ad_${signal.cpp}) ${next} = ${signal.indexes.diverging};`);
    }
    rows.push(`else if (${approach}) ${next} = ${signal.indexes.approach};`);
    if (signal.indexes.advance >= 0 && signal.advance) {
      rows.push(`else if (${advance}) ${next} = ${signal.indexes.advance};`);
    }
    if (signal.approachLighting && signal.indexes.dark >= 0) {
      rows.push(`else if (!(${behind})) ${next} = ${signal.indexes.dark};`);
    }
    rows.push(`id(${signal.dirtyId}) = id(${signal.mastId}_aspect) != ${next};`);
    rows.push(`if (id(${signal.dirtyId})) id(${signal.mastId}_aspect) = ${next};`);
  }

  plan.lambda = rows;
  plan.active = true;
  plan.needsApply = true;
  return plan;
}

function emitMssGlobals(lines, plan) {
  for (const item of plan.globals) {
    lines.push(`  - id: ${item.id}`);
    lines.push(`    type: ${item.type}`);
    lines.push("    restore_value: false");
    lines.push(`    initial_value: ${item.type === "bool" ? '"false"' : `'${item.initial}'`}`);
  }
}

function emitMssConnect(lines, plan) {
  for (const source of plan.sources) {
    const payload = source.pointId
      ? `return id(${source.pointId}_thrown) ? "ACTIVE" : "INACTIVE";`
      : `return id(${source.sensorId}).state ? "ACTIVE" : "INACTIVE";`;
    for (const topic of source.topics) {
      lines.push("    - mqtt.publish:");
      lines.push(`        topic: ${yamlQuote(topic)}`);
      lines.push("        payload: !lambda |-");
      lines.push(`          ${payload}`);
      lines.push("        retain: true");
      lines.push("        qos: 1");
    }
  }
  if (plan.needsApply) lines.push("    - script.execute: mss_apply");
}

function emitMssPresence(lines, plan) {
  lines.push("  birth_message:");
  lines.push(`    topic: ${yamlQuote(plan.onlineTopic)}`);
  lines.push("    payload: ONLINE");
  lines.push("    retain: true");
  lines.push("  will_message:");
  lines.push(`    topic: ${yamlQuote(plan.onlineTopic)}`);
  lines.push("    payload: OFFLINE");
  lines.push("    retain: true");
}

function emitMssSubscriptions(lines, plan) {
  if (!plan.subscriptions.length) return;
  lines.push("  on_message:");
  for (const sub of plan.subscriptions) {
    lines.push(`    - topic: ${yamlQuote(sub.topic)}`);
    lines.push("      then:");
    lines.push("        - lambda: |-");
    const test = sub.mode === "online" ? 'x == "ONLINE"' : 'x == "ACTIVE"';
    lines.push(`            id(${sub.globalId}) = (${test}) ? 1 : 2;`);
    if (plan.needsApply) lines.push("        - script.execute: mss_apply");
  }
}

function emitMssSensors(lines, plan) {
  for (const source of plan.sources) {
    if (source.pointId || source.reused) continue;
    // Optical detectors are a GPIO input until the sensing boilerplate replaces this body.
    lines.push("  - platform: gpio");
    lines.push("    pin:");
    lines.push(`      number: ${source.pin}`);
    lines.push(`      inverted: ${source.inverted !== false}`);
    lines.push("      mode:");
    lines.push("        input: true");
    if (source.kind === "turnout") lines.push("        pullup: true");
    lines.push(`    id: ${source.sensorId}`);
    lines.push(`    name: ${yamlQuote(entityName(`MSS ${source.block} ${source.name}`))}`);
    lines.push("    filters:");
    lines.push(`      - delayed_on_off: ${source.debounce || "500ms"}`);
    for (const edge of ["on_press", "on_release"]) {
      const occupied = edge === "on_press";
      lines.push(`    ${edge}:`);
      lines.push("      then:");
      lines.push("        - logger.log:");
      lines.push(`            format: ${yamlQuote(`${source.block} ${source.name} | ${occupied ? "OCCUPIED" : "CLEAR"}`)}`);
      lines.push("            level: INFO");
      lines.push("            tag: mss");
      for (const topic of source.topics) {
        lines.push("        - mqtt.publish:");
        lines.push(`            topic: ${yamlQuote(topic)}`);
        lines.push(`            payload: ${occupied ? "ACTIVE" : "INACTIVE"}`);
        lines.push("            retain: true");
        lines.push("            qos: 1");
      }
      if (plan.needsApply) lines.push("        - script.execute: mss_apply");
    }
  }
  for (const junction of plan.junctions) {
    if (junction.pointId) continue;
    lines.push("  - platform: gpio");
    lines.push("    pin:");
    lines.push(`      number: ${junction.pin}`);
    lines.push(`      inverted: ${junction.inverted !== false}`);
    lines.push("      mode:");
    lines.push("        input: true");
    lines.push("        pullup: true");
    lines.push(`    id: ${junction.sensorId}`);
    lines.push(`    name: ${yamlQuote(entityName(`MSS junction ${junction.name}`))}`);
    lines.push("    filters:");
    lines.push("      - delayed_on_off: 50ms");
    for (const edge of ["on_press", "on_release"]) {
      lines.push(`    ${edge}:`);
      lines.push("      then:");
      lines.push("        - script.execute: mss_apply");
    }
  }
}

function emitMssApply(lines, plan) {
  lines.push("  - id: mss_apply");
  lines.push("    mode: restart");
  lines.push("    then:");
  lines.push("      - lambda: |-");
  if (!plan.lambda.length) lines.push("          return;");
  for (const row of plan.lambda) lines.push(`          ${row}`);
  for (const signal of plan.signals) {
    lines.push("      - if:");
    lines.push("          condition:");
    lines.push(`            lambda: 'return id(${signal.dirtyId});'`);
    lines.push("          then:");
    lines.push("            - script.execute:");
    lines.push(`                id: ${signal.mastId}_show`);
    lines.push("                restart_effects: true");
  }
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  const webcrypto = globalThis.crypto;
  if (!webcrypto || !webcrypto.getRandomValues) {
    throw new Error("crypto.getRandomValues is unavailable");
  }
  webcrypto.getRandomValues(bytes);
  return bytes;
}

const PASSWORD_WORDS = Object.freeze([
  "apple", "arrow", "badge", "baker", "beach", "berry", "birch", "blade",
  "blanket", "bloom", "board", "boat", "boots", "bottle", "branch", "bread",
  "brick", "bridge", "brook", "brush", "bucket", "butter", "cabin", "camel",
  "candle", "canoe", "canyon", "carpet", "carrot", "cedar", "chair", "chalk",
  "cherry", "chest", "cloud", "clover", "coast", "copper", "coral", "crane",
  "creek", "cricket", "crown", "daisy", "dance", "desert", "donkey", "drawer",
  "eagle", "elbow", "falcon", "feather", "fence", "field", "flame", "flower",
  "forest", "fountain", "garden", "ginger", "glove", "goose", "grape", "grass",
  "guitar", "hammer", "harbor", "honey", "horse", "island", "jacket", "kettle",
  "ladder", "lantern", "lemon", "maple", "marble", "market", "meadow", "melon",
  "mirror", "monkey", "moon", "mountain", "needle", "nest", "nickel", "ocean",
  "olive", "orange", "otter", "paddle", "panda", "peach", "pearl", "pencil",
  "pepper", "piano", "pillow", "planet", "pocket", "pond", "rabbit", "river",
  "rocket", "sailor", "scarf", "shadow", "sheep", "shell", "shovel", "silver",
  "singer", "spider", "spring", "stable", "stamp", "stone", "storm", "sugar",
  "sunset", "table", "teapot", "tiger", "timber", "tomato", "towel", "tractor",
]);

function generatePassword() {
  if (PASSWORD_WORDS.length !== 128) {
    throw new Error("password word list must be 128 words");
  }
  const picks = [];
  const used = new Set();
  while (picks.length < 3) {
    const word = PASSWORD_WORDS[randomBytes(1)[0] & 127];
    if (used.has(word)) continue;
    used.add(word);
    picks.push(word.charAt(0).toUpperCase() + word.slice(1));
  }
  return picks.join("");
}

function bytesToBase64(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += alphabet[(triple >> 18) & 63];
    out += alphabet[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : "=";
    out += i + 2 < bytes.length ? alphabet[triple & 63] : "=";
  }
  return out;
}

function generateApiKey() {
  return bytesToBase64(randomBytes(32));
}

function ensureSecrets(config) {
  normalizeConfig(config);
  const board = config.board;
  if (!board.apPassword) board.apPassword = generatePassword();
  if (!board.apiKey) board.apiKey = generateApiKey();
  return config;
}

function signalPinProblem(pin, role = "Signal data pin") {
  const name = String(pin || "").toUpperCase();
  if (!name) return `${role} is missing`;
  if (NO_PULLUP_PINS[name]) {
    return `${role} ${name} (${NO_PULLUP_PINS[name]}) is input only and cannot drive an LED`;
  }
  if (SERIAL_PINS[name]) return `${role} ${name} (${SERIAL_PINS[name]}) is the USB serial port`;
  if (FLASH_PINS.has(name)) return `${role} ${name} is part of the flash chip`;
  if (!PULLUP_PIN_SET.has(name)) return `${role} ${name} is not in the pin list`;
  return "";
}

function outputPinProblem(pin, role) {
  const name = String(pin || "").toUpperCase();
  if (!name) return `${role} pin is missing`;
  if (NO_PULLUP_PINS[name]) {
    return `${role} pin ${name} (${NO_PULLUP_PINS[name]}) is input only and cannot drive a servo`;
  }
  if (SERIAL_PINS[name]) return `${role} pin ${name} (${SERIAL_PINS[name]}) is the USB serial port`;
  if (FLASH_PINS.has(name)) return `${role} pin ${name} is part of the flash chip`;
  if (!PULLUP_PIN_SET.has(name)) return `${role} pin ${name} is not in the pin list`;
  return "";
}

function detectorPinProblem(pin) {
  const name = String(pin || "").toUpperCase();
  if (!name) return "GPIO pin is missing";
  if (PULLUP_PIN_SET.has(name) || NO_PULLUP_PINS[name]) return "";
  if (SERIAL_PINS[name]) return `GPIO pin ${name} (${SERIAL_PINS[name]}) is the USB serial port`;
  if (FLASH_PINS.has(name)) return `GPIO pin ${name} is part of the flash chip`;
  return `GPIO pin ${name} is not in the pin list`;
}

function pinProblem(pin, role) {
  const name = String(pin || "").toUpperCase();
  if (!name) return `${role} pin is missing`;
  if (PULLUP_PIN_SET.has(name)) return "";
  if (NO_PULLUP_PINS[name]) {
    return `${role} pin ${name} (${NO_PULLUP_PINS[name]}) has no internal pull-up`;
  }
  if (SERIAL_PINS[name]) {
    return `${role} pin ${name} (${SERIAL_PINS[name]}) is the USB serial port`;
  }
  if (FLASH_PINS.has(name)) return `${role} pin ${name} is part of the flash chip`;
  return `${role} pin ${name} is not in the pin list`;
}

function validateConfig(config) {
  const warnings = [];
  const errors = [];
  const board = config.board || {};

  if (!board.name || !/^[a-z0-9-]+$/.test(board.name)) {
    errors.push("Board name must be lowercase letters, numbers, and dashes only.");
  }
  if (board.module === "esp32-s3-devkitc-1") {
    warnings.push("This file is for an ESP32-S3, which the picker no longer offers. The YAML still uses variant esp32s3.");
  } else if (board.module && !MODULE_VARIANTS[board.module]) {
    warnings.push(`Unknown module "${board.module}". The YAML uses variant esp32.`);
  }
  if (!board.wifiSsid) warnings.push("Wi-Fi name is empty — fill it in on the Board page before you download.");
  if (!board.wifiPassword) warnings.push("Wi-Fi password is empty — fill it in on the Board page before you download.");
  if (board.mqttEnabled !== false && !board.mqttBroker) warnings.push("MQTT address is empty — use this computer’s network address, not localhost.");
  if (String(board.apPassword || "").length > 0 && String(board.apPassword).length < 8) {
    errors.push("Hotspot password must be at least 8 characters.");
  }
  if (board.name && `${board.name} setup`.length > 32) {
    warnings.push("Hotspot name is longer than 32 characters. Shorten the board name.");
  }

  const pins = new Map();
  function notePin(pin, owner) {
    const key = String(pin || "").toUpperCase();
    if (!key) return;
    if (pins.has(key)) {
      warnings.push(`GPIO clash: ${key} used by "${pins.get(key)}" and "${owner}".`);
    } else {
      pins.set(key, owner);
      if (STRAPPING_PINS.has(key)) {
        warnings.push(`${key} is a strapping pin, used by "${owner}". A pull resistor on it can change how the board boots.`);
      }
    }
  }

  for (const block of config.blocks || []) {
    const pin = String(block.gpio || "").toUpperCase();
    const issue = detectorPinProblem(pin);
    if (issue) {
      errors.push(`Block "${block.name}" ${issue}.`);
      continue;
    }
    notePin(pin, block.name);
  }
  validateMss(config, errors, warnings, notePin);

  if ((config.points || []).length) {
    const usePca = config.pca9685 !== false;
    if (usePca) {
      const i2cPins = [config.i2c?.sda, config.i2c?.scl].filter(Boolean);
      for (const pin of i2cPins) notePin(pin, "PCA9685 I2C");
    } else if (config.points.length > 4) {
      warnings.push("More than 4 servos take power from the ESP. A PCA9685 with an external 5V supply is how this scales up.");
    }
    const channels = new Map();
    for (const point of config.points) {
      if (usePca) {
        const ch = Number(point.channel);
        if (Number.isNaN(ch) || ch < 0 || ch > 15) {
          errors.push(`Point "${point.name}" channel must be 0–15.`);
        } else if (channels.has(ch)) {
          warnings.push(`PCA9685 channel clash: ${ch} used by "${channels.get(ch)}" and "${point.name}".`);
        } else {
          channels.set(ch, point.name);
        }
      } else {
        const servoPin = String(point.servoPin || "").toUpperCase();
        const servoIssue = outputPinProblem(servoPin, "servo");
        if (servoIssue) errors.push(`Point "${point.name}" ${servoIssue}.`);
        else notePin(servoPin, `${point.name} servo`);
      }
      for (const control of point.controls || []) {
        const button = String(control.buttonPin || "").toUpperCase();
        const closedLight = String(control.closedLight || "").toUpperCase();
        const openLight = String(control.openLight || "").toUpperCase();
        const buttonIssue = pinProblem(button, "button");
        if (buttonIssue) errors.push(`Point "${point.name}" ${buttonIssue}.`);
        for (const [role, light] of [["closed", closedLight], ["open", openLight]]) {
          if (!light) continue;
          const lightIssue = pinProblem(light, `${role} light`);
          if (lightIssue) errors.push(`Point "${point.name}" ${lightIssue}.`);
          if (button && light === button) {
            errors.push(`Point "${point.name}" uses ${button} for both the button and a light.`);
          }
        }
        if (closedLight && openLight && closedLight === openLight) {
          errors.push(`Point "${point.name}" uses ${closedLight} for both the closed and open lights.`);
        }
        if (button && !buttonIssue) notePin(button, `${point.name} button`);
        if (closedLight && closedLight !== button && !pinProblem(closedLight, "light")) {
          notePin(closedLight, `${point.name} closed light`);
        }
        if (openLight && openLight !== button && openLight !== closedLight && !pinProblem(openLight, "light")) {
          notePin(openLight, `${point.name} open light`);
        }
      }
    }
  }

  const signals = config.signals || {};
  const masts = signals.masts || [];
  if (masts.length) {
    if (board.mqttEnabled === false) {
      errors.push("Signals need MQTT. Turn it back on under Board.");
    }
    const mssMasts = new Set();
    for (const block of config.mss?.blocks || []) {
      for (const key of ["mast", "outMast"]) {
        for (const end of [block.begin, block.end, block.diverge]) {
          if (end?.[key]) mssMasts.add(end[key]);
        }
      }
    }
    for (const mast of masts) {
      const seen = new Map();
      const owned = mssMasts.has(mast.name);
      for (const aspect of mast.aspects || []) {
        const states = (aspect.states || []).map((state) => String(state).trim()).filter(Boolean);
        if (!states.length && !owned) {
          errors.push(`Mast "${mast.name}" aspect "${aspect.label || "Aspect"}" needs a JMRI string.`);
        }
        for (const state of states) {
          if (seen.has(state)) {
            warnings.push(`Mast "${mast.name}" uses "${state}" on more than one aspect.`);
          } else {
            seen.set(state, aspect.label);
          }
        }
      }
      if (mastMode(mast, signals) === "gpio") {
        for (const lamp of mast.lamps || []) {
          const pin = String(lamp.pin || "").toUpperCase();
          const issue = signalPinProblem(pin, "Output pin");
          if (issue) {
            errors.push(`Mast "${mast.name}" lamp "${lamp.name || "Lamp"}": ${issue}.`);
            continue;
          }
          if (pins.has(pin)) {
            errors.push(`GPIO clash: ${pin} used by "${pins.get(pin)}" and "${mast.name} ${lamp.name}".`);
          } else {
            pins.set(pin, `${mast.name} ${lamp.name}`);
          }
        }
        continue;
      }
      const dataPin = String(mast.pin || signals.pin || "GPIO16").toUpperCase();
      const pinIssue = signalPinProblem(dataPin);
      if (pinIssue) {
        errors.push(`Mast "${mast.name}": ${pinIssue}.`);
      } else if (pins.has(dataPin)) {
        errors.push(`GPIO clash: ${dataPin} used by "${pins.get(dataPin)}" and "${mast.name} strip".`);
      } else {
        pins.set(dataPin, `${mast.name} strip`);
      }
    }
  }

  const ids = new Set();
  for (const block of uniqueIds(config.blocks || [])) {
    if (ids.has(block.id)) warnings.push(`Duplicate id after sanitize: ${block.id}`);
    ids.add(block.id);
  }
  for (const point of uniqueIds(config.points || [])) {
    if (ids.has(point.id)) warnings.push(`Duplicate id after sanitize: ${point.id}`);
    ids.add(point.id);
  }
  for (const mast of uniqueIds(masts)) {
    if (ids.has(mast.id)) warnings.push(`Duplicate id after sanitize: ${mast.id}`);
    ids.add(mast.id);
  }

  return { warnings, errors };
}

function entityName(name) {
  // ESPHome uses "/" in entity names as a URL separator. It warns now and rejects it in 2027.7.0.
  return String(name || "").replace(/\s*\/\s*/g, " - ").replace(/\s+/g, " ").trim();
}

function yamlQuote(value) {
  const s = String(value ?? "");
  if (s === "") return '""';
  if (/[:#{}[\],&*?|>!%@`]/.test(s) || /\s/.test(s) || /['"]/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

/**
 * Parse configurator state from a generated board.yaml
 */
function parseConfigFromYaml(text) {
  const lines = String(text).split(/\r?\n/);
  let foundMarker = false;
  for (const line of lines) {
    if (line.startsWith(`# ${CONFIG_MARKER}`)) {
      foundMarker = true;
      continue;
    }
    if (foundMarker && line.startsWith("# {")) {
      const json = line.slice(2).trim();
      try {
        const config = JSON.parse(json);
        if (!config.board || !Array.isArray(config.blocks) || !Array.isArray(config.points)) {
          throw new Error("Config JSON is missing board/blocks/points.");
        }
        return config;
      } catch (err) {
        throw new Error(`Could not parse configurator state: ${err.message}`);
      }
    }
    if (foundMarker && line.startsWith("#") && !line.startsWith("# {") && line.trim() !== "#") {
      continue;
    }
    if (foundMarker) break;
  }
  throw new Error(
    "This file was not generated by the configurator (missing esphome-mr-config header). Only re-import files downloaded from this tool."
  );
}

function controlForBlob(control) {
  const action = control.action === "closed" || control.action === "thrown" ? control.action : "toggle";
  return {
    action,
    buttonPin: String(control.buttonPin || "").toUpperCase(),
    closedLight: String(control.closedLight || "").toUpperCase(),
    openLight: String(control.openLight || "").toUpperCase(),
  };
}

function emitLights(lines, indent, point, thrown) {
  (point.controls || []).forEach((control, index) => {
    const n = index + 1;
    if (control.closedLight) {
      lines.push(`${indent}- switch.${thrown ? "turn_off" : "turn_on"}: ${point.id}_closed_light_${n}`);
    }
    if (control.openLight) {
      lines.push(`${indent}- switch.${thrown ? "turn_on" : "turn_off"}: ${point.id}_open_light_${n}`);
    }
  });
}

function emitThrowScript(lines, point, thrown, publish, mssRefresh) {
  const which = thrown ? "thrown" : "closed";
  const position = thrown ? "reverse" : "normal";
  const label = thrown ? "THROWN (reverse)" : "CLOSED (normal)";
  const payload = thrown ? "THROWN" : "CLOSED";
  lines.push(`  - id: ${point.id}_throw_${which}`);
  lines.push("    mode: restart");
  lines.push("    parameters:");
  lines.push("      announce: bool");
  lines.push("    then:");
  lines.push(`      - lambda: 'id(${point.id}_thrown) = ${thrown ? "true" : "false"};'`);
  lines.push("      - logger.log:");
  lines.push(`          format: ${yamlQuote(`${point.name} -> ${label}`)}`);
  lines.push("          level: INFO");
  lines.push("          tag: point_control");
  emitLights(lines, "      ", point, thrown);
  lines.push("      - servo.write:");
  lines.push(`          id: ${point.id}_servo`);
  lines.push(`          level: !lambda 'return id(${point.id}_servo_endpoint_${position}).state / 100.0;'`);
  lines.push("      - delay: 1s");
  lines.push("      - servo.write:");
  lines.push(`          id: ${point.id}_servo`);
  lines.push(`          level: !lambda 'return id(${point.id}_servo_endpoint_${position}_backoff).state / 100.0;'`);
  if (mssRefresh) lines.push("      - script.execute: mss_apply");
  if (!publish) return;
  lines.push("      - if:");
  lines.push("          condition:");
  lines.push("            lambda: 'return announce;'");
  lines.push("          then:");
  lines.push("            - mqtt.publish:");
  lines.push(`                topic: ${yamlQuote(stateTopic(point.topic))}`);
  lines.push(`                payload: "${payload}"`);
}

function emitButton(lines, point, control, index) {
  if (!control.buttonPin) return;
  lines.push("  - platform: gpio");
  lines.push("    pin:");
  lines.push(`      number: ${control.buttonPin}`);
  lines.push("      inverted: true");
  lines.push("      mode:");
  lines.push("        input: true");
  lines.push("        pullup: true");
  lines.push(`    id: ${point.id}_button_${index + 1}`);
  lines.push(`    name: ${yamlQuote(entityName(`${point.name} button ${index + 1}`))}`);
  lines.push("    internal: true");
  lines.push("    filters:");
  lines.push("      - delayed_on_off: 50ms");
  lines.push("    on_press:");
  lines.push("      then:");
  if (control.action === "closed" || control.action === "thrown") {
    lines.push("        - script.execute:");
    lines.push(`            id: ${point.id}_throw_${control.action}`);
    lines.push("            announce: true");
    return;
  }
  lines.push("        - if:");
  lines.push("            condition:");
  lines.push(`              lambda: 'return id(${point.id}_thrown);'`);
  lines.push("            then:");
  lines.push("              - script.execute:");
  lines.push(`                  id: ${point.id}_throw_closed`);
  lines.push("                  announce: true");
  lines.push("            else:");
  lines.push("              - script.execute:");
  lines.push(`                  id: ${point.id}_throw_thrown`);
  lines.push("                  announce: true");
}

function signalColorHex(color) {
  return `0x${SIGNAL_COLORS[color] || SIGNAL_COLORS.off}`;
}

function effectName(mode, color) {
  const label = color.charAt(0).toUpperCase() + color.slice(1);
  return mode === "blink" ? `Blink ${label}` : `Pulse ${label}`;
}

function lampLayout(mast) {
  let index = 0;
  return (mast.lamps || []).map((lamp, lampIndex) => {
    const count = Math.max(1, Math.floor(Number(lamp.count) || 1));
    const from = index;
    const to = index + count - 1;
    index = to + 1;
    const effect = (mast.aspects || []).some((aspect) => {
      const cell = aspect.lamps?.[lampIndex];
      return cell && cell.color !== "off" && (cell.mode === "blink" || cell.mode === "pulse");
    });
    return { lamp, lampIndex, from, to, effect };
  });
}

function stripId(mast) {
  return `${mast.id}_strip`;
}

function signalsForBlob(signals) {
  return {
    masts: (signals.masts || []).map((mast) => ({
      name: mast.name,
      topic: mast.topic,
      topicCustom: !!mast.topicCustom,
      lamps: (mast.lamps || []).map(({ name, count, pin }) => ({ name, count, pin: pin || "" })),
      aspects: (mast.aspects || []).map((aspect) => ({
        label: aspect.label,
        states: aspect.states.map((state) => String(state ?? "")),
        lamps: aspect.lamps.map(({ color, mode }) => ({ color, mode })),
        startup: aspect.startup === true,
      })),
      mode: mast.mode,
      pin: mast.pin,
      numLeds: mast.numLeds,
    })),
  };
}

function steadyRuns(layout, cells) {
  const runs = [];
  let current = null;
  layout.forEach((item, index) => {
    if (item.effect) {
      current = null;
      return;
    }
    const color = cells[index]?.color || "off";
    if (current && current.color === color && current.to + 1 === item.from) {
      current.to = item.to;
      return;
    }
    current = { from: item.from, to: item.to, color };
    runs.push(current);
  });
  return runs;
}

function brightnessLambda() {
  return "!lambda 'return id(signal_steady_bright).state / 100.0;'";
}

function startupAspectIndex(mast) {
  const aspects = mast.aspects || [];
  for (let index = 0; index < aspects.length; index += 1) {
    if (aspects[index].startup !== true) continue;
    const ready = (aspects[index].states || []).some((state) => String(state).trim());
    if (ready) return index;
  }
  return -1;
}

function mastShows(mast) {
  if (mast.mssOwned && (mast.aspects || []).length) return true;
  return (mast.aspects || []).some((aspect) => (aspect.states || []).some((state) => String(state).trim()));
}

function signalRgb(color) {
  const hex = SIGNAL_COLORS[color] || SIGNAL_COLORS.off;
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function emitLambda(lines, indent, rows) {
  lines.push(`${indent}lambda: |-`);
  for (const row of rows) lines.push(`${indent}  ${row}`);
}

function brightnessLevel() {
  return "id(signal_steady_bright).state / 100.0f";
}

function blinkBrightnessLevel() {
  return "id(signal_blink_bright).state / 100.0f";
}

function pulseBrightnessLevel() {
  return "id(signal_pulse_peak).state / 100.0f";
}

function effectTiming(mode) {
  if (mode === "blink") {
    return [
      "static uint32_t started = 0;",
      "if (initial_run) started = millis();",
      "float on_s = id(signal_blink_lit).state;",
      "float off_s = id(signal_blink_dark).state;",
      "if (on_s < 0.05f) on_s = 0.05f;",
      "if (off_s < 0.05f) off_s = 0.05f;",
      "const uint32_t on_ms = uint32_t(on_s * 1000.0f);",
      "const uint32_t off_ms = uint32_t(off_s * 1000.0f);",
      "const uint32_t elapsed = (millis() - started) % (on_ms + off_ms);",
      `const float level = elapsed < on_ms ? ${blinkBrightnessLevel()} : 0.0f;`,
    ];
  }
  return [
    "static uint32_t last_ms = 0;",
    "static float phase = 0.0f;",
    "float pulse_s = id(signal_pulse_span).state;",
    "float pause_s = id(signal_pulse_wait).state;",
    "if (pulse_s < 0.05f) pulse_s = 0.05f;",
    "if (pause_s < 0.0f) pause_s = 0.0f;",
    "const float cycle_s = pulse_s + pause_s;",
    "const uint32_t now = millis();",
    "if (initial_run) {",
    "  last_ms = now;",
    "  phase = 0.0f;",
    "}",
    "const float dt = float(now - last_ms) / 1000.0f;",
    "last_ms = now;",
    "phase += dt / cycle_s;",
    "phase -= floorf(phase);",
    "const float t = phase * cycle_s;",
    "const float half = pulse_s * 0.5f;",
    "float wave = 0.0f;",
    "if (t < half) wave = 1.0f - t / half;",
    "else if (t >= half + pause_s) wave = (t - half - pause_s) / half;",
    `const float level = (${pulseBrightnessLevel()}) * wave;`,
  ];
}

function gpioEffectRows(mode) {
  return [
    ...effectTiming(mode),
    "auto call = it.turn_on();",
    "call.set_brightness(level);",
    "call.set_state(true);",
    "call.set_transition_length(0);",
    "call.set_publish(false);",
    "call.set_save(false);",
    "call.perform();",
  ];
}

function emitGpioEffect(lines, mode) {
  lines.push("      - lambda:");
  lines.push(`          name: ${mode === "blink" ? "Blink" : "Pulse"}`);
  lines.push("          update_interval: 16ms");
  emitLambda(lines, "          ", gpioEffectRows(mode));
}

function emitAddressableEffect(lines, cell) {
  const [r, g, b] = signalRgb(cell.color);
  const paint = [
    "Color px(0, 0, 0);",
    `if (level > 0.0f) px = Color(uint8_t(${r} * level), uint8_t(${g} * level), uint8_t(${b} * level));`,
    "for (int32_t i = 0; i < it.size(); i++) it[i] = px;",
  ];
  const rows = [
    ...effectTiming(cell.mode === "blink" ? "blink" : "pulse"),
    ...paint,
  ];
  lines.push("      - addressable_lambda:");
  lines.push(`          name: ${yamlQuote(effectName(cell.mode, cell.color))}`);
  lines.push("          update_interval: 16ms");
  emitLambda(lines, "          ", rows);
}

function emitWhenRestarting(lines, indent, emit) {
  lines.push(`${indent}- if:`);
  lines.push(`${indent}    condition:`);
  lines.push(`${indent}      lambda: 'return restart_effects;'`);
  lines.push(`${indent}    then:`);
  emit(`${indent}      `);
}

function emitAddressable(lines, indent, id, from, to, color) {
  lines.push(`${indent}- light.addressable_set:`);
  lines.push(`${indent}    id: ${id}`);
  lines.push(`${indent}    range_from: ${from}`);
  lines.push(`${indent}    range_to: ${to}`);
  lines.push(`${indent}    color: ${signalColorHex(color)}`);
  if (color !== "off") lines.push(`${indent}    color_brightness: ${brightnessLambda()}`);
}

function emitStrip(lines, mast) {
  lines.push("  - platform: esp32_rmt_led_strip");
  lines.push(`    id: ${stripId(mast)}`);
  lines.push("    internal: true");
  lines.push(`    pin: ${mast.pin}`);
  lines.push(`    num_leds: ${mast.numLeds}`);
  lines.push("    chipset: WS2812");
  lines.push("    channel_colors: GRB");
  lines.push("    default_transition_length: 0s");
  const layout = lampLayout(mast);
  layout.forEach((item) => {
    if (!item.effect) return;
    const effects = [];
    const seen = new Set();
    for (const aspect of mast.aspects || []) {
      const cell = aspect.lamps[item.lampIndex];
      if (!cell || cell.color === "off" || (cell.mode !== "blink" && cell.mode !== "pulse")) continue;
      const key = `${cell.mode}:${cell.color}`;
      if (seen.has(key)) continue;
      seen.add(key);
      effects.push(cell);
    }
    lines.push("  - platform: partition");
    lines.push(`    id: ${mast.id}_lamp_${item.lampIndex}`);
    lines.push(`    name: ${yamlQuote(entityName(`${mast.name} ${item.lamp.name}`))}`);
    lines.push("    internal: true");
    lines.push("    default_transition_length: 0s");
    lines.push("    segments:");
    lines.push(`      - id: ${stripId(mast)}`);
    lines.push(`        from: ${item.from}`);
    lines.push(`        to: ${item.to}`);
    lines.push("    effects:");
    for (const cell of effects) emitAddressableEffect(lines, cell);
  });
}

function emitSignalLights(lines, masts) {
  const strips = masts.filter((mast) => mast.mode !== "gpio");
  const gpio = masts.filter((mast) => mast.mode === "gpio" && (mast.lamps || []).length);
  if (!strips.length && !gpio.length) return;
  lines.push("");
  lines.push("light:");
  for (const mast of strips) emitStrip(lines, mast);
  emitGpioLights(lines, gpio);
}

function emitGpioOutputs(lines, masts) {
  for (const mast of masts) {
    (mast.lamps || []).forEach((lamp, index) => {
      lines.push("  - platform: ledc");
      lines.push(`    id: ${mast.id}_lamp_${index}_output`);
      lines.push(`    pin: ${String(lamp.pin || "").toUpperCase()}`);
      lines.push("    frequency: 1000Hz");
    });
  }
}

function emitGpioLights(lines, masts) {
  for (const mast of masts) {
    (mast.lamps || []).forEach((lamp, index) => {
      const id = `${mast.id}_lamp_${index}`;
      lines.push("  - platform: monochromatic");
      lines.push(`    output: ${id}_output`);
      lines.push(`    id: ${id}`);
      lines.push(`    name: ${yamlQuote(entityName(`${mast.name} ${lamp.name}`))}`);
      lines.push("    internal: true");
      lines.push("    default_transition_length: 0s");
      lines.push("    effects:");
      emitGpioEffect(lines, "blink");
      emitGpioEffect(lines, "pulse");
    });
  }
}

function emitLampCommand(lines, indent, id, cell, gpio) {
  if (!cell || cell.color === "off") {
    lines.push(`${indent}- light.turn_off: ${id}`);
    return;
  }
  lines.push(`${indent}- light.turn_on:`);
  lines.push(`${indent}    id: ${id}`);
  if (!gpio) lines.push(`${indent}    color: ${signalColorHex(cell.color)}`);
  lines.push(`${indent}    brightness: ${brightnessLambda()}`);
  if (cell.mode === "blink" || cell.mode === "pulse") {
    const name = gpio
      ? (cell.mode === "blink" ? "Blink" : "Pulse")
      : effectName(cell.mode, cell.color);
    lines.push(`${indent}    effect: ${yamlQuote(name)}`);
    return;
  }
  lines.push(`${indent}    effect: "None"`);
}

function emitAspectActions(lines, mast, aspect, gpio) {
  const layout = lampLayout(mast);
  const indent = "            ";
  emitWhenRestarting(lines, indent, (inner) => {
    lines.push(`${inner}- logger.log:`);
    lines.push(`${inner}    format: ${yamlQuote(`${mast.name} | ${aspect.label}`)}`);
    lines.push(`${inner}    level: INFO`);
    lines.push(`${inner}    tag: signal_mast`);
  });
  const command = (index, inner, isGpio) => {
    emitLampCommand(lines, inner, `${mast.id}_lamp_${layout[index].lampIndex}`, aspect.lamps[index], isGpio);
  };
  if (gpio) {
    layout.forEach((item, index) => {
      const cell = aspect.lamps[index];
      const effect = cell && cell.color !== "off" && (cell.mode === "blink" || cell.mode === "pulse");
      if (effect) emitWhenRestarting(lines, indent, (inner) => command(index, inner, true));
      else command(index, indent, true);
    });
    return;
  }
  for (const run of steadyRuns(layout, aspect.lamps)) {
    emitAddressable(lines, indent, stripId(mast), run.from, run.to, run.color);
  }
  layout.forEach((item, index) => {
    if (!item.effect) return;
    emitWhenRestarting(lines, indent, (inner) => command(index, inner, false));
  });
}

function emitShowScript(lines, mast) {
  const gpio = mast.mode === "gpio";
  lines.push(`  - id: ${mast.id}_show`);
  lines.push("    mode: restart");
  lines.push("    parameters:");
  lines.push("      restart_effects: bool");
  lines.push("    then:");
  (mast.aspects || []).forEach((aspect, index) => {
    const states = (aspect.states || []).map((state) => String(state).trim()).filter(Boolean);
    if (!mast.mssOwned && !states.length) return;
    lines.push("      - if:");
    lines.push("          condition:");
    lines.push(`            lambda: 'return id(${mast.id}_aspect) == ${index};'`);
    lines.push("          then:");
    emitAspectActions(lines, mast, aspect, gpio);
  });
}

function emitSignalControls(lines, masts) {
  if (!masts.length) return;
  const shows = masts.filter(mastShows);
  lines.push("  - platform: template");
  lines.push('    name: "Signal - Brightness"');
  lines.push("    id: signal_steady_bright");
  lines.push("    min_value: 0.1");
  lines.push("    max_value: 100");
  lines.push(`    initial_value: ${SIGNAL_BRIGHTNESS}`);
  lines.push("    restore_value: true");
  lines.push("    optimistic: true");
  lines.push("    step: 0.1");
  lines.push('    unit_of_measurement: "%"');
  lines.push("    mode: slider");
  if (shows.length) {
    lines.push("    set_action:");
    lines.push("      then:");
    for (const mast of shows) {
      lines.push("        - script.execute:");
      lines.push(`            id: ${mast.id}_show`);
      lines.push("            restart_effects: false");
    }
  }
  emitPercentSlider(lines, "Signal - Blink - Brightness", "signal_blink_bright", BLINK_BRIGHTNESS);
  emitPercentSlider(lines, "Signal - Pulse - Brightness", "signal_pulse_peak", PULSE_BRIGHTNESS);
  emitSecondsSlider(lines, "Signal - Blink - On", "signal_blink_lit", 0.1, 5, BLINK_ON_S);
  emitSecondsSlider(lines, "Signal - Blink - Off", "signal_blink_dark", 0.1, 5, BLINK_OFF_S);
  emitSecondsSlider(lines, "Signal - Pulse - Rate", "signal_pulse_span", 0.1, 10, PULSE_LENGTH_S);
  emitSecondsSlider(lines, "Signal - Pulse - Gap", "signal_pulse_wait", 0.1, 5, PULSE_PAUSE_S);
}

function emitPercentSlider(lines, name, id, initial) {
  lines.push("  - platform: template");
  lines.push(`    name: ${yamlQuote(name)}`);
  lines.push(`    id: ${id}`);
  lines.push("    min_value: 0.1");
  lines.push("    max_value: 100");
  lines.push(`    initial_value: ${initial}`);
  lines.push("    restore_value: true");
  lines.push("    optimistic: true");
  lines.push("    step: 0.1");
  lines.push('    unit_of_measurement: "%"');
  lines.push("    mode: slider");
}

function emitSecondsSlider(lines, name, id, min, max, initial) {
  lines.push("  - platform: template");
  lines.push(`    name: ${yamlQuote(name)}`);
  lines.push(`    id: ${id}`);
  lines.push(`    min_value: ${min}`);
  lines.push(`    max_value: ${max}`);
  lines.push(`    initial_value: ${initial}`);
  lines.push("    restore_value: true");
  lines.push("    optimistic: true");
  lines.push("    step: 0.1");
  lines.push('    unit_of_measurement: "s"');
  lines.push("    mode: slider");
}

function emitSignalTextSensors(lines, masts) {
  for (const mast of masts) {
    if (mast.mssOwned) continue;
    lines.push("  - platform: mqtt_subscribe");
    lines.push(`    name: ${yamlQuote(entityName(mast.name))}`);
    lines.push(`    id: ${mast.id}`);
    lines.push("    internal: true");
    lines.push(`    topic: ${yamlQuote(mast.topic)}`);
    lines.push("    on_value:");
    (mast.aspects || []).forEach((aspect, index) => {
      const states = (aspect.states || []).map((state) => String(state).trim()).filter(Boolean);
      if (!states.length) return;
      lines.push("      - if:");
      lines.push("          condition:");
      if (states.length === 1) {
        lines.push("            text_sensor.state:");
        lines.push(`              id: ${mast.id}`);
        lines.push(`              state: ${yamlQuote(states[0])}`);
      } else {
        lines.push("            or:");
        for (const state of states) {
          lines.push("              - text_sensor.state:");
          lines.push(`                  id: ${mast.id}`);
          lines.push(`                  state: ${yamlQuote(state)}`);
        }
      }
      lines.push("          then:");
      lines.push("            - globals.set:");
      lines.push(`                id: ${mast.id}_aspect`);
      lines.push(`                value: '${index}'`);
      lines.push("            - script.execute:");
      lines.push(`                id: ${mast.id}_show`);
      lines.push("                restart_effects: true");
    });
  }
}

function emitPointTextSensors(lines, points) {
  for (const point of points) {
    lines.push("  - platform: mqtt_subscribe");
    lines.push(`    name: ${yamlQuote(entityName(`${point.name} last command`))}`);
    lines.push(`    id: ${point.id}`);
    lines.push(`    topic: ${yamlQuote(point.topic)}`);
    lines.push("    on_value:");
    lines.push("      - if:");
    lines.push("          condition:");
    lines.push("            text_sensor.state:");
    lines.push(`              id: ${point.id}`);
    lines.push("              state: 'THROWN'");
    lines.push("          then:");
    lines.push("            - script.execute:");
    lines.push(`                id: ${point.id}_throw_thrown`);
    lines.push("                announce: true");
    lines.push("      - if:");
    lines.push("          condition:");
    lines.push("            text_sensor.state:");
    lines.push(`              id: ${point.id}`);
    lines.push("              state: 'CLOSED'");
    lines.push("          then:");
    lines.push("            - script.execute:");
    lines.push(`                id: ${point.id}_throw_closed`);
        lines.push("                announce: true");
  }
}

function generateYaml(config) {
  ensureSecrets(config);
  const board = config.board;
  const blocks = uniqueIds(config.blocks || []);
  const points = uniqueIds(config.points || []);
  const masts = uniqueIds(config.signals?.masts || []);
  const i2c = config.i2c || { sda: "GPIO21", scl: "GPIO22" };
  const usePca = config.pca9685 !== false;
  normalizeMss(config);
  const mssPlan = buildMssPlan(config, masts, points);
  for (const mast of masts) mast.mssOwned = mssPlan.ownedMastIds.has(mast.id);
  const stateForBlob = {
    board: {
      name: board.name,
      module: board.module,
      wifiSsid: board.wifiSsid || "",
      wifiPassword: board.wifiPassword || "",
      mqttBroker: board.mqttBroker || "",
      mqttEnabled: board.mqttEnabled !== false,
      apPassword: board.apPassword || "",
      apiKey: board.apiKey || "",
    },
    blocks: (config.blocks || []).map(({ name, topic, topicCustom, gpio, inverted, debounce }) => ({
      name,
      topic,
      topicCustom: !!topicCustom,
      gpio,
      inverted: !!inverted,
      debounce,
    })),
    points: (config.points || []).map(({ name, topic, topicCustom, channel, servoPin, travelTime, controls }) => ({
      name,
      topic,
      topicCustom: !!topicCustom,
      channel: Number(channel),
      servoPin: servoPin || "",
      travelTime,
      controls: (controls || []).map(controlForBlob),
    })),
    i2c,
    pca9685: config.pca9685 !== false,
    signals: signalsForBlob(config.signals),
    mss: mssForBlob(config.mss),
  };

  const lines = [];
  lines.push(`# ${CONFIG_MARKER}`);
  lines.push(`# ${JSON.stringify(stateForBlob)}`);
  lines.push("#");
  lines.push("# Generated by ESPHome for Model Railroading Configurator");
  lines.push(`# Requires ESPHome >= ${MIN_ESPHOME_VERSION}`);
  lines.push("# Re-import this file into the configurator to edit — avoid hand-editing if you plan to re-import.");
  lines.push("# This file contains Wi-Fi, MQTT, and hotspot credentials — do not commit it to a public repo.");
  lines.push("");

  lines.push("esphome:");
  lines.push(`  name: ${yamlQuote(board.name)}`);
  lines.push(`  min_version: "${MIN_ESPHOME_VERSION}"`);

  // Priority 600 runs before Wi-Fi. A 1-6s stagger keeps a layout power-up
  // from joining every board to the broker at once. 100ms steps feed the watchdog.
  lines.push("  # Wait 1-6 seconds so boards do not all join Wi-Fi and MQTT together.");
  lines.push("  on_boot:");
  lines.push("    - priority: 600");
  lines.push("      then:");
  lines.push("        - lambda: |-");
  lines.push("            int random_delay = 1000 + (esphome::random_uint32() % 5000);");
  lines.push('            ESP_LOGI("main", "Delaying boot for %d milliseconds", random_delay);');
  lines.push("            int delay_step = 100;");
  lines.push("            for (int i = 0; i < random_delay / delay_step; i++) {");
  lines.push("              delay(delay_step);");
  lines.push("              App.feed_wdt();");
  lines.push("            }");
  lines.push("            delay(random_delay % delay_step);");
  lines.push('            ESP_LOGI("main", "Boot delay completed, continuing initialization");');

  const stripMasts = masts.filter((mast) => mast.mode !== "gpio");
  const gpioMasts = masts.filter((mast) => mast.mode === "gpio");
  const startupMasts = masts
    .map((mast) => {
      if (!mast.mssOwned) return { mast, index: startupAspectIndex(mast) };
      const signal = mssPlan.signals.find((item) => item.mastId === mast.id);
      return { mast, index: signal ? signal.indexes.stop : -1 };
    })
    .filter((item) => item.index >= 0);
  if (points.length || stripMasts.length || startupMasts.length) {
    if (points.length) {
      lines.push("    - priority: -200.0");
      lines.push("      then:");
      for (const point of points) {
        lines.push("        - if:");
        lines.push("            condition:");
        lines.push(`              lambda: 'return id(${point.id}_thrown);'`);
        lines.push("            then:");
        lines.push("              - script.execute:");
        lines.push(`                  id: ${point.id}_throw_thrown`);
        lines.push("                  announce: false");
        lines.push("            else:");
        lines.push("              - script.execute:");
        lines.push(`                  id: ${point.id}_throw_closed`);
        lines.push("                  announce: false");
      }
    }
    if (stripMasts.length) {
      lines.push("    - priority: -100.0");
      lines.push("      then:");
      for (const mast of stripMasts) {
        lines.push("        - light.turn_on:");
        lines.push(`            id: ${stripId(mast)}`);
        lines.push("            brightness: 100%");
        lines.push("            red: 0%");
        lines.push("            green: 0%");
        lines.push("            blue: 0%");
      }
    }
    if (startupMasts.length) {
      lines.push("    - priority: -150.0");
      lines.push("      then:");
      for (const { mast, index } of startupMasts) {
        lines.push("        - globals.set:");
        lines.push(`            id: ${mast.id}_aspect`);
        lines.push(`            value: '${index}'`);
        lines.push("        - script.execute:");
        lines.push(`            id: ${mast.id}_show`);
        lines.push("            restart_effects: true");
      }
    }
  }
  if (mssPlan.needsApply) {
    lines.push("    - priority: -250.0");
    lines.push("      then:");
    lines.push("        - script.execute: mss_apply");
  }

  lines.push("");
  lines.push("esp32:");
  lines.push(`  variant: ${variantFor(board.module)}`);
  lines.push("");
  lines.push("logger:");
  lines.push("  level: DEBUG");
  lines.push("");

  lines.push("api:");
  lines.push("  encryption:");
  lines.push(`    key: ${JSON.stringify(board.apiKey || "")}`);
  lines.push("  reboot_timeout: 0s");
  lines.push("");

  lines.push("ota:");
  lines.push("  - platform: esphome");
  lines.push("    encryption:");
  lines.push("");
  lines.push("wifi:");
  lines.push(`  ssid: ${yamlQuote(board.wifiSsid)}`);
  lines.push(`  password: ${yamlQuote(board.wifiPassword)}`);
  lines.push("  power_save_mode: none");
  lines.push("  ap:");
  lines.push(`    ssid: ${yamlQuote(`${board.name} setup`)}`);
  lines.push(`    password: ${yamlQuote(board.apPassword)}`);
  lines.push("");
  lines.push("captive_portal:");
  lines.push("");

  const mqtt = board.mqttEnabled !== false;
  if (mqtt) {
    lines.push("mqtt:");
    lines.push(`  broker: ${yamlQuote(board.mqttBroker)}`);
    lines.push("  id: mqtt_server");
    lines.push("  discovery: false");
    lines.push("  # Empty prefix: ESPHome will not publish or subscribe its own entity topics.");
    lines.push("  topic_prefix: null");
    lines.push("  reboot_timeout: 0s");
    if (blocks.length || points.length || mssPlan.active) {
      lines.push("  on_connect:");
      for (const block of blocks) {
        lines.push("    - mqtt.publish:");
        lines.push(`        topic: ${yamlQuote(block.topic)}`);
        lines.push("        payload: !lambda |-");
        lines.push(`          return id(${block.id}_sensor).state ? "ACTIVE" : "INACTIVE";`);
        lines.push("        retain: false");
        lines.push("        qos: 2");
      }
      for (const point of points) {
        lines.push("    - mqtt.publish:");
        lines.push(`        topic: ${yamlQuote(stateTopic(point.topic))}`);
        lines.push("        payload: !lambda |-");
        lines.push(`          return id(${point.id}_thrown) ? "THROWN" : "CLOSED";`);
      }
      if (mssPlan.active) emitMssConnect(lines, mssPlan);
    }
    if (mssPlan.active) emitMssPresence(lines, mssPlan);
    emitMssSubscriptions(lines, mssPlan);
    lines.push("");
  }
  lines.push("button:");
  lines.push("  - platform: restart");
  lines.push("    id: reboot_esp");
  lines.push('    name: "Restart Board"');

  if (mssPlan.links.length) {
    lines.push("");
    lines.push("text:");
    for (const link of mssPlan.links) {
      lines.push("  - platform: template");
      lines.push(`    name: ${yamlQuote(entityName(link.label || link.name))}`);
      lines.push(`    id: ${link.id}`);
      lines.push("    optimistic: true");
      lines.push("    mode: text");
      lines.push("    restore_value: true");
      lines.push(`    initial_value: ${JSON.stringify(link.initial || "")}`);
      if (mssPlan.needsApply) {
        lines.push("    on_value:");
        lines.push("      then:");
        lines.push("        - script.execute: mss_apply");
      }
    }
  }
  if (points.length || masts.length || mssPlan.links.length) {
    lines.push("");
    lines.push("web_server:");
    lines.push("  local: true");
    lines.push("  ota: false");
  }
  if (points.length) {
    if (usePca) {
      lines.push("");
      lines.push("i2c:");
      lines.push(`  sda: ${i2c.sda}`);
      lines.push(`  scl: ${i2c.scl}`);
      lines.push("  scan: true");
      lines.push("");
      lines.push("pca9685:");
      lines.push("  frequency: 50Hz");
    }
  }
  if (points.length || masts.some(mastShows) || mssPlan.globals.length) {
    lines.push("");
    lines.push("globals:");
    for (const point of points) {
      lines.push(`  - id: ${point.id}_thrown`);
      lines.push("    type: bool");
      lines.push("    restore_value: true");
      lines.push('    initial_value: "false"');
    }
    for (const mast of masts) {
      if (!mastShows(mast)) continue;
      lines.push(`  - id: ${mast.id}_aspect`);
      lines.push("    type: int");
      lines.push("    restore_value: false");
      lines.push("    initial_value: '-1'");
    }
    emitMssGlobals(lines, mssPlan);
  }

  const hasButtons = points.some((point) => (point.controls || []).some((control) => control.buttonPin));
  const mssGpio = mssPlan.sources.some((source) => !source.pointId && !source.reused) || mssPlan.junctions.some((junction) => !junction.pointId);
  if (blocks.length || hasButtons || mssGpio) {
    lines.push("");
    lines.push("binary_sensor:");
    for (const block of blocks) {
      const debounce = block.debounce || "500ms";
      lines.push("  - platform: gpio");
      lines.push("    pin:");
      lines.push(`      number: ${block.gpio}`);
      lines.push(`      inverted: ${block.inverted !== false}`);
      lines.push("      mode:");
      lines.push("        input: true");
      lines.push(`    id: ${block.id}_sensor`);
      lines.push(`    name: ${yamlQuote(entityName(block.name))}`);
      lines.push("    filters:");
      lines.push(`      - delayed_on_off: ${debounce}`);
      lines.push("    on_press:");
      lines.push("      then:");
      lines.push("        - logger.log:");
      lines.push(`            format: ${yamlQuote(`${block.name} | OCCUPIED`)}`);
      lines.push("            level: INFO");
      lines.push("            tag: block_sensor");
      if (mqtt) {
        lines.push("        - mqtt.publish:");
        lines.push(`            topic: ${yamlQuote(block.topic)}`);
        lines.push("            payload: ACTIVE");
        lines.push("            retain: false");
        lines.push("            qos: 2");
        for (const topic of mssPlan.feeds?.get(block.name) || []) {
          lines.push("        - mqtt.publish:");
          lines.push(`            topic: ${yamlQuote(topic)}`);
          lines.push("            payload: ACTIVE");
          lines.push("            retain: true");
          lines.push("            qos: 1");
        }
        if (mssPlan.needsApply && ((mssPlan.feeds?.get(block.name) || []).length || mssPlan.sensorNames?.has(block.name))) {
          lines.push("        - script.execute: mss_apply");
        }
      }
      lines.push("    on_release:");
      lines.push("      then:");
      lines.push("        - logger.log:");
      lines.push(`            format: ${yamlQuote(`${block.name} | UNOCCUPIED`)}`);
      lines.push("            level: INFO");
      lines.push("            tag: block_sensor");
      if (mqtt) {
        lines.push("        - mqtt.publish:");
        lines.push(`            topic: ${yamlQuote(block.topic)}`);
        lines.push("            payload: INACTIVE");
        lines.push("            retain: false");
        lines.push("            qos: 2");
        for (const topic of mssPlan.feeds?.get(block.name) || []) {
          lines.push("        - mqtt.publish:");
          lines.push(`            topic: ${yamlQuote(topic)}`);
          lines.push("            payload: INACTIVE");
          lines.push("            retain: true");
          lines.push("            qos: 1");
        }
        if (mssPlan.needsApply && ((mssPlan.feeds?.get(block.name) || []).length || mssPlan.sensorNames?.has(block.name))) {
          lines.push("        - script.execute: mss_apply");
        }
      }
    }
    if (mqtt && mssPlan.active) emitMssSensors(lines, mssPlan);
    for (const point of points) {
      (point.controls || []).forEach((control, index) => emitButton(lines, point, control, index));
    }
  }

  if (points.length) {
    lines.push("");
    lines.push("number:");
    for (const point of points) {
      const endpoints = [
        ["Normal Position", "normal"],
        ["Normal Backoff", "normal_backoff"],
        ["Reverse Position", "reverse"],
        ["Reverse Backoff", "reverse_backoff"],
      ];
      for (const [label, suffix] of endpoints) {
        lines.push("  - platform: template");
        lines.push(`    name: ${yamlQuote(entityName(`${point.name} ${label}`))}`);
        lines.push(`    id: ${point.id}_servo_endpoint_${suffix}`);
        lines.push("    min_value: -50");
        lines.push("    max_value: 50");
        lines.push("    initial_value: 0");
        lines.push("    restore_value: true");
        lines.push("    optimistic: true");
        lines.push("    step: 0.1");
        lines.push("    set_action:");
        lines.push("      then:");
        lines.push("        - servo.write:");
        lines.push(`            id: ${point.id}_servo`);
        lines.push("            level: !lambda 'return x / 100.0;'");
      }
    }
    emitSignalControls(lines, masts);

    lines.push("");
    lines.push("output:");
    for (const point of points) {
      lines.push(`  - platform: ${usePca ? "pca9685" : "ledc"}`);
      lines.push(`    id: ${point.id}_output`);
      if (usePca) {
        lines.push(`    channel: ${Number(point.channel)}`);
      } else {
        lines.push(`    pin: ${point.servoPin}`);
        lines.push("    frequency: 50Hz");
      }
    }
    if (gpioMasts.some((mast) => (mast.lamps || []).length)) emitGpioOutputs(lines, gpioMasts);

    lines.push("");
    lines.push("servo:");
    for (const point of points) {
      lines.push(`  - id: ${point.id}_servo`);
      lines.push(`    output: ${point.id}_output`);
      lines.push("    auto_detach_time: 0s");
      lines.push(`    transition_length: ${point.travelTime || "10s"}`);
    }

    const lights = [];
    for (const point of points) {
      (point.controls || []).forEach((control, index) => {
        const n = index + 1;
        if (control.closedLight) {
          lights.push({ point, pin: control.closedLight, id: `${point.id}_closed_light_${n}`, name: entityName(`${point.name} closed light ${n}`) });
        }
        if (control.openLight) {
          lights.push({ point, pin: control.openLight, id: `${point.id}_open_light_${n}`, name: entityName(`${point.name} open light ${n}`) });
        }
      });
    }
    if (lights.length) {
      lines.push("");
      lines.push("switch:");
      for (const light of lights) {
        lines.push("  - platform: gpio");
        lines.push(`    pin: ${light.pin}`);
        lines.push(`    id: ${light.id}`);
        lines.push(`    name: ${yamlQuote(light.name)}`);
        lines.push("    internal: true");
      }
    }

    lines.push("");
    lines.push("script:");
    for (const point of points) {
      emitThrowScript(lines, point, false, mqtt, mssPlan.pointIds.has(point.id));
      emitThrowScript(lines, point, true, mqtt, mssPlan.pointIds.has(point.id));
    }
    for (const mast of masts) {
      if (mastShows(mast)) emitShowScript(lines, mast);
    }
    if (mssPlan.needsApply) emitMssApply(lines, mssPlan);

  } else if (masts.length) {
    lines.push("");
    lines.push("number:");
    emitSignalControls(lines, masts);
    if (masts.some(mastShows)) {
      lines.push("");
      lines.push("script:");
      for (const mast of masts) {
        if (mastShows(mast)) emitShowScript(lines, mast);
      }
    }
    if (mssPlan.needsApply) {
      if (!masts.some(mastShows)) {
        lines.push("");
        lines.push("script:");
      }
      emitMssApply(lines, mssPlan);
    }
  } else if (mssPlan.needsApply) {
    lines.push("");
    lines.push("script:");
    emitMssApply(lines, mssPlan);
  }

  const gpioWithLamps = gpioMasts.filter((mast) => (mast.lamps || []).length);
  if (gpioWithLamps.length && !points.length) {
    lines.push("");
    lines.push("output:");
    emitGpioOutputs(lines, gpioWithLamps);
  }
  if (masts.length) emitSignalLights(lines, masts);
  const subscribedMasts = masts.filter((mast) => !mast.mssOwned);
  if (mqtt && (points.length || subscribedMasts.length)) {
    lines.push("");
    lines.push("text_sensor:");
    if (points.length) emitPointTextSensors(lines, points);
    if (subscribedMasts.length) emitSignalTextSensors(lines, subscribedMasts);
  }

  lines.push("");
  return lines.join("\n");
}

  global.EsphomeMr = {
    CONFIG_MARKER,
    MIN_ESPHOME_VERSION,
    PULLUP_PINS,
    STRAPPING_PINS,
    NO_PULLUP_PINS,
    sanitizeId,
    uniqueIds,
    myFirstBoardPreset,
    emptyConfig,
    topicFor,
    stateTopic,
    SIGNAL_COLORS,
    SIGNAL_COLOR_ORDER,
    CATS_ASPECTS,
    catsAspectState,
    variantFor,
    normalizeConfig,
    ensureSecrets,
    generatePassword,
    validateConfig,
    parseConfigFromYaml,
    generateYaml,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
