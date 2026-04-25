# First Board Setup Guide (No Technical Background Needed)

Use this after you complete the Windows setup in [installing-esphome-cheatsheet.md](installing-esphome-cheatsheet.md).

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

---

## Step 2: Create Device Entry and Load the Sample Config

1. Click **New Device**.
2. Enter a device name (example: `yard-board-01`). Use lowercase letters, numbers, and dashes only.
3. Enter your 2.4 GHz Wi-Fi name and password (these are only used to register the device — you will replace the YAML next).
4. Pick your board type. If unsure, choose **ESP32**.
5. Click **Skip** at the install page for now.

A new device tile appears. Now replace the generated YAML with the sample config from this repo:

1. Click **Edit** on the device tile.
2. Select all the text in the editor and delete it.
3. Copy the full contents of [samples/my-first-board/board.yaml](samples/my-first-board/board.yaml) and paste it in.
4. Change the `name:` field at the top to match the name you entered in step 2 above.
5. Click **Save**.

Success looks like:
- No red error banner after saving.

---

## Step 3: Create the Modules Folder

The sample board config loads features from a subfolder called `modules/`. ESPHome stores its config files inside a Docker volume — the easiest way to work with them is to open the folder in **VS Code** (installed in the cheatsheet Step 2).

**Open the ESPHome config folder in VS Code:**

1. Open VS Code.
2. Go to **File → Open Folder**.
3. Paste this path into the address bar and press Enter:
   ```
   \\wsl$\docker-desktop\var\lib\docker\volumes\esphome-config\_data
   ```
4. You should see a folder for each device (named after the board you created in Step 2), plus `secrets.yaml`.

**Create the modules folder and copy the sample files:**

5. In the VS Code Explorer panel (left sidebar), right-click your board's folder (e.g. `yard-board-01`) and select **New Folder**. Name it `modules`.
6. Get the two sample module files from this repo. If you have the repo cloned locally, copy them from there. Otherwise, open each link below in your browser, click the **Raw** button, then save the file (Ctrl+S) into the `modules` folder:
   - [samples/my-first-board/modules/block_detectors.yaml](samples/my-first-board/modules/block_detectors.yaml)
   - [samples/my-first-board/modules/point_control.yaml](samples/my-first-board/modules/point_control.yaml)

Success looks like:
- The `modules` folder sits next to your board's `.yaml` file in the VS Code Explorer.
- Both `block_detectors.yaml` and `point_control.yaml` are inside it.

Note:
- VS Code will underline YAML errors in red — hover over them to see what is wrong.
- To disable a feature you are not using yet, open `board.yaml` in VS Code and add `#` at the start of the relevant `packages:` line.

---

## Step 4: Fill In secrets.yaml

ESPHome keeps passwords in a separate file called `secrets.yaml` so they are never accidentally shared.

Open `secrets.yaml` in VS Code (it is in the root of the config folder, next to your board folder). Replace its contents with the lines below, filling in every `<...>` with your actual value:

```yaml
wifi_ssid: "<your-wifi-network-name>"
wifi_password: "<your-wifi-password>"
mqtt_broker: "<your-pc-ip-address>"  # The IP of the PC running EMQX. Find it by running: ipconfig
ota_password: "<choose-any-password-for-over-the-air-updates>"
```

Save the file (**Ctrl+S**).

To find your PC's IP address, open PowerShell and run:
```powershell
ipconfig
```
Look for the line `IPv4 Address` under your Wi-Fi or Ethernet adapter.

Success looks like:
- Your board file can reference `!secret` values without errors.

---

## Step 5: First Flash by USB

The first time you program a board, you must do it by USB. All future updates can be done wirelessly.

1. Plug the board into your PC using a **data USB cable** (not a charge-only cable — they look the same but charge-only cables carry no data).
2. Open **Chrome or Edge**. This step does not work in Firefox.
3. In the device tile, click **Install**.
4. Select **Plug into this computer**.
5. A list of serial ports will appear. Select the one that appeared when you plugged in your board (usually named `CP210x` or `CH340`).

If no port appears, you need to install a USB driver:
- CP2102 chip boards: [Silicon Labs CP210x driver](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers)
- CH340 chip boards: search "CH340 driver Windows" and install from the manufacturer site.

Success looks like:
- The install progress bar reaches 100% and the board reboots.

---

## Step 6: Confirm Board Is Online

1. Wait up to 2 minutes after first flash.
2. Device should show **Online** in ESPHome.
3. Open **Logs** for the device.

Success looks like:
- You see boot logs and no repeated Wi-Fi connection failures.

---

## Step 7: Test MQTT Connection

1. Open EMQX at http://localhost:18083
2. Check connected clients.
3. Your board should appear as an MQTT client.

Success looks like:
- Board appears in EMQX clients list.

---

## Step 8: Connect JMRI and Verify End-to-End

This step confirms that JMRI and your ESP32 board are talking to each other over MQTT. You will create one sensor and one turnout in JMRI, name them to match the topics in your ESPHome config, then watch messages flow in both directions.

### Before You Start

- JMRI must be running with an MQTT connection configured.
- Open JMRI Preferences → Connections → MQTT and confirm:
  - The broker IP matches your PC's IP address (the same value in `secrets.yaml`)
  - Note the **MQTT Channel**, **Sensor receive topic**, and **Turnout send topic** fields — you will use these to build the correct hardware addresses below.

> **Screenshot placeholder:** JMRI Preferences → Connections → MQTT panel, showing the broker IP, MQTT Channel field (blank or `trains/`), Sensor receive topic, and Turnout send topic fields.

---

### Part 1: Test Block Detection (Sensor → JMRI)

The ESP32 publishes `ACTIVE` or `INACTIVE` to the sensor topic when a train enters or leaves a block. JMRI reads this and updates its Sensor table.

**In JMRI, open the Sensor Table** (Tools → Tables → Sensors) and create a new entry:

| Field | Value |
|---|---|
| System Name | `MStrack/sensor/Kiama/Up XOver` |
| User Name | `Kiama Up XOver` (or anything recognisable) |

The System Name is built from:
- `M` — MQTT connection prefix
- `S` — Sensor table prefix
- Then the **hardware address**, which is the topic path after the MQTT Channel

So if your `block_1_topic` in `block_detectors.yaml` is `trains/track/sensor/Kiama/Up XOver` and your MQTT Channel is blank, the hardware address is `track/sensor/Kiama/Up XOver` and the System Name is `MStrack/sensor/Kiama/Up XOver`.

If your MQTT Channel is `trains/`, the hardware address is just `track/sensor/Kiama/Up XOver` (JMRI strips the channel prefix). Check your own `block_1_topic` substitution and adjust accordingly.

> **Screenshot placeholder:** JMRI Sensor Table with the new sensor entry created, showing the System Name, User Name, and current state (Unknown or Inactive).

**Verify it works:**

1. Open ESPHome Dashboard → **Logs** for your board.
2. Place a train on the block wired to that detector.
3. In the logs you should see:

   ```
   [I][block_detectors:...] Kiama/Up XOver -> OCCUPIED
   ```

4. Back in JMRI, the sensor's state column should change to **Active**.
5. Remove the train — the log should show `UNOCCUPIED` and JMRI should show **Inactive**.

> **Screenshot placeholder:** ESPHome logs panel showing the `OCCUPIED` / `UNOCCUPIED` log lines for the block sensor.

> **Screenshot placeholder:** JMRI Sensor Table with the sensor state showing **Active** while a train is on the block.

---

### Part 2: Test Point Control (JMRI → Turnout → ESP32)

JMRI publishes `CLOSED` or `THROWN` to the turnout topic when you change a turnout in the table or on a panel. The ESP32 receives this and moves the servo.

**In JMRI, open the Turnout Table** (Tools → Tables → Turnouts) and create a new entry:

| Field | Value |
|---|---|
| System Name | `MTtrack/turnout/Kiama/Up Loop` |
| User Name | `Kiama Up Loop` (or anything recognisable) |

The System Name is built the same way as sensors:
- `M` — MQTT connection prefix
- `T` — Turnout table prefix
- Hardware address = the topic path from `turnout_01_topic` in `point_control.yaml`, minus the MQTT Channel prefix

So if `turnout_01_topic` is `trains/track/turnout/Kiama/Up Loop` and MQTT Channel is blank, the hardware address is `track/turnout/Kiama/Up Loop`.

> **Screenshot placeholder:** JMRI Turnout Table with the new turnout entry created, showing System Name, User Name, and state (Unknown or Closed).

**Verify it works:**

1. Open ESPHome Dashboard → **Logs** for your board.
2. In the JMRI Turnout Table, click the state column for your new turnout to toggle it to **Thrown**.
3. In the ESPHome logs you should see:

   ```
   [I][point_control:...] up_loop -> THROWN (reverse)
   ```

4. The servo should move to the reverse position.
5. Toggle back to **Closed** — the log should show `CLOSED (normal)` and the servo should return.

> **Screenshot placeholder:** ESPHome logs panel showing the `THROWN` and `CLOSED` log lines for the turnout.

> **Screenshot placeholder:** JMRI Turnout Table with the state toggled to **Thrown**.

**Optional — verify the state feedback in EMQX:**

1. Open EMQX at http://localhost:18083 → **Diagnose → WebSocket Client**.
2. Connect, then subscribe to `#` (all topics).
3. Toggle the turnout in JMRI — you should see two messages:
   - JMRI publishing `THROWN` to `track/turnout/Kiama/Up Loop`
   - The ESP32 replying `THROWN` to `track/turnout/Kiama/Up Loop/State`

> **Screenshot placeholder:** EMQX WebSocket Client showing the two MQTT messages — the command from JMRI and the state reply from the ESP32.

---

### Troubleshooting This Step

**JMRI sensor state never changes:**
- Check `block_1_topic` in `block_detectors.yaml` exactly matches the hardware address path in the JMRI System Name (case-sensitive).
- Open EMQX → Diagnose → WebSocket Client, subscribe to `#`, and place a train on the block. If you see an MQTT message arrive, the board is publishing correctly and the mismatch is in the JMRI System Name.

**Servo does not move when toggling JMRI turnout:**
- Check `turnout_01_topic` in `point_control.yaml` exactly matches the hardware address path in the JMRI System Name.
- In EMQX WebSocket Client, subscribe to `#` and toggle the turnout. If no message appears, JMRI is not publishing — check the MQTT connection in JMRI Preferences.

**JMRI System Name format reference:**

| Type | Prefix | Example System Name |
|---|---|---|
| Sensor | `MS` | `MStrack/sensor/Kiama/Up XOver` |
| Turnout | `MT` | `MTtrack/turnout/Kiama/Up Loop` |

---

## Add Repo Samples Next (Optional)

When your base board works, open the `modules/` folder in VS Code and edit the `substitutions` section at the top of each file to match your layout:
- [samples/my-first-board/modules/block_detectors.yaml](samples/my-first-board/modules/block_detectors.yaml) — set block names and MQTT topics
- [samples/my-first-board/modules/point_control.yaml](samples/my-first-board/modules/point_control.yaml) — set turnout names, MQTT topics, and PCA9685 channel numbers
- [samples/advanced-samples/wled_signal.yaml](samples/advanced-samples/wled_signal.yaml) — signal head lighting for custom WS2812B signals

Save each file (Ctrl+S) then go back to ESPHome Dashboard and click **Install → Wireless** to push the update.

Use Copilot to guide each change with prompts from [copilot-steering-prompts.md](copilot-steering-prompts.md).

---

## If Something Fails

Go to [installing-esphome-cheatsheet.md](installing-esphome-cheatsheet.md) and use the **If Something Fails** section.
