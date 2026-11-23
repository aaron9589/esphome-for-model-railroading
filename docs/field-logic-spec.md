# Field Logic — Feature Spec (draft)

Status: draft, not built. What ships first is decided in the implementation plan, not here.

## Why

Today every signal mast waits for JMRI/CATS to send an aspect over MQTT. Field logic lets a board run signalling rules itself, the way an interlocking does. Rules read sensors, turnouts and masts on this board, and on other boards over MQTT. Rules that read only this board keep working when JMRI is closed or the broker is down. Rules that read another board fail safe to Stop while they cannot hear it.

Rules are built in the configurator from cards, not written as code. **Starters** (such as "One-train section") fill in a set of cards to edit; after that they are ordinary rules. The configurator simulates and checks the rules before anything is flashed.

## Design principles

Field logic follows the principles of railway interlockings. Vital interlocking processors (MicroLok, SSI and the like) are PLCs at heart: a small fixed executive runs each site's logic, kept as data, on a fixed cycle. Reliability and simplicity come first. A feature that would weaken either is left out.

1. **Fail safe.** Stop is the default. A mast only clears on positive proof from known inputs. Anything unknown, lost or faulty counts as the restrictive answer. That includes a board offline, the broker gone, a turnout still moving, and a restart.
2. **Scan, don't chase events.** The board works out every rule on a fixed cycle from a snapshot of its inputs (see [Architecture](#architecture)). Nothing depends on catching an event at the right moment: every scan works the answer out again from the current inputs.
3. **Executive and data.** One fixed interpreter, the same on every board, is tested once. Each board's rules are data in a table. There is no user code, so the board cannot do anything the rule language cannot say.
4. **Small vocabulary.** Four words (*while*, *when*, *for*, *then*), three actions (show an aspect, lock turnouts, reserve a resource), and no variables, loops or arithmetic. If a layout needs something the vocabulary cannot say, the vocabulary grows on purpose, with tests. It is never opened up to code.
5. **Clear authority.** Every output has fixed writers and a fixed way of combining them: the most restrictive mast answer wins, and any lock locks. With field logic on, JMRI and CATS can only make things more restrictive (hold a mast) or clear a stuck hold, which puts its masts to Stop first. They cannot force a proceed. Turning field logic off is a deliberate change of mode, not a way round the rules: it hands the masts back to JMRI/CATS as a whole.
6. **Nothing hidden.** The Try it panel shows everything: every input, rule phase, resource, timer and latch. On the board, each resource's state, each mast's aspect and the rules' version code are published. The ESPHome log records every grant, cancel, pass and release.
7. **What you check is what runs.** The browser and the board run the same engine with the same scan. The configurator shows a version code for the rules, and the board reports the code it is running. You can see that a board has the logic you checked.
8. **Intuitive first.** Rule cards read as sentences. The layers view and the control table show who controls what. A beginner starts from a starter and edits it, and never needs to see the rule table.
9. **Check before you flash.** Simulate and check in the browser first. Checker errors block the download, like other validation errors.

## Terms

| Term | Meaning |
|---|---|
| Block | A stretch of track with one sensor |
| Sensor | A block's detector, on the Sensors page (stored as `blocks`) |
| Turnout | A point, on the Turnouts page (stored as `points`) |
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
| Field logic switch | One runtime switch per board that turns all of its rules on or off |

## Architecture

```
  inputs ─────────▶  scan, every 100 ms  ─────────────────────────▶  outputs
  sensors            1. read: snapshot of every input                 mast aspects
  turnouts           2. evaluate: interpreter over the rule table     turnout locks
  masts, holds       3. write: outputs that changed                   published state
  buttons, switch    4. publish and log what changed
```

Everything outside the scan is either an input or an output. JMRI/CATS messages, buttons, the manual release and the field logic switch are inputs. They are recorded as they arrive and acted on by the next scan. Nothing outside the scan changes a rule, a resource or an output directly.

### Inputs

Every input has a fail-safe value. The scan uses that value whenever the real one is not known.

| Input | Comes from | Read as | When not known |
|---|---|---|---|
| Sensor, this board | its detector | occupied / clear | known from the start-up scan on |
| Sensor, other board | `<sensor-topic>/State` | occupied / clear | occupied |
| Turnout, this board | its saved position, and whether a throw script is running | closed / thrown / moving | — |
| Turnout, other board | `/Thrown` and `/Moving` | closed / thrown / moving | matches neither position |
| Mast, this board | the aspect the previous scan wrote | its aspect's tag | — |
| Mast, other board | `<mast-topic>/State` | its aspect's tag | `stop` |
| Mast hold | JMRI/CATS on the mast's topic | held / unheld | stays as last received (see [Stale holds](#stale-holds)) |
| Button | a push button on a pin of this board, added on the Logic page and wired to GND like a fascia button | pressed (a moment) | — |
| Manual release | the `Release <resource>` button or its MQTT topic | pressed (a moment) | — |
| Field logic switch | the `Field logic` switch or its MQTT topic | on / off | its saved value |

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
| Published state | the scan | Each resource's Held and State, each mast's `/State`, and the version code. Sent on change |

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

More than one rule, and more than one layer, can set the same mast. Every mast aspect has a tag: `stop`, `caution` or `clear` (see [Aspect tags](#aspect-tags)).

- **Within a layer**, the first active rule in list order sets the mast. If no rule in the layer is active, the layer says Stop.
- **Across layers**, the mast shows the most restrictive answer. If two layers give different aspects with the same tag, the first layer wins and the configurator warns.
- A JMRI/CATS hold acts as one more layer that says Stop (see [CATS hold](#cats-hold)).

Each layer is a set of conditions that must all agree before a mast clears. For example, a gauntlet's entrance mast that is also the last block signal only clears when both layers allow it.

### Sharing inputs

Any number of rules and layers can read the same block. Only outputs and resources can conflict. A block may belong to only one resource, and that resource lives on one board.

## Start-up scan

The board does not start blank. Its first scan reads the field and puts the rules into the state the field implies.

- **From power-on:** with field logic on, every field-controlled mast shows its stop aspect. Its startup aspect only applies while field logic is off.
- **Waiting for detectors:** the board waits until its detectors have settled, after the existing startup aspect step. Inputs from other boards stay not known until their first message arrives.
- **The start-up scan:** an ordinary scan, except:
  - a resource with an occupied block is held and PASSED, with no holding rule. It releases through its normal release. This keeps the release delay when the train leaves.
  - rules whose trigger is already true have all waited equally long, so list order decides.
- **Toggle switches:** on a board with field logic, a toggle switch's boot move waits for the start-up scan. A turnout under a train is then locked before the switch can move it. The switch catches up when the lock clears (see [Turnout locks](#turnout-locks)).

Holds are not saved (`restore_value: false`). Turning the field logic switch on also runs a start-up scan.

## Field logic switch

One switch per board, so the same board can run its field-controlled masts locally or leave them to JMRI/CATS. Flipping it does not need a new YAML file. Masts that no rule sets are never affected.

| | Field logic **on** | Field logic **off** |
|---|---|---|
| Who sets a field-controlled mast | The rules | JMRI/CATS, exactly as today |
| JMRI/CATS messages on its topic | Only `Held` / `Unheld` is read. The aspect name and `Lit` / `Unlit` are ignored | Read in full (exact match, then `Unlit` dark, `Held` Stop, then aspect name) |
| Scan | Running | Not running. Resources are free and no rule lock is set |

- **ESPHome:** a template `switch` named `Field logic`, saved across reboots. Its starting value ("Starts on" / "Starts off") comes from the configurator and is used until the switch is first changed.
- **MQTT** (when MQTT is on): `trains/track/light/logic/<board>`, a **JMRI light** (`MLlogic/<board>`). `ON` / `OFF` switch it. The board publishes its state to the same topic, retained, so JMRI shows the real state after a reboot or a change on the board. The echo of its own message changes nothing. A retained command on reconnect is applied the same way.
- **Switching on:** the next scan is a [start-up scan](#start-up-scan).
- **Switching off:** the next scan is the last. It frees every resource, drops every rule lock, and hands each field-controlled mast back to the last aspect JMRI/CATS sent it, or Stop if nothing has arrived.

The board records every field-controlled mast's JMRI messages in both modes. That way it can switch either way and always knows JMRI's last aspect and hold.

## CATS hold

This is what CATS's **Hold Only** option on a signal template is for. CATS's own description: it "should only 'hold' the signal mast (toggle between STOP and whatever the SignalMast Logic wants)". With field logic on, the rules are the "whatever it wants" part.

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

## Remote inputs

Rules can read sensors, turnouts and masts on other boards. Rules can only set masts, lock turnouts and reserve resources on **their own board**. Two boards granting the same track at once over MQTT is a race, so there is no shared reservation. How remote inputs fail safe is in [Inputs](#inputs).

### Choosing them

- **Import a board as a reference:** load another board's `board.yaml`. Its sensors, turnouts and masts, with their aspects and tags, appear in the dropdowns under that board's name. The reference is stored in this board's config (see [Stored format](#stored-format)).
- **Type a name:** a sensor or turnout can also be typed. Its topic follows the standard syntax. A remote mast needs an imported board, because rules compare its aspect by tag.

### What each board publishes

Every board with MQTT on publishes these, field logic or not, so others can read it:

| What | Topic | Payload |
|---|---|---|
| Board online | `trains/track/sensor/board/<board>/Online`, a JMRI sensor `MSboard/<board>/Online` | `ACTIVE` as the MQTT birth message; `INACTIVE` as the will and shutdown message. Retained. `topic_prefix` is `null`, so `birth_message`, `will_message` and `shutdown_message` are set explicitly |
| Sensor state | `<sensor-topic>/State`, retained | `ACTIVE` / `INACTIVE`, on every change and on connect. The detector topic itself stays `retain: false`, so JMRI never sees a stale OCCUPIED |
| Turnout position | `trains/track/sensor/<turnout>/Thrown`, retained. Already ships as the turnout's JMRI feedback | `ACTIVE` thrown, `INACTIVE` closed. Sent on connect and when a commanded or button throw has finished, about 2s after it started |
| Turnout moving | `trains/track/sensor/<turnout>/Moving`, retained | `ACTIVE` when a throw script starts, `INACTIVE` when it finishes, and `INACTIVE` on connect. `/Thrown` only changes once the servo has finished, so without `/Moving` another board would see the old position for the whole move |
| Mast aspect | `<mast-topic>/State`, retained | The aspect name the mast shows |

With **Disable MQTT** ticked, remote inputs are a validation error.

## MQTT and JMRI

JMRI builds every MQTT topic as Channel + type topic (`track/turnout/`, `track/light/`, `track/sensor/`) + hardware address, so a JMRI item can only reach topics under its type topic. CATS only ever talks to JMRI items, through an `IOSpec` (a JMRI device name plus `throw` / `close`), never to raw MQTT. So the controls sit where a JMRI turnout, light or sensor can reach them, which makes them usable from panels, LogixNG and CATS. The `logic/` and `board/` prefixes keep them apart from the board's own items, and the board name keeps boards apart.

| Control | JMRI item | Topic (channel `trains/`) | Payloads |
|---|---|---|---|
| Field logic switch (input) | Light `MLlogic/<board>` | `trains/track/light/logic/<board>` | `ON` / `OFF`, board echoes its state |
| Release (input) | Turnout `MTlogic/<board>/<resource>/Release` | `trains/track/turnout/logic/<board>/<resource>/Release` | `THROWN` releases, board resets to `CLOSED` |
| Resource held (output) | Sensor `MSlogic/<board>/<resource>/Held` | `trains/track/sensor/logic/<board>/<resource>/Held` | `ACTIVE` / `INACTIVE`, retained |
| Board online | Sensor `MSboard/<board>/Online` | `trains/track/sensor/board/<board>/Online` | `ACTIVE` / `INACTIVE`, retained |

JMRI does not read these topics:
- `trains/track/logic/<board>/<resource>/State`: `IDLE`, `ACTIVE`, `CANCELLING` or `PASSED`, retained. For watching in MQTTX.
- `trains/track/logic/<board>/Version`: the version code of the rules the board is running, retained.
- `<mast-topic>/State`. Other boards read it as a remote input.

**Download JMRI XML** builds these items the same way as the board's own (system name from the part of the topic after the type topic). Each goes with a tick box:
- **Sensors:** the board Online sensor.
- **Turnouts:** each rule-locked turnout's `/Locked` sensor.
- **Signal Masts:** field-controlled masts, because JMRI/CATS drive them whenever field logic is off.
- **Field logic** (a new box, shown when the board has rules): the switch light, each Release turnout and each Held sensor.

CATS users can leave Field logic unticked, the same as Sensors and Turnouts: CATS makes the items its IOSpecs name. `/Moving` is for boards and is not added. With MQTT off, none of these are added.

**Disable MQTT:** field logic still runs on local inputs. The topics are left out; the release buttons and the switch entity stay. There is no JMRI hold without MQTT.

## Aspect tags

Each mast aspect has a tag: `stop`, `caution` or `clear`. Tags drive [who wins a mast](#who-wins-a-mast) and let rules read a mast by meaning, for example "while North mast is not stop".

CATS aspects get their tag automatically from the speeds in the CATS signal template (`speed` is the speed past the signal, `speed2` the speed at the next one):

| Template speeds | Tag | CATS aspects |
|---|---|---|
| `speed` is Stop | `stop` | R292, R291 |
| `speed` is Restricted, or `speed2` is Stop | `caution` | RES_NORM, RES_LIM, RES_MED, RES_SLO, R285, R281D, R286, R288 |
| anything else | `clear` | the other 20 |

The configurator needs those speeds next to `CATS_ASPECTS`. They come from the same CATS table as the template (`AspectMap.Speed`), so keep the two in step. The tag stays editable. A custom aspect has no speeds, so it starts as `stop`: an untagged aspect is treated as the most restrictive.

Each field-controlled mast has a **stop aspect**: what it shows when the rules say Stop, and from power-on. It defaults to the aspect named `R292` or `Stop`, else the first `stop`-tagged aspect, matching how `Held` is handled today.

## Turnout locks

Two things already ship with remote Lock:
- the `trains/track/sensor/<turnout>/Locked` report
- the toggle switch re-sync. When `UNLOCKED` clears a lock that was set, the `${id}_latch_<n>` script moves the point to match the switch. A repeated or retained `UNLOCKED` does nothing.

Field logic adds a second flag:

- `<id>_locked` stays the **remote lock**, set by `<turnout-topic>/Lock`.
- `<id>_field_locked` (`restore_value: false`) is the scan's lock output.
- The turnout is locked while **either** flag is set. Fascia buttons and `CLOSED` / `THROWN` are ignored while it is locked.
- The re-sync and the lock report follow the combined state. The re-sync runs only when the turnout goes from locked to unlocked. One flag clearing while the other is still set does nothing.
- So JMRI's `UNLOCKED` cannot free a turnout with a train on it, and a train clearing cannot drop a dispatcher's lock.
- A turnout a rule locks gets the lock report even without Remote lock on.

## Starters

Each starter writes one layer. These rules can be edited like any others afterwards.

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

- **Off (double-track gauntlet).** Trains come off the section onto other track. A train that pulls into this block is always waiting its turn, so it queues normally, even while the section is held.
- **On (single-line bridge or tunnel).** Trains leave the section through this block:
  - This block is added to the other entrances' checks. Another entrance can only clear if this block is clear, so a train waiting here goes first.
  - A train arriving here while the section is held counts as a train leaving. It cannot ask for the section until the block has cleared once. This is the trigger's **leaving guard** option.

**Worked example: gauntlet over a bridge.** Blocks Left, Bridge and Right. A mast at Left/Bridge and one at Right/Bridge. Trains leave the bridge onto the other track.

| | Left entrance | Right entrance |
|---|---|---|
| Trigger | while Left occupied for 0.5s | while Right occupied for 0.5s |
| Checks | none | none |
| Actions | Left mast Clear; reserve Bridge | Right mast Clear; reserve Bridge |

The Bridge resource holds the Bridge block, with the release "while Bridge clear for 3s". For a single-line bridge with the same blocks, tick "trains also leave through here" on both entrances. Each then checks that the other's trigger block is clear, with the leaving guard on.

### Lock turnouts under a train

One plain rule per turnout: while its block is occupied, lock the turnout.

### Block signals

An ordered list of blocks and masts in one direction. For each mast, the layer has two rules in this order:
1. while the next two blocks are clear → Clear
2. while the next block is clear → Caution

Neither active means Stop.

### Route signal

A trigger block, a mast and a route table. Each row is one rule in the layer, in table order:
- checks: the turnout positions and the blocks that must be clear
- action: the aspect to show.

The first active row wins; none means Stop. A moving turnout matches no row. Optional route locking makes each row a reserving rule over the route's blocks that also locks its turnouts.

### Platform dwell

Hold the signal at Stop for N seconds after a train arrives, then clear: "while Platform occupied for 30s, if Next clear → Clear".

### Level crossing

Alternating flashing lights, optionally a gate servo, from either approach until the crossing block clears. Needs a new output type, so it is not just rules.

### Approach lighting

This is a per-mast option, not a starter: the mast is dark unless a chosen block is occupied. It is applied in the scan's write step, after [who wins a mast](#who-wins-a-mast). The board already has a dark state for this. Setting `<m>_aspect` to `-2` runs the show script's dark branch, which turns every lamp off. That branch was added so JMRI's `Unlit` (CATS approach lighting) goes dark, so approach lighting needs no new lamp code.

## Configurator

- A new **Logic** page between Signal Masts and Download:
  - the board-wide **Field logic starts on / off**
  - buttons used by rules, each with its pin
  - resources, each with its blocks, its release and approach locking (off, or a time)
  - layers, each a list of rule cards
  - **Add from starter**, which writes a new layer.
- A **layers view** shows, for each mast, turnout and block, which layers read it and which set it. Overlaps are visible at a glance: masts shared across layers, locks, and blocks used by several layers.
- A **control table** view shows the same rules the way signal engineers write them: one row per mast and aspect. Its columns are the trigger, the blocks that must be clear, the turnout positions, the resource reserved, its release, approach locking and the locks. It is read-only. Edits happen on the cards.
- Dropdowns list this board's items and those of imported boards.
- Items and aspects are referenced by name. Renaming one updates every rule that uses it. Deleting one marks the rule invalid until it is fixed.
- Each aspect card on the Signal Masts page gets a Stop / Caution / Clear control for its tag. Each field-controlled mast also gets its stop aspect.

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

### Validation

- Every referenced item, aspect, button and resource exists. Remote inputs need MQTT on.
- A block is in at most one resource. Across imported boards, it is in resources on only one board.
- No cycles: a rule cannot read, directly or through other rules, a mast it sets.
- Each chosen aspect exists on its mast, and aspect labels on a field-controlled mast are unique.
- A button's pin is free, like any other pin.
- Two layers giving different aspects with the same tag on one mast: warning.
- A *when* trigger with no CANCEL: warning.
- Sensor and turnout names cannot start with `logic/` or `board/`. No sensor may be named `<sensor>/State`, `<turnout>/Thrown`, `<turnout>/Locked` or `<turnout>/Moving`. Today's configurator already rejects `/Thrown` and `/Locked`.

## Generated YAML (shape)

The YAML has two parts: the interpreter (the executive, the same text on every board) and the rule table (this board's data). The C++ interpreter mirrors `configurator/logic.js`, so what the browser checks is what the board runs. The version code is a hash of the rule table. Existing pieces (`<m>_aspect`, `<m>_show`, `<block>_sensor`) are reused, and no new lamp code is needed. `<m>_aspect` holds an aspect index, `-1` for nothing shown yet, or `-2` for dark.

- `interval: 100ms`: the [scan](#the-scan). One lambda runs the interpreter over the rule table: read, evaluate, write, publish and log. It does nothing while field logic is off.
- `globals`, all `restore_value: false`:
  - per input: its value, its two latches and, for a remote input, whether it is known
  - per resource: holder, phase, and per reserving rule its waiting-since time
  - per field-controlled mast: `<m>_held` (the Held flag from the last JMRI message) and `<m>_remote` (the aspect JMRI last picked, `-1` if none)
  - per locked turnout: `<id>_field_locked`.
- **Inputs only record; they never run rules.** These all set an input's value and latches:
  - each sensor a rule reads, from its existing `on_press` and `on_release`
  - the throw scripts, for "moving"
  - the `mqtt_subscribe` handlers
  - the rule buttons, the release buttons and the switch.
- `binary_sensor`: one per rule button, on a pull-up pin.
- `text_sensor` (`mqtt_subscribe`):
  - one per remote input, and one per board Online topic
  - field-controlled masts keep theirs. The handler always records `<m>_held` and `<m>_remote`. With field logic off it also shows `<m>_remote` as today.
- `text_sensor`: `Logic version`, the version code, also logged at boot.
- `button`: `Release <resource>` per resource. `switch`: `Field logic`, `restore_mode` `RESTORE_DEFAULT_ON` or `RESTORE_DEFAULT_OFF`.
- `mqtt`:
  - `birth_message`, `will_message` and `shutdown_message` on the Online topic
  - `on_message` for the release and switch topics
  - retained publishes of the Held, State, Version and switch topics
  - `/Moving` from each throw script, `ACTIVE` at the start and `INACTIVE` after the back-off.
- `on_boot`: field-controlled masts at their stop aspect, then the [start-up scan](#start-up-scan) after the existing startup aspect step (priority below -150). Toggle switch boot moves wait for it.

## Stored format

A new optional `logic` key in the existing `esphome-mr-config:1` blob. There is no new file format and no version bump: an older configurator ignores the key. `normalizeConfig` fills in defaults.

```json
"logic": {
  "startsOn": true,
  "remoteBoards": [
    { "name": "kiama-north", "blocks": [...], "points": [...], "signals": [...] }
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

- `approachLock` is the approach locking time. Missing means off.
- A remote item is referenced as `{ "board": "kiama-north", "block": "Up Main" }`.
- `remoteBoards` keeps just what the dropdowns and checks need: names and topics, plus each mast's aspects and tags.
- A mast's stop aspect and its aspects' tags are stored on the mast in `signals`.
- `starter` records which starter wrote a layer. It is for display only; the rules are what run.

## Tests

In `configurator/test/`, run through `configurator/package.json`:

- **Generator:**
  - YAML for a two-entrance and a four-entrance section, MQTT on and off
  - field-controlled masts still subscribing, and at their stop aspect from boot
  - the release, switch, Held, Version and Online topics, the sensor `/State` mirror, and turnout `/Moving`
  - remote input subscriptions and rule buttons
  - the same rules give the same version code, and any change to a rule changes it.
- **JMRI XML:** adds `MLlogic/<board>`, `MTlogic/<board>/<resource>/Release`, `MSlogic/<board>/<resource>/Held` and `MSboard/<board>/Online`, validating against JMRI's `layout-4-19-2.xsd`. Each follows its tick box. The Release turnout has no `/Thrown` feedback. None with MQTT off.
- **Scan** (against `logic.js`):
  - a pulse shorter than a scan is still seen, including "occupied, then clear" inside one scan
  - two rules wanting the same resource in one scan: one grant, to the longest waiting, then list order
  - outputs and publishes happen only on change, and all again on connect
  - a manual release, a hold and the switch take effect at the next scan.
- **Rules:**
  - a waiting rule is granted after release, and waiting order with three entrances
  - cancel before passing; a trigger flicker shorter than its *for* neither starts nor cancels a request
  - approach locking: off frees at once; on holds for the time, then frees; a block occupied during that time goes to PASSED; manual release ends it
  - a detector dropout shorter than the release delay does not release
  - the leaving guard: a departing train does not clear its own mast
  - who wins a mast: first active rule within a layer, most restrictive across layers
  - the two lock flags: the re-sync runs only when both are clear, not when one of two clears.
- **Fail safe:**
  - the start-up scan with a train in the section (held, PASSED, releases after the delay), and with all clear
  - a toggle switch's boot move waits for the start-up scan, so a turnout under a train stays put
  - remote inputs not known before the first message, and while their board is offline, count as occupied / neither position / Stop
  - a moving turnout, local or remote, matches neither position
  - a held mast is not granted until unheld; held after the grant, before passing, cancels it so another rule can go
  - with field logic on, a JMRI message's aspect name is ignored (`refresh()`, `null; Lit; Held`)
  - a stale hold stays at Stop until released
  - switching off hands masts to JMRI's last aspect; switching on runs a start-up scan.
- **Checker:** finds a deliberate deadlock, and passes the one-train section starter.
- **Import:** round-trip of a config with `logic` through `parseConfigFromYaml`.

## Open questions

- **Gauntlet exits.** Confirm that trains leave the gauntlet onto the other track rather than through the Left and Right blocks. This sets the default for "trains also leave through here".
- **Start-up with the leaving guard.** At start-up, the board cannot tell whether a train in such a block is waiting or has just left. The draft treats it as waiting, so its mast may clear. Treating it as leaving instead would strand a train that really is waiting.
- **Shipping the interpreter.** It could be inlined into `board.yaml` (still one file, but long), or be an ESPHome `external_components` entry pulled from this repo at compile time (short YAML, but the build needs GitHub).
- **Proving the C++ matches the JS.** Recorded input sequences, with the expected outputs scan by scan, kept as data. The JS tests replay them now, and an on-board test could replay the same files later.
- **Checker limits.** How many sensors and rules a board can have before the full check gives up.
- **Board publishes.** The Online sensor, the sensor `/State` mirror and turnout `/Moving` are changes for every board, with or without field logic. They could ship on their own first, as remote Lock did.
