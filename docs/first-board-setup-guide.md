# First Board Setup Guide (No Technical Background Needed)

Use this after the install script from the [README](../README.md) finishes (or after the manual steps in [installing-esphome-cheatsheet.md](installing-esphome-cheatsheet.md)). The script opens the ESPHome dashboard for you.

Goal:
- Create one ESP board in ESPHome
- Flash it by USB the first time
- Confirm it is online
- Add basic MQTT settings

---

## Step 1: Open ESPHome Dashboard

1. Open http://localhost:6052
2. You should see the ESPHome dashboard page.

Success looks like:
- You can see a button to create a new device.

> **Screenshot placeholder:** ESPHome Dashboard at http://localhost:6052 with the **New Device** button visible and no device tiles yet (empty dashboard).

---

## Step 2: Create Device Entry and Paste Configurator YAML

1. Click **New Device**.
2. Enter a device name (example: `yard-board-01`). Use lowercase letters, numbers, and dashes only — this should match the board name you set in the Configurator.
3. Enter your 2.4 GHz Wi-Fi name and password (these are only used to register the device — you will replace the YAML next).
4. Pick your board type. If unsure, choose **ESP32**.
5. Click **Skip** at the install page for now.

> **Screenshot placeholder:** ESPHome **New Device** wizard showing the device name field filled in and the board type set to **ESP32**.

A new device tile appears. Now paste the YAML from the Configurator:

1. Open the **[Board Configurator](https://aaron9589.github.io/esphome-for-model-railroading/)**, load **My First Board** (or import a previous download), fill in Wi-Fi / MQTT broker IP / OTA password, then **Download board.yaml**.
2. Click **Edit** on the device tile in ESPHome Dashboard.
3. Select all the text in the editor and delete it.
4. Paste the full contents of the downloaded `board.yaml`.
5. Click **Save**.

The Configurator writes Wi-Fi, MQTT, and OTA values directly into the file (no `secrets.yaml` needed for this path). Requires **ESPHome ≥ 2024.6.0**.

Success looks like:
- No red error banner after saving.

> **Screenshot placeholder:** ESPHome YAML editor with the Configurator `board.yaml` pasted in, showing no red error banner at the top.

To change blocks or points later, re-import that same file in the Configurator, edit there, download again, and paste over the device YAML (then **Install → Wireless**).

---

## Step 3 (Optional): Hand-edit with modules/

Prefer the modular sample files instead of the Configurator? ESPHome Device Builder stores configs in your home folder (`~/esphome` on Mac, `C:\Users\you\esphome` on Windows). Menu-bar or tray icon → **Open Config Folder**.

Copy [samples/my-first-board/](../samples/my-first-board/) into your board folder, uncomment the `packages:` lines in `board.yaml`, and fill [samples/secrets.yaml](../samples/secrets.yaml) in that same config folder. This path is for people who want to maintain separate module files by hand.

> **Screenshot placeholder:** VS Code Explorer panel showing the board folder (e.g. `yard-board-01/`) expanded with `board.yaml` and a `modules/` subfolder containing `block_detectors.yaml` and `point_control.yaml`.

---

## Step 4: First Flash by USB

The first time you program a board, you must do it by USB. All future updates can be done wirelessly.

1. Plug the board into your PC using a **data USB cable** (not a charge-only cable — they look the same but charge-only cables carry no data).
2. Open **Chrome or Edge**. This step does not work in Firefox.
3. In the device tile, click **Install**.
4. Select **Plug into this computer**.
5. A list of serial ports will appear. Select the one that appeared when you plugged in your board (usually named `CP210x` or `CH340`).

> **Screenshot placeholder:** Chrome/Edge browser showing the **Select a serial port** dialog with a `CP210x` or `CH340` port listed and highlighted ready to click Connect.

If no port appears, install a USB driver for your chip:
- CP2102: [Silicon Labs CP210x driver](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers)
- CH340: the manufacturer's driver for Windows or Mac

Success looks like:
- The install progress bar reaches 100% and the board reboots.

> **Screenshot placeholder:** ESPHome Dashboard install progress at 100% (or the flashing complete confirmation screen).

---

## Step 5: Confirm Board Is Online

1. Wait up to 2 minutes after first flash.
2. Device should show **Online** in ESPHome.
3. Open **Logs** for the device.

Success looks like:
- You see boot logs and no repeated Wi-Fi connection failures.

> **Screenshot placeholder:** ESPHome Dashboard showing the device tile with the **Online** badge and the Logs panel open, showing successful boot and Wi-Fi connection lines.

---

## Step 6: Test MQTT Connection

Mosquitto has no client list. Watch the broker with a subscriber on this PC.

1. In a terminal, run (use the LAN IP from the cheatsheet, not only `localhost`):

   ```bash
   mosquitto_sub -h localhost -t '#' -v
   ```

2. Restart the board from the ESPHome dashboard (**Restart Board**, or power-cycle it).
3. You should see MQTT traffic from the board (sensor state and, if you have a point, a `CLOSED` message). On Windows, run `mosquitto_sub` from `C:\Program Files\mosquitto` if it is not on your PATH.

[MQTT Explorer](https://mqtt-explorer.com/) shows the same traffic if you prefer a window over a terminal. Connect it to `localhost` port `1883`.

Success looks like:
- Messages appear when the board boots or a block changes.

> **Screenshot placeholder:** MQTT Explorer or a terminal running `mosquitto_sub -t '#' -v`, showing the board's topic after it comes online.

---

## Your Board Is Ready

Your ESP32 is online, connected to MQTT, and ready to talk to JMRI.

**Next steps — pick one:**

- **[Verify JMRI communication →](jmri-mqtt-verification-guide.md)**
  Create a sensor and turnout in JMRI, name them to match your MQTT topics, and watch messages flow in both directions. Good first check before wiring up the whole layout.

- **[Customise in the Configurator →](https://aaron9589.github.io/esphome-for-model-railroading/)**
  Re-import your `board.yaml`, change block/point names and topics, download again, paste into ESPHome, then **Install → Wireless**.

---

## Add More Later (Optional)

- Prefer hand-edited modules? See [Step 3](#step-3-optional-hand-edit-with-modules) and [samples/my-first-board/](../samples/my-first-board/).
- Signals and other advanced patterns: [samples/advanced-samples/](../samples/advanced-samples/) (not in the Configurator yet).

---

## If Something Fails

Go to [installing-esphome-cheatsheet.md](installing-esphome-cheatsheet.md) and use the **If Something Fails** section.
