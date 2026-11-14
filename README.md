# ESPHome for Model Railroading

ESP32 boards for a model railroad: block detection and point control, talking to JMRI/CATS over MQTT.

A board watches the track and throws points. JMRI (with CATS doing the signalling logic) is the brain. The boards and JMRI meet on MQTT.

## How it fits together

![On the layout, an ESP32 reads detectors and drives point servos. A signal ESP talks UART to WLED. Both use Wi-Fi MQTT to Mosquitto, JMRI, and CATS on the layout computer.](_img/architecture.svg)

The layout computer runs Mosquitto and JMRI. CATS writes the signalling into JMRI’s tables, and those tables are the MQTT topics. Each ESP joins the 2.4 GHz Wi-Fi and uses the computer’s LAN address, never `localhost`. The point servos take a separate 5V supply. Signal masts are in the configurator: each mast is its own WS2812B strip, or one GPIO per lamp, painted from the JMRI aspect string. The earlier WLED setup in the advanced samples is obsolete.

![A block publishes ACTIVE to Mosquitto and JMRI. A turnout command comes back as THROWN, and the ESP confirms it on the State topic.](_img/mqtt-flow.svg)

A block publishes `ACTIVE` or `INACTIVE`. Leaving the block publishes `INACTIVE`. A point listens for `CLOSED` or `THROWN`, moves the servo, then publishes that same word on `<topic>/State` so the panel icon updates. The topics in the diagram are the My First Board examples. Yours are whatever you put in the configurator. Since JMRI 5.1.2 the `trains/` prefix is often blank, so check Preferences before copying one.

## What you’ll need

**Hardware.** Everything except transformers I source from AliExpress.

![Parts](_img/Parts.jpg)

- ESP32 with a CP2102 USB chip: https://www.aliexpress.com/item/1005004337178335.html
- PCA9685 16-channel PWM board (one per ESP, up to 16 servos)
- Servo Leads (the ones used in model aircraft - get a few different lengths)
- Two power supplies: one for the ESP (about 6.5V into the board’s regulator) and a separate 5V supply for the servos. Keep both off the DCC bus so a track short doesn’t move points or signals.

**On the computer**

- Windows 10/11, or a Mac
- ESPHome Device Builder, Mosquitto, and MQTTX, from the install script below
- 2.4 GHz Wi-Fi with DHCP (these boards cannot use 5 GHz)
- Chrome or Edge for the first USB flash

## Start here

### 1. Install ESPHome, Mosquitto, and MQTTX

The script asks install or uninstall. Install opens the ESPHome dashboard and MQTTX when it finishes, then offers to open the Board Configurator in your browser. In MQTTX connect to `127.0.0.1` port `1883` (no username) to watch Mosquitto traffic.

Mac — Terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/aaron9589/esphome-for-model-railroading/main/scripts/install-mac.sh -o /tmp/esphome-mr-setup.sh && bash /tmp/esphome-mr-setup.sh
```

Windows — PowerShell. You do not need to start it as administrator. The script asks for that itself.

```powershell
irm https://raw.githubusercontent.com/aaron9589/esphome-for-model-railroading/main/scripts/install-windows.ps1 -OutFile "$env:TEMP\esphome-mr-setup.ps1"; Start-Process powershell -Verb RunAs -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$env:TEMP\esphome-mr-setup.ps1`""
```

Type `1` to install. If something fails later, see **If Something Fails** in [first-board-setup-guide.md](docs/first-board-setup-guide.md).

### 2. Build `board.yaml`

**[Open the Board Configurator](https://aaron9589.github.io/esphome-for-model-railroading/)**

Click **My first board**, fill in Wi-Fi and this computer’s MQTT address, add the blocks and points you actually have, then download the file. Paste it into ESPHome. Don’t edit the YAML by hand — import the same file back into the configurator when you want to change something. The file contains your Wi-Fi password, so don’t commit it.

### 3. Flash it

[Flash the downloaded file](docs/first-board-setup-guide.md) by USB the first time. Later changes install over Wi-Fi.

### 4. Check it in JMRI

[Check it in JMRI](docs/jmri-mqtt-verification-guide.md) once a train and a turnout move.

## After the first board

Wiring, detector tuning, how points remember their positions, and the layout this was built for are in [How the boards work](docs/README.md).

| If you want… | Go here |
|---|---|
| The detector schematic and how to tune a block | [How the boards work](docs/README.md) |
| Flash and MQTT smoke test | [first-board-setup-guide.md](docs/first-board-setup-guide.md) |
| Advanced layout patterns (not Configurator YAML) | [advanced-samples/](advanced-samples/) |

Signals, staff tokens, bell codes, end-of-block pulses, and hand throws are not in the configurator. The diagrams and the YAML are in [advanced-samples](advanced-samples/README.md).

![End-of-block sensors, ground throws, bell codes, a staff machine, and a signal ESP all talk MQTT to Mosquitto, JMRI, and CATS.](_img/advanced-overview.svg)

Open an issue if you get stuck. I’ll help where I can.
