# ESPHome for Model Railroading

A collection of ESPHome configs, sample files, and guides for using ESP32 boards to automate a model railroad layout — block detection, point control, and signals — all talking to JMRI/CATS over MQTT.

---

## Getting Started

New here? Follow these three steps in order:

1. **[Set up your PC](installing-esphome-cheatsheet.md)** — install Docker Desktop, enable host networking, start EMQX (MQTT broker) and ESPHome Dashboard.
2. **[Configure your first board](first-board-setup-guide.md)** — create a device in the Dashboard, load the sample config, flash it by USB, confirm it is online.
3. **[Get help from Copilot](copilot-steering-prompts.md)** — copy-paste prompts to guide you through any step with AI assistance.

### What You'll Need

**Hardware:**

Everything except transformers I source from AliExpress.

![img](_img/Parts.jpg)

- ESP32 with CP2102 USB chip: https://www.aliexpress.com/item/1005004337178335.html
- PCA9685 16-channel PWM boards (one per board, drives up to 16 servos)
- 20cm Female-Female Dupont Connectors
- 2× power supplies — one for the ESP (6.5V, regulated down to 5V by the onboard regulator) and one dedicated 5V supply for servos. I keep these completely separate from the DCC bus so a short in a power district doesn't affect servo or signal state.

**Software / Network:**

- Windows 10/11 PC with admin access (Mac/Linux is fine too!)
- 2.4 GHz Wi-Fi network with DHCP (ESP boards cannot use 5 GHz)
- Chrome or Edge browser (required for first-time USB flash)
- Docker Desktop — the [setup cheatsheet](installing-esphome-cheatsheet.md) walks through the full install

---

## My Layout — Background and Use Cases

### Background

My layout models the Illawarra line in the early 2000s between Bomaderry/Nowra, Kiama, and surrounding areas. More details at [illawarraline.net](https://illawarraline.net).

I've been chasing a reliable, low-cost automation system for a while. Previous approaches included CTI Train-Brain on an [N scale layout](https://steinosub.blogspot.com) and earlier ESP32 POCs in [Arduino](https://github.com/aaron9589/block-detection-poc) and [MicroPython](https://github.com/aaron9589/IoCATS).

### Control System — JMRI + CATS + MQTT

I use JMRI as the backbone, with the CATS add-on for signalling logic. CATS talks to JMRI through tables, and those tables are reflected as MQTT topics — that's the integration point for ESPHome.

Useful reading:
- [JMRI MQTT documentation](https://www.jmri.org/help/en/html/hardware/mqtt/index.shtml)
- [Herding Cats YouTube series](https://www.youtube.com/watch?v=H-P1guhnVpw&list=PLfmcarbF8DzEG9taeiSSWonbz3h6VQs3F) — recommended for understanding CATS from the people who support it

### Block Detection

I use the *DCC Track Occupancy Transistor-based Current Detection Circuit - Revised* from [sumidacrossing.org](http://sumidacrossing.org/LayoutControl/TrainDetection/InductiveDetectionCircuit/). It integrates cleanly with an ESP input pin and costs around $5 per sensor.

Current sensors (AS-100) from Digikey; prototype boards from AliExpress: https://www.aliexpress.com/item/32923792538.html — each board splits lengthways into two detectors.

<img src="_img/detector_components.jpg" alt="img" style="zoom:20%;" />

<img src="_img/detectors_installed.jpg" alt="img" style="zoom:13%;" />

**Tuning notes:**
- Blocks are variable — tune one at a time, don't wire them all before testing.
- Start with the wire straight through the coil before adding extra windings.
- If it reads occupied with nothing on the track, reduce windings.
- If it doesn't detect anything under load, add windings.
- If you can't hold both states reliably, add a 10K potentiometer ([example](https://www.jaycar.com.au/10k-ohm-linear-b-single-gang-9mm-potentiometer/p/RP8510)) across the coil ends for finer adjustment.

**Adding to ESPHome** *(assumes PC setup and first board flashed)*:

1. Copy [samples/my-first-board/modules/block_detectors.yaml](samples/my-first-board/modules/block_detectors.yaml) into the `modules/` folder in your ESPHome config.
2. Edit the `substitutions` section at the top to match your block names and MQTT topics.
3. In `board.yaml`, make sure the `sensors:` line is uncommented:
   ```yaml
   packages:
     sensors:  !include modules/block_detectors.yaml
   ```
4. Click **Install → Wireless** to push the update.
5. Place a train on the track and check ESPHome logs — you should see `OCCUPIED` / `UNOCCUPIED` and the MQTT topic changing.

### Point Control

Servos are driven via a **PCA9685 PWM driver board** over I2C, which lets one ESP32 control up to 16 turnouts. The PCA9685 V+ rail is powered from a dedicated 5V supply — not through the ESP32.

See [samples/my-first-board/modules/point_control.yaml](samples/my-first-board/modules/point_control.yaml) for the full config with calibration sliders and JMRI topic wiring.

**Adding to ESPHome** *(assumes PC setup and first board flashed)*:

1. Copy `point_control.yaml` into the `modules/` folder in your ESPHome config and edit the substitutions (turnout name, MQTT topic, PCA9685 channel number).
2. In `board.yaml`, make sure the `points:` line is uncommented:
   ```yaml
   packages:
     points:   !include modules/point_control.yaml
   ```
3. Install wirelessly. Open `http://<board-name>.local` in Chrome or Edge — you will see calibration sliders.
4. Use the sliders to find normal and reverse endpoints. Values save to the ESP automatically.
5. Mount the servo centred, fine-tune endpoints, then send `CLOSED` or `THROWN` to the MQTT topic to confirm the point moves.

### Signals

Signals use [WLED](https://kno.wled.ge) running on a second ESP to drive WS2812B LED signal heads.

- [samples/advanced-samples/wled_signal.yaml](samples/advanced-samples/wled_signal.yaml) subscribes to CATS signal mast topics and sends JSON commands to WLED. The comments at the top explain segment/LED layout and aspect mapping.
- Full hardware build: https://illawarraline.net/signals-for-the-illawarra-line/

---

## Sample Files

### Beginner — my-first-board/

Three files that work together. `board.yaml` is your main config; the two module files go in a `modules/` subfolder next to it.

| File | Purpose |
|---|---|
| [my-first-board/board.yaml](samples/my-first-board/board.yaml) | Main board — Wi-Fi, MQTT, OTA, and package includes |
| [my-first-board/modules/block_detectors.yaml](samples/my-first-board/modules/block_detectors.yaml) | Train detection via current detector |
| [my-first-board/modules/point_control.yaml](samples/my-first-board/modules/point_control.yaml) | Servo turnout control via PCA9685 |
| [secrets.yaml](samples/secrets.yaml) | Template for Wi-Fi and MQTT credentials |

### Advanced — advanced-samples/

These add more capability once your first board is working. Each file is commented to explain what to change and how to add more instances.

| File | Purpose |
|---|---|
| [advanced-samples/sample_board_config.yaml](samples/advanced-samples/sample_board_config.yaml) | Board template with random boot delay (multi-board layouts) |
| [advanced-samples/end_of_block.yaml](samples/advanced-samples/end_of_block.yaml) | EOB sensors for CATS train-describer direction handling |
| [advanced-samples/ground_throws.yaml](samples/advanced-samples/ground_throws.yaml) | Physical lever inputs publishing turnout MQTT topics |
| [advanced-samples/wled_signal.yaml](samples/advanced-samples/wled_signal.yaml) | WS2812B signal heads via WLED + UART serial |
| [advanced-samples/bellcodes.yaml](samples/advanced-samples/bellcodes.yaml) | Railway bell code audio via DFPlayer Mini |
| [advanced-samples/staff_machine.yaml](samples/advanced-samples/staff_machine.yaml) | RFID staff token machine for single-line working |

---

## Questions? Comments?

If you have questions, want to contribute, or just want to chat about getting it working — please raise an issue and I'll help where I can. Thanks for reading!
