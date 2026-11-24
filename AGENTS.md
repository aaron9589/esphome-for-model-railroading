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
| `docs/field-logic-guide.md` | Field Logic guide, written a chapter per release: suffix, expanders, Share, blocks, linked boards so far |
| `docs/field-logic-spec.md` | Draft spec for the logic engine and the Field Logic mode (rules, layers, starters, remote inputs, plant ends, MCP23017 sensor pins); not built yet |
| `docs/field-logic-implementation-plan.md` | Draft build plan for both specs: releases, work items, spikes, risks |
| `docs/mss-emulation-spec.md` | Draft spec for MSS Logic, the second logic mode on the same engine: MSS-style modules described, not programmed (tracks, junctions, paired plant ends); not built yet |
| `configurator/` | Static GitHub Pages Board Configurator |
| `.github/workflows/` | `test.yml` (configurator tests, golden files, JMRI XML schema check) and `pages.yml` (deploy after tests pass) |
| `advanced-samples/` | Non-Configurator patterns for interest only |
| `_img/` | Architecture diagrams and photos used by the README |

## Logic work in progress

- The Logic page (field logic and MSS Logic) is built on the long-lived branch `feature/logic`, following `docs/field-logic-implementation-plan.md`. Each work item has a GitHub issue (label `logic`, milestones R0–R5). Branch it off `feature/logic` as named in the issue and PR back into it. PRs into `feature/logic` do not auto-close issues, so close the issue when its PR merges.
- Engine cases (`configurator/test/cases/*.json`, format and scan rules in its `README.md`) are worked out by hand from the spec. When an engine fails one, fix the engine or raise the spec question; never regenerate a case from an engine's output.
- Do not merge logic work into `main` until Release 5 of the plan is complete. `main` (and the live configurator) stays as today until then.

## Install and MQTT

- Supported install: `scripts/install-mac.sh`, `scripts/install-windows.ps1`, or `scripts/install-linux.sh` only. One-liners are in `README.md`. Do not maintain a parallel hand-install guide.
- Windows install must set `RemoteSigned` for the current user, `Unblock-File` the downloaded `.ps1`, and elevate with `-ExecutionPolicy RemoteSigned` — never `Bypass`. Defender often false-positives `Bypass` and unsigned PowerShell installers; the script adds Defender exclusions for `%USERPROFILE%\esphome-mr-installers` and `%ProgramData%\esphome-mr`, and the failure guide covers Allow / Restore.
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
- Source: `configurator/` (static site). Deployed by `.github/workflows/pages.yml` on pushes to `main` that touch `configurator/**`, only after `.github/workflows/test.yml` passes; `configurator/test/` is left out of the site. `test.yml` also runs on PRs into `main`, `feature/logic` and `logic/**` (stacked work items) and on pushes to `feature/logic`.
- Writes one `board.yaml` with an `esphome-mr-config:1` comment so the same file can be imported again. Do not invent a second file format.
- New boards get a six-character name suffix (`board.nameSuffix`, letters and digits without `0`, `o`, `1`, `l`), kept on rename: it is the board's identity at a meet. The Board page edits the part before it (19 characters at most) and offers **Add a suffix** (old boards) and **New suffix** (a copy of another board's file). A board without one writes exactly the old YAML.
- **Expanders (MCP23017)** on the Sensors page (`config.expanders`): each shares a PCA9685 board's SDA/SCL (`bus`, from 1) or has its own `sda`/`scl`; address `0x20`-`0x27`. A sensor on one stores `expander` (its name) and `pin` (0-15, shown A0-B7) instead of `gpio`. `i2cBuses()` works out the buses (two at most); one bus keeps the id-less `i2c:` YAML. Files without expanders keep no `expanders` key.
- **Logic page** (on `feature/logic` only, being built): stored in `config.logic` (`mode`, `share`, ...); the page is `logic-ui.js` (every word in its `TEXT`, linted for spec-only terms), and its YAML and XML come from `logic-yaml.js` hooks in `generator.js`. Mode None with Share unticked writes no `logic` key, so the YAML is unchanged. **Share with other boards** (on by default in Field Logic) adds only: the board Online topic as MQTT birth/will/shutdown, each sensor's retained `/State`, each turnout's retained `/Moving` (around announced throws, after `/Thrown`), each mast's retained `/State` (its JMRI aspect name), and the Owner MAC check (`trains/track/board/<board>/Owner`; a clash logs an error and shows on the web page). JMRI XML gets a Logic tick box with `MSboard/<board>/Online`. **Blocks** (`logic.blocks`, Field Logic only): each is a template `binary_sensor` `<block>_block`, occupied while any member is (this board's sensor by name, or `{board, sensor|block}` from a linked board, which reads occupied until known; a member on an expander that `is_failed()` or `status_has_warning()` reads occupied). It publishes like a detector, plus `/State` when sharing, and goes in the JMRI Logic box. Renaming a sensor, turnout or mast on its page renames its Logic page references (`renameReferences`, on `change`, not per key, and not when another item of that kind has the old or new name). Deleting one leaves the references, which validation reports by name.
- The mast editor lists lamps top of the mast first (with LED numbers; the stored `lamps` array stays LED 0 first) and shows each aspect as a card with a small mast picture; click a lamp to set its colour and effect. The raw JMRI match strings sit under a collapsed *JMRI aspect* section. There are no lamp presets.
- The UI calls the sections Sensors, Turnouts, and Signal Masts (the JMRI table names), with a JMRI badge in the nav. The stored keys stay `blocks`, `points`, and `signals` so old files import.
- **Import** is a menu: *From a file* or *Paste from ESPHome* (a dialog; same parser, so it needs the `esphome-mr-config:1` header). **Send to ESPHome** on the Download page copies the YAML and opens http://localhost:6052 with paste steps. It does not write to the Device Builder directly: the Device Builder rejects other origins unless `ESPHOME_TRUSTED_DOMAINS` lists them, and the install scripts deliberately leave that unset.
- The Download page also offers **Download JMRI XML** (`generateJmriXml`): a `layout-config` file for PanelPro's *Load table content and panels*. The hardware address is the part of the topic after `track/sensor/`, `track/turnout/`, or `track/signalmast/`, giving `MS<address>`, `MT<address>`, and `IF$mqm:cats-masts:cats-virtual(<address>)`. Each turnout also brings `MS<turnout address>/Thrown` (its `ONESENSOR` feedback, `sensor1`) and, with Remote lock, `MS<turnout address>/Locked`. Tick boxes (Sensors, Turnouts, Signal Masts; all ticked on load, not saved) pick the tables; the turnout's own sensors go with Turnouts. CATS sets up its own sensors and turnouts, so CATS users tick only Signal Masts. Items whose topic lacks that type topic, and masts whose address has `(`, `)`, or `:`, are left out and listed. It validates against JMRI 5.4's `layout-4-19-2.xsd`. The page's first JMRI step is the MQTT connection: prefix `M`, Channel `trains/` (blank in new JMRI, `/trains/` before 5.1.2; both miss the board), and the default `track/<type>/{0}` topics.
- **v1 scope:** board settings (fallback hotspot and the ESPHome API included), block detectors, points on up to two PCA9685 boards (each on its own SDA/SCL pins, since a classic ESP32 has two I2C buses; points are listed under their board and store `pcaBoard`) or a few servos on ESP pins (those take power from the board, so 3-4 is the usual limit), optional panel buttons on those points, and signal masts. A mast is an ordered stack of lamps. Addressable mode is one WS2812B strip per mast, wired from the base so LED 0 is the lowest lamp, with that mast’s data pin. The strip length is the LEDs across the lamps. One lamp can be several LEDs that always light together, such as a three-LED route indicator. Each lamp is one of the layout colours (off, red `ff0000`, amber `ffc800`, green `1fff87`, white `ffffff`). Individual-LED mode is one GPIO per lamp, on or off. Either way a lit lamp is steady, hard blink, or pulse. Aspect names can come from `.jmri/resources/signals/cats-masts/`. The configurator embeds that folder as `configurator/cats-signal-template.zip`; unzip it into the JMRI profile so `resources/signals/cats-masts` is created, then restart JMRI. MQTT stays on unless Disable MQTT is ticked; that drops the broker and every JMRI topic, and the board will not talk to JMRI.
- The `cats-masts` template is for CATS (`~/Repos/cats-src`, `src/cats/layout/AspectMap.java`). CATS finds a JMRI mast by the CATS signal's name and calls `setAspect` with its default appearance keys, which are these 30 aspect names; with a template's HOLD_ONLY option it calls `setHeld` instead, and with approach lighting it calls `setLit(false)`. Each aspect's title, `speed`, and `speed2` come from CATS `IndicationNames` and `AspectMap.Speed`. Held and danger show R292, permissive R291. On the board, each mast's `mqtt_subscribe` handler is one lambda: an exact match on an aspect's strings wins; otherwise `Unlit` sets the aspect global to -2 (the show script's dark branch), `Held` picks the aspect named `R292` or `Stop` (else -2), and anything else matches on the aspect name before the first `;`. An unknown aspect is ignored. Both XML files validate against JMRI 5.4's `aspecttable.xsd` and `appearancetable.xsd`. Rebuild `configurator/cats-signal-template.zip` from `.jmri/` when they change.
- Default MQTT topics: `trains/track/sensor/<name>`, `trains/track/turnout/<name>`, and `trains/track/signalmast/<name>`; position feedback is the sensor `trains/track/sensor/<turnout>/Thrown` (`thrownTopic`: `ACTIVE` thrown, `INACTIVE` closed), which the JMRI XML sets as the turnout's `ONESENSOR` feedback. JMRI reads turnout feedback on its turnout receive topic, which by default is the command topic, so a nested `/State` was never heard. A point can opt into `<turnout-topic>/Lock`.
- Detectors publish with `retain: false` on purpose (avoid stale OCCUPIED in JMRI). Servo endpoint sliders, and the board-wide `Signal -` brightness, blink brightness/on/off, and pulse brightness, rate, and gap sliders, use `restore_value: true` on the ESP. Turnout position is the same kind of value: a `restore_value: true` bool. Changing it calls `update()` and `global_preferences->sync()` immediately, because the usual flash flush is about once a minute and a power cut was forgetting the position. On boot the servo moves to that saved position and does not publish. With more than one servo, each waits a random 0.2-1s first so they do not all start together. MQTT connect publishes `/Thrown` from the same bool with `retain: true` and QoS 2, as does each throw that came from a command or button. Nothing saved yet means normal, so the publish is `INACTIVE`. A sensor on a turnout's `/Thrown` or `/Locked` topic is a validation error. One aspect per mast can be marked to show at startup.
- Fascia buttons on a point are ignored while either of that point's throw scripts is running (`script.is_running` on `throw_closed` and `throw_thrown`). That covers the move to the endpoint, the 2s wait, and the backoff write. A second press in that window must not start the other throw, or the late backoff write leaves the servo short of the end it was sent to.
- A point control is momentary (`toggle`, `closed`, `thrown`) or latched (`latch-thrown`, `latch-closed`; on = pin pulled to GND). A latched control is not ignored while a throw runs. Its `on_state` runs a `queued` `${id}_latch_<n>` script that waits until both throw scripts have finished, then makes the point match the switch, so the switch and point cannot drift apart. On boot that script runs with `force: true` in place of the saved-position move, so the switch wins. A remote lock keeps the point where it is. At most one latched control per point (validation error).
- Optional per point: `lockEnabled` and `lockDefault` (`locked` or `unlocked`). With MQTT on, the board subscribes to `<turnout-topic>/Lock`. `LOCKED` sets `${id}_locked` (`restore_value: false`) and `UNLOCKED` clears it. While set, fascia buttons and `CLOSED`/`THROWN` are ignored. When `UNLOCKED` clears a lock that was set, a point with a latched control runs its `${id}_latch_<n>` script (`force: false`) so the point catches up with a switch moved while locked; a repeated or retained `UNLOCKED` does nothing. Boot still moves the servo to the saved position. `lockDefault` is the global's `initial_value` and is not kept across a reboot; a retained lock message replaces it when the broker connects. No lock global is emitted when the option is off or MQTT is off.
- Lock report (`lockedTopic`): a locked-capable point publishes `ACTIVE` / `INACTIVE` (retained, QoS 2) from `${id}_locked` to the turnout topic with `track/turnout/` swapped for `track/sensor/`, plus `/Locked` (`<topic>/Locked` if the topic has no `track/turnout/`). It is sent on MQTT connect and after every `LOCKED` / `UNLOCKED`. The JMRI XML adds it as sensor `MS<address>/Locked`, for CATS's *Turnout Locked Report*. A sensor on that topic is a validation error.
- When changing generator behaviour, update `configurator/test/generator.test.js` (or the feature's own `configurator/test/<feature>.test.js`, which `npm test` also runs) and run the configurator tests (`configurator/package.json`).
- `configurator/test/golden/` holds the YAML and JMRI XML for each board in `configurator/test/fixtures/`, byte-for-byte. A change that alters generated output fails them; if the change is meant, run `UPDATE_GOLDEN=1 npm test` and say why in the PR, which needs a reviewer's sign-off. The fixtures use fake credentials.

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
