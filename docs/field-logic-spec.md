# Logic Engine and Field Logic — Feature Spec (draft)

Status: draft, not built. What ships first is decided in the [implementation plan](field-logic-implementation-plan.md), not here.

This spec covers the **logic engine**, which every board with logic runs, and **Field Logic**, the mode where you write the rules. The other mode, **MSS Logic**, runs on the same engine and is in the [MSS Logic spec](mss-emulation-spec.md). See [Logic modes](#logic-modes).

## Why

Today every signal mast waits for JMRI/CATS to send an aspect over MQTT. Logic lets a board run its own signalling, the way an interlocking does. Rules read sensors, turnouts and masts on this board, and on other boards over MQTT. Rules that read only this board keep working when JMRI is closed or the broker is down. Rules that read another board fail safe to Stop while they cannot hear it.

Rules are built in the configurator from cards, not written as code. **Starters** (such as "One-train section") fill in a set of cards to edit; after that they are ordinary rules. The configurator simulates and checks the rules before anything is flashed.

## Design principles

Field logic follows the principles of railway interlockings. Vital interlocking processors (MicroLok, SSI and the like) are PLCs at heart: a small fixed executive runs each site's logic, kept as data, on a fixed cycle. Reliability and simplicity come first. A feature that would weaken either is left out.

1. **Fail safe.** Stop is the default. A mast only clears on positive proof from known inputs. Anything unknown, lost or faulty counts as the restrictive answer. That includes a board offline, the broker gone, a turnout still moving, and a restart.
2. **Scan, don't chase events.** The board works out every rule on a fixed cycle from a snapshot of its inputs (see [Architecture](#architecture)). Nothing depends on catching an event at the right moment: every scan works the answer out again from the current inputs.
3. **Executive and data.** One fixed interpreter, the same on every board, is tested once. Each board's rules are data in a table. There is no user code, so the board cannot do anything the rule language cannot say.
4. **Small vocabulary.** Four words (*while*, *when*, *for*, *then*), three actions (show an aspect, lock turnouts, reserve a resource), and no variables, loops or arithmetic. If a layout needs something the vocabulary cannot say, the vocabulary grows on purpose, with tests. It is never opened up to code.
5. **Clear authority.** Every output has fixed writers and a fixed way of combining them: the most restrictive mast answer wins, and any lock locks. With logic on, JMRI and CATS can only make things more restrictive (hold a mast) or clear a stuck hold, which puts its masts to Stop first. They cannot force a proceed. Turning logic off is a deliberate change, not a way round the rules: it hands the masts back to JMRI/CATS as a whole.
6. **Nothing hidden.** The Try it panel shows everything: every input, rule phase, resource, timer and latch. On the board, each resource's state, each mast's aspect and the rules' version code are published. The ESPHome log records every grant, cancel, pass and release.
7. **What you check is what runs.** The browser and the board run the same engine with the same scan. The configurator shows a version code for the rules, and the board reports the code it is running. You can see that a board has the logic you checked.
8. **Easy to understand and to build yourself.** A modeller with no signalling or programming background should be able to set up, test and wire their own board from the page and the guide alone. The page uses plain words, shows the track and the masts, and says in a sentence what each mast will do. A beginner starts from a starter (or MSS Logic) and never needs the rule table. See [Ease of use](#ease-of-use).
9. **Check before you flash.** Simulate and check in the browser first. Checker errors block the download, like other validation errors.
10. **Foundations stay put.** Sensors, Turnouts and Signal Masts are the foundations: hardware and its JMRI topics. Logic adds nothing to those pages. Everything it needs is declared on its own **Logic** page, which refers to foundational items by name and never changes them. A board whose logic mode is None generates exactly the YAML it does today. See [The Logic page](#the-logic-page). The one foundational addition in this spec is hardware, not logic: [MCP23017 expanders](#more-sensor-pins-mcp23017) on the Sensors page, because logic boards need the pins.

## Terms

| Term | Meaning |
|---|---|
| Sensor | A detector, on the Sensors page (stored as `blocks`). Foundational |
| Turnout | A point, on the Turnouts page (stored as `points`). Foundational |
| Mast | A signal mast, on the Signal Masts page (stored as `signals`). Foundational |
| Block | Declared or built on the Logic page: a stretch of track made of one or more sensors, occupied while any of them is (see [Blocks and detection](#blocks-and-detection)). Rules read a sensor or a block |
| Plant end | Short for **field logic plant end**: where track leaves this board's plant. Each board declares its own ends and pairs them with the ends of the boards next to it, so neighbouring plants can read each other (see [Plant ends](#plant-ends)) |
| Expander | An MCP23017 on the Sensors page, adding 16 input pins (see [More sensor pins](#more-sensor-pins-mcp23017)) |
| Virtual mast | Declared or built on the Logic page: a mast with aspects but no lamps, set and read by rules (see [Virtual masts](#virtual-masts)) |
| Logic mode | None, Field Logic or MSS Logic, chosen per board on the Logic page. Both modes run the same engine (see [Logic modes](#logic-modes)) |
| Built item | An engine item that MSS Logic builds from its description: a block, virtual mast, mast tag, plant end or layer. Read-only |
| Input | Anything the scan reads (see [Inputs](#inputs)) |
| Remote input | An input that belongs to another board, read over MQTT |
| Output | Anything the scan writes (see [Outputs](#outputs)) |
| Scan | One pass of the board's cycle: read inputs, work out the rules, write outputs |
| Interpreter | The fixed program, the same on every board, that runs the scan over the rule table |
| Rule table | A board's rules, as data |
| Resource | Track that only one rule may reserve at a time, such as a single-line section. It has blocks, a release, optional approach locking, and a waiting queue |
| Rule | A trigger, checks and actions (see [Rules](#rules)) |
| Layer | A named group of rules, usually what one starter wrote. Layers are how the Logic page shows who controls what |
| Starter | A configurator template that writes a layer of editable rules |
| Field-controlled mast | A mast that at least one rule sets. Other masts on the board stay with JMRI/CATS exactly as today |
| Logic switch | One runtime switch per board that turns its logic on or off, in either mode (see [Logic switch](#logic-switch)) |

## Architecture

```
  inputs ─────────▶  scan, every 100 ms  ─────────────────────────▶  outputs
  sensors            1. read: snapshot of every input                 mast aspects
  turnouts           2. evaluate: interpreter over the rule table     turnout locks
  masts, holds       3. write: outputs that changed                   published state
  buttons, switch    4. publish and log what changed
```

Everything outside the scan is either an input or an output. JMRI/CATS messages, buttons, the manual release and the logic switch are inputs. They are recorded as they arrive and acted on by the next scan. Nothing outside the scan changes a rule, a resource or an output directly.

### Inputs

Every input has a fail-safe value. The scan uses that value whenever the real one is not known.

| Input | Comes from | Read as | When not known |
|---|---|---|---|
| Sensor, this board | its detector, on an ESP pin or an expander | occupied / clear | known from the start-up scan on. On an expander that stops answering: occupied |
| Sensor, other board | `<sensor-topic>/State` | occupied / clear | occupied |
| Block | its sensors, on this board or others, and what plant ends hear | occupied while any of them is occupied | one not known counts as occupied |
| Turnout, this board | its saved position, and whether a throw script is running | closed / thrown / moving | — |
| Turnout, other board | `/Thrown` and `/Moving` | closed / thrown / moving | matches neither position |
| Mast, this board | the aspect the previous scan wrote, or JMRI/CATS's aspect for a mast no rule sets | its aspect's tag | — |
| Mast, other board | `<mast-topic>/State` | its aspect's tag | `stop` |
| Plant end | the paired neighbour's end topics | block occupied / clear, and next mast's tag | occupied, `stop` |
| Mast hold | JMRI/CATS on the mast's topic | held / unheld | stays as last received (see [Stale holds](#stale-holds)) |
| Button | a push button on a pin of this board, declared on the Logic page and wired to GND like a fascia button | pressed (a moment) | — |
| Manual release | the `Release <resource>` button or its MQTT topic | pressed (a moment) | — |
| Logic switch | the `Field logic` or `MSS logic` switch, or its MQTT topic | on / off | its saved value |

A **moving** turnout matches neither closed nor thrown, so nothing that needs a position can clear over it. An input from another board is not known until its first message arrives. It also stops being known while its board's Online sensor is `INACTIVE`, and while this board is disconnected from the broker.

**Short pulses are not lost.** Inputs record changes as they happen, between scans. Each input keeps its latest value and two latches: "went on since the last scan" and "went off since the last scan". *while* reads the value. *when* and *then* read the latches, which the scan clears once it has read them. If both latches are set, the input changed and changed back, and the current value says in which order. So a button press, or "occupied, then clear", shorter than one scan still counts.

### The scan

The board runs on a fixed cycle, every 100 ms, whether anything changed or not. Each scan:

1. **Read.** Take a snapshot of every input, and the scan's time. The rules read only this snapshot, so an input cannot change halfway through a scan.
2. **Evaluate**, in a fixed order:
   1. Each rule, in list order (layers in list order, rules in list order within each layer): work out its trigger and checks, and move a reserving rule on through its [lifecycle](#reserving-rules): cancel, passed, approach locking, release.
   2. Each free resource, in list order: grant it to the waiting rule that has waited longest. If two have waited equally long, the one listed first wins. A resource is granted at most once per scan.
   3. Work out each output from the rules (see [Outputs](#outputs)).
3. **Write.** Apply only the outputs that changed: run `<m>_show` and set `<id>_field_locked`.
4. **Publish and log.** Publish only what changed. Everything is published again on MQTT connect. Each grant, cancel, pass and release is logged at `INFO`, and a manual release at `WARN`.

Rules see this board's masts as the previous scan wrote them. A chain of block signals therefore settles over a few scans, which is still well under a second. The cycle check in [Validation](#validation) stops a mast feeding back into itself.

**Overruns and hangs.** A scan that takes longer than the cycle is logged at `WARN`, and the next scan starts straight away. If the board hangs, ESPHome's watchdog restarts it, and the [start-up scan](#start-up-scan) begins again from Stop.

### Outputs

| Output | Written by | How the writers combine |
|---|---|---|
| Field-controlled mast aspect | its rules, and a JMRI/CATS hold | See [Who wins a mast](#who-wins-a-mast). Approach lighting can then darken it |
| Turnout field lock (`<id>_field_locked`) | the rules that lock it | Any lock locks. The turnout is also locked by its remote lock (see [Turnout locks](#turnout-locks)) |
| Published state | the scan | Each resource's Held and State, each mast's `/State`, each plant end's Block and Mast, and the version code. Sent on change |

## Language

Every part of a rule uses the same four words:

| Word | Meaning | Example |
|---|---|---|
| **while** | a state, true for as long as it holds | while Left occupied |
| **when** | a moment (a change) | when the Depart button is pressed |
| **for** | how long a *while* must hold before it counts | while Bridge clear for 3s |
| **then** | moments in order | when Far occupied, then clear |

States can be negated and combined with **all of** or **any of**. On a trigger, *for* works both ways. The state must hold that long before the rule asks, and must stop holding that long before the request is cancelled. A detector flicker therefore neither starts nor cancels a request. On checks and releases, *for* only delays the state becoming true.

## Rules

A rule card reads top to bottom:

| Part | Form | Example |
|---|---|---|
| Trigger | **WHILE** or **WHEN** | while Left occupied for 0.5s |
| Checks | **IF**: *while* states, all must be true | if Right clear |
| Actions | **THEN**: show an aspect, lock turnouts, reserve a resource | Left mast shows Clear; reserve Bridge |
| Cancel | **CANCEL**: only for a *when* trigger | when the Depart button is pressed again |

Every rule is worked out every scan.

### Plain rules

A rule that does not reserve a resource is active in any scan where its trigger and checks are true. While it is active, its actions apply: its mast aspect counts and its turnouts are locked. When it stops being active, they stop applying. A plain rule has no lifecycle and no release. Block signals and turnout locks are plain rules.

### Reserving rules

A rule that reserves a resource has a lifecycle:

```
         trigger + checks true, resource free, longest waiting
   IDLE ──────────────────────────────────────────────────▶ ACTIVE
    ▲                                                         │ aspect shown, resource held,
    │                                                         │ turnouts locked
    │             a resource block becomes occupied           ▼
    │                                                       PASSED
    │                                                         │ mast back to Stop, still holding
    │               resource's release                        │
    └─────────────────────────────────────────────────────────┘ resource freed, turnouts unlocked

   ACTIVE ── cancel ──▶ IDLE                                         approach locking off

   ACTIVE ── cancel ──▶ CANCELLING ── time up, no block occupied ──▶ IDLE
                            │                                        approach locking on
                            └── a resource block occupied ──▶ PASSED
```

- **Waiting.** A rule whose trigger and checks are true but that has not been granted is waiting. It is considered for a grant every scan.
- **Free** means no rule holds the resource and all its blocks are clear.
- **Waiting order.** A free resource goes to the rule that has waited longest, timed from the scan that first saw its trigger true. Ties go to the rule listed first. Two rules cannot take turns starving a third.
- **Passed.** The train has gone past the mast. The mast goes back to Stop, as a real signal does. The resource stays held.
- **Cancel.** A *while* trigger cancels itself when it stops being true, honouring its *for*. Example: Left's mast clears, then the train backs out of Left before reaching Bridge. Without cancel, the mast would stay at Proceed and Bridge would stay held for a train that has gone, because the release only starts once the train has passed. A *when* trigger latches its request until it is granted, and cancels only through its CANCEL part, if it has one. A [CATS hold](#cats-hold) after the grant also cancels.
- **Approach locking** is optional per resource, and off by default. A train already approaching a mast that has just gone back to Stop may not be able to stop in time.
  - **On:** a cancel puts the mast to Stop at once, but the resource stays held and the rule's turnouts stay locked for a set time (CANCELLING).
  - If a resource block becomes occupied during that time, the train ran past the mast. The rule goes to PASSED and releases normally.
  - Otherwise the resource is freed when the time is up.
  - A manual release ends it at once.
  - **Off:** a cancel frees the resource at once.
- **Release** belongs to the resource, so every rule that reserves it shares one release. The release is a *while* (usually "all blocks clear for 3s") or a *then* sequence. It is only armed once the rule is PASSED. Moments are counted from the grant onwards.
- There is **no release timeout.** A timer that fires while a train is stalled on dirty track would free the section under it. Stuck holds are cleared by hand (see [Manual release](#manual-release)).

### Who wins a mast

More than one rule, and more than one layer, can set the same mast. Every mast aspect has a tag, and the tags are ordered from most to least restrictive: `stop`, `restricting`, `approach`, `advance`, `clear` (see [Aspect tags](#aspect-tags)).

- **Within a layer**, the first active rule in list order sets the mast. If no rule in the layer is active, the layer says Stop.
- **Across layers**, the mast shows the most restrictive answer. If two layers give different aspects with the same tag, the first layer wins and the configurator warns.
- A JMRI/CATS hold acts as one more layer that says Stop (see [CATS hold](#cats-hold)).

Each layer is a set of conditions that must all agree before a mast clears. For example, a gauntlet's entrance mast that is also the last block signal only clears when both layers allow it.

### Sharing inputs

Any number of rules and layers can read the same block. Only outputs and resources can conflict. A block may belong to only one resource, and that resource lives on one board.

## Start-up scan

The board does not start blank. Its first scan reads the field and puts the rules into the state the field implies.

- **From power-on:** with logic on, every field-controlled mast shows its stop aspect. Its startup aspect only applies while logic is off.
- **Waiting for detectors:** the board waits until its detectors have settled, after the existing startup aspect step. Inputs from other boards stay not known until their first message arrives.
- **The start-up scan:** an ordinary scan, except:
  - a resource with an occupied block is held and PASSED, with no holding rule. It releases through its normal release. This keeps the release delay when the train leaves.
  - rules whose trigger is already true have all waited equally long, so list order decides.
  - a train in an entrance block with the **leaving guard** counts as **waiting**, so its mast may clear. The board cannot tell a waiting train from one that has just left. Stranding a train that really is waiting is worse, and a train that has just left is moving away from that mast.
- **Toggle switches:** on a board with a logic mode, a toggle switch's boot move waits for the start-up scan. A turnout under a train is then locked before the switch can move it. The switch catches up when the lock clears (see [Turnout locks](#turnout-locks)).

Holds are not saved (`restore_value: false`). Turning the logic switch on also runs a start-up scan.

## Logic switch

One switch per board, so the same board can run its field-controlled masts locally or leave them to JMRI/CATS. The switch is the same in both [logic modes](#logic-modes). Its ESPHome entity is named after the mode (`Field logic` or `MSS logic`); its MQTT topic and JMRI light are the same either way. Flipping it does not need a new YAML file. Masts that no rule sets are never affected.

| | Logic **on** | Logic **off** |
|---|---|---|
| Who sets a field-controlled mast | The rules | JMRI/CATS, exactly as today |
| JMRI/CATS messages on its topic | Only `Held` / `Unheld` is read. The aspect name and `Lit` / `Unlit` are ignored | Read in full (exact match, then `Unlit` dark, `Held` Stop, then aspect name) |
| Scan | Running | Not running. Resources are free and no rule lock is set |

- **ESPHome:** a template `switch`, named after the mode (`Field logic` or `MSS logic`), saved across reboots. Its starting value ("Starts on" / "Starts off") comes from the configurator and is used until the switch is first changed.
- **MQTT** (when MQTT is on): `trains/track/light/logic/<board>`, a **JMRI light** (`MLlogic/<board>`). `ON` / `OFF` switch it. The board publishes its state to the same topic, retained, so JMRI shows the real state after a reboot or a change on the board. The echo of its own message changes nothing. A retained command on reconnect is applied the same way.
- **Switching on:** the next scan is a [start-up scan](#start-up-scan).
- **Switching off:** the next scan is the last. It frees every resource, drops every rule lock, and hands each field-controlled mast back to the last aspect JMRI/CATS sent it, or Stop if nothing has arrived.

The board records every field-controlled mast's JMRI messages whether logic is on or off. That way it can switch either way and always knows JMRI's last aspect and hold.

## CATS hold

This is what CATS's **Hold Only** option on a signal template is for. CATS's own description: it "should only 'hold' the signal mast (toggle between STOP and whatever the SignalMast Logic wants)". With logic on, the rules are the "whatever it wants" part.

- CATS calls `setHeld(true)` when its logic says Stop and `setHeld(false)` otherwise (`PhysicalSignal.setAspect`). JMRI publishes `<aspect>; Lit; Held` or `…; Unheld`.
- CATS still sends a real aspect on `refresh()` (when a signal's history is cleared), even in Hold Only mode. A mast that never got an aspect publishes `null; Lit; Held`. That is why only the Held part is read.
- The hold is an input. A held mast shows Stop, whatever the rules say.
- A reserving rule that sets a held mast is **not granted**. It keeps waiting, and can be granted in a later scan once the mast is unheld.
- **Held after the grant, before the train passes:** the rule is cancelled back to waiting. The resource is freed for another rule, after the approach locking time if that is on.
- **Held after the train has passed:** nothing changes; the mast is already at Stop.

### Stale holds

JMRI publishes retained, and it does not reliably say when it has gone. Its last will (`track/$state` = `lost`) only fires on an unclean disconnect, and it publishes nothing on reconnect. So a `Held` left on the broker when JMRI closes **keeps the mast at Stop**. That is the fail-safe choice, and it matches a real dispatcher's hold. To clear it:

- unhold the signal in CATS or JMRI, or
- press the resource's manual release. This also clears the board's copy of the hold on the masts its rules set, until JMRI sends again.
- wipe the retained message: `mosquitto_pub -h layout-mqtt.local -t '<mast-topic>' -r -n`.

There is no expiry, because a timed-out hold would also drop a real one.

## Manual release

Each resource has a manual release, so a stuck hold (a failed detector, a stalled train) can be cleared by hand. A press is an input. The next scan:
- frees the resource and unlocks its turnouts
- clears the board's copy of the CATS hold (above)
- puts its masts to Stop, so nothing clears until a later scan grants the resource again.

Releasing with a train still in the section is the operator's call.

- **ESPHome:** a template `button` named `Release <resource>`.
- **MQTT** (when MQTT is on): `trains/track/turnout/logic/<board>/<resource>/Release`, a **JMRI turnout** (`MTlogic/<board>/<resource>/Release`). `THROWN` presses it. The board then publishes `CLOSED`, retained, to the same topic and ignores `CLOSED`. JMRI reads turnout feedback on the turnout's receive topic, which by default is the command topic, so it hears that `CLOSED` and the turnout snaps back like a push button. (This turnout has no `/Thrown` sensor.) The `CLOSED` also replaces any retained `THROWN` (JMRI publishes retained), so a release cannot fire again when the board reconnects.
- **A release sent while the board was away is ignored.** A `THROWN` that arrives in the first 5 seconds after the board connects to the broker was waiting on the broker, perhaps for hours, and the section may since have filled. The board ignores it, logs a `WARN`, and publishes `CLOSED`. Ignoring a release is the safe direction: the section just stays held until someone presses again.

## Remote inputs

Rules can read sensors, turnouts and masts on other boards. Rules can only set masts, lock turnouts and reserve resources on **their own board**. Two boards granting the same track at once over MQTT is a race, so there is no shared reservation. How remote inputs fail safe is in [Inputs](#inputs).

### Choosing them

- **Import a board as a reference** (on the Logic page, Field Logic mode): load another board's `board.yaml`. Its sensors, turnouts, masts and blocks, with their aspects and tags, appear in the dropdowns under that board's name. The reference is stored in this board's `logic` (see [Stored format](#stored-format)).
- **Type a name:** a sensor or turnout can also be typed. Its topic follows the standard syntax. A remote mast needs an imported board, because rules compare its aspect by tag.

### What each board publishes

A board publishes these when **Share with other boards** is ticked on its Logic page. It is on by default in Field Logic, always on in MSS Logic, and can be ticked on its own with the mode at None. A board with no rules ticks it so that other boards can read its sensors, turnouts and masts. An example is a control point whose masts CATS drives. A board with neither emits none of these. (`/Thrown` already ships on every board, as turnout feedback.)

| What | Topic | Payload |
|---|---|---|
| Board online | `trains/track/sensor/board/<board>/Online`, a JMRI sensor `MSboard/<board>/Online` | `ACTIVE` as the MQTT birth message; `INACTIVE` as the will and shutdown message. Retained. `topic_prefix` is `null`, so `birth_message`, `will_message` and `shutdown_message` are set explicitly |
| Sensor state | `<sensor-topic>/State`, retained | `ACTIVE` / `INACTIVE`, on every change and on connect. The detector topic itself stays `retain: false`, so JMRI never sees a stale OCCUPIED |
| Turnout position | `trains/track/sensor/<turnout>/Thrown`, retained. Already ships as the turnout's JMRI feedback | `ACTIVE` thrown, `INACTIVE` closed. Sent on connect and when a commanded or button throw has finished, about 2s after it started |
| Turnout moving | `trains/track/sensor/<turnout>/Moving`, retained | `ACTIVE` when a throw script starts, `INACTIVE` when it finishes, and `INACTIVE` on connect. `/Thrown` only changes once the servo has finished, so without `/Moving` another board would see the old position for the whole move |
| Mast aspect | `<mast-topic>/State`, retained | The aspect name the mast shows |

With **Disable MQTT** ticked, remote inputs and Share with other boards are a validation error.

### Unique board names

Board names appear in topics (`board/<board>/Online`, `logic/<board>`, plant end topics), in pairing, and in each board's network name and fallback hotspot. Two clubs both bringing `module-1` to a meet would clash.

- The configurator **adds a suffix** to every new board's name: six characters, chosen at random when the board is created, for example `kiama-north-k7m4x2`. The characters are lowercase letters and digits without look-alikes (no `0`, `o`, `1` or `l`), so it can be read off a module card. That gives about a billion values (32 characters, six places), so two boards at a meet with the same base name are very unlikely to clash.
- **The suffix is the board's identity; the rest of the name is a label.** The suffix is stored with the board and never changes: not on re-download, and not on rename. Renaming `kiama-north-k7m4x2` to `kiama-south` gives `kiama-south-k7m4x2`. So the YAML, the JMRI XML and the module card always agree.
- **It is random, not derived.** A hash of the name would be the same for two boards both called `module-1`, which is exactly the clash this prevents, and it would change on every rename. The MAC address is not used either, because the configurator never sees the ESP: the MAC is only known once the board runs, which is too late for the JMRI XML.
- **Length.** The tighter limit is the fallback hotspot: its name, `<board> setup`, must fit Wi-Fi's 32 characters, so the board name is at most 26 (ESPHome itself allows 31). The dash and suffix take 7, so the part you type is at most 19 (validation error beyond that).
- An existing board without a suffix gets a warning once it has a logic mode or Share, with **Add a suffix**. The hint says that renaming changes the board's network name, so the next flash is by USB (the Device Builder installs over the air to the new name).
- **Copied files.** Importing a file as a new board, for example a second module from the same `board.yaml`, offers **New suffix**, because two copies would otherwise share an identity.
- **At runtime**, each sharing board also publishes its MAC address, retained, to `trains/track/board/<board>/Owner` (not read by JMRI). The Online topic cannot be used for this, because a board's own retained `ACTIVE` comes back to it looking the same as a twin's. A board that finds a different MAC on its own Owner topic logs an `ERROR`, publishes `Clash` to `trains/track/board/<board>/Problem`, and shows it on its web page. Two boards with the same name cannot both work, so a clash, or a copy that kept its suffix, is never left silent.

## Plant ends

A board's **plant** is the track and signals it looks after. A **field logic plant end** (*plant end* for short) is where that track leaves the board, onto track another board looks after. Plant ends let neighbouring plants read each other without either knowing the other in advance. They suit layouts that change, and modules that arrive at a meet in any order and either way round.

- Plant ends are **per board**. Each board declares its own ends, and they are an engine input available in both [logic modes](#logic-modes). In Field Logic mode you declare them on the Logic page; MSS Logic builds them from its description.
- One board can cover several modules that always travel together. Only the joints at the outside of that set need ends.
- Ends are named A, B, C… Each end's tracks are numbered left to right, looking out through the end. Facing each other at a joint, one end's track 1 meets the other end's last track. That is how a board works either way round.

### What an end offers

For each track through an end, the board publishes two retained values. They describe what a train entering through that end meets first on this board:

| Value | Topic | Payload |
|---|---|---|
| Block | `trains/track/end/<board>/<end>/<track>/Block` | `ACTIVE` while the track's end sensors are occupied |
| Mast | `trains/track/end/<board>/<end>/<track>/Mast` | the tag of the first mast facing that train |

In Field Logic mode, each end track asks for:
- **end sensors:** the sensors between the end and the first mast facing inward, including the boundary sensor at that mast
- **the first mast facing inward** (a mast or a virtual mast), or **passes through** to a track at another end, for track with no mast on it. A pass-through track offers its own end sensors OR the far end's Block, and the far end's Mast, so a block can run across several boards.

What an end offers never includes what it hears through that same end, so two paired ends cannot hold each other occupied.

### What an end hears

The same two values from the paired end are inputs on this board:
- **End A, track 1: block.** A [block](#blocks) can include it, so a block can reach across the joint.
- **End A, track 1: next mast.** A tag, read like any mast. It can be what lies beyond the last block in a [Block signals](#block-signals) list, or the next mast in a Route signal row. Rules read it by tag only, because the neighbour is not known until the day.

### Pairing

Each end has a **link**: the board and end it meets, for example `kiama-north-k7m4x2/B`. **Pairing is the usual way to set it:**

- Press **Pair** on the two ends that meet: the `Pair End A` button on each board's web page, or an optional push button on a pin at that end.
- Each end is then pairing for 30 seconds and announces itself on `trains/track/end/pairing` (`<board>/<end>/<tracks>`, not retained).
- If exactly two ends are pairing at once, and they have the same number of tracks, each sets its link to the other.
- If a third end joins the window, or the track counts differ, nothing is linked, both log a `WARN`, and you press again.
- An optional LED at each end shows the state: slow blink while pairing, steady when paired and heard, fast blink for a problem (unheard, disagreeing or refused).

The link can also be set directly:
- **On the board:** an ESPHome `text` entity, `End A link`, on the board's web page. It is saved across reboots.
- **Over MQTT:** `trains/track/end/<board>/<end>/Link`. The board publishes its link there, retained, and takes a new value from the same topic, as the [logic switch](#logic-switch) does.
- **`end`** marks the end of the line: Block clear and Mast `stop`, so the last mast shows Approach.
- **Empty**, or a neighbour not heard: Block occupied and Mast `stop`. That is fail safe, as with any remote input.
- **Both sides must agree.** If A says it meets `kiama-north-k7m4x2/B` but that end names someone else, both treat the link as empty and log a `WARN`. A wrong link shows Stop, never a false Clear.

A link does not change the rules or the version code. Each end publishes its state in words (for example *Paired with kiama-north-k7m4x2/B, heard*). Try it treats each end's two values as remote inputs.

### At a meet

Nothing is reflashed at a meet:
- **Wi-Fi:** a board that cannot find its home network starts its fallback hotspot (`<board> setup`), which every board already has. Join it from a phone, and the captive portal picks the meet's network. ESPHome saves that network under a key made from the board's configuration and ESPHome version. So it lasts until the board is next flashed with a changed configuration or a newer ESPHome, and then the home network in the YAML applies again. Back home without a reflash, set the home network the same way.
- **Broker:** boards look for `layout-mqtt.local`, the name the install scripts publish. One computer at the meet runs the install script, and every board finds it with no change. The script will not publish the name if another computer already answers to it.
- **Pairing:** press Pair on both sides of each joint.

## MQTT and JMRI

JMRI builds every MQTT topic as Channel + type topic (`track/turnout/`, `track/light/`, `track/sensor/`) + hardware address, so a JMRI item can only reach topics under its type topic. CATS only ever talks to JMRI items, through an `IOSpec` (a JMRI device name plus `throw` / `close`), never to raw MQTT. So the controls sit where a JMRI turnout, light or sensor can reach them, which makes them usable from panels, LogixNG and CATS. The `logic/` and `board/` prefixes keep them apart from the board's own items, and the board name keeps boards apart.

| Control | JMRI item | Topic (channel `trains/`) | Payloads |
|---|---|---|---|
| Logic switch (input) | Light `MLlogic/<board>` | `trains/track/light/logic/<board>` | `ON` / `OFF`, board echoes its state |
| Release (input) | Turnout `MTlogic/<board>/<resource>/Release` | `trains/track/turnout/logic/<board>/<resource>/Release` | `THROWN` releases, board resets to `CLOSED` |
| Resource held (output) | Sensor `MSlogic/<board>/<resource>/Held` | `trains/track/sensor/logic/<board>/<resource>/Held` | `ACTIVE` / `INACTIVE`, retained |
| Board online | Sensor `MSboard/<board>/Online` | `trains/track/sensor/board/<board>/Online` | `ACTIVE` / `INACTIVE`, retained |

JMRI does not read these topics:
- `trains/track/board/<board>/Owner` and `…/Problem`: the board's MAC, for [unique board names](#unique-board-names).
- `trains/track/logic/<board>/<resource>/State`: `IDLE`, `ACTIVE`, `CANCELLING` or `PASSED`, retained. For watching in MQTTX.
- `trains/track/logic/<board>/Version`: the version code of the rules the board is running, retained.
- `<mast-topic>/State`. Other boards read it as a remote input.
- `trains/track/end/<board>/<end>/<track>/Block`, `…/Mast`, `trains/track/end/<board>/<end>/Link` and `trains/track/end/pairing`, for [plant ends](#plant-ends).

**Download JMRI XML** builds these items the same way as the board's own (system name from the part of the topic after the type topic). They all go under one new tick box, **Logic**, shown when the board has a logic mode or shares. The Sensors, Turnouts and Signal Masts boxes are unchanged. Field-controlled masts stay under Signal Masts, because JMRI/CATS drive them whenever logic is off. The Logic box adds:
- the board Online sensor
- each block, as a sensor
- each rule-locked turnout's `/Locked` sensor, where Remote lock has not already added it
- the switch light, each Release turnout and each Held sensor.

CATS users can leave Logic unticked, the same as Sensors and Turnouts: CATS makes the items its IOSpecs name. `/Moving` is for boards and is not added. With MQTT off, none of these are added.

**Disable MQTT:** logic still runs on local inputs. Plant ends need MQTT, so they are a validation error. The topics are left out; the release buttons and the switch entity stay. There is no JMRI hold without MQTT.

## Aspect tags

Each mast aspect has a tag, and may be marked **diverging**. Both are set on the Logic page, under **Masts**, for each mast that logic sets or reads. The Signal Masts page and its aspect cards are unchanged. Tags drive [who wins a mast](#who-wins-a-mast) and let rules read a mast by meaning, for example "while North mast is not stop" or "while East Home is diverging".

The tags follow the usual ABS indications, which are also those of MSS (see [MSS Logic spec](mss-emulation-spec.md)), most restrictive first:

| Tag | Means for a train at this mast | Example |
|---|---|---|
| `stop` | Stop | Stop, Stop and Proceed |
| `restricting` | Proceed at restricted or slow speed. Masts behind treat it like Stop (MSS does the same with Slow and Restricting) | Restricting, Slow Clear |
| `approach` | Be ready to stop at the next mast | Approach |
| `advance` | The next mast shows Approach | Advance Approach |
| `clear` | Proceed | Clear |

**Diverging** marks an aspect that sends the train on a diverging route at Medium or Limited speed (MSS: Medium Clear, Medium Approach, Limited Clear, Limited Approach). A mast behind it can then show Approach Diverging.

CATS aspects get their tag automatically, from the speeds in the CATS signal template (`speed` is the speed past the signal, `speed2` the speed at the next one). The first matching row wins:

| Rule | Tag | CATS aspects |
|---|---|---|
| `speed` is Stop | `stop` | R292, R291 |
| `speed` is Restricted or Slow | `restricting` | RES_NORM, RES_LIM, RES_MED, RES_SLO, R287, R288, C422, C423, C424 |
| `speed2` is Stop | `approach` | R285, R281D, R286 |
| name starts `ADV_` | `advance` | ADV_NORM, ADV_LIM, ADV_MED, ADV_SLO |
| anything else | `clear` | the other 12 |

Diverging comes from CATS's own speed table (`SpeedTable` in `AspectMap.java`): the aspects in its Limited and Medium rows, other than the Advance and Restricting ones (`ADV_*`, `RES_*`). They are R281C, C412, C413, C414, R281D, R283, C417, R283A, R283B and R286. The template's `speed` field cannot be used for this, because it gives R285 (plain Approach) speed Medium. `ADV_*` cannot be told apart by speed either: CATS gives each Advance aspect speed Normal and puts the next signal's speed in `speed2`, the same as R282 and R284.

The configurator needs the tags and diverging list next to `CATS_ASPECTS`. They come from the same CATS table as the template, so keep the two in step. Both stay editable. A custom aspect has no speeds, so it starts as `stop`: an untagged aspect is treated as the most restrictive.

Each field-controlled mast has a **stop aspect**, set under **Masts**: what it shows when the rules say Stop, and from power-on. It defaults to the aspect named `R292` or `Stop`, else the first `stop`-tagged aspect, matching how `Held` is handled today.

## Virtual masts

A **virtual mast** has aspects and tags but no lamps. Rules set it and read it like any other mast. It stands for a signal the track has no room or need for, so that the masts behind it still have something to read.

- It is declared on the Logic page, under **Masts**: a name, a topic (default `trains/track/signalmast/<name>`), and its aspects with their tags. It never appears on the Signal Masts page, because it is not hardware.
- At least one rule must set it (validation error otherwise), so it is always field-controlled. JMRI and CATS do not drive it, and it is left out of the JMRI XML.
- It publishes `<mast-topic>/State` like any mast, so other boards can read it.
- It generates the aspect global and the rule outputs only: no light, no `<m>_show` lamp code.

## Turnout locks

Two things already ship with remote Lock:
- the `trains/track/sensor/<turnout>/Locked` report
- the toggle switch re-sync. When `UNLOCKED` clears a lock that was set, the `${id}_latch_<n>` script moves the point to match the switch. A repeated or retained `UNLOCKED` does nothing.

Logic adds a second flag:

- `<id>_locked` stays the **remote lock**, set by `<turnout-topic>/Lock`.
- `<id>_field_locked` (`restore_value: false`) is the scan's lock output.
- The turnout is locked while **either** flag is set. Fascia buttons and `CLOSED` / `THROWN` are ignored while it is locked.
- The re-sync and the lock report follow the combined state. The re-sync runs only when the turnout goes from locked to unlocked. One flag clearing while the other is still set does nothing.
- So JMRI's `UNLOCKED` cannot free a turnout with a train on it, and a train clearing cannot drop a dispatcher's lock.
- A turnout a rule locks gets the lock report even without Remote lock on.

## Blocks and detection

Logic reads blocks, and a block is only as good as its detection. Two kinds of detector cover each other's gaps, as in MSS:

- **Current** (the detector this repo already uses) sees anything drawing track power, anywhere in the block. It misses unpowered cars, so the tail of a train can leave a block clear behind it.
- **Optical** (an IR or light sensor in the track) sees any car, powered or not, but only at its own spot.

MSS puts a current detector on every block and an optical sensor at every block boundary, and makes that optical sensor hold **both** blocks either side of it occupied. A mast at the boundary then holds Stop until the last car has passed, with no resistor wheelsets.

Both kinds are ordinary sensors on the Sensors page, wired the same way (to GND, pulled up) with the same Debounce. The Sensors page does not know or care which kind a sensor is. The 500ms Debounce default already bridges the gap between two cars passing an optical sensor. What makes a sensor a boundary sensor is the block it belongs to, not a setting on the sensor.

### Blocks

A **block** is declared on the Logic page, under **Blocks**. It has a name, a topic, and its sensors: usually the block's current sensor plus the optical sensor at each end. A boundary's optical sensor goes in both blocks either side of it. A sensor can also belong to another board, picked from an imported board (see [Remote inputs](#remote-inputs)). It can also include what a [plant end](#plant-ends) hears. Either way, an optical sensor at the edge of one board holds a block on the next board.

- It is **occupied while any of its sensors is occupied.** A sensor from another board that is not known counts as occupied.
- It is an input like any sensor, and rules, resources and starters can use it wherever they take a block. A rule can still read a single sensor directly.
- It publishes like a detector: `ACTIVE` / `INACTIVE` to its topic (default `trains/track/sensor/<name>`, `retain: false`), plus the retained `/State` mirror. In JMRI it is one more sensor, so CATS can use the block and ignore its parts.
- It does not depend on the logic switch. A block is detection, not logic, so it publishes whether rules are running or not. A board in Field Logic mode can use it for blocks alone, with no rules.
- Its sensors keep their own topics, so nothing changes for a JMRI panel that already uses them.

### Turnouts in a block

MSS treats a turnout set against the main as an occupied block, so a mast never clears into a reversed switch. Here that is part of the [Block signals](#block-signals) starter, not of the block. The starter adds "turnout in its through position" to each mast's checks. The block itself still reports only its detectors. If a reversed turnout made its own block read occupied, *Lock turnouts under a train* would lock it reversed for good, and JMRI and CATS would see a train that is not there.

## More sensor pins (MCP23017)

Logic boards need more inputs than plain ones: a current sensor for every block, an optical sensor at every boundary, and perhaps Pair and rule buttons. A busy board, such as an MSS junction module, runs out of free ESP32 inputs. An **MCP23017** adds 16 inputs over I2C.

This is hardware, so it lives on the **Sensors page**, as the PCA9685 boards live on the Turnouts page. It is specified here because logic is what usually needs it, but it works on any board, with or without a logic mode.

- The Sensors page gets an **Expanders** list. Each MCP23017 has a name (*MCP 1*), an I2C bus and an address (`0x20`–`0x27`, set by the A0–A2 links on the expander board).
- **I2C bus.** A classic ESP32 has two. An expander can share a PCA9685 board's SDA and SCL pins: the PCA9685 is at `0x40`, so the addresses do not clash. Or it can have its own pins while a bus is free. Up to eight expanders per bus.
- **Pins.** A sensor's pin dropdown lists the free ESP pins and every free expander pin, for example *MCP 1 · B3* (A0–A7, B0–B7). Wiring is the same as an ESP pin: detector output to the pin, and GND. The expander's internal pull-up is on, the input is inverted as on an ESP pin, and Debounce works the same.
- **Buttons too.** Rule buttons and Pair buttons can use expander pins. Outputs (mast lamps, end LEDs) stay on ESP pins in this spec.
- **Fail safe.** If an expander stops answering after start-up, ESPHome does not mark it failed: it only sets a communication warning, and its pins keep their last value. So the logic component checks each expander's status (`is_failed()` and `status_has_warning()`) every scan, and the template sensor of any block that contains an expander sensor checks it too. While an expander reports a problem, its sensors count as not known, so they read occupied for logic, any block that contains one reads occupied, and the board logs an `ERROR`. A sensor's own JMRI topic may keep its last value until the expander answers again.
- **Pin budget.** The Sensors page shows how many ESP inputs are free. When a new sensor has none left, the hint suggests adding an expander.

## Starters

Each starter writes one layer (Block signals with both directions writes two). These rules can be edited like any others afterwards.

### One-train section

A stretch of track that only one train may be on at a time, with a protected entrance at each end. This covers gauntlet track, single-line bridges and tunnels, diamond crossings, two lines merging onto one, and staging throats.

It asks for:
- a name
- the section's blocks
- the release (prefilled as "while all section blocks clear for 3s")
- approach locking (off by default)
- 2 to 4 entrances, each with:
  - a trigger block
  - a mast
  - a proceed aspect
  - **trains also leave through here** (off by default).

It writes one resource for the section, and one reserving rule per entrance:

| Part | Each entrance |
|---|---|
| Trigger | while its trigger block occupied for 0.5s |
| Checks | the trigger block of every *other* entrance that has "trains also leave through here" ticked is clear |
| Actions | its mast shows the proceed aspect; reserve the section |

**"Trains also leave through here."** From occupancy alone, the board cannot tell a train waiting in a trigger block from a train leaving the section through it, so each entrance says which it is.

- **Off (double-track gauntlet, the default).** The two tracks converge over the bridge and separate again beyond it; they do not cross. A train leaves the section onto its own track beyond the far entrance, never back through a trigger block. A train that pulls into this block is always waiting its turn, so it queues normally, even while the section is held.
- **On (single-line bridge or tunnel).** Trains leave the section through this block:
  - This block is added to the other entrances' checks. Another entrance can only clear if this block is clear, so a train waiting here goes first.
  - A train arriving here while the section is held counts as a train leaving. It cannot ask for the section until the block has cleared once. This is the trigger's **leaving guard** option.

**Worked example: gauntlet over a bridge.** Blocks Left, Bridge and Right. A mast at Left/Bridge and one at Right/Bridge. The tracks converge onto the bridge and separate again, so a train from Left leaves beyond the Right end on its own track, not through the Right block.

| | Left entrance | Right entrance |
|---|---|---|
| Trigger | while Left occupied for 0.5s | while Right occupied for 0.5s |
| Checks | none | none |
| Actions | Left mast Clear; reserve Bridge | Right mast Clear; reserve Bridge |

The Bridge resource holds the Bridge block, with the release "while Bridge clear for 3s". For a single-line bridge with the same blocks, tick "trains also leave through here" on both entrances. Each then checks that the other's trigger block is clear, with the leaving guard on.

### Lock turnouts under a train

One plain rule per turnout: while its block is occupied, lock the turnout.

### Block signals

Automatic block signals (ABS) for a run of plain track, usually between two places with turnouts. It is also what [MSS Logic](mss-emulation-spec.md) builds for each track of a module. Each mast shows Stop while the block beyond it is occupied. Otherwise it shows less and less restrictive aspects the further ahead the track is clear. When a train passes, the masts behind it **tumble down**: Stop, then Approach, then Advance Approach, then Clear, as the train gets further away.

MSS sends that information along a cable, two blocks each way. Here each mast **reads the next mast** in its direction instead. That gives the same cascade from occupancy alone. It also lets a mast that is at Stop for any reason drop the masts behind it: a control point at a turnout held by CATS, a route not set, or a one-train section in use. In MSS, that is the job of the Complex Cascade Node driving *Approach Out* low.

It asks for:
- a direction name (for example "Up")
- an ordered list in that direction. Each row is a mast and the block it protects (the block just beyond it). The block can be a sensor or a block. Where a boundary has no signal facing this way, the row's **No signal here** box makes a [virtual mast](#virtual-masts) for it. That keeps the tumbledown going across the boundary, as the MSS cable does.
- for each block, optionally, turnouts in it and their through position
- **beyond the last block**: the next mast (on this board, on an imported board, or one JMRI/CATS drives, such as a control point's home signal), a [plant end](#plant-ends), or *end of signalled track*
- which indications to use. Clear, Approach and Stop are always used. **Advance Approach** and **Approach Diverging** are optional (both off by default, as in MSS). Each mast picks an aspect for each indication, prefilled from the tags (CATS masts: R281, ADV_NORM, R285, R282, and the stop aspect)
- **both directions**, which writes a second layer for the opposite masts over the same blocks in reverse order.

For each mast, the layer has these rules, in this order. Each also checks that the mast's block is clear and its turnouts are in their through position:

| # | Next mast | This mast shows |
|---|---|---|
| 1 | is diverging, and not `stop` or `restricting` | Approach Diverging (if used, otherwise Approach) |
| 2 | is `advance` or `clear` | Clear |
| 3 | is `approach` | Advance Approach (if used, otherwise Clear) |
| 4 | is `stop` or `restricting` | Approach |

None active means Stop. A next mast that is not known reads as `stop`, so a board going offline leaves the mast behind it at Approach at best. The mast before *end of signalled track* has only rule 4, with no next mast to check. Rules that are not used are left out, except rule 1: without Approach Diverging it still shows Approach, so a train is never given Clear towards a diverging route (MSS does the same by driving *Approach Out* low).

The masts settle one scan apart, back from the train, as in [The scan](#the-scan). Ten masts take about a second. The chain only reads forwards, so the cycle check passes. The opposite direction is a separate layer that reads its own masts.

Block signals do **not** stop two trains meeting head-on on single track, and nor does MSS. ABS is for following moves. Between two passing sidings, put a [One-train section](#one-train-section) over the single line as well. Its layer keeps the entrance masts at Stop while the line is in use, and the block signals tumble down behind them. Prototype APB, which lets following trains in behind the first while holding opposing masts at Stop, is out of scope.

**Worked example: tumbledown between two turnouts.** Single track from West Siding to East Siding: blocks Int 1, Int 2 and Int 3 between the two control points. Eastbound masts: West Exit (the control point's starting mast, a [Route signal](#route-signal)), Int 1/2 and Int 2/3. Beyond Int 3 is East Home, which CATS drives. Advance Approach is used. Int 1 stays clear throughout.

| East Home | Int 3 | Int 2 | Int 2/3 | Int 1/2 | West Exit (route row follows Int 1/2) |
|---|---|---|---|---|---|
| Stop (route not set) | clear | clear | Approach | Advance Approach | Clear |
| Clear | clear | clear | Clear | Clear | Clear |
| Clear | occupied | clear | Stop | Approach | Advance Approach |
| Clear | clear | occupied | Clear | Stop | Approach |

### Route signal

A trigger block, a mast and a route table. Each row is one rule in the layer, in table order:
- checks: the turnout positions and the blocks that must be clear
- action: the aspect to show.

The first active row wins; none means Stop. A moving turnout matches no row. Optional route locking makes each row a reserving rule over the route's blocks that also locks its turnouts.

A row can instead **follow the next mast** on its route, so a control point joins the [block signals](#block-signals) tumbledown. The row then becomes one rule per indication, in the block signals order, each with the row's checks. A diverging route row picks diverging aspects for each indication, for example Medium Clear and Medium Approach. Those aspects are diverging, so the mast behind shows Approach Diverging.

### Level crossing

Alternating flashing lights, optionally a gate servo, from either approach until the crossing block clears. Needs a new output type, so it is not just rules.

### Approach lighting

This is a per-mast option on the Logic page, under **Masts**, not a starter: the mast is dark unless a chosen block is occupied. It is applied in the scan's write step, after [who wins a mast](#who-wins-a-mast). The board already has a dark state for this. Setting `<m>_aspect` to `-2` runs the show script's dark branch, which turns every lamp off. That branch was added so JMRI's `Unlit` (CATS approach lighting) goes dark, so approach lighting needs no new lamp code.

## Logic modes

Each board picks one **logic mode** on the Logic page:

| Mode | You describe | Who it is for |
|---|---|---|
| **None** | nothing | boards that leave every mast to JMRI/CATS, as today |
| **Field Logic** | blocks, masts, buttons, resources and rule layers, from starters or by hand | any layout. Extensible: anything the rule language can say |
| **MSS Logic** | an MSS-style module: its ends, tracks, junctions and indications | modules that should behave the MSS way and join at a meet, with no rules to write. See the [MSS Logic spec](mss-emulation-spec.md) |

**One engine.** Both modes run the same interpreter, scan, inputs, fail-safe values, start-up scan, logic switch, [CATS hold](#cats-hold), version code and publishes. MSS Logic **builds** ordinary engine items from its description: blocks, virtual masts, mast tags and Block signals and Route signal layers. The engine cannot tell them from hand-written ones. [Plant ends](#plant-ends) are an engine input too, available in both modes.

| | Field Logic | MSS Logic |
|---|---|---|
| Rules | written as cards, from starters or by hand | built from the module description; read-only |
| Resources, rule buttons, manual release | yes | no (MSS has none) |
| Linked boards | imported by name | no |
| Plant ends | declared by hand | built from the description |
| Mast tags | set per aspect | set by choosing an aspect for each MSS indication |
| Layers view, control table, Try it, checker | yes | yes, showing the built items, read-only |
| JMRI/CATS hold, logic switch | yes | yes |
| Share with other boards | on by default | always on (neighbours read it) |

**Switching mode** keeps both descriptions in the file, but only the chosen mode generates YAML. **Convert to Field Logic** is offered in MSS Logic mode. It copies the built items, plant ends included, into Field Logic as ordinary, editable blocks, masts, plant ends and layers, and switches the mode. The board still pairs at a meet. It only goes that way: Field Logic rules cannot be turned back into an MSS description.

## Ease of use

These rules apply to the whole Logic page, in both modes. MSS Logic adds its own in the [MSS Logic spec](mss-emulation-spec.md#ease-of-use). The test for every screen: could someone who has wired a detector, but never heard of an interlocking, use it without reading this spec?

### Plain words on the page

This spec uses precise terms. The page does not. Each term has one plain label, used everywhere on the page, in validation messages and in the guides:

| In this spec | On the page | One-line hint shown beside it |
|---|---|---|
| Logic mode | Logic | How this board decides what its signals show |
| Field-controlled mast | Set by logic | This signal is decided by this board, not by JMRI |
| Rule | Rule | One sentence: when this happens, show that |
| Trigger / checks / actions | **When** / **Only if** / **Then** | — |
| Layer | Group | Rules that work together, such as one starter |
| Resource | Section | Track only one train may use at a time |
| Reserve | Take the section | — |
| Release | Free the section when… | — |
| Approach locking | Hold after cancelling | Keep the section for a while if a signal drops in front of a train. Railways call this approach locking |
| Manual release | Release | Free a stuck section by hand |
| Tag | Meaning | What the aspect tells the driver: Stop, Restricting, Approach, Advance Approach, Clear |
| Diverging | Diverging route | The train takes the turnout, at reduced speed |
| Stop aspect | At stop and at start-up | — |
| Virtual mast | Signal with no lights | A pretend signal, so the signals behind it still work |
| Remote input | From another board | — |
| Built item | Made by MSS Logic | — |
| Plant end | End | Where track leaves this board. Press Pair on both sides of a joint to join two boards |
| Expander | Expander (MCP23017) | Adds 16 sensor pins over I2C |
| Version code | Logic version | Matches the board when it is running what you checked |
| Logic switch | Logic on / off | Off hands the signals back to JMRI/CATS |

Scan, latch, interpreter, rule table and phase never appear on the page. Try it shows them only under **Show timing details**.

### Show, don't describe

- **Every mast is drawn.** Wherever a mast and aspect are chosen (rule cards, Masts, Try it), the page shows the small mast picture the Signal Masts editor already draws, lit in that aspect.
- **Explain this signal.** Every mast that logic sets has an **Explain** button. It gives one generated sentence per aspect, worked out from the rules, for example: *"Left Bridge shows Clear when a train has been in Left for half a second and the Bridge section is free. Otherwise it shows Stop."* The engine (`logic.js`) generates it, so it always matches what runs. Rule cards read the same way.
- **Try it is a track picture where possible.** Block signals, One-train section and Route signal starters, and MSS Logic, know the track's shape, so Try it draws a simple strip diagram. Click a block to put a train in it, click a turnout to throw it, and watch the masts change. Other rules get a panel of inputs and masts.
- **Walk a train through.** Try it has **Run a train**: pick a start and a direction, and a train of a chosen length steps block by block, with each mast shown at every step. This is how most people will check their work.

### Start simple, reveal the rest

- **Starters first.** An empty Logic page in Field Logic mode shows the starters as cards with a small track picture each (gauntlet, single-line bridge, block signals, route signal, lock turnouts). **Write a rule from scratch** is the last card.
- **Advanced options are folded away.** *When … then …*, *for* times, hold after cancelling, the leaving guard and CANCEL sit under **More options** on each card. A starter's rules work without opening it.
- **Sensible defaults everywhere.** Every field a starter fills has a default that works on a typical layout: 0.5s to ask, 3s to free, Advance Approach off, and the CATS aspects prefilled.
- **A checklist at the top.** The page shows the next step until the board is ready: *choose a mode → add blocks and signals → try it → download*. Each step links to the part it means.

### Problems in plain words

- Every validation and checker message says **what is wrong, why it matters, and what to do**, and links to the item. For example: *"Up Home can never show anything but Stop: the block it protects, Int 1, is also the block that asks for it. Pick the block before the signal as its trigger."*
- A checker failure has **Show me**, which loads the sequence that fails into Try it, so the problem plays out on the track picture.
- Warnings never block the download. Errors do, and the Download page lists them with the same links.

### Something to keep, and a guide

- **Printable summary.** The Download page offers a one-page summary of the board's logic, for the workbench or the underside of a module. It lists each signal with its Explain sentences, and each block with its sensors and their pins. It is generated with the YAML, so it always matches.
- **A guide for each mode.** `docs/field-logic-guide.md` and `docs/mss-logic-guide.md`, written in the style of the existing guides: one worked example from empty page to working signals, with wiring, then Try it, flashing and checking in MQTTX. Screenshot placeholders, as in the other guides. The page links to the guide from each part's hint.

## Configurator

### The Logic page

Logic is one new top-level page, **Logic**, between Signal Masts and Download in the nav. It opens with the [logic mode](#logic-modes): None, Field Logic or MSS Logic. The rest of the page shows the parts for that mode. This section describes Field Logic's parts; MSS Logic's are in the [MSS Logic spec](mss-emulation-spec.md#where-it-lives).

Sensors, Turnouts and Signal Masts are the **foundations**: hardware, pins and JMRI topics. Logic adds no fields or lists to those pages. The Logic page **stitches their items together**. It picks them by name from dropdowns and never edits them. Renaming a foundational item updates every reference to it. Deleting one marks whatever used it invalid until it is fixed. A board with logic mode None generates exactly the YAML and JMRI XML it does today.

Field Logic's parts, in order:

| Part | What you declare there | Spec |
|---|---|---|
| Settings | logic starts on / off; Share with other boards | [Logic switch](#logic-switch), [What each board publishes](#what-each-board-publishes) |
| Linked boards | other boards' `board.yaml`, imported as references | [Remote inputs](#remote-inputs) |
| Plant ends | each end, its tracks, what each track offers, and optional Pair button and LED pins | [Plant ends](#plant-ends) |
| Blocks | named groups of sensors | [Blocks](#blocks) |
| Masts | for each mast logic sets or reads: its aspects' tags and diverging ticks, its stop aspect, approach lighting. Also virtual masts | [Aspect tags](#aspect-tags), [Virtual masts](#virtual-masts), [Approach lighting](#approach-lighting) |
| Buttons | push buttons used by rules, each with its pin | [Inputs](#inputs) |
| Resources | each with its blocks, its release and approach locking (off, or a time) | [Reserving rules](#reserving-rules) |
| Layers | rule cards, and **Add from starter**, which writes a new layer | [Rules](#rules), [Starters](#starters) |

A mast joins the Masts list when a rule or starter first uses it, with its tags prefilled (CATS aspects tag themselves). A starter that needs something declares it in the right part. For example, *No signal here* in Block signals adds a virtual mast under Masts. The page never reaches back into the foundational pages.

In both modes, the page also has:

- A **layers view** shows, for each mast, turnout and block, which layers read it and which set it. Overlaps are visible at a glance: masts shared across layers, locks, and blocks used by several layers.
- A **control table** view shows the same rules the way signal engineers write them: one row per mast and aspect. Its columns are the trigger, the blocks that must be clear, the turnout positions, the resource reserved, its release, approach locking and the locks. It is read-only. Edits happen on the cards.
- In Field Logic, dropdowns that list this board's items, its blocks, virtual masts and plant ends, and those of linked boards.

### Checking in the browser

The engine is one JS module (for example `configurator/logic.js`). It runs the same scan as the board, and is used by the Try it panel, the checker and the tests.

- **Try it:**
  - tick inputs on and off, including remote ones and "not known"
  - run in real time, or one scan at a time with timers skipped forward
  - watch the masts, locks, rule phases, resources, timers and latches.
- **Checker:** explores every reachable state of the board's rules. Each timer is treated as an "elapsed" event that can happen at any scan. It reports:
  - a waiting rule that can never be granted (deadlock), or that can be passed over forever (starvation)
  - a rule that can never become active
  - a mast that can never leave Stop.
- Checker errors block the download, like other validation errors. Warnings are listed on the Download page, next to the version code of the rules being downloaded.
- If a board has too many states to explore fully, the checker says so and falls back to random runs.
- The checker only proves what the model expresses. Resources make "only one train on this track" true by construction. They cannot tell whether two masts lead onto the same track unless a resource says so.
- It runs in both logic modes. In MSS Logic it checks the built rules, plant ends included, and points each problem back at the part of the description that made it. MSS has no sections, so it can only find rules that never apply and masts stuck at Stop. That still catches a description the builder accepts but cannot work, such as a route that needs a turnout both ways.

#### Checker limits

Measured in work item 4.5 with `configurator/test/bench/checker-limits.mjs`, which anyone can re-run. Three things keep the state count down. None of them changes what the checker can find:
- **Parts.** Rules that set the same mast, or reserve the same section, belong together. A group's part is that group plus every group whose mast it reads, and so on. Nothing outside the part can change what its rules see: rules reach each other only through the masts they set and the sections they reserve, and a turnout lock is written, never read. Each part is explored with only its own inputs, so two tracks through a module, or the two directions on one track, are checked side by side instead of multiplied together. A part inside another is not checked again. Block signals read the next mast down the line, so one direction of a line stays one part.
- **Inputs that cannot be told apart are explored once.** Some inputs are read only through blocks: a sensor, an end's block, another board's item. Two of those that sit in the same blocks the rules read count as one input. A check changes one input per scan, so the engine only sees whether either is occupied. A heard end signal's meanings that every rule compares the same way also count as one value, for example Stop and Restricting where the rules ask "Stop or Restricting". Try it still offers every input.
- **Waiting order per section.** A state keeps each section's waiting order, which decides its grants. It does not keep how requests for different sections, or plain rules, interleave, because nothing reads that.

Measured on an Apple-silicon Mac with Node 26. A + means the check stopped at its budget. Validation is the quick check; Full is Check every combination.

| Board | Inputs (Try it) | Rules | Parts (inputs each) | States, every one | Time | Validation | Full |
|---|---|---|---|---|---|---|---|
| One-train section, 2 entrances | 3 | 2 | 1 (3) | 120 | 0.04 s | done | done |
| One-train section, 3 entrances | 4 | 3 | 1 (4) | 1,024 | 0.3 s | done | done |
| One-train section, 4 entrances | 5 | 4 | 1 (5) | 10,388 | 4.6 s | 2,000+ | done |
| 4 entrances, trains leave the way they came | 5 | 4 | 1 (5) | 4,490 | 2.2 s | 1,600+ | done |
| 4 entrances, Hold after cancelling 10 s | 5 | 4 | 1 (5) | 14,543 | 7.5 s | 2,000+ | done |
| 4 entrances, two blocks in the section | 6 | 4 | 1 (6) | 20,775 | 12 s | 2,000+ | done |
| Block signals worked example | 4 | 12 | 1 (4) | 123 | 0.07 s | done | done |
| MSS crossover (two tracks, two ends of two) | 15 | 18 | 4 (9, 6, 6, 9) | 624 | 0.45 s | 620+ | done |
| MSS junction with a turnout, three ends | 15 | 29 | 3 (12, 9, 9) | 2,541 | 3.4 s | 920+ | done |
| MSS single track, Advance Approach | 11 | 22 | 2 (8, 8) | 324 | 0.2 s | done | done |
| MSS three modules, each module | 7 | 6 | 2 (4, 4) | 12 | under 0.01 s | done | done |
| Three boards by their ends, each board | 8 | 4 | 2 (4, 4) | 8 | under 0.01 s | done | done |

Before these three, the MSS junction did not finish in 40,000 states (over two minutes), and each of the three modules took 1,025 states. A state costs 0.4 to 1.3 ms, because the engine has no snapshot and each state is reached by replaying its path. The four-entrance section is genuinely large: four trains can ask in any order, and the order decides who goes next.

The budgets (`BUDGETS` in `logic-checker.js`):
- **Validation**, on every change to the rules (memoised on the rule table): 2,000 states or 400 ms, shared by the parts. A part that does not finish gets random runs for up to 200 ms more, at most 100 runs of 40 steps. So the page never waits more than about 0.6 s.
- **Full check**: the Download page offers **Check every combination** when the quick check of the current rules gave up. It allows 30,000 states or 20 s. A part that still does not finish gets up to 1,000 random runs of 60 steps, for up to 5 s. Its result stands until the rules change. The page waits while it runs.
- What fits, in practice: anything with up to about 1,000 states in a part finishes in validation. That covers sections with up to three entrances, block signals, plant-end boards and single MSS tracks. A four-entrance section, or a junction module with 12 inputs in one part, needs the full check: a few seconds. A part past 30,000 states, or 20 s, gets random runs only. The largest measured, a four-entrance section with two blocks, is 20,775 states. A slower computer reaches the time limit sooner.
- **Random runs** start only for a part that hit its budget. Parts that finished keep their proofs. Random runs prove that a rule applies, or that a mast leaves Stop, when they see it happen. They never report a deadlock or starvation, which need every state. For a rule they never saw apply, they say "did not apply in N random runs" and that it may never apply, not that it can't. The partial warning says the check was not complete, and points to the full check when it was the quick one.

### Validation

- Every referenced item, aspect, button and resource exists. Remote inputs need MQTT on.
- A block is in at most one resource. Across imported boards, it is in resources on only one board.
- No cycles: a rule cannot read, directly or through other rules, a mast it sets.
- Each chosen aspect exists on its mast, and aspect labels on a field-controlled mast are unique.
- A button's pin is free, like any other pin.
- Two layers giving different aspects with the same tag on one mast: warning.
- A *when* trigger with no CANCEL: warning.
- A block has at least one sensor. Its name and topic follow the sensor rules, and cannot match a sensor's or a virtual mast's. A sensor from another board needs MQTT on.
- A sensor in more than two blocks: warning (a boundary has two sides).
- A [block signals](#block-signals) mast whose block and previous block share no sensor: warning. There is no boundary sensor, so the mast can clear behind unpowered cars.
- Plant ends: each end track has end sensors and a first mast, or passes through to a track at another end, and pass-throughs do not loop. Plant ends need MQTT on.
- Expanders: at most eight per I2C bus and two buses; addresses unique on a bus; each expander pin used once; a shared bus uses a PCA9685 board's pins exactly.
- A board with a logic mode or Share whose name has no suffix: warning, with **Add a suffix** (see [Unique board names](#unique-board-names)).
- A board name whose typed part is over 19 characters, once the suffix is on: error (the `<board> setup` hotspot name must fit in 32).
- Sensor and turnout names cannot start with `logic/` or `board/`. No sensor may be named `<sensor>/State`, `<turnout>/Thrown`, `<turnout>/Locked` or `<turnout>/Moving`. Today's configurator already rejects `/Thrown` and `/Locked`.

Built in work item 2.6, except the plant end checks, which come with plant ends (Release 3). Each message links to the page and part where it is fixed. Where the list above is not exact, the configurator does this:

- A rule reads a mast through its trigger, checks and Cancel, and through the release of the section it takes. A mast on another board never makes a cycle here.
- A Block signals group is one whose `starter` is `block-signals`. Each mast's block is the block (or sensor) its rules' When needs clear, as the starter writes it, else the first one an Only if checks is clear. The masts run in the order their rules are listed.
- Masts entries are checked too: the mast is on the Signal Masts page, each aspect given a meaning, ticked diverging or chosen as the stop aspect exists, and the approach lighting block exists.
- A rule button's pin needs a pull-up, like a turnout's button, and a clash is an error.

## Generated YAML (shape)

Everything below is emitted only for what the Logic page declares: the interpreter and switch only with a logic mode, the shared publishes only with Share with other boards, a block only if declared. The YAML has two parts: the interpreter (the executive: an external component, the same on every board) and the rule table (this board's data).

**The interpreter ships as an ESPHome `external_components` entry** from this repo, pinned to the configurator's release tag, so a board always builds against the interpreter that matches the page that made its YAML. ESPHome caches it, so GitHub is only needed on the first build and after an upgrade. It has to be C++ anyway: plant ends subscribe at runtime to topics a board only learns when it is paired (`global_mqtt_client->subscribe()`), which YAML `mqtt_subscribe` cannot do. The **interpreter core is plain C++ with no ESPHome dependency**, so it can be compiled and tested on a computer (see [Tests](#tests)). A thin ESPHome layer connects it to sensors, scripts and MQTT. The C++ mirrors `configurator/logic.js`, so what the browser checks is what the board runs.

The rule table is written into `board.yaml` as data for the component. The version code is a hash of the rule table. Existing pieces (`<m>_aspect`, `<m>_show`, `<block>_sensor`) are reused, and no new lamp code is needed. `<m>_aspect` holds an aspect index, `-1` for nothing shown yet, or `-2` for dark.

- The [scan](#the-scan) runs every 100 ms inside the component: read, evaluate, write, publish and log. It does nothing while logic is off.
- State, all `restore_value: false`. It lives in the component. Where existing YAML needs it (a turnout's lock check, a mast's aspect and `_show` script), the component writes the typed ESPHome `globals` it is given by id (decided in [The component](#the-component-spike-a)). The names below are the ones the YAML uses either way:
  - per input: its value, its two latches and, for a remote input, whether it is known
  - per resource: holder, phase, and per reserving rule its waiting-since time
  - per field-controlled mast: `<m>_held` (the Held flag from the last JMRI message) and `<m>_remote` (the aspect JMRI last picked, `-1` if none)
  - per locked turnout: `<id>_field_locked`.
- **Inputs only record; they never run rules.** These all set an input's value and latches:
  - each sensor a rule reads, from its existing `on_press` and `on_release`
  - the throw scripts, for "moving"
  - the `mqtt_subscribe` handlers, and the component's plant end subscriptions
  - the rule buttons, the release buttons and the switch.
- `binary_sensor`: one per rule button, on a pull-up pin.
- `binary_sensor` (`platform: template`): one per block. Its lambda is true while any of its sensors is occupied, or a remote one is not known. Its `on_press` and `on_release` publish and log like a detector, and record the input. It does not depend on the logic switch.
- Nothing logic emits is added to a foundational item's own YAML, except hooks that record an input or apply a lock. Those are: the `on_press` / `on_release` recording on a sensor a rule reads, the sensor `/State` publish when sharing, the "moving" recording and `/Moving` publish in throw scripts, and the `<id>_field_locked` check beside the existing lock check.
- `text_sensor` (`mqtt_subscribe`):
  - one per remote input, and one per board Online topic
  - field-controlled masts keep theirs. The handler always records `<m>_held` and `<m>_remote`. With logic off it also shows `<m>_remote` as today.
- `text_sensor`: `Logic version`, the version code, also logged at boot.
- Per plant end: a `text` entity `End <name> link` (`restore_value: true`), a `button` `Pair End <name>`, a `text_sensor` with the end's state in words, and, if pins are set, a pairing push button (`binary_sensor`, pull-up) and a status LED (`output`). The retained Block, Mast and Link publishes per end track. The subscription to the paired end's topics is made by the component and changes with the link.
- Per expander: an `mcp23017` hub (`id`, `address`, `i2c_id`). Its sensors use `pin: { mcp23xxx: <hub>, number: 0–15, mode: { input: true, pullup: true }, inverted: true }`. When two buses are in use, each `i2c` bus gets an `id`.
- `button`: `Release <resource>` per resource. `switch`: `Field logic` or `MSS logic`, `restore_mode` `RESTORE_DEFAULT_ON` or `RESTORE_DEFAULT_OFF`.
- `mqtt`:
  - `birth_message`, `will_message` and `shutdown_message` on the Online topic
  - `on_message` for the release and switch topics
  - retained publishes of the Held, State, Version and switch topics
  - `/Moving` from each throw script, `ACTIVE` at the start and `INACTIVE` after the back-off.
- `on_boot`: field-controlled masts at their stop aspect, then the [start-up scan](#start-up-scan) after the existing startup aspect step (priority below -150). Toggle switch boot moves wait for it.

## The component (Spike A)

Spike A built an `mr_logic` external component around the C++ core and compiled it for an ESP32 with ESPHome 2026.10.2 (work item 0.4). What it decided, and what still needs a board on the bench:

**Decided**

- **Where the code lives.** ESPHome copies only an external component's top-level source files into the build; it descends into subfolders only for its own core. So `components/mr_logic/` holds the core (`logic_core.*` and `logic_table.*`, no ESPHome includes) beside the adapter (`mr_logic.*`) and `__init__.py`. The core's namespace is `logic_core`: ESPHome's generated `main.cpp` has `using namespace esphome;`, so a core namespace called `mr_logic` clashes with the component's `esphome::mr_logic`.
- **The rule table is one JSON string** in the YAML (`mr_logic: table:`), in the engine cases' board format, so the configurator, `logic.js`, the cases and the board share one format, and the version code can be a hash of it. The alternative, a nested YAML schema, was measured on a 200-rule table: `esphome config` took 0.19 s with the string, 0.28 s nested, and 0.18 s with no logic at all. Both are fast; the nested table also made the YAML four times as long (3,752 lines against 952) and needed the format written again as a Python schema.
- **The component writes typed globals and runs scripts by id.** Codegen binds each engine name to this board's objects with generated lambdas: a mast's `<m>_aspect` global and `<m>_show.execute(true)`, a turnout's `<id>_field_locked` global. The existing YAML keeps reading the same globals as today, so logic adds nothing to a foundational item's YAML beyond the hooks this spec lists, and the component does not depend on the globals' or scripts' C++ types (restoring globals are a different type).
- **Moving is polled, not hooked.** Once per scan the component reads `is_running()` on a turnout's two throw scripts, and its `_thrown` global. A throw takes seconds, so a 100 ms poll misses nothing, and the throw scripts need no new hooks for the engine.
- **Inputs are recorded as they arrive.** Binary sensors and the `mqtt_subscribe` text sensors feed the engine through `add_on_state_callback`, so a pulse between two scans is not lost. ESPHome queues MQTT events to the main loop, so callbacks never run during a scan.
- **The scan** runs in `loop()` every 100 ms by `millis()`. A late loop runs one scan, not a burst to catch up, and a scan longer than the cycle is logged at `WARN`.
- **Detectors settled** means every bound sensor has a state. With the 500 ms Debounce that is about half a second after boot. The start-up scan waits for it, or for 3 s at most; a sensor with no state by then counts as occupied.
- **`_show` is `mode: restart`**, which is safe because the engine writes a mast only when its aspect changes (the `scan-publish-on-change` case).

**The core is compact (work item 2.3b).** The first core (2.3) kept names as strings, looked them up by name, copied the board into the engine, and read the JSON into a tree first: about 350 KB of heap for 200 rules. Now `logic_table.cpp` reads the JSON once, straight into a compiled table (every name once in one string, conditions as a flat array of indices, values as small enums), and the engine refers to that table. Measured on a computer (64-bit, so pointers are twice the ESP32's):

| Table | JSON | Table + engine | Peak while reading | Mean scan |
|---|---|---|---|---|
| Gauntlet, 2 rules | 652 B | 1.6 KB (was 5.8 KB) | 1.0 KB (was 15.8 KB) | 0.5 µs (was 1.4 µs) |
| 48 rules, 50 masts | 12.6 KB | 10.5 KB (was 114 KB) | 12.2 KB (was 240 KB) | 1.5 µs (was 39 µs) |
| 200 rules, 50 masts | 36.9 KB | 29.9 KB (was 347 KB) | 35.8 KB (was 747 KB) | 12.5 µs (was 254 µs) |

An ESP32 with Wi-Fi, MQTT and the web server running typically has 100 to 150 KB of heap free, so a 200-rule board fits with room to spare. The cases and the JS cross-check prove the compact core behaves exactly as before.

**Flash and RAM on the ESP32** (ESPHome 2026.10.2, `esphome compile`): the gauntlet board without logic used 53,488 B of static RAM and 1,039,391 B of flash. With the component bound to its sensors, masts and turnout: 53,680 B (+192 B) and 1,081,075 B (+41.7 KB). A 200-rule table adds its JSON string to flash (+34.5 KB) and no static RAM.

**The component's YAML** (work item 2.4). The generator (2.5) writes one `mr_logic:` block; every id it names already exists in today's YAML, apart from the field-lock globals, the switch and the Release buttons:

```yaml
mr_logic:
  id: logic
  board: kiama-north-k7m4x2       # this board, for the logic topics; none: no MQTT
  version: 3f9a1c22               # the version code, published retained
  table: '{"sensors":[...],"masts":{...},"logic":{...}}'
  logic_switch: field_logic       # a template switch, restore_mode RESTORE_DEFAULT_ON or _OFF
  sensors:
    - { name: Left, sensor: left_sensor, expander: mcp23017_1 }   # expander: only on an MCP23017 pin
  masts:
    - { name: Left Bridge, aspect: left_bridge_aspect, show: left_bridge_show, jmri: left_bridge }
  turnouts:
    - { name: P1, thrown: p1_thrown, throw_closed: p1_throw_closed, throw_thrown: p1_throw_thrown,
        field_locked: p1_field_locked, remote_locked: p1_locked, resync: p1_latch_1 }
  remote:
    - board: kiama-south-a3f9qp
      online: linked_kiama_south_a3f9qp_online
      sensors: [{ name: Approach, state: linked_kiama_south_a3f9qp_sensor_approach }]
      turnouts: [{ name: P7, thrown: ..._thrown, moving: ..._moving }]
      masts: [{ name: Home, state: ... }]
```

- The component does the logic topics itself: it subscribes to the switch's light (`ON` / `OFF`) and each resource's Release turnout (`THROWN`), and publishes the light's state, Held, State, Version and the Release answer `CLOSED`, all retained. With no `board`, or Disable MQTT, it does none of this, and remote inputs stay not known.
- A Release button is a template `button` whose `on_press` is `id(logic).release("<resource>");`.
- `id(logic).started()` is true once the start-up scan has run: the toggle switches' boot moves wait for it. `id(logic).logic_on()` is the switch (before the first scan too): the startup-aspect step at -150 runs only when it is false. At the start-up scan the component itself shows each field-controlled mast's stop aspect (logic on) or its startup aspect (logic off).
- A field-controlled mast's `mqtt_subscribe` keeps its topic but no `on_value` handler: the component reads JMRI's messages, uses only the hold with logic on, and with logic off shows today's handler's pick at once.
- `resync` runs the turnout's latch script with `force: false` when it goes from locked (either flag) to unlocked; the YAML's own `UNLOCKED` handler stops running it on a board with logic.
- An expander that fails or warns makes its sensors read occupied, and the component logs an `ERROR` until it answers again.

**What the generator writes** (work item 2.5, `logic-yaml.js`). With Field Logic, every board gets the component, the switch and the version, rules or not:

- **The table** lists every sensor and turnout on the board, the masts logic sets or reads (or lists under Masts), the virtual masts, the other boards' items the rules and blocks read, and the Logic page's blocks, sections and groups. Only what runs goes in: a group's `starter` and a block's topic stay out, and each rule's keys are written in a fixed order. So the same rules always give the same table.
- **Aspect names** in the table are the aspect labels from the Signal Masts page, in that page's order, because the component turns a name into the index the show script draws. So on a mast logic uses, each label must be unique and not only a number (JSON puts number keys first). An aspect's JMRI strings go in as its `states` unless they are just `<label>; Lit; Unheld`. The stop aspect is always written out: the one chosen under Masts, else the aspect named, or with the JMRI aspect, `R292` or `Stop`, else the first `stop` aspect.
- **Tags** are as set under Masts. An aspect with no tag is `stop`, and one not ticked diverging is not diverging. The Masts part (2.7a) fills in the CATS tags when a mast joins it.
- **Another board's masts** are read by their `/State`, which carries the JMRI aspect name. So a linked board's snapshot keeps each mast's aspects by JMRI name, with the tags that board gives them, and its virtual masts. A board without Field Logic gives no tags, so its masts read as `stop`.
- **The version code** is FNV-1a (32 bits) over the table's UTF-8 bytes, as eight hex digits. It is in `mr_logic: version:`, in the `Logic version` text sensor, and in the component's boot log.
- **Boot:** a field-controlled mast joins the -150 step. While logic is on it shows its stop aspect; while off, its startup aspect, if it has one. A toggle switch's -200 move first waits for `id(logic).started()`.
- **Virtual masts** get an `int` aspect global and a `_show` script that logs the aspect and, when sharing, publishes `/State`. They have no lamps and are not in the JMRI XML.
- **Disable MQTT:** `mr_logic` has no `board` and no `jmri` bindings; the switch, Release buttons and version stay. A mast that a rule sets needs no MQTT; a mast JMRI sets still does.
- **JMRI XML (Logic box):** the switch light `MLlogic/<board>`, each section's Release turnout with `DIRECT` feedback (it takes the board's `CLOSED` on its own topic), and its Held sensor.
- The component comes from `github://aaron9589/esphome-for-model-railroading@<LOGIC_COMPONENT_REF>`, which is `feature/logic` until the first pre-release tag. CI fails if that ref is not on GitHub.
- **Turnout locks** (work item 2.5b): the fascia buttons' guard, the `CLOSED` / `THROWN` handlers and the latch script read `id(<id>_locked) || id(<id>_field_locked)`, or whichever flag the turnout has; a rule lock works with Disable MQTT too. Each turnout's binding names `remote_locked` (with Remote lock) and `resync` (its latch script, when it can be locked), so the component runs the re-sync on the combined state and the `UNLOCKED` handler only clears `<id>_locked`. A rule-locked turnout's lock report comes from a template `binary_sensor` `<id>_lock_report` (internal) that follows both flags and publishes on each change, plus the on-connect publish; its `Lock` handlers no longer publish it. JMRI XML and the sensor clash check include it, with Remote lock or without.
- Rule buttons are not generated yet: the component has no binding for them.

**Still to measure on a board** (the spike's hardware half): scan time on the ESP32, the 100 ms loop's jitter while MQTT connects, free heap with about 40 `mqtt_subscribe` text sensors, and the boot order on the bench. The boot order to try: the startup-aspect step (`on_boot` priority -150) runs only while the logic switch is off; the latch scripts (-200) wait until the component's start-up scan has run; the component's setup priority is `DATA`, after the sensors and scripts it reads.

## Stored format

Everything on the Logic page is stored in one new optional `logic` key in the existing `esphome-mr-config:1` blob. The foundational keys (`blocks`, `points`, `signals`) do not change shape. There is no new file format and no version bump: an older configurator ignores the key. `normalizeConfig` fills in defaults.

```json
"logic": {
  "mode": "field",
  "startsOn": true,
  "share": true,
  "remoteBoards": [
    { "name": "kiama-north", "blocks": [...], "points": [...], "signals": [...], "logic": { "blocks": [...], "masts": [...] } }
  ],
  "ends": [
    { "name": "A", "tracks": [
        { "sensors": ["Up East optical"], "mast": "Up Home" },
        { "through": { "end": "B", "track": 2 } } ],
      "pairPin": "GPIO32", "ledPin": "GPIO33" }
  ],
  "blocks": [
    { "name": "Int 2", "topic": "trains/track/sensor/Int 2",
      "sensors": ["Int 2 current", "Int 2 East", { "board": "kiama-north", "block": "Int 2 West" }] }
  ],
  "masts": [
    { "mast": "Up Home", "stopAspect": "R292", "approachLight": "Int 1",
      "tags": { "R281": "clear", "R285": "approach", "R292": "stop" }, "diverging": ["R282"] },
    { "virtual": true, "name": "Up Int 2", "topic": "trains/track/signalmast/Up Int 2",
      "aspects": ["Stop", "Approach", "Clear"],
      "tags": { "Stop": "stop", "Approach": "approach", "Clear": "clear" } }
  ],
  "buttons": [
    { "name": "Depart", "pin": "GPIO25" }
  ],
  "resources": [
    { "name": "Bridge", "blocks": ["Bridge"], "approachLock": "10s",
      "release": { "while": { "all": [{ "block": "Bridge", "is": "clear" }] }, "for": "3s" } }
  ],
  "layers": [
    { "name": "Bridge gauntlet", "starter": "one-train-section",
      "rules": [
        { "trigger": { "while": { "block": "Left", "is": "occupied" }, "for": "0.5s" },
          "checks": [],
          "then": { "mast": "Left Bridge", "aspect": "Clear", "reserve": "Bridge" } },
        { "trigger": { "while": { "block": "Right", "is": "occupied" }, "for": "0.5s" },
          "checks": [],
          "then": { "mast": "Right Bridge", "aspect": "Clear", "reserve": "Bridge" } }
      ] }
  ]
}
```

- A rule or block refers to what an end hears as `{ "end": "A", "track": 1 }`. An end's link is not stored; it lives on the board.
- `logic.blocks` holds the Logic page's blocks. The top-level `blocks` still holds the sensors, as it always has.
- `masts` refers to a foundational mast by name (`mast`), or declares a virtual mast (`virtual: true`, with its own name, topic and aspects). Tags are keyed by aspect name, and a missing tag means `stop`.
- `mode` is `field`, `mss` or missing (None). Field Logic uses the keys shown. MSS Logic stores only its description, in `logic.mss`; its built items are not stored. Both can be in the file, but only the chosen mode generates.
- `approachLock` is the approach locking time. Missing means off.
- A remote item is referenced as `{ "board": "kiama-north", "block": "Up Main" }`.
- `remoteBoards` keeps just what the dropdowns and checks need: names and topics, plus each mast's aspects and tags, from that board's `logic.masts` (for an MSS Logic board, its built blocks and masts).
- `starter` records which starter wrote a layer. It is for display only; the rules are what run.

Two foundational additions sit outside `logic`, because they are not logic:

```json
"board": { "name": "kiama-north-k7m4x2", "nameSuffix": "k7m4x2", ... },
"expanders": [
  { "name": "MCP 1", "bus": 1, "address": "0x20" },
  { "name": "MCP 2", "sda": "GPIO25", "scl": "GPIO26", "address": "0x20" }
],
"blocks": [
  { "name": "Int 2 East", "expander": "MCP 1", "pin": 11, ... }
]
```

- `nameSuffix` records the suffix the configurator added. It is kept when the name is changed, and never added twice.
- An expander on `"bus": 1` shares PCA9685 board 1's pins. One with `sda` and `scl` has its own bus.
- A sensor on an expander has `expander` and `pin` (0–15: A0–A7 are 0–7, B0–B7 are 8–15) in place of `gpio`. Files without `expanders` import unchanged.

## Tests

In `configurator/test/`, run through `configurator/package.json`:

- **Generator:**
  - logic mode None, with Share unticked, gives byte-for-byte the YAML and JMRI XML of today's configurator, for every existing test fixture
  - YAML for a two-entrance and a four-entrance section, MQTT on and off
  - field-controlled masts still subscribing, and at their stop aspect from boot
  - the release, switch, Held, Version and Online topics, the sensor `/State` mirror, and turnout `/Moving`
  - remote input subscriptions and rule buttons
  - the same rules give the same version code, and any change to a rule changes it.
- **Blocks and tags:**
  - a block's template sensor, with the switch on and off, with no rules, and with a remote sensor (occupied until known)
  - the CATS tags and diverging list match the tables in [Aspect tags](#aspect-tags), all 30 aspects
  - Share with other boards on its own adds the publishes and nothing else.
- **Virtual masts:** no lamp code; `/State` published; validation error when no rule sets one.
- **Interpreter, C++ and JS:** the interpreter core is compiled on a computer in CI, with no ESP. The JS engine and the C++ core replay the same **test cases**, kept as JSON in `configurator/test/cases/`: an input sequence in, and the expected outputs scan by scan. Every Scan, Rules and Fail safe test below is written as such a case, so both engines must pass all of them.
- **Logic modes:** only the chosen mode generates; switching keeps both descriptions; Convert to Field Logic gives editable items that generate the same YAML and the same version code as the MSS Logic they came from. The [MSS Logic spec](mss-emulation-spec.md) has its own tests.
- **JMRI XML:** the Logic box adds each block as a sensor, `MLlogic/<board>`, `MTlogic/<board>/<resource>/Release`, `MSlogic/<board>/<resource>/Held` and `MSboard/<board>/Online`, validating against JMRI's `layout-4-19-2.xsd`. Unticked, it adds none of them, and the other three boxes give what they do today. The Release turnout has no `/Thrown` feedback. None with MQTT off.
- **Scan** (against `logic.js`):
  - a pulse shorter than a scan is still seen, including "occupied, then clear" inside one scan
  - two rules wanting the same resource in one scan: one grant, to the longest waiting, then list order
  - outputs and publishes happen only on change, and all again on connect
  - a manual release, a hold and the switch take effect at the next scan; a release waiting on the broker when the board connects is ignored
  - with logic off, a field-controlled mast behaves exactly as today for every JMRI message
- **Rules:**
  - a waiting rule is granted after release, and waiting order with three entrances
  - cancel before passing; a trigger flicker shorter than its *for* neither starts nor cancels a request
  - approach locking: off frees at once; on holds for the time, then frees; a block occupied during that time goes to PASSED; manual release ends it
  - a detector dropout shorter than the release delay does not release
  - the leaving guard: a departing train does not clear its own mast
  - who wins a mast: first active rule within a layer, most restrictive across layers, in tag order
  - block signals: the worked example's four rows; the tumbledown with and without Advance Approach; Approach Diverging behind a diverging aspect, and Approach there when Approach Diverging is not used; a remote next mast going offline leaves Approach; a reversed or moving turnout in a block gives Stop
  - the two lock flags: the re-sync runs only when both are clear, not when one of two clears.
  - lock turnouts under a train: the turnout is locked while its block is occupied, and unlocked once it clears
  - route signal: the first row whose turnouts and blocks match wins; a moving turnout matches no row; a row that follows the next mast joins the block signals tumbledown
- **Fail safe:**
  - the start-up scan with a train in the section (held, PASSED, releases after the delay), and with all clear
  - a toggle switch's boot move waits for the start-up scan, so a turnout under a train stays put
  - remote inputs not known before the first message, and while their board is offline, count as occupied / neither position / Stop
  - a moving turnout, local or remote, matches neither position
  - a held mast is not granted until unheld; held after the grant, before passing, cancels it so another rule can go
  - with logic on, a JMRI message's aspect name is ignored (`refresh()`, `null; Lit; Held`)
  - a stale hold stays at Stop until released
  - the start-up scan counts a train in a leaving-guard block as waiting
  - switching off hands masts to JMRI's last aspect; switching on runs a start-up scan.
- **Plant ends:**
  - an end offers its Block and Mast; a pass-through offers its own sensors OR the far end's Block, and the far end's Mast
  - two paired ends cannot hold each other occupied
  - an empty, unheard or disagreeing link reads occupied and `stop`; `end` reads clear and `stop`
  - track numbering at a joint, with one board turned round
  - changing a link changes no rule and not the version code
  - pairing: two ends pressed together pair; a third end in the window, or a track-count mismatch, pairs none; a window that expires leaves the link unchanged.
- **Board names:** a new board gets a six-character suffix from the readable alphabet that survives re-download, import and rename; a typed name over 19 characters is an error; Add a suffix adds it once; importing as a new board offers New suffix; a different MAC on the board's Owner topic is logged as an error.
- **Expanders:** YAML for an expander sharing a PCA9685 bus and one on its own bus; a sensor on an expander pin; validation of addresses, buses and pin reuse; an expander that stops answering after start-up (a communication warning, with its pins stuck at their last value) makes its sensors and blocks read occupied; files without expanders import unchanged.
- **Checker:** finds a deliberate deadlock, and passes the one-train section starter. Checked in parts and with merged inputs, it finds exactly what a check of the whole board with every input finds. An MSS junction module passes a full check, and a route that needs a turnout both ways is reported against its junction.
- **Ease of use:**
  - Explain gives the expected sentence for each starter's masts, and changes when a rule changes
  - Run a train steps through the Block signals worked example and shows each row of its table
  - every validation and checker message names the item it is about and has a fix
  - the printable summary lists every logic-set mast and every block with its pins
  - no page label uses a spec-only term (scan, latch, interpreter, rule table, phase, resource, layer, tag).
- **Import:** round-trip of a config with `logic` through `parseConfigFromYaml`.

## Open questions

None open.

Answered:
- **Checker limits.** How many sensors and rules a board can have before the full check gives up. Measured in work item 4.5 against MSS junction modules and four-entrance sections. The numbers, the budgets and what random runs can claim are under [Checker limits](#checker-limits).
