# Agent guide

This repo is a beginner path for model-railroad ESP32 boards that talk to JMRI/CATS over MQTT. Prefer the Board Configurator and the install scripts over hand-edited YAML.

## How to help

- Use plain language. One step at a time for setup and troubleshooting.
- Give the exact command for the person's OS (macOS Terminal or Windows PowerShell), then say what success looks like.
- If something fails, give only the next check. Do not dump a long list.
- Do not suggest Docker unless the person already uses it and asks to keep it.
- Beginner YAML comes from the Board Configurator, with Wi-Fi and MQTT values written into the file. Do not revive a modular `secrets.yaml` / `my-first-board` beginner path — that was removed.
- Do not put real passwords in docs or commit a generated `board.yaml`.
- Keep YAML and script edits small. Match the style of the file you are changing, and say why it changed.
- Do not rename files unless asked.
- `AGENTS.md` is the source of truth for agents in this repo (there is no separate Copilot instructions file).

## Repo map

| Path | What it is |
|---|---|
| `README.md` | Start here: parts, install one-liners, configurator, first flash |
| `scripts/install-mac.sh` | Mac setup: ESPHome Device Builder, Mosquitto, MQTTX, then Configurator prompt |
| `scripts/install-windows.ps1` | Same for Windows 10/11 |
| `docs/first-board-setup-guide.md` | Paste Configurator YAML, USB flash, MQTT smoke test, failure checks |
| `docs/jmri-mqtt-verification-guide.md` | JMRI sensor/turnout topics and panel checks |
| `docs/README.md` | Detector wiring, point calibration, layout notes |
| `configurator/` | Static GitHub Pages Board Configurator |
| `advanced-samples/` | Non-Configurator patterns for interest only |
| `_img/` | Architecture diagrams and photos used by the README |

## Install and MQTT

- Supported install: `scripts/install-mac.sh` or `scripts/install-windows.ps1` only. One-liners are in `README.md`. Do not maintain a parallel hand-install guide.
- ESPHome is the Device Builder desktop app at http://localhost:6052. Config files live in `~/esphome` (Mac) or `%USERPROFILE%\esphome` (Windows).
- MQTT is Mosquitto on port **1883**, anonymous, on a trusted home LAN. Setup writes `listener 1883`, `allow_anonymous true`, and `persistence true` (retained messages survive a broker restart), then checks the service is running with auto-start.
- MQTTX is the GUI topic browser (not MQTT Explorer — Mac Gatekeeper breaks those builds). Connect to `127.0.0.1:1883` with no username to watch the local broker.
- After install, the script offers to open the Board Configurator in the browser (Enter to open, `n` to skip).
- The broker address in board YAML and in JMRI is the computer's **LAN IP**. Never `localhost` / `127.0.0.1` in board YAML or JMRI.
- Generated YAML needs ESPHome **2024.6.0** or newer (`ota` platform `esphome`, `min_version`).

## Board Configurator

- Live at https://aaron9589.github.io/esphome-for-model-railroading/
- Source: `configurator/` (static site). Deployed by `.github/workflows/pages.yml` on pushes to `main` that touch `configurator/**`.
- Writes one `board.yaml` with an `esphome-mr-config:1` comment so the same file can be imported again. Do not invent a second file format.
- **v1 scope:** board settings, block detectors, and PCA9685 points only.
- Default MQTT topics: `trains/track/sensor/<name>` and `trains/track/turnout/<name>`; state feedback is `<turnout-topic>/State`.
- Detectors publish with `retain: false` on purpose (avoid stale OCCUPIED in JMRI). Servo endpoint sliders use `restore_value: true` on the ESP. Turnout `/State` is not retained in generated YAML; JMRI can still remember panel state.
- When changing generator behaviour, update `configurator/test/generator.test.js` and run the configurator tests (`configurator/package.json`).

## Advanced samples

- `advanced-samples/` is **not** Configurator-compatible. README there explains each file.
- Kept for interest: end-of-block pulses, ground throws, bell codes, RFID staff machine, WLED signals. Include them as ESPHome `packages:` on their own device. There is no sample board shell.
- Block detectors and PCA9685 / GPIO servo patterns that the Configurator covers were removed from this folder — do not re-add them as a parallel beginner path.
- Signals use WLED on a second ESP (`wled_signal.yaml`); see also https://illawarraline.net/signals-for-the-illawarra-line/

## Docs tone

- Guides live under `docs/`. Prefer linking the existing guide over inventing new steps in chat.
- Screenshot placeholders in the guides are intentional; do not invent fake screenshots.
- Architecture pictures: `_img/architecture.svg`, `_img/mqtt-flow.svg`. Advanced-sample pictures: `_img/advanced-*.svg`, embedded from `README.md` and `advanced-samples/README.md`.

## When something fails, check in this order

1. ESPHome Device Builder is running (http://localhost:6052).
2. Mosquitto is running and listening on 1883, not localhost-only (`listener 1883` and `allow_anonymous true`); persistence and auto-start should already be set by the install script.
3. Nothing else owns ports 1883 or 6052.
4. USB cable, driver, and Chrome or Edge for the first flash.
5. Wi-Fi is 2.4 GHz with DHCP.
6. The broker IP is the LAN address, and the firewall allows inbound TCP 1883.
7. For MQTT watching: MQTTX (or `mosquitto_sub`) on `127.0.0.1:1883`, subscribe to `#`.

## Where to send people

1. `README.md` — what you need, the install script, the configurator, then the first flash.
2. `docs/README.md` — detector wiring, point setup, and the layout.
3. `docs/first-board-setup-guide.md` — paste the YAML, flash by USB, confirm MQTT.
4. `docs/jmri-mqtt-verification-guide.md` — sensor and turnout topics.
5. `advanced-samples/` — non-configurator patterns only.
