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
    // Blocks, like detectors, send their state to JMRI on every connect: a
    // change before the broker was up was never heard. A block with no state
    // yet sends nothing; its first state publishes from on_press / on_release.
    for (const block of blockIds(config)) {
      lines.push("    - if:");
      lines.push("        condition:");
      lines.push(`          lambda: 'return id(${block.id}).has_state();'`);
      lines.push("        then:");
      const payload = [`return id(${block.id}).state ? "ACTIVE" : "INACTIVE";`];
      publish(lines, "          ", block.topic, payload, false);
      if (sharing(config)) publish(lines, "          ", sensorStateTopic(block), payload);
    }
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
    for (const mast of virtualMastIds(config)) publish(lines, "    ", mastStateTopic(mast), virtualStateLambda(mast));
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

  // --- globals: Field Logic's, then the ones the shared publishes need.
  function emitGlobals(lines, config) {
    emitLogicGlobals(lines, config);
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

  // Web page for the Owner check's result, and for the logic switch, the
  // Release buttons and the version code.
  function needsWebServer(config) {
    return sharing(config) || fieldMode(config);
  }

  // --- JMRI XML: the Logic tick box.
  // The Logic box's sensors as { label, topic }: the board's Online sensor
  // when it shares, and each block.
  function jmriSensors(config) {
    if (config.board?.mqttEnabled === false) return [];
    const items = [];
    if (M().sharesWithOtherBoards(config)) items.push({ kind: "online", label: "Online sensor", topic: onlineTopic(config) });
    for (const block of logicBlocks(config)) items.push({ kind: "block", label: `Block "${block.name}"`, topic: block.topic });
    if (fieldMode(config)) {
      for (const res of resourcesOf(config)) {
        if (!String(res.name || "")) continue;
        items.push({ kind: "held", label: `Held "${res.name}"`, topic: logicTopic(config, "sensor", `/${res.name}/Held`) });
      }
    }
    return items;
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
    // Each mast's aspects as its /State names them (the JMRI aspect name), with
    // the tags and diverging ticks that board's Masts gives them, so rules here
    // read it by meaning. A mast that board's logic does not tag reads as stop.
    const entries = Array.isArray(other.logic?.masts) ? other.logic.masts.filter((entry) => entry && typeof entry === "object") : [];
    const field = M_.logicMode(other) === "field";
    const meaning = (entry, pairs) => {
      const tags = {};
      const diverging = [];
      for (const [label, name] of pairs) {
        if (!name || Object.hasOwn(tags, name)) continue;
        tags[name] = field ? aspectTag(entry, label) : "stop";
        if (field && aspectDiverging(entry, label)) diverging.push(name);
      }
      return { aspects: Object.keys(tags), tags, diverging };
    };
    return {
      name: other.board.name,
      share: M_.sharesWithOtherBoards(other) && other.board.mqttEnabled !== false,
      blocks: pick(other.blocks),
      points: pick(other.points),
      signals: {
        masts: (other.signals?.masts || []).map((mast) => ({
          name: mast.name,
          topic: mast.topic,
          ...meaning(
            entries.find((entry) => entry.virtual !== true && entry.mast === mast.name),
            (mast.aspects || []).map((aspect) => [String(aspect.label ?? ""), aspectName(aspect)]),
          ),
        })),
      },
      logic: {
        blocks: pick(other.logic?.blocks),
        // Signals with no lights: their /State is the aspect's own name.
        masts: field ? entries.filter((entry) => entry.virtual === true && entry.name).map((entry) => ({
          name: entry.name,
          topic: entry.topic,
          ...meaning(entry, (Array.isArray(entry.aspects) ? entry.aspects : []).map((name) => [String(name), String(name)])),
        })) : [],
      },
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
    mast: { list: (board) => [...(board.signals?.masts || []), ...(board.logic?.masts || [])], label: "signal mast" },
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
  function findRemote(config, ref) {
    const kind = remoteKind(ref);
    const board = linkedBoards(config).find((b) => b.name === ref?.board);
    if (!kind) return { problem: "is not a sensor, block, turnout or signal mast" };
    if (!board) return { problem: `is on board "${ref.board}", which is not under Linked boards` };
    const item = (REMOTE_KINDS[kind].list(board) || []).find((i) => i.name === ref[kind]);
    if (!item) return { problem: `${REMOTE_KINDS[kind].label} "${ref[kind]}" is not on ${board.name}. Refresh the linked board, or pick another` };
    return { kind, board, item };
  }

  function resolveRemote(config, ref) {
    const found = findRemote(config, ref);
    if (!found.item) return found;
    const ids = remoteIdTable(config);
    const boardKey = onlineKey(found.board);
    const itemKey = itemIdKey(found.board, found.kind, found.item);
    return {
      ...found,
      id: ids.get(itemKey) || itemBaseId(found.board, found.kind, found.item),
      onlineId: ids.get(boardKey) || onlineBaseId(found.board),
    };
  }

  const onlineKey = (board) => `${board.name}\u0000online`;
  const itemIdKey = (board, kind, item) => `${board.name}\u0000${kind}\u0000${item.name}`;
  const onlineBaseId = (board) => M().sanitizeId(`linked_${board.name}_online`);
  const itemBaseId = (board, kind, item) => M().sanitizeId(`linked_${board.name}_${kind}_${item.name}`);

  function shortHash(text) {
    let hash = 0x811c9dc5;
    for (const ch of text) hash = Math.imul(hash ^ ch.codePointAt(0), 0x01000193) >>> 0;
    return hash.toString(16).padStart(8, "0").slice(0, 6);
  }

  // ESPHome ids for the remote items in use. sanitizeId folds case and
  // punctuation, so "Up Main" and "up-main" (or boards "a-b" and "a--b") would
  // share an id and one subscription would be lost. Any id two items would
  // share gets a short hash of each item's exact name instead.
  function remoteIdTable(config) {
    const bases = new Map();
    for (const ref of remoteRefsUsed(config)) {
      const { kind, board, item } = findRemote(config, ref);
      if (!item) continue;
      bases.set(onlineKey(board), { base: onlineBaseId(board), suffixes: [""] });
      bases.set(itemIdKey(board, kind, item), {
        base: itemBaseId(board, kind, item),
        suffixes: kind === "turnout" ? ["_thrown", "_moving"] : [""],
      });
    }
    const owners = new Map();
    for (const [key, { base, suffixes }] of bases) {
      for (const suffix of suffixes) {
        const id = base + suffix;
        if (!owners.has(id)) owners.set(id, new Set());
        owners.get(id).add(key);
      }
    }
    const clashing = new Set();
    for (const keys of owners.values()) if (keys.size > 1) keys.forEach((key) => clashing.add(key));
    const ids = new Map();
    for (const [key, { base }] of bases) ids.set(key, clashing.has(key) ? `${base}_${shortHash(key)}` : base);
    return ids;
  }

  // Every remote item this board's logic uses: block members, and anything a
  // rule or a section's release reads with a `board` key.
  function remoteRefsUsed(config) {
    if (M().logicMode(config) !== "field") return [];
    const refs = [];
    for (const block of config.logic?.blocks || []) {
      for (const member of block.sensors || []) if (isRemoteRef(member)) refs.push(member);
    }
    walkObjects([layersOf(config), resourcesOf(config)], (obj) => {
      if (isRemoteRef(obj)) refs.push(obj);
    });
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
      } else if (kind === "mast") {
        subs.set(id, mastStateTopic(item));
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

  // --- Blocks (spec, Blocks and detection). A block is a named group of
  // sensors, this board's and other boards'. It is occupied while any of them
  // is, and it publishes like a detector. Blocks are detection, not logic, so
  // they run whether rules do or not. Only Field Logic generates them.
  function logicBlocks(config) {
    if (M().logicMode(config) !== "field") return [];
    return Array.isArray(config.logic?.blocks) ? config.logic.blocks : [];
  }

  // The blocks with their ESPHome ids: <block>_block, beside <sensor>_sensor.
  function blockIds(config) {
    return M().uniqueIds(logicBlocks(config)).map((block) => ({ ...block, id: `${block.id}_block` }));
  }

  // One key per member, whatever order its keys were stored in.
  function memberKey(member) {
    if (typeof member === "string") return `\u0000${member}`;
    const kind = remoteKind(member);
    return `${member?.board ?? ""}\u0000${kind ?? "?"}\u0000${kind ? member[kind] : JSON.stringify(member)}`;
  }

  // A block member: this board's sensor by name, or another board's sensor or
  // block. Returns what the YAML needs, or `problem` when it cannot be used.
  function blockMember(config, member) {
    if (typeof member === "string") {
      const sensors = M().uniqueIds(config.blocks || []);
      const sensor = sensors.find((item) => item.name === member);
      if (!sensor) return { problem: `uses sensor "${member}", which is not on the Sensors page. Pick another, or remove it` };
      const at = sensor.expander ? (config.expanders || []).findIndex((e) => e.name === sensor.expander) : -1;
      return { local: sensor, expander: at >= 0 ? M().expanderId(at) : null };
    }
    if (member && typeof member === "object" && member.turnout !== undefined) {
      return { problem: `has turnout "${member.turnout}" in it. A block is made of sensors: take the turnout out` };
    }
    if (member && typeof member === "object" && member.mast !== undefined) {
      return { problem: `has signal mast "${member.mast}" in it. A block is made of sensors: take the mast out` };
    }
    if (isRemoteRef(member)) return { remote: member };
    return { problem: "has a sensor this configurator cannot read. Remove it" };
  }

  // C++: whether one member reads occupied. A local sensor on an expander that
  // is failed or has a warning reads occupied: ESPHome only warns when an
  // expander stops answering, and its pins keep their last value.
  function memberOccupiedExpr(config, member) {
    const found = blockMember(config, member);
    if (found.local) {
      const own = `id(${found.local.id}_sensor).state`;
      return found.expander ? `id(${found.expander}).is_failed() || id(${found.expander}).status_has_warning() || ${own}` : own;
    }
    if (found.remote) return remoteOccupiedExpr(config, found.remote);
    return "true";
  }

  function blockLambda(config, block) {
    const members = (block.sensors || []).filter((member) => member !== null && member !== undefined);
    const rows = [];
    // Until each of this board's sensors has its first reading the block says
    // nothing, so it does not report OCCUPIED for a moment at every boot.
    const locals = [...new Set(members.map((member) => blockMember(config, member).local?.id).filter(Boolean))];
    if (locals.length) {
      rows.push(`if (${locals.map((id) => `!id(${id}_sensor).has_state()`).join(" || ")}) return {};`);
    }
    // Occupied while any sensor is. Another board's sensor reads occupied until
    // it is known: heard from, with its board online.
    const seen = new Set();
    const unique = members.filter((member) => !seen.has(memberKey(member)) && seen.add(memberKey(member)));
    const exprs = [...new Set(unique.map((member) => memberOccupiedExpr(config, member)))];
    if (!exprs.length) exprs.push("true");
    rows.push(`return ${exprs[0]}${exprs.length > 1 ? "" : ";"}`);
    exprs.slice(1).forEach((expr, i) => rows.push(`    || ${expr}${i === exprs.length - 2 ? ";" : ""}`));
    return rows;
  }

  // --- binary_sensor: one template sensor per block.
  function emitBlocks(lines, config) {
    const { yamlQuote, entityName } = M();
    const mqtt = config.board?.mqttEnabled !== false;
    for (const block of blockIds(config)) {
      lines.push("  - platform: template");
      lines.push(`    id: ${block.id}`);
      lines.push(`    name: ${yamlQuote(entityName(block.name))}`);
      lines.push("    lambda: |-");
      for (const row of blockLambda(config, block)) lines.push(`      ${row}`);
      for (const [trigger, word, payload, active] of [["on_press", "OCCUPIED", "ACTIVE", true], ["on_release", "UNOCCUPIED", "INACTIVE", false]]) {
        lines.push(`    ${trigger}:`);
        lines.push("      then:");
        lines.push("        - logger.log:");
        lines.push(`            format: ${yamlQuote(`${block.name} | ${word}`)}`);
        lines.push("            level: INFO");
        lines.push("            tag: block");
        if (!mqtt) continue;
        publish(lines, "        ", block.topic, [payload], false);
        emitSensorState(lines, "        ", config, block, active);
      }
    }
  }

  // --- Reference integrity (spec, The Logic page). The Logic page refers to
  // this board's sensors, turnouts and masts by name. Renaming one renames
  // every reference; deleting one leaves its references to be reported as
  // missing until they are fixed.
  //
  // A reference is { sensor | turnout | mast: name } with no `board` key (a
  // `board` key means another board's item), or a sensor name in a `sensors`
  // list (block members, plant end tracks). Linked boards' snapshots are other
  // boards' names and are never touched. Returns how many were renamed.
  // A later part that refers to a sensor, turnout or mast under any other key
  // must be added here. (A mast's approachLight names a block, not a sensor.)
  const REFERENCE_KINDS = Object.freeze(["sensor", "turnout", "mast"]);

  function renameReferences(config, kind, from, to) {
    if (!REFERENCE_KINDS.includes(kind) || !config?.logic || typeof from !== "string" || !from || from === to) return 0;
    // An empty name is never a reference: renaming to it would lose them all.
    if (typeof to !== "string" || !to.trim()) return 0;
    let count = 0;
    const walk = (value) => {
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      if (!value || typeof value !== "object") return;
      for (const [key, inner] of Object.entries(value)) {
        if (key === "remoteBoards") continue;
        if (key === kind && inner === from && value.board === undefined) {
          value[key] = to;
          count += 1;
        } else if (kind === "sensor" && key === "sensors" && Array.isArray(inner)) {
          inner.forEach((member, i) => {
            if (member === from) {
              inner[i] = to;
              count += 1;
            }
          });
          inner.forEach(walk);
        } else {
          walk(inner);
        }
      }
    };
    walk(config.logic);
    return count;
  }

  // Linked boards show only in Field Logic, so they are checked only there: a
  // problem the person cannot see must not block the download.
  function validateLinkedBoards(config, errors, warnings) {
    if (M().logicMode(config) !== "field") return;
    const boards = linkedBoards(config);
    const names = new Set();
    for (const board of boards) {
      if (!board.name) errors.push("A linked board has no name. Type its name, or remove it.");
      else if (board.name === config.board?.name) errors.push(`Linked board "${board.name}" has this board's own name. Link a different board.`);
      else if (names.has(board.name)) errors.push(`Board "${board.name}" is linked twice. Remove one.`);
      else if (board.typed && !/^[a-z0-9-]+$/.test(board.name)) {
        errors.push(`Linked board "${board.name}" is not a board name. Type it as that board shows it: lowercase letters, numbers, and dashes.`);
      }
      names.add(board.name);
      if (!board.typed) continue;
      // Typed names become MQTT topics: + and # are wildcards there, and / adds a level.
      for (const [key, label] of [["blocks", "Sensor"], ["points", "Turnout"]]) {
        for (const item of board[key] || []) {
          const name = String(item?.name || "");
          if (/[+#]/.test(name)) errors.push(`${label} "${name}" on linked board "${board.name}" has + or #, which MQTT topics cannot use. Type the name as that board shows it.`);
          else if (name.includes("/")) warnings.push(`${label} "${name}" on linked board "${board.name}" has a /. Check it matches that board's name exactly.`);
        }
      }
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
  }

  // --- validation.
  const RESERVED_PREFIXES = ["logic/", "board/"];
  const RESERVED_SUFFIXES = ["/State", "/Moving", "/Locked", "/Thrown"];

  function memberLabel(member) {
    if (typeof member === "string") return `sensor "${member}"`;
    const kind = remoteKind(member);
    return `${REMOTE_KINDS[kind]?.label || "item"} "${member?.[kind] ?? "?"}" from ${member?.board || "another board"}`;
  }

  function validateBlocks(config, errors, warnings) {
    const blocks = logicBlocks(config);
    // ESPHome needs each binary_sensor's name to be its own, after entityName
    // turns "/" into " - ", and without regard to case.
    const entity = (name) => M().entityName(name).toLowerCase();
    const entities = new Map();
    for (const sensor of config.blocks || []) entities.set(entity(sensor.name), `sensor "${sensor.name}"`);
    for (const point of config.points || []) {
      (point.controls || []).forEach((control, index) => {
        if (control.buttonPin) entities.set(entity(`${point.name} button ${index + 1}`), `turnout "${point.name}"'s button ${index + 1}`);
      });
    }
    const sensorTopics = new Map((config.blocks || []).map((item) => [item.topic, `sensor "${item.name}"`]));
    for (const point of config.points || []) sensorTopics.set(point.topic, `turnout "${point.name}"`);
    for (const mast of config.signals?.masts || []) sensorTopics.set(mast.topic, `signal mast "${mast.name}"`);
    const reports = new Map();
    for (const point of config.points || []) {
      reports.set(M().thrownTopic(point.topic), `turnout "${point.name}" reports its position`);
      if (point.lockEnabled === true) reports.set(M().lockedTopic(point.topic), `turnout "${point.name}" reports its lock`);
    }
    const names = new Set();
    const topics = new Map();
    const uses = new Map();
    for (const block of blocks) {
      const name = String(block.name || "").trim();
      const label = name ? `Block "${name}"` : "A block";
      if (!name) errors.push("A block has no name. Give it one, or remove it.");
      else if (names.has(entity(name))) errors.push(`Two blocks are called "${name}" (or nearly). Give each its own name.`);
      else if (entities.has(entity(name))) errors.push(`Block "${name}" has the same name as ${entities.get(entity(name))}. Rename the block.`);
      names.add(entity(name));
      const topic = String(block.topic || "").trim();
      if (!topic) errors.push(`${label} has no MQTT topic. Fill one in.`);
      else if (sensorTopics.has(topic)) errors.push(`${label} uses ${topic}, which ${sensorTopics.get(topic)} uses. Give the block its own topic.`);
      else if (reports.has(topic)) errors.push(`${label} uses ${topic}, where ${reports.get(topic)}. Give the block its own topic.`);
      else if (topics.has(topic)) errors.push(`${label} and block "${topics.get(topic)}" both use ${topic}. Give each its own topic.`);
      else topics.set(topic, name);
      const members = (block.sensors || []).filter((member) => member !== null && member !== undefined);
      if (!members.length) errors.push(`${label} has no sensors. Add the sensors that see a train in it.`);
      const seen = new Set();
      for (const member of members) {
        const key = memberKey(member);
        if (seen.has(key)) continue;
        seen.add(key);
        const found = blockMember(config, member);
        if (found.problem) errors.push(`${label} ${found.problem}.`);
        if (!uses.has(key)) uses.set(key, { member, blocks: [] });
        uses.get(key).blocks.push(name || "?");
      }
    }
    // A boundary sensor sits in the two blocks either side of it.
    for (const { member, blocks: inBlocks } of uses.values()) {
      if (inBlocks.length > 2) {
        const what = memberLabel(member);
        warnings.push(`${what[0].toUpperCase()}${what.slice(1)} is in ${inBlocks.length} blocks (${inBlocks.join(", ")}). A sensor at a boundary is in two: check the others.`);
      }
    }
  }

  // The component turns an aspect's name into the index the show script draws,
  // so each aspect of a mast logic uses needs a name of its own. A name that
  // is only a number would also change place in the table, since JSON objects
  // put those first.
  const NUMBER_NAME = /^(0|[1-9]\d*)$/;

  function validateAspectNames(names, where, errors) {
    const seen = new Set();
    for (const name of names) {
      if (!name.trim()) errors.push(`${where} has an aspect with no name. Name it, or remove it.`);
      else if (seen.has(name)) errors.push(`${where} has two aspects called "${name}". Logic needs each aspect named once: rename one.`);
      else if (NUMBER_NAME.test(name)) errors.push(`${where} has an aspect called "${name}", only a number. Give it a name with a letter in it.`);
      seen.add(name);
    }
  }

  function validateLogicMasts(config, errors) {
    if (!fieldMode(config)) return;
    const used = mastNamesUsed(config);
    const real = new Set();
    for (const mast of config.signals?.masts || []) {
      real.add(mast.name);
      if (!used.has(mast.name)) continue;
      const where = `Signal mast "${mast.name}"`;
      // An aspect with no JMRI string is already an error on every mast.
      validateAspectNames((mast.aspects || []).map((aspect) => String(aspect.label ?? "")), where, errors);
    }
    const field = fieldMastNames(config);
    const names = new Set();
    for (const entry of mastEntries(config)) {
      if (entry.virtual !== true) continue;
      const name = String(entry.name || "").trim();
      if (!name) {
        errors.push("A signal with no lights has no name. Name it, or remove it.");
        continue;
      }
      const where = `Signal with no lights "${name}"`;
      if (real.has(name)) errors.push(`${where} has the name of a signal mast on the Signal Masts page. Rename it.`);
      else if (names.has(name)) errors.push(`Two signals with no lights are called "${name}". Rename one.`);
      names.add(name);
      if (!list(entry.aspects).length) errors.push(`${where} has no aspects. Add the aspects rules show on it.`);
      validateAspectNames(list(entry.aspects).map(String), where, errors);
      if (!field.has(name)) errors.push(`${where} is not set by any rule, so it would always show Stop. Add a rule that sets it, or remove it.`);
    }
  }

  function validate(config, errors, warnings) {
    validateLinkedBoards(config, errors, warnings);
    validateBlocks(config, errors, warnings);
    validateLogicMasts(config, errors);
    const shares = M().sharesWithOtherBoards(config);
    const active = shares || M().logicMode(config) !== "none";
    if (!active) return;
    if (shares && config.board?.mqttEnabled === false) {
      errors.push("Share with other boards needs MQTT. Turn MQTT back on under Board, or untick Share on the Logic page.");
    }
    const named = [
      ...(config.blocks || []).map((item) => ["Sensor", item]),
      ...(config.points || []).map((item) => ["Turnout", item]),
      ...logicBlocks(config).map((item) => ["Block", item]),
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
    for (const block of logicBlocks(config)) published.set(sensorStateTopic(block), `block "${block.name}"'s shared state`);
    for (const point of config.points || []) published.set(movingTopic(point), `turnout "${point.name}"'s moving report`);
    const masts = config.signals?.masts || [];
    for (const mast of masts) published.set(mastStateTopic(mast), `signal mast "${mast.name}"'s shared aspect`);
    for (const block of config.blocks || []) {
      const what = published.get(block.topic);
      if (what) errors.push(`Sensor "${block.name}" uses ${block.topic}, where the board sends ${what}. Rename the sensor.`);
    }
    for (const block of logicBlocks(config)) {
      const what = published.get(block.topic);
      if (what) errors.push(`Block "${block.name}" uses ${block.topic}, where the board sends ${what}. Rename the block.`);
    }
    for (const mast of masts) {
      const what = published.get(mast.topic);
      if (what) errors.push(`Signal mast "${mast.name}" uses ${mast.topic}, where the board sends ${what}. Rename the mast.`);
    }
  }

  // ===== Field Logic on the board (work item 2.5) ===========================
  // The rule table (the engine cases' board format, as JSON), its version
  // code, and the YAML around the mr_logic component: the logic switch, the
  // Release buttons, the field-lock and virtual-mast globals, and the
  // component's bindings (spec, "The component (Spike A)").

  // The component's source, pinned so a board builds against the interpreter
  // that matches the page that made its YAML (plan, "Pinning the component").
  // A branch until the first pre-release tag is cut; then logic-v0.1.0, ...
  const LOGIC_COMPONENT_REF = "feature/logic";
  const LOGIC_COMPONENT_SOURCE = `github://aaron9589/esphome-for-model-railroading@${LOGIC_COMPONENT_REF}`;
  const LOGIC_ID = "logic";
  const SWITCH_ID = "field_logic";

  const fieldMode = (config) => M().logicMode(config) === "field";
  const mqttOn = (config) => config.board?.mqttEnabled !== false;
  const list = (value) => (Array.isArray(value) ? value : []);
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

  function layersOf(config) {
    return list(config.logic?.layers).filter(isObject);
  }

  function resourcesOf(config) {
    return list(config.logic?.resources).filter(isObject);
  }

  // Masts entries: { mast } for a mast on the Signal Masts page, or
  // { virtual: true, name, topic, aspects, tags } for a signal with no lights.
  function mastEntries(config) {
    return list(config.logic?.masts).filter(isObject);
  }

  function virtualMasts(config) {
    if (!fieldMode(config)) return [];
    return mastEntries(config).filter((entry) => entry.virtual === true && String(entry.name || "").trim());
  }

  function mastEntry(config, name) {
    return mastEntries(config).find((entry) => entry.virtual !== true && entry.mast === name);
  }

  // Every object in a rule, depth first: conditions, moments, then.
  function walkObjects(value, visit) {
    if (Array.isArray(value)) {
      value.forEach((item) => walkObjects(item, visit));
      return;
    }
    if (!isObject(value)) return;
    visit(value);
    for (const inner of Object.values(value)) walkObjects(inner, visit);
  }

  // Masts this board's rules set: field-controlled (spec, Terms).
  function fieldMastNames(config) {
    const names = new Set();
    if (!fieldMode(config)) return names;
    for (const layer of layersOf(config)) {
      for (const rule of list(layer.rules)) {
        const mast = rule?.then?.mast;
        if (typeof mast === "string" && mast) names.add(mast);
      }
    }
    return names;
  }

  // Masts the rules read on this board (no `board` key), or set.
  function mastNamesUsed(config) {
    const names = fieldMastNames(config);
    walkObjects([layersOf(config), resourcesOf(config)], (obj) => {
      if (typeof obj.mast === "string" && obj.mast && obj.board === undefined) names.add(obj.mast);
    });
    for (const entry of mastEntries(config)) if (entry.virtual !== true && typeof entry.mast === "string") names.add(entry.mast);
    return names;
  }

  // Turnouts a rule locks: they get a field-lock global.
  function lockedTurnoutNames(config) {
    const names = new Set();
    if (!fieldMode(config)) return names;
    for (const layer of layersOf(config)) {
      for (const rule of list(layer.rules)) {
        for (const name of list(rule?.then?.lock)) if (typeof name === "string" && name) names.add(name);
      }
    }
    return names;
  }

  // An aspect's tag on this board: as set under Masts, else stop. An untagged
  // aspect counts as the most restrictive (spec, Stored format).
  function aspectTag(entry, name) {
    const tag = isObject(entry?.tags) && Object.hasOwn(entry.tags, name) ? entry.tags[name] : undefined;
    return M().ASPECT_TAGS.includes(tag) ? tag : "stop";
  }

  function aspectDiverging(entry, name) {
    return list(entry?.diverging).includes(name);
  }

  function startupLabel(mast) {
    const aspect = (mast.aspects || []).find((item) => item.startup === true && (item.states || []).some((s) => String(s).trim()));
    return aspect ? String(aspect.label) : undefined;
  }

  // The stop aspect: as set under Masts, else the aspect named R292 or Stop
  // (by name or by its JMRI aspect), else the first stop aspect, else the first.
  function stopLabel(names, tags, chosen, jmriNames = []) {
    if (chosen && names.includes(chosen)) return chosen;
    for (const held of ["R292", "Stop"]) {
      const at = names.findIndex((name, i) => (name === held || jmriNames[i] === held) && tags[name] === "stop");
      if (at >= 0) return names[at];
    }
    return names.find((name) => tags[name] === "stop") || names[0];
  }

  // A real mast in the table. Its aspects keep the Signal Masts page's order,
  // because the component turns an aspect name into the index the show
  // script draws. Its JMRI strings go in only where they are not the
  // default the engine assumes ("<aspect>; Lit; Unheld").
  function realMastTable(config, mast) {
    const entry = mastEntry(config, mast.name);
    const names = (mast.aspects || []).map((aspect) => String(aspect.label ?? ""));
    const aspects = {};
    for (const name of names) if (!Object.hasOwn(aspects, name)) aspects[name] = aspectTag(entry, name);
    const out = { aspects };
    const diverging = names.filter((name) => aspectDiverging(entry, name));
    if (diverging.length) out.diverging = [...new Set(diverging)];
    const states = {};
    (mast.aspects || []).forEach((aspect, i) => {
      const own = (aspect.states || []).map((s) => String(s).trim()).filter(Boolean);
      const name = names[i];
      if (Object.hasOwn(states, name)) return;
      if (own.length !== 1 || own[0] !== `${name}; Lit; Unheld`) states[name] = own;
    });
    if (Object.keys(states).length) out.states = states;
    out.stop = stopLabel(names, aspects, entry?.stopAspect, (mast.aspects || []).map(aspectName));
    const startup = startupLabel(mast);
    if (startup !== undefined) out.startup = startup;
    if (typeof entry?.approachLight === "string" && entry.approachLight) out.approachLight = entry.approachLight;
    return out;
  }

  function virtualMastTable(entry) {
    const names = list(entry.aspects).map((name) => String(name));
    const aspects = {};
    for (const name of names) if (!Object.hasOwn(aspects, name)) aspects[name] = aspectTag(entry, name);
    const out = { aspects };
    const diverging = names.filter((name) => aspectDiverging(entry, name));
    if (diverging.length) out.diverging = [...new Set(diverging)];
    out.stop = stopLabel(names, aspects, entry.stopAspect);
    if (typeof entry.approachLight === "string" && entry.approachLight) out.approachLight = entry.approachLight;
    return out;
  }

  // A copy with every object's keys in order, so the same rule always gives
  // the same text, whatever order its keys were stored in.
  function sorted(value) {
    if (Array.isArray(value)) return value.map(sorted);
    if (!isObject(value)) return value;
    const out = {};
    for (const key of Object.keys(value).sort()) if (value[key] !== undefined) out[key] = sorted(value[key]);
    return out;
  }

  // Only the fields that run. A layer's `starter` and a block's topic are for
  // the page and the YAML; they are not part of the logic.
  function tableLogic(config) {
    const logic = {};
    const blocks = logicBlocks(config).map((block) => ({ name: String(block.name || ""), sensors: sorted(list(block.sensors)) }));
    if (blocks.length) logic.blocks = blocks;
    const resources = resourcesOf(config).map((res) => {
      const out = { name: String(res.name || ""), blocks: sorted(list(res.blocks)) };
      if (res.release !== undefined) out.release = sorted(res.release);
      if (res.approachLock) out.approachLock = res.approachLock;
      return out;
    });
    if (resources.length) logic.resources = resources;
    const layers = layersOf(config).map((layer) => ({
      name: String(layer.name || ""),
      rules: list(layer.rules).filter(isObject).map((rule) => {
        const out = {};
        for (const key of ["trigger", "checks", "then", "cancel"]) if (rule[key] !== undefined) out[key] = sorted(rule[key]);
        return out;
      }),
    }));
    if (layers.length) logic.layers = layers;
    return logic;
  }

  // Another board's masts as its /State reads: by JMRI aspect name.
  function remoteMastTable(mast) {
    const names = list(mast.aspects).map(String);
    const tags = isObject(mast.tags) ? mast.tags : {};
    const aspects = {};
    for (const name of names) if (!Object.hasOwn(aspects, name)) aspects[name] = M().ASPECT_TAGS.includes(tags[name]) ? tags[name] : "stop";
    const out = { aspects };
    const diverging = names.filter((name) => list(mast.diverging).includes(name));
    if (diverging.length) out.diverging = [...new Set(diverging)];
    return out;
  }

  function remoteTable(config) {
    const remote = {};
    const kindKey = { sensor: "sensors", block: "blocks", turnout: "turnouts" };
    for (const ref of remoteRefsUsed(config)) {
      const found = findRemote(config, ref);
      if (!found.item) continue;
      const entry = (remote[found.board.name] ||= {});
      if (found.kind === "mast") {
        entry.masts ||= {};
        if (!Object.hasOwn(entry.masts, found.item.name)) entry.masts[found.item.name] = remoteMastTable(found.item);
        continue;
      }
      const key = kindKey[found.kind];
      entry[key] ||= [];
      if (!entry[key].includes(found.item.name)) entry[key].push(found.item.name);
    }
    return remote;
  }

  /**
   * The rule table: this board in the engine cases' format (test/cases/README.md),
   * which the component reads, logic.js runs, and the version code hashes.
   * Null when the board has no Field Logic.
   */
  function logicTable(config) {
    if (!fieldMode(config)) return null;
    const table = {};
    const sensors = (config.blocks || []).map((sensor) => String(sensor.name || ""));
    if (sensors.length) table.sensors = sensors;
    const turnouts = (config.points || []).map((point) => String(point.name || ""));
    if (turnouts.length) table.turnouts = turnouts;
    const used = mastNamesUsed(config);
    const masts = {};
    for (const mast of config.signals?.masts || []) {
      if (used.has(mast.name) && !Object.hasOwn(masts, mast.name)) masts[mast.name] = realMastTable(config, mast);
    }
    for (const entry of virtualMasts(config)) {
      if (!Object.hasOwn(masts, entry.name)) masts[entry.name] = virtualMastTable(entry);
    }
    if (Object.keys(masts).length) table.masts = masts;
    const remote = remoteTable(config);
    if (Object.keys(remote).length) table.remote = remote;
    table.logic = tableLogic(config);
    return table;
  }

  function logicTableJson(config) {
    const table = logicTable(config);
    return table ? JSON.stringify(table) : "";
  }

  // The version code: FNV-1a (32 bits) over the table's UTF-8 bytes, as eight
  // hex digits. The table is built in a fixed order from only what runs, so
  // the same rules always give the same code.
  function versionCode(config) {
    const json = logicTableJson(config);
    if (!json) return "";
    let hash = 0x811c9dc5;
    const byte = (b) => {
      hash = Math.imul(hash ^ b, 0x01000193) >>> 0;
    };
    for (const ch of json) {
      const c = ch.codePointAt(0);
      if (c < 0x80) byte(c);
      else if (c < 0x800) [0xc0 | (c >> 6), 0x80 | (c & 63)].forEach(byte);
      else if (c < 0x10000) [0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)].forEach(byte);
      else [0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)].forEach(byte);
    }
    return hash.toString(16).padStart(8, "0");
  }

  // Ids: real masts as the generator numbers them; virtual masts after them,
  // so a virtual mast never takes a real mast's id.
  function realMastIds(config) {
    return M().uniqueIds(config.signals?.masts || []);
  }

  function virtualMastIds(config) {
    const real = config.signals?.masts || [];
    const all = M().uniqueIds([...real, ...virtualMasts(config)]);
    return all.slice(real.length);
  }

  // Field-controlled masts on the Signal Masts page, by id, with their stop
  // aspect's index, for the boot step. Empty without Field Logic.
  function fieldMastBoot(config) {
    const field = fieldMastNames(config);
    const boot = new Map();
    if (!field.size) return boot;
    const table = logicTable(config);
    for (const mast of realMastIds(config)) {
      if (!field.has(mast.name) || !M().mastShows(mast)) continue;
      const def = table.masts?.[mast.name];
      if (!def || boot.has(mast.id)) continue;
      const stop = (mast.aspects || []).findIndex((aspect) => String(aspect.label ?? "") === def.stop);
      if (stop >= 0) boot.set(mast.id, stop);
    }
    return boot;
  }

  // --- on_boot -150: a field-controlled mast shows its stop aspect while
  // logic is on, and its startup aspect (if any) only while it is off. The
  // component shows the same again at its start-up scan.
  function emitBootMast(lines, config, mast, startupIndex) {
    const boot = fieldMastBoot(config);
    if (!boot.has(mast.id)) return false;
    if (boot.get(mast.id) === startupIndex) {
      // The same aspect either way.
      lines.push("        - globals.set:");
      lines.push(`            id: ${mast.id}_aspect`);
      lines.push(`            value: '${startupIndex}'`);
      lines.push("        - script.execute:");
      lines.push(`            id: ${mast.id}_show`);
      lines.push("            restart_effects: true");
      return true;
    }
    lines.push("        - if:");
    lines.push("            condition:");
    lines.push(`              lambda: 'return id(${LOGIC_ID}).logic_on();'`);
    lines.push("            then:");
    lines.push("              - globals.set:");
    lines.push(`                  id: ${mast.id}_aspect`);
    lines.push(`                  value: '${boot.get(mast.id)}'`);
    lines.push("              - script.execute:");
    lines.push(`                  id: ${mast.id}_show`);
    lines.push("                  restart_effects: true");
    if (startupIndex >= 0) {
      lines.push("            else:");
      lines.push("              - globals.set:");
      lines.push(`                  id: ${mast.id}_aspect`);
      lines.push(`                  value: '${startupIndex}'`);
      lines.push("              - script.execute:");
      lines.push(`                  id: ${mast.id}_show`);
      lines.push("                  restart_effects: true");
    }
    return true;
  }

  function isBootMast(config, mast) {
    return fieldMastBoot(config).has(mast.id);
  }

  // --- on_boot -200: a toggle switch's boot move waits for the start-up scan,
  // so a turnout under a train is locked before the switch can move it.
  function emitBootWait(lines, indent, config) {
    if (!fieldMode(config)) return;
    lines.push(`${indent}- wait_until:`);
    lines.push(`${indent}    condition:`);
    lines.push(`${indent}      lambda: 'return id(${LOGIC_ID}).started();'`);
  }

  // --- globals: each rule-locked turnout's field lock, and each virtual
  // mast's aspect. Neither is saved: the start-up scan works them out again.
  function emitLogicGlobals(lines, config) {
    const locked = lockedTurnoutNames(config);
    for (const point of M().uniqueIds(config.points || [])) {
      if (!locked.has(point.name)) continue;
      lines.push(`  - id: ${point.id}_field_locked`);
      lines.push("    type: bool");
      lines.push("    restore_value: false");
      lines.push('    initial_value: "false"');
    }
    for (const mast of virtualMastIds(config)) {
      lines.push(`  - id: ${mast.id}_aspect`);
      lines.push("    type: int");
      lines.push("    restore_value: false");
      lines.push("    initial_value: '-1'");
    }
  }

  // --- script: a virtual mast's show script. No lamps: it publishes the
  // aspect another board reads, and logs it.
  function emitLogicScripts(lines, config) {
    for (const mast of virtualMastIds(config)) {
      const names = list(mast.aspects).map(String);
      lines.push(`  - id: ${mast.id}_show`);
      lines.push("    mode: restart");
      lines.push("    parameters:");
      lines.push("      restart_effects: bool");
      lines.push("    then:");
      lines.push("      - lambda: |-");
      lines.push(`          switch (id(${mast.id}_aspect)) {`);
      names.forEach((name, i) => {
        if (names.indexOf(name) !== i) return;
        lines.push(`            case ${i}: ESP_LOGI("signal_mast", "%s", ${M().cppString(`${mast.name} | ${name}`)}); break;`);
      });
      lines.push("            default: break;");
      lines.push("          }");
      if (!sharing(config)) continue;
      publish(lines, "      ", mastStateTopic(mast), virtualStateLambda(mast));
    }
  }

  function virtualStateLambda(mast) {
    const names = list(mast.aspects).map(String);
    const rows = [`switch (id(${mast.id}_aspect)) {`];
    names.forEach((name, i) => {
      if (names.indexOf(name) === i) rows.push(`  case ${i}: return ${M().cppString(name)};`);
    });
    rows.push('  default: return "";');
    rows.push("}");
    return rows;
  }

  // --- button: Release <section>, a press for the component.
  function emitLogicButtons(lines, config) {
    if (!fieldMode(config)) return;
    for (const res of resourcesOf(config)) {
      const name = String(res.name || "");
      if (!name) continue;
      lines.push("  - platform: template");
      lines.push(`    name: ${M().yamlQuote(M().entityName(`Release ${name}`))}`);
      lines.push("    on_press:");
      lines.push("      - lambda: |-");
      lines.push(`          id(${LOGIC_ID}).release(${M().cppString(name)});`);
    }
  }

  // --- switch: Field logic on / off, saved across reboots. Its starting value
  // is used until it is first changed.
  function emitLogicSwitch(lines, config) {
    if (!fieldMode(config)) return;
    lines.push("  - platform: template");
    lines.push(`    id: ${SWITCH_ID}`);
    lines.push('    name: "Field logic"');
    lines.push("    optimistic: true");
    lines.push(`    restore_mode: ${config.logic?.startsOn === false ? "RESTORE_DEFAULT_OFF" : "RESTORE_DEFAULT_ON"}`);
  }

  // --- text_sensor: the version code, on the board's web page.
  function emitLogicTextSensors(lines, config) {
    if (!fieldMode(config)) return;
    lines.push("  - platform: template");
    lines.push("    id: logic_version");
    lines.push('    name: "Logic version"');
    lines.push("    entity_category: diagnostic");
    lines.push(`    lambda: 'return {"${versionCode(config)}"};'`);
  }

  // --- external_components and mr_logic: the component and its bindings.
  // Every id it names is already in the YAML.
  function emitComponent(lines, config) {
    if (!fieldMode(config)) return;
    const { yamlQuote } = M();
    const mqtt = mqttOn(config);
    lines.push("");
    lines.push("external_components:");
    lines.push(`  - source: ${LOGIC_COMPONENT_SOURCE}`);
    lines.push("    components: [mr_logic]");
    lines.push("");
    lines.push("mr_logic:");
    lines.push(`  id: ${LOGIC_ID}`);
    // Without a board name the component sends and hears nothing over MQTT.
    if (mqtt) lines.push(`  board: ${yamlQuote(config.board.name)}`);
    lines.push(`  version: "${versionCode(config)}"`);
    // A single-quoted YAML scalar: a ' inside is written twice.
    lines.push(`  table: '${logicTableJson(config).replace(/'/g, "''")}'`);
    lines.push(`  logic_switch: ${SWITCH_ID}`);
    const sensors = M().uniqueIds(config.blocks || []);
    if (sensors.length) {
      lines.push("  sensors:");
      for (const sensor of sensors) {
        lines.push(`    - name: ${yamlQuote(sensor.name)}`);
        lines.push(`      sensor: ${sensor.id}_sensor`);
        const at = sensor.expander ? (config.expanders || []).findIndex((e) => e.name === sensor.expander) : -1;
        if (at >= 0) lines.push(`      expander: ${M().expanderId(at)}`);
      }
    }
    const used = mastNamesUsed(config);
    const bound = new Set();
    const masts = [];
    for (const mast of realMastIds(config)) {
      if (!used.has(mast.name) || bound.has(mast.name) || !M().mastShows(mast)) continue;
      bound.add(mast.name);
      masts.push({ name: mast.name, id: mast.id, jmri: mqtt });
    }
    for (const mast of virtualMastIds(config)) {
      if (bound.has(mast.name)) continue;
      bound.add(mast.name);
      masts.push({ name: mast.name, id: mast.id, jmri: false });
    }
    if (masts.length) {
      lines.push("  masts:");
      for (const mast of masts) {
        lines.push(`    - name: ${yamlQuote(mast.name)}`);
        lines.push(`      aspect: ${mast.id}_aspect`);
        lines.push(`      show: ${mast.id}_show`);
        // Its mqtt_subscribe: JMRI's messages, for the hold and with logic off.
        if (mast.jmri) lines.push(`      jmri: ${mast.id}`);
      }
    }
    const points = M().uniqueIds(config.points || []);
    if (points.length) {
      const locked = lockedTurnoutNames(config);
      lines.push("  turnouts:");
      for (const point of points) {
        lines.push(`    - name: ${yamlQuote(point.name)}`);
        lines.push(`      thrown: ${point.id}_thrown`);
        lines.push(`      throw_closed: ${point.id}_throw_closed`);
        lines.push(`      throw_thrown: ${point.id}_throw_thrown`);
        if (locked.has(point.name)) lines.push(`      field_locked: ${point.id}_field_locked`);
      }
    }
    if (!mqtt) return;
    const boards = new Map();
    for (const ref of remoteRefsUsed(config)) {
      const found = resolveRemote(config, ref);
      if (!found.item) continue;
      if (!boards.has(found.board.name)) boards.set(found.board.name, { online: found.onlineId, sensors: [], blocks: [], turnouts: [], masts: [], seen: new Set() });
      const board = boards.get(found.board.name);
      const key = `${found.kind}\u0000${found.item.name}`;
      if (board.seen.has(key)) continue;
      board.seen.add(key);
      board[`${found.kind}s`].push({ name: found.item.name, id: found.id });
    }
    if (!boards.size) return;
    lines.push("  remote:");
    for (const [name, board] of boards) {
      lines.push(`    - board: ${yamlQuote(name)}`);
      lines.push(`      online: ${board.online}`);
      for (const kind of ["sensors", "blocks", "masts"]) {
        if (!board[kind].length) continue;
        lines.push(`      ${kind}:`);
        for (const item of board[kind]) {
          lines.push(`        - name: ${yamlQuote(item.name)}`);
          lines.push(`          state: ${item.id}`);
        }
      }
      if (board.turnouts.length) {
        lines.push("      turnouts:");
        for (const item of board.turnouts) {
          lines.push(`        - name: ${yamlQuote(item.name)}`);
          lines.push(`          thrown: ${item.id}_thrown`);
          lines.push(`          moving: ${item.id}_moving`);
        }
      }
    }
  }

  // --- JMRI XML, Logic box: the switch light, each Release turnout and each
  // Held sensor. The light and turnout are JMRI's way to reach the board's
  // own topics; the Release turnout takes the board's CLOSED as feedback on
  // its own topic (DIRECT), so it has no /Thrown sensor.
  function logicTopic(config, kind, rest) {
    return `trains/track/${kind}/logic/${config.board.name}${rest}`;
  }

  function jmriLights(config) {
    if (!mqttOn(config) || !fieldMode(config)) return [];
    return [{ kind: "switch", label: "Logic switch light", topic: logicTopic(config, "light", "") }];
  }

  function jmriTurnouts(config) {
    if (!mqttOn(config) || !fieldMode(config)) return [];
    return resourcesOf(config)
      .filter((res) => String(res.name || ""))
      .map((res) => ({ kind: "release", label: `Release "${res.name}"`, topic: logicTopic(config, "turnout", `/${res.name}/Release`) }));
  }

  global.EsphomeMrLogicYaml = {
    LOGIC_COMPONENT_REF,
    LOGIC_COMPONENT_SOURCE,
    logicTable,
    logicTableJson,
    versionCode,
    fieldMastNames,
    lockedTurnoutNames,
    virtualMasts,
    isBootMast,
    emitBootMast,
    emitBootWait,
    emitLogicGlobals,
    emitLogicScripts,
    emitLogicButtons,
    emitLogicSwitch,
    emitLogicTextSensors,
    emitComponent,
    jmriLights,
    jmriTurnouts,
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
    logicBlocks,
    blockMember,
    memberKey,
    renameReferences,
    blockLambda,
    emitBlocks,
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
