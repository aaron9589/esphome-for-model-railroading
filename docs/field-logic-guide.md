# Field Logic Guide

Field Logic lets a board work out its own signals from rules you build on the configurator's **Logic** page, so the signals keep working when JMRI is closed.

This guide is written in chapters, one for each part of the Logic page as it is built. This first chapter covers the groundwork that rules will stand on:

- a name that is unique at a meet (the **suffix**)
- more sensor pins with an **expander**
- **Share with other boards**
- **blocks**: a stretch of track made of several sensors, which JMRI sees as one sensor
- **linked boards**: reading another board's sensors.

There are no rules yet. Everything in this chapter already works on its own: a block reports to JMRI and CATS like any sensor.

Use this after the [First Board Setup Guide](first-board-setup-guide.md) and the [JMRI MQTT Verification Guide](jmri-mqtt-verification-guide.md). Your board should be online in ESPHome, and JMRI should have its MQTT connection set up.

> **Testers:** the Logic page is not on the live configurator yet. Until it is, open it from the `feature/logic` branch. Download the branch as a ZIP from GitHub (**Code → Download ZIP** on the `feature/logic` branch), unzip it, and open `configurator/index.html` in Chrome or Edge. It does not see the board saved on the live site, so bring it across with **Import → From a file** and your `board.yaml`.

---

## The worked example

One board, `kiama-north`, watches one stretch of track called **Int 2**. It has three sensors:

- **Int 2 current**: the current detector you already know, which sees anything drawing track power anywhere in Int 2
- **Int 2 East** and **Int 2 West**: an optical sensor at each end of Int 2, which sees any car at that spot, powered or not.

A current detector misses unpowered cars, so the tail of a train can leave Int 2 reading clear behind it. An optical sensor at the boundary covers that gap. Grouped as a block, Int 2 reads occupied while **any** of the three sees something.

> **Screenshot placeholder:** a sketch of Int 2: the current detector's feeder across the whole block, and an optical sensor in the track at each end.

---

## Step 1: Check the board's name has a suffix

Boards that share or run logic need a name that no other board at a meet has. The configurator adds six characters to every new board's name, such as `kiama-north-k7m4x2`. Those six characters are this board's own, and they stay when you rename it.

1. Open the configurator's **Board** page.
2. Look at **Board name**. If it ends in a dash and six characters, it has a suffix. Go on to Step 2.
3. If it has none, click **Add a suffix**.

The board's network name changes, so the next flash must be by USB (Step 6).

**Copied a file?** If you made this board from another board's `board.yaml`, click **New suffix**. Two boards must never share a suffix. This changes the network name too, so flash by USB next.

> **Screenshot placeholder:** Board page with the board name field ending in `-k7m4x2`, and the New suffix button beside it.

---

## Step 2: Add the sensors

Both kinds of sensor go on the **Sensors** page, and both are wired the same way: the sensor's output to the pin, and its GND to GND. The Sensors page does not need to know which kind each one is.

1. Add **Int 2 current** on a free pin, as in the first board guide.
2. Add **Int 2 East** and **Int 2 West** the same way.
3. Leave **Debounce** at `500ms`. It bridges the gap between two cars passing an optical sensor.

For an optical sensor, use a module with a digital output (often labelled `DO` or `OUT`) that goes low when it sees something. The ESP pin has no pull-up of its own, so the module must drive the wire itself, as a current detector does (see [detector wiring](README.md)). Most modules with a `DO` pin have their own pull-up and do. A bare sensor with no module board needs a pull-up resistor. Power the module from the ESP's 3.3V pin, and wire `OUT` to the sensor pin and `GND` to GND. Check the module's own notes before you power it. (An expander pin does have a pull-up, so either kind works there.)

> **Screenshot placeholder:** Sensors page with Int 2 current, Int 2 East and Int 2 West, each with its pin.

Success looks like:
- The three sensors are listed with no red message at the top of the page.

---

## Step 3 (if you run out of pins): Add an expander

Logic boards need a lot of inputs: a current detector for every block and an optical sensor at every boundary. When the Sensors page says no ESP pins are free, add an **MCP23017 expander**. It adds 16 sensor pins over I2C.

1. On the **Sensors** page, under **Expanders (MCP23017)**, click **Add expander**.
2. Pick its **I2C bus**:
   - On a board with a PCA9685 for turnouts, share that PCA9685's pins. That saves two ESP pins, and the addresses do not clash.
   - Otherwise, give it its own **SDA pin** and **SCL pin**.
3. Set **Address** to match the A0, A1 and A2 links on the expander board. All three to GND is `0x20`. Two expanders on the same bus need different addresses.
4. In a sensor's **Pin** list, pick an expander pin, such as **MCP 1 · B3**. Wire it the same as an ESP pin: the sensor's output to the expander pin, and GND to GND.

> **Screenshot placeholder:** the Expanders card with MCP 1 sharing PCA9685 1's pins at 0x20, and a sensor's Pin list open on the MCP 1 pins.

If an expander stops answering while the board is running, its pins keep their last value. So any block with a sensor on that expander reads **occupied** until the expander answers again. A train is never lost that way. The sensor's own JMRI sensor may keep its last value meanwhile.

---

## Step 4: Choose Field Logic, and share

1. Open the **Logic** page.
2. Set **Logic** to **Field Logic**.
3. Under **Settings**, leave **Share with other boards** ticked. It is on by default in Field Logic.

Share makes the board publish what other boards need to read it:

| What | Topic | JMRI sees it? |
|---|---|---|
| Board online | `trains/track/sensor/board/<board>/Online` | Yes, as a sensor |
| Each sensor's state, kept on the broker | `<sensor topic>/State` | No |
| Each turnout's movement | `trains/track/sensor/<turnout>/Moving` | No |
| Each signal's aspect | `<mast topic>/State` | No |

The board also checks that no other board on the broker has its name. If one does, it says **Clash** on the board's web page, under **Board name check**, and in its logs.

A board with no logic can tick Share too, so the boards next to it can read its sensors.

> **Screenshot placeholder:** Logic page with Field Logic chosen, Share with other boards ticked, and the Next steps list.

---

## Step 5: Add the block

1. On the Logic page, under **Blocks**, click **Add a block**.
2. Type **Int 2** as its **Name**. The **MQTT topic** fills in as `trains/track/sensor/Int 2`.
3. In **Add a sensor…**, pick **Int 2 current**. Then pick **Int 2 East**, then **Int 2 West**.

The block now reads occupied while any of the three sees something.

> **Screenshot placeholder:** the Blocks card with Int 2 and its three sensors listed.

**A sensor between two blocks.** An optical sensor at a boundary belongs to the blocks on both sides of it. If the next block east is Int 3, add Int 2 East to Int 3 as well. Each block then holds occupied until the last car has passed the boundary. A sensor in three or more blocks gets a warning, because a boundary only has two sides.

Success looks like:
- **Next steps** at the top of the Logic page shows *Add blocks and signals* as **Done**.
- No red message at the top of the page.

If a message says a block *uses sensor "…", which is not on the Sensors page*, that sensor was deleted or renamed somewhere else. Renaming a sensor on the Sensors page renames it in every block too, so this usually means it was deleted. Pick another sensor, or remove that one from the block.

---

## Step 6: Flash the board and watch MQTT

1. Download the YAML and install it, as in the [First Board Setup Guide](first-board-setup-guide.md). If you clicked **Add a suffix** or **New suffix** in Step 1, install by USB (**Install → Plug into this computer**). Otherwise install wirelessly, as usual.
2. Open **MQTTX**, connect to `127.0.0.1:1883` with no username, and subscribe to `trains/#`.

Success looks like:
- `trains/track/sensor/board/kiama-north-k7m4x2/Online` shows `ACTIVE`.
- Covering **Int 2 East** with your hand shows `ACTIVE` on `trains/track/sensor/Int 2 East` **and** on `trains/track/sensor/Int 2`.
- Uncovering it shows `INACTIVE` on both. Each change comes about half a second after the sensor sees it (the Debounce).
- `trains/track/sensor/Int 2/State` shows the same, and MQTTX marks it as retained.

In the board's ESPHome **Logs**, the block logs `Int 2 | OCCUPIED` and `Int 2 | UNOCCUPIED`.

> **Screenshot placeholder:** MQTTX showing `trains/track/sensor/Int 2` and `trains/track/sensor/Int 2 East` both ACTIVE, and the board's Online topic.

---

## Step 7: See the block in JMRI

1. On the configurator's **Download** page, under **JMRI tables**, tick **Logic**. Its hint says *This board's Online sensor and 1 block.* You can untick the others if JMRI already has them.
2. Click **Download JMRI XML**.
3. In PanelPro, use **File → Load table content and panels** and pick the file. Then use **File → Store table content and panels** so JMRI keeps them.
4. Open the **Sensor Table** (Tools → Tables → Sensors).

Success looks like:
- `MSInt 2` and `MSboard/kiama-north-k7m4x2/Online` are in the table.
- `MSboard/kiama-north-k7m4x2/Online` is **Active**.
- Covering an optical sensor turns `MSInt 2` **Active**. Uncovering it turns it **Inactive**.

> **Screenshot placeholder:** JMRI Sensor Table with `MSInt 2` Active and the board's Online sensor.

CATS can use `MSInt 2` as the block's detector and ignore the three sensors inside it. Those keep their own topics, so a panel that already uses them still works.

---

## Reading another board's sensors

A block can include a sensor from the board next door. For example, an optical sensor at the edge of one board can hold a block on the next board. That board must have **Share with other boards** ticked.

1. On the Logic page, under **Linked boards**, click **Link a board's file** and pick the other board's `board.yaml`. Only its names and topics are kept, never its Wi-Fi or passwords.
   - No file to hand? Click **Type a board's name** and type its name exactly, suffix included. Then list its sensors one per line, as they are named on that board. This only works for sensors on the usual `trains/track/sensor/<name>` topics; for a board with its own topics, link its file.
2. In the block's **Add a sensor…** list, that board's sensors and blocks are listed under its name.
3. When the other board changes, click **Refresh** on it and pick its file again. The configurator says what changed.

A sensor from another board counts as **occupied** until this board has heard from it, and whenever that board is offline. A block that uses one therefore reads occupied until both boards are running and connected. It is never clear by mistake.

> **Screenshot placeholder:** Linked boards card with kiama-south linked from its file, and a block listing *Int 1 East (from kiama-south-a3f9qp)*.

---

## When something is wrong

Check one thing at a time, in this order.

**The block stays occupied with nothing on the track.**
1. In MQTTX, check each sensor in the block. One of them is `ACTIVE`, or it is from another board.
2. For a sensor from another board, check that board's Online topic shows `ACTIVE`. If it shows nothing, tick **Share with other boards** on that board, flash it, then click **Refresh** on it here.
3. For a sensor on an expander, look in the board's Logs for an I2C or MCP23017 warning. Check the expander's power, SDA, SCL and address links.

**The block is not in JMRI.**
1. On the Download page, check **Logic** was ticked when you downloaded the JMRI XML.
2. If the configurator lists the block as left out, its MQTT topic has no `track/sensor/` in it. Set the topic back to `trains/track/sensor/<name>`.

**The Online sensor stays Inactive.**
1. Check the board shows **Online** in ESPHome.
2. Check the board's MQTT broker is `layout-mqtt.local`, as in the first board guide.

The next chapter adds rules.
