# JMRI MQTT Verification Guide

Use this after completing [first-board-setup-guide.md](first-board-setup-guide.md).

Goal:
- Create a sensor and turnout entry in JMRI
- Name them to match the MQTT topics in your ESPHome config
- Watch messages flow in both directions and confirm everything is wired up correctly

---

## Before You Start

- Your ESP32 board must be online (showing **Online** in ESPHome Dashboard).
- Your config must include at least one block detector and one point (Configurator **My First Board** preset, or modules enabled — see [first-board-setup-guide.md](first-board-setup-guide.md)).
- JMRI must be running with an MQTT connection configured.
- Open JMRI **Edit → Preferences → Connections → MQTT** and confirm:
  - **IP Address/Host Name** matches `mqtt:` → `broker:` in your board YAML. A new board uses `layout-mqtt.local`. **TCP/UDP Port** is `1883`.
  - **Connection Prefix** is `M`, so names come out as `MS…` and `MT…`.
  - Tick **Additional Connection Settings**. **Channel** is `trains/`, the start of every topic the configurator writes.
  - Leave the turnout, sensor, and signal mast topics at their defaults (`track/turnout/{0}`, `track/sensor/{0}`, `track/signalmast/{0}`). `{0}` is the hardware address.
  - Save and restart JMRI after changing any of these.

The configurator's **Download** page shows the same settings under *JMRI → MQTT connection*.

> **Screenshot placeholder:** JMRI Preferences → Connections → MQTT panel with Additional Connection Settings ticked, showing the host name, port 1883, Connection Prefix `M`, Channel `trains/`, and the default turnout, sensor, and signal mast topics.

---

## How JMRI Builds MQTT Topics

JMRI constructs MQTT topics from three parts:

```
[MQTT Channel] + [object type topic] + [hardware address]
```

- **MQTT Channel** — a single prefix applied to every MQTT message JMRI sends or receives. The configurator's topics need `trains/`.
- **Object type topic** — a separate per-type field in JMRI Preferences (e.g. `Sensor receive topic`, `Turnout send topic`). Each table has its own value such as `track/sensor/` or `track/turnout/`.
- **Hardware address** — the location/name you enter when adding an entry to the table.

When you create a Sensor or Turnout entry in JMRI, the **System Name** encodes the hardware address. The format is:

| Table | Prefix auto-added | Example Hardware Address | Resulting System Name |
|---|---|---|---|
| Sensor | `MS` | `Kiama/Up XOver` | `MSKiama/Up XOver` |
| Turnout | `MT` | `Kiama/Up Loop` | `MTKiama/Up Loop` |

When you add an entry, JMRI asks for the **Hardware Address** — just the location/name portion. It prepends the `M` (MQTT) and `S`/`T` (table type) automatically to form the System Name.

- The **Hardware Address** is what you choose — it becomes the identifying part of the MQTT topic.
- The full MQTT topic is assembled by JMRI as: `[MQTT Channel]` + `[object type topic]` + `[hardware address]`

**User Name** is an optional friendly label. With a descriptive Hardware Address that already encodes the location (e.g. `Kiama/Up XOver`), it's largely redundant — but useful if you want shorter names on JMRI panels.

**JMRI's default Channel does not match the board.** Since JMRI 5.1.2 it is blank, and before that it was `/trains/`, with a leading slash. Both miss topics that start `trains/`. Set it to `trains/`.

---

## Shortcut: Load the JMRI XML from the Configurator

Instead of adding each entry by hand, open the Configurator's **Download** page and click **Download JMRI XML**. It lists this board's sensors, turnouts, and signal masts as MQTT items, with system names built from their topics (for example `MSKiama/Up XOver` and `MTKiama/Up Loop`). Each turnout comes with its position sensor (`MSKiama/Up Loop/Thrown`), already set as the turnout's feedback. Untick the tables you do not want. CATS sets up its own sensors and turnouts, so for CATS tick only **Signal Masts**.

In PanelPro, use **File → Load table content and panels** and pick the file. Then use **File → Store table content and panels** so JMRI keeps them. Signal masts also need the CATS signal template loaded first. It is step 1 on the same page. The file assumes JMRI's usual type topics (`track/sensor/`, `track/turnout/`, `track/signalmast/`). It also notes which MQTT Channel the topics expect.

The steps below still show how to check each entry works.

---

## Part 1: Test Block Detection (ESP32 → JMRI)

The ESP32 publishes `ACTIVE` or `INACTIVE` to the sensor topic when a train enters or leaves a block. JMRI reads this and updates the Sensor table.

### Create the Sensor in JMRI

Open the **Sensor Table** (Tools → Tables → Sensors) and click **Add**.

JMRI's Add dialog asks for a **Hardware Address** — this is the part you fill in. When you save, JMRI automatically builds the System Name by prepending `MS` to whatever you entered.

For example, entering `Kiama/Up XOver` as the Hardware Address produces:
- **System Name:** `MSKiama/Up XOver`
- **MQTT topic:** `trains/track/sensor/Kiama/Up XOver` (MQTT Channel `trains/` + Sensor receive topic `track/sensor/` + hardware address)

To find the right Hardware Address, look at `block_1_topic` in your `block_detectors.yaml` and strip the MQTT Channel and Sensor receive topic values (both shown in JMRI Preferences → Additional Connection Settings). For example, if:

```
block_1_topic: "trains/track/sensor/Kiama/Up XOver"
```

and your MQTT Channel is `trains/` and Sensor receive topic is `track/sensor/`, enter just the hardware address portion — the part that identifies this specific sensor on your layout:

```
Kiama/Up XOver
```

JMRI assembles the full topic by combining MQTT Channel + Sensor receive topic + hardware address.

| Field | Value | Notes |
|---|---|---|
| Hardware Address | `Kiama/Up XOver` *(adjust to match your layout)* | JMRI builds the System Name (`MSKiama/Up XOver`) and MQTT topic from this. |
| User Name | e.g. `Kiama Up XOver` | Optional friendly label. With a descriptive Hardware Address it's not really needed, but useful for shorter panel names. |

> **Screenshot placeholder:** JMRI Sensor Table showing the new entry with System Name and User Name filled in, State showing **Unknown** or **Inactive**.

### Verify It Works

1. Open ESPHome Dashboard → **Logs** for your board.
2. Place a train on the block wired to that detector.
3. In the logs you should see a line like:

   ```
   [I][block_sensor:...] Kiama/Up XOver | OCCUPIED
   ```

   (`Kiama/Up XOver` comes from `block_1_name` in `block_detectors.yaml` — a log label, not the MQTT topic.)

4. Back in JMRI, the **State** column for that sensor should change to **Active**.
5. Remove the train — the log should show `UNOCCUPIED` and JMRI should show **Inactive**.

> **Screenshot placeholder:** ESPHome Dashboard Logs panel showing the `OCCUPIED` and `UNOCCUPIED` log lines scrolling as a train is placed and removed.

> **Screenshot placeholder:** JMRI Sensor Table with the sensor's State column showing **Active** while a train is on the block.

---

## Part 2: Test Point Control (JMRI → ESP32)

JMRI publishes `CLOSED` or `THROWN` to the turnout topic when you change a turnout in the table or on a panel. The ESP32 receives this and moves the servo.

### Create the Turnout in JMRI

Open the **Turnout Table** (Tools → Tables → Turnouts) and click **Add**.

Same principle as sensors — JMRI asks for a **Hardware Address** and automatically prepends `MT` to form the System Name.

For example, entering `Kiama/Up Loop` as the Hardware Address produces:
- **System Name:** `MTKiama/Up Loop`
- **MQTT topic:** `trains/track/turnout/Kiama/Up Loop` (MQTT Channel `trains/` + Turnout send topic `track/turnout/` + hardware address)

To find the right Hardware Address, look at `turnout_01_topic` in your `point_control.yaml` and strip the MQTT Channel and Turnout send topic values (both shown in JMRI Preferences → Additional Connection Settings). For example, if:

```
turnout_01_topic: trains/track/turnout/Kiama/Up Loop
```

and your MQTT Channel is `trains/` and Turnout send topic is `track/turnout/`, enter the hardware address portion:

```
Kiama/Up Loop
```

| Field | Value | Notes |
|---|---|---|
| Hardware Address | `Kiama/Up Loop` *(adjust to match your layout)* | JMRI builds the System Name (`MTKiama/Up Loop`) and MQTT topic from this. |
| User Name | e.g. `Kiama Up Loop` | Optional friendly label. With a descriptive Hardware Address it's not really needed, but useful for shorter panel names. |

> **Screenshot placeholder:** JMRI Turnout Table showing the new entry with System Name and User Name filled in, State showing **Unknown** or **Closed**.

### Give the Turnout Its Feedback Sensor

The board reports where the point really is on a sensor beside it: `ACTIVE` when thrown, `INACTIVE` when closed. Without it, JMRI assumes every command worked and never sees a fascia button throw.

1. In the **Sensor Table**, add the hardware address `Kiama/Up Loop/Thrown`. That is the sensor `MSKiama/Up Loop/Thrown`, on the topic `trains/track/sensor/Kiama/Up Loop/Thrown`.
2. In the **Turnout Table**, click **Edit** on the turnout. On the feedback settings, set the mode to **ONESENSOR** and **Sensor 1** to `MSKiama/Up Loop/Thrown`.

**Download JMRI XML** does both of these for you.

> **Screenshot placeholder:** JMRI turnout edit window with feedback mode ONESENSOR and Sensor 1 set to `MSKiama/Up Loop/Thrown`.

### Verify It Works

1. Open ESPHome Dashboard → **Logs** for your board.
2. In the JMRI Turnout Table, click the **State** column for your new turnout to toggle it to **Thrown**.
3. In the ESPHome logs you should see:

   ```
   [I][point_control:...] Kiama/Up Loop -> THROWN (reverse)
   ```

4. The servo should move to the reverse (diverging) position. A couple of seconds later, when the board reports back, the turnout's **State** in JMRI settles on **Thrown**.
5. Toggle back to **Closed** in JMRI — the log should show `CLOSED (normal)` and the servo should return to normal.
6. Press a fascia button on the point, if it has one. JMRI should follow the point.

> **Screenshot placeholder:** ESPHome Dashboard Logs panel showing the `THROWN (reverse)` and `CLOSED (normal)` log lines as the JMRI turnout is toggled.

> **Screenshot placeholder:** JMRI Turnout Table with the State column showing **Thrown** after being toggled.

---

## Optional: Verify Turnout Feedback in Mosquitto

When the ESP32 moves a turnout it reports the new position on the turnout's Thrown sensor. You can watch both messages with Mosquitto's command-line tools or [MQTTX](https://mqttx.app/).

1. Subscribe to every topic:

   ```bash
   mosquitto_sub -h localhost -t '#' -v
   ```

   Or connect MQTTX to `localhost` port `1883` and subscribe to `#`.
2. Toggle the turnout in JMRI — you should see two messages arrive:
   - JMRI publishing `THROWN` to `trains/track/turnout/Kiama/Up Loop`
   - The ESP32 replying `ACTIVE` to `trains/track/sensor/Kiama/Up Loop/Thrown`

That sensor is the turnout's feedback in JMRI, so it is what confirms the move happened. This keeps the panel icon in sync even if the servo takes a few seconds to travel.

> **Screenshot placeholder:** MQTTX showing both MQTT messages — the `THROWN` command from JMRI and the `ACTIVE` reply from the ESP32 on the Thrown sensor, with timestamps.

---

## Optional: Lock a turnout from MQTT

Tick **Remote lock** on that point in the configurator, and choose whether it starts locked or unlocked. The board then listens on the Lock topic:

```
trains/track/turnout/Kiama/Up Loop/Lock
```

Publish `LOCKED` to hold the turnout, or `UNLOCKED` to let it move. While locked, the fascia buttons do nothing, and `CLOSED` or `THROWN` on the turnout topic does nothing. If the point has a toggle switch and someone flipped it while locked, the point moves to match the switch when `UNLOCKED` arrives. The board still moves the servo back to its saved position when it boots. The default you picked is used until a lock message arrives. Publish with retain if the lock should still be there after a reboot.

```bash
mosquitto_pub -h localhost -t 'trains/track/turnout/Kiama/Up Loop/Lock' -m 'LOCKED' -r
```

The log line looks like `Kiama/Up Loop lock -> LOCKED`.

The board also reports the lock on a sensor topic, retained:

```
trains/track/sensor/Kiama/Up Loop/Locked
```

It is `ACTIVE` while locked and `INACTIVE` when not, and it is sent again whenever the board connects. In JMRI that is the sensor `MSKiama/Up Loop/Locked`. **Download JMRI XML** adds it for you. In CATS, use that sensor as the turnout's *Turnout Locked Report*. CATS then keeps the signals over the turnout at Stop and ignores local requests to move it. No other sensor on the board can use that name.

---

## Troubleshooting

**JMRI sensor state never changes:**
- Check `block_1_topic` in `block_detectors.yaml` exactly matches the hardware address in the JMRI System Name. This is case-sensitive.
- Run `mosquitto_sub -h localhost -t '#' -v` (or MQTTX) and place a train on the block. If a message appears, the board is publishing correctly and the mismatch is in the JMRI System Name.
- If no message appears, check the board is **Online** in ESPHome and the block detector is wired correctly.

**Servo does not move when toggling JMRI turnout:**
- Check `turnout_01_topic` in `point_control.yaml` exactly matches the hardware address in the JMRI System Name.
- Subscribe to `#` with `mosquitto_sub` or MQTTX and toggle the turnout. If no message appears, JMRI is not publishing — check the MQTT connection status in JMRI Preferences.
- If a message appears on the broker but the servo doesn't move, check the board logs for any errors.

**State shows Unknown in JMRI after reboot:**
- This is normal on first boot if no train is on the block. The board publishes its real state on startup — wait a few seconds and the state should update.
- A turnout remembers `CLOSED` or `THROWN` on the ESP. After a reboot it moves the servo back and publishes its Thrown sensor. Mosquitto keeps that message. A turnout that has never moved starts at normal and publishes `INACTIVE` a few seconds after the board connects.
- If a turnout stays **Unknown** or shows **Inconsistent**, check its feedback is ONESENSOR with Sensor 1 `MS<turnout>/Thrown`, and that the Channel is `trains/`.

---

## Next Step

Your JMRI integration is confirmed. Now customise your layout:

→ Re-import your `board.yaml` in the [Board Configurator](https://aaron9589.github.io/esphome-for-model-railroading/) and follow **Customise in the Configurator** in [first-board-setup-guide.md](first-board-setup-guide.md).
