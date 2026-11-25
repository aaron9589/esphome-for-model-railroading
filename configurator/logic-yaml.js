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
    // An MSS Logic board is read through its builder: its blocks and signals
    // with no lights are the built ones, and its masts mean what its Signals
    // grid says.
    const mss = M_.logicMode(other) === "mss";
    const items = logicItems(other);
    const entries = list(items.masts).filter(isObject);
    const field = mss || M_.logicMode(other) === "field";
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
        blocks: pick(mss ? items.blocks : other.logic?.blocks),
        // Its sections' blocks, so a block is in sections on one board only.
        resources: field ? list(items.resources).filter(isObject).map((res) => ({
          name: String(res.name || ""),
          blocks: list(res.blocks).filter((b) => typeof b === "string" || isObject(b)),
        })) : [],
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

  // A typed item's topic follows the standard syntax. A typed mast has no
  // aspects: this board cannot know what they mean until that board's file
  // is linked, so until then it reads as stop (spec, Remote inputs).
  function typedItem(kind, name) {
    const text = String(name || "").trim();
    if (kind === "mast") return { name: text, topic: M().topicFor("signal", text), aspects: [], tags: {}, diverging: [] };
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
    // Masts: rules read them by meaning, so new aspects or meanings matter too.
    const meaningOf = (mast) => JSON.stringify([
      list(mast.aspects).map(String),
      list(mast.aspects).map((name) => (isObject(mast.tags) && Object.hasOwn(mast.tags, name) ? mast.tags[name] : "stop")),
      list(mast.diverging).map(String),
    ]);
    for (const [get, label] of [[(b) => b?.signals?.masts, "signal mast"], [(b) => b?.logic?.masts, "signal with no lights"]]) {
      const was = new Map(list(get(before)).filter(isObject).map((mast) => [mast.name, mast]));
      const now = new Map(list(get(after)).filter(isObject).map((mast) => [mast.name, mast]));
      for (const [name, mast] of now) {
        const old = was.get(name);
        if (!old) changes.push(`new ${label} "${name}"`);
        else if (old.topic !== mast.topic) changes.push(`${label} "${name}" has a new topic`);
        else if (meaningOf(old) !== meaningOf(mast)) changes.push(`${label} "${name}" has different aspects or meanings`);
      }
      for (const name of was.keys()) if (!now.has(name)) changes.push(`${label} "${name}" is gone`);
    }
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
    if (!fieldMode(config)) return [];
    return list(logicItems(config).blocks);
  }

  // The blocks with their ESPHome ids: <block>_block, beside <sensor>_sensor.
  function blockIds(config) {
    return M().uniqueIds(logicBlocks(config)).map((block) => ({ ...block, id: `${block.id}_block` }));
  }

  // One key per member, whatever order its keys were stored in.
  function memberKey(member) {
    if (typeof member === "string") return `\u0000${member}`;
    if (isObject(member) && member.end !== undefined && member.board === undefined) return `\u0000end\u0000${member.end}\u0000${member.track}`;
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
    if (member && typeof member === "object" && member.end !== undefined && member.board === undefined) {
      // What a plant end hears: the engine reads it. The block's own sensor on
      // the page has no way to see it, so it leaves it out (see blockLambda).
      const there = endTracks(config).some((t) => t.end === member.end && t.track === Number(member.track));
      if (!there) return { problem: `has what end "${member.end}" track ${member.track} hears, which is not under Plant ends. Add that end track, or remove it` };
      return { end: member };
    }
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
    // What an end hears is read by the rules (the engine hears it); this
    // block's own sensor, which JMRI sees, does not include it.
    if (found.end) return "false";
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

  // An aspect renamed on the Signal Masts page: its meaning, diverging tick
  // and stop choice under Masts move with it, and so do the rules that show
  // it. Returns how many were moved. The caller leaves it when another aspect
  // on that mast has the old or new name.
  function renameAspect(config, mastName, from, to) {
    if (from === to || !String(to || "").trim()) return 0;
    let moved = 0;
    for (const entry of list(config.logic?.masts)) {
      if (!isObject(entry) || entry.virtual === true || entry.mast !== mastName) continue;
      if (isObject(entry.tags) && Object.hasOwn(entry.tags, from)) {
        entry.tags = Object.fromEntries(Object.entries(entry.tags).map(([k, v]) => [k === from ? to : k, v]));
        moved += 1;
      }
      if (Array.isArray(entry.diverging) && entry.diverging.includes(from)) {
        entry.diverging = entry.diverging.map((name) => (name === from ? to : name));
        moved += 1;
      }
      if (entry.stopAspect === from) {
        entry.stopAspect = to;
        moved += 1;
      }
    }
    for (const layer of list(config.logic?.layers).filter(isObject)) {
      for (const rule of list(layer.rules)) {
        if (rule?.then?.mast === mastName && rule.then.aspect === from) {
          rule.then.aspect = to;
          moved += 1;
        }
      }
    }
    // MSS Logic's Signals grid names aspects too.
    moved += global.EsphomeMrMssBuilder?.renameAspect(config, mastName, from, to) || 0;
    return moved;
  }

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
    // MSS Logic names masts at block boundaries and junction legs.
    if (kind === "mast") count += global.EsphomeMrMssBuilder?.renameMast(config, from, to) || 0;
    return count;
  }

  // An end renamed on the Plant ends part: rules, blocks and pass-throughs that
  // name it follow, once the name is finished. The caller has already changed
  // the end's own name. Not when another end still has the old name, or two
  // have the new one. Returns how many references moved.
  function renameEnd(config, from, to) {
    if (typeof from !== "string" || typeof to !== "string" || !from || !to.trim() || from === to || !config?.logic) return 0;
    const names = list(config.logic.ends).filter(isObject).map((end) => end.name);
    if (names.includes(from) || names.filter((name) => name === to).length > 1) return 0;
    let count = 0;
    const walk = (value) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (!isObject(value)) return;
      if (value.end === from && value.board === undefined) {
        value.end = to;
        count += 1;
      }
      Object.values(value).forEach(walk);
    };
    for (const [key, value] of Object.entries(config.logic)) if (key !== "remoteBoards") walk(value);
    return count;
  }

  // Linked boards show only in Field Logic, so they are checked only there: a
  // problem the person cannot see must not block the download.
  function validateLinkedBoards(config, r) {
    if (M().logicMode(config) !== "field") return;
    const boards = linkedBoards(config);
    const names = new Set();
    for (const board of boards) {
      if (!board.name) r.error(LINKED, "A linked board has no name. Type its name, or remove it.");
      else if (board.name === config.board?.name) r.error(LINKED, `Linked board "${board.name}" has this board's own name. Link a different board.`);
      else if (names.has(board.name)) r.error(LINKED, `Board "${board.name}" is linked twice. Remove one.`);
      else if (board.typed && !/^[a-z0-9-]+$/.test(board.name)) {
        r.error(LINKED, `Linked board "${board.name}" is not a board name. Type it as that board shows it: lowercase letters, numbers, and dashes.`);
      }
      names.add(board.name);
      if (!board.typed) continue;
      // Typed names become MQTT topics: + and # are wildcards there, and / adds a level.
      for (const [key, label] of [["blocks", "Sensor"], ["points", "Turnout"], ["masts", "Signal"]]) {
        for (const item of (key === "masts" ? board.signals?.masts : board[key]) || []) {
          const name = String(item?.name || "");
          if (/[+#]/.test(name)) r.error(LINKED, `${label} "${name}" on linked board "${board.name}" has + or #, which MQTT topics cannot use. Type the name as that board shows it.`);
          else if (name.includes("/")) r.warn(LINKED, `${label} "${name}" on linked board "${board.name}" has a /. Check it matches that board's name exactly.`);
        }
      }
    }
    const refs = remoteRefsUsed(config);
    if (refs.length && config.board?.mqttEnabled === false) {
      r.error(LINKED, "Items from other boards need MQTT. Turn MQTT back on under Board, or use only this board's sensors.");
    }
    const notSharing = new Set();
    for (const ref of refs) {
      const found = resolveRemote(config, ref);
      const kind = remoteKind(ref);
      if (!found.item) {
        r.error(LINKED, `The ${kind || "item"} "${ref[kind] ?? "?"}" from another board ${found.problem}.`);
      } else if (!found.board.share) {
        notSharing.add(found.board.name);
      }
    }
    for (const name of notSharing) {
      r.error(LINKED, `Board "${name}" does not share with other boards, so this board cannot hear it. Tick Share on that board's Logic page, flash it, then Refresh it here.`);
    }
  }

  // --- validation: where each problem is fixed, and a reporter that keeps
  // the link beside the sentence (generator.js validateConfig's `links`).
  const logicPart = (part) => Object.freeze({ view: "logic", part });
  const SETTINGS = logicPart("logic-settings");
  const LINKED = logicPart("logic-linked");
  const BLOCKS = logicPart("logic-blocks");
  const MASTS = logicPart("logic-masts");
  const BUTTONS = logicPart("logic-buttons");
  const ENDS = logicPart("logic-ends");
  const SECTIONS = logicPart("logic-sections");
  const GROUPS = logicPart("logic-groups");
  const SIGNALS = Object.freeze({ view: "signals" });

  function reporter(errors, warnings, links) {
    const put = (into, where, text) => {
      if (!into.includes(text)) into.push(text);
      if (where && links && !links.has(text)) links.set(text, where);
    };
    return { error: (where, text) => put(errors, where, text), warn: (where, text) => put(warnings, where, text) };
  }

  // The plain word for each meaning (spec, Plain words on the page).
  const MEANING_WORDS = Object.freeze({ stop: "Stop", restricting: "Restricting", approach: "Approach", advance: "Advance Approach", clear: "Clear" });

  const quoted = (names) => names.map((name) => `"${name}"`).join(", ");

  // "rule 2 in group "Gauntlet"": how the page names a rule.
  function ruleLabel(layer, layerIndex, ruleIndex) {
    const group = String(layer?.name || "").trim();
    return `rule ${ruleIndex + 1} in group ${group ? `"${group}"` : layerIndex + 1}`;
  }

  // Every rule, with its label, in list order.
  function rulesOf(config) {
    const out = [];
    layersOf(config).forEach((layer, li) => {
      list(layer.rules).forEach((rule, ri) => {
        if (isObject(rule)) out.push({ layer, li, ri, rule, label: ruleLabel(layer, li, ri) });
      });
    });
    return out;
  }

  const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

  // This board's masts by name: { aspects, tags } for each, from the Signal
  // Masts page and the signals with no lights.
  function boardMasts(config) {
    const masts = new Map();
    for (const mast of config.signals?.masts || []) {
      if (masts.has(mast.name)) continue;
      const entry = mastEntry(config, mast.name);
      const aspects = (mast.aspects || []).map((aspect) => String(aspect.label ?? ""));
      masts.set(mast.name, { aspects, tag: (name) => aspectTag(entry, name) });
    }
    for (const entry of virtualMasts(config)) {
      const name = String(entry.name);
      if (masts.has(name)) continue;
      masts.set(name, { aspects: list(entry.aspects).map(String), tag: (aspect) => aspectTag(entry, aspect), virtual: true });
    }
    return masts;
  }

  // What a block's name can be: a block on the Logic page, or a sensor (a
  // block of one).
  function blockNames(config) {
    return new Set([...logicBlocks(config).map((b) => String(b.name || "")), ...(config.blocks || []).map((b) => String(b.name || ""))]);
  }

  const CONDITION_KINDS = ["block", "sensor", "turnout", "mast", "button", "end"];
  const IS_WORDS = Object.freeze({
    block: ["occupied", "clear"],
    sensor: ["occupied", "clear"],
    turnout: ["closed", "thrown"],
    button: ["pressed"],
  });

  // Every condition or moment in a trigger, checks list, cancel or release.
  function conditionsIn(value) {
    const found = [];
    walkObjects(value, (obj) => {
      if (CONDITION_KINDS.some((kind) => obj[kind] !== undefined)) found.push(obj);
    });
    return found;
  }

  // One condition or moment on this board: does what it names exist, and is
  // its `is` a word that item has? `who` starts the sentence.
  function checkCondition(config, r, where, who, cond, masts) {
    if (cond.board !== undefined) return; // another board's: Linked boards checks it.
    const kind = CONDITION_KINDS.find((k) => cond[k] !== undefined);
    if (kind === "end") {
      checkEndCondition(config, r, where, who, cond, masts);
      return;
    }
    const name = String(cond[kind] ?? "");
    const is = cond.is;
    if (kind === "block" || kind === "sensor") {
      const there = kind === "block" ? blockNames(config).has(name) : (config.blocks || []).some((b) => b.name === name);
      if (!there) {
        r.error(where, `${who} reads ${kind} "${name}", which is not on this board. Add it${kind === "block" ? " under Blocks" : " on the Sensors page"}, or pick another.`);
        return;
      }
    } else if (kind === "turnout") {
      if (!(config.points || []).some((p) => p.name === name)) {
        r.error(where, `${who} reads turnout "${name}", which is not on the Turnouts page. Add it, or pick another.`);
        return;
      }
    } else if (kind === "button") {
      if (!list(logicItems(config).buttons).some((b) => isObject(b) && b.name === name)) {
        r.error(where, `${who} uses button "${name}", which is not under Buttons. Add it, or pick another.`);
        return;
      }
    } else if (kind === "mast") {
      if (!masts.has(name)) {
        r.error(where, `${who} reads signal "${name}", which is not on the Signal Masts page or a signal with no lights. Add it, or pick another.`);
        return;
      }
      const words = Array.isArray(is) ? is : [is];
      const bad = words.filter((word) => !(word === "diverging" || Object.hasOwn(MEANING_WORDS, word)));
      if (!words.length || bad.length) {
        r.error(where, `${who} asks whether "${name}" shows ${bad.length ? quoted(bad.map(String)) : "nothing"}, which is not a meaning. Pick from ${Object.values(MEANING_WORDS).join(", ")} or Diverging route.`);
      }
      return;
    }
    if (!IS_WORDS[kind].includes(is)) {
      r.error(where, `${who} asks whether ${kind} "${name}" is ${is === undefined ? "anything" : `"${is}"`}. Pick ${IS_WORDS[kind].map((w) => `"${w}"`).join(" or ")}.`);
    }
  }

  // A rule reading what an end hears: { end, track, hears: "block" | "mast", is }.
  const HEARD_MAST_WORDS = ["stop", "restricting", "approach", "advance", "clear"];

  function checkEndCondition(config, r, where, who, cond) {
    const there = endTracks(config).some((t) => t.end === cond.end && t.track === Number(cond.track));
    if (!there) {
      r.error(where, `${who} reads what end "${cond.end}" track ${cond.track} hears, which is not under Plant ends. Add that end track, or pick another.`);
      return;
    }
    if (cond.hears !== "block" && cond.hears !== "mast") {
      r.error(where, `${who} reads end "${cond.end}" track ${cond.track}: pick whether it hears a block or the next signal.`);
      return;
    }
    const words = [].concat(cond.is ?? []);
    const allowed = cond.hears === "block" ? IS_WORDS.block : HEARD_MAST_WORDS;
    if (!words.length || words.some((w) => !allowed.includes(w))) {
      r.error(where, `${who} asks whether what end "${cond.end}" track ${cond.track} hears is ${words.length ? words.map((w) => `"${w}"`).join(" or ") : "anything"}. Pick ${allowed.map((w) => `"${w}"`).join(", ")}.`);
    }
  }

  // A rule button on an expander: { name, expander, pin } with pin 0-15, as a
  // sensor on one stores it. Its pin is checked with the sensors' expander pins.
  const onExpander = (button) => typeof button.expander === "string" && button.expander !== "";

  function validateButtons(config, r) {
    if (!fieldMode(config)) return;
    const names = new Set();
    for (const button of list(logicItems(config).buttons)) {
      if (!isObject(button)) continue;
      const name = String(button.name || "").trim();
      if (!name) r.error(BUTTONS, "A button has no name. Name it, or remove it.");
      else if (names.has(name)) r.error(BUTTONS, `Two buttons are called "${name}". Rename one.`);
      names.add(name);
      if (!onExpander(button) && !String(button.pin || "").trim()) r.error(BUTTONS, `Button "${name || "?"}" has no pin. Pick the pin it is wired to.`);
    }
  }

  // Rule buttons' pins, for the pin check beside every other pin: an ESP pin
  // as { name, pin: "GPIO.." }, an expander pin as { name, expander, pin }.
  function buttonPins(config) {
    if (!fieldMode(config)) return [];
    const buttons = list(logicItems(config).buttons)
      .filter((b) => isObject(b) && (onExpander(b) || String(b.pin || "").trim()))
      .map((b) => (onExpander(b)
        ? { name: String(b.name || ""), expander: b.expander, pin: b.pin, where: BUTTONS }
        : { name: String(b.name || ""), pin: String(b.pin).trim().toUpperCase(), where: BUTTONS }));
    // Plant ends' Pair and LED pins are checked beside them.
    return [...buttons, ...endPins(config)];
  }

  // A block's key across boards: (board, name). A sensor and a block on one
  // board never share a name (validateBlocks), so the kind is not needed.
  function sectionBlockKey(boardName, ref) {
    if (typeof ref === "string") return { key: `${boardName}\u0000${ref}`, name: ref, board: boardName };
    if (isObject(ref) && ref.board) {
      const kind = ["block", "sensor"].find((k) => ref[k] !== undefined);
      if (kind) return { key: `${ref.board}\u0000${ref[kind]}`, name: String(ref[kind]), board: ref.board };
    }
    return null;
  }

  // Plant ends (spec, Validation): each has a name and a track; each track has
  // end sensors and a first mast, or passes through to a track at another end,
  // without loops. Ends need MQTT and Share, because a neighbour's Online
  // topic is its birth and will message.
  function validateEnds(config, r) {
    if (!fieldMode(config)) return;
    const ends = list(logicItems(config).ends).filter(isObject);
    if (!ends.length) return;
    const masts = boardMasts(config);
    const sensors = new Set((config.blocks || []).map((b) => b.name));
    const names = new Set();
    const tracksOf = new Map();
    for (const end of ends) if (typeof end.name === "string" && end.name.trim()) tracksOf.set(end.name, list(end.tracks).length);
    if (config.board?.mqttEnabled === false) {
      r.error(ENDS, "Plant ends need MQTT, because the boards talk to each other over it. Turn MQTT back on under Board, or remove the ends.");
    } else if (!M().sharesWithOtherBoards(config)) {
      r.error(ENDS, "Plant ends need Share with other boards, because the board next door finds out that this one is on the network from what it shares. Tick Share under Settings, or remove the ends.");
    }
    for (const end of ends) {
      const name = String(end.name ?? "").trim();
      const label = name ? `End "${name}"` : "An end";
      if (!name) r.error(ENDS, "An end has no name. Name it, such as A, or remove it.");
      else if (names.has(name)) r.error(ENDS, `Two ends are called "${name}". Rename one.`);
      else if (/[/+#]/.test(name)) r.error(ENDS, `${label} has a / + or # in its name, which the board cannot send in a topic. Rename it.`);
      names.add(name);
      const tracks = list(end.tracks);
      if (!tracks.length) r.error(ENDS, `${label} has no tracks. Add a track for each track that leaves the board here.`);
      tracks.forEach((track, i) => {
        const where = `${label} track ${i + 1}`;
        if (!isObject(track)) {
          r.error(ENDS, `${where} has nothing set. Give it end sensors and a signal, or remove it.`);
          return;
        }
        for (const sensor of list(track.sensors)) {
          if (!sensors.has(sensor)) r.error(ENDS, `${where} uses sensor "${sensor}", which is not on the Sensors page. Pick another, or remove it.`);
        }
        if (isObject(track.through)) {
          const far = tracksOf.get(track.through.end);
          const number = Number(track.through.track);
          if (far === undefined) r.error(ENDS, `${where} passes through to end "${track.through.end}", which is not under Plant ends. Pick another end.`);
          else if (!Number.isInteger(number) || number < 1 || number > far) r.error(ENDS, `${where} passes through to track ${track.through.track} of end "${track.through.end}", which has ${far === 1 ? "1 track" : `${far} tracks`}. Pick another track.`);
          else if (track.through.end === name && number === i + 1) r.error(ENDS, `${where} passes through to itself. Pick another track.`);
          return;
        }
        // MSS Logic builds an end track that leads to a dead end with no first
        // signal: it offers Stop, as it should. Its own checks cover the rest.
        if (M().logicMode(config) === "mss" && typeof track.mast !== "string") return;
        if (!list(track.sensors).length) r.error(ENDS, `${where} has no end sensors. Add the sensors between the end and its first signal, or make it pass through to another end.`);
        if (typeof track.mast !== "string" || !track.mast) r.error(ENDS, `${where} has no first signal. Pick the signal facing a train coming in, or make it pass through to another end.`);
        else if (!masts.has(track.mast)) r.error(ENDS, `${where} uses signal "${track.mast}", which is not on the Signal Masts page or a signal with no lights. Pick another.`);
      });
    }
    // Pass-throughs that lead back to where they started. A track that passes
    // through from A1 to B1 is the same track as B1 back to A1 (an MSS
    // Crossover), and offers only what the far end hears from beyond, so that
    // pair is not a circle; a chain through three or more end tracks is.
    const loops = new Set();
    for (const end of ends) {
      list(end.tracks).forEach((track, i) => {
        const seen = new Set();
        let at = { end: end.name, track: i + 1 };
        for (;;) {
          const key = `${at.end}\u0000${at.track}`;
          if (seen.has(key)) {
            if (key === `${end.name}\u0000${i + 1}` && seen.size > 2) loops.add(`End "${end.name}" track ${i + 1}`);
            return;
          }
          seen.add(key);
          const next = list(ends.find((e) => isObject(e) && e.name === at.end)?.tracks)[at.track - 1];
          if (!isObject(next?.through)) return;
          at = { end: next.through.end, track: Number(next.through.track) };
        }
      });
    }
    for (const label of loops) r.error(ENDS, `${label} passes through in a circle: following its pass-throughs leads back to itself. Give one track in the circle a signal instead.`);
  }

  function validateSections(config, r) {
    if (!fieldMode(config)) return;
    const blocks = blockNames(config);
    const masts = boardMasts(config);
    const here = config.board?.name || "";
    const names = new Set();
    const owner = new Map();
    for (const res of resourcesOf(config)) {
      const name = String(res.name || "").trim();
      const label = name ? `Section "${name}"` : "A section";
      if (!name) r.error(SECTIONS, "A section has no name. Name it, or remove it.");
      else if (names.has(name)) r.error(SECTIONS, `Two sections are called "${name}". Rename one.`);
      names.add(name);
      const members = list(res.blocks);
      if (!members.length) r.error(SECTIONS, `${label} has no blocks. Add the blocks only one train may be in at a time.`);
      for (const member of members) {
        const found = sectionBlockKey(here, member);
        if (!found) continue;
        if (typeof member === "string" && !blocks.has(member)) {
          r.error(SECTIONS, `${label} has block "${member}", which is not on this board. Add it under Blocks, or remove it from the section.`);
          continue;
        }
        const other = owner.get(found.key);
        if (other && other !== name) {
          r.error(SECTIONS, `Block "${found.name}" is in sections "${other}" and "${name}". A block can be in one section only, or two trains could be let into it: remove it from one.`);
        } else owner.set(found.key, name);
      }
      if (!isObject(res.release)) {
        r.error(SECTIONS, `${label} has nothing under "Free the section when", so it would never be freed. Add one, such as its blocks clear for 3s.`);
      } else {
        for (const cond of conditionsIn(res.release)) checkCondition(config, r, SECTIONS, label, cond, masts);
      }
    }
    // Across linked boards: a block is in sections on one board only.
    for (const board of linkedBoards(config)) {
      for (const res of list(board.logic?.resources)) {
        if (!isObject(res)) continue;
        for (const member of list(res.blocks)) {
          const found = sectionBlockKey(board.name, member);
          const mine = found && owner.get(found.key);
          if (mine) {
            const where = found.board === here ? "" : ` on ${found.board}`;
            r.error(SECTIONS, `Block "${found.name}"${where} is in section "${mine}" here and in section "${res.name}" on ${board.name}. A block can be in sections on one board only, or both boards could let a train into it: remove it from one.`);
          }
        }
      }
    }
  }

  function validateMastEntries(config, r) {
    if (!fieldMode(config)) return;
    const masts = boardMasts(config);
    const blocks = blockNames(config);
    for (const entry of mastEntries(config)) {
      const name = entry.virtual === true ? String(entry.name || "") : String(entry.mast || "");
      if (entry.virtual !== true && !(config.signals?.masts || []).some((m) => m.name === name)) {
        r.error(MASTS, `Signal "${name}" under Masts is not on the Signal Masts page. Add it there, or remove it here.`);
        continue;
      }
      const mast = masts.get(name);
      if (!mast) continue;
      const aspectsNamed = [
        ...Object.keys(isObject(entry.tags) ? entry.tags : {}),
        ...list(entry.diverging).map(String),
        ...(typeof entry.stopAspect === "string" && entry.stopAspect ? [entry.stopAspect] : []),
      ];
      const missing = [...new Set(aspectsNamed.filter((aspect) => !mast.aspects.includes(aspect)))];
      if (missing.length) {
        r.error(MASTS, `Signal "${name}" has no aspect called ${quoted(missing)}, but Masts gives it a meaning. Pick from ${quoted(mast.aspects)}, or remove it.`);
      }
      if (typeof entry.approachLight === "string" && entry.approachLight && !blocks.has(entry.approachLight)) {
        r.error(MASTS, `Signal "${name}" lights up for block "${entry.approachLight}", which is not on this board. Pick another block.`);
      }
    }
  }

  function validateRules(config, r) {
    if (!fieldMode(config)) return;
    const masts = boardMasts(config);
    const sections = new Set(resourcesOf(config).map((res) => String(res.name || "")));
    const turnouts = new Set((config.points || []).map((p) => p.name));
    // For the meaning warning: mast -> meaning -> [{ group, aspect }].
    const given = new Map();
    for (const { layer, li, rule, label } of rulesOf(config)) {
      const who = capital(label);
      const trigger = rule.trigger;
      const when = isObject(trigger) && trigger.when !== undefined;
      if (!isObject(trigger) || (trigger.while === undefined && trigger.when === undefined)) {
        r.error(GROUPS, `${who} has nothing under When, so it never starts. Pick what starts it.`);
      }
      for (const cond of conditionsIn([trigger, rule.checks, rule.cancel])) checkCondition(config, r, GROUPS, who, cond, masts);
      if (when && !isObject(rule.cancel)) {
        r.warn(GROUPS, `${capital(label)} starts when something happens and has no Cancel, so once it asks, only getting what it asks for ends it. Add a Cancel if the train might not come.`);
      }
      const then = isObject(rule.then) ? rule.then : {};
      const mastName = typeof then.mast === "string" && then.mast ? then.mast : "";
      if (mastName) {
        const mast = masts.get(mastName);
        if (!mast) {
          r.error(GROUPS, `${who} sets signal "${mastName}", which is not on the Signal Masts page or a signal with no lights. Add it, or pick another.`);
        } else if (typeof then.aspect !== "string" || !then.aspect) {
          r.error(GROUPS, `${who} sets signal "${mastName}" but not what it shows. Pick an aspect.`);
        } else if (!mast.aspects.includes(then.aspect)) {
          r.error(GROUPS, `${who} shows "${then.aspect}" on "${mastName}", which has no aspect called that. Pick from ${quoted(mast.aspects)}.`);
        } else {
          const meaning = mast.tag(then.aspect);
          if (!given.has(mastName)) given.set(mastName, new Map());
          const byMeaning = given.get(mastName);
          if (!byMeaning.has(meaning)) byMeaning.set(meaning, []);
          byMeaning.get(meaning).push({ li, group: String(layer.name || li + 1), aspect: then.aspect });
        }
      } else if (typeof then.aspect === "string" && then.aspect) {
        r.error(GROUPS, `${who} shows "${then.aspect}" but names no signal. Pick the signal it sets.`);
      }
      if (then.reserve !== undefined && !sections.has(String(then.reserve))) {
        r.error(GROUPS, `${who} takes section "${then.reserve}", which is not under Sections. Add the section, or pick another.`);
      }
      for (const name of list(then.lock)) {
        if (!turnouts.has(name)) r.error(GROUPS, `${who} locks turnout "${name}", which is not on the Turnouts page. Pick another, or remove it.`);
      }
    }
    // Two groups giving different aspects with one meaning on a mast: the
    // first group's wins, which may not be what was meant.
    for (const [mastName, byMeaning] of given) {
      for (const [meaning, uses] of byMeaning) {
        const first = uses[0];
        const other = uses.find((use) => use.li !== first.li && use.aspect !== first.aspect);
        if (!other) continue;
        r.warn(GROUPS, `Signal "${mastName}" is set to "${first.aspect}" by group "${first.group}" and to "${other.aspect}" by group "${other.group}", which both mean ${MEANING_WORDS[meaning] || meaning}. When both allow it, group "${first.group}" wins. Use one aspect for each meaning if you meant the other.`);
      }
    }
  }

  // No cycles (spec, Validation): a rule cannot read, directly or through
  // other rules, a mast it sets. A rule that sets X reads the masts in its
  // trigger, checks and cancel, and in the release of the section it takes.
  // Another board's masts are left out: they are not set here.
  function mastReadsBySetter(config) {
    const releases = new Map(resourcesOf(config).map((res) => [String(res.name || ""), res.release]));
    const edges = new Map(); // set mast -> Map(read mast -> rule label)
    for (const { rule, label } of rulesOf(config)) {
      const set = rule?.then?.mast;
      if (typeof set !== "string" || !set) continue;
      const parts = [rule.trigger, rule.checks, rule.cancel];
      if (rule.then.reserve !== undefined) parts.push(releases.get(String(rule.then.reserve)));
      for (const cond of conditionsIn(parts)) {
        if (cond.board !== undefined || typeof cond.mast !== "string" || !cond.mast) continue;
        if (!edges.has(set)) edges.set(set, new Map());
        if (!edges.get(set).has(cond.mast)) edges.get(set).set(cond.mast, label);
      }
    }
    return edges;
  }

  // Each loop once, as the masts in it in the order they read each other.
  function mastCycles(config) {
    const edges = mastReadsBySetter(config);
    const cycles = [];
    const done = new Set();
    const seen = new Set();
    for (const start of edges.keys()) {
      if (done.has(start)) continue;
      // Depth first from start; a mast on the current path seen again is a loop.
      const path = [];
      const onPath = new Map();
      const visit = (mast) => {
        if (onPath.has(mast)) {
          const loop = path.slice(onPath.get(mast));
          const key = [...loop].sort().join("\u0000");
          if (!seen.has(key)) {
            seen.add(key);
            cycles.push(loop);
          }
          return;
        }
        if (done.has(mast)) return;
        onPath.set(mast, path.length);
        path.push(mast);
        for (const read of edges.get(mast)?.keys() || []) visit(read);
        path.pop();
        onPath.delete(mast);
        done.add(mast);
      };
      visit(start);
    }
    return cycles.map((loop) => loop.map((mast, i) => ({ mast, reads: loop[(i + 1) % loop.length], rule: edges.get(mast).get(loop[(i + 1) % loop.length]) })));
  }

  function validateCycles(config, r) {
    if (!fieldMode(config)) return;
    for (const loop of mastCycles(config)) {
      if (loop.length === 1) {
        const [{ mast, rule }] = loop;
        r.error(GROUPS, `${capital(rule)} sets signal "${mast}" and also reads it, so it waits on itself and may never change. Read the signal ahead instead.`);
        continue;
      }
      const steps = loop.map(({ mast, reads, rule }) => `${rule} sets "${mast}" and reads "${reads}"`).join("; ");
      r.error(GROUPS, `Signals ${quoted(loop.map((step) => step.mast))} read each other in a loop (${steps}), so each waits on the next and none may ever clear. Change one of these rules so it does not read the next signal.`);
    }
  }

  // The checker (logic-checker.js, work item 2.9), once nothing else is wrong:
  // its deadlocks are errors, the rest warnings. A link carries the Show me
  // sequence for Try it. Skipped where the checker is not loaded.
  function validateChecker(config, r, errors) {
    if (!fieldMode(config) || errors.length) return;
    const result = global.EsphomeMrLogicChecker?.checkConfig(config);
    for (const problem of list(result?.problems)) {
      const where = { ...(problem.mast ? MASTS : GROUPS), ...(problem.sequence ? { sequence: problem.sequence } : {}) };
      if (problem.level === "error") r.error(where, problem.text);
      else r.warn(where, problem.text);
    }
  }

  // Block signals (spec, Block signals): each mast checks its own block clear,
  // in order along the line. Where a mast's block and the block before it
  // share no sensor, no sensor holds both at the boundary, so the mast can
  // clear while unpowered cars are still there.
  function blockMembers(config, name) {
    const block = logicBlocks(config).find((b) => b.name === name);
    if (!block) return new Set([name]);
    return new Set(list(block.sensors).map((member) => (typeof member === "string" ? member : memberKey(member))));
  }

  function validateBlockSignals(config, r) {
    if (!fieldMode(config)) return;
    for (const layer of layersOf(config)) {
      if (layer.starter !== "block-signals") continue;
      const order = [];
      for (const rule of list(layer.rules)) {
        const mast = rule?.then?.mast;
        if (!isObject(rule) || typeof mast !== "string" || order.some((row) => row.mast === mast)) continue;
        const clearHere = (c) => isObject(c) && c.board === undefined && c.is === "clear" && (typeof c.block === "string" || typeof c.sensor === "string");
        // As the starter writes it: while the block is clear; else a clear check.
        const own = [rule.trigger?.while, ...list(rule.checks)].find(clearHere);
        if (own) order.push({ mast, block: own.block ?? own.sensor });
      }
      for (let i = 1; i < order.length; i += 1) {
        const before = order[i - 1].block;
        const { mast, block } = order[i];
        if (before === block) continue;
        const a = blockMembers(config, before);
        if ([...blockMembers(config, block)].some((member) => a.has(member))) continue;
        r.warn(GROUPS, `Signal "${mast}" protects block "${block}", which shares no sensor with "${before}", the block before it. With no sensor in both at the boundary, the signal can clear while cars that draw no power are still there. Add the boundary sensor to both blocks.`);
      }
    }
  }

  // --- validation.
  const RESERVED_PREFIXES = ["logic/", "board/"];
  const RESERVED_SUFFIXES = ["/State", "/Moving", "/Locked", "/Thrown"];

  function memberLabel(member) {
    if (typeof member === "string") return `sensor "${member}"`;
    if (isObject(member) && member.end !== undefined) return `what end ${member.end} track ${member.track} hears`;
    const kind = remoteKind(member);
    return `${REMOTE_KINDS[kind]?.label || "item"} "${member?.[kind] ?? "?"}" from ${member?.board || "another board"}`;
  }

  function validateBlocks(config, r) {
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
    for (const entry of virtualMasts(config)) entities.set(entity(String(entry.name)), `signal with no lights "${entry.name}"`);
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
      if (!name) r.error(BLOCKS, "A block has no name. Give it one, or remove it.");
      else if (names.has(entity(name))) r.error(BLOCKS, `Two blocks are called "${name}" (or nearly). Give each its own name.`);
      else if (entities.has(entity(name))) r.error(BLOCKS, `Block "${name}" has the same name as ${entities.get(entity(name))}. Rename the block.`);
      names.add(entity(name));
      const topic = String(block.topic || "").trim();
      if (!topic) r.error(BLOCKS, `${label} has no MQTT topic. Fill one in.`);
      else if (sensorTopics.has(topic)) r.error(BLOCKS, `${label} uses ${topic}, which ${sensorTopics.get(topic)} uses. Give the block its own topic.`);
      else if (reports.has(topic)) r.error(BLOCKS, `${label} uses ${topic}, where ${reports.get(topic)}. Give the block its own topic.`);
      else if (topics.has(topic)) r.error(BLOCKS, `${label} and block "${topics.get(topic)}" both use ${topic}. Give each its own topic.`);
      else topics.set(topic, name);
      const members = (block.sensors || []).filter((member) => member !== null && member !== undefined);
      if (!members.length) r.error(BLOCKS, `${label} has no sensors. Add the sensors that see a train in it.`);
      const seen = new Set();
      for (const member of members) {
        const key = memberKey(member);
        if (seen.has(key)) continue;
        seen.add(key);
        const found = blockMember(config, member);
        if (found.problem) r.error(BLOCKS, `${label} ${found.problem}.`);
        if (!uses.has(key)) uses.set(key, { member, blocks: [] });
        uses.get(key).blocks.push(name || "?");
      }
    }
    // A boundary sensor sits in the two blocks either side of it. (In MSS
    // Logic a junction's sensors are in the first block of every leg.)
    const mss = M().logicMode(config) === "mss";
    for (const { member, blocks: inBlocks } of uses.values()) {
      if (inBlocks.length > 2 && !mss) {
        const what = memberLabel(member);
        r.warn(BLOCKS, `${what[0].toUpperCase()}${what.slice(1)} is in ${inBlocks.length} blocks (${inBlocks.join(", ")}). A sensor at a boundary is in two: check the others.`);
      }
    }
  }

  // The component turns an aspect's name into the index the show script draws,
  // so each aspect of a mast logic uses needs a name of its own. A name that
  // is only a number would also change place in the table, since JSON objects
  // put those first.
  const NUMBER_NAME = /^(0|[1-9]\d*)$/;

  function validateAspectNames(names, where, error) {
    const seen = new Set();
    for (const name of names) {
      if (!name.trim()) error(`${where} has an aspect with no name. Name it, or remove it.`);
      else if (seen.has(name)) error(`${where} has two aspects called "${name}". Logic needs each aspect named once: rename one.`);
      else if (NUMBER_NAME.test(name)) error(`${where} has an aspect called "${name}", only a number. Give it a name with a letter in it.`);
      seen.add(name);
    }
  }

  function validateLogicMasts(config, r) {
    if (!fieldMode(config)) return;
    const used = mastNamesUsed(config);
    const real = new Set();
    for (const mast of config.signals?.masts || []) {
      real.add(mast.name);
      if (!used.has(mast.name)) continue;
      const where = `Signal mast "${mast.name}"`;
      // An aspect with no JMRI string is already an error on every mast.
      validateAspectNames((mast.aspects || []).map((aspect) => String(aspect.label ?? "")), where, (text) => r.error(SIGNALS, text));
    }
    const field = fieldMastNames(config);
    // Fail safe: a signal logic sets falls back to its stop aspect at start-up,
    // when no rule applies and when JMRI holds it. With no aspect meaning Stop
    // that would be some other aspect, perhaps Clear.
    for (const name of field) {
      const mast = (config.signals?.masts || []).find((m) => m.name === name);
      const entry = mast ? mastEntry(config, name) : mastEntries(config).find((e) => e.virtual === true && e.name === name);
      const aspects = mast ? (mast.aspects || []).map((a) => String(a.label ?? "")) : list(entry?.aspects).map(String);
      if (!aspects.length || aspects.some((aspect) => aspectTag(entry, aspect) === "stop")) continue;
      r.error(MASTS, `Signal "${name}" has no aspect that means Stop, so it would show one of its other aspects at start-up, when no rule applies, and when JMRI holds it. Give one of its aspects the meaning Stop under Masts.`);
    }
    const names = new Set();
    for (const entry of mastEntries(config)) {
      if (entry.virtual !== true) continue;
      const name = String(entry.name || "").trim();
      if (!name) {
        r.error(MASTS, "A signal with no lights has no name. Name it, or remove it.");
        continue;
      }
      const where = `Signal with no lights "${name}"`;
      if (real.has(name)) r.error(MASTS, `${where} has the name of a signal mast on the Signal Masts page. Rename it.`);
      else if (names.has(name)) r.error(MASTS, `Two signals with no lights are called "${name}". Rename one.`);
      names.add(name);
      if (!list(entry.aspects).length) r.error(MASTS, `${where} has no aspects. Add the aspects rules show on it.`);
      validateAspectNames(list(entry.aspects).map(String), where, (text) => r.error(MASTS, text));
      if (!field.has(name)) r.error(MASTS, `${where} is not set by any rule, so it would always show Stop. Add a rule that sets it, or remove it.`);
    }
  }

  // --- MSS Logic (mss-builder.js, work item 4.1). Its own checks come first,
  // each pointing at the part of the description that caused it. Only when
  // those find no error do the checks above run over the built items, and a
  // problem with a built item then points back at the part that made it.
  const MSS_PARTS = Object.freeze({ "logic-blocks": "tracks", "logic-groups": "tracks", "logic-masts": "signals", "logic-ends": "ends" });
  const MSS_KINDS = Object.freeze({ block: "block", signal: "mast", lights: "mast", group: "group" });

  function mssReporter(config, r) {
    const builder = global.EsphomeMrMssBuilder;
    const origins = list(logicItems(config).origins);
    const find = (kind, name) => origins.find((o) => o.name === name && (!kind || o.kind === kind));
    const map = (where, text) => {
      if (where?.view !== "logic" || !MSS_PARTS[where.part]) return [where, text];
      // The first built item the sentence names, by the word before it.
      for (const [, word, name] of text.matchAll(/(\w+)\s+"([^"]*)"/g)) {
        const origin = find(MSS_KINDS[word.toLowerCase()], name) || find(null, name);
        if (origin) return [origin.where, `${text} ${builder.TEXT.madeFrom(origin.words)}`];
      }
      return [{ view: "logic", part: builder.PARTS[MSS_PARTS[where.part]] }, text];
    };
    return {
      error: (where, text) => r.error(...map(where, text)),
      warn: (where, text) => r.warn(...map(where, text)),
    };
  }

  function validate(config, errors, warnings, links) {
    const base = reporter(errors, warnings, links);
    const mss = M().logicMode(config) === "mss";
    let r = base;
    let checkBuilt = true;
    if (mss) {
      const found = global.EsphomeMrMssBuilder ? global.EsphomeMrMssBuilder.problems(config) : [];
      for (const problem of found) (problem.level === "error" ? base.error : base.warn)(problem.where, problem.text);
      checkBuilt = !found.some((problem) => problem.level === "error");
      if (checkBuilt) r = mssReporter(config, base);
    }
    if (checkBuilt) {
      validateLinkedBoards(config, r);
      validateBlocks(config, r);
      validateLogicMasts(config, r);
      validateMastEntries(config, r);
      validateButtons(config, r);
      validateEnds(config, r);
      validateSections(config, r);
      validateRules(config, r);
      validateCycles(config, r);
      // MSS Logic warns about a boundary with no sensor itself. The checker
      // runs on its built rules too (work item 4.5): its plant ends are
      // inputs (3.4), and parts keep a busy junction module within budget.
      if (!mss) validateBlockSignals(config, r);
      validateChecker(config, r, errors);
    }
    const shares = M().sharesWithOtherBoards(config);
    const active = shares || M().logicMode(config) !== "none";
    if (!active) return;
    if (shares && config.board?.mqttEnabled === false) {
      r.error(SETTINGS, "Share with other boards needs MQTT. Turn MQTT back on under Board, or untick Share on the Logic page.");
    }
    const named = [
      ...(config.blocks || []).map((item) => ["Sensor", item, { view: "blocks" }]),
      ...(config.points || []).map((item) => ["Turnout", item, { view: "points" }]),
      ...logicBlocks(config).map((item) => ["Block", item, BLOCKS]),
    ];
    for (const [kind, item, where] of named) {
      const name = String(item.name || "").trim();
      const prefix = RESERVED_PREFIXES.find((p) => name.toLowerCase().startsWith(p));
      if (prefix) r.error(where, `${kind} "${name}" starts with ${prefix}, which board topics use. Rename it.`);
      const suffix = RESERVED_SUFFIXES.find((s) => name.toLowerCase().endsWith(s.toLowerCase()));
      if (suffix) r.error(where, `${kind} "${name}" ends with ${suffix}, which shared topics use. Rename it.`);
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
      if (what) r.error({ view: "blocks" }, `Sensor "${block.name}" uses ${block.topic}, where the board sends ${what}. Rename the sensor.`);
    }
    for (const block of logicBlocks(config)) {
      const what = published.get(block.topic);
      if (what) r.error(BLOCKS, `Block "${block.name}" uses ${block.topic}, where the board sends ${what}. Rename the block.`);
    }
    for (const mast of masts) {
      const what = published.get(mast.topic);
      if (what) r.error(SIGNALS, `Signal mast "${mast.name}" uses ${mast.topic}, where the board sends ${what}. Rename the mast.`);
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

  // The board runs the engine: Field Logic, or MSS Logic, whose description
  // is built into the same items (mss-builder.js), so everything below reads
  // them through logicItems and generates them the same way.
  const fieldMode = (config) => ["field", "mss"].includes(M().logicMode(config));
  const mqttOn = (config) => config.board?.mqttEnabled !== false;
  const list = (value) => (Array.isArray(value) ? value : []);
  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

  // The items the engine runs: the Logic page's for Field Logic (and None),
  // the built ones for MSS Logic. Built items are never stored; they are
  // built again from `logic.mss` whenever it, or the masts it reads, change.
  let built = { key: null, items: null };
  function logicItems(config) {
    if (M().logicMode(config) !== "mss") return isObject(config?.logic) ? config.logic : {};
    const builder = global.EsphomeMrMssBuilder;
    if (!builder) {
      if (!isObject(config.logic.mss)) return {};
      throw new Error("This board uses MSS Logic, but mss-builder.js is not loaded.");
    }
    const key = JSON.stringify([
      config.logic.mss ?? null,
      list(config.signals?.masts).map((mast) => [mast?.name, list(mast?.aspects).map((aspect) => [aspect?.label, aspect?.states])]),
    ]);
    if (built.key !== key) built = { key, items: builder.build(config) };
    return built.items;
  }

  function layersOf(config) {
    return list(logicItems(config).layers).filter(isObject);
  }

  function resourcesOf(config) {
    return list(logicItems(config).resources).filter(isObject);
  }

  // Masts entries: { mast } for a mast on the Signal Masts page, or
  // { virtual: true, name, topic, aspects, tags } for a signal with no lights.
  function mastEntries(config) {
    return list(logicItems(config).masts).filter(isObject);
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
    for (const end of endsOf(config)) {
      for (const track of list(end.tracks)) if (isObject(track) && typeof track.mast === "string" && track.mast) names.add(track.mast);
    }
    return names;
  }

  // Plant ends (spec, Plant ends): this board's own, as stored (as built, in
  // MSS Logic). An end with no name is skipped.
  function endsOf(config) {
    if (!fieldMode(config)) return [];
    return list(logicItems(config).ends).filter((end) => isObject(end) && typeof end.name === "string" && end.name.trim());
  }

  // Every track of this board's ends, as { end, track, tracks }: track from 1.
  function endTracks(config) {
    return endsOf(config).flatMap((end) => list(end.tracks).map((_, i) => ({ end: end.name, track: i + 1, tracks: list(end.tracks).length })));
  }

  // An end's Pair or LED pin: { pin: "GPIO32" } on the ESP, or { expander, pin }
  // on an expander (pin 0-15), stored as pairPin / ledPin with pairExpander /
  // ledExpander beside it. null when none.
  function endPin(end, which) {
    const expander = end[`${which}Expander`];
    const pin = end[`${which}Pin`];
    if (typeof expander === "string" && expander) return { expander, pin };
    const text = String(pin ?? "").trim().toUpperCase();
    return text ? { pin: text } : null;
  }

  // The ends' pins for the pin checks, in the shape buttonPins gives rule buttons.
  function endPins(config) {
    const out = [];
    for (const end of endsOf(config)) {
      for (const [which, kind, label] of [["pair", "pair", "Pair button"], ["led", "led", "LED"]]) {
        const pin = endPin(end, which);
        if (!pin) continue;
        const what = `${label} on end ${end.name}`;
        out.push({ name: what, label: `${label} of end "${end.name}"`, owner: what, kind, where: ENDS, ...pin });
      }
    }
    return out;
  }

  // Each end with its id: end_<name>, numbered if two names make the same id.
  function endIds(config) {
    const ends = endsOf(config);
    const ids = M().uniqueIds(ends.map((end) => ({ name: `end ${end.name}` })));
    return ends.map((end, i) => ({ ...end, id: ids[i].id }));
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
    // The engine reads an end's name and tracks. Its pins are for the board.
    const ends = endsOf(config).map((end) => ({ name: end.name, tracks: sorted(list(end.tracks)) }));
    if (ends.length) logic.ends = ends;
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

  // --- The component is on the board (Field Logic): it runs the turnouts'
  // re-sync, so the Lock topic's UNLOCKED handler only clears the flag.
  function hasComponent(config) {
    return fieldMode(config);
  }

  // --- binary_sensor: a rule-locked turnout's lock report. The field lock is
  // a global the component writes, so this follows both flags and publishes
  // the report on each change, retained like the Remote lock's. On connect
  // sends it too, so a change before the broker was up is not lost.
  function emitLockReports(lines, config) {
    if (!mqttOn(config)) return;
    const locked = lockedTurnoutNames(config);
    for (const point of M().uniqueIds(config.points || [])) {
      if (!locked.has(point.name)) continue;
      const flags = M().lockFlags(config, point, true);
      lines.push("  - platform: template");
      lines.push(`    id: ${point.id}_lock_report`);
      lines.push("    internal: true");
      lines.push(`    lambda: 'return ${flags.join(" || ")};'`);
      lines.push("    on_state:");
      lines.push("      then:");
      publish(lines, "        ", M().lockedTopic(point.topic), [`return x ? "ACTIVE" : "INACTIVE";`]);
    }
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
    emitEndButtons(lines, config);
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
    emitEndLeds(lines, config);
  }

  // --- text_sensor: the version code, on the board's web page.
  function emitLogicTextSensors(lines, config) {
    if (!fieldMode(config)) return;
    lines.push("  - platform: template");
    lines.push("    id: logic_version");
    lines.push('    name: "Logic version"');
    lines.push("    entity_category: diagnostic");
    lines.push(`    lambda: 'return {"${versionCode(config)}"};'`);
    emitEndTextSensors(lines, config);
  }

  // --- Plant ends: each end's Link text entity (saved across reboots), its
  // Pair button on the web page and on an optional pin, its LED and its state.
  // The component does everything else.
  function emitEndTexts(lines, config) {
    const ends = endIds(config);
    if (!ends.length) return;
    lines.push("");
    lines.push("text:");
    for (const end of ends) {
      lines.push("  - platform: template");
      lines.push(`    id: ${end.id}_link`);
      lines.push(`    name: ${M().yamlQuote(M().entityName(`End ${end.name} link`))}`);
      lines.push("    mode: text");
      lines.push("    max_length: 64");
      lines.push("    optimistic: true");
      lines.push("    restore_value: true");
    }
  }

  function emitEndTextSensors(lines, config) {
    for (const end of endIds(config)) {
      lines.push("  - platform: template");
      lines.push(`    id: ${end.id}_state`);
      lines.push(`    name: ${M().yamlQuote(M().entityName(`End ${end.name} state`))}`);
    }
  }

  function emitEndButtons(lines, config) {
    for (const end of endIds(config)) {
      lines.push("  - platform: template");
      lines.push(`    name: ${M().yamlQuote(M().entityName(`Pair End ${end.name}`))}`);
      lines.push("    on_press:");
      lines.push("      - lambda: |-");
      lines.push(`          id(${LOGIC_ID}).pair(${M().cppString(end.name)});`);
    }
  }

  // binary_sensor: the optional Pair push button, wired to GND like a turnout's.
  function emitEndSensors(lines, config) {
    for (const end of endIds(config)) {
      const pin = endPin(end, "pair");
      if (!pin) continue;
      lines.push("  - platform: gpio");
      lines.push("    pin:");
      const hub = expanderHub(config, pin);
      if (hub) lines.push(`      mcp23xxx: ${hub}`);
      lines.push(`      number: ${hub ? Number(pin.pin) : pin.pin}`);
      lines.push("      inverted: true");
      lines.push("      mode:");
      lines.push("        input: true");
      lines.push("        pullup: true");
      lines.push(`    id: ${end.id}_pair_pin`);
      lines.push(`    name: ${M().yamlQuote(M().entityName(`End ${end.name} pair button`))}`);
      lines.push("    internal: true");
      lines.push("    filters:");
      lines.push("      - delayed_on: 50ms");
      lines.push("    on_press:");
      lines.push("      - lambda: |-");
      lines.push(`          id(${LOGIC_ID}).pair(${M().cppString(end.name)});`);
    }
  }

  // The ESPHome id of the expander an end pin is on, or "" (an ESP pin, or an
  // expander that is not there, which validation reports).
  function expanderHub(config, pin) {
    const at = pin.expander ? (config.expanders || []).findIndex((e) => e.name === pin.expander) : -1;
    return at >= 0 ? M().expanderId(at) : "";
  }

  // switch: the optional LED, which the component drives.
  function emitEndLeds(lines, config) {
    for (const end of endIds(config)) {
      const pin = endPin(end, "led");
      if (!pin) continue;
      lines.push("  - platform: gpio");
      const hub = expanderHub(config, pin);
      if (hub) {
        // An MCP23017 pin can drive an LED: ESPHome's mcp23xxx pins take mode output.
        lines.push("    pin:");
        lines.push(`      mcp23xxx: ${hub}`);
        lines.push(`      number: ${Number(pin.pin)}`);
        lines.push("      mode:");
        lines.push("        output: true");
      } else {
        lines.push(`    pin: ${pin.pin}`);
      }
      lines.push(`    id: ${end.id}_led`);
      lines.push(`    name: ${M().yamlQuote(M().entityName(`End ${end.name} LED`))}`);
      lines.push("    internal: true");
    }
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
        // The component watches the remote lock too, and runs the re-sync
        // when the two together go from locked to unlocked.
        const remote = mqtt && point.lockEnabled === true;
        if (remote) lines.push(`      remote_locked: ${point.id}_locked`);
        const latch = M().latchIndex(point);
        if (latch >= 0 && (remote || locked.has(point.name))) lines.push(`      resync: ${point.id}_latch_${latch + 1}`);
      }
    }
    const ends = endIds(config);
    if (ends.length) {
      lines.push("  ends:");
      for (const end of ends) {
        lines.push(`    - name: ${yamlQuote(end.name)}`);
        lines.push(`      link: ${end.id}_link`);
        if (endPin(end, "led")) lines.push(`      led: ${end.id}_led`);
        lines.push(`      state: ${end.id}_state`);
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
    hasComponent,
    emitLockReports,
    buttonPins,
    endTracks,
    endPin,
    endPins,
    renameEnd,
    mastCycles,
    emitLogicScripts,
    emitLogicButtons,
    emitLogicSwitch,
    emitLogicTextSensors,
    emitEndTexts,
    emitEndSensors,
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
    logicItems,
    endsOf,
    blockMember,
    memberKey,
    renameReferences,
    renameAspect,
    mastNamesUsed,
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
