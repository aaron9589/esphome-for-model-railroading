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
    // A sensor with no reading yet sends nothing: its first reading publishes
    // /State from on_press or on_release. A retained guess could read clear.
    for (const block of blocks) {
      lines.push("    - if:");
      lines.push("        condition:");
      lines.push(`          lambda: 'return id(${block.id}_sensor).has_state();'`);
      lines.push("        then:");
      publish(lines, "          ", sensorStateTopic(block), [`return id(${block.id}_sensor).state ? "ACTIVE" : "INACTIVE";`]);
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
    for (const flag of ["board_owner_heard", "board_owner_answered"]) {
      lines.push("    - globals.set:");
      lines.push(`        id: ${flag}`);
      lines.push("        value: 'false'");
    }
    publish(lines, "    ", ownerTopic(config), ["return get_mac_address_pretty();"]);
  }

  // --- a sensor's on_press / on_release: the retained /State mirror.
  function emitSensorState(lines, indent, config, block, active) {
    if (!sharing(config)) return;
    publish(lines, indent, sensorStateTopic(block), [active ? "ACTIVE" : "INACTIVE"]);
  }

  // --- throw scripts: /Moving, ACTIVE as every throw starts (boot moves too,
  // since on connect may have seen one running) and INACTIVE once /Thrown has
  // the new position. An opposite command can start the other throw script
  // mid-move, so only the last one running clears it.
  function emitThrowStart(lines, config, point) {
    if (!sharing(config)) return;
    publish(lines, "      ", movingTopic(point), ["ACTIVE"]);
  }

  function emitThrowEnd(lines, config, point, thrown) {
    if (!sharing(config)) return;
    const other = `${point.id}_throw_${thrown ? "closed" : "thrown"}`;
    lines.push("      - if:");
    lines.push("          condition:");
    lines.push(`            lambda: 'return !id(${other}).is_running();'`);
    lines.push("          then:");
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
    for (const flag of ["board_owner_heard", "board_owner_answered"]) {
      lines.push(`  - id: ${flag}`);
      lines.push("    type: bool");
      lines.push("    restore_value: false");
      lines.push('    initial_value: "false"');
    }
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
      `ESP_LOGE("board", "Another board called %s is on the broker (MAC %s). Give one of them a new suffix.", ${M().cppString(name)}, x.c_str());`,
      `id(board_name_check).publish_state(std::string(${M().cppString(`Clash: another board called ${name}, MAC `)}) + x);`,
      `id(mqtt_server).publish(${M().cppString(problemTopic(config))}, std::string("Clash"), 0, false);`,
      "// Send our MAC again, once, so the other board sees the clash too.",
      "if (!id(board_owner_answered)) {",
      "  id(board_owner_answered) = true;",
      `  id(mqtt_server).publish(${M().cppString(ownerTopic(config))}, mine, 2, true);`,
      "}",
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

  // --- Linked boards (spec, Remote inputs). Another board is stored as a
  // snapshot of just what the dropdowns and checks need: names and topics, and
  // whether it shares. Never its Wi-Fi or keys. A typed board has names only,
  // with topics in the standard syntax.
  function linkedBoardFromConfig(other) {
    const M_ = M();
    M_.normalizeConfig(other);
    const pick = (items) => (items || []).map(({ name, topic }) => ({ name, topic }));
    return {
      name: other.board.name,
      share: M_.sharesWithOtherBoards(other) && other.board.mqttEnabled !== false,
      blocks: pick(other.blocks),
      points: pick(other.points),
      signals: {
        masts: (other.signals?.masts || []).map((mast) => ({
          name: mast.name,
          topic: mast.topic,
          aspects: (mast.aspects || []).map((aspect) => aspectName(aspect)).filter(Boolean),
        })),
      },
      logic: { blocks: pick(other.logic?.blocks) },
    };
  }

  function typedLinkedBoard(name) {
    return { name: String(name || "").trim(), typed: true, share: true, blocks: [], points: [], signals: { masts: [] }, logic: { blocks: [] } };
  }

  // A typed item's topic follows the standard syntax.
  function typedItem(kind, name) {
    const text = String(name || "").trim();
    return { name: text, topic: M().topicFor(kind === "turnout" ? "point" : "block", text) };
  }

  // What changed between two snapshots of one board, in words.
  function linkedBoardChanges(before, after) {
    const changes = [];
    for (const [key, label] of [["blocks", "sensor"], ["points", "turnout"]]) {
      const was = new Map((before?.[key] || []).map((item) => [item.name, item.topic]));
      const now = new Map((after?.[key] || []).map((item) => [item.name, item.topic]));
      for (const [name, topic] of now) {
        if (!was.has(name)) changes.push(`new ${label} "${name}"`);
        else if (was.get(name) !== topic) changes.push(`${label} "${name}" has a new topic`);
      }
      for (const name of was.keys()) if (!now.has(name)) changes.push(`${label} "${name}" is gone`);
    }
    const wasBlocks = new Set((before?.logic?.blocks || []).map((item) => item.name));
    const nowBlocks = new Set((after?.logic?.blocks || []).map((item) => item.name));
    for (const name of nowBlocks) if (!wasBlocks.has(name)) changes.push(`new block "${name}"`);
    for (const name of wasBlocks) if (!nowBlocks.has(name)) changes.push(`block "${name}" is gone`);
    if (before && after && before.share !== after.share) changes.push(after.share ? "it now shares" : "it no longer shares");
    return changes;
  }

  function linkedBoards(config) {
    return Array.isArray(config.logic?.remoteBoards) ? config.logic.remoteBoards : [];
  }

  const REMOTE_KINDS = Object.freeze({
    sensor: { list: (board) => board.blocks, label: "sensor" },
    block: { list: (board) => board.logic?.blocks, label: "block" },
    turnout: { list: (board) => board.points, label: "turnout" },
  });

  function remoteKind(ref) {
    return Object.keys(REMOTE_KINDS).find((kind) => ref && typeof ref === "object" && ref[kind] !== undefined);
  }

  function isRemoteRef(ref) {
    return !!(ref && typeof ref === "object" && ref.board && remoteKind(ref));
  }

  /**
   * A reference to another board's item, { board, sensor | block | turnout },
   * resolved against the linked boards. Returns null, with `problem` saying
   * why, when it cannot be.
   */
  function resolveRemote(config, ref) {
    const kind = remoteKind(ref);
    const board = linkedBoards(config).find((b) => b.name === ref?.board);
    if (!kind) return { problem: "is not a sensor, block or turnout" };
    if (!board) return { problem: `is on board "${ref.board}", which is not under Linked boards` };
    const item = (REMOTE_KINDS[kind].list(board) || []).find((i) => i.name === ref[kind]);
    if (!item) return { problem: `${REMOTE_KINDS[kind].label} "${ref[kind]}" is not on ${board.name}. Refresh the linked board, or pick another` };
    const id = M().sanitizeId(`linked_${board.name}_${kind}_${item.name}`);
    return { kind, board, item, id, onlineId: onlineSubscriptionId(board) };
  }

  function onlineSubscriptionId(board) {
    return M().sanitizeId(`linked_${board.name}_online`);
  }

  // Every remote item this board's logic uses. Blocks use them now; rules will.
  function remoteRefsUsed(config) {
    if (M().logicMode(config) !== "field") return [];
    const refs = [];
    for (const block of config.logic?.blocks || []) {
      for (const member of block.sensors || []) if (isRemoteRef(member)) refs.push(member);
    }
    return refs;
  }

  // The subscriptions each remote item needs, keyed by id.
  function remoteSubscriptions(config) {
    const subs = new Map();
    for (const ref of remoteRefsUsed(config)) {
      const found = resolveRemote(config, ref);
      if (!found.item) continue;
      const { kind, board, item, id, onlineId } = found;
      subs.set(onlineId, onlineTopic({ board: { name: board.name } }));
      if (kind === "turnout") {
        subs.set(`${id}_thrown`, M().thrownTopic(item.topic));
        subs.set(`${id}_moving`, M().turnoutSensorTopic(item.topic, "Moving"));
      } else {
        subs.set(id, sensorStateTopic(item));
      }
    }
    return subs;
  }

  function emitRemoteSubscriptions(lines, config) {
    if (config.board?.mqttEnabled === false) return;
    for (const [id, topic] of remoteSubscriptions(config)) {
      lines.push("  - platform: mqtt_subscribe");
      lines.push(`    id: ${id}`);
      lines.push("    internal: true");
      lines.push(`    topic: ${M().yamlQuote(topic)}`);
    }
  }

  // C++: a remote input is known once its first message has come, while its
  // board is Online and while this board is on the broker. Anything else is
  // not known, and logic reads it as its fail-safe value.
  function knownExpr(id, onlineId) {
    return `(id(mqtt_server).is_connected() && id(${onlineId}).has_state() && id(${onlineId}).state == "ACTIVE" && id(${id}).has_state() && !id(${id}).state.empty())`;
  }

  // C++: a remote sensor or block is clear only on proof: known and INACTIVE.
  function remoteOccupiedExpr(config, ref) {
    const found = resolveRemote(config, ref);
    if (!found.item || found.kind === "turnout") return "true";
    return `!(${knownExpr(found.id, found.onlineId)} && id(${found.id}).state == "INACTIVE")`;
  }

  // C++: a remote turnout is in a position only when known and not moving.
  function remoteTurnoutExpr(config, ref, thrown) {
    const found = resolveRemote(config, ref);
    if (!found.item || found.kind !== "turnout") return "false";
    const { id, onlineId } = found;
    return `(${knownExpr(`${id}_thrown`, onlineId)} && ${knownExpr(`${id}_moving`, onlineId)} && id(${id}_moving).state == "INACTIVE" && id(${id}_thrown).state == "${thrown ? "ACTIVE" : "INACTIVE"}")`;
  }

  function validateLinkedBoards(config, errors, warnings) {
    const boards = linkedBoards(config);
    const names = new Set();
    for (const board of boards) {
      if (!board.name) errors.push("A linked board has no name. Type its name, or remove it.");
      else if (board.name === config.board?.name) errors.push(`Linked board "${board.name}" has this board's own name. Link a different board.`);
      else if (names.has(board.name)) errors.push(`Board "${board.name}" is linked twice. Remove one.`);
      names.add(board.name);
    }
    const refs = remoteRefsUsed(config);
    if (refs.length && config.board?.mqttEnabled === false) {
      errors.push("Items from other boards need MQTT. Turn MQTT back on under Board, or use only this board's sensors.");
    }
    const notSharing = new Set();
    for (const ref of refs) {
      const found = resolveRemote(config, ref);
      const kind = remoteKind(ref);
      if (!found.item) {
        errors.push(`The ${kind || "item"} "${ref[kind] ?? "?"}" from another board ${found.problem}.`);
      } else if (!found.board.share) {
        notSharing.add(found.board.name);
      }
    }
    for (const name of notSharing) {
      errors.push(`Board "${name}" does not share with other boards, so this board cannot hear it. Tick Share on that board's Logic page, flash it, then Refresh it here.`);
    }
    void warnings;
  }

  // --- validation.
  const RESERVED_PREFIXES = ["logic/", "board/"];
  const RESERVED_SUFFIXES = ["/State", "/Moving", "/Locked", "/Thrown"];

  function validate(config, errors, warnings) {
    validateLinkedBoards(config, errors, warnings);
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
      const suffix = RESERVED_SUFFIXES.find((s) => name.toLowerCase().endsWith(s.toLowerCase()));
      if (suffix) errors.push(`${kind} "${name}" ends with ${suffix}, which shared topics use. Rename it.`);
    }
    if (!shares || config.board?.mqttEnabled === false) return;
    // A sensor must not sit on a topic this board now publishes.
    const published = new Map();
    published.set(onlineTopic(config), "this board's Online report");
    for (const block of config.blocks || []) published.set(sensorStateTopic(block), `sensor "${block.name}"'s shared state`);
    for (const point of config.points || []) published.set(movingTopic(point), `turnout "${point.name}"'s moving report`);
    const masts = config.signals?.masts || [];
    for (const mast of masts) published.set(mastStateTopic(mast), `signal mast "${mast.name}"'s shared aspect`);
    for (const block of config.blocks || []) {
      const what = published.get(block.topic);
      if (what) errors.push(`Sensor "${block.name}" uses ${block.topic}, where the board sends ${what}. Rename the sensor.`);
    }
    for (const mast of masts) {
      const what = published.get(mast.topic);
      if (what) errors.push(`Signal mast "${mast.name}" uses ${mast.topic}, where the board sends ${what}. Rename the mast.`);
    }
  }

  global.EsphomeMrLogicYaml = {
    linkedBoardFromConfig,
    typedLinkedBoard,
    typedItem,
    linkedBoardChanges,
    linkedBoards,
    isRemoteRef,
    remoteKind,
    resolveRemote,
    remoteRefsUsed,
    remoteSubscriptions,
    emitRemoteSubscriptions,
    remoteOccupiedExpr,
    remoteTurnoutExpr,
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
