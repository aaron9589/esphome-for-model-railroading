# Agent guide

This repo is a beginner path for model-railroad ESP32 boards that talk to JMRI/CATS over MQTT.

## How to help

- Use plain language. One step at a time for setup and troubleshooting.
- Give the exact command for the person's OS (macOS Terminal or Windows PowerShell), then say what success looks like.
- If something fails, give only the next check. Do not dump a long list.
- Do not suggest Docker unless the person already uses it and asks to keep it.
- Beginner YAML comes from the Board Configurator, with Wi-Fi and MQTT values written into the file. `samples/` plus `secrets.yaml` is the hand-edit path only.
- Do not put real passwords in docs or commit a generated `board.yaml`.
- Keep YAML edits small. Match the style of the file you are changing, and say why a block changed.
- Do not rename files unless asked.

## Install and MQTT

- Supported install: `scripts/install-mac.sh` or `scripts/install-windows.ps1`. The one-liners are in `README.md`. `docs/installing-esphome-cheatsheet.md` is the same steps by hand.
- ESPHome is the Device Builder desktop app at http://localhost:6052. Config files live in `~/esphome`.
- MQTT is Mosquitto on port 1883, anonymous, on a trusted home LAN.
- MQTT Explorer is the GUI topic browser. Connect to `127.0.0.1:1883` with no username to watch the local broker.
- The broker address in board YAML and in JMRI is the computer's LAN IP. Never `localhost`.
- Generated YAML needs ESPHome 2024.6.0 or newer (`ota` platform `esphome`, `min_version`).

## When something fails, check in this order

1. ESPHome Device Builder is running (http://localhost:6052).
2. Mosquitto is running and listening on 1883, not localhost-only (`listener 1883` and `allow_anonymous true`).
3. Nothing else owns ports 1883 or 6052.
4. USB cable, driver, and Chrome or Edge for the first flash.
5. Wi-Fi is 2.4 GHz with DHCP.
6. The broker IP is the LAN address, and the firewall allows inbound TCP 1883.

## Where to send people

1. `README.md` — what you need, the install script, the configurator, then the first flash.
2. `docs/README.md` — detector wiring, point setup, and the layout.
3. `docs/first-board-setup-guide.md` — paste the YAML, flash by USB, confirm MQTT with `mosquitto_sub`.
4. `docs/jmri-mqtt-verification-guide.md` — sensor and turnout topics.
5. `samples/` — block detection, points, and the advanced files. Signals are not in the configurator.

## Configurator

`configurator/` is a static GitHub Pages app. It writes one `board.yaml` with an `esphome-mr-config:1` comment so the same file can be imported again. Do not invent a second file format. v1 is board, block detectors, and PCA9685 points only.
