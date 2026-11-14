const {
  PULLUP_PINS,
  STRAPPING_PINS,
  ensureSecrets,
  generatePassword,
  generateYaml,
  myFirstBoardPreset,
  normalizeConfig,
  parseConfigFromYaml,
  stateTopic,
  topicFor,
  validateConfig,
  SIGNAL_COLORS,
  SIGNAL_COLOR_ORDER,
  CATS_ASPECTS,
  catsAspectState,
} = globalThis.EsphomeMr;

const STORAGE_KEY = "esphome-mr-configurator-v1";
const CREDENTIALS_KEY = "esphome-mr-credentials-v1";

const MODULES = [
  {
    id: "nodemcu-32s",
    title: "38-pin dev board",
    detail: "Two rows of 19. The wide board.",
    src: "img/esp32-38.svg",
    alt: "38-pin ESP32 board. Amber labels VP, VN, 34, and 35 have no pull-up.",
  },
  {
    id: "esp32dev",
    title: "30-pin DevKit",
    detail: "EN and Boot at the antenna end. Two rows of 15.",
    src: "img/esp32-30.svg",
    alt: "30-pin ESP32 DevKit with EN and Boot at the antenna end. Amber labels VP, VN, 34, and 35 have no pull-up.",
  },
];

const ACTIONS = [
  { value: "toggle", label: "Toggle" },
  { value: "closed", label: "Set closed" },
  { value: "thrown", label: "Set thrown" },
];

const COLOR_LABELS = {
  off: "Off",
  red: "Red",
  amber: "Amber",
  green: "Green",
  white: "White",
};

const LAMP_STARTERS = [
  { label: "3 lamps", lamps: [
    { name: "Bottom", count: 1 },
    { name: "Middle", count: 1 },
    { name: "Top", count: 1 },
  ] },
  { label: "Head and marker", lamps: [
    { name: "Marker", count: 1 },
    { name: "Bottom", count: 1 },
    { name: "Middle", count: 1 },
    { name: "Top", count: 1 },
  ] },
  { label: "Head, marker and route", lamps: [
    { name: "Route", count: 3 },
    { name: "Marker", count: 1 },
    { name: "Bottom", count: 1 },
    { name: "Middle", count: 1 },
    { name: "Top", count: 1 },
  ] },
];

const CRED_FIELDS = ["wifiSsid", "wifiPassword", "mqttBroker", "apPassword"];

let state = loadState() || myFirstBoardPreset();
normalizeConfig(state);
normalizeTopics(state);
applyCredentials(state, loadCredentials());
ensureSecrets(state);
persist();

const el = {
  messages: document.getElementById("messages"),
  toasts: document.getElementById("toasts"),
  boardIdentity: document.getElementById("board-identity"),
  boardNetwork: document.getElementById("board-network"),
  hotspotFields: document.getElementById("hotspot-fields"),
  i2cFields: document.getElementById("i2c-fields"),
  driverFields: document.getElementById("driver-fields"),
  driverTitle: document.getElementById("driver-title"),
  directPwmNote: document.getElementById("direct-pwm-note"),
  blocksList: document.getElementById("blocks-list"),
  pointsList: document.getElementById("points-list"),
  preview: document.getElementById("yaml-preview"),
  importFile: document.getElementById("import-file"),
  countBlocks: document.getElementById("count-blocks"),
  countPoints: document.getElementById("count-points"),
  blocksEmpty: document.getElementById("blocks-empty"),
  pointsEmpty: document.getElementById("points-empty"),
  signalsList: document.getElementById("signals-list"),
  countSignals: document.getElementById("count-signals"),
  signalsEmpty: document.getElementById("signals-empty"),
};

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
});

document.querySelectorAll("[data-goto]").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.goto));
});

function showView(name) {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === name);
  });
  document.querySelectorAll(".view").forEach((panel) => {
    panel.hidden = panel.dataset.panel !== name;
  });
  window.scrollTo(0, 0);
}

document.getElementById("btn-clear").addEventListener("click", () => {
  state.blocks = [];
  persist();
  render();
  flash("ok", "Removed all blocks. Credentials kept.");
});

document.getElementById("btn-clear-creds").addEventListener("click", () => {
  clearCredentials();
  state.board.wifiSsid = "";
  state.board.wifiPassword = "";
  state.board.mqttBroker = "";
  persist();
  render();
  flash("ok", "Cleared Wi-Fi and MQTT broker.");
});

document.getElementById("btn-add-block").addEventListener("click", () => {
  const name = `Block ${state.blocks.length + 1}`;
  state.blocks.push({
    name,
    topic: topicFor("block", name),
    topicCustom: false,
    gpio: "GPIO14",
    inverted: true,
    debounce: "500ms",
  });
  persist();
  render();
});

document.getElementById("btn-add-point").addEventListener("click", () => {
  const used = new Set(state.points.map((p) => Number(p.channel)));
  let channel = 0;
  while (used.has(channel) && channel < 15) channel += 1;
  const name = `Point ${state.points.length + 1}`;
  state.points.push({
    name,
    topic: topicFor("point", name),
    topicCustom: false,
    channel,
    servoPin: usesPca() ? "" : nextServoPin(),
    travelTime: "10s",
    controls: [],
  });
  persist();
  render();
});

document.getElementById("btn-add-mast").addEventListener("click", () => {
  const name = `Mast ${state.signals.masts.length + 1}`;
  state.signals.masts.push({
    name,
    topic: topicFor("signal", name),
    topicCustom: false,
    lamps: [],
    aspects: [],
    mode: "addressable",
    pin: nextServoPin(),
    numLeds: 1,
  });
  persist();
  render();
});

document.getElementById("btn-download").addEventListener("click", () => {
  const { errors } = validateConfig(state);
  if (errors.length) {
    flash("err", errors.join(" "));
    return;
  }
  const yaml = generateYaml(state);
  const blob = new Blob([yaml], { type: "text/yaml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${state.board.name || "board"}.yaml`;
  a.click();
  URL.revokeObjectURL(url);
  flash("ok", `Downloaded ${a.download}. Paste it into ESPHome Dashboard.`);
});

document.getElementById("btn-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(generateYaml(state));
    flash("ok", "YAML copied to clipboard.");
  } catch {
    flash("err", "Could not copy — select the preview and copy manually.");
  }
});

el.importFile.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    state = parseConfigFromYaml(text);
    if (!state.i2c) state.i2c = { sda: "GPIO21", scl: "GPIO22" };
    normalizeTopics(state);
    // Prefer credentials from the imported file when present; otherwise keep browser-saved ones.
    normalizeConfig(state);
    const fromFile = extractCredentials(state.board);
    const saved = loadCredentials();
    const merged = {};
    for (const key of CRED_FIELDS) merged[key] = fromFile[key] || saved[key] || "";
    applyCredentials(state, merged);
    ensureSecrets(state);
    saveCredentials(extractCredentials(state.board));
    persist();
    render();
    flash("ok", `Imported ${file.name}.`);
  } catch (err) {
    flash("err", err.message || String(err));
  }
});

function normalizeTopics(config) {
  for (const block of config.blocks || []) {
    if (typeof block.topicCustom !== "boolean") {
      block.topicCustom = block.topic !== topicFor("block", block.name);
    }
  }
  for (const point of config.points || []) {
    if (typeof point.topicCustom !== "boolean") {
      point.topicCustom = point.topic !== topicFor("point", point.name);
    }
  }
  for (const mast of config.signals?.masts || []) {
    if (typeof mast.topicCustom !== "boolean") {
      mast.topicCustom = mast.topic !== topicFor("signal", mast.name);
    }
  }
}

function followName(item, kind, card) {
  if (!item.topicCustom) {
    item.topic = topicFor(kind, item.name);
    const topicInput = card.querySelector("[data-role=topic]");
    if (topicInput) topicInput.value = item.topic;
  }
  const stateInput = card.querySelector("[data-role=state-topic]");
  if (stateInput) stateInput.value = stateTopic(item.topic);
}

function extractCredentials(board = {}) {
  return {
    wifiSsid: board.wifiSsid || "",
    wifiPassword: board.wifiPassword || "",
    mqttBroker: board.mqttBroker || "",
  };
}

function applyCredentials(target, creds) {
  const c = creds || {};
  for (const key of CRED_FIELDS) {
    target.board[key] = c[key] || target.board[key] || "";
  }
  return target;
}

function loadCredentials() {
  try {
    const raw = localStorage.getItem(CREDENTIALS_KEY);
    if (!raw) {
      // Migrate from older single-blob drafts that already had credentials.
      const draft = loadState();
      if (draft?.board) return extractCredentials(draft.board);
      return extractCredentials();
    }
    return { ...extractCredentials(), ...JSON.parse(raw) };
  } catch {
    return extractCredentials();
  }
}

function saveCredentials(creds = extractCredentials(state.board)) {
  localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(extractCredentials(creds)));
}

function clearCredentials() {
  localStorage.removeItem(CREDENTIALS_KEY);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persist() {
  normalizeConfig(state);
  ensureSecrets(state);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  saveCredentials(state.board);
}

function setCredential(key, value) {
  state.board[key] = value;
  saveCredentials(state.board);
  persist();
  updatePreview();
}

function flash(kind, text) {
  const div = document.createElement("div");
  div.className = `msg ${kind}`;
  div.textContent = text;
  el.toasts.append(div);
  setTimeout(() => div.remove(), 4000);
}

function linkedField(labelText, value, hint) {
  const label = document.createElement("label");
  label.classList.add("full", "linked");
  const title = document.createElement("span");
  title.className = "field-label";
  title.textContent = labelText;
  const input = document.createElement("input");
  input.type = "text";
  input.disabled = true;
  input.value = value;
  input.dataset.role = "state-topic";
  label.append(title, input, hintEl(hint));
  return label;
}

function field(labelText, value, onInput, opts = {}) {
  const label = document.createElement("label");
  if (opts.full) label.classList.add("full");
  const title = document.createElement("span");
  title.className = "field-label";
  title.textContent = labelText;
  let input;
  if (opts.select) {
    input = document.createElement("select");
    for (const option of opts.select) {
      const optionValue = typeof option === "string" ? option : option.value;
      const optionLabel = typeof option === "string" ? option : option.label;
      const o = document.createElement("option");
      o.value = optionValue;
      o.textContent = optionLabel;
      if (optionValue === value) o.selected = true;
      input.appendChild(o);
    }
  } else if (opts.checkbox) {
    label.classList.add("check", "full");
    input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!value;
    input.addEventListener("change", () => onInput(input.checked));
    const text = document.createElement("span");
    text.className = "check-copy";
    text.append(title);
    if (opts.hint) text.append(hintEl(opts.hint));
    label.append(input, text);
    return label;
  } else {
    input = document.createElement("input");
    input.type = opts.type || "text";
    input.value = value ?? "";
    if (opts.placeholder) input.placeholder = opts.placeholder;
  }
  if (opts.spellcheck === false) input.spellcheck = false;
  if (opts.autocomplete) input.autocomplete = opts.autocomplete;
  input.addEventListener("input", () => onInput(input.value));
  label.append(title, input);
  if (opts.hint) label.append(hintEl(opts.hint));
  return label;
}

function hintEl(text) {
  const hint = document.createElement("span");
  hint.className = "hint";
  hint.textContent = text;
  return hint;
}

function pinChoices() {
  return PULLUP_PINS.map((pin) => ({
    value: pin,
    label: STRAPPING_PINS.has(pin) ? `${pin} (strapping)` : pin,
  }));
}

function usedPins() {
  const used = new Set();
  for (const block of state.blocks || []) {
    if (block.gpio) used.add(String(block.gpio).toUpperCase());
  }
  if ((state.points || []).length && usesPca()) {
    if (state.i2c?.sda) used.add(String(state.i2c.sda).toUpperCase());
    if (state.i2c?.scl) used.add(String(state.i2c.scl).toUpperCase());
  }
  for (const point of state.points || []) {
    if (!usesPca() && point.servoPin) used.add(String(point.servoPin).toUpperCase());
    for (const control of point.controls || []) {
      if (control.buttonPin) used.add(String(control.buttonPin).toUpperCase());
      if (control.closedLight) used.add(String(control.closedLight).toUpperCase());
      if (control.openLight) used.add(String(control.openLight).toUpperCase());
    }
  }
  for (const mast of state.signals?.masts || []) {
    if (mast.mode === "gpio") {
      for (const lamp of mast.lamps || []) {
        if (lamp.pin) used.add(String(lamp.pin).toUpperCase());
      }
    } else if (mast.pin) {
      used.add(String(mast.pin).toUpperCase());
    }
  }
  return used;
}

function usesPca() {
  return state.pca9685 !== false;
}

function nextServoPin() {
  const used = usedPins();
  const preferred = PULLUP_PINS.filter((pin) => !STRAPPING_PINS.has(pin));
  return preferred.find((pin) => !used.has(pin)) || PULLUP_PINS.find((pin) => !used.has(pin)) || "GPIO18";
}

function nextButtonPin() {
  const used = usedPins();
  const preferred = PULLUP_PINS.filter((pin) => !STRAPPING_PINS.has(pin));
  return preferred.find((pin) => !used.has(pin)) || PULLUP_PINS.find((pin) => !used.has(pin)) || "GPIO4";
}

function secretRow(inputField, label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "text";
  button.textContent = label;
  button.addEventListener("click", onClick);
  const row = document.createElement("div");
  row.className = "ota-row";
  row.append(inputField, button);
  return row;
}

function renderModules() {
  const wrap = document.createElement("div");
  wrap.className = "board-support";
  for (const mod of MODULES) {
    const figure = document.createElement("figure");
    const img = document.createElement("img");
    img.src = mod.src;
    img.alt = mod.alt;
    const caption = document.createElement("figcaption");
    caption.textContent = mod.title;
    figure.append(img, caption);
    wrap.append(figure);
  }
  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = "Amber pins cannot be used for buttons.";
  wrap.append(note);
  el.boardIdentity.append(wrap);
}

function renderBoard() {
  const b = state.board;
  el.boardIdentity.replaceChildren(
    field("Board name", b.name, (v) => {
      b.name = v.trim();
      persist();
      updatePreview();
    }, {
      placeholder: "yard-board-01",
      hint: "Name of this board on the network.",
      full: true,
    })
  );
  renderModules();
  el.boardNetwork.replaceChildren(
    field("Wi-Fi name", b.wifiSsid, (v) => setCredential("wifiSsid", v), {
      placeholder: "2.4 GHz network",
      hint: "Network the board joins.",
    }),
    field("Wi-Fi password", b.wifiPassword, (v) => setCredential("wifiPassword", v), {
      type: "password",
      hint: "Password for that network.",
    }),
    field("Disable MQTT", b.mqttEnabled === false, (checked) => {
      b.mqttEnabled = !checked;
      persist();
      render();
    }, {
      checkbox: true,
      hint: "Tick this and the board will not talk to JMRI.",
    })
  );
  if (b.mqttEnabled !== false) {
    el.boardNetwork.append(
      field("MQTT broker IP", b.mqttBroker, (v) => setCredential("mqttBroker", v), {
        placeholder: "192.168.1.10",
        hint: "Address of the computer running the MQTT broker (such as Mosquitto).",
      })
    );
  }

  const apField = field("Hotspot password", b.apPassword, (v) => {
    b.apPassword = v;
    persist();
    if (state.board.apPassword !== v) render();
    else updatePreview();
  }, {
    autocomplete: "off",
    hint: "Three easy words, like AppleChairTable.",
  });
  el.hotspotFields.replaceChildren(secretRow(apField, "Generate new", () => {
    state.board.apPassword = generatePassword();
    persist();
    render();
    flash("ok", "New hotspot password saved. It takes effect on the next flash.");
  }));
}

function renderI2c() {
  el.driverTitle.textContent = usesPca() ? "PCA9685 bus" : "ESP pins";
  el.driverFields.replaceChildren(
    field("Use a PCA9685", usesPca(), (checked) => {
      state.pca9685 = checked;
      if (!checked) {
        for (const point of state.points) {
          if (!point.servoPin) point.servoPin = nextServoPin();
        }
      }
      persist();
      render();
    }, {
      checkbox: true,
      hint: "Off, each servo connects to an ESP pin with PWM and takes power from the board.",
    })
  );
  el.i2cFields.replaceChildren();
  if (!usesPca()) return;
  if (!state.i2c) state.i2c = { sda: "GPIO21", scl: "GPIO22" };
  el.i2cFields.append(
    field("I2C SDA (PCA9685)", state.i2c.sda, (v) => {
      state.i2c.sda = v.trim() || "GPIO21";
      persist();
      updatePreview();
    }, {
      hint: "Data pin for the servo board.",
    }),
    field("I2C SCL (PCA9685)", state.i2c.scl, (v) => {
      state.i2c.scl = v.trim() || "GPIO22";
      persist();
      updatePreview();
    }, {
      hint: "Clock pin for the servo board.",
    })
  );
}

function renderBlocks() {
  el.blocksList.replaceChildren();
  state.blocks.forEach((block, index) => {
    const card = document.createElement("div");
    card.className = "row-card";
    const header = document.createElement("header");
    const title = document.createElement("h3");
    title.textContent = block.name || `Block ${index + 1}`;
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      state.blocks.splice(index, 1);
      persist();
      render();
    });
    actions.append(remove);
    header.append(title, actions);

    const fields = document.createElement("div");
    fields.className = "fields";
    const topicField = field("MQTT topic", block.topic, (v) => {
      block.topic = v;
      block.topicCustom = v !== topicFor("block", block.name);
      persist();
      updatePreview();
    }, {
      full: true,
      hint: "Where this detector reports occupied or clear.",
    });
    topicField.querySelector("input").dataset.role = "topic";
    fields.append(
      field("Name", block.name, (v) => {
        block.name = v;
        title.textContent = v || `Block ${index + 1}`;
        followName(block, "block", card);
        persist();
        updatePreview();
      }, {
        placeholder: "Kiama/Up XOver",
        full: true,
        hint: "Name in the logs. The topic is filled in from this.",
      }),
      topicField,
      field("GPIO", block.gpio, (v) => {
        block.gpio = v.trim().toUpperCase();
        persist();
        updatePreview();
      }, {
        placeholder: "GPIO14",
        hint: "Pin this detector uses.",
      }),
      field("Debounce", block.debounce, (v) => {
        block.debounce = v.trim() || "500ms";
        persist();
        updatePreview();
      }, {
        placeholder: "500ms",
        hint: "500ms is a fairly good value to keep blocks held for dirty track etc - you can adjust this as appropriate.",
      }),
      field("Invert the input", block.inverted, (v) => {
        block.inverted = v;
        persist();
        updatePreview();
      }, {
        checkbox: true,
        hint: "If you test the block and it shows unoccupied with a train in the section, and occupied when it's empty, switch this box.",
      })
    );
    card.append(header, fields);
    el.blocksList.append(card);
  });
}

function renderPoints() {
  if (!usesPca()) {
    let assigned = false;
    for (const point of state.points) {
      if (!point.servoPin) {
        point.servoPin = nextServoPin();
        assigned = true;
      }
    }
    if (assigned) persist();
  }
  el.pointsList.replaceChildren();
  state.points.forEach((point, index) => {
    const card = document.createElement("div");
    card.className = "row-card";
    const header = document.createElement("header");
    const title = document.createElement("h3");
    title.textContent = point.name || `Point ${index + 1}`;
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      state.points.splice(index, 1);
      persist();
      render();
    });
    actions.append(remove);
    header.append(title, actions);

    const fields = document.createElement("div");
    fields.className = "fields";
    const topicField = field("MQTT topic", point.topic, (v) => {
      point.topic = v;
      point.topicCustom = v !== topicFor("point", point.name);
      const stateInput = card.querySelector("[data-role=state-topic]");
      if (stateInput) stateInput.value = stateTopic(point.topic);
      persist();
      updatePreview();
    }, {
      full: true,
      hint: "Where JMRI sends closed or thrown.",
    });
    topicField.querySelector("input").dataset.role = "topic";

    fields.append(
      field("Name", point.name, (v) => {
        point.name = v;
        title.textContent = v || `Point ${index + 1}`;
        followName(point, "point", card);
        persist();
        updatePreview();
      }, {
        placeholder: "Kiama/Up Loop",
        full: true,
        hint: "Name on the calibration page.",
      }),
      topicField,
      linkedField(
        "State topic",
        stateTopic(point.topic),
        "Where the board reports closed or thrown."
      ),
      usesPca()
        ? field("PCA9685 channel (0–15)", point.channel, (v) => {
          point.channel = Number(v);
          persist();
          updatePreview();
        }, {
          type: "number",
          hint: "Which servo output this point uses.",
        })
        : field("Servo pin", point.servoPin, (v) => {
          point.servoPin = v;
          persist();
          updatePreview();
        }, {
          select: pinChoices(),
          hint: "ESP pin that sends PWM to this servo.",
        }),
      field("Travel time", point.travelTime, (v) => {
        point.travelTime = v.trim() || "10s";
        persist();
        updatePreview();
      }, {
        placeholder: "10s",
        hint: "How long the throw takes. Longer is slower, for a prototypical speed.",
      })
    );
    fields.append(renderPanel(point));
    card.append(header, fields);
    el.pointsList.append(card);
  });
}

function renderPanel(point) {
  if (!Array.isArray(point.controls)) point.controls = [];
  const panel = document.createElement("div");
  panel.className = "panel";
  const title = document.createElement("h4");
  title.textContent = "Panel";
  const intro = document.createElement("p");
  intro.className = "hint";
  intro.textContent = "Buttons and lights on the fascia.";
  panel.append(title, intro);

  point.controls.forEach((control, index) => {
    const card = document.createElement("div");
    card.className = "control-card";
    const header = document.createElement("header");
    const label = document.createElement("h3");
    label.textContent = `Button ${index + 1}`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      point.controls.splice(index, 1);
      persist();
      render();
    });
    header.append(label, remove);

    const fields = document.createElement("div");
    fields.className = "fields";
    fields.append(
      field("Action", control.action || "toggle", (v) => {
        control.action = v;
        persist();
        updatePreview();
      }, {
        select: ACTIONS,
        hint: "What this button does.",
      }),
      field("Button pin", control.buttonPin, (v) => {
        control.buttonPin = v;
        persist();
        updatePreview();
      }, {
        select: pinChoices(),
        hint: "Pin this button uses.",
      })
    );
    const lightOptions = [{ value: "", label: "None" }, ...pinChoices()];
    fields.append(
      field("Closed light", control.closedLight || "", (v) => {
        control.closedLight = v;
        persist();
        updatePreview();
      }, {
        select: lightOptions,
        hint: "On when the point is closed.",
      }),
      field("Open light", control.openLight || "", (v) => {
        control.openLight = v;
        persist();
        updatePreview();
      }, {
        select: lightOptions,
        hint: "On when the point is thrown.",
      })
    );
    card.append(header, fields);
    panel.append(card);
  });

  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Add button";
  add.addEventListener("click", () => {
    point.controls.push({
      action: "toggle",
      buttonPin: nextButtonPin(),
      closedLight: "",
      openLight: "",
    });
    persist();
    render();
  });
  panel.append(add);
  return panel;
}

function syncAspectCells(mast) {
  for (const aspect of mast.aspects) {
    while (aspect.lamps.length < mast.lamps.length) {
      aspect.lamps.push({ color: "off", mode: "steady" });
    }
    aspect.lamps.length = mast.lamps.length;
  }
}

function moveLamp(mast, from, to) {
  if (to < 0 || to >= mast.lamps.length || from === to) return;
  const [lamp] = mast.lamps.splice(from, 1);
  mast.lamps.splice(to, 0, lamp);
  for (const aspect of mast.aspects) {
    const [cell] = aspect.lamps.splice(from, 1);
    aspect.lamps.splice(to, 0, cell);
  }
  persist();
  render();
}

function swatchHex(color) {
  if (color === "off") return "#1f2937";
  return `#${SIGNAL_COLORS[color]}`;
}

function colHead(text) {
  const span = document.createElement("div");
  span.className = "col-head";
  span.textContent = text;
  return span;
}

function labeledControl(labelText, control) {
  const label = document.createElement("label");
  label.className = "stack-label";
  const title = document.createElement("span");
  title.className = "col-head";
  title.textContent = labelText;
  label.append(title, control);
  return label;
}

function renderLampEditor(mast, lamp, lampIndex, gpio) {
  const editor = document.createElement("div");
  editor.className = "lamp-editor";
  const bindDrop = (cell) => {
    cell.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });
    cell.addEventListener("drop", (event) => {
      event.preventDefault();
      const from = Number(event.dataTransfer.getData("text/plain"));
      if (Number.isNaN(from)) return;
      moveLamp(mast, from, lampIndex);
    });
  };

  const nameCell = document.createElement("div");
  nameCell.className = "lamp-name";
  const grip = document.createElement("span");
  grip.className = "lamp-grip";
  grip.draggable = true;
  grip.title = "Drag to reorder";
  grip.textContent = "⋮⋮";
  grip.addEventListener("dragstart", (event) => {
    event.dataTransfer.setData("text/plain", String(lampIndex));
    event.dataTransfer.effectAllowed = "move";
  });
  const name = document.createElement("input");
  name.type = "text";
  name.value = lamp.name;
  name.placeholder = "Bottom";
  name.setAttribute("aria-label", "Lamp name");
  name.addEventListener("input", () => {
    lamp.name = name.value;
    persist();
    updatePreview();
  });
  nameCell.append(grip, name);

  const detail = document.createElement("div");
  detail.className = "lamp-detail";
  if (gpio) {
    const pin = document.createElement("select");
    pin.setAttribute("aria-label", "Lamp pin");
    for (const option of pinChoices()) {
      const item = document.createElement("option");
      item.value = option.value;
      item.textContent = option.label;
      if (option.value === lamp.pin) item.selected = true;
      pin.append(item);
    }
    pin.addEventListener("input", () => {
      lamp.pin = pin.value;
      persist();
      updatePreview();
    });
    detail.append(pin);
  } else {
    const pips = document.createElement("span");
    pips.className = "led-pips";
    const count = Math.max(1, Number(lamp.count) || 1);
    for (let index = 0; index < count; index += 1) {
      const pip = document.createElement("button");
      pip.type = "button";
      pip.className = "pip";
      pip.title = count > 1 ? "Remove one LED from this lamp" : "One LED";
      pip.setAttribute("aria-label", count > 1 ? "Remove one LED from this lamp" : "One LED");
      pip.addEventListener("click", () => {
        if (lamp.count <= 1) return;
        lamp.count -= 1;
        persist();
        render();
      });
      pips.append(pip);
    }
    const addLed = document.createElement("button");
    addLed.type = "button";
    addLed.className = "mini";
    addLed.textContent = "Add";
    addLed.addEventListener("click", () => {
      lamp.count = Math.min(32, (Number(lamp.count) || 1) + 1);
      persist();
      render();
    });
    detail.append(pips, addLed);
  }

  const order = document.createElement("div");
  order.className = "lamp-order";
  const up = document.createElement("button");
  up.type = "button";
  up.className = "mini";
  up.textContent = "Up";
  up.addEventListener("click", () => moveLamp(mast, lampIndex, lampIndex - 1));
  const down = document.createElement("button");
  down.type = "button";
  down.className = "mini";
  down.textContent = "Down";
  down.addEventListener("click", () => moveLamp(mast, lampIndex, lampIndex + 1));
  const drop = document.createElement("button");
  drop.type = "button";
  drop.className = "mini remove";
  drop.textContent = "Remove";
  drop.addEventListener("click", () => {
    mast.lamps.splice(lampIndex, 1);
    for (const aspect of mast.aspects) aspect.lamps.splice(lampIndex, 1);
    persist();
    render();
  });
  order.append(up, down, drop);
  bindDrop(nameCell);
  bindDrop(detail);
  bindDrop(order);
  editor.append(nameCell, detail, order);
  return editor;
}

function renderSignalCell(cell, gpio) {
  const wrap = document.createElement("div");
  wrap.className = "signal-cell";
  const swatches = document.createElement("div");
  swatches.className = "swatches";
  const colors = gpio ? ["off", "white"] : SIGNAL_COLOR_ORDER;
  for (const color of colors) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch";
    const label = gpio && color === "white" ? "On" : COLOR_LABELS[color];
    button.title = label;
    button.setAttribute("aria-label", label);
    button.style.background = swatchHex(color);
    if (color === "white") button.classList.add("is-white");
    const selected = gpio ? (color === "off" ? cell.color === "off" : cell.color !== "off") : cell.color === color;
    if (selected) {
      button.classList.add("is-selected");
      if (cell.mode === "blink") button.classList.add("is-blink");
      if (cell.mode === "pulse") button.classList.add("is-pulse");
    }
    button.addEventListener("click", () => {
      cell.color = color;
      if (color === "off") cell.mode = "steady";
      persist();
      render();
    });
    swatches.append(button);
  }
  wrap.append(swatches);
  if (cell.color !== "off") {
    const modes = document.createElement("div");
    modes.className = "modes";
    for (const mode of ["steady", "blink", "pulse"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mode";
      if (cell.mode === mode) button.classList.add("is-selected");
      button.textContent = mode.charAt(0).toUpperCase() + mode.slice(1);
      button.addEventListener("click", () => {
        cell.mode = mode;
        persist();
        render();
      });
      modes.append(button);
    }
    wrap.append(modes);
  }
  return wrap;
}

function renderSignals() {
  const signals = state.signals;
  const anyStrip = signals.masts.some((mast) => mast.mode !== "gpio");
  const showStripHelp = signals.masts.length === 0 || anyStrip;
  document.getElementById("signal-sample").hidden = !showStripHelp;

  el.signalsList.replaceChildren();
  signals.masts.forEach((mast, mastIndex) => {
    const gpio = mast.mode === "gpio";
    syncAspectCells(mast);
    const card = document.createElement("div");
    card.className = "row-card";
    const header = document.createElement("header");
    const title = document.createElement("h3");
    title.textContent = mast.name || `Mast ${mastIndex + 1}`;
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      signals.masts.splice(mastIndex, 1);
      persist();
      render();
    });
    actions.append(remove);
    header.append(title, actions);

    const fields = document.createElement("div");
    fields.className = "fields";
    const topicField = field("MQTT topic", mast.topic, (v) => {
      mast.topic = v;
      mast.topicCustom = v !== topicFor("signal", mast.name);
      persist();
      updatePreview();
    }, {
      full: true,
      hint: "JMRI signal mast topic.",
    });
    topicField.querySelector("input").dataset.role = "topic";
    fields.append(
      field("Name", mast.name, (v) => {
        mast.name = v;
        title.textContent = v || `Mast ${mastIndex + 1}`;
        followName(mast, "signal", card);
        persist();
        updatePreview();
      }, {
        placeholder: "KJN-42.26",
        full: true,
        hint: "Name in the logs. The topic is filled in from this.",
      }),
      topicField,
      field("Drive", gpio ? "gpio" : "addressable", (v) => {
        mast.mode = v === "gpio" ? "gpio" : "addressable";
        if (mast.mode === "gpio") {
          for (const lamp of mast.lamps) {
            if (!lamp.pin) lamp.pin = nextServoPin();
          }
        }
        persist();
        render();
      }, {
        select: [
          { value: "addressable", label: "Addressable LEDs" },
          { value: "gpio", label: "Individual LEDs" },
        ],
        hint: gpio
          ? "Each lamp is one GPIO. The LED’s colour is whatever you wired."
          : "This mast has its own WS2812B strip. The first lamp is LED 0.",
      })
    );
    if (!gpio) {
      fields.append(
        field("Data pin", mast.pin, (v) => {
          mast.pin = v;
          persist();
          updatePreview();
        }, {
          select: pinChoices(),
          hint: "GPIO the data line uses. LEDs run from 0.",
        })
      );
    }

    const aspects = document.createElement("div");
    aspects.className = "aspects";
    const lampHint = document.createElement("p");
    lampHint.className = "hint";
    lampHint.textContent = gpio
      ? "Each row is one lamp. Each column is an aspect."
      : "Each row is one lamp, wired from the base. The first row is LED 0. Each column is an aspect.";
    aspects.append(lampHint);
    syncAspectCells(mast);

    const board = document.createElement("div");
    board.className = "mast-board";
    const detailWidth = gpio ? "minmax(6.2rem, 8rem)" : "minmax(4.5rem, 6.5rem)";
    const lampsPane = document.createElement("div");
    lampsPane.className = "mast-lamps";
    lampsPane.style.gridTemplateColumns = `minmax(7.5rem, 9rem) ${detailWidth} max-content`;
    const scroll = document.createElement("div");
    scroll.className = "mast-scroll";
    if (mast.aspects.length) {
      scroll.style.gridTemplateColumns = `repeat(${mast.aspects.length}, minmax(12rem, 14rem))`;
    }
    board.style.gridTemplateRows = `repeat(${mast.lamps.length + 1}, auto)`;
    const heads = document.createElement("div");
    heads.className = "lamp-editor lamp-head";
    heads.append(
      colHead("Lamp"),
      colHead(gpio ? "Pin" : "LEDs"),
      colHead("Order"),
    );
    lampsPane.append(heads);
    mast.aspects.forEach((aspect, aspectIndex) => {
      const head = document.createElement("div");
      head.className = "aspect-head";
      const label = document.createElement("input");
      label.type = "text";
      label.value = aspect.label;
      label.placeholder = "Stop";
      label.setAttribute("aria-label", "Aspect name");
      label.addEventListener("input", () => {
        aspect.label = label.value;
        persist();
        updatePreview();
      });
      const dropAspect = document.createElement("button");
      dropAspect.type = "button";
      dropAspect.className = "mini remove";
      dropAspect.textContent = "Remove";
      dropAspect.addEventListener("click", () => {
        mast.aspects.splice(aspectIndex, 1);
        persist();
        render();
      });
      const nameRow = document.createElement("div");
      nameRow.className = "match-row";
      nameRow.append(label, dropAspect);
      head.append(labeledControl("Aspect", nameRow));
      const startup = document.createElement("label");
      startup.className = "check";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = aspect.startup === true;
      box.addEventListener("change", () => {
        const on = box.checked;
        for (const other of mast.aspects) other.startup = false;
        aspect.startup = on;
        persist();
        render();
      });
      const startupText = document.createElement("span");
      startupText.className = "check-copy";
      startupText.textContent = "Show at startup";
      startup.append(box, startupText);
      head.append(startup);
      aspect.states.forEach((state, stateIndex) => {
        const row = document.createElement("div");
        row.className = "match-row";
        const input = document.createElement("input");
        input.type = "text";
        input.value = state;
        input.placeholder = "R292; Lit; Unheld";
        input.setAttribute("aria-label", stateIndex === 0 ? "JMRI aspect" : "Also match");
        input.addEventListener("input", () => {
          aspect.states[stateIndex] = input.value;
          persist();
          updatePreview();
        });
        row.append(input);
        if (stateIndex > 0) {
          const removeMatch = document.createElement("button");
          removeMatch.type = "button";
          removeMatch.className = "mini remove";
          removeMatch.textContent = "Remove";
          removeMatch.addEventListener("click", () => {
            aspect.states.splice(stateIndex, 1);
            persist();
            render();
          });
          row.append(removeMatch);
        }
        head.append(labeledControl(stateIndex === 0 ? "JMRI aspect" : "Also match", row));
      });
      const also = document.createElement("button");
      also.type = "button";
      also.className = "mini text";
      also.textContent = "Also match";
      also.addEventListener("click", () => {
        aspect.states.push("");
        persist();
        render();
      });
      head.append(also, colHead("Colour"));
      scroll.append(head);
    });

    if (!mast.lamps.length) {
      const starters = document.createElement("div");
      starters.className = "starters";
      starters.style.gridColumn = "1 / -1";
      for (const starter of LAMP_STARTERS) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = starter.label;
        button.addEventListener("click", () => {
          mast.lamps = [];
          for (const lamp of starter.lamps) {
            mast.lamps.push({
              name: lamp.name,
              count: gpio ? 1 : lamp.count,
              pin: gpio ? nextServoPin() : "",
            });
          }
          syncAspectCells(mast);
          persist();
          render();
        });
        starters.append(button);
      }
      board.append(starters);
    }

    mast.lamps.forEach((lamp, lampIndex) => {
      lampsPane.append(renderLampEditor(mast, lamp, lampIndex, gpio));
      mast.aspects.forEach((aspect) => {
        scroll.append(renderSignalCell(aspect.lamps[lampIndex], gpio));
      });
    });
    if (mast.lamps.length || mast.aspects.length) board.append(lampsPane, scroll);
    aspects.append(board);

    const usedStates = new Set();
    for (const aspect of mast.aspects) {
      for (const item of aspect.states) usedStates.add(String(item).trim());
    }
    const picker = document.createElement("div");
    picker.className = "aspect-add";
    const cats = document.createElement("select");
    cats.setAttribute("aria-label", "CATS aspect");
    const remaining = CATS_ASPECTS.filter((name) => !usedStates.has(catsAspectState(name)));
    if (!remaining.length) {
      const empty = document.createElement("option");
      empty.textContent = "All CATS aspects added";
      cats.append(empty);
      cats.disabled = true;
    } else {
      for (const name of remaining) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        cats.append(option);
      }
    }
    const addCats = document.createElement("button");
    addCats.type = "button";
    addCats.textContent = "Add CATS aspect";
    addCats.disabled = !remaining.length;
    addCats.addEventListener("click", () => {
      const name = cats.value;
      if (!name || usedStates.has(catsAspectState(name))) return;
      mast.aspects.push({
        label: name,
        states: [catsAspectState(name)],
        lamps: mast.lamps.map(() => ({ color: "off", mode: "steady" })),
      });
      persist();
      render();
    });
    const addAll = document.createElement("button");
    addAll.type = "button";
    addAll.textContent = "Add all CATS aspects";
    addAll.disabled = !remaining.length;
    addAll.addEventListener("click", () => {
      for (const name of CATS_ASPECTS) {
        const state = catsAspectState(name);
        if (usedStates.has(state)) continue;
        usedStates.add(state);
        mast.aspects.push({
          label: name,
          states: [state],
          lamps: mast.lamps.map(() => ({ color: "off", mode: "steady" })),
        });
      }
      persist();
      render();
    });
    const addAspect = document.createElement("button");
    addAspect.type = "button";
    addAspect.textContent = "Custom aspect";
    addAspect.addEventListener("click", () => {
      mast.aspects.push({
        label: `Aspect ${mast.aspects.length + 1}`,
        states: [""],
        lamps: mast.lamps.map(() => ({ color: "off", mode: "steady" })),
      });
      persist();
      render();
    });
    const addLamp = document.createElement("button");
    addLamp.type = "button";
    addLamp.textContent = "Add lamp";
    addLamp.addEventListener("click", () => {
      const used = new Set(mast.lamps.map((lamp) => lamp.name));
      let number = mast.lamps.length + 1;
      while (used.has(`Lamp ${number}`)) number += 1;
      mast.lamps.push({
        name: `Lamp ${number}`,
        count: 1,
        pin: gpio ? nextServoPin() : "",
      });
      syncAspectCells(mast);
      persist();
      render();
    });
    picker.append(addLamp, cats, addCats, addAll, addAspect);
    aspects.append(picker);

    card.append(header, fields, aspects);
    el.signalsList.append(card);
  });
}

function renderMessages() {
  const structural = el.messages.querySelectorAll(".msg:not(.toast)");
  structural.forEach((n) => n.remove());
  const { warnings, errors } = validateConfig(state);
  for (const err of errors) {
    const div = document.createElement("div");
    div.className = "msg err";
    div.textContent = err;
    el.messages.append(div);
  }
  for (const warn of warnings) {
    const div = document.createElement("div");
    div.className = "msg warn";
    div.textContent = warn;
    el.messages.append(div);
  }
  document.getElementById("btn-download").disabled = errors.length > 0;
}

function updatePreview() {
  el.preview.textContent = generateYaml(state);
  el.countBlocks.textContent = String(state.blocks.length);
  el.countPoints.textContent = String(state.points.length);
  el.countSignals.textContent = String(state.signals.masts.length);
  el.blocksEmpty.hidden = state.blocks.length > 0;
  el.pointsEmpty.hidden = state.points.length > 0;
  el.signalsEmpty.hidden = state.signals.masts.length > 0;
  document.getElementById("i2c-card").hidden = state.points.length === 0;
  el.directPwmNote.hidden = state.points.length === 0 || usesPca();
  renderMessages();
}

function render() {
  renderBoard();
  renderI2c();
  renderBlocks();
  renderPoints();
  renderSignals();
  updatePreview();
}

render();
