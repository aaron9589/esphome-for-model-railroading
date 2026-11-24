// Logic parts of the YAML and JMRI XML (docs/field-logic-spec.md). Loaded
// after generator.js, which calls these hooks from generateYaml,
// generateJmriXml and validateConfig. Every hook writes nothing for a board
// with logic mode None and Share unticked, so its YAML stays as it was.
(function (global) {
  const M = () => global.EsphomeMr;

  // Board-level topics. The channel is the configurator's usual "trains/".
  function onlineTopic(config) {
    return `trains/track/sensor/board/${config.board.name}/Online`;
  }

  function ownerTopic(config) {
    return `trains/track/board/${config.board.name}/Owner`;
  }

  function problemTopic(config) {
    return `trains/track/board/${config.board.name}/Problem`;
  }

  function sensorStateTopic(block) {
    return `${String(block.topic || "").replace(/\/+$/, "")}/State`;
  }

  function movingTopic(point) {
    return M().turnoutSensorTopic(point.topic, "Moving");
  }

  function mastStateTopic(mast) {
    return `${String(mast.topic || "").replace(/\/+$/, "")}/State`;
  }

  // Share publishes need MQTT; with it off, Share is a validation error and
  // nothing is written.
  function sharing(config) {
    return M().sharesWithOtherBoards(config) && config.board?.mqttEnabled !== false;
  }

  // The name another board reads for an aspect: the JMRI aspect name, the part
  // of its first match string before ";", else its label.
  function aspectName(aspect) {
    const state = (aspect.states || []).map((item) => String(item).trim()).find(Boolean);
    return state ? M().jmriAspectName(state) : String(aspect.label || "");
  }

  function publish(lines, indent, topic, payloadLines, retain = true) {
    const { yamlQuote } = M();
    lines.push(`${indent}- mqtt.publish:`);
    lines.push(`${indent}    topic: ${yamlQuote(topic)}`);
    if (payloadLines.length === 1 && !payloadLines[0].startsWith("return")) {
      lines.push(`${indent}    payload: ${payloadLines[0]}`);
    } else {
      lines.push(`${indent}    payload: !lambda |-`);
      for (const line of payloadLines) lines.push(`${indent}      ${line}`);
    }
    lines.push(`${indent}    retain: ${retain}`);
    lines.push(`${indent}    qos: 2`);
  }

  // --- mqtt: Online as the birth, will and shutdown message.
  function emitMqttMessages(lines, config) {
    if (!sharing(config)) return;
    const topic = M().yamlQuote(onlineTopic(config));
    for (const [key, payload] of [["birth_message", "ACTIVE"], ["will_message", "INACTIVE"], ["shutdown_message", "INACTIVE"]]) {
      lines.push(`  ${key}:`);
      lines.push(`    topic: ${topic}`);
      lines.push(`    payload: ${payload}`);
      lines.push("    retain: true");
    }
  }

  // --- mqtt: on_connect. Everything shared is sent again on connect.
  function emitOnConnect(lines, config, { blocks, points, masts }) {
    if (!sharing(config)) return;
    for (const block of blocks) {
      publish(lines, "    ", sensorStateTopic(block), [`return id(${block.id}_sensor).state ? "ACTIVE" : "INACTIVE";`]);
    }
    for (const point of points) {
      publish(lines, "    ", movingTopic(point), [
        `return id(${point.id}_throw_closed).is_running() || id(${point.id}_throw_thrown).is_running() ? "ACTIVE" : "INACTIVE";`,
      ]);
    }
    for (const mast of masts) {
      if (!M().mastShows(mast)) continue;
      publish(lines, "    ", mastStateTopic(mast), mastStateLambda(mast));
    }
    // Owner: this board's MAC. A different MAC heard after our own came back
    // is another board with the same name.
    lines.push("    - globals.set:");
    lines.push("        id: board_owner_heard");
    lines.push("        value: 'false'");
    publish(lines, "    ", ownerTopic(config), ["return get_mac_address_pretty();"]);
  }

  // --- a sensor's on_press / on_release: the retained /State mirror.
  function emitSensorState(lines, indent, config, block, active) {
    if (!sharing(config)) return;
    publish(lines, indent, sensorStateTopic(block), [active ? "ACTIVE" : "INACTIVE"]);
  }

  // --- throw scripts: /Moving, ACTIVE as the throw starts and INACTIVE once
  // /Thrown has the new position. Only announced throws publish, as /Thrown does;
  // on connect the board sends where it is.
  function emitThrowStart(lines, config, point) {
    if (!sharing(config)) return;
    lines.push("      - if:");
    lines.push("          condition:");
    lines.push("            lambda: 'return announce;'");
    lines.push("          then:");
    publish(lines, "            ", movingTopic(point), ["ACTIVE"]);
  }

  function emitThrowEnd(lines, config, point) {
    if (!sharing(config)) return;
    publish(lines, "            ", movingTopic(point), ["INACTIVE"]);
  }

  // --- a mast's show script: /State, the aspect name it shows. Nothing shown
  // yet, or dark, sends an empty retained message, which clears it: another
  // board reads that as not known, so Stop.
  function mastStateLambda(mast) {
    const rows = [`switch (id(${mast.id}_aspect)) {`];
    (mast.aspects || []).forEach((aspect, index) => {
      if (!(aspect.states || []).some((state) => String(state).trim())) return;
      rows.push(`  case ${index}: return ${M().cppString(aspectName(aspect))};`);
    });
    rows.push('  default: return "";');
    rows.push("}");
    return rows;
  }

  function emitMastState(lines, config, mast) {
    if (!sharing(config)) return;
    // Brightness sliders run the script again without a new aspect.
    lines.push("      - if:");
    lines.push("          condition:");
    lines.push("            lambda: 'return restart_effects;'");
    lines.push("          then:");
    publish(lines, "            ", mastStateTopic(mast), mastStateLambda(mast));
  }

  // --- globals the shared publishes need.
  function emitGlobals(lines, config) {
    if (!sharing(config)) return;
    lines.push("  - id: board_owner_heard");
    lines.push("    type: bool");
    lines.push("    restore_value: false");
    lines.push('    initial_value: "false"');
  }

  // --- text_sensor: the Owner check, and its result on the web page.
  function emitTextSensors(lines, config) {
    if (!sharing(config)) return;
    const name = config.board.name;
    lines.push("  - platform: template");
    lines.push("    id: board_name_check");
    lines.push('    name: "Board name check"');
    lines.push("  - platform: mqtt_subscribe");
    lines.push("    id: board_owner");
    lines.push("    internal: true");
    lines.push(`    topic: ${M().yamlQuote(ownerTopic(config))}`);
    lines.push("    on_value:");
    lines.push("      - lambda: |-");
    const body = [
      "const std::string mine = get_mac_address_pretty();",
      "if (x == mine) {",
      "  // Our own MAC came back. Anything older was a retained message.",
      "  id(board_owner_heard) = true;",
      `  id(board_name_check).publish_state("OK");`,
      "  return;",
      "}",
      "if (x.empty() || !id(board_owner_heard)) return;",
      `ESP_LOGE("board", "Another board called ${name} is on the broker (MAC %s). Give one of them a new suffix.", x.c_str());`,
      `id(board_name_check).publish_state("Clash: another board called ${name}, MAC " + x);`,
      `id(mqtt_server).publish(${M().cppString(problemTopic(config))}, std::string("Clash"), 0, false);`,
    ];
    for (const row of body) lines.push(`          ${row}`);
  }

  // Web page for the Owner check's result.
  function needsWebServer(config) {
    return sharing(config);
  }

  // --- JMRI XML: the Logic tick box.
  function jmriSensors(config) {
    if (config.board?.mqttEnabled === false || !M().sharesWithOtherBoards(config)) return [];
    return [`board/${config.board.name}/Online`];
  }

  function hasJmriLogic(config) {
    return M().logicMode(config) !== "none" || M().sharesWithOtherBoards(config);
  }

  // --- validation.
  const RESERVED_PREFIXES = ["logic/", "board/"];
  const RESERVED_SUFFIXES = ["/State", "/Moving", "/Locked", "/Thrown"];

  function validate(config, errors) {
    const shares = M().sharesWithOtherBoards(config);
    const active = shares || M().logicMode(config) !== "none";
    if (!active) return;
    if (shares && config.board?.mqttEnabled === false) {
      errors.push("Share with other boards needs MQTT. Turn MQTT back on under Board, or untick Share on the Logic page.");
    }
    const named = [
      ...(config.blocks || []).map((item) => ["Sensor", item]),
      ...(config.points || []).map((item) => ["Turnout", item]),
    ];
    for (const [kind, item] of named) {
      const name = String(item.name || "").trim();
      const prefix = RESERVED_PREFIXES.find((p) => name.toLowerCase().startsWith(p));
      if (prefix) errors.push(`${kind} "${name}" starts with ${prefix}, which board topics use. Rename it.`);
      const suffix = RESERVED_SUFFIXES.find((s) => name.endsWith(s));
      if (suffix) errors.push(`${kind} "${name}" ends with ${suffix}, which shared topics use. Rename it.`);
    }
    if (!shares || config.board?.mqttEnabled === false) return;
    // A sensor must not sit on a topic this board now publishes.
    const published = new Map();
    published.set(onlineTopic(config), "this board's Online report");
    for (const block of config.blocks || []) published.set(sensorStateTopic(block), `sensor "${block.name}"'s shared state`);
    for (const point of config.points || []) published.set(movingTopic(point), `turnout "${point.name}"'s moving report`);
    for (const block of config.blocks || []) {
      const what = published.get(block.topic);
      if (what) errors.push(`Sensor "${block.name}" uses ${block.topic}, where the board sends ${what}. Rename the sensor.`);
    }
  }

  global.EsphomeMrLogicYaml = {
    onlineTopic,
    ownerTopic,
    problemTopic,
    sensorStateTopic,
    movingTopic,
    mastStateTopic,
    aspectName,
    emitMqttMessages,
    emitOnConnect,
    emitSensorState,
    emitThrowStart,
    emitThrowEnd,
    emitMastState,
    emitGlobals,
    emitTextSensors,
    needsWebServer,
    jmriSensors,
    hasJmriLogic,
    validate,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
