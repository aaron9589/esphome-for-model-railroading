# JMRI MQTT Verification Guide

Use this after completing [first-board-setup-guide.md](first-board-setup-guide.md).

Goal:
- Create a sensor and turnout entry in JMRI
- Name them to match the MQTT topics in your ESPHome config
- Watch messages flow in both directions and confirm everything is wired up correctly

---

## Before You Start

- Your ESP32 board must be online (showing **Online** in ESPHome Dashboard).
- JMRI must be running with an MQTT connection configured.
- Open JMRI **Edit → Preferences → Connections → MQTT** and confirm:
  - The **broker IP** matches your PC's IP address (the same value as `mqtt_broker` in `secrets.yaml`)
  - Note the **MQTT Channel**, **Sensor receive topic**, and **Turnout send topic** fields — you will use these to build the correct System Names below.

> **Screenshot placeholder:** JMRI Preferences → Connections → MQTT panel, showing the broker IP, MQTT Channel field (blank or `trains/`), Sensor receive topic, and Turnout send topic fields.

---

## How JMRI Builds MQTT Topics

JMRI constructs MQTT topics from three parts:

```
[MQTT Channel] + [table topic middle] + [hardware address]
```

When you create a Sensor or Turnout entry in JMRI, the **System Name** encodes the hardware address. The format is:

| Table | Prefix | Example System Name |
|---|---|---|
| Sensor | `MS` | `MSKiama/Up XOver` |
| Turnout | `MT` | `MTKiama/Up Loop` |

- `M` — identifies the MQTT connection
- `S` / `T` — identifies the table type (Sensor, Turnout)
- The rest is the **hardware address** — the full topic path, minus the MQTT Channel prefix

**User Name** is an optional friendly label you can add to any entry. With a well-structured System Name that already encodes the location and type (e.g. `MSKiama/Up XOver`), the User Name is largely redundant — but it can be handy if you want a shorter label to appear on JMRI panels.

**Since JMRI 5.1.2, MQTT Channel defaults to blank.** If you have an older JMRI install, your channel may still be `trains/`. Check your own Preferences to confirm.

---

## Part 1: Test Block Detection (ESP32 → JMRI)

The ESP32 publishes `ACTIVE` or `INACTIVE` to the sensor topic when a train enters or leaves a block. JMRI reads this and updates the Sensor table.

### Create the Sensor in JMRI

Open the **Sensor Table** (Tools → Tables → Sensors) and add a new entry.

To find the right System Name, look at `block_1_topic` in your `block_detectors.yaml`. For example:

```
block_1_topic: "trains/track/sensor/Kiama/Up XOver"
```

If MQTT Channel is **blank**, the hardware address is the full topic string:
```
track/sensor/Kiama/Up XOver
```
System Name → `MStrack/sensor/Kiama/Up XOver`

If MQTT Channel is **`trains/`**, JMRI strips that prefix — the hardware address is still:
```
track/sensor/Kiama/Up XOver
```
System Name → `MStrack/sensor/Kiama/Up XOver`

| Field | Value | Notes |
|---|---|---|
| System Name | `MStrack/sensor/Kiama/Up XOver` *(adjust to match your topic)* | Required. Encodes the MQTT hardware address. |
| User Name | e.g. `Kiama Up XOver` | Optional friendly label. With a descriptive System Name it's not really needed, but useful if you want shorter names on panels. |

> **Screenshot placeholder:** JMRI Sensor Table showing the new entry with System Name and User Name filled in, State showing **Unknown** or **Inactive**.

### Verify It Works

1. Open ESPHome Dashboard → **Logs** for your board.
2. Place a train on the block wired to that detector.
3. In the logs you should see a line like:

   ```
   [I][block_detectors:...] Kiama/Up XOver -> OCCUPIED
   ```

4. Back in JMRI, the **State** column for that sensor should change to **Active**.
5. Remove the train — the log should show `UNOCCUPIED` and JMRI should show **Inactive**.

> **Screenshot placeholder:** ESPHome Dashboard Logs panel showing the `OCCUPIED` and `UNOCCUPIED` log lines scrolling as a train is placed and removed.

> **Screenshot placeholder:** JMRI Sensor Table with the sensor's State column showing **Active** while a train is on the block.

---

## Part 2: Test Point Control (JMRI → ESP32)

JMRI publishes `CLOSED` or `THROWN` to the turnout topic when you change a turnout in the table or on a panel. The ESP32 receives this and moves the servo.

### Create the Turnout in JMRI

Open the **Turnout Table** (Tools → Tables → Turnouts) and add a new entry.

Look at `turnout_01_topic` in your `point_control.yaml`. For example:

```
turnout_01_topic: trains/track/turnout/Kiama/Up Loop
```

Hardware address (MQTT Channel blank) → `track/turnout/Kiama/Up Loop`

System Name → `MTtrack/turnout/Kiama/Up Loop`

| Field | Value | Notes |
|---|---|---|
| System Name | `MTtrack/turnout/Kiama/Up Loop` *(adjust to match your topic)* | Required. Encodes the MQTT hardware address. |
| User Name | e.g. `Kiama Up Loop` | Optional friendly label. With a descriptive System Name it's not really needed, but useful if you want shorter names on panels. |

> **Screenshot placeholder:** JMRI Turnout Table showing the new entry with System Name and User Name filled in, State showing **Unknown** or **Closed**.

### Verify It Works

1. Open ESPHome Dashboard → **Logs** for your board.
2. In the JMRI Turnout Table, click the **State** column for your new turnout to toggle it to **Thrown**.
3. In the ESPHome logs you should see:

   ```
   [I][point_control:...] up_loop -> THROWN (reverse)
   ```

4. The servo should move to the reverse (diverging) position.
5. Toggle back to **Closed** in JMRI — the log should show `CLOSED (normal)` and the servo should return to normal.

> **Screenshot placeholder:** ESPHome Dashboard Logs panel showing the `THROWN (reverse)` and `CLOSED (normal)` log lines as the JMRI turnout is toggled.

> **Screenshot placeholder:** JMRI Turnout Table with the State column showing **Thrown** after being toggled.

---

## Optional: Verify State Feedback in EMQX

When the ESP32 moves a turnout it publishes a confirmation back to `<topic>/State`. You can watch both messages in EMQX.

1. Open EMQX at http://localhost:18083 → **Diagnose → WebSocket Client**.
2. Connect, then subscribe to `#` (all topics).
3. Toggle the turnout in JMRI — you should see two messages arrive:
   - JMRI publishing `THROWN` to `track/turnout/Kiama/Up Loop`
   - The ESP32 replying `THROWN` to `track/turnout/Kiama/Up Loop/State`

The `/State` reply is what JMRI reads back to confirm the move happened. This keeps the panel icon in sync even if the servo takes a few seconds to travel.

> **Screenshot placeholder:** EMQX WebSocket Client showing both MQTT messages — the `THROWN` command from JMRI and the `THROWN` state reply from the ESP32, with timestamps.

---

## Troubleshooting

**JMRI sensor state never changes:**
- Check `block_1_topic` in `block_detectors.yaml` exactly matches the hardware address in the JMRI System Name. This is case-sensitive.
- Open EMQX → Diagnose → WebSocket Client, subscribe to `#`, and place a train on the block. If a message appears, the board is publishing correctly and the mismatch is in the JMRI System Name.
- If no message appears, check the board is **Online** in ESPHome and the block detector is wired correctly.

**Servo does not move when toggling JMRI turnout:**
- Check `turnout_01_topic` in `point_control.yaml` exactly matches the hardware address in the JMRI System Name.
- In EMQX WebSocket Client, subscribe to `#` and toggle the turnout. If no message appears, JMRI is not publishing — check the MQTT connection status in JMRI Preferences.
- If a message appears in EMQX but the servo doesn't move, check the board logs for any errors.

**State shows Unknown in JMRI after reboot:**
- This is normal on first boot if no train is on the block. The board publishes its real state on startup — wait a few seconds and the state should update.
- For turnouts, JMRI shows Unknown until it receives a `/State` reply. Toggle the turnout once to trigger a reply.

---

## Next Step

Your JMRI integration is confirmed. Now customise your layout:

→ Go back to [first-board-setup-guide.md](first-board-setup-guide.md) and follow **Add Repo Samples** to set your own block names, MQTT topics, and turnout channels.
