const {
  PULLUP_PINS,
  STRAPPING_PINS,
  ensureSecrets,
  generateApiKey,
  generatePassword,
  generateYaml,
  myFirstBoardPreset,
  normalizeConfig,
  parseConfigFromYaml,
  stateTopic,
  topicFor,
  validateConfig,
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

const CRED_FIELDS = ["wifiSsid", "wifiPassword", "mqttBroker", "otaPassword", "apPassword", "apiKey"];

let state = loadState() || myFirstBoardPreset();
normalizeConfig(state);
normalizeTopics(state);
applyCredentials(state, loadCredentials());
ensureOtaPassword();
ensureSecrets(state);
persist();

const el = {
  messages: document.getElementById("messages"),
  toasts: document.getElementById("toasts"),
  boardIdentity: document.getElementById("board-identity"),
  boardNetwork: document.getElementById("board-network"),
  hotspotFields: document.getElementById("hotspot-fields"),
  apiFields: document.getElementById("api-fields"),
  i2cFields: document.getElementById("i2c-fields"),
  blocksList: document.getElementById("blocks-list"),
  pointsList: document.getElementById("points-list"),
  preview: document.getElementById("yaml-preview"),
  importFile: document.getElementById("import-file"),
  countBlocks: document.getElementById("count-blocks"),
  countPoints: document.getElementById("count-points"),
  blocksEmpty: document.getElementById("blocks-empty"),
  pointsEmpty: document.getElementById("points-empty"),
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
  state.board.otaPassword = generateOtaPassword();
  persist();
  render();
  flash("ok", "Cleared Wi-Fi and MQTT broker. Generated a new OTA password.");
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
    travelTime: "10s",
    controls: [],
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
    ensureOtaPassword();
    ensureSecrets(state);
    saveCredentials(extractCredentials(state.board));
    persist();
    render();
    flash("ok", `Imported ${file.name}.`);
  } catch (err) {
    flash("err", err.message || String(err));
  }
});

function generateOtaPassword() {
  return generatePassword();
}

function ensureOtaPassword() {
  if (!state.board.otaPassword) {
    state.board.otaPassword = generateOtaPassword();
    saveCredentials(state.board);
  }
}

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
    otaPassword: board.otaPassword || "",
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
  if ((state.points || []).length) {
    if (state.i2c?.sda) used.add(String(state.i2c.sda).toUpperCase());
    if (state.i2c?.scl) used.add(String(state.i2c.scl).toUpperCase());
  }
  for (const point of state.points || []) {
    for (const control of point.controls || []) {
      if (control.buttonPin) used.add(String(control.buttonPin).toUpperCase());
      if (control.closedLight) used.add(String(control.closedLight).toUpperCase());
      if (control.openLight) used.add(String(control.openLight).toUpperCase());
    }
  }
  return used;
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
  const options = MODULES.slice();
  if (state.board.module === "esp32-s3-devkitc-1") {
    options.push({
      id: "esp32-s3-devkitc-1",
      title: "ESP32-S3 (older file)",
      detail: "This file was made for an ESP32-S3. The YAML still uses variant esp32s3.",
      src: "",
      alt: "",
    });
  }

  const wrap = document.createElement("div");
  wrap.className = "module-field";
  const label = document.createElement("label");
  const title = document.createElement("span");
  title.className = "field-label";
  title.textContent = "Board";
  const select = document.createElement("select");
  select.setAttribute("aria-describedby", "module-tip");
  for (const mod of options) {
    const option = document.createElement("option");
    option.value = mod.id;
    option.textContent = mod.title;
    if (mod.id === state.board.module) option.selected = true;
    select.append(option);
  }
  const tip = document.createElement("div");
  tip.id = "module-tip";
  tip.className = "module-tip";
  tip.hidden = true;
  tip.setAttribute("role", "tooltip");

  function selectedModule() {
    return options.find((mod) => mod.id === select.value) || options[0];
  }

  function showTip() {
    const mod = selectedModule();
    tip.replaceChildren();
    if (mod.src) {
      const img = document.createElement("img");
      img.src = mod.src;
      img.alt = mod.alt;
      tip.append(img);
    }
    const caption = document.createElement("p");
    caption.textContent = mod.detail;
    tip.append(caption);
    if (mod.src) {
      const pins = document.createElement("p");
      pins.textContent = "Amber pins cannot be used for buttons.";
      tip.append(pins);
    }
    tip.hidden = false;
  }

  let hideTimer;
  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      tip.hidden = true;
    }, 180);
  };
  const cancelHide = () => clearTimeout(hideTimer);

  select.addEventListener("change", () => {
    state.board.module = select.value;
    persist();
    updatePreview();
    cancelHide();
    showTip();
  });
  select.addEventListener("focus", () => {
    cancelHide();
    showTip();
  });
  select.addEventListener("blur", scheduleHide);
  select.addEventListener("pointerenter", () => {
    cancelHide();
    showTip();
  });
  select.addEventListener("pointerleave", scheduleHide);
  tip.addEventListener("pointerenter", cancelHide);
  tip.addEventListener("pointerleave", scheduleHide);

  label.append(
    title,
    select,
    hintEl("Which header you have.")
  );
  wrap.append(label, tip);
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
    field("MQTT broker IP", b.mqttBroker, (v) => setCredential("mqttBroker", v), {
      placeholder: "192.168.1.10",
      hint: "Address of the computer running the MQTT broker (such as Mosquitto).",
    })
  );
  const otaField = field("OTA password", b.otaPassword, (v) => setCredential("otaPassword", v), {
    placeholder: "Generated automatically",
    hint: "Three easy words for later wireless updates.",
  });
  const regen = document.createElement("button");
  regen.type = "button";
  regen.className = "text";
  regen.textContent = "Generate new";
  regen.addEventListener("click", () => {
    state.board.otaPassword = generateOtaPassword();
    persist();
    render();
    flash("ok", "New OTA password saved. Flash the board again before the next wireless update.");
  });
  const otaRow = document.createElement("div");
  otaRow.className = "ota-row";
  otaRow.append(otaField, regen);
  el.boardNetwork.append(otaRow);

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

  const keyField = field("Encryption key", b.apiKey, (v) => {
    b.apiKey = v.trim();
    persist();
    if (state.board.apiKey !== v.trim()) render();
    else updatePreview();
  }, {
    spellcheck: false,
    autocomplete: "off",
    hint: "Key ESPHome asks for to connect.",
  });
  el.apiFields.replaceChildren(secretRow(keyField, "Generate new", () => {
    state.board.apiKey = generateApiKey();
    persist();
    render();
    flash("ok", "New API key saved. Home Assistant will ask for this key.");
  }));
}

function renderI2c() {
  el.i2cFields.replaceChildren();
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
      field("A train in the block makes this wire read 0 volts", block.inverted, (v) => {
        block.inverted = v;
        persist();
        updatePreview();
      }, {
        checkbox: true,
        hint: "Occupied when the pin is low.",
      })
    );
    card.append(header, fields);
    el.blocksList.append(card);
  });
}

function renderPoints() {
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
      field("PCA9685 channel (0–15)", point.channel, (v) => {
        point.channel = Number(v);
        persist();
        updatePreview();
      }, {
        type: "number",
        hint: "Which servo output this point uses.",
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
  el.blocksEmpty.hidden = state.blocks.length > 0;
  el.pointsEmpty.hidden = state.points.length > 0;
  document.getElementById("i2c-card").hidden = state.points.length === 0;
  renderMessages();
}

function render() {
  renderBoard();
  renderI2c();
  renderBlocks();
  renderPoints();
  updatePreview();
}

render();
