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

// A classic ESP32 has two I2C buses. Each PCA9685 gets its own pair of pins,
// so two boards (32 servos) is the most one ESP32 can drive this way.
const MAX_PCA_BOARDS = 2;

// The PCA9685 boards in a config. Files from before multiple boards had one
// `i2c` pin pair, which becomes board 1.
function pcaBoardsOf(config) {
  if (Array.isArray(config.pcaBoards) && config.pcaBoards.length) return config.pcaBoards;
  return [config.i2c || { sda: "GPIO21", scl: "GPIO22" }];
}

// Which PCA9685 a point is on. Missing or out of range means board 1.
function pcaBoardIndex(point, count) {
  const n = Number(point.pcaBoard);
  return Number.isInteger(n) && n >= 0 && n < count ? n : 0;
}

// MCP23017 expanders: 16 more sensor pins over I2C each. An expander shares a
// PCA9685 board's SDA and SCL (`bus`: that board's number, from 1) or has its
// own pins (`sda`, `scl`). Sensors on one store `expander` (its name) and `pin`
// (0-15: A0-A7 are 0-7, B0-B7 are 8-15) in place of `gpio`.
const MCP_ADDRESSES = Object.freeze(["0x20", "0x21", "0x22", "0x23", "0x24", "0x25", "0x26", "0x27"]);
const MAX_EXPANDERS_PER_BUS = 8;
// I2C buses per chip. Every module the configurator offers has two.
const I2C_BUS_LIMITS = Object.freeze({ esp32: 2, esp32s3: 2 });

function expanderPinLabel(pin) {
  const n = Number(pin);
  return n < 8 ? `A${n}` : `B${n - 8}`;
}

function i2cBusLimit(moduleName) {
  return I2C_BUS_LIMITS[variantFor(moduleName)] || 2;
}

// PCA9685 boards are driven only when there are turnouts on them.
function pcaInUse(config) {
  return config.pca9685 !== false && (config.points || []).length > 0;
}

/**
 * The I2C buses this board drives, in order: each PCA9685 board in use, then
 * each pair of expander pins not already a bus. Each bus lists its PCA9685
 * board (`pca`, or null) and its expanders (indexes into config.expanders).
 * An expander that shares a board with no turnouts uses that board's pins as
 * its own bus. One that shares a board that does not exist is left off (a
 * validation error).
 */
function i2cBuses(config) {
  const buses = [];
  const pcaBoards = pcaBoardsOf(config);
  if (pcaInUse(config)) {
    pcaBoards.forEach((pcaBoard, i) => {
      buses.push({ sda: String(pcaBoard.sda || "").toUpperCase(), scl: String(pcaBoard.scl || "").toUpperCase(), pca: i, expanders: [] });
    });
  }
  (config.expanders || []).forEach((expander, i) => {
    let bus = expander.bus ? buses.find((b) => b.pca === expander.bus - 1) : null;
    if (!bus) {
      const pins = expander.bus ? pcaBoards[expander.bus - 1] : expander;
      if (!pins) return;
      const sda = String(pins.sda || "").toUpperCase();
      const scl = String(pins.scl || "").toUpperCase();
      bus = buses.find((b) => b.sda === sda && b.scl === scl);
      if (!bus) {
        bus = { sda, scl, pca: null, expanders: [] };
        buses.push(bus);
      }
    }
    bus.expanders.push(i);
  });
  return buses;
}

function expanderId(index) {
  return `mcp23017_${index + 1}`;
}

// The Logic page (docs/field-logic-spec.md) is stored in config.logic. A board
// with logic mode None and Share unticked keeps no logic key, so its YAML is
// exactly what it was before the Logic page existed.
const LOGIC_MODE_NAMES = Object.freeze({ field: "Field Logic", mss: "MSS Logic" });

// The mode this configurator runs. A mode from a newer configurator is kept in
// the file but runs as None here.
function logicMode(config) {
  const mode = config?.logic?.mode;
  return LOGIC_MODE_NAMES[mode] ? mode : "none";
}

// Share with other boards. Until it is ticked or unticked, it follows the
// mode: on in Field Logic, off with None. Always on in MSS Logic.
function sharesWithOtherBoards(config) {
  const mode = logicMode(config);
  if (mode === "mss") return true;
  const share = config?.logic?.share;
  return share === undefined ? mode === "field" : share === true;
}

function normalizeLogic(config) {
  const logic = config.logic;
  if (!logic || typeof logic !== "object" || Array.isArray(logic)) {
    delete config.logic;
    return;
  }
  if (typeof logic.mode !== "string" || !logic.mode || logic.mode === "none") delete logic.mode;
  if (logic.share !== undefined) logic.share = logic.share === true;
  // A hand-edited file can hold anything: keep only linked boards that are objects.
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  // MSS Logic's description: an object, or nothing. mss-builder.js reads the
  // rest of it defensively and validation names what is wrong.
  if (logic.mss !== undefined && !isObject(logic.mss)) delete logic.mss;
  // The track plan likewise (plan-builder.js).
  if (logic.plan !== undefined && !isObject(logic.plan)) delete logic.plan;
  if (logic.remoteBoards !== undefined) {
    logic.remoteBoards = Array.isArray(logic.remoteBoards) ? logic.remoteBoards.filter(isObject) : [];
    for (const board of logic.remoteBoards) {
      for (const key of ["blocks", "points"]) {
        board[key] = Array.isArray(board[key]) ? board[key].filter(isObject) : [];
      }
      if (!isObject(board.logic)) board.logic = {};
      board.logic.blocks = Array.isArray(board.logic.blocks) ? board.logic.blocks.filter(isObject) : [];
      board.logic.masts = Array.isArray(board.logic.masts) ? board.logic.masts.filter(isObject) : [];
      if (!isObject(board.signals)) board.signals = {};
      board.signals.masts = Array.isArray(board.signals.masts) ? board.signals.masts.filter(isObject) : [];
    }
  }
  // Blocks: a name, a topic that follows the name until it is edited, and
  // sensors, each a name on this board or { board, sensor | block }.
  if (logic.blocks !== undefined) {
    logic.blocks = Array.isArray(logic.blocks) ? logic.blocks.filter(isObject) : [];
    for (const block of logic.blocks) {
      block.name = typeof block.name === "string" ? block.name : "";
      if (typeof block.topic !== "string") block.topic = topicFor("block", block.name);
      if (typeof block.topicCustom !== "boolean") block.topicCustom = block.topic !== topicFor("block", block.name);
      block.sensors = Array.isArray(block.sensors)
        ? block.sensors.filter((member) => typeof member === "string" || isObject(member))
        : [];
    }
  }
}

// What goes in the config blob: nothing for an empty Logic page. Share
// unticked with mode None is the same as never ticked, so it is not written.
// Keys this configurator does not know yet are kept, so a newer file
// round-trips.
function logicForBlob(logic) {
  if (!logic || typeof logic !== "object") return undefined;
  const hasContent = Object.entries(logic).some(([key, value]) => {
    if (key === "share") return value === true;
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null && value !== false;
  });
  return hasContent ? JSON.parse(JSON.stringify(logic)) : undefined;
}

// The logic emitters live in logic-yaml.js. A board that uses no logic needs
// nothing from it; one that does gets a clear error if it is not loaded.
const NO_LOGIC_HOOKS = new Proxy({}, { get: () => () => undefined });

function logicHooks(config) {
  if (global.EsphomeMrLogicYaml) return global.EsphomeMrLogicYaml;
  if (config?.logic && (logicMode(config) !== "none" || sharesWithOtherBoards(config))) {
    throw new Error("This board uses the Logic page, but logic-yaml.js is not loaded.");
  }
  return NO_LOGIC_HOOKS;
}

// Ids from names, numbered on a repeat. A number is skipped when another name
// already gave that id ("X", "x", "X 2" are x, x_2, x_2_2... not x_2 twice).
function uniqueIds(items, nameKey = "name") {
  const seen = new Map();
  const used = new Set();
  return items.map((item, index) => {
    const base = sanitizeId(item[nameKey]);
    let id = base;
    if (used.has(id)) {
      let n = seen.get(base) || 1;
      do {
        n += 1;
        id = `${base}_${n}`;
      } while (used.has(id));
      seen.set(base, n);
    }
    used.add(id);
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
// What each aspect means for a train, most restrictive first (field logic
// spec, Aspect tags). Logic picks between rules by this order, and reads a
// mast by meaning ("while North is not stop").
const ASPECT_TAGS = Object.freeze(["stop", "restricting", "approach", "advance", "clear"]);
// The CATS aspects' tags, from the speeds in the CATS signal template
// (.jmri/resources/signals/cats-masts/aspects.xml: `speed` past this signal,
// `speed2` at the next). The first rule that matches wins:
//   speed Stop                 -> stop
//   speed Restricted or Slow   -> restricting
//   speed2 Stop                -> approach
//   name starts ADV_           -> advance
//   anything else              -> clear
// test/aspect-tags.test.js applies those rules to the template, so keep the
// two in step.
const CATS_ASPECT_TAGS = Object.freeze({
  R292: "stop", R291: "stop",
  RES_NORM: "restricting", RES_LIM: "restricting", RES_MED: "restricting", RES_SLO: "restricting",
  R287: "restricting", R288: "restricting", C422: "restricting", C423: "restricting", C424: "restricting",
  R285: "approach", R281D: "approach", R286: "approach",
  ADV_NORM: "advance", ADV_LIM: "advance", ADV_MED: "advance", ADV_SLO: "advance",
  R281: "clear", R281B: "clear", R281C: "clear", R282: "clear", R283: "clear", R283A: "clear",
  R283B: "clear", R284: "clear", C412: "clear", C413: "clear", C414: "clear", C417: "clear",
});
// CATS aspects that send a train on a diverging route, at Medium or Limited
// speed: the aspects in SpeedTable's LIMITED and MEDIUM rows (the near speed,
// in AspectMap.java), less the Advance and Restricting aspects. Not the
// aspects' own AspectMap.Speed values: R281D and R286 have Approach speed
// there, but are Limited and Medium Approach. Nor the template's speed: it
// gives plain Approach (R285) speed Medium.
const CATS_DIVERGING = Object.freeze(["R281C", "C412", "C413", "C414", "R281D", "R283", "C417", "R283A", "R283B", "R286"]);

// An aspect's tag by its JMRI name. A CATS aspect tags itself; any other
// starts as stop, because an untagged aspect counts as the most restrictive.
function catsAspectTag(name) {
  const key = jmriAspectName(String(name || ""));
  // Own keys only: a custom aspect called "constructor" is not Object's.
  return Object.hasOwn(CATS_ASPECT_TAGS, key) ? CATS_ASPECT_TAGS[key] : "stop";
}

function catsAspectDiverging(name) {
  return CATS_DIVERGING.includes(jmriAspectName(String(name || "")));
}

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

function lockTopic(topic) {
  const base = String(topic || "").replace(/\/+$/, "");
  if (!base) return "";
  return `${base}/Lock`;
}

// A JMRI sensor beside the turnout: trains/track/turnout/X -> trains/track/sensor/X/<leaf>.
// A topic without track/turnout/ (JMRI cannot reach it anyway) gets <topic>/<leaf>.
function turnoutSensorTopic(topic, leaf) {
  const base = String(topic || "").replace(/\/+$/, "");
  if (!base) return "";
  const typeTopic = "track/turnout/";
  const at = base.indexOf(typeTopic);
  if (at < 0) return `${base}/${leaf}`;
  return `${base.slice(0, at)}track/sensor/${base.slice(at + typeTopic.length)}/${leaf}`;
}

// Position report: ACTIVE when thrown, INACTIVE when closed. JMRI uses it as the
// turnout's ONESENSOR feedback, so the panel shows where the point really is.
function thrownTopic(topic) {
  return turnoutSensorTopic(topic, "Thrown");
}

// Lock report, so CATS can use it as the Turnout Locked Report.
function lockedTopic(topic) {
  return turnoutSensorTopic(topic, "Locked");
}

function lockActive(point, mqtt) {
  return mqtt && point.lockEnabled === true;
}

// A rule locks this point (Field Logic): it has a field-lock global.
function fieldLocked(config, point) {
  return logicHooks(config).lockedTurnoutNames(config)?.has(point.name) === true;
}

// The point's lock flags as C++ reads: the remote lock (its Lock topic) and
// the field lock (a rule). The point is locked while either is set.
function lockFlags(config, point, mqtt) {
  const flags = [];
  if (lockActive(point, mqtt)) flags.push(`id(${point.id}_locked)`);
  if (fieldLocked(config, point)) flags.push(`id(${point.id}_field_locked)`);
  return flags;
}

function lockedExpr(flags) {
  return flags.length === 1 ? flags[0] : `(${flags.join(" || ")})`;
}

// The lock report: Remote lock, or a rule that locks the point.
function hasLockReport(config, point) {
  return point.lockEnabled === true || fieldLocked(config, point);
}

function variantFor(moduleName) {
  return MODULE_VARIANTS[moduleName] || "esp32";
}

const DEFAULT_MQTT_BROKER = "layout-mqtt.local";

function boardDefaults() {
  return {
    name: "my-first-board",
    module: "nodemcu-32s",
    wifiSsid: "",
    wifiPassword: "",
    mqttBroker: DEFAULT_MQTT_BROKER,
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
    pcaBoards: [{ sda: "GPIO21", scl: "GPIO22" }],
    signals: signalDefaults(),
  };
}

function emptyConfig() {
  return {
    board: boardDefaults(),
    blocks: [],
    points: [],
    pcaBoards: [{ sda: "GPIO21", scl: "GPIO22" }],
    signals: signalDefaults(),
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
  if (board.nameSuffix !== undefined && !isNameSuffix(board.nameSuffix)) delete board.nameSuffix;
  if (board.nameSuffix) setTypedBoardName(board, typedBoardName(board));
  if (typeof board.mqttEnabled !== "boolean") board.mqttEnabled = true;
  if (typeof config.pca9685 !== "boolean") config.pca9685 = true;
  config.pcaBoards = pcaBoardsOf(config).map((pcaBoard) => ({
    sda: String(pcaBoard?.sda || "GPIO21").toUpperCase(),
    scl: String(pcaBoard?.scl || "GPIO22").toUpperCase(),
  }));
  delete config.i2c;
  if (!Array.isArray(config.expanders)) config.expanders = [];
  config.expanders.forEach((expander, i) => {
    // Sensors follow the name as it is tidied, so a half-typed rename (empty,
    // or ending in a space) does not take them off the expander.
    const raw = expander.name;
    expander.name = String(raw || "").trim() || `MCP ${i + 1}`;
    if (raw !== expander.name) {
      for (const block of config.blocks || []) {
        if (block.expander !== undefined && block.expander === raw) block.expander = expander.name;
      }
    }
    const address = String(expander.address || "0x20").trim().toLowerCase();
    expander.address = /^0x[0-9a-f]{1,2}$/.test(address) ? `0x${address.slice(2).padStart(2, "0")}` : address;
    const bus = Number(expander.bus);
    if (Number.isInteger(bus) && bus >= 1) {
      expander.bus = bus;
      delete expander.sda;
      delete expander.scl;
    } else {
      delete expander.bus;
      expander.sda = String(expander.sda || "GPIO21").toUpperCase();
      expander.scl = String(expander.scl || "GPIO22").toUpperCase();
    }
  });
  for (const block of config.blocks || []) {
    if (block.expander) {
      block.expander = String(block.expander);
      // A pin that is not 0-15 is left out, so validation asks for one.
      const pin = typeof block.pin === "string" && block.pin.trim() === "" ? NaN : Number(block.pin ?? NaN);
      if (Number.isInteger(pin) && pin >= 0 && pin <= 15) block.pin = pin;
      else delete block.pin;
      delete block.gpio;
    } else {
      delete block.expander;
      delete block.pin;
    }
    if (block.gpio) block.gpio = String(block.gpio).toUpperCase();
  }
  for (const point of config.points || []) {
    if (point.servoPin) point.servoPin = String(point.servoPin).toUpperCase();
    point.pcaBoard = pcaBoardIndex(point, config.pcaBoards.length);
    point.lockEnabled = point.lockEnabled === true;
    point.lockDefault = point.lockDefault === "locked" ? "locked" : "unlocked";
    if (!Array.isArray(point.controls)) point.controls = [];
    for (const control of point.controls) {
      control.action = controlAction(control.action);
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
  normalizeLogic(config);
  return config;
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

// Board name suffix: six random characters that are the board's identity, so
// two boards both called module-1 at a meet do not clash. Lowercase letters and
// digits without look-alikes (no 0, o, 1 or l), so it reads off a module card.
// It is stored as board.nameSuffix and kept on rename; the rest is a label.
const NAME_SUFFIX_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const NAME_SUFFIX_LENGTH = 6;
// The fallback hotspot, "<board> setup", must fit Wi-Fi's 32 characters, so
// the name is at most 26. The dash and suffix take 7 of those.
const MAX_TYPED_NAME = 32 - " setup".length - (NAME_SUFFIX_LENGTH + 1);

function isNameSuffix(value) {
  return typeof value === "string" && value.length === NAME_SUFFIX_LENGTH
    && [...value].every((ch) => NAME_SUFFIX_ALPHABET.includes(ch));
}

function generateNameSuffix() {
  if (NAME_SUFFIX_ALPHABET.length !== 32) throw new Error("name suffix alphabet must be 32 characters");
  return [...randomBytes(NAME_SUFFIX_LENGTH)].map((byte) => NAME_SUFFIX_ALPHABET[byte & 31]).join("");
}

/** The part of the board name you type, without the suffix. */
function typedBoardName(board) {
  const name = String(board?.name || "");
  const suffix = board?.nameSuffix;
  if (!suffix) return name;
  if (name === suffix) return "";
  return name.endsWith(`-${suffix}`) ? name.slice(0, -(suffix.length + 1)) : name;
}

/** Rename the board, keeping its suffix. */
function setTypedBoardName(board, typed) {
  const text = String(typed ?? "").trim();
  board.name = board.nameSuffix ? (text ? `${text}-${board.nameSuffix}` : board.nameSuffix) : text;
  return board;
}

/** Add a suffix to a board that has none. Never adds a second one. */
function addNameSuffix(board) {
  if (board.nameSuffix) return board;
  const typed = typedBoardName(board);
  board.nameSuffix = generateNameSuffix();
  return setTypedBoardName(board, typed);
}

/** A new identity for a copied board: same typed name, new suffix. */
function newNameSuffix(board) {
  const typed = typedBoardName(board);
  let suffix = generateNameSuffix();
  while (suffix === board.nameSuffix) suffix = generateNameSuffix();
  board.nameSuffix = suffix;
  return setTypedBoardName(board, typed);
}

/** A new board: the starter preset, with a suffix. */
function newBoardConfig() {
  const config = myFirstBoardPreset();
  addNameSuffix(config.board);
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

function outputPinProblem(pin, role, drives = "a servo") {
  const name = String(pin || "").toUpperCase();
  if (!name) return `${role} pin is missing`;
  if (NO_PULLUP_PINS[name]) {
    return `${role} pin ${name} (${NO_PULLUP_PINS[name]}) is input only and cannot drive ${drives}`;
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

// errors and warnings are plain sentences. links maps a sentence to where it
// is fixed: { view } is a page ("board", "blocks", "points", "signals",
// "logic"), and { part } an element id on it (the Logic page's parts:
// logic-mode, logic-settings, logic-linked, logic-blocks, logic-masts,
// logic-buttons, logic-sections, logic-groups).
function validateConfig(config) {
  const warnings = [];
  const errors = [];
  const links = new Map();
  // Links each message added to `list` since `from` to `where`.
  const linkSince = (list, from, where) => list.slice(from).forEach((text) => links.has(text) || links.set(text, where));
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
  if (board.mqttEnabled !== false && !board.mqttBroker) warnings.push("MQTT address is empty — layout-mqtt.local is the name from the install script.");
  if (String(board.apPassword || "").length > 0 && String(board.apPassword).length < 8) {
    errors.push("Hotspot password must be at least 8 characters.");
  }
  const boardErrors = errors.length;
  const boardWarnings = warnings.length;
  if (board.nameSuffix) {
    const typed = typedBoardName(board);
    if (!typed) {
      errors.push(`Board name is empty. Type a name before -${board.nameSuffix}.`);
    } else if (typed.length > MAX_TYPED_NAME) {
      errors.push(`Board name is ${typed.length} characters before -${board.nameSuffix}. Keep it to ${MAX_TYPED_NAME}, so the hotspot name "<board> setup" fits in Wi-Fi's 32.`);
    }
  } else if (board.name && `${board.name} setup`.length > 32) {
    warnings.push("Hotspot name is longer than 32 characters. Shorten the board name.");
  }
  if (!board.nameSuffix && (config.logic?.mode || config.logic?.share === true)) {
    warnings.push("Board name has no suffix. Boards that share or run logic need a unique name: click Add a suffix on the Board page. The name changes, so flash the board next by USB.");
  }
  linkSince(errors, boardErrors, { view: "board" });
  linkSince(warnings, boardWarnings, { view: "board" });

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

  const expanders = config.expanders || [];
  const expanderPins = new Map();
  for (const block of config.blocks || []) {
    if (block.expander) {
      const expander = expanders.find((e) => e.name === block.expander);
      const pin = Number(block.pin);
      if (!expander) {
        errors.push(`Sensor "${block.name}" is on expander "${block.expander}", which is not on the Sensors page. Pick another pin.`);
      } else if (!Number.isInteger(pin) || pin < 0 || pin > 15) {
        errors.push(`Sensor "${block.name}" needs an expander pin from A0 to B7.`);
      } else {
        const key = `${expander.name}\u0000${pin}`;
        if (expanderPins.has(key)) {
          errors.push(`${expander.name} pin ${expanderPinLabel(pin)} is used by "${expanderPins.get(key)}" and "${block.name}". Each expander pin takes one sensor.`);
        } else {
          expanderPins.set(key, block.name);
        }
      }
      continue;
    }
    const pin = String(block.gpio || "").toUpperCase();
    const issue = detectorPinProblem(pin);
    if (issue) {
      errors.push(`Sensor "${block.name}" ${issue}.`);
      continue;
    }
    notePin(pin, block.name);
  }

  const expanderErrors = errors.length;
  if (expanders.length) {
    const names = new Set();
    const pcaBoards = pcaBoardsOf(config);
    expanders.forEach((expander) => {
      if (names.has(expander.name)) errors.push(`Two expanders are called "${expander.name}". Give each its own name.`);
      names.add(expander.name);
      if (!MCP_ADDRESSES.includes(expander.address)) {
        errors.push(`${expander.name} address ${expander.address} is not 0x20 to 0x27. The A0-A2 links on the expander set it.`);
      }
      if (expander.bus && expander.bus > pcaBoards.length) {
        errors.push(`${expander.name} shares PCA9685 ${expander.bus}'s I2C pins, but there is no PCA9685 ${expander.bus} on the Turnouts page. Give the expander its own SDA and SCL pins.`);
      }
    });
    const buses = i2cBuses(config);
    const limit = i2cBusLimit(board.module);
    if (buses.length > limit) {
      errors.push(`An ESP32 has ${limit} I2C buses, and this board needs ${buses.length}. Put an expander on a PCA9685 board's SDA and SCL pins, or give expanders the same pins.`);
    }
    const busPins = new Map();
    buses.forEach((bus, b) => {
      const who = bus.pca !== null ? `PCA9685 ${bus.pca + 1}` : expanders[bus.expanders[0]].name;
      if (bus.expanders.length > MAX_EXPANDERS_PER_BUS) {
        errors.push(`${bus.expanders.length} expanders share the I2C bus on ${bus.sda} and ${bus.scl}. One bus takes ${MAX_EXPANDERS_PER_BUS} at most.`);
      }
      const seen = new Map();
      for (const i of bus.expanders) {
        const expander = expanders[i];
        if (seen.has(expander.address)) {
          errors.push(`${seen.get(expander.address)} and ${expander.name} are both at ${expander.address} on the same I2C bus. Set different A0-A2 links on one of them.`);
        } else {
          seen.set(expander.address, expander.name);
        }
      }
      for (const [role, pin] of [["SDA", bus.sda], ["SCL", bus.scl]]) {
        const other = busPins.get(pin);
        // Two PCA9685 boards on one pin is the turnouts' GPIO clash warning.
        if (other && (other.pca === null || bus.pca === null)) {
          errors.push(`${pin} is on two I2C buses (${other.who} and ${who}). An expander that shares a bus must use both of its pins.`);
        } else if (!other) {
          busPins.set(pin, { who, pca: bus.pca });
        }
        // PCA9685 pins are checked with the turnouts.
        if (bus.pca !== null) continue;
        const issue = outputPinProblem(pin, `${who} ${role}`, "I2C");
        if (issue) errors.push(`${issue}.`);
        else notePin(pin, `${who} I2C`);
      }
    });
  }

  linkSince(errors, expanderErrors, { view: "blocks", part: "expanders-card" });

  if ((config.points || []).length) {
    const usePca = config.pca9685 !== false;
    const pcaBoards = pcaBoardsOf(config);
    const pcaLabel = (i) => (pcaBoards.length > 1 ? `PCA9685 ${i + 1}` : "PCA9685");
    if (usePca) {
      if (pcaBoards.length > MAX_PCA_BOARDS) {
        errors.push(`An ESP32 has ${MAX_PCA_BOARDS} I2C buses, so ${MAX_PCA_BOARDS} PCA9685 boards at most. This file has ${pcaBoards.length}.`);
      }
      pcaBoards.forEach((pcaBoard, i) => {
        for (const [role, pin] of [["SDA", pcaBoard.sda], ["SCL", pcaBoard.scl]]) {
          const issue = outputPinProblem(pin, `${pcaLabel(i)} ${role}`, "I2C");
          if (issue) errors.push(`${issue}.`);
          else notePin(pin, `${pcaLabel(i)} I2C`);
        }
      });
    } else if (config.points.length > 4) {
      warnings.push("More than 4 servos take power from the ESP. A PCA9685 with an external 5V supply is how this scales up.");
    }
    const channels = pcaBoards.map(() => new Map());
    for (const point of config.points) {
      if (usePca) {
        const ch = Number(point.channel);
        const b = pcaBoardIndex(point, pcaBoards.length);
        if (Number.isNaN(ch) || ch < 0 || ch > 15) {
          errors.push(`Turnout "${point.name}" channel must be 0–15.`);
        } else if (channels[b].has(ch)) {
          warnings.push(`${pcaLabel(b)} channel clash: ${ch} used by "${channels[b].get(ch)}" and "${point.name}".`);
        } else {
          channels[b].set(ch, point.name);
        }
      } else {
        const servoPin = String(point.servoPin || "").toUpperCase();
        const servoIssue = outputPinProblem(servoPin, "servo");
        if (servoIssue) errors.push(`Turnout "${point.name}" ${servoIssue}.`);
        else notePin(servoPin, `${point.name} servo`);
      }
      const latched = (point.controls || []).filter((control) => LATCH_ACTIONS.has(control.action));
      if (latched.length > 1) {
        errors.push(`Turnout "${point.name}" has ${latched.length} latched switches. Use one, or the switches fight over the turnout.`);
      }
      for (const control of point.controls || []) {
        const button = String(control.buttonPin || "").toUpperCase();
        const closedLight = String(control.closedLight || "").toUpperCase();
        const openLight = String(control.openLight || "").toUpperCase();
        const buttonIssue = pinProblem(button, "button");
        if (buttonIssue) errors.push(`Turnout "${point.name}" ${buttonIssue}.`);
        for (const [role, light] of [["closed", closedLight], ["open", openLight]]) {
          if (!light) continue;
          const lightIssue = pinProblem(light, `${role} light`);
          if (lightIssue) errors.push(`Turnout "${point.name}" ${lightIssue}.`);
          if (button && light === button) {
            errors.push(`Turnout "${point.name}" uses ${button} for both the button and a light.`);
          }
        }
        if (closedLight && openLight && closedLight === openLight) {
          errors.push(`Turnout "${point.name}" uses ${closedLight} for both the closed and open lights.`);
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
      // A mast that Field Logic sets runs without MQTT; one JMRI sets cannot.
      const field = logicHooks(config).fieldMastNames(config);
      if (!field?.size) errors.push("Signal masts need MQTT. Turn it back on under Board.");
      else {
        for (const mast of masts) {
          if (!field.has(mast.name)) errors.push(`Signal mast "${mast.name}" needs MQTT: JMRI sets it. Turn MQTT back on under Board, or set the mast from a rule.`);
        }
      }
    }
    for (const mast of masts) {
      const seen = new Map();
      for (const aspect of mast.aspects || []) {
        const states = (aspect.states || []).map((state) => String(state).trim()).filter(Boolean);
        if (!states.length) {
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

  if (board.mqttEnabled !== false) {
    for (const point of config.points || []) {
      const reports = [[thrownTopic(point.topic), "position"]];
      if (hasLockReport(config, point)) reports.push([lockedTopic(point.topic), "lock"]);
      for (const [report, what] of reports) {
        for (const block of config.blocks || []) {
          if (report && block.topic === report) {
            errors.push(`Sensor "${block.name}" uses ${report}, where turnout "${point.name}" reports its ${what}. Rename the sensor.`);
          }
        }
      }
    }
  }

  // Rule buttons and plant ends' Pair and LED pins (Logic page): a pin of
  // their own, like every other pin. An item is { name, kind?, label?, owner?,
  // where, pin } or, on an expander, { ..., expander, pin }.
  for (const button of logicHooks(config).buttonPins(config) || []) {
    let text = "";
    const who = button.label || `Button "${button.name}"`;
    const owner = button.owner || `button ${button.name}`;
    const asWord = button.word || (button.kind === "led" ? "LED" : button.label ? "Pair button" : "button");
    if (button.expander !== undefined) {
      // On an expander: checked like a sensor on one, sharing its pins.
      const expander = expanders.find((e) => e.name === button.expander);
      const pin = Number(button.pin);
      const key = expander ? `${expander.name}\u0000${pin}` : "";
      if (!expander) text = `${who} is on expander "${button.expander}", which is not on the Sensors page. Pick another pin for the ${asWord}.`;
      else if (!Number.isInteger(pin) || pin < 0 || pin > 15) text = `${who} needs an expander pin from A0 to B7.`;
      else if (expanderPins.has(key)) text = `${expander.name} pin ${expanderPinLabel(pin)} is used by "${expanderPins.get(key)}" and ${button.label ? who : `button "${button.name}"`}. A pin can do one job: pick another pin for the ${asWord}.`;
      else expanderPins.set(key, owner);
      if (text) {
        errors.push(text);
        links.set(text, button.where);
      }
      continue;
    }
    if (button.kind === "led") {
      // An LED is driven, so the pin must be able to output.
      const issue = signalPinProblem(button.pin, "LED pin");
      if (issue) text = `${who}: ${issue}.`;
      else if (pins.has(button.pin)) text = `${who} is on ${button.pin}, which "${pins.get(button.pin)}" already uses. A pin can do one job: pick another pin for the LED.`;
      else pins.set(button.pin, owner);
    } else {
      // Wired to GND like a turnout's button, so it needs the pin's pull-up.
      const issue = pinProblem(button.pin, button.label ? "its" : "button");
      if (issue) text = button.label ? `${who}: ${issue}.` : `Button "${button.name}" ${issue}.`;
      else if (pins.has(button.pin)) text = `${who} is on ${button.pin}, which "${pins.get(button.pin)}" already uses. A pin can do one job: pick another pin for the ${asWord}.`;
      else pins.set(button.pin, owner);
    }
    if (text) {
      errors.push(text);
      links.set(text, button.where);
    }
  }

  logicHooks(config).validate(config, errors, warnings, links);

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

  return { warnings, errors, links };
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

// JMRI builds an MQTT topic as [MQTT Channel] + [type topic] + [hardware
// address], and the system name is the connection prefix "M", a type letter,
// and that address. So the address is whatever follows the type topic.
const JMRI_TABLES = Object.freeze({
  sensor: { typeTopic: "track/sensor/", table: "Sensor Table" },
  turnout: { typeTopic: "track/turnout/", table: "Turnout Table" },
  signalmast: { typeTopic: "track/signalmast/", table: "Signal Mast Table" },
  light: { typeTopic: "track/light/", table: "Light Table" },
});

// XML comments cannot contain "--".
function xmlComment(value) {
  return String(value).replace(/-(?=-)/g, "- ");
}

function xmlText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Split a topic into JMRI's channel and hardware address, or null if the topic
// does not have the type topic in it (a custom topic JMRI cannot reach).
function jmriAddress(topic, kind) {
  const text = String(topic || "");
  const typeTopic = JMRI_TABLES[kind].typeTopic;
  const at = text.indexOf(typeTopic);
  if (at < 0) return null;
  const address = text.slice(at + typeTopic.length);
  if (!address.trim()) return null;
  return { channel: text.slice(0, at), address };
}

/**
 * JMRI table XML for this board: its sensors, turnouts, and signal masts as
 * MQTT items. Load it in PanelPro with File > Load table content and panels.
 * Masts use the CATS signal template the configurator ships
 * (resources/signals/cats-masts, appearance cats-virtual).
 * `include` picks the tables: { sensors, turnouts, masts }, each on unless false.
 * A turnout brings its own feedback and lock sensors, so CATS can take masts only.
 */
function generateJmriXml(config, include = {}) {
  const sensors = [];
  const turnouts = [];
  const masts = [];
  const lights = [];
  const skipped = [];
  const channels = new Set();
  const mqtt = config.board?.mqttEnabled !== false;

  if (mqtt && include.sensors !== false) {
    for (const block of config.blocks || []) {
      const found = jmriAddress(block.topic, "sensor");
      if (!found) skipped.push(`Sensor "${block.name}": topic has no ${JMRI_TABLES.sensor.typeTopic}`);
      else {
        channels.add(found.channel);
        sensors.push(found.address);
      }
    }
  }
  if (mqtt && include.turnouts !== false) {
    for (const point of config.points || []) {
      const found = jmriAddress(point.topic, "turnout");
      if (!found) skipped.push(`Turnout "${point.name}": topic has no ${JMRI_TABLES.turnout.typeTopic}`);
      else {
        channels.add(found.channel);
        const feedback = jmriAddress(thrownTopic(point.topic), "sensor").address;
        sensors.push(feedback);
        turnouts.push({ address: found.address, feedback });
        // The lock report, for CATS's Turnout Locked Report.
        if (hasLockReport(config, point)) sensors.push(jmriAddress(lockedTopic(point.topic), "sensor").address);
      }
    }
  }
  if (mqtt && include.logic !== false) {
    for (const item of logicHooks(config).jmriSensors(config) || []) {
      const found = jmriAddress(item.topic, "sensor");
      if (!found) skipped.push(`${item.label}: topic has no ${JMRI_TABLES.sensor.typeTopic}`);
      else {
        channels.add(found.channel);
        sensors.push(found.address);
      }
    }
    // The logic switch's light, and each section's Release turnout. Release
    // has no /Thrown sensor: DIRECT feedback takes the board's CLOSED on its
    // own topic, so it snaps back like a push button.
    for (const item of logicHooks(config).jmriTurnouts(config) || []) {
      const found = jmriAddress(item.topic, "turnout");
      if (!found) skipped.push(`${item.label}: topic has no ${JMRI_TABLES.turnout.typeTopic}`);
      else {
        channels.add(found.channel);
        turnouts.push({ address: found.address });
      }
    }
    for (const item of logicHooks(config).jmriLights(config) || []) {
      const found = jmriAddress(item.topic, "light");
      if (!found) skipped.push(`${item.label}: topic has no ${JMRI_TABLES.light.typeTopic}`);
      else {
        channels.add(found.channel);
        lights.push(found.address);
      }
    }
  }
  if (mqtt && include.masts !== false) {
    for (const mast of config.signals?.masts || []) {
      const found = jmriAddress(mast.topic, "signalmast");
      if (!found) {
        skipped.push(`Signal mast "${mast.name}": topic has no ${JMRI_TABLES.signalmast.typeTopic}`);
      } else if (/[():]/.test(found.address)) {
        // JMRI reads the mast's topic from between the brackets of its system
        // name, and splits the name on colons.
        skipped.push(`Signal mast "${mast.name}": JMRI cannot use ( ) or : in a mast address`);
      } else {
        channels.add(found.channel);
        masts.push({ address: found.address, name: mast.name });
      }
    }
  }

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<layout-config xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://jmri.org/xml/schema/layout-4-19-2.xsd">');
  lines.push(`  <!-- ${xmlComment(config.board?.name || "board")}: MQTT items from the ESPHome for Model Railroading Board Configurator. -->`);
  lines.push("  <!-- In PanelPro: File > Load table content and panels, then File > Store table content and panels to keep them. -->");
  if (channels.size) {
    const list = [...channels].map((channel) => (channel ? `"${channel}"` : "blank")).join(" or ");
    lines.push(`  <!-- These topics expect the JMRI MQTT Channel to be ${xmlComment(list)}. -->`);
  }
  if (sensors.length) {
    lines.push('  <sensors class="jmri.jmrix.mqtt.configurexml.MqttSensorManagerXml">');
    for (const address of sensors) {
      lines.push('    <sensor inverted="false">');
      lines.push(`      <systemName>MS${xmlText(address)}</systemName>`);
      lines.push("    </sensor>");
    }
    lines.push("  </sensors>");
  }
  if (turnouts.length) {
    lines.push('  <turnouts class="jmri.jmrix.mqtt.configurexml.MqttTurnoutManagerXml">');
    for (const turnout of turnouts) {
      // ONESENSOR: the board's /Thrown sensor is ACTIVE when thrown, INACTIVE when closed.
      if (turnout.feedback) lines.push(`    <turnout feedback="ONESENSOR" sensor1="MS${xmlText(turnout.feedback)}" inverted="false" automate="Default">`);
      else lines.push('    <turnout feedback="DIRECT" inverted="false" automate="Default">');
      lines.push(`      <systemName>MT${xmlText(turnout.address)}</systemName>`);
      lines.push("    </turnout>");
    }
    lines.push("  </turnouts>");
  }
  if (lights.length) {
    lines.push('  <lights class="jmri.jmrix.mqtt.configurexml.MqttLightManagerXml">');
    for (const address of lights) {
      lines.push("    <light>");
      lines.push(`      <systemName>ML${xmlText(address)}</systemName>`);
      lines.push("    </light>");
    }
    lines.push("  </lights>");
  }
  if (masts.length) {
    lines.push("  <!-- Signal masts need the CATS signal template in the JMRI profile (resources/signals/cats-masts). -->");
    lines.push('  <signalmasts class="jmri.managers.configurexml.DefaultSignalMastManagerXml">');
    for (const mast of masts) {
      lines.push('    <mqttsignalmast class="jmri.jmrix.mqtt.configurexml.MqttSignalMastXml">');
      lines.push(`      <systemName>IF$mqm:cats-masts:cats-virtual(${xmlText(mast.address)})</systemName>`);
      if (String(mast.name || "").trim()) lines.push(`      <userName>${xmlText(String(mast.name).trim())}</userName>`);
      lines.push('      <unlit allowed="no" />');
      lines.push("    </mqttsignalmast>");
    }
    lines.push("  </signalmasts>");
  }
  lines.push("</layout-config>");
  return {
    xml: `${lines.join("\n")}\n`,
    counts: { sensors: sensors.length, turnouts: turnouts.length, masts: masts.length, lights: lights.length },
    skipped,
  };
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

const LATCH_ACTIONS = new Set(["latch-thrown", "latch-closed"]);

function controlAction(action) {
  if (action === "closed" || action === "thrown" || LATCH_ACTIONS.has(action)) return action;
  return "toggle";
}

function latchIndex(point) {
  return (point.controls || []).findIndex((control) => LATCH_ACTIONS.has(control.action) && control.buttonPin);
}

function controlForBlob(control) {
  return {
    action: controlAction(control.action),
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

function emitThrowScript(lines, point, thrown, publish, config) {
  const which = thrown ? "thrown" : "closed";
  const position = thrown ? "reverse" : "normal";
  const label = thrown ? "THROWN (reverse)" : "CLOSED (normal)";
  // The position report is a JMRI sensor: ACTIVE when thrown, INACTIVE when closed.
  const payload = thrown ? "ACTIVE" : "INACTIVE";
  lines.push(`  - id: ${point.id}_throw_${which}`);
  lines.push("    mode: restart");
  lines.push("    parameters:");
  lines.push("      announce: bool");
  lines.push("    then:");
  // Assignment only marks the global dirty. Flash is flushed about once a minute,
  // so a layout power cut was forgetting the position. Save it before the servo moves.
  lines.push("      - lambda: |-");
  lines.push(`          id(${point.id}_thrown) = ${thrown ? "true" : "false"};`);
  lines.push(`          ${point.id}_thrown->update();`);
  lines.push("          global_preferences->sync();");
  lines.push("      - logger.log:");
  lines.push(`          format: ${yamlQuote(`${point.name} -> ${label}`)}`);
  lines.push("          level: INFO");
  lines.push("          tag: point_control");
  emitPairedThrow(lines, config, point, thrown, publish);
  if (publish) logicHooks(config).emitThrowStart(lines, config, point);
  emitLights(lines, "      ", point, thrown);
  lines.push("      - servo.write:");
  lines.push(`          id: ${point.id}_servo`);
  lines.push(`          level: !lambda 'return id(${point.id}_servo_endpoint_${position}).state / 100.0;'`);
  lines.push("      - delay: 2s");
  lines.push("      - servo.write:");
  lines.push(`          id: ${point.id}_servo`);
  lines.push(`          level: !lambda 'return id(${point.id}_servo_endpoint_${position}_backoff).state / 100.0;'`);
  if (!publish) return;
  lines.push("      - if:");
  lines.push("          condition:");
  lines.push("            lambda: 'return announce;'");
  lines.push("          then:");
  lines.push("            - mqtt.publish:");
  lines.push(`                topic: ${yamlQuote(thrownTopic(point.topic))}`);
  lines.push(`                payload: "${payload}"`);
  lines.push("                retain: true");
  lines.push("                qos: 2");
  logicHooks(config).emitThrowEnd(lines, config, point, thrown);
}

// A crossover's two turnouts move together (Field Logic's track plan): a
// command or button for one moves the other too, unless that one is locked or
// already moving. Not at boot (announce is false), where each goes back to its
// own saved position. The other's own throw finds this one already set.
function emitPairedThrow(lines, config, point, thrown, mqtt) {
  const pair = logicHooks(config).pairedTurnout(config, point.name);
  const other = pair && uniqueIds(config.points || []).find((p) => p.name === pair.name && p.name !== point.name);
  if (!other) return;
  const otherThrown = pair.same ? thrown : !thrown;
  const flags = lockFlags(config, other, mqtt);
  const unlocked = flags.length ? ` && !${lockedExpr(flags)}` : "";
  lines.push(`      # A crossover: ${other.id} moves with it.`);
  lines.push("      - if:");
  lines.push("          condition:");
  lines.push(`            lambda: 'return announce && id(${other.id}_thrown) != ${otherThrown} && !id(${other.id}_throw_closed).is_running() && !id(${other.id}_throw_thrown).is_running()${unlocked};'`);
  lines.push("          then:");
  lines.push("            - script.execute:");
  lines.push(`                id: ${other.id}_throw_${otherThrown ? "thrown" : "closed"}`);
  lines.push("                announce: true");
}

function emitButtonAllowed(lines, point, flags) {
  lines.push("        - if:");
  lines.push("            condition:");
  if (flags.length) {
    lines.push("              and:");
    lines.push(`                - lambda: 'return !${lockedExpr(flags)};'`);
    lines.push("                - not:");
    lines.push("                    or:");
    lines.push("                      - script.is_running:");
    lines.push(`                          id: ${point.id}_throw_closed`);
    lines.push("                      - script.is_running:");
    lines.push(`                          id: ${point.id}_throw_thrown`);
  } else {
    lines.push("              not:");
    lines.push("                or:");
    lines.push("                  - script.is_running:");
    lines.push(`                      id: ${point.id}_throw_closed`);
    lines.push("                  - script.is_running:");
    lines.push(`                      id: ${point.id}_throw_thrown`);
  }
  lines.push("            then:");
}

function emitButton(lines, point, control, index, flags) {
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
  if (LATCH_ACTIONS.has(control.action)) {
    // A latched switch is not ignored while the servo moves. Its script waits
    // for the throw to finish, then makes the point match the switch.
    lines.push("    on_state:");
    lines.push("      then:");
    lines.push("        - script.execute:");
    lines.push(`            id: ${point.id}_latch_${index + 1}`);
    lines.push("            force: false");
    return;
  }
  lines.push("    on_press:");
  lines.push("      then:");
  // A second press during the 2s wait starts the other throw while the first
  // backoff write is still pending, and that write leaves the servo short of
  // the end it was sent to. Ignore every button on this point until both
  // throw scripts have finished. A lock (remote or a rule's) holds them too.
  emitButtonAllowed(lines, point, flags);
  if (control.action === "closed" || control.action === "thrown") {
    lines.push("              - script.execute:");
    lines.push(`                  id: ${point.id}_throw_${control.action}`);
    lines.push("                  announce: true");
    return;
  }
  lines.push("              - if:");
  lines.push("                  condition:");
  lines.push(`                    lambda: 'return id(${point.id}_thrown);'`);
  lines.push("                  then:");
  lines.push("                    - script.execute:");
  lines.push(`                        id: ${point.id}_throw_closed`);
  lines.push("                        announce: true");
  lines.push("                  else:");
  lines.push("                    - script.execute:");
  lines.push(`                        id: ${point.id}_throw_thrown`);
  lines.push("                        announce: true");
}

// The point follows a latched switch. Queued, so a flip while the servo is
// moving waits its turn instead of starting the other throw early (the late
// backoff write would leave the servo short). Each run reads the switch when it
// starts, so the point ends up wherever the switch was left. force is the boot
// call: it moves the servo even when the switch matches the saved position.
function emitLatchScript(lines, point, index, flags) {
  const control = point.controls[index];
  const button = `${point.id}_button_${index + 1}`;
  const onIsThrown = control.action === "latch-thrown";
  lines.push(`  - id: ${point.id}_latch_${index + 1}`);
  lines.push("    mode: queued");
  lines.push("    parameters:");
  lines.push("      force: bool");
  lines.push("    then:");
  lines.push("      - wait_until:");
  lines.push("          condition:");
  lines.push(`            lambda: 'return id(${button}).has_state() && !id(${point.id}_throw_closed).is_running() && !id(${point.id}_throw_thrown).is_running();'`);
  lines.push("      - lambda: |-");
  lines.push(`          bool want = ${onIsThrown ? "" : "!"}id(${button}).state;`);
  if (flags.length) {
    const remoteOnly = flags.length === 1 && flags[0] === `id(${point.id}_locked)`;
    lines.push(`          // ${remoteOnly ? "A remote lock" : "A lock (remote or a rule's)"} holds the point where it is.`);
    lines.push(`          if (${flags.join(" || ")}) want = id(${point.id}_thrown);`);
  }
  lines.push(`          bool moving = want != id(${point.id}_thrown);`);
  lines.push("          if (!moving && !force) return;");
  lines.push(`          if (want) id(${point.id}_throw_thrown).execute(moving);`);
  lines.push(`          else id(${point.id}_throw_closed).execute(moving);`);
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

// The aspect global holds an aspect index, -1 for nothing yet, or DARK_ASPECT.
const DARK_ASPECT = -2;

// Aspect names a held mast shows: CATS's Stop, then the usual JMRI name.
const HELD_ASPECT_NAMES = ["R292", "Stop"];

// JMRI publishes "<aspect>; Lit|Unlit; Held|Unheld". The name is before the first ";".
function jmriAspectName(state) {
  return String(state).split(";")[0].trim();
}

function cppString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function emitShowScript(lines, mast, config) {
  const gpio = mast.mode === "gpio";
  lines.push(`  - id: ${mast.id}_show`);
  lines.push("    mode: restart");
  lines.push("    parameters:");
  lines.push("      restart_effects: bool");
  lines.push("    then:");
  logicHooks(config).emitMastState(lines, config, mast);
  // Every lamp off: an Unlit message, or Held with no Stop aspect to show.
  lines.push("      - if:");
  lines.push("          condition:");
  lines.push(`            lambda: 'return id(${mast.id}_aspect) == ${DARK_ASPECT};'`);
  lines.push("          then:");
  emitAspectActions(lines, mast, {
    label: "Dark",
    lamps: (mast.lamps || []).map(() => ({ color: "off", mode: "steady" })),
  }, gpio);
  (mast.aspects || []).forEach((aspect, index) => {
    const states = (aspect.states || []).map((state) => String(state).trim()).filter(Boolean);
    if (!states.length) return;
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

// Picks the aspect for a JMRI message. A message matching an aspect exactly
// wins, so custom strings still work. Otherwise Unlit (approach lighting) is
// dark, Held shows the Stop aspect (dark if there is none), and anything else
// matches on the aspect name, so "R281; Lit; Held" cannot leave R281 showing.
function emitSignalTextSensors(lines, masts, fieldMasts) {
  for (const mast of masts) {
    const exact = [];
    const byName = new Map();
    (mast.aspects || []).forEach((aspect, index) => {
      for (const state of (aspect.states || []).map((item) => String(item).trim()).filter(Boolean)) {
        exact.push({ state, index });
        const name = jmriAspectName(state);
        if (name && !byName.has(name)) byName.set(name, index);
      }
    });
    const heldName = HELD_ASPECT_NAMES.find((name) => byName.has(name));
    const heldIndex = heldName ? byName.get(heldName) : DARK_ASPECT;

    lines.push("  - platform: mqtt_subscribe");
    lines.push(`    name: ${yamlQuote(entityName(mast.name))}`);
    lines.push(`    id: ${mast.id}`);
    lines.push("    internal: true");
    lines.push(`    topic: ${yamlQuote(mast.topic)}`);
    // No aspect to show yet, so no aspect global or show script to call.
    if (!exact.length || fieldMasts?.has(mast.name)) continue;
    lines.push("    on_value:");
    lines.push("      - lambda: |-");
    const body = [
      '// JMRI sends "<aspect>; Lit or Unlit; Held or Unheld".',
      "std::string name = x.substr(0, x.find(';'));",
      "while (!name.empty() && name.back() == ' ') name.pop_back();",
      'const bool unlit = x.find("; Unlit") != std::string::npos;',
      'const bool held = x.find("; Held") != std::string::npos;',
      "int pick = -1;",
    ];
    let first = true;
    const branch = (condition, value) => {
      body.push(`${first ? "if" : "else if"} (${condition}) pick = ${value};`);
      first = false;
    };
    for (const { state, index } of exact) branch(`x == ${cppString(state)}`, index);
    branch("unlit", DARK_ASPECT);
    branch("held", heldIndex);
    for (const [name, index] of byName) branch(`name == ${cppString(name)}`, index);
    body.push("if (pick == -1) return;");
    body.push(`id(${mast.id}_aspect) = pick;`);
    body.push(`id(${mast.id}_show).execute(true);`);
    for (const row of body) lines.push(`          ${row}`);
  }
}

function emitThrowCommand(lines, point, thrown, flags) {
  const which = thrown ? "thrown" : "closed";
  const payload = thrown ? "THROWN" : "CLOSED";
  lines.push("      - if:");
  lines.push("          condition:");
  if (flags.length) {
    lines.push("            and:");
    lines.push("              - text_sensor.state:");
    lines.push(`                  id: ${point.id}`);
    lines.push(`                  state: '${payload}'`);
    lines.push(`              - lambda: 'return !${lockedExpr(flags)};'`);
  } else {
    lines.push("            text_sensor.state:");
    lines.push(`              id: ${point.id}`);
    lines.push(`              state: '${payload}'`);
  }
  lines.push("          then:");
  lines.push("            - script.execute:");
  lines.push(`                id: ${point.id}_throw_${which}`);
  lines.push("                announce: true");
}

// The lock report follows the combined lock: either flag set is ACTIVE.
function emitLockedPublish(lines, indent, point, flags) {
  lines.push(`${indent}- mqtt.publish:`);
  lines.push(`${indent}    topic: ${yamlQuote(lockedTopic(point.topic))}`);
  lines.push(`${indent}    payload: !lambda |-`);
  lines.push(`${indent}      return ${lockedExpr(flags)} ? "ACTIVE" : "INACTIVE";`);
  lines.push(`${indent}    retain: true`);
  lines.push(`${indent}    qos: 2`);
}

// On a Field Logic board the component runs the re-sync, when the remote and
// field locks together go from locked to unlocked, and a rule-locked point's
// report comes from its lock report sensor, on any change of either flag.
function emitLockSensor(lines, point, config, flags) {
  const componentResyncs = logicHooks(config).hasComponent(config) === true;
  const reportsHere = !fieldLocked(config, point);
  lines.push("  - platform: mqtt_subscribe");
  lines.push(`    name: ${yamlQuote(entityName(`${point.name} lock`))}`);
  lines.push(`    id: ${point.id}_lock`);
  lines.push("    internal: true");
  lines.push(`    topic: ${yamlQuote(lockTopic(point.topic))}`);
  lines.push("    on_value:");
  lines.push("      - if:");
  lines.push("          condition:");
  lines.push("            text_sensor.state:");
  lines.push(`              id: ${point.id}_lock`);
  lines.push("              state: 'LOCKED'");
  lines.push("          then:");
  lines.push(`            - lambda: 'id(${point.id}_locked) = true;'`);
  lines.push("            - logger.log:");
  lines.push(`                format: ${yamlQuote(`${point.name} lock -> LOCKED`)}`);
  lines.push("                level: INFO");
  lines.push("                tag: point_control");
  if (reportsHere) emitLockedPublish(lines, "            ", point, flags);
  lines.push("      - if:");
  lines.push("          condition:");
  lines.push("            text_sensor.state:");
  lines.push(`              id: ${point.id}_lock`);
  lines.push("              state: 'UNLOCKED'");
  lines.push("          then:");
  const latch = componentResyncs ? -1 : latchIndex(point);
  if (latch >= 0) {
    // A toggle switch moved while locked disagrees with the point. Catch up on
    // unlock so the switch never lies. Only on a real unlock, so a repeated or
    // retained UNLOCKED does not undo a JMRI command.
    lines.push("            - lambda: |-");
    lines.push(`                bool was_locked = id(${point.id}_locked);`);
    lines.push(`                id(${point.id}_locked) = false;`);
    lines.push(`                if (was_locked) id(${point.id}_latch_${latch + 1}).execute(false);`);
  } else {
    lines.push(`            - lambda: 'id(${point.id}_locked) = false;'`);
  }
  lines.push("            - logger.log:");
  lines.push(`                format: ${yamlQuote(`${point.name} lock -> UNLOCKED`)}`);
  lines.push("                level: INFO");
  lines.push("                tag: point_control");
  if (reportsHere) emitLockedPublish(lines, "            ", point, flags);
}

function emitPointTextSensors(lines, points, config) {
  for (const point of points) {
    lines.push("  - platform: mqtt_subscribe");
    lines.push(`    name: ${yamlQuote(entityName(`${point.name} last command`))}`);
    lines.push(`    id: ${point.id}`);
    lines.push(`    topic: ${yamlQuote(point.topic)}`);
    lines.push("    on_value:");
    const flags = lockFlags(config, point, true);
    // A command from JMRI or CATS is stopped by the panel lock too; the
    // turnout's own buttons are not (TP 7, only its own buttons move it).
    const panel = logicHooks(config).panelTurnoutNames?.(config)?.has(point.name) ? [`id(${point.id}_panel_locked)`] : [];
    emitThrowCommand(lines, point, true, [...flags, ...panel]);
    emitThrowCommand(lines, point, false, [...flags, ...panel]);
    if (point.lockEnabled === true) emitLockSensor(lines, point, config, flags);
  }
}

function generateYaml(config) {
  ensureSecrets(config);
  const board = config.board;
  const blocks = uniqueIds(config.blocks || []);
  const points = uniqueIds(config.points || []);
  const masts = uniqueIds(config.signals?.masts || []);
  const pcaBoards = pcaBoardsOf(config);
  const usePca = config.pca9685 !== false;
  const mqtt = board.mqttEnabled !== false;
  const stateForBlob = {
    board: {
      name: board.name,
      ...(board.nameSuffix ? { nameSuffix: board.nameSuffix } : {}),
      module: board.module,
      wifiSsid: board.wifiSsid || "",
      wifiPassword: board.wifiPassword || "",
      mqttBroker: board.mqttBroker || "",
      mqttEnabled: board.mqttEnabled !== false,
      apPassword: board.apPassword || "",
      apiKey: board.apiKey || "",
    },
    blocks: (config.blocks || []).map(({ name, topic, topicCustom, gpio, expander, pin, inverted, debounce }) => ({
      name,
      topic,
      topicCustom: !!topicCustom,
      ...(expander ? { expander, pin } : { gpio }),
      inverted: !!inverted,
      debounce,
    })),
    points: (config.points || []).map(({ name, topic, topicCustom, pcaBoard, channel, servoPin, travelTime, lockEnabled, lockDefault, controls }) => ({
      name,
      topic,
      topicCustom: !!topicCustom,
      pcaBoard: pcaBoardIndex({ pcaBoard }, pcaBoards.length),
      channel: Number(channel),
      servoPin: servoPin || "",
      travelTime,
      lockEnabled: lockEnabled === true,
      lockDefault: lockDefault === "locked" ? "locked" : "unlocked",
      controls: (controls || []).map(controlForBlob),
    })),
    pcaBoards: pcaBoards.map(({ sda, scl }) => ({ sda, scl })),
    pca9685: config.pca9685 !== false,
    // Only when there are some, so files without expanders are unchanged.
    ...((config.expanders || []).length ? {
      expanders: config.expanders.map(({ name, bus, sda, scl, address }) => (
        bus ? { name, bus, address } : { name, sda, scl, address })),
    } : {}),
    signals: signalsForBlob(config.signals),
  };
  const logicBlob = logicForBlob(config.logic);
  if (logicBlob) stateForBlob.logic = logicBlob;

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
  // With Field Logic, a mast that rules set boots at its stop aspect while
  // logic is on, so it joins this step even without a startup aspect.
  const startupMasts = masts
    .map((mast) => ({ mast, index: startupAspectIndex(mast) }))
    .filter((item) => item.index >= 0 || logicHooks(config).isBootMast(config, item.mast));
  if (points.length || stripMasts.length || startupMasts.length) {
    if (points.length) {
      lines.push("    - priority: -200.0");
      lines.push("      then:");
      if (points.length > 1) {
        lines.push("        # Each servo waits 0.2-1s so they do not all start together.");
      }
      for (const point of points) {
        if (points.length > 1) {
          lines.push("        - delay: !lambda 'return 200 + (esphome::random_uint32() % 800);'");
        }
        const latch = latchIndex(point);
        if (latch >= 0) {
          // A latched switch wins over the saved position. With logic, not
          // before the start-up scan has locked any turnout under a train.
          logicHooks(config).emitBootWait(lines, "        ", config);
          lines.push("        - script.execute:");
          lines.push(`            id: ${point.id}_latch_${latch + 1}`);
          lines.push("            force: true");
          continue;
        }
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
        if (logicHooks(config).emitBootMast(lines, config, mast, index)) continue;
        lines.push("        - globals.set:");
        lines.push(`            id: ${mast.id}_aspect`);
        lines.push(`            value: '${index}'`);
        lines.push("        - script.execute:");
        lines.push(`            id: ${mast.id}_show`);
        lines.push("            restart_effects: true");
      }
    }
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

  if (mqtt) {
    lines.push("mqtt:");
    lines.push(`  broker: ${yamlQuote(board.mqttBroker)}`);
    lines.push("  id: mqtt_server");
    lines.push("  discovery: false");
    lines.push("  # Empty prefix: ESPHome will not publish or subscribe its own entity topics.");
    lines.push("  topic_prefix: null");
    lines.push("  reboot_timeout: 0s");
    logicHooks(config).emitMqttMessages(lines, config);
    const sharedOnConnect = [];
    logicHooks(config).emitOnConnect(sharedOnConnect, config, { blocks, points, masts });
    if (blocks.length || points.length || sharedOnConnect.length) {
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
        lines.push(`        topic: ${yamlQuote(thrownTopic(point.topic))}`);
        lines.push("        payload: !lambda |-");
        lines.push(`          return id(${point.id}_thrown) ? "ACTIVE" : "INACTIVE";`);
        lines.push("        retain: true");
        lines.push("        qos: 2");
        if (hasLockReport(config, point)) emitLockedPublish(lines, "    ", point, lockFlags(config, point, true));
      }
      lines.push(...sharedOnConnect);
    }
    lines.push("");
  }
  lines.push("button:");
  lines.push("  - platform: restart");
  lines.push("    id: reboot_esp");
  lines.push('    name: "Restart Board"');
  logicHooks(config).emitLogicButtons(lines, config);

  if (points.length || masts.length || logicHooks(config).needsWebServer(config)) {
    lines.push("");
    lines.push("web_server:");
    lines.push("  local: true");
    lines.push("  ota: false");
  }
  const buses = i2cBuses(config);
  if (buses.length === 1) {
    // One bus needs no ids.
    lines.push("");
    lines.push("i2c:");
    lines.push(`  sda: ${buses[0].sda}`);
    lines.push(`  scl: ${buses[0].scl}`);
    lines.push("  scan: true");
    if (buses[0].pca !== null) {
      lines.push("");
      lines.push("pca9685:");
      lines.push("  frequency: 50Hz");
    }
  } else if (buses.length > 1) {
    // Each PCA9685 is on its own pins, so each gets its own I2C bus.
    lines.push("");
    lines.push("i2c:");
    buses.forEach((bus, b) => {
      lines.push(`  - id: i2c_${b + 1}`);
      lines.push(`    sda: ${bus.sda}`);
      lines.push(`    scl: ${bus.scl}`);
      lines.push("    scan: true");
    });
    if (buses.some((bus) => bus.pca !== null)) {
      lines.push("");
      lines.push("pca9685:");
      buses.forEach((bus, b) => {
        if (bus.pca === null) return;
        lines.push(`  - id: pca9685_${bus.pca + 1}`);
        lines.push(`    i2c_id: i2c_${b + 1}`);
        lines.push("    frequency: 50Hz");
      });
    }
  }
  if (buses.some((bus) => bus.expanders.length)) {
    lines.push("");
    lines.push("mcp23017:");
    buses.forEach((bus, b) => {
      for (const i of bus.expanders) {
        lines.push(`  - id: ${expanderId(i)}`);
        lines.push(`    address: ${config.expanders[i].address}`);
        if (buses.length > 1) lines.push(`    i2c_id: i2c_${b + 1}`);
      }
    });
  }
  const sharedGlobals = [];
  logicHooks(config).emitGlobals(sharedGlobals, config);
  if (points.length || masts.some(mastShows) || sharedGlobals.length) {
    lines.push("");
    lines.push("globals:");
    for (const point of points) {
      lines.push(`  - id: ${point.id}_thrown`);
      lines.push("    type: bool");
      lines.push("    restore_value: true");
      lines.push('    initial_value: "false"');
      if (!lockActive(point, mqtt)) continue;
      // The default is the boot value. A retained LOCKED or UNLOCKED replaces it
      // when the broker connects. It is not saved, so the configurator choice wins
      // again after a power cut if nothing is retained.
      lines.push(`  - id: ${point.id}_locked`);
      lines.push("    type: bool");
      lines.push("    restore_value: false");
      lines.push(`    initial_value: "${point.lockDefault === "locked" ? "true" : "false"}"`);
    }
    for (const mast of masts) {
      if (!mastShows(mast)) continue;
      lines.push(`  - id: ${mast.id}_aspect`);
      lines.push("    type: int");
      lines.push("    restore_value: false");
      lines.push("    initial_value: '-1'");
    }
    lines.push(...sharedGlobals);
  }

  // Logic's own switch and scripts join those sections, or open them.
  const logicSwitches = [];
  logicHooks(config).emitLogicSwitch(logicSwitches, config);
  const logicScripts = [];
  logicHooks(config).emitLogicScripts(logicScripts, config);

  const hasButtons = points.some((point) => (point.controls || []).some((control) => control.buttonPin));
  const logicBlockSensors = [];
  logicHooks(config).emitBlocks(logicBlockSensors, config);
  logicHooks(config).emitLockReports(logicBlockSensors, config);
  logicHooks(config).emitEndSensors(logicBlockSensors, config);
  if (blocks.length || hasButtons || logicBlockSensors.length) {
    lines.push("");
    lines.push("binary_sensor:");
    for (const block of blocks) {
      const debounce = block.debounce || "500ms";
      lines.push("  - platform: gpio");
      lines.push("    pin:");
      const expanderIndex = block.expander ? (config.expanders || []).findIndex((e) => e.name === block.expander) : -1;
      if (expanderIndex >= 0) {
        // The expander's own pull-up, so it wires like an ESP pin.
        lines.push(`      mcp23xxx: ${expanderId(expanderIndex)}`);
        lines.push(`      number: ${Number(block.pin)}`);
        lines.push(`      inverted: ${block.inverted !== false}`);
        lines.push("      mode:");
        lines.push("        input: true");
        lines.push("        pullup: true");
      } else {
        lines.push(`      number: ${block.gpio}`);
        lines.push(`      inverted: ${block.inverted !== false}`);
        lines.push("      mode:");
        lines.push("        input: true");
      }
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
        logicHooks(config).emitSensorState(lines, "        ", config, block, true);
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
        logicHooks(config).emitSensorState(lines, "        ", config, block, false);
      }
    }
    for (const point of points) {
      (point.controls || []).forEach((control, index) => emitButton(lines, point, control, index, lockFlags(config, point, mqtt)));
    }
    lines.push(...logicBlockSensors);
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
        if (pcaBoards.length > 1) lines.push(`    pca9685_id: pca9685_${pcaBoardIndex(point, pcaBoards.length) + 1}`);
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
    if (lights.length || logicSwitches.length) {
      lines.push("");
      lines.push("switch:");
      for (const light of lights) {
        lines.push("  - platform: gpio");
        lines.push(`    pin: ${light.pin}`);
        lines.push(`    id: ${light.id}`);
        lines.push(`    name: ${yamlQuote(light.name)}`);
        lines.push("    internal: true");
      }
      lines.push(...logicSwitches.splice(0));
    }

    lines.push("");
    lines.push("script:");
    for (const point of points) {
      emitThrowScript(lines, point, false, mqtt, config);
      emitThrowScript(lines, point, true, mqtt, config);
      const latch = latchIndex(point);
      if (latch >= 0) emitLatchScript(lines, point, latch, lockFlags(config, point, mqtt));
    }
    for (const mast of masts) {
      if (mastShows(mast)) emitShowScript(lines, mast, config);
    }
    lines.push(...logicScripts.splice(0));

  } else if (masts.length) {
    lines.push("");
    lines.push("number:");
    emitSignalControls(lines, masts);
    if (masts.some(mastShows) || logicScripts.length) {
      lines.push("");
      lines.push("script:");
      for (const mast of masts) {
        if (mastShows(mast)) emitShowScript(lines, mast, config);
      }
      lines.push(...logicScripts.splice(0));
    }
  }
  if (logicScripts.length) {
    lines.push("");
    lines.push("script:");
    lines.push(...logicScripts);
  }
  if (logicSwitches.length) {
    lines.push("");
    lines.push("switch:");
    lines.push(...logicSwitches);
  }

  const gpioWithLamps = gpioMasts.filter((mast) => (mast.lamps || []).length);
  if (gpioWithLamps.length && !points.length) {
    lines.push("");
    lines.push("output:");
    emitGpioOutputs(lines, gpioWithLamps);
  }
  if (masts.length) emitSignalLights(lines, masts);
  const sharedTextSensors = [];
  logicHooks(config).emitTextSensors(sharedTextSensors, config);
  logicHooks(config).emitRemoteSubscriptions(sharedTextSensors, config);
  // The logic version is on the web page with MQTT off too.
  const logicTextSensors = [];
  logicHooks(config).emitLogicTextSensors(logicTextSensors, config);
  if ((mqtt && (points.length || masts.length || sharedTextSensors.length)) || logicTextSensors.length) {
    lines.push("");
    lines.push("text_sensor:");
    if (mqtt) {
      if (points.length) emitPointTextSensors(lines, points, config);
      // A mast that rules set keeps its subscription, without a handler: the
      // logic component reads JMRI's messages for it.
      if (masts.length) emitSignalTextSensors(lines, masts, logicHooks(config).fieldMastNames(config));
      lines.push(...sharedTextSensors);
    }
    lines.push(...logicTextSensors);
  }
  logicHooks(config).emitEndTexts(lines, config);
  logicHooks(config).emitComponent(lines, config);

  lines.push("");
  return lines.join("\n");
}

  global.EsphomeMr = {
    CONFIG_MARKER,
    MIN_ESPHOME_VERSION,
    DEFAULT_MQTT_BROKER,
    PULLUP_PINS,
    STRAPPING_PINS,
    MAX_PCA_BOARDS,
    NO_PULLUP_PINS,
    MCP_ADDRESSES,
    MAX_EXPANDERS_PER_BUS,
    expanderPinLabel,
    i2cBusLimit,
    i2cBuses,
    pcaInUse,
    sanitizeId,
    uniqueIds,
    entityName,
    expanderId,
    myFirstBoardPreset,
    newBoardConfig,
    emptyConfig,
    LOGIC_MODE_NAMES,
    logicMode,
    sharesWithOtherBoards,
    turnoutSensorTopic,
    yamlQuote,
    cppString,
    jmriAspectName,
    mastShows,
    NAME_SUFFIX_ALPHABET,
    MAX_TYPED_NAME,
    isNameSuffix,
    generateNameSuffix,
    typedBoardName,
    setTypedBoardName,
    addNameSuffix,
    newNameSuffix,
    topicFor,
    thrownTopic,
    lockTopic,
    lockedTopic,
    lockFlags,
    latchIndex,
    SIGNAL_COLORS,
    SIGNAL_COLOR_ORDER,
    CATS_ASPECTS,
    ASPECT_TAGS,
    CATS_ASPECT_TAGS,
    CATS_DIVERGING,
    catsAspectTag,
    catsAspectDiverging,
    catsAspectState,
    variantFor,
    normalizeConfig,
    ensureSecrets,
    generatePassword,
    validateConfig,
    parseConfigFromYaml,
    generateYaml,
    generateJmriXml,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
