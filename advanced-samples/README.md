# Advanced samples

These YAML files are **not** Board Configurator compatible. They are kept for interest — patterns used on a real layout where ESPHome does more than block detectors and PCA9685 points.

For a first board, use the [Board Configurator](https://aaron9589.github.io/esphome-for-model-railroading/) instead. Block detection and points live there now.

Each file below is a fragment or a specialised board. Copy ideas into your own ESPHome config; do not expect Import in the Configurator to understand them.

---

## What’s here

| File | What it shows |
|---|---|
| [sample_board_config.yaml](sample_board_config.yaml) | A full board shell (Wi-Fi, MQTT, logging, boot delay) that other packages can hang off |
| [end_of_block.yaml](end_of_block.yaml) | Short “end of block” pulses so CATS train describers know which way a train entered |
| [ground_throws.yaml](ground_throws.yaml) | Manual ground-throw levers reported to JMRI/CATS (optional signal interlocking) |
| [bellcodes.yaml](bellcodes.yaml) | MQTT → DFPlayer MP3 bell codes between stations |
| [staff_machine.yaml](staff_machine.yaml) | RFID staff token machine for single-line working |
| [wled_signal.yaml](wled_signal.yaml) | Signal masts via WLED on a second ESP (UART + WS2812B) |

---

## Layout sketch

How these pieces sit relative to the usual Configurator board:

```text
                    ┌─────────────────────┐
                    │  JMRI / CATS panel  │
                    └──────────┬──────────┘
                               │ MQTT
                    ┌──────────▼──────────┐
                    │     Mosquitto       │
                    └──────────┬──────────┘
           ┌───────────────────┼───────────────────┐
           │                   │                   │
           ▼                   ▼                   ▼
   ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
   │ Configurator  │   │ Staff / bells │   │ WLED signals  │
   │ board (blocks │   │ (this folder) │   │ (2nd ESP)     │
   │ + PCA points) │   │               │   │               │
   └───────────────┘   └───────────────┘   └───────────────┘
```

---

## Brief notes

### End of block

Wrong-road running needs a brief ACTIVE on an EOB topic **before** the main block sensor, so the train describer flips the right way.

```text
  train →  [EOB pulse]  →  [block OCCUPIED]
                │                │
                └──── MQTT ──────┘
```

### Ground throws

A microswitch on the lever publishes CLOSED/THROWN. Optional check: refuse the move while a signal is cleared.

```text
  lever ──GPIO──► ESP ──MQTT──► JMRI turnout
                     ▲
                     └── optional signal lever topic
```

### Bell codes

CATS/JMRI (or another ESP) publishes a topic; the DFPlayer plays the matching MP3 (departure, arrival, staff action, and so on).

### Staff machine

Scan an RFID token to issue authority on a single track; scan again to return it. MQTT tells CATS the section is locked or free. Optional DFPlayer/LED for feedback.

### WLED signals

The layout ESP talks UART to a second board running [WLED](https://kno.wled.ge). CATS mast aspects become LED colours on WS2812B heads. Hardware notes: https://illawarraline.net/signals-for-the-illawarra-line/

---

Open an issue if you adapt one of these and get stuck.
