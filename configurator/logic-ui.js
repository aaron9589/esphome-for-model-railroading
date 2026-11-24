// The Logic page (docs/field-logic-spec.md, The Logic page). Loaded after
// generator.js and before app.js, which calls renderLogicPage on every render.
//
// Every word the page shows is in TEXT, so test/labels.test.js can check that
// none of the spec-only terms (scan, latch, layer, resource, ...) reach the page.
(function (global) {
  // Parts of the page that later releases of the implementation plan switch on.
  // Hidden parts are not shown and their settings are not offered.
  const FEATURES = Object.freeze({
    startsOn: false, // Release 2: logic starts on / off
    tryIt: false, // Release 2: the checklist's Try it step
    mss: false, // Release 4: MSS Logic in the mode list
  });

  const TEXT = Object.freeze({
    title: "Logic",
    intro: "How this board decides what its signals show.",
    navNone: "None",
    modeCard: "Logic",
    modeLabel: "Logic",
    modeHint: "How this board decides what its signals show.",
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
    inProgress: "Work in progress: this version of the Logic page has sharing and blocks. Rules come in a later version.",
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
      tryIt: "Try it",
      download: "Download",
    }),
    stepDone: "Done",
    stepNext: "Next",
    back: "Back: signal masts",
    next: "Next: download",
  });

  function modeChoices() {
    return ["none", "field", ...(FEATURES.mss ? ["mss"] : [])];
  }

  // The checklist: each step, whether it is done, and where it links.
  function checklistSteps(config, parts) {
    const mode = global.EsphomeMr.logicMode(config);
    const steps = [{ key: "mode", done: mode !== "none", target: "logic-mode" }];
    if (parts.blocks) {
      steps.push({ key: "blocks", done: (config.logic?.blocks || []).length > 0, target: "logic-blocks" });
    }
    if (FEATURES.tryIt) steps.push({ key: "tryIt", done: false, target: "logic-try" });
    steps.push({ key: "download", done: false, view: "yaml" });
    return steps;
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
      const was = global.EsphomeMr.logicMode(config);
      if (value === "none") delete logic.mode;
      else logic.mode = value;
      // Share is on by default in Field Logic.
      if (value === "field" && was === "none") logic.share = true;
      ctx.persist();
      ctx.render();
    }, {
      select: choices.map((key) => ({ value: key, label: TEXT.modes[key].label })),
      hint: TEXT.modeHint,
      full: true,
    }));
    const about = document.createElement("p");
    about.className = "card-copy logic-mode-about";
    about.textContent = TEXT.modes[mode].about;
    fields.append(about);
    if (mode === "field") {
      const note = document.createElement("p");
      note.className = "hint full";
      note.textContent = TEXT.inProgress;
      fields.append(note);
    }
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
      fields.append(ctx.field(TEXT.shareLabel, config.logic?.share === true, (checked) => {
        const logic = config.logic || (config.logic = {});
        logic.share = checked;
        ctx.persist();
        ctx.render();
      }, { checkbox: true, hint: TEXT.shareHint }));
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

  /**
   * Draw the Logic page into `root`. `ctx` carries the configurator's state and
   * helpers: { config, field, hintEl, persist, render, showView }.
   */
  function renderLogicPage(root, ctx) {
    const config = ctx.config;
    // Parts later work items add. Each is drawn only when it exists.
    const parts = { blocks: false };
    root.replaceChildren();
    renderChecklist(root, config, ctx, parts);
    renderMode(root, config, ctx);
    renderSettings(root, config, ctx);
  }

  // The nav's one-line summary of this board's logic.
  function logicNavHint(config) {
    return TEXT.modes[global.EsphomeMr.logicMode(config)].label;
  }

  global.EsphomeMrLogicUi = { FEATURES, TEXT, modeChoices, checklistSteps, renderLogicPage, logicNavHint };
})(typeof globalThis !== "undefined" ? globalThis : window);
