# MSS Logic Guide

MSS Logic lets a board signal a module the way an MSS (Modular Signal System) module does, with no rules to write. You describe the module: its ends, its tracks and its junctions. The board works out the signals from that, and it keeps working when JMRI is closed. At a meet, you pair the modules' ends and the signals carry on across the joint.

It is an imitation of MSS over MQTT, not MSS hardware. There is no RJ45 cable and no 12V logic. Each module has an ESP32, and the layout has an MQTT broker. If a module cannot hear its neighbour, the signal at that joint shows Stop.

This guide builds two modules from an empty Logic page and pairs them:

- **West**, a plain stretch of track with two blocks.
- **East**, a track that ends at a turnout junction with two ways out.

Use it after the [First Board Setup Guide](first-board-setup-guide.md) and the [JMRI MQTT Verification Guide](jmri-mqtt-verification-guide.md). Each board should be online in ESPHome, and JMRI should have its MQTT connection set up. The [Field Logic Guide](field-logic-guide.md) covers the groundwork this guide leans on: the name suffix, sensors, expanders, flashing and MQTTX. MSS Logic and Field Logic run on the same engine, so what you learn there carries over.

> **Testers:** MSS Logic is not on the live configurator yet. Until it is, open it from the `feature/logic` branch, as the testers' note in the Field Logic Guide describes. Nothing in this guide has been tried on hardware yet. It says what should happen, from the design and from the test cases the configurator is checked against. If your board does something else, that is worth reporting.

---

## The worked example

**West** has one track from end A to end B. It is cut into two blocks, with one block boundary between them:

- **W1 current** and **W2 current**: a current detector in each block, as in the [detector wiring](README.md).
- **W12 optical**: an optical sensor at the block boundary. It sees any car at that spot, powered or not, so the tail of a train cannot slip out of a block unseen.
- Two signals at the block boundary, one facing each way: **W toward A** (seen by trains heading towards end A) and **W toward B** (seen by trains heading towards end B).

**East** has three ends. A train enters at end A, crosses two blocks, and meets a turnout junction. From there one way goes straight on to end B, and the other branches off to end C:

- **E1 current** and **E2 current**, with **E12 optical** between them, and one signal, **E Outer**, for trains heading towards the junction.
- **E Home**: the signal facing into the junction.
- **E Junction optical**: an optical sensor at the junction, so a car standing on it holds every way out.
- **E Main current** (towards end B) and **E Branch current** (towards end C).
- **E P1**, the turnout.

At the meet, **West end B meets East end A**.

> **Screenshot placeholder:** a sketch of the two modules side by side. West: end A, block W1, an optical sensor, block W2, end B. East: end A, blocks E1 and E2, the junction with E P1, and its two ways out to ends B and C.

Before you start, put the parts on the foundation pages, as in the first board guide. The Logic page picks them by name and never changes them:

- **Sensors:** every sensor named above. Wire an optical sensor like a current detector: its output to the pin, and its GND to GND. Leave **Debounce** at `500ms`.
- **Turnouts:** `E P1` on the East board.
- **Signal Masts:** every signal named above. A signal can be a WS2812B strip or one pin for each lamp. Its aspects can come from the CATS signal template, which the Signals grid in step 5 reads.
- **Board** page: check each board's name ends in a six-character suffix, such as `kiama-west-k7m4x2`. Two boards at a meet must never share one. See Step 1 of the Field Logic Guide.

---

## Step 1: Choose MSS Logic

1. Open the **Logic** page.
2. Set **Logic** to **MSS Logic**.

Under **Settings**, **Share with other boards** says *Always on in MSS Logic: neighbouring boards read it.* There is nothing to tick.

The page now lists numbered steps under **Set up this module**: **Ends**, **Tracks**, **Junctions**, **Signals** and **Download**. Each has a short hint. You can do them in any order and come back to any of them. A step with a problem shows a red dot.

> **Screenshot placeholder:** Logic page with MSS Logic chosen and the Set up this module steps listed, none done yet.

There are no rule cards in this mode. The views of what the board is doing (who uses what, the control table) still show, read-only, and each item is marked **Made by MSS Logic**. You never edit those. You change the description, and they are made again.

Success looks like:
- The steps appear, and **Ends** is marked **Next**.

---

## Step 2: Ends

An end is where track leaves the module and meets the next one. Name each end with the letter marked on the module.

On **West**:

1. Under **Ends**, click **Add an end**. Leave it named **A**, with **Tracks across this end** at `1`. One is single track and two is double track.
2. Click **Add an end** again for **B**, also with one track.
3. Optional: pick a **Pair button pin** and an **LED pin** for each end. The Pair button is a push button between the pin and GND. The LED shows the end's state (see Step 9). Leave them empty if you wish: the board's web page has a Pair button too, and it always works.

On **East**, add ends **A**, **B** and **C**, each with one track.

> **Screenshot placeholder:** the Ends card for East with ends A, B and C, and the Pair button and LED pins for end A filled in.

Success looks like:
- Each end is listed. Until you draw the tracks, each end track is reported as having no track. That is expected, and Step 3 fixes it.

---

## Step 3: Draw the track

Each track is drawn as a **strip**, left to right the way it lies on the module. Its place is named at each side.

On **West**:

1. Under **Tracks**, click **Add a track**.
2. Set **From** to **End A, track 1** and **To** to **End B, track 1**. (**Dead end (stops on the module)** is there for a track that stops, as at a terminus.)

The strip starts as one block, labelled **Through track (no signals)**. Add the block boundary:

3. Click **Add a block boundary**. It splits the last block in two: **Block 1**, a **Block boundary 1**, and **Block 2**.
4. Click **Block 1**. Under **Sensors**, pick **W1 current**. Do the same for **Block 2** with **W2 current**. A block can have more than one sensor.
5. Click **Block boundary 1**. Under **Sensors**, pick **W12 optical**. Then pick the two signals: **Signal for trains heading towards B** is **W toward B**, and the one for trains heading towards A is **W toward A**.

The two signals are drawn as arrows, ◀ for trains heading towards From and ▶ for trains heading towards To. They follow the module's own ends, so nothing changes if the module is turned round at the meet.

**A side with no signal** is drawn dashed and marked *no signal*. Pick no signal if the module has none there. The page makes one with no lights, so the signals behind it keep working.

**A block boundary holds both blocks.** The optical sensor counts as part of both Block 1 and Block 2, so a block stays occupied until the last car has cleared it, even a car that draws no current.

> **Screenshot placeholder:** the strip for West: End A, Block 1 with W1 current, the block boundary with W12 optical and its two arrows, Block 2 with W2 current, End B.

**Turnouts in a block.** If a block has a turnout in it, add it under **Turnouts in this block** and set **Main line is** to the position that is the main line. A turnout set against the main line counts as an occupied block.

Success looks like:
- The ends from Step 2 no longer report having no track, and the **Ends** and **Tracks** steps are **Done**.

---

## Step 4: A junction from a shape

This step is for **East** only. A module of plain track needs no junctions.

First draw East's tracks, as in Step 3:

1. **Track 1:** from **End A, track 1** to **Junction J1, leg 1** (add the junction first, below, or come back to this). Give it two blocks, with **E1 current** and **E2 current**, and one block boundary with **E12 optical**. For its signals, pick **E Outer** for trains heading towards the junction, and none for the other direction.
2. **Track 2:** from **Junction J1, leg 2** to **End B, track 1**, one block with **E Main current**.
3. **Track 3:** from **Junction J1, leg 3** to **End C, track 1**, one block with **E Branch current**.

Now the junction:

1. Under **Junctions**, pick a **Shape**: **Turnout, left**. The other shapes are **Turnout, right**, **Wye**, **Siding end**, **Single to double track**, **Double-track crossover** and **Custom**.
2. Pick the turnout from the **Turnout** list: **E P1**. Click **Add junction**.

The junction starts with its legs and routes filled in, and drawn:

| Leg | Where it goes |
|---|---|
| Leg 1 | the single end |
| Leg 2 | straight on |
| Leg 3 | branches off to the left |

| Route | Joins | Set when | |
|---|---|---|---|
| Straight | leg 1 to leg 2 | E P1 is closed | main |
| Turnout | leg 1 to leg 3 | E P1 is thrown | diverging |

A route is **set** while every turnout in it is in its position. A turnout that is moving matches neither position, so no route through it is set.

3. Under **Sensors**, pick **E Junction optical**. A car standing on the junction holds every leg, so each leg's first block includes it.
4. Under **Legs**, pick the signal facing into the junction from **Leg 1**: **E Home**. Legs 2 and 3 can stay at **No signal**: trains leaving the junction face the next module's signals, not this one's.

Hover a route to light it on the drawing. If your turnout is wired the other way round, change the position on the route (**Position**) rather than the wiring. If the shapes do not fit, **Custom** starts empty and you add each route as a table row.

> **Screenshot placeholder:** the Junctions card with J1 as Turnout, left, its three legs, the two routes, E Junction optical, and E Home on leg 1.

Success looks like:
- Junction J1 is listed with two routes and no red dot.
- The **Junctions** step is **Done**.

---

## Step 5: The Signals grid

Under **Signals** there is one row for each signal the module uses and one column for each indication. Each cell is the aspect that signal shows for that indication. The aspects named in the CATS signal template are filled in already.

| Indication | CATS aspect (filled in) | What it means |
|---|---|---|
| Stop | R292 | the block ahead is occupied |
| Approach | R285 | prepare to stop at the next signal |
| Clear | R281 | the way ahead is clear |
| Advance Approach | ADV_NORM | the signal two blocks ahead is at Stop. **Off by default.** |
| Approach Diverging | R282 | the signal ahead shows a diverging aspect. **Off by default.** |
| Diverging Clear | R283 | junction signals only, when a diverging route is set |
| Diverging Approach | R286 | junction signals only, when a diverging route is set |

1. Under **Indications to use**, tick **Advance Approach** and **Approach Diverging** if you want them. They are off by default, as in MSS. Agree on this with the owners of the other modules at the meet, so the signals mean the same thing everywhere. Turning one off hides its column. Aspects you picked are kept.
2. Check each cell shows the aspect you want, for every row. A cell that is empty says **Pick an aspect**. A signal's aspects come from its own page, so if a cell has nothing to pick, add the aspect on the Signal Masts page.
3. **Same as above** copies the row above into this one, for the aspects both have. Use it for signals of the same kind.

East's **E Home** shows two more columns, **Diverging Clear** and **Diverging Approach**, because it has a diverging route. West's two signals show only Stop, Approach and Clear.

> **Screenshot placeholder:** the Signals grid for East with E Outer and E Home, Advance Approach and Approach Diverging ticked, and each cell showing a small mast lit in that aspect.

### Approach lighting

A signal can stay dark until a train is near. In the grid, pick **Approach lighting** for the signal: a block or sensor. The signal shows nothing unless a train is in that block. Leave it at **Always lit** for a signal that should always show.

Success looks like:
- The **Signals** step is **Done** and no cell is empty.

---

## Step 6: Problems

Problems show in three places:

- **At the top of the page**, in red for errors that stop the download and amber for warnings. Each says what is wrong, why, and what to do.
- **A red dot** on the step that has the problem, and on the part of the page that causes it: the track, the block, the block boundary, the junction, the end or the signal's row.
- **Show** beside a message. It opens the page and scrolls to the part.

Some you may meet:

| Message says | What to do |
|---|---|
| An end has no track | Describe the track through it under **Tracks**, or give the end fewer tracks. |
| A block has no sensor | Pick the block's current sensor. |
| A block boundary has no sensor | A warning. The signals there can clear behind unpowered cars. Pick an optical sensor. |
| A leg has no track | Describe the track that meets it under **Tracks**. |
| Two routes can both be set | Two routes leave the same leg and their turnouts do not tell them apart. Give one a turnout in the other position. |
| A junction has no sensor | A warning. Pick an optical sensor, so a car on the junction is seen. |
| A signal has no aspect for an indication | Pick one in the Signals grid. |

Fix the first red message first, because others often follow from it.

Renaming a sensor, turnout or signal on its own page renames it here too. Deleting one leaves its old name behind, and the message names it.

Success looks like:
- Nothing red at the top of the page, and every step's dot is gone.

---

## Step 7: Download

The **Download** page shows the **Logic version**, a short code that is a hash of what the board has been told to do. The board shows the same code on its web page as **Logic version**. When the two match, the board is running what you checked.

In MSS Logic the page also offers **Download module card**. It is a file that opens in any browser and prints. Print it for the underside of the module, or the meet paperwork. It is made with the YAML, so it always matches, and it holds:

- the module's name, the Logic version and the date;
- each end with its tracks and its Pair and LED pins;
- every sensor and signal with its pin and where it sits (block, block boundary, leg);
- **At a meet:** how to join the meet's Wi-Fi from a phone, how to pair, what the end LED means, and the first checks when a joint shows Stop.

> **Screenshot placeholder:** the Download page with the Logic version and the Download module card button, and the printed card beside it.

Download the YAML for each board as in the first board guide.

---

## Step 8: Flash

1. Install each board's YAML, as in the [First Board Setup Guide](first-board-setup-guide.md). Install by USB the first time, or if you changed the board's name.
2. On each board's web page, check **Logic version** matches the Download page.
3. Open **MQTTX**, connect to `127.0.0.1:1883` with no username, and subscribe to `trains/#`.

Success looks like:
- Each board is **Online** in ESPHome.
- `trains/track/sensor/board/<board>/Online` is `ACTIVE`.
- Covering **W12 optical** with a hand shows `ACTIVE` on its own topic. Uncovering it shows `INACTIVE` after about half a second (the Debounce).
- The board's signals show something. A joint that is not paired yet shows Stop (see Step 9), so expect West's **W toward B** and East's **E Outer** to show a stop or approach for now.
- Each end's two values are published, retained, as `trains/track/end/<board>/<end>/<track>/Block` and `.../Mast`.

If a board does not show **Online**, go to the first board guide's checks. If the signals stay dark, check the board's **Logic on** switch (labelled **Field logic** on its web page) is on.

### Try it

Try it runs a train through a module on the page, with a pretend neighbour at each end. At the time of writing, Try it is on the Field Logic page only. MSS Logic mode does not list a Try it step.

If you want to see it now, do it on a copy:

1. Download the board's file (`board.yaml`) and keep it.
2. Use **Convert to Field Logic** (Step 12) on the page, then open **Try it**. Tick **pretend there is a neighbour** for each end, run a train in at an end, and watch the signals.
3. Re-open the file you kept for the real board.

---

## Step 9: Pair two modules

Pairing tells each end which end it meets. Nothing is reflashed at a meet.

1. Power both boards and check both are on the same Wi-Fi and the same MQTT broker.
2. On each board's web page there is a **Pair End A** button (and **Pair End B**, and so on). Press **Pair End B** on West, and **Pair End A** on East, within 30 seconds of each other. Or use the push button on the end's pin, if you wired one.

Each end announces itself while it waits, on `trains/track/end/pairing`. If exactly two ends are waiting, and they have the same number of tracks, each sets itself paired with the other.

The end's LED, if you wired one, shows how it is going:

| LED | Meaning |
|---|---|
| Slow blink | pairing |
| Steady | paired, and the other side is heard |
| Fast blink | a problem: the other side is not heard, does not agree, or refused |

Success looks like:
- On each board's web page, the end says it is **Paired with** the other and the other is heard.
- In MQTTX, West's `trains/track/end/<west>/B/1/Block` and `.../Mast` match what East's signals offer, and East's `.../A/1/...` the same the other way. Put a car on **W2 current**: East's **E Outer** should show Approach or Stop within a second or two, once the joint's message has crossed.
- Take East's power off. West's end B no longer hears it, and West's **W toward B** shows Stop. That is the fail-safe: a neighbour that is not heard counts as occupied.

**Which tracks meet.** Facing each other across a joint, one end's track 1 meets the other end's last track. So a double-track joint pairs the right tracks whichever way round the module is placed. Two ends with different track counts do not pair.

**Ends that meet nothing.** East's ends B and C meet no module here. An unpaired end reads as occupied, so the signals behind it show Stop. To tell an end it is the end of the line, open that end's text box on the board's web page (for end B it is named `End B link`, its name in ESPHome) and type `end`. Then its Block reads clear, and the signal behind it shows Approach, as it would at a terminus. The box is saved across reboots.

> **Screenshot placeholder:** East's web page with Pair End A, End A paired and heard, and MQTTX showing the two end topics.

---

## Step 10: At a meet

Nothing is reflashed.

1. **Wi-Fi.** A board that cannot find its home network starts its own hotspot, called `<board> setup`. On a phone, join it. The sign-in page opens by itself. Pick the meet's Wi-Fi and type its password. The board keeps that network until it is next flashed with changed settings. The module card says all this.
2. **Broker.** Boards look for `layout-mqtt.local`. One computer at the meet runs the install script, and every board finds it with no change.
3. **Pair.** Press Pair on both sides of each joint.

Modules can be plugged together in any order, and either way round. Turning a module round needs no change to its description, because its tracks follow its own ends and not compass directions.

If the broker goes down, each board still signals its own track. The masts at the joints drop to Stop.

---

## Step 11: When something is wrong

Check one thing at a time, in this order.

**A joint shows Stop.**
1. Is the other module powered and on the same Wi-Fi and broker?
2. Press Pair on both sides again, within 30 seconds.
3. On the board's web page, read what the end says. If it names the wrong end, press Pair again on both. If a third end joined the 30 seconds, or the track counts differ, nothing is paired, and the board's logs say so.
4. In MQTTX, `trains/track/end/<board>/<end>/<track>/Block` and `.../Mast` from the other board should appear, retained. If they do not, check that board is Online: MSS Logic always shares, so it needs nothing ticked.

**A signal stays at Stop with an empty track.**
1. In MQTTX, check each sensor in the block and the optical sensor beside it. A block boundary's optical sensor holds both blocks beside it.
2. A turnout set against the main line in a block counts as occupied.
3. At a junction, the optical sensor holds every leg, so a car standing there stops all of them.
4. Check the signal is not held by CATS or JMRI (the board follows a CATS hold, which shows Stop and passes it back behind).

**A junction signal shows Stop though the turnout looks set.**
1. A turnout that is still moving shows Stop and the signal behind it Approach. Wait for the throw to finish.
2. Check the position you gave each route matches how the turnout is really set (Step 4).

**A signal shows the wrong aspect.**
1. Check its cell in the Signals grid, and the aspect's lamps on the Signal Masts page.
2. If Advance Approach or Approach Diverging is on at one module and off at the next, the signals at the joint will not agree. Match them.

**The board is not running what you checked.**
1. Compare **Logic version** on the board's web page with the Download page. If they differ, flash again.
2. Check the board's logic switch is on.

**The page says there is a problem, and Show goes nowhere.**
1. Scroll the Logic page: the part may be further down. Fix the first red message first.

---

## Step 12: Convert to Field Logic

At the bottom of the Logic page in MSS Logic mode there is **Convert to Field Logic**. It turns the module into ordinary Field Logic. The blocks, signals, rules and ends the page made are copied over as items you can edit, and the page switches mode. The board behaves the same and its Logic version does not change. It still pairs at a meet.

Use it when a module needs something MSS Logic does not do, such as a section that only one train may enter. Add the rules in Field Logic, as in the [Field Logic Guide](field-logic-guide.md). Also use it on a copy to try the module in Try it (Step 8).

**It goes one way.** The MSS description is dropped, because nothing would keep it in step with the copies. The page asks you to confirm first. Keep a copy of the board's file (`board.yaml`) before you click if you may want the description back. If a block, signal or rule group in Field Logic already has the same name as one MSS Logic would make, or the description has an error, it will not convert and tells you which to rename or fix.

> **Screenshot placeholder:** the Convert to Field Logic card with its confirmation: *Convert this board to Field Logic? The MSS description is replaced by editable items, and this cannot be undone.*

---

## What MSS Logic does differently from MSS

- **A lost neighbour means Stop.** On an MSS bus, an unplugged cable floats high and reads clear. Here, a neighbour that is not heard counts as occupied.
- **It needs a broker.** MSS needs only the cable. Here each module has an ESP32 and the layout has an MQTT broker.
- **It is not instant.** Each signal is about 100 ms behind the next, and there is MQTT time across a joint.
- **A stop passes back as far as there are signals**, not only two blocks. With Advance Approach on, that gives the same four aspects as MSS.
- **A car on a junction holds every leg**, not only the active route's.
- **No head-on protection.** That matches MSS, which is built for following moves. Convert to Field Logic and add a one-train section if you need it.
