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
const STRAPPING_PINS = new Set(["GPIO0", "GPIO2", "GPIO12", "GPIO15"]);
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
  };
}

function emptyConfig() {
  return {
    board: boardDefaults(),
    blocks: [],
    points: [],
    i2c: { sda: "GPIO21", scl: "GPIO22" },
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
  if (typeof board.mqttEnabled !== "boolean") board.mqttEnabled = true;
  if (typeof config.pca9685 !== "boolean") config.pca9685 = true;
  if (!config.i2c) config.i2c = { sda: "GPIO21", scl: "GPIO22" };
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
    }
  }

  for (const block of config.blocks || []) {
    const pin = String(block.gpio || "").toUpperCase();
    if (!pin) {
      errors.push(`Block "${block.name}" needs a GPIO pin.`);
      continue;
    }
    notePin(pin, block.name);
  }

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

function emitThrowScript(lines, point, thrown, publish) {
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

function emitSignalTextSensors(lines, masts) {
  for (const mast of masts) {
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

  const stripMasts = masts.filter((mast) => mast.mode !== "gpio");
  const gpioMasts = masts.filter((mast) => mast.mode === "gpio");
  const startupMasts = masts
    .map((mast) => ({ mast, index: startupAspectIndex(mast) }))
    .filter((item) => item.index >= 0);
  if (points.length || stripMasts.length || startupMasts.length) {
    lines.push("  on_boot:");
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
    lines.push("  reboot_timeout: 0s");
    if (blocks.length || points.length) {
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
    }
    lines.push("");
  }
  lines.push("button:");
  lines.push("  - platform: restart");
  lines.push("    id: reboot_esp");
  lines.push('    name: "Restart Board"');

  if (points.length || masts.length) {
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
  if (points.length || masts.some(mastShows)) {
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
  }

  const hasButtons = points.some((point) => (point.controls || []).some((control) => control.buttonPin));
  if (blocks.length || hasButtons) {
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
      }
    }
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
      emitThrowScript(lines, point, false, mqtt);
      emitThrowScript(lines, point, true, mqtt);
    }
    for (const mast of masts) {
      if (mastShows(mast)) emitShowScript(lines, mast);
    }

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
  }

  const gpioWithLamps = gpioMasts.filter((mast) => (mast.lamps || []).length);
  if (gpioWithLamps.length && !points.length) {
    lines.push("");
    lines.push("output:");
    emitGpioOutputs(lines, gpioWithLamps);
  }
  if (masts.length) emitSignalLights(lines, masts);
  if (mqtt && (points.length || masts.length)) {
    lines.push("");
    lines.push("text_sensor:");
    if (points.length) emitPointTextSensors(lines, points);
    if (masts.length) emitSignalTextSensors(lines, masts);
  }

  lines.push("");
  return lines.join("\n");
}

  global.EsphomeMr = {
    CONFIG_MARKER,
    MIN_ESPHOME_VERSION,
    PULLUP_PINS,
    STRAPPING_PINS,
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
