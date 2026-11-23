const {
  PULLUP_PINS,
  STRAPPING_PINS,
  NO_PULLUP_PINS,
  MAX_PCA_BOARDS,
  ensureSecrets,
  generatePassword,
  generateYaml,
  generateJmriXml,
  myFirstBoardPreset,
  normalizeConfig,
  parseConfigFromYaml,
  stateTopic,
  lockTopic,
  lockedTopic,
  topicFor,
  validateConfig,
  DEFAULT_MQTT_BROKER,
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

// What is wired to a point control. "switch" is the UI choice for a toggle
// switch; its stored action is latch-thrown, or latch-closed when reversed.
const CONTROL_KINDS = [
  { value: "toggle", label: "Push button: each press swaps the turnout" },
  { value: "closed", label: "Push button: always sets closed" },
  { value: "thrown", label: "Push button: always sets thrown" },
  { value: "switch", label: "Toggle switch: the turnout follows the switch" },
];

function isLatched(control) {
  return control.action === "latch-thrown" || control.action === "latch-closed";
}

const COLOR_LABELS = {
  off: "Off",
  red: "Red",
  amber: "Amber",
  green: "Green",
  white: "White",
};

const CRED_FIELDS = ["wifiSsid", "wifiPassword", "mqttBroker", "apPassword"];

let state = loadState() || myFirstBoardPreset();
normalizeConfig(state);
normalizeTopics(state);
applyCredentials(state, loadCredentials());
if (state.board.mqttEnabled !== false && !state.board.mqttBroker) {
  state.board.mqttBroker = DEFAULT_MQTT_BROKER;
}
ensureSecrets(state);
persist();

const el = {
  messages: document.getElementById("messages"),
  toasts: document.getElementById("toasts"),
  boardIdentity: document.getElementById("board-identity"),
  boardNetwork: document.getElementById("board-network"),
  hotspotFields: document.getElementById("hotspot-fields"),
  driverFields: document.getElementById("driver-fields"),
  addPoint: document.getElementById("btn-add-point"),
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
  button.addEventListener("click", (event) => {
    event.preventDefault();
    showView(button.dataset.goto);
    // A link can also point at one part of that page.
    if (button.dataset.scroll) document.getElementById(button.dataset.scroll)?.scrollIntoView({ block: "start" });
  });
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
  flash("ok", "Removed all sensors. Credentials kept.");
});

document.getElementById("btn-clear-creds").addEventListener("click", () => {
  clearCredentials();
  state.board.wifiSsid = "";
  state.board.wifiPassword = "";
  state.board.mqttBroker = DEFAULT_MQTT_BROKER;
  persist();
  render();
  flash("ok", "Cleared Wi-Fi. MQTT broker is layout-mqtt.local again.");
});

document.getElementById("btn-add-block").addEventListener("click", () => {
  const name = `Sensor ${state.blocks.length + 1}`;
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

// First free channel on a PCA9685, skipping `except` (a point being moved).
function nextChannel(pcaBoard, except) {
  const used = new Set(state.points
    .filter((p) => p !== except && (p.pcaBoard || 0) === pcaBoard)
    .map((p) => Number(p.channel)));
  let channel = 0;
  while (used.has(channel) && channel < 15) channel += 1;
  return channel;
}

function addPoint(pcaBoard = 0) {
  const name = `Turnout ${state.points.length + 1}`;
  state.points.push({
    name,
    topic: topicFor("point", name),
    topicCustom: false,
    pcaBoard,
    channel: nextChannel(pcaBoard),
    servoPin: usesPca() ? "" : nextServoPin(),
    travelTime: "10s",
    controls: [],
  });
  persist();
  render();
}

document.getElementById("btn-add-point").addEventListener("click", () => addPoint(0));

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

// The Device Builder only accepts writes from its own page, so this copies the
// YAML and opens it in a tab; the steps say where to paste.
const ESPHOME_URL = "http://localhost:6052/";

document.getElementById("btn-send-esphome").addEventListener("click", async () => {
  const { errors } = validateConfig(state);
  if (errors.length) {
    flash("err", errors.join(" "));
    return;
  }
  let copied = true;
  try {
    // Copy before opening the tab: the clipboard needs this page in focus.
    await navigator.clipboard.writeText(generateYaml(state));
  } catch {
    copied = false;
  }
  window.open(ESPHOME_URL, "esphome-device-builder", "noopener");
  const steps = document.getElementById("esphome-steps");
  document.getElementById("esphome-steps-lead").textContent = copied
    ? "The YAML is copied, and ESPHome is opening in a new tab. Paste it there:"
    : "Could not copy the YAML. Click Download YAML instead. In ESPHome, click Create device, open Advanced set up options, and choose Import from file.";
  for (const name of steps.querySelectorAll(".board-name")) name.textContent = state.board.name || "board";
  steps.hidden = false;
});

document.getElementById("btn-download-jmri").addEventListener("click", () => {
  const { xml } = generateJmriXml(state);
  const blob = new Blob([xml], { type: "application/xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${state.board.name || "board"}-jmri.xml`;
  a.click();
  URL.revokeObjectURL(url);
  flash("ok", `Downloaded ${a.download}. Load it in PanelPro with File → Load table content and panels.`);
});

document.getElementById("btn-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(generateYaml(state));
    flash("ok", "YAML copied to clipboard.");
  } catch {
    flash("err", "Could not copy — select the preview and copy manually.");
  }
});

// Load a configurator board.yaml, from a file or pasted from ESPHome.
// Returns false (after showing why) when the text is not one of ours.
function importText(text, source) {
  try {
    state = parseConfigFromYaml(text);
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
    flash("ok", `Imported ${source}.`);
    return true;
  } catch (err) {
    flash("err", err.message || String(err));
    return false;
  }
}

const importMenu = document.getElementById("import-menu-list");
const importButton = document.getElementById("btn-import");

function setImportMenu(open) {
  importMenu.hidden = !open;
  importButton.setAttribute("aria-expanded", String(open));
}

importButton.addEventListener("click", () => setImportMenu(importMenu.hidden));
document.addEventListener("click", (event) => {
  if (!document.getElementById("import-menu").contains(event.target)) setImportMenu(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setImportMenu(false);
});

el.importFile.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  setImportMenu(false);
  if (!file) return;
  importText(await file.text(), file.name);
});

const pasteDialog = document.getElementById("paste-dialog");
const pasteText = document.getElementById("paste-text");

document.getElementById("btn-import-paste").addEventListener("click", () => {
  setImportMenu(false);
  pasteText.value = "";
  pasteDialog.showModal();
  pasteText.focus();
});

pasteDialog.addEventListener("close", () => {
  if (pasteDialog.returnValue !== "import") return;
  if (!pasteText.value.trim()) return;
  if (!importText(pasteText.value, "the pasted YAML")) {
    // Keep the text so a near miss can be fixed instead of pasted again.
    pasteDialog.showModal();
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
  const lockInput = card.querySelector("[data-role=lock-topic]");
  if (lockInput) lockInput.value = lockTopic(item.topic);
  const lockedInput = card.querySelector("[data-role=locked-topic]");
  if (lockedInput) lockedInput.value = lockedTopic(item.topic);
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

function linkedField(labelText, value, hint, role = "state-topic") {
  const label = document.createElement("label");
  label.classList.add("full", "linked");
  const title = document.createElement("span");
  title.className = "field-label";
  title.textContent = labelText;
  const input = document.createElement("input");
  input.type = "text";
  input.disabled = true;
  input.value = value;
  input.dataset.role = role;
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
      if (option.disabled) o.disabled = true;
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

function blockPinChoices(current) {
  const choices = [
    ...pinChoices(),
    ...Object.entries(NO_PULLUP_PINS).map(([pin, silk]) => ({
      value: pin,
      label: silk === pin.slice(4) ? `${pin} (no pull-up)` : `${pin} (${silk}, no pull-up)`,
    })),
  ];
  const name = String(current || "").toUpperCase();
  if (name && !choices.some((choice) => choice.value === name)) {
    choices.push({ value: name, label: name });
  }
  return choices;
}

function usedPins() {
  const used = new Set();
  for (const block of state.blocks || []) {
    if (block.gpio) used.add(String(block.gpio).toUpperCase());
  }
  if ((state.points || []).length && usesPca()) {
    for (const pcaBoard of state.pcaBoards || []) {
      if (pcaBoard.sda) used.add(String(pcaBoard.sda).toUpperCase());
      if (pcaBoard.scl) used.add(String(pcaBoard.scl).toUpperCase());
    }
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
      field("MQTT broker", b.mqttBroker, (v) => setCredential("mqttBroker", v), {
        placeholder: DEFAULT_MQTT_BROKER,
        hint: "layout-mqtt.local is the name from the install script. A numeric address works here too.",
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

function renderDriver() {
  el.driverFields.replaceChildren(
    field("Use PCA9685 boards", usesPca(), (checked) => {
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
}

function renderBlocks() {
  el.blocksList.replaceChildren();
  state.blocks.forEach((block, index) => {
    const card = document.createElement("div");
    card.className = "row-card";
    const header = document.createElement("header");
    const title = document.createElement("h3");
    title.textContent = block.name || `Sensor ${index + 1}`;
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
        title.textContent = v || `Sensor ${index + 1}`;
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
        block.gpio = v;
        persist();
        updatePreview();
      }, {
        select: blockPinChoices(block.gpio),
        hint: "Pin this detector uses. VP, VN, 34, and 35 have no pull-up.",
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
  if (!usesPca()) {
    state.points.forEach((point, index) => el.pointsList.append(renderPointCard(point, index)));
    return;
  }
  state.pcaBoards.forEach((pcaBoard, b) => el.pointsList.append(renderPcaBoard(pcaBoard, b)));
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Add PCA9685";
  add.disabled = state.pcaBoards.length >= MAX_PCA_BOARDS;
  add.addEventListener("click", () => {
    const pcaBoard = { sda: nextServoPin(), scl: "" };
    state.pcaBoards.push(pcaBoard);
    pcaBoard.scl = nextServoPin();
    persist();
    render();
  });
  const addRow = document.createElement("div");
  addRow.className = "add-board";
  addRow.append(add, hintEl(`Each PCA9685 has its own SDA and SCL pins. An ESP32 has ${MAX_PCA_BOARDS} I2C buses, so ${MAX_PCA_BOARDS} boards at most.`));
  el.pointsList.append(addRow);
}

function i2cPinChoices(current) {
  const choices = pinChoices();
  const name = String(current || "").toUpperCase();
  if (name && !choices.some((choice) => choice.value === name)) choices.push({ value: name, label: name });
  return choices;
}

// One PCA9685: its I2C pins, then the points wired to it.
function renderPcaBoard(pcaBoard, b) {
  const card = document.createElement("div");
  card.className = "card servo-board";
  const header = document.createElement("header");
  const title = document.createElement("h3");
  title.textContent = `PCA9685 ${b + 1}`;
  header.append(title);
  if (b > 0) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "Remove board";
    remove.addEventListener("click", () => {
      // Its points move to PCA9685 1 rather than being deleted.
      for (const point of state.points) {
        const on = point.pcaBoard || 0;
        if (on === b) {
          point.pcaBoard = 0;
          point.channel = nextChannel(0, point);
        } else if (on > b) {
          point.pcaBoard = on - 1;
        }
      }
      state.pcaBoards.splice(b, 1);
      persist();
      render();
    });
    header.append(remove);
  }

  const fields = document.createElement("div");
  fields.className = "fields";
  fields.append(
    field("SDA pin", String(pcaBoard.sda || "").toUpperCase(), (v) => {
      pcaBoard.sda = v;
      persist();
      updatePreview();
    }, {
      select: i2cPinChoices(pcaBoard.sda),
      hint: "Data pin for this board.",
    }),
    field("SCL pin", String(pcaBoard.scl || "").toUpperCase(), (v) => {
      pcaBoard.scl = v;
      persist();
      updatePreview();
    }, {
      select: i2cPinChoices(pcaBoard.scl),
      hint: "Clock pin for this board.",
    })
  );

  const list = document.createElement("div");
  list.className = "board-points";
  let count = 0;
  state.points.forEach((point, index) => {
    if ((point.pcaBoard || 0) !== b) return;
    list.append(renderPointCard(point, index));
    count += 1;
  });
  if (!count) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No turnouts on this board yet.";
    list.append(empty);
  }
  const add = document.createElement("button");
  add.type = "button";
  add.className = "primary";
  add.textContent = "Add turnout";
  add.addEventListener("click", () => addPoint(b));
  list.append(add);

  card.append(header, fields, list);
  return card;
}

function renderPointCard(point, index) {
  const card = document.createElement("div");
  card.className = "row-card";
  const header = document.createElement("header");
  const title = document.createElement("h3");
  title.textContent = point.name || `Turnout ${index + 1}`;
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
    const lockInput = card.querySelector("[data-role=lock-topic]");
    if (lockInput) lockInput.value = lockTopic(point.topic);
    const lockedInput = card.querySelector("[data-role=locked-topic]");
    if (lockedInput) lockedInput.value = lockedTopic(point.topic);
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
      title.textContent = v || `Turnout ${index + 1}`;
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
    field("Remote lock", point.lockEnabled === true, (checked) => {
      point.lockEnabled = checked;
      if (point.lockDefault !== "locked") point.lockDefault = "unlocked";
      persist();
      render();
    }, {
      checkbox: true,
      hint: state.board.mqttEnabled === false
        ? "Saved until MQTT is turned back on. LOCKED holds this turnout. UNLOCKED lets it move."
        : "Listen on the Lock topic. LOCKED holds this turnout. UNLOCKED lets it move.",
    }),
    ...(point.lockEnabled === true ? [
      linkedField(
        "Lock topic",
        lockTopic(point.topic),
        "Publish LOCKED or UNLOCKED here.",
        "lock-topic"
      ),
      linkedField(
        "Lock report",
        lockedTopic(point.topic),
        "The board reports ACTIVE here while locked, INACTIVE when not. It is a JMRI sensor: in CATS, use it as the Turnout Locked Report.",
        "locked-topic"
      ),
      field("Default", point.lockDefault === "locked" ? "locked" : "unlocked", (v) => {
        point.lockDefault = v === "locked" ? "locked" : "unlocked";
        persist();
        updatePreview();
      }, {
        select: [
          { value: "unlocked", label: "Unlocked" },
          { value: "locked", label: "Locked" },
        ],
        hint: "How it starts after a reboot, until a lock message arrives.",
      }),
    ] : []),
    ...(usesPca() && state.pcaBoards.length > 1 ? [
      field("PCA9685", String(point.pcaBoard || 0), (v) => {
        point.pcaBoard = Number(v);
        const clash = state.points.some((p) => p !== point
          && (p.pcaBoard || 0) === point.pcaBoard && Number(p.channel) === Number(point.channel));
        if (clash) point.channel = nextChannel(point.pcaBoard, point);
        persist();
        render();
      }, {
        select: state.pcaBoards.map((_, b) => ({ value: String(b), label: `PCA9685 ${b + 1}` })),
        hint: "Which servo board this turnout is on.",
      }),
    ] : []),
    usesPca()
      ? field("PCA9685 channel (0–15)", point.channel, (v) => {
        point.channel = Number(v);
        persist();
        updatePreview();
      }, {
        type: "number",
        hint: "Which servo output this turnout uses.",
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
  return card;
}

function renderPanel(point) {
  if (!Array.isArray(point.controls)) point.controls = [];
  const panel = document.createElement("div");
  panel.className = "panel";
  const title = document.createElement("h4");
  title.textContent = "Panel";
  const intro = document.createElement("p");
  intro.className = "hint";
  intro.textContent = "Buttons, switches, and lights on the fascia.";
  panel.append(title, intro);

  point.controls.forEach((control, index) => {
    const card = document.createElement("div");
    card.className = "control-card";
    const latched = isLatched(control);
    const header = document.createElement("header");
    const label = document.createElement("h3");
    label.textContent = `${latched ? "Switch" : "Button"} ${index + 1}`;
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
    // One latched switch per point, so offer it only if no other control is one.
    const otherSwitch = point.controls.some((other, i) => i !== index && isLatched(other));
    fields.append(
      field("What's wired here?", latched ? "switch" : control.action || "toggle", (v) => {
        if (v !== "switch") control.action = v;
        else if (!latched) control.action = "latch-thrown";
        persist();
        render();
      }, {
        select: CONTROL_KINDS.map((kind) =>
          kind.value === "switch" && otherSwitch
            ? { ...kind, label: `${kind.label} (this turnout already has one)`, disabled: true }
            : kind),
        full: true,
        hint: latched
          ? "A switch stays where you put it. The point moves whenever the switch does, and follows it on boot."
          : "A push button springs back when you let go.",
      })
    );
    if (latched) {
      fields.append(
        field("Reverse the switch", control.action === "latch-closed", (v) => {
          control.action = v ? "latch-closed" : "latch-thrown";
          persist();
          updatePreview();
        }, {
          checkbox: true,
          hint: "Flip the switch and watch the turnout. If it goes the opposite way to what you expect, tick this box.",
        })
      );
    }
    fields.append(
      field(latched ? "Switch pin" : "Button pin", control.buttonPin, (v) => {
        control.buttonPin = v;
        persist();
        updatePreview();
      }, {
        select: pinChoices(),
        hint: `Wire the ${latched ? "switch" : "button"} between this pin and GND.`,
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
        hint: "On when the turnout is closed.",
      }),
      field("Open light", control.openLight || "", (v) => {
        control.openLight = v;
        persist();
        updatePreview();
      }, {
        select: lightOptions,
        hint: "On when the turnout is thrown.",
      })
    );
    card.append(header, fields);
    panel.append(card);
  });

  const add = document.createElement("button");
  add.type = "button";
  add.textContent = "Add button or switch";
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

// Which lamp each aspect's colour picker is editing. Not saved.
const selectedLamp = new WeakMap();

function lampCount(lamp) {
  return Math.max(1, Number(lamp.count) || 1);
}

function lampLabel(lamp, lampIndex) {
  return String(lamp.name || "").trim() || `Lamp ${lampIndex + 1}`;
}

// LEDs run from the base, so a lamp's LEDs start after every lamp below it.
function ledRange(mast, lampIndex) {
  let start = 0;
  for (let index = 0; index < lampIndex; index += 1) start += lampCount(mast.lamps[index]);
  const count = lampCount(mast.lamps[lampIndex]);
  return count > 1 ? `LED ${start}–${start + count - 1}` : `LED ${start}`;
}

function miniButton(text, label, onClick, className = "mini") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", onClick);
  return button;
}

function colorName(color, gpio) {
  if (gpio) return color === "off" ? "Off" : "On";
  return COLOR_LABELS[color] || color;
}

function renderLampRow(mast, lampIndex, gpio) {
  const lamp = mast.lamps[lampIndex];
  const row = document.createElement("div");
  row.className = "lamp-row";

  const where = document.createElement("span");
  where.className = "lamp-where";
  where.textContent = gpio ? "" : ledRange(mast, lampIndex);

  const name = document.createElement("input");
  name.type = "text";
  name.value = lamp.name;
  name.placeholder = "Top";
  name.setAttribute("aria-label", "Lamp name");
  name.addEventListener("input", () => {
    lamp.name = name.value;
    persist();
    updatePreview();
  });

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
    const count = lampCount(lamp);
    const fewer = miniButton("−", "One LED fewer", () => {
      lamp.count = Math.max(1, count - 1);
      persist();
      render();
    });
    fewer.disabled = count <= 1;
    const shown = document.createElement("span");
    shown.className = "lamp-count";
    shown.textContent = `${count} LED${count === 1 ? "" : "s"}`;
    const more = miniButton("+", "One LED more", () => {
      lamp.count = Math.min(32, count + 1);
      persist();
      render();
    });
    detail.append(fewer, shown, more);
  }

  const order = document.createElement("div");
  order.className = "lamp-order";
  const up = miniButton("↑", "Move up the mast", () => moveLamp(mast, lampIndex, lampIndex + 1));
  up.disabled = lampIndex === mast.lamps.length - 1;
  const down = miniButton("↓", "Move down the mast", () => moveLamp(mast, lampIndex, lampIndex - 1));
  down.disabled = lampIndex === 0;
  const remove = miniButton("Remove", "Remove this lamp", () => {
    mast.lamps.splice(lampIndex, 1);
    for (const aspect of mast.aspects) aspect.lamps.splice(lampIndex, 1);
    persist();
    render();
  }, "mini remove");
  order.append(up, down, remove);

  if (gpio) row.classList.add("is-gpio");
  else row.append(where);
  row.append(name, detail, order);
  return row;
}

// JMRI sends "<aspect>; Lit; Unheld" for a lit, unheld mast, so show just the name.
function friendlyState(state) {
  return String(state || "").trim().replace(/; Lit; Unheld$/, "");
}

function renderAspectCard(mast, aspect, aspectIndex, gpio) {
  const card = document.createElement("div");
  card.className = "aspect-card";

  // The picture: lamps top of the mast first. Click one to edit it.
  const picture = document.createElement("div");
  picture.className = "mini-mast";
  let selected = selectedLamp.get(aspect);
  if (!Number.isInteger(selected) || selected >= mast.lamps.length) selected = mast.lamps.length - 1;
  for (let index = mast.lamps.length - 1; index >= 0; index -= 1) {
    const cell = aspect.lamps[index];
    const lamp = mast.lamps[index];
    const label = `${lampLabel(lamp, index)}: ${colorName(cell.color, gpio)}${cell.color === "off" ? "" : `, ${cell.mode}`}`;
    const button = miniButton("", label, () => {
      selectedLamp.set(aspect, index);
      render();
    }, "mini-lamp");
    button.style.background = cell.color === "off" ? "" : swatchHex(gpio ? "white" : cell.color);
    if (cell.color === "off") button.classList.add("is-off");
    else if (cell.mode !== "steady") button.classList.add(`is-${cell.mode}`);
    if (index === selected) button.classList.add("is-selected");
    if (!gpio && lampCount(lamp) > 1) button.style.width = `${0.75 + 0.42 * lampCount(lamp)}rem`;
    picture.append(button);
  }

  const body = document.createElement("div");
  body.className = "aspect-body";

  const top = document.createElement("div");
  top.className = "aspect-top";
  const name = document.createElement("input");
  name.type = "text";
  name.value = aspect.label;
  name.placeholder = "Stop";
  name.setAttribute("aria-label", "Aspect name");
  name.addEventListener("input", () => {
    aspect.label = name.value;
    persist();
    updatePreview();
  });
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
  startupText.textContent = "Show at startup";
  startup.append(box, startupText);
  const remove = miniButton("Remove", "Remove this aspect", () => {
    mast.aspects.splice(aspectIndex, 1);
    persist();
    render();
  }, "mini remove");
  top.append(name, startup, remove);
  body.append(top);

  // Colour and effect for the lamp picked in the picture.
  if (mast.lamps.length) {
    const cell = aspect.lamps[selected];
    const picker = document.createElement("div");
    picker.className = "lamp-picker";
    const which = document.createElement("span");
    which.className = "lamp-picker-name";
    which.textContent = lampLabel(mast.lamps[selected], selected);
    const swatches = document.createElement("div");
    swatches.className = "swatches";
    for (const color of gpio ? ["off", "white"] : SIGNAL_COLOR_ORDER) {
      const isOn = gpio ? (color === "off") === (cell.color === "off") : cell.color === color;
      const button = miniButton("", colorName(color, gpio), () => {
        cell.color = color;
        if (color === "off") cell.mode = "steady";
        persist();
        render();
      }, "swatch-btn");
      const dot = document.createElement("span");
      dot.className = "swatch";
      dot.style.background = swatchHex(color);
      if (color === "white") dot.classList.add("is-white");
      button.append(dot, colorName(color, gpio));
      if (isOn) button.classList.add("is-selected");
      swatches.append(button);
    }
    picker.append(which, swatches);
    if (cell.color !== "off") {
      const modes = document.createElement("div");
      modes.className = "modes";
      for (const mode of ["steady", "blink", "pulse"]) {
        const button = miniButton(mode.charAt(0).toUpperCase() + mode.slice(1), `${mode} lamp`, () => {
          cell.mode = mode;
          persist();
          render();
        }, "mode");
        if (cell.mode === mode) button.classList.add("is-selected");
        modes.append(button);
      }
      picker.append(modes);
    }
    body.append(picker);
  }

  // Which JMRI messages show this aspect. Tucked away unless it needs filling in.
  const match = document.createElement("details");
  match.className = "jmri-match";
  const filled = aspect.states.map(friendlyState).filter(Boolean);
  match.open = filled.length === 0;
  const summary = document.createElement("summary");
  summary.textContent = filled.length ? `JMRI aspect: ${filled.join(", ")}` : "JMRI aspect: not set";
  match.append(summary);
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "JMRI sends the aspect name, then Lit or Unlit, then Held or Unheld, e.g. R292; Lit; Unheld. The mast shows this aspect when a message matches one of these.";
  match.append(hint);
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
      row.append(miniButton("Remove", "Stop matching this", () => {
        aspect.states.splice(stateIndex, 1);
        persist();
        render();
      }, "mini remove"));
    }
    match.append(row);
  });
  match.append(miniButton("Also match…", "Match another JMRI message", () => {
    aspect.states.push("");
    persist();
    render();
  }, "mini text"));
  body.append(match);

  card.append(picture, body);
  return card;
}

function renderSignals() {
  const signals = state.signals;
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
          : "This mast has its own WS2812B strip. The lowest lamp is LED 0.",
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

    // Lamps, top of the mast first. LED 0 (or the first lamp) is at the base.
    const lampsHead = document.createElement("h4");
    lampsHead.textContent = "Lamps";
    const lampHint = document.createElement("p");
    lampHint.className = "hint";
    lampHint.textContent = gpio
      ? "Top of the mast first. Each lamp has its own pin."
      : "Top of the mast first. The strip starts at the lowest lamp, LED 0. A lamp can be several LEDs, such as a three-LED route indicator.";
    const addLamp = document.createElement("button");
    addLamp.type = "button";
    addLamp.textContent = mast.lamps.length ? "Add lamp at the top" : "Add lamp";
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
    const lampList = document.createElement("div");
    lampList.className = "lamp-list";
    for (let index = mast.lamps.length - 1; index >= 0; index -= 1) {
      lampList.append(renderLampRow(mast, index, gpio));
    }
    aspects.append(lampsHead, lampHint, addLamp, lampList);

    const aspectsHead = document.createElement("h4");
    aspectsHead.textContent = "Aspects";
    const aspectHint = document.createElement("p");
    aspectHint.className = "hint";
    aspectHint.textContent = mast.lamps.length
      ? "What the mast shows for each aspect. Click a lamp in the picture to set its colour."
      : "Add the lamps first, then set what each aspect shows.";
    aspects.append(aspectsHead, aspectHint);
    const aspectList = document.createElement("div");
    aspectList.className = "aspect-list";
    mast.aspects.forEach((aspect, aspectIndex) => {
      aspectList.append(renderAspectCard(mast, aspect, aspectIndex, gpio));
    });
    aspects.append(aspectList);

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
    // An aspect needs lamps to light, so adding one waits for the first lamp.
    if (!mast.lamps.length) {
      for (const control of [cats, addCats, addAll, addAspect]) control.disabled = true;
    }
    picker.append(cats, addCats, addAll, addAspect);
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
  renderJmriSummary();
  el.blocksEmpty.hidden = state.blocks.length > 0;
  el.pointsEmpty.hidden = state.points.length > 0;
  el.signalsEmpty.hidden = state.signals.masts.length > 0;
  el.addPoint.hidden = usesPca();
  el.pointsEmpty.hidden = usesPca() || state.points.length > 0;
  el.directPwmNote.hidden = state.points.length === 0 || usesPca();
  renderMessages();
}

function renderJmriSummary() {
  const { counts, skipped } = generateJmriXml(state);
  const total = counts.sensors + counts.turnouts + counts.masts;
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const summary = document.getElementById("jmri-summary");
  if (state.board.mqttEnabled === false) {
    summary.textContent = "MQTT is off for this board, so nothing here talks to JMRI.";
  } else {
    summary.textContent = `${plural(counts.sensors, "sensor")}, ${plural(counts.turnouts, "turnout")}, and ${plural(counts.masts, "signal mast")}.`;
  }
  const list = document.getElementById("jmri-skipped");
  list.replaceChildren(...skipped.map((text) => {
    const item = document.createElement("li");
    item.textContent = `Left out: ${text}.`;
    return item;
  }));
  list.hidden = skipped.length === 0;
  document.getElementById("btn-download-jmri").disabled = total === 0;
}

function render() {
  renderBoard();
  renderDriver();
  renderBlocks();
  renderPoints();
  renderSignals();
  updatePreview();
}

render();
