/**
 * ESPHome for Model Railroading — board.yaml generator
 * Config schema version: 1
 * Minimum ESPHome: 2024.6.0 (ota platform: esphome)
 */

(function (global) {
const CONFIG_MARKER = "esphome-mr-config:1";
const MIN_ESPHOME_VERSION = "2024.6.0";

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

function myFirstBoardPreset() {
  return {
    board: {
      name: "my-first-board",
      boardType: "nodemcu-32s",
      wifiSsid: "",
      wifiPassword: "",
      mqttBroker: "",
      otaPassword: "",
    },
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
        name: "up_loop",
        topic: "trains/track/turnout/Kiama/Up Loop",
        channel: 0,
        travelTime: "10s",
      },
    ],
    i2c: { sda: "GPIO21", scl: "GPIO22" },
  };
}

function emptyConfig() {
  return {
    board: {
      name: "my-first-board",
      boardType: "nodemcu-32s",
      wifiSsid: "",
      wifiPassword: "",
      mqttBroker: "",
      otaPassword: "",
    },
    blocks: [],
    points: [],
    i2c: { sda: "GPIO21", scl: "GPIO22" },
  };
}

function validateConfig(config) {
  const warnings = [];
  const errors = [];
  const board = config.board || {};

  if (!board.name || !/^[a-z0-9-]+$/.test(board.name)) {
    errors.push("Board name must be lowercase letters, numbers, and dashes only.");
  }
  if (!board.wifiSsid) warnings.push("Wi-Fi name is empty — fill it in on the Board page before you download.");
  if (!board.wifiPassword) warnings.push("Wi-Fi password is empty — fill it in on the Board page before you download.");
  if (!board.mqttBroker) warnings.push("MQTT address is empty — use this computer’s network address, not localhost.");
  if (!board.otaPassword) warnings.push("OTA password is empty — set one before flashing.");

  const pins = new Map();
  for (const block of config.blocks || []) {
    const pin = String(block.gpio || "").toUpperCase();
    if (!pin) {
      errors.push(`Block "${block.name}" needs a GPIO pin.`);
      continue;
    }
    if (pins.has(pin)) {
      warnings.push(`GPIO clash: ${pin} used by "${pins.get(pin)}" and "${block.name}".`);
    } else {
      pins.set(pin, block.name);
    }
  }

  if ((config.points || []).length) {
    const i2cPins = [config.i2c?.sda, config.i2c?.scl].filter(Boolean).map((p) => String(p).toUpperCase());
    for (const pin of i2cPins) {
      if (pins.has(pin)) {
        warnings.push(`GPIO clash: ${pin} used by block "${pins.get(pin)}" and PCA9685 I2C.`);
      }
    }
    const channels = new Map();
    for (const point of config.points) {
      const ch = Number(point.channel);
      if (Number.isNaN(ch) || ch < 0 || ch > 15) {
        errors.push(`Point "${point.name}" channel must be 0–15.`);
        continue;
      }
      if (channels.has(ch)) {
        warnings.push(`PCA9685 channel clash: ${ch} used by "${channels.get(ch)}" and "${point.name}".`);
      } else {
        channels.set(ch, point.name);
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

  return { warnings, errors };
}

function yamlQuote(value) {
  const s = String(value ?? "");
  if (s === "") return '""';
  if (/[:#{}[\],&*?|>!%@`]/.test(s) || /\s/.test(s) || /['"]/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

function yamlSingleQuote(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
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
      // still in header comments
      continue;
    }
    if (foundMarker) break;
  }
  throw new Error(
    "This file was not generated by the configurator (missing esphome-mr-config header). Only re-import files downloaded from this tool."
  );
}

function generateYaml(config) {
  const board = config.board;
  const blocks = uniqueIds(config.blocks || []);
  const points = uniqueIds(config.points || []);
  const i2c = config.i2c || { sda: "GPIO21", scl: "GPIO22" };
  const stateForBlob = {
    board: { ...board },
    blocks: (config.blocks || []).map(({ name, topic, gpio, inverted, debounce }) => ({
      name,
      topic,
      gpio,
      inverted: !!inverted,
      debounce,
    })),
    points: (config.points || []).map(({ name, topic, channel, travelTime }) => ({
      name,
      topic,
      channel: Number(channel),
      travelTime,
    })),
    i2c,
  };

  const lines = [];
  lines.push(`# ${CONFIG_MARKER}`);
  lines.push(`# ${JSON.stringify(stateForBlob)}`);
  lines.push("#");
  lines.push("# Generated by ESPHome for Model Railroading Configurator");
  lines.push(`# Requires ESPHome >= ${MIN_ESPHOME_VERSION}`);
  lines.push("# Re-import this file into the configurator to edit — avoid hand-editing if you plan to re-import.");
  lines.push("# This file contains Wi-Fi / MQTT / OTA credentials — do not commit it to a public repo.");
  lines.push("");

  lines.push("esphome:");
  lines.push(`  name: ${yamlQuote(board.name)}`);
  lines.push(`  min_version: "${MIN_ESPHOME_VERSION}"`);

  // Merge on_boot actions for blocks and points
  const bootActions = [];
  if (blocks.length) {
    bootActions.push({ priority: "-50.0", kind: "blocks" });
  }
  if (points.length) {
    bootActions.push({ priority: "-200.0", kind: "points" });
  }
  if (bootActions.length) {
    lines.push("  on_boot:");
    for (const action of bootActions) {
      lines.push(`    - priority: ${action.priority}`);
      lines.push("      then:");
      if (action.kind === "blocks") {
        for (const block of blocks) {
          lines.push("        - mqtt.publish:");
          lines.push(`            topic: ${yamlQuote(block.topic)}`);
          lines.push("            payload: !lambda |-");
          lines.push(
            `              return id(${block.id}_sensor).state ? "ACTIVE" : "INACTIVE";`
          );
          lines.push("            retain: false");
          lines.push("            qos: 2");
        }
      }
      if (action.kind === "points") {
        for (const point of points) {
          lines.push("        - mqtt.publish:");
          lines.push(`            topic: ${yamlQuote(point.topic)}`);
          lines.push(`            payload: ${yamlSingleQuote("CLOSED")}`);
        }
      }
    }
  }

  lines.push("");
  lines.push("esp32:");
  lines.push(`  board: ${board.boardType || "nodemcu-32s"}`);
  lines.push("");
  lines.push("logger:");
  lines.push("  level: DEBUG");
  lines.push("");
  lines.push("mqtt:");
  lines.push(`  broker: ${yamlQuote(board.mqttBroker)}`);
  lines.push("  id: mqtt_server");
  lines.push("  discovery: false");
  lines.push("");
  lines.push("ota:");
  lines.push("  - platform: esphome");
  lines.push(`    password: ${yamlQuote(board.otaPassword)}`);
  lines.push("");
  lines.push("wifi:");
  lines.push(`  ssid: ${yamlQuote(board.wifiSsid)}`);
  lines.push(`  password: ${yamlQuote(board.wifiPassword)}`);
  lines.push("  power_save_mode: none");
  lines.push("");
  lines.push("button:");
  lines.push("  - platform: restart");
  lines.push("    id: reboot_esp");
  lines.push('    name: "Restart Board"');

  if (points.length) {
    lines.push("");
    lines.push("web_server:");
    lines.push("");
    lines.push("i2c:");
    lines.push(`  sda: ${i2c.sda}`);
    lines.push(`  scl: ${i2c.scl}`);
    lines.push("  scan: true");
    lines.push("");
    lines.push("pca9685:");
    lines.push("  frequency: 50Hz");
  }

  if (blocks.length) {
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
      lines.push(`    name: ${yamlQuote(block.name)}`);
      lines.push("    filters:");
      lines.push(`      - delayed_on_off: ${debounce}`);
      lines.push("    on_press:");
      lines.push("      then:");
      lines.push("        - logger.log:");
      lines.push(`            format: ${yamlQuote(`${block.name} | OCCUPIED`)}`);
      lines.push("            level: INFO");
      lines.push("            tag: block_sensor");
      lines.push("        - mqtt.publish:");
      lines.push(`            topic: ${yamlQuote(block.topic)}`);
      lines.push("            payload: ACTIVE");
      lines.push("            retain: false");
      lines.push("            qos: 2");
      lines.push("    on_release:");
      lines.push("      then:");
      lines.push("        - logger.log:");
      lines.push(`            format: ${yamlQuote(`${block.name} | UNOCCUPIED`)}`);
      lines.push("            level: INFO");
      lines.push("            tag: block_sensor");
      lines.push("        - mqtt.publish:");
      lines.push(`            topic: ${yamlQuote(block.topic)}`);
      lines.push("            payload: INACTIVE");
      lines.push("            retain: false");
      lines.push("            qos: 2");
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
        lines.push(`    name: ${yamlQuote(`${point.id} ${label}`)}`);
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

    lines.push("");
    lines.push("output:");
    for (const point of points) {
      lines.push("  - platform: pca9685");
      lines.push(`    id: ${point.id}_output`);
      lines.push(`    channel: ${Number(point.channel)}`);
    }

    lines.push("");
    lines.push("servo:");
    for (const point of points) {
      lines.push(`  - id: ${point.id}_servo`);
      lines.push(`    output: ${point.id}_output`);
      lines.push("    auto_detach_time: 0s");
      lines.push(`    transition_length: ${point.travelTime || "10s"}`);
    }

    lines.push("");
    lines.push("text_sensor:");
    for (const point of points) {
      lines.push("  - platform: mqtt_subscribe");
      lines.push(`    name: ${yamlQuote(`${point.id} last command`)}`);
      lines.push(`    id: ${point.id}`);
      lines.push(`    topic: ${yamlQuote(point.topic)}`);
      lines.push("    on_value:");
      lines.push("      - if:");
      lines.push("          condition:");
      lines.push("            text_sensor.state:");
      lines.push(`              id: ${point.id}`);
      lines.push("              state: 'THROWN'");
      lines.push("          then:");
      lines.push("            - logger.log:");
      lines.push(`                format: ${yamlQuote(`${point.id} -> THROWN (reverse)`)}`);
      lines.push("                level: INFO");
      lines.push("                tag: point_control");
      lines.push("            - servo.write:");
      lines.push(`                id: ${point.id}_servo`);
      lines.push(
        `                level: !lambda 'return id(${point.id}_servo_endpoint_reverse).state / 100.0;'`
      );
      lines.push("            - delay: 1s");
      lines.push("            - servo.write:");
      lines.push(`                id: ${point.id}_servo`);
      lines.push(
        `                level: !lambda 'return id(${point.id}_servo_endpoint_reverse_backoff).state / 100.0;'`
      );
      lines.push("            - mqtt.publish:");
      lines.push(`                topic: ${yamlQuote(`${point.topic}/State`)}`);
      lines.push('                payload: "THROWN"');
      lines.push("      - if:");
      lines.push("          condition:");
      lines.push("            text_sensor.state:");
      lines.push(`              id: ${point.id}`);
      lines.push("              state: 'CLOSED'");
      lines.push("          then:");
      lines.push("            - logger.log:");
      lines.push(`                format: ${yamlQuote(`${point.id} -> CLOSED (normal)`)}`);
      lines.push("                level: INFO");
      lines.push("                tag: point_control");
      lines.push("            - servo.write:");
      lines.push(`                id: ${point.id}_servo`);
      lines.push(
        `                level: !lambda 'return id(${point.id}_servo_endpoint_normal).state / 100.0;'`
      );
      lines.push("            - delay: 1s");
      lines.push("            - servo.write:");
      lines.push(`                id: ${point.id}_servo`);
      lines.push(
        `                level: !lambda 'return id(${point.id}_servo_endpoint_normal_backoff).state / 100.0;'`
      );
      lines.push("            - mqtt.publish:");
      lines.push(`                topic: ${yamlQuote(`${point.topic}/State`)}`);
      lines.push('                payload: "CLOSED"');
    }
  }

  lines.push("");
  return lines.join("\n");
}

  global.EsphomeMr = {
    CONFIG_MARKER,
    MIN_ESPHOME_VERSION,
    sanitizeId,
    uniqueIds,
    myFirstBoardPreset,
    emptyConfig,
    validateConfig,
    parseConfigFromYaml,
    generateYaml,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
