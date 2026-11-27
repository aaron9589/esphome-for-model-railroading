// The Logic page (docs/field-logic-spec.md, The Logic page). Loaded after
// generator.js and before app.js, which calls renderLogicPage on every render.
//
// Every word the page shows is in TEXT, so test/logic-page.test.js can check that
// none of the spec-only terms (scan, latch, layer, resource, ...) reach the page.
(function (global) {
  // Parts of the page that later releases of the implementation plan switch on.
  // Hidden parts are not shown and their settings are not offered.
  const FEATURES = Object.freeze({
    startsOn: false, // Release 2: logic starts on / off
    tryIt: true, // Release 2: the Try it part and the checklist's Try it step
    mss: true, // Release 4: MSS Logic in the mode list
  });

  const TEXT = Object.freeze({
    modeCard: "Logic",
    modeLabel: "Logic",
    modeHint: "You can change this at any time. Switching keeps what you have set up here.",
    modes: Object.freeze({
      none: Object.freeze({
        label: "None",
        about: "JMRI or CATS sets every signal on this board, as it does today.",
      }),
      field: Object.freeze({
        label: "Field Logic",
        about: "This board decides its own signals from rules you build on this page, so they keep working when JMRI is closed. Signals that no rule sets stay with JMRI or CATS.",
      }),
      mss: Object.freeze({
        label: "MSS Logic",
        about: "This board behaves like an MSS module: describe its tracks and signals, and it works the signals out with no rules to write.",
      }),
    }),
    settingsCard: "Settings",
    shareLabel: "Share with other boards",
    shareHint: "Publishes this board's sensors, turnouts and signals so other boards can read them. On by default in Field Logic. Tick it on a board with no logic too, so its neighbours can see it.",
    shareAlwaysOn: "Always on in MSS Logic: neighbouring boards read it.",
    startsOnLabel: "Logic on at start-up",
    startsOnHint: "Off hands the signals back to JMRI or CATS. The board also has a Logic on / off switch.",
    checklistTitle: "Next steps",
    steps: Object.freeze({
      mode: "Choose how this board decides its signals",
      blocks: "Add blocks and signals",
      ends: "Describe the module's ends",
      tracks: "Draw the tracks",
      junctions: "Add the junctions, if there are any",
      signals: "Pick each signal's aspects",
      tryIt: "Try it",
      download: "Download",
    }),
    stepDone: "Done",
    stepNext: "Next",
    linkedCard: "Linked boards",
    linkedIntro: "Other boards whose sensors, turnouts and signals this board can read over MQTT. Link a board's board.yaml, or type its name. Those boards need Share with other boards ticked.",
    linkFile: "Link a board's file",
    linkTyped: "Type a board's name",
    linkedEmpty: "No linked boards.",
    fromFile: "From its file",
    typed: "Typed",
    refresh: "Refresh",
    refreshHint: "Pick the board's file again after it changes.",
    remove: "Remove",
    boardNameLabel: "Board name",
    boardNameHint: "Exactly as that board is named, suffix included, such as kiama-north-k7m4x2.",
    typedSensorsLabel: "Sensors on that board",
    typedSensorsHint: "One name per line, as on that board's Sensors page. Each is read from trains/track/sensor/<name>/State.",
    typedTurnoutsLabel: "Turnouts on that board",
    typedTurnoutsHint: "One name per line, as on that board's Turnouts page.",
    typedMastsLabel: "Signals on that board",
    typedMastsHint: "One name per line, as on that board's Signal Masts page. Until you link that board's file, each reads as Stop here, because this board cannot tell what its aspects mean. Link its file with Link a board's file to read them.",
    notSharing: "This board does not share, so nothing of it can be heard here. Tick Share with other boards on its Logic page, flash it, then Refresh.",
    linkedOwn: "That is this board's own file. Link a different board.",
    linkedAdded: (name) => `Linked ${name}.`,
    refreshWrongBoard: (expected, got) => `That file is ${got}, not ${expected}. Pick ${expected}'s file to refresh it.`,
    linkedNoChange: (name) => `${name}: no changes.`,
    linkedChanged: (name, changes) => `${name} has changed: ${changes.join("; ")}.`,
    blocksCard: "Blocks",
    blocksIntro: "A block is a stretch of track, made of the sensors that see a train in it: usually its current sensor, plus the optical sensor at each end. It reads occupied while any of its sensors does. An optical sensor at a boundary goes in the blocks on both sides of it.",
    blocksIntro2: "JMRI and CATS see each block as one more sensor. A sensor from another board counts as occupied until that board is heard from.",
    blocksEmpty: "No blocks yet.",
    addBlock: "Add a block",
    newBlockName: (n) => `Block ${n}`,
    blockNameLabel: "Name",
    blockNameHint: "Name in JMRI and the logs. The topic is filled in from this.",
    blockTopicLabel: "MQTT topic",
    blockTopicHint: "Where this block reports occupied or clear, like a sensor.",
    membersLabel: "Sensors in this block",
    membersEmpty: "No sensors yet. Add the sensors that see a train in this block.",
    addMember: "Add a sensor…",
    thisBoard: "This board",
    remoteSensor: (board, name) => `${name} (from ${board})`,
    remoteBlock: (board, name) => `Block ${name} (from ${board})`,
    memberMissing: "not found",
    endsGroup: "What an end hears",
    endBlock: (end, track) => `Block heard at end ${end}, track ${track}`,
    endMast: (end, track) => `Next signal heard at end ${end}, track ${track}`,
    endMember: (end, track) => `What end ${end}, track ${track} hears`,
    endMemberHint: "A block can include what an end hears, so it reaches across the joint. JMRI's copy of the block is made of this board's sensors only.",
    noSensorsYet: "Add sensors on the Sensors page, or link a board, then pick them here.",
    linkedCounts: (sensors, turnouts, blocks, masts = 0) => [
      `${sensors} sensor${sensors === 1 ? "" : "s"}`,
      `${turnouts} turnout${turnouts === 1 ? "" : "s"}`,
      ...(blocks ? [`${blocks} block${blocks === 1 ? "" : "s"}`] : []),
      `${masts} signal${masts === 1 ? "" : "s"}`,
    ].join(", "),
  });

  function modeChoices() {
    return ["none", "field", ...(FEATURES.mss ? ["mss"] : [])];
  }

  // The checklist: each step, whether it is done, and where it links.
  function checklistSteps(config, parts) {
    const mode = global.EsphomeMr.logicMode(config);
    const steps = [{ key: "mode", done: mode !== "none", target: "logic-mode" }];
    // Blocks, and a group of rules that sets the signals.
    if (parts.blocks) {
      // Or a track plan with a signal on it.
      const drawn = list(config.logic?.plan?.breaks).some((brk) => list(brk?.signals).length > 0);
      const done = drawn || ((config.logic?.blocks || []).length > 0 && (config.logic?.layers || []).length > 0);
      steps.push({ key: "blocks", done, target: "logic-blocks" });
    }
    if (FEATURES.tryIt && parts.blocks) steps.push({ key: "tryIt", done: false, target: "logic-try" });
    if (mode === "mss") {
      // The module's description, one step for each part (spec: A guided setup).
      const mss = global.EsphomeMrMssBuilder;
      const described = config.logic?.mss || {};
      const placed = (key) => Array.isArray(described[key]) && described[key].length > 0;
      steps.push({ key: "ends", done: placed("ends"), target: mss.PARTS.ends });
      steps.push({ key: "tracks", done: placed("tracks"), target: mss.PARTS.tracks });
      steps.push({ key: "junctions", done: placed("junctions"), target: mss.PARTS.junctions });
      steps.push({ key: "signals", done: placed("masts"), target: mss.PARTS.signals });
      if (FEATURES.tryIt && parts.tryIt) steps.push({ key: "tryIt", done: false, target: "logic-try" });
    }
    steps.push({ key: "download", done: false, view: "yaml" });
    return steps;
  }

  // Draw the page again, keeping focus on the control that changed.
  function rerender(ctx, selector) {
    ctx.render();
    document.querySelector(selector)?.focus();
  }

  function card(id, title) {
    const section = document.createElement("div");
    section.className = "card";
    if (id) section.id = id;
    const h3 = document.createElement("h3");
    h3.textContent = title;
    section.append(h3);
    return section;
  }

  function renderChecklist(root, config, ctx, parts) {
    const steps = checklistSteps(config, parts);
    const next = steps.find((step) => !step.done);
    const list = document.createElement("ol");
    list.className = "logic-checklist";
    for (const step of steps) {
      const item = document.createElement("li");
      item.classList.toggle("is-done", step.done);
      item.classList.toggle("is-next", step === next);
      const link = document.createElement("a");
      link.href = `#${step.target || step.view}`;
      link.textContent = TEXT.steps[step.key];
      if (step.target?.startsWith("logic-mss-")) global.EsphomeMrLogicUiMssMarks?.mark(link, { part: step.target });
      link.addEventListener("click", (event) => {
        event.preventDefault();
        if (step.view) ctx.showView(step.view);
        else document.getElementById(step.target)?.scrollIntoView({ block: "start" });
      });
      const status = document.createElement("span");
      status.className = "step-status";
      status.textContent = step.done ? TEXT.stepDone : step === next ? TEXT.stepNext : "";
      item.append(link, status);
      list.append(item);
    }
    const box = document.createElement("nav");
    box.className = "card logic-steps";
    box.setAttribute("aria-label", TEXT.checklistTitle);
    const h3 = document.createElement("h3");
    h3.textContent = TEXT.checklistTitle;
    box.append(h3, list);
    root.append(box);
  }

  function renderMode(root, config, ctx) {
    const mode = global.EsphomeMr.logicMode(config);
    const section = card("logic-mode", TEXT.modeCard);
    const fields = document.createElement("div");
    fields.className = "fields";
    const choices = modeChoices();
    if (!choices.includes(mode)) choices.push(mode);
    fields.append(ctx.field(TEXT.modeLabel, mode, (value) => {
      const logic = config.logic || (config.logic = {});
      if (value === "none") delete logic.mode;
      else logic.mode = value;
      ctx.persist();
      rerender(ctx, "#logic-mode select");
    }, {
      select: choices.map((key) => ({ value: key, label: TEXT.modes[key].label })),
      hint: TEXT.modeHint,
      full: true,
    }));
    const about = document.createElement("p");
    about.className = "card-copy logic-mode-about";
    about.textContent = TEXT.modes[mode].about;
    fields.append(about);
    section.append(fields);
    root.append(section);
  }

  function renderSettings(root, config, ctx) {
    const mode = global.EsphomeMr.logicMode(config);
    const section = card("logic-settings", TEXT.settingsCard);
    const fields = document.createElement("div");
    fields.className = "fields";
    if (mode === "mss") {
      fields.append(ctx.hintEl(TEXT.shareAlwaysOn));
    } else {
      const share = ctx.field(TEXT.shareLabel, global.EsphomeMr.sharesWithOtherBoards(config), (checked) => {
        const logic = config.logic || (config.logic = {});
        logic.share = checked;
        ctx.persist();
        rerender(ctx, "#logic-share");
      }, { checkbox: true, hint: TEXT.shareHint });
      share.querySelector("input").id = "logic-share";
      fields.append(share);
    }
    if (FEATURES.startsOn && mode !== "none") {
      fields.append(ctx.field(TEXT.startsOnLabel, config.logic?.startsOn !== false, (checked) => {
        config.logic.startsOn = checked;
        ctx.persist();
        ctx.render();
      }, { checkbox: true, hint: TEXT.startsOnHint }));
    }
    section.append(fields);
    root.append(section);
  }

  // Read a board.yaml the person picks, as a linked board snapshot.
  function pickBoardFile(onBoard, ctx) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".yaml,.yml,text/yaml,text/plain";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const other = global.EsphomeMr.parseConfigFromYaml(await file.text());
        onBoard(global.EsphomeMrLogicYaml.linkedBoardFromConfig(other));
      } catch (err) {
        ctx.flash("err", err.message || String(err));
      }
    });
    input.click();
  }

  // Add or refresh a linked board from its file, saying what changed.
  // `expected` is the board being refreshed: a file for another board is refused.
  function takeLinkedBoard(config, ctx, snapshot, expected) {
    const L = global.EsphomeMrLogicYaml;
    if (expected !== undefined && snapshot.name !== expected) {
      ctx.flash("err", TEXT.refreshWrongBoard(expected, snapshot.name));
      return;
    }
    if (snapshot.name === config.board.name) {
      ctx.flash("err", TEXT.linkedOwn);
      return;
    }
    const logic = config.logic || (config.logic = {});
    const boards = logic.remoteBoards || (logic.remoteBoards = []);
    const at = boards.findIndex((board) => board.name === snapshot.name);
    if (at < 0) {
      boards.push(snapshot);
      ctx.flash("ok", TEXT.linkedAdded(snapshot.name));
    } else {
      const changes = L.linkedBoardChanges(boards[at], snapshot);
      boards[at] = snapshot;
      ctx.flash(changes.length ? "err" : "ok", changes.length ? TEXT.linkedChanged(snapshot.name, changes) : TEXT.linkedNoChange(snapshot.name));
    }
    ctx.persist();
    ctx.render();
  }

  // Point references at a typed board's new name. Not when another linked
  // board still has the old name: those references are that board's.
  function renameLinkedRefs(config, board, from, to) {
    if (from === to) return;
    if ((config.logic?.remoteBoards || []).some((other) => other !== board && other.name === from)) return;
    // Block members, and every { board, ... } in groups and sections.
    const visit = (value) => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!isObject(value)) return;
      if (value.board === from) value.board = to;
      Object.values(value).forEach(visit);
    };
    visit([config.logic?.blocks, config.logic?.layers, config.logic?.resources, config.logic?.plan]);
  }

  function namesFrom(text) {
    return [...new Set(String(text).split("\n").map((line) => line.trim()).filter(Boolean))];
  }

  function renderLinkedBoard(list, board, index, config, ctx) {
    const L = global.EsphomeMrLogicYaml;
    const item = document.createElement("div");
    item.className = "row-card";
    const header = document.createElement("header");
    const title = document.createElement("h3");
    title.textContent = board.name || TEXT.typed;
    const badge = document.createElement("span");
    badge.className = "linked-source";
    badge.textContent = board.typed ? TEXT.typed : TEXT.fromFile;
    title.append(" ", badge);
    const actions = document.createElement("div");
    actions.className = "row-actions";
    if (!board.typed) {
      const refresh = document.createElement("button");
      refresh.type = "button";
      refresh.textContent = TEXT.refresh;
      refresh.title = TEXT.refreshHint;
      refresh.addEventListener("click", () => pickBoardFile((snapshot) => takeLinkedBoard(config, ctx, snapshot, board.name), ctx));
      actions.append(refresh);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = TEXT.remove;
    remove.addEventListener("click", () => {
      config.logic.remoteBoards.splice(index, 1);
      ctx.persist();
      ctx.render();
    });
    actions.append(remove);
    header.append(title, actions);
    item.append(header);

    const fields = document.createElement("div");
    fields.className = "fields";
    const counts = document.createElement("p");
    counts.className = "card-copy full";
    const mastCount = (Array.isArray(board.signals?.masts) ? board.signals.masts.length : 0) + (Array.isArray(board.logic?.masts) ? board.logic.masts.length : 0);
    counts.textContent = TEXT.linkedCounts((board.blocks || []).length, (board.points || []).length, (board.logic?.blocks || []).length, mastCount);
    fields.append(counts);
    if (!board.share) {
      const warn = document.createElement("p");
      warn.className = "linked-warning full";
      warn.textContent = TEXT.notSharing;
      fields.append(warn);
    }
    if (board.typed) {
      // References follow the name once it is finished (change), not on every
      // key: a half-typed name can pass through another linked board's name.
      const nameAtRender = board.name;
      const nameField = ctx.field(TEXT.boardNameLabel, board.name, (value) => {
        board.name = value.trim();
        title.firstChild.textContent = board.name || TEXT.typed;
        ctx.persist();
      }, { hint: TEXT.boardNameHint, full: true, spellcheck: false });
      nameField.querySelector("input").addEventListener("change", () => {
        renameLinkedRefs(config, board, nameAtRender, board.name);
        ctx.persist();
        ctx.render();
      });
      fields.append(nameField);
      // A typed mast goes with the board's Signal Masts page masts.
      const signals = (b) => (b.signals && typeof b.signals === "object" ? b.signals : (b.signals = {}));
      for (const [get, set, kind, label, hint] of [
        [(b) => b.blocks, (b, items) => { b.blocks = items; }, "sensor", TEXT.typedSensorsLabel, TEXT.typedSensorsHint],
        [(b) => b.points, (b, items) => { b.points = items; }, "turnout", TEXT.typedTurnoutsLabel, TEXT.typedTurnoutsHint],
        [(b) => b.signals?.masts, (b, items) => { signals(b).masts = items; }, "mast", TEXT.typedMastsLabel, TEXT.typedMastsHint],
      ]) {
        const wrap = document.createElement("label");
        wrap.className = "full";
        const span = document.createElement("span");
        span.className = "field-label";
        span.textContent = label;
        const area = document.createElement("textarea");
        area.rows = 3;
        area.spellcheck = false;
        area.value = (Array.isArray(get(board)) ? get(board) : []).map((entry) => entry.name).join("\n");
        area.addEventListener("change", () => {
          set(board, namesFrom(area.value).map((name) => L.typedItem(kind, name)));
          ctx.persist();
          ctx.render();
        });
        wrap.append(span, area, ctx.hintEl(hint));
        fields.append(wrap);
      }
    }
    item.append(fields);
    list.append(item);
  }

  function renderLinkedBoards(root, config, ctx) {
    const L = global.EsphomeMrLogicYaml;
    const section = card("logic-linked", TEXT.linkedCard);
    const intro = document.createElement("p");
    intro.className = "card-copy";
    intro.textContent = TEXT.linkedIntro;
    section.append(intro);
    const list = document.createElement("div");
    const boards = L.linkedBoards(config);
    boards.forEach((board, index) => renderLinkedBoard(list, board, index, config, ctx));
    if (!boards.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = TEXT.linkedEmpty;
      list.append(empty);
    }
    const row = document.createElement("div");
    row.className = "add-board";
    const fromFile = document.createElement("button");
    fromFile.type = "button";
    fromFile.textContent = TEXT.linkFile;
    fromFile.addEventListener("click", () => pickBoardFile((snapshot) => takeLinkedBoard(config, ctx, snapshot), ctx));
    const typed = document.createElement("button");
    typed.type = "button";
    typed.textContent = TEXT.linkTyped;
    typed.addEventListener("click", () => {
      const logic = config.logic || (config.logic = {});
      (logic.remoteBoards || (logic.remoteBoards = [])).push(L.typedLinkedBoard(""));
      ctx.persist();
      ctx.render();
      const inputs = document.querySelectorAll("#logic-linked input[type=text]");
      inputs[inputs.length - 1]?.focus();
    });
    row.append(fromFile, typed);
    section.append(list, row);
    root.append(section);
  }

  // A block member in words, and whether it can be found.
  function memberText(config, member) {
    const L = global.EsphomeMrLogicYaml;
    const found = !L.blockMember(config, member).problem && !(typeof member === "object" && member.end === undefined && L.resolveRemote(config, member).problem);
    let text;
    if (typeof member === "string") text = member;
    else if (member.end !== undefined) text = TEXT.endMember(member.end, member.track);
    else if (member.block !== undefined) text = TEXT.remoteBlock(member.board, member.block);
    else text = TEXT.remoteSensor(member.board ?? "?", member.sensor ?? member.turnout ?? "?");
    return { text, found };
  }

  // What can be added to a block: this board's sensors, then each linked
  // board's sensors and blocks.
  function memberChoices(config, block) {
    const L = global.EsphomeMrLogicYaml;
    const taken = new Set((block.sensors || []).map((member) => L.memberKey(member)));
    const groups = [];
    const own = (config.blocks || []).map((sensor) => sensor.name).filter((name) => name && !taken.has(L.memberKey(name)));
    if (own.length) groups.push({ label: TEXT.thisBoard, options: own.map((name) => ({ value: name, text: name })) });
    const heard = L.endTracks(config).map((t) => ({ end: t.end, track: t.track })).filter((member) => !taken.has(L.memberKey(member)));
    if (heard.length) groups.push({ label: TEXT.endsGroup, options: heard.map((member) => ({ value: member, text: TEXT.endMember(member.end, member.track) })) });
    for (const board of L.linkedBoards(config)) {
      if (!board.name) continue;
      const options = [];
      for (const sensor of board.blocks || []) {
        const member = { board: board.name, sensor: sensor.name };
        if (!taken.has(L.memberKey(member))) options.push({ value: member, text: sensor.name });
      }
      for (const other of board.logic?.blocks || []) {
        const member = { board: board.name, block: other.name };
        if (!taken.has(L.memberKey(member))) options.push({ value: member, text: TEXT.remoteBlock(board.name, other.name) });
      }
      if (options.length) groups.push({ label: board.name, options });
    }
    return groups;
  }

  function renderBlock(list, block, index, config, ctx) {
    const { topicFor } = global.EsphomeMr;
    const item = document.createElement("div");
    item.className = "row-card logic-block";
    const header = document.createElement("header");
    const title = document.createElement("h3");
    title.textContent = block.name || TEXT.newBlockName(index + 1);
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = TEXT.remove;
    remove.addEventListener("click", () => {
      config.logic.blocks.splice(index, 1);
      ctx.persist();
      ctx.render();
    });
    actions.append(remove);
    header.append(title, actions);
    item.append(header);

    const fields = document.createElement("div");
    fields.className = "fields";
    const topicField = ctx.field(TEXT.blockTopicLabel, block.topic, (value) => {
      block.topic = value;
      block.topicCustom = value !== topicFor("block", block.name);
      ctx.persist();
    }, { hint: TEXT.blockTopicHint, full: true, spellcheck: false });
    const topicInput = topicField.querySelector("input");
    fields.append(ctx.field(TEXT.blockNameLabel, block.name, (value) => {
      block.name = value;
      title.textContent = value || TEXT.newBlockName(index + 1);
      if (!block.topicCustom) {
        block.topic = topicFor("block", value);
        topicInput.value = block.topic;
      }
      ctx.persist();
    }, { hint: TEXT.blockNameHint, full: true }), topicField);

    const wrap = document.createElement("div");
    wrap.className = "block-members-field";
    const label = document.createElement("span");
    label.className = "field-label";
    label.textContent = TEXT.membersLabel;
    wrap.append(label);
    const members = document.createElement("ul");
    members.className = "block-members";
    (block.sensors || []).forEach((member, at) => {
      const { text, found } = memberText(config, member);
      const row = document.createElement("li");
      row.classList.toggle("is-missing", !found);
      const name = document.createElement("span");
      name.textContent = text;
      row.append(name);
      if (!found) {
        const missing = document.createElement("span");
        missing.className = "linked-warning";
        missing.textContent = TEXT.memberMissing;
        row.append(" ", missing);
      }
      const take = document.createElement("button");
      take.type = "button";
      take.className = "remove";
      take.textContent = TEXT.remove;
      take.addEventListener("click", () => {
        block.sensors.splice(at, 1);
        ctx.persist();
        ctx.render();
      });
      row.append(take);
      members.append(row);
    });
    if (!(block.sensors || []).length) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = TEXT.membersEmpty;
      members.append(empty);
    }
    wrap.append(members);
    if ((block.sensors || []).some((member) => isObject(member) && member.end !== undefined)) wrap.append(ctx.hintEl(TEXT.endMemberHint));
    const groups = memberChoices(config, block);
    if (groups.length) {
      const select = document.createElement("select");
      select.className = "block-add-member";
      select.setAttribute("aria-label", TEXT.addMember);
      const prompt = document.createElement("option");
      prompt.value = "";
      prompt.textContent = TEXT.addMember;
      select.append(prompt);
      for (const group of groups) {
        const optgroup = document.createElement("optgroup");
        optgroup.label = group.label;
        for (const option of group.options) {
          const o = document.createElement("option");
          o.value = JSON.stringify(option.value);
          o.textContent = option.text;
          optgroup.append(o);
        }
        select.append(optgroup);
      }
      select.addEventListener("change", () => {
        if (!select.value) return;
        (block.sensors || (block.sensors = [])).push(JSON.parse(select.value));
        ctx.persist();
        rerender(ctx, `#logic-blocks .logic-block:nth-of-type(${index + 1}) .block-add-member`);
      });
      wrap.append(select);
    } else {
      wrap.append(ctx.hintEl(TEXT.noSensorsYet));
    }
    fields.append(wrap);
    item.append(fields);
    list.append(item);
  }

  function renderBlocks(root, config, ctx) {
    const section = card("logic-blocks", TEXT.blocksCard);
    for (const words of [TEXT.blocksIntro, TEXT.blocksIntro2]) {
      const intro = document.createElement("p");
      intro.className = "card-copy";
      intro.textContent = words;
      section.append(intro);
    }
    const list = document.createElement("div");
    const blocks = config.logic?.blocks || [];
    blocks.forEach((block, index) => renderBlock(list, block, index, config, ctx));
    if (!blocks.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = TEXT.blocksEmpty;
      list.append(empty);
    }
    const add = document.createElement("button");
    add.type = "button";
    add.textContent = TEXT.addBlock;
    add.addEventListener("click", () => {
      const logic = config.logic || (config.logic = {});
      const stored = logic.blocks || (logic.blocks = []);
      const taken = new Set(stored.map((b) => b.name));
      let n = stored.length + 1;
      while (taken.has(TEXT.newBlockName(n))) n += 1;
      const name = TEXT.newBlockName(n);
      stored.push({ name, topic: global.EsphomeMr.topicFor("block", name), topicCustom: false, sensors: [] });
      ctx.persist();
      ctx.render();
      const inputs = document.querySelectorAll("#logic-blocks .logic-block input[type=text]");
      inputs[inputs.length - 2]?.select();
    });
    section.append(list, add);
    root.append(section);
  }

  // ===== Parts ==============================================================
  // Each part of the page is registered with an id (its card's element id,
  // which validation links point at), its place on the page, the modes it
  // shows in, and its own TEXT (linted like this file's). Parts in their own
  // files (logic-ui-*.js, loaded after this one) register themselves:
  //
  //   EsphomeMrLogicUi.registerPart({ id: "logic-masts", order: 50, modes: ["field"],
  //     text: TEXT_MASTS, render(root, config, ctx, ui) { ... } });
  //
  // Places, in the spec's order: checklist 0, mode 10, settings 20, linked
  // boards 30, track plan 33 (logic-ui-plan.js), plant ends 35 (logic-ui-ends.js), blocks 40, masts 50, buttons 60,
  // sections 70, groups 80, starters 85, layers view 90, control table 95.
  const parts = [];

  function registerPart(part) {
    if (!part || typeof part.render !== "function" || typeof part.id !== "string") throw new Error("A part needs an id and a render function.");
    if (parts.some((other) => other.id === part.id)) throw new Error(`Part ${part.id} is registered twice.`);
    parts.push({ modes: ["field"], order: 100, text: {}, ...part });
    parts.sort((a, b) => a.order - b.order);
  }

  // Every word a part can show, for the plain-words lint: [where, TEXT object].
  /** Whether a part is registered for a mode (the guided steps use it). */
  function hasPart(id, mode) {
    return parts.some((part) => part.id === id && part.modes.includes(mode));
  }

  function allText() {
    return [["TEXT", TEXT], ...parts.map((part) => [part.id, part.text])];
  }

  // ===== Shared helpers for parts ===========================================

  const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);
  const list = (value) => (Array.isArray(value) ? value : []);

  // config.logic, made when first needed.
  function logicOf(config) {
    return config.logic || (config.logic = {});
  }

  // A blank rule and a blank group, as the stored format keeps them.
  function newRule() {
    return { trigger: { while: { block: "", is: "occupied" } }, checks: [], then: {} };
  }

  function newGroup(name) {
    return { name, rules: [newRule()] };
  }

  /**
   * What a dropdown can offer for one kind of item, grouped by board:
   * [{ label, options: [{ value, text }] }]. A value on this board is its name;
   * on a linked board it is { board, <kind>: name }.
   *
   * kind: "block" (Logic page blocks and sensors: a sensor is a block of one),
   * "sensor", "turnout", "mast" (Signal Masts page and signals with no lights),
   * "button", "section". `remote: true` adds linked boards' sensors, blocks,
   * turnouts and masts.
   */
  function itemChoices(config, kind, { remote = false } = {}) {
    const L = global.EsphomeMrLogicYaml;
    if (kind === "endMast" || kind === "endBlock" || kind === "end") {
      // What an end of this board hears: { end, track }, or with `hears` for a rule.
      const options = [];
      for (const t of L.endTracks(config)) {
        if (kind !== "endMast") options.push({ value: kind === "end" ? { end: t.end, track: t.track, hears: "block" } : { end: t.end, track: t.track }, text: TEXT.endBlock(t.end, t.track) });
        if (kind !== "endBlock") options.push({ value: kind === "end" ? { end: t.end, track: t.track, hears: "mast" } : { end: t.end, track: t.track }, text: TEXT.endMast(t.end, t.track) });
      }
      return options.length ? [{ label: TEXT.endsGroup, options }] : [];
    }
    const names = (items, key = "name") => list(items).filter(isObject).map((item) => String(item[key] ?? "")).filter(Boolean);
    const logic = config.logic || {};
    const own = {
      block: [...names(logic.blocks), ...names(config.blocks)],
      sensor: names(config.blocks),
      turnout: names(config.points),
      mast: [...names(config.signals?.masts), ...names(list(logic.masts).filter((m) => isObject(m) && m.virtual === true))],
      button: names(logic.buttons),
      section: names(logic.resources),
    }[kind] || [];
    const groups = [];
    const unique = [...new Set(own)];
    if (unique.length) groups.push({ label: TEXT.thisBoard, options: unique.map((name) => ({ value: name, text: name })) });
    if (!remote) return groups;
    for (const board of L.linkedBoards(config)) {
      if (!board.name) continue;
      const options = [];
      const add = (key, items, text = (name) => name) => {
        for (const name of names(items)) options.push({ value: { board: board.name, [key]: name }, text: text(name) });
      };
      if (kind === "block" || kind === "sensor") add("sensor", board.blocks);
      if (kind === "block") add("block", board.logic?.blocks, (name) => TEXT.remoteBlock(board.name, name));
      if (kind === "turnout") add("turnout", board.points);
      if (kind === "mast") add("mast", [...list(board.signals?.masts), ...list(board.logic?.masts)]);
      if (options.length) groups.push({ label: board.name, options });
    }
    return groups;
  }

  /**
   * A <select> over itemChoices' groups. `current` is a stored value (a name,
   * or { board, <kind>: name }); one no longer offered is kept, marked not
   * found. onChange gets the chosen stored value.
   */
  function selectEl(groups, current, onChange, { prompt = "", label = "" } = {}) {
    const select = document.createElement("select");
    if (label) select.setAttribute("aria-label", label);
    const key = (value) => JSON.stringify(value ?? "");
    const have = new Set(groups.flatMap((group) => group.options.map((option) => key(option.value))));
    const blank = document.createElement("option");
    blank.value = key("");
    blank.textContent = prompt;
    select.append(blank);
    if (current !== undefined && current !== "" && !have.has(key(current))) {
      const missing = document.createElement("option");
      missing.value = key(current);
      const name = isObject(current) ? Object.entries(current).find(([k]) => k !== "board")?.[1] : current;
      missing.textContent = `${name} (${TEXT.memberMissing})`;
      select.append(missing);
    }
    for (const group of groups) {
      const optgroup = document.createElement("optgroup");
      optgroup.label = group.label;
      for (const option of group.options) {
        const o = document.createElement("option");
        o.value = key(option.value);
        o.textContent = option.text;
        optgroup.append(o);
      }
      select.append(optgroup);
    }
    select.value = key(current ?? "");
    select.addEventListener("change", () => onChange(JSON.parse(select.value)));
    return select;
  }

  // A row card with a title and a Remove button, as Blocks draws them.
  function rowCard(title, onRemove, className = "") {
    const item = document.createElement("div");
    item.className = `row-card ${className}`.trim();
    const header = document.createElement("header");
    const h3 = document.createElement("h3");
    h3.textContent = title;
    const actions = document.createElement("div");
    actions.className = "row-actions";
    if (onRemove) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.textContent = TEXT.remove;
      remove.addEventListener("click", onRemove);
      actions.append(remove);
    }
    header.append(h3, actions);
    item.append(header);
    return { item, title: h3, actions };
  }

  function paragraph(text, className = "card-copy") {
    const p = document.createElement("p");
    p.className = className;
    p.textContent = text;
    return p;
  }

  // What parts get as `ui`.
  const UI = Object.freeze({ TEXT, card, rerender, logicOf, newRule, newGroup, itemChoices, selectEl, rowCard, paragraph });

  // MSS Logic leads with its own guided steps (logic-ui-mss-steps.js).
  // Field Logic leads with its own frame (logic-ui-field.js): the mode,
  // Share and Linked boards fold behind its line, and the old page's cards
  // (Blocks and the parts after it) are no longer shown there (TP 6; their
  // code goes in TP 9).
  const folded = (config) => global.EsphomeMr.logicMode(config) !== "field" || !!global.EsphomeMrLogicUiField?.settingsOpen(config);
  registerPart({ id: "logic-steps", order: 0, modes: ["none"], render: (root, config, ctx) => renderChecklist(root, config, ctx, {
    blocks: global.EsphomeMr.logicMode(config) === "field",
    tryIt: parts.some((part) => part.id === "logic-try" && part.modes.includes(global.EsphomeMr.logicMode(config))),
  }) });
  registerPart({ id: "logic-mode", order: 10, modes: ["none", "field", "mss"], show: folded, render: renderMode });
  registerPart({ id: "logic-settings", order: 20, modes: ["none", "field", "mss"], show: folded, render: renderSettings });
  registerPart({ id: "logic-linked", order: 30, show: folded, render: renderLinkedBoards });
  registerPart({ id: "logic-blocks", order: 40, modes: [], render: renderBlocks });

  /**
   * Draw the Logic page into `root`. `ctx` carries the configurator's state and
   * helpers: { config, field, hintEl, persist, render, showView, flash,
   * pinChoices, blockPinChoices, mastPicture(mastName, aspectLabel), refresh }.
   */
  function renderLogicPage(root, ctx) {
    const config = ctx.config;
    const mode = global.EsphomeMr.logicMode(config);
    root.replaceChildren();
    for (const part of parts) {
      if (part.modes.includes(mode) && (!part.show || part.show(config))) part.render(root, config, ctx, UI);
    }
    if (mode === "mss") global.EsphomeMrLogicUiMssMarks?.apply(root, config);
  }

  // The nav's one-line summary of this board's logic.
  function logicNavHint(config) {
    return TEXT.modes[global.EsphomeMr.logicMode(config)].label;
  }

  global.EsphomeMrLogicUi = {
    FEATURES, TEXT, modeChoices, checklistSteps, renderLogicPage, logicNavHint,
    registerPart, hasPart, allText, UI, itemChoices, newRule, newGroup,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
