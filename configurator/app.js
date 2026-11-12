const {
  MIN_ESPHOME_VERSION,
  emptyConfig,
  generateYaml,
  myFirstBoardPreset,
  parseConfigFromYaml,
  stateTopic,
  topicFor,
  validateConfig,
} = globalThis.EsphomeMr;

const STORAGE_KEY = "esphome-mr-configurator-v1";
const CREDENTIALS_KEY = "esphome-mr-credentials-v1";

const boardTypeOptions = [
  "nodemcu-32s",
  "esp32dev",
  "esp32-s3-devkitc-1",
];

const CRED_FIELDS = ["wifiSsid", "wifiPassword", "mqttBroker", "otaPassword"];

let state = loadState() || myFirstBoardPreset();
normalizeTopics(state);
applyCredentials(state, loadCredentials());
ensureOtaPassword();
persist();

const el = {
  messages: document.getElementById("messages"),
  toasts: document.getElementById("toasts"),
  boardIdentity: document.getElementById("board-identity"),
  boardNetwork: document.getElementById("board-network"),
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

document.getElementById("btn-preset").addEventListener("click", () => {
  state = myFirstBoardPreset();
  applyCredentials(state, loadCredentials());
  persist();
  render();
  flash("ok", "Loaded My First Board preset (saved credentials kept).");
});

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
    const fromFile = extractCredentials(state.board);
    const saved = loadCredentials();
    const merged = {
      wifiSsid: fromFile.wifiSsid || saved.wifiSsid || "",
      wifiPassword: fromFile.wifiPassword || saved.wifiPassword || "",
      mqttBroker: fromFile.mqttBroker || saved.mqttBroker || "",
      otaPassword: fromFile.otaPassword || saved.otaPassword || "",
    };
    applyCredentials(state, merged);
    ensureOtaPassword();
    saveCredentials(extractCredentials(state.board));
    persist();
    render();
    flash("ok", `Imported ${file.name}.`);
  } catch (err) {
    flash("err", err.message || String(err));
  }
});

function generateOtaPassword() {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
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
    target.board[key] = c[key] || "";
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
      const o = document.createElement("option");
      o.value = option;
      o.textContent = option;
      if (option === value) o.selected = true;
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

function renderBoard() {
  const b = state.board;
  el.boardIdentity.replaceChildren(
    field("Board name", b.name, (v) => {
      b.name = v.trim();
      persist();
      updatePreview();
    }, {
      placeholder: "yard-board-01",
      hint: "Name in ESPHome Dashboard and the address for wireless updates. Lowercase letters, numbers, and dashes only.",
    }),
    field("ESP32 board", b.boardType, (v) => {
      b.boardType = v;
      persist();
      updatePreview();
    }, {
      select: boardTypeOptions,
      hint: "Must match the module you bought. The 38-pin board in the README is nodemcu-32s.",
    })
  );
  el.boardNetwork.replaceChildren(
    field("Wi-Fi name", b.wifiSsid, (v) => setCredential("wifiSsid", v), {
      placeholder: "2.4 GHz network",
      hint: "The network the ESP joins. These boards cannot use 5 GHz.",
    }),
    field("Wi-Fi password", b.wifiPassword, (v) => setCredential("wifiPassword", v), {
      type: "password",
      hint: "Written into the downloaded YAML and remembered in this browser.",
    }),
    field("MQTT broker IP", b.mqttBroker, (v) => setCredential("mqttBroker", v), {
      placeholder: "192.168.1.10",
      hint: "The address of this computer on your network — the machine running Mosquitto. Windows: ipconfig. Mac: System Settings → Network. Not localhost. JMRI uses the same address.",
    })
  );
  const otaField = field("OTA password", b.otaPassword, (v) => setCredential("otaPassword", v), {
    placeholder: "Generated automatically",
    hint: "ESPHome asks for this on later wireless installs. Leave it alone unless you reflash by USB.",
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
      hint: "Data wire from the ESP to the PCA9685. GPIO21 is the default. Do not also use this pin for a detector.",
    }),
    field("I2C SCL (PCA9685)", state.i2c.scl, (v) => {
      state.i2c.scl = v.trim() || "GPIO22";
      persist();
      updatePreview();
    }, {
      hint: "Clock wire to the PCA9685. GPIO22 is the default on this board.",
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
      hint: "Filled in from the name: trains/track/sensor/ plus the name. Change it if JMRI listens on a different topic.",
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
        hint: "Shown in ESPHome logs, for example “Kiama/Up XOver | OCCUPIED”. It does not have to match the JMRI name. The MQTT topic below is filled in from this.",
      }),
      topicField,
      field("GPIO", block.gpio, (v) => {
        block.gpio = v.trim().toUpperCase();
        persist();
        updatePreview();
      }, {
        placeholder: "GPIO14",
        hint: "ESP32 pin the detector output is wired to. Each block needs its own pin.",
      }),
      field("Debounce", block.debounce, (v) => {
        block.debounce = v.trim() || "500ms";
        persist();
        updatePreview();
      }, {
        placeholder: "500ms",
        hint: "How long the signal must stay steady before it counts. Stops electrical noise flipping occupied and clear. 500ms suits most layouts.",
      }),
      field("A train in the block makes this wire read 0 volts", block.inverted, (v) => {
        block.inverted = v;
        persist();
        updatePreview();
      }, {
        checkbox: true,
        hint: "Leave this ticked. The detector in the README connects the signal wire to ground (0V) when a train is there, and lets it float high (3.3V) when the block is empty. Untick only if your detector does the opposite: 3.3V when a train is present, 0V when empty. If you get it backwards, JMRI will show occupied when the track is clear.",
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
      hint: "Filled in from the name: trains/track/turnout/ plus the name. JMRI sends CLOSED or THROWN here. Change it if your topic is different.",
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
        hint: "Shown on the calibration page and in the logs, for example “Kiama/Up Loop -> THROWN”. It does not have to match the JMRI name.",
      }),
      topicField,
      linkedField(
        "State topic",
        stateTopic(point.topic),
        "The board publishes CLOSED or THROWN here after the point moves. It always follows the topic above, with /State on the end. Use it for state reporting if your control system reads a separate topic."
      ),
      field("PCA9685 channel (0–15)", point.channel, (v) => {
        point.channel = Number(v);
        persist();
        updatePreview();
      }, {
        type: "number",
        hint: "Which header the servo is plugged into. Channel 0 is the first set of pins on the PCA9685.",
      }),
      field("Travel time", point.travelTime, (v) => {
        point.travelTime = v.trim() || "10s";
        persist();
        updatePreview();
      }, {
        placeholder: "10s",
        hint: "Sets how fast the turnout moves. A longer time is a slower throw. 10s is a gentle start. Increase it if stock derails while the point is moving.",
      })
    );
    card.append(header, fields);
    el.pointsList.append(card);
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
