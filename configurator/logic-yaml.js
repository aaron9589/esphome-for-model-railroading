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
  // The Logic box's sensors as { label, topic }: the board's Online sensor
  // when it shares, and each block.
  function jmriSensors(config) {
    if (config.board?.mqttEnabled === false) return [];
    const items = [];
    if (M().sharesWithOtherBoards(config)) items.push({ kind: "online", label: "Online sensor", topic: onlineTopic(config) });
    for (const block of logicBlocks(config)) items.push({ kind: "block", label: `Block "${block.name}"`, topic: block.topic });
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
  function findRemote(config, ref) {
    const kind = remoteKind(ref);
    const board = linkedBoards(config).find((b) => b.name === ref?.board);
    if (!kind) return { problem: "is not a sensor, block or turnout" };
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

  function validate(config, errors, warnings) {
    validateLinkedBoards(config, errors, warnings);
    validateBlocks(config, errors, warnings);
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
