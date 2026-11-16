# Agent guide

This repo is a beginner path for model-railroad ESP32 boards that talk to JMRI/CATS over MQTT. Prefer the Board Configurator and the install scripts over hand-edited YAML.

## How to help

- Use plain language. One step at a time for setup and troubleshooting.
- Give the exact command for the person's OS (macOS Terminal, Windows PowerShell, or a Linux terminal), then say what success looks like.
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
| `scripts/install-linux.sh` | Same for Raspberry Pi OS (Pi-SPROG), Debian, Ubuntu, Fedora, openSUSE, and Arch. Leaves the Pi UART, boot files, and JMRI alone |
| `docs/first-board-setup-guide.md` | Paste Configurator YAML, USB flash, MQTT smoke test, failure checks |
| `docs/jmri-mqtt-verification-guide.md` | JMRI sensor/turnout topics and panel checks |
| `docs/README.md` | Detector wiring, point calibration, layout notes |
| `configurator/` | Static GitHub Pages Board Configurator |
| `advanced-samples/` | Non-Configurator patterns for interest only |
| `_img/` | Architecture diagrams and photos used by the README |

## Install and MQTT

- Supported install: `scripts/install-mac.sh`, `scripts/install-windows.ps1`, or `scripts/install-linux.sh` only. One-liners are in `README.md`. Do not maintain a parallel hand-install guide.
- Linux install is 64-bit Raspberry Pi OS (the usual Pi-SPROG machine), Debian, Ubuntu and relatives, Fedora and RHEL relatives, openSUSE, and Arch. It does not edit Pi boot files or the SPROG serial port. A 32-bit Pi needs the 64-bit image.
- ESPHome is the Device Builder desktop app at http://localhost:6052. The install script downloads the latest desktop app, then runs its updater so the builder inside it matches the current release. Config files live in `~/esphome` (Mac and Linux) or `%USERPROFILE%\esphome` (Windows).
- MQTT is Mosquitto on port **1883**, anonymous, on a trusted home LAN. Setup writes `listener 1883`, `allow_anonymous true`, and `persistence true` (retained messages survive a broker restart), then checks the service is running with auto-start.
- MQTTX is the GUI topic browser (not MQTT Explorer — Mac Gatekeeper breaks those builds). Connect to `127.0.0.1:1883` with no username to watch the local broker.
- After install, the script offers to open the Board Configurator in the browser (Enter to open, `n` to skip).
- The configurator defaults the MQTT broker to `layout-mqtt.local`. A typed-in LAN IP works in that field too. Never `localhost` / `127.0.0.1` in board YAML or JMRI.
- The install scripts publish `layout-mqtt.local` on the network. Preflight looks for that name first. If another computer already answers, the script warns and does not publish over it. `ping layout-mqtt.local` checks the computer that owns the name. On this computer, the name comes back after a reboot and is removed on uninstall.
- Generated YAML needs ESPHome **2026.9.0** or newer (`esp32: variant`, `ota` encryption, `min_version`).

## Board Configurator

- Live at https://aaron9589.github.io/esphome-for-model-railroading/
- Source: `configurator/` (static site). Deployed by `.github/workflows/pages.yml` on pushes to `main` that touch `configurator/**`.
- Writes one `board.yaml` with an `esphome-mr-config:1` comment so the same file can be imported again. Do not invent a second file format.
- **v1 scope:** board settings (fallback hotspot and the ESPHome API included), block detectors, PCA9685 points or a few servos on ESP pins (those take power from the board, so 3-4 is the usual limit), optional panel buttons on those points, and signal masts. A mast is an ordered stack of lamps. Addressable mode is one WS2812B strip per mast, wired from the base so LED 0 is the lowest lamp, with that mast’s data pin. The strip length is the LEDs across the lamps. One lamp can be several LEDs that always light together, such as a three-LED route indicator. Each lamp is one of the layout colours (off, red `ff0000`, amber `ffc800`, green `1fff87`, white `ffffff`). Individual-LED mode is one GPIO per lamp, on or off. Either way a lit lamp is steady, hard blink, or pulse. Aspect names can come from `.jmri/resources/signals/cats-masts/`. The configurator embeds that folder as `configurator/cats-signal-template.zip`; unzip it into the JMRI profile so `resources/signals/cats-masts` is created, then restart JMRI. MQTT stays on unless Disable MQTT is ticked; that drops the broker and every JMRI topic, and the board will not talk to JMRI.
- Default MQTT topics: `trains/track/sensor/<name>`, `trains/track/turnout/<name>`, and `trains/track/signalmast/<name>`; state feedback is `<turnout-topic>/State`. A point can opt into `<turnout-topic>/Lock`.
- Detectors publish with `retain: false` on purpose (avoid stale OCCUPIED in JMRI). Servo endpoint sliders, and the board-wide `Signal -` brightness, blink brightness/on/off, and pulse brightness, rate, and gap sliders, use `restore_value: true` on the ESP. Turnout position is the same kind of value: a `restore_value: true` bool. Changing it calls `update()` and `global_preferences->sync()` immediately, because the usual flash flush is about once a minute and a power cut was forgetting the position. On boot the servo moves to that saved position and does not publish. With more than one servo, each waits a random 0.2-1s first so they do not all start together. MQTT connect publishes `/State` from the same bool with `retain: true` and QoS 2. Nothing saved yet means normal, so the publish is `CLOSED`. One aspect per mast can be marked to show at startup.
- Fascia buttons on a point are ignored while either of that point's throw scripts is running (`script.is_running` on `throw_closed` and `throw_thrown`). That covers the move to the endpoint, the 2s wait, and the backoff write. A second press in that window must not start the other throw, or the late backoff write leaves the servo short of the end it was sent to.
- Optional per point: `lockEnabled` and `lockDefault` (`locked` or `unlocked`). With MQTT on, the board subscribes to `<turnout-topic>/Lock`. `LOCKED` sets `${id}_locked` (`restore_value: false`) and `UNLOCKED` clears it. While set, fascia buttons and `CLOSED`/`THROWN` are ignored. Boot still moves the servo to the saved position. `lockDefault` is the global's `initial_value` and is not kept across a reboot; a retained lock message replaces it when the broker connects. No lock global is emitted when the option is off or MQTT is off.
- When changing generator behaviour, update `configurator/test/generator.test.js` and run the configurator tests (`configurator/package.json`).

## Advanced samples

- `advanced-samples/` is **not** Configurator-compatible. README there explains each file.
- Kept for interest: end-of-block pulses, ground throws, bell codes, RFID staff machine. Include them as ESPHome `packages:` on their own device. There is no sample board shell. `wled_signal.yaml` is obsolete; do not offer it as a way to build signals.
- Block detectors and PCA9685 / GPIO servo patterns that the Configurator covers were removed from this folder — do not re-add them as a parallel beginner path.
- The configurator drives signal masts on the board, either a WS2812B strip or one GPIO per lamp. `advanced-samples/wled_signal.yaml` is an obsolete record of the earlier WLED UART layout; see also https://illawarraline.net/signals-for-the-illawarra-line/

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
6. The broker is `layout-mqtt.local` (or the LAN address from `ping layout-mqtt.local`), and the firewall allows inbound TCP 1883.
7. For MQTT watching: MQTTX (or `mosquitto_sub`) on `127.0.0.1:1883`, subscribe to `#`.

## Where to send people

1. `README.md` — what you need, the install script, the configurator, then the first flash.
2. `docs/README.md` — detector wiring, point setup, and the layout.
3. `docs/first-board-setup-guide.md` — paste the YAML, flash by USB, confirm MQTT.
4. `docs/jmri-mqtt-verification-guide.md` — sensor and turnout topics.
5. `advanced-samples/` — non-configurator patterns only.
