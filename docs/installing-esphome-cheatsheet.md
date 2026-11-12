# Simple Setup: ESPHome + Mosquitto (Windows and Mac)

This is the easiest path for a first-time layout PC. It does not use Docker, so you do not need Intel VT or host networking.

Goal:
- Install the ESPHome Device Builder desktop app
- Install Mosquitto (the MQTT broker JMRI and your ESP boards talk to)
- Install MQTT Explorer so you can watch topics on the broker
- Confirm they are running

Creating and flashing your first board is covered in [first-board-setup-guide.md](first-board-setup-guide.md).

The commands below are the same ones as in the [README](../README.md). They are the normal way to install. The click-by-click steps under that are only if you would rather do it yourself.

---

## One command

The script asks you to **Install** or **Uninstall**. Install sets up ESPHome Device Builder, Mosquitto, and MQTT Explorer, opens port 1883 on a home network (no MQTT username), checks that publish/subscribe works, and launches the dashboard plus MQTT Explorer. In MQTT Explorer connect to `127.0.0.1` port `1883` with no username. Uninstall removes those three and leaves Homebrew (Mac) and your board files in place. It is safe to run again. It prints every step and saves a log.

It does **not** put your Wi-Fi password anywhere. You still paste a Configurator `board.yaml` afterwards.

**Mac** — open Terminal and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/aaron9589/esphome-for-model-railroading/main/scripts/install-mac.sh -o /tmp/esphome-mr-setup.sh && bash /tmp/esphome-mr-setup.sh
```

It asks you to type 1 (install), 2 (uninstall), or 3 (quit). Uninstall then asks you to type `uninstall`. It will ask for your Mac login password when Homebrew or the firewall needs it. If a popup asks to install command line tools, click Install, wait until that finishes, then paste the command again.

**Windows** — open PowerShell (you do not need to right-click Run as administrator) and paste:

```powershell
irm https://raw.githubusercontent.com/aaron9589/esphome-for-model-railroading/main/scripts/install-windows.ps1 -OutFile "$env:TEMP\esphome-mr-setup.ps1"; Start-Process powershell -Verb RunAs -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$env:TEMP\esphome-mr-setup.ps1`""
```

Approve the User Account Control prompt. In the blue window, type 1 (install), 2 (uninstall), or 3 (quit). Uninstall then asks you to type `uninstall`. Leave that window open until it finishes, then press Enter.

Logs:
- Mac: `~/Library/Logs/esphome-mr-setup.log`
- Windows: `C:\Users\you\esphome-mr-setup.log`

If you already cloned this repo, you can run the same scripts from disk: `bash scripts/install-mac.sh` or the PowerShell file `scripts/install-windows.ps1`.

---

## Before You Start

You need:
- Windows 10/11, or macOS 10.15 or newer (Apple Silicon preferred; Intel Mac support in ESPHome is ending)
- A 2.4 GHz Wi-Fi network with DHCP (ESP boards cannot use 5 GHz)
- Chrome or Edge for the first USB flash

You do **not** need Docker, WSL, or a Docker Hub account.

---

## 1. Install ESPHome Device Builder

Download the desktop app from [esphome.io/install](https://esphome.io/install/) (same installers as [desktop.esphome.io](https://desktop.esphome.io/)). It bundles Python. There is nothing else to install for ESPHome.

**Windows**

1. Download the `.exe` installer.
2. Run it. If Windows asks to allow changes, choose **Yes**.
3. If you see "Windows protected your PC", click **More info → Run anyway**.
4. Launch **ESPHome Device Builder** from the Start menu.

**Mac**

1. Download the `.dmg` that matches your Mac (Apple menu → About This Mac: Apple M1/M2/M3/M4 = Apple Silicon; Intel = Intel).
2. Open the disk image and drag **ESPHome Device Builder** into **Applications**.
3. Open it from Applications. The first time, macOS may ask you to confirm — click **Open**.

The first launch downloads ESPHome in the background and can take a few minutes. When it finishes, your browser opens http://localhost:6052.

Success looks like:
- The dashboard loads and shows a **New Device** button.
- An ESPHome icon sits in the menu bar (Mac) or notification area (Windows).

Your board YAML files live in your home folder:

| | Config folder |
|---|---|
| Mac | `~/esphome` (for example `/Users/you/esphome`) |
| Windows | `C:\Users\you\esphome` |

Tray / menu-bar icon → **Open Config Folder** opens that directory. You only need it if you edit files by hand. The [Board Configurator](https://aaron9589.github.io/esphome-for-model-railroading/) is the usual way to produce `board.yaml`.

> **Screenshot placeholder:** ESPHome Dashboard at http://localhost:6052 — empty dashboard with the **New Device** button, and the ESPHome menu-bar or tray icon visible.

The desktop app installs a current ESPHome. This repo's generated YAML needs **ESPHome 2024.6.0 or newer** (`ota: platform: esphome`).

---

## 2. Install Mosquitto (MQTT broker)

Mosquitto is a small native broker. ESP boards and JMRI connect to it on port **1883**. It has no web page — that is expected.

### Windows

1. Download the 64-bit installer from [mosquitto.org/download](https://mosquitto.org/download/).
2. Run it. Leave the **Service** component selected so Mosquitto starts with Windows.
3. Open `C:\Program Files\mosquitto\mosquitto.conf` in Notepad **as Administrator**.
4. Make sure these two lines exist and are not commented out (no `#` in front):

```conf
listener 1883
allow_anonymous true
```

5. Save, then in an Administrator PowerShell window:

```powershell
net stop mosquitto
net start mosquitto
```

6. Allow Mosquitto through Windows Firewall when prompted, or add an inbound rule for TCP **1883**. Boards on Wi-Fi cannot connect if the firewall blocks that port.

`mosquitto_pub` and `mosquitto_sub` live in `C:\Program Files\mosquitto`. If the commands below are not found, `cd` there first.

### Mac

1. Install [Homebrew](https://brew.sh/) if you do not already have it.
2. In Terminal:

```bash
brew install mosquitto
brew services start mosquitto
```

3. Open the config file:
   - Apple Silicon: `/opt/homebrew/etc/mosquitto/mosquitto.conf`
   - Intel Mac: `/usr/local/etc/mosquitto/mosquitto.conf`
4. Make sure these two lines exist and are not commented out:

```conf
listener 1883
allow_anonymous true
```

5. Restart it:

```bash
brew services restart mosquitto
```

If macOS asks to allow incoming connections for `mosquitto`, allow them. Otherwise boards on Wi-Fi cannot reach the broker.

### Why those two lines

Mosquitto 2 only listens on this computer until you set `listener 1883`. `allow_anonymous true` matches the beginner YAML from the Configurator, which connects with no MQTT username or password. Use this only on a home network you trust. If you add a username later, put the same username and password in the board YAML and in JMRI.

### Check that it works

**Mac** (or Windows if the tools are on your PATH):

```bash
mosquitto_sub -h localhost -t 'test/#' -v
```

Leave that running. In a second terminal:

```bash
mosquitto_pub -h localhost -t 'test/hello' -m 'Mosquitto works'
```

The first terminal should print `test/hello Mosquitto works`.

### The address your boards and JMRI use

`localhost` only works for programs on this PC. The ESP board must use this computer's **LAN IP**.

- **Windows:** PowerShell → `ipconfig` → `IPv4 Address` on your Wi-Fi or Ethernet adapter.
- **Mac:** System Settings → Network → Wi-Fi (or Ethernet) → Details → IP address. Or, for Wi-Fi: `ipconfig getifaddr en0`.

Put that address in the Configurator as **MQTT broker IP** (for example `192.168.1.50`). Use the same address in JMRI's MQTT connection. Do not use `localhost` or `127.0.0.1` in the board YAML.

---

## 3. MQTT Explorer

Mosquitto does not show connected clients in a browser. The install script puts [MQTT Explorer](https://mqtt-explorer.com/) on the PC for watching topics. If you installed by hand instead, download it from that site.

1. Open MQTT Explorer and create a connection to `127.0.0.1` (or `localhost`) port `1883` with no username.
2. Subscribe to `#` to see every message.

Use it later to confirm a board is publishing, or that JMRI and the ESP both see `THROWN`.

> **Screenshot placeholder:** MQTT Explorer connected to localhost:1883, subscribed to `#`, showing a test message.

---

## Next Step

Your PC is ready. Go to [first-board-setup-guide.md](first-board-setup-guide.md) to paste a Configurator `board.yaml` and flash your first board.

---

## If Something Fails

**ESPHome dashboard does not open:**
The first launch is still downloading. Wait a few minutes, then use the menu-bar or tray icon → **Open Dashboard**. If it still fails, icon → **View Logs**.

**Port already in use:**
Something else is using 1883 (Mosquitto) or 6052 (ESPHome).

Windows:

```powershell
netstat -ano | findstr ":1883 :6052"
```

Mac:

```bash
lsof -nP -iTCP:1883 -sTCP:LISTEN
lsof -nP -iTCP:6052 -sTCP:LISTEN
```

Quit the other program, or stop a leftover Docker container if you used to run EMQX or ESPHome that way.

**`mosquitto_pub` says connection refused:**
The service is not running. Windows: `net start mosquitto`. Mac: `brew services start mosquitto`.

**A program on this PC can connect, but the ESP or JMRI cannot:**
- `listener 1883` is missing or still commented out, so Mosquitto is in local-only mode. Add the line and restart.
- The board YAML or JMRI is using `localhost` instead of the PC's LAN IP.
- The firewall is blocking inbound TCP 1883.

**ESP board not found on first flash:**
- Use a data USB cable, not a charge-only cable.
- Use Chrome or Edge. Firefox does not support WebSerial.
- Close anything else that has the serial port open (Arduino IDE, a serial monitor).
- CP2102 boards: [Silicon Labs CP210x driver](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers). CH340 boards: install the manufacturer's CH340 driver for your OS.

**Board will not connect to Wi-Fi:**
- The network must be 2.4 GHz.
- The Wi-Fi name and password in the downloaded YAML are case-sensitive.
- The router must be handing out addresses with DHCP.

**Board is Online in ESPHome but never talks to MQTT:**
- Broker IP in the YAML is the PC's LAN IP, not `localhost`.
- Mosquitto is running and listening on 1883 (see the pub/sub check above, then try `mosquitto_sub -h <LAN-IP> -t 'test/#' -v` from this PC).
- No MQTT username is set on the broker unless you also set it in the YAML and in JMRI.
