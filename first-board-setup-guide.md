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
