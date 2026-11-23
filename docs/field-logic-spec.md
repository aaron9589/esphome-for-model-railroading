# Field Logic — Feature Spec (draft)

Status: draft, not built. This is the agreed design for v1 of field logic in the Board Configurator.

## Why

Today every signal mast on a board waits for JMRI/CATS to send an aspect over MQTT. Field logic lets the board run simple signalling rules itself, using the sensors, turnouts and masts already configured on that board. It keeps working when JMRI is closed or the broker is down. That is the main reason to do it on the board.

Beginners do not write rules by hand. They pick a **pattern** (a named template, such as "One-train section") and fill in its slots from dropdowns. Every pattern turns into the same rule model underneath, so the board only needs one rule engine.

## Terms

| Term | Meaning |
|---|---|
| Block | A stretch of track. Each block has one sensor |
| Sensor | A block's detector, set up on the Sensors page (stored as `blocks`) |
| Turnout | A point, set up on the Turnouts page (stored as `points`) |
| Rule | One trigger, its checks, its action, and its release |
| Pattern | A configurator template that writes one or more rules |
| Trigger block | The block a train enters to ask for a rule |
| Hold | Something a rule reserves while it is active, such as a section of track |
| Release | The event that ends a rule and frees its hold |
| Field-controlled mast | A mast in a pattern whose field logic is on. It follows the pattern's rules, and JMRI/CATS can only hold it at Stop |
| Field logic switch | A per-pattern switch on the board that turns the pattern's field logic on or off at runtime |

## Rule model

Every rule has four parts:

1. **Trigger:** a block becomes occupied.
2. **Checks:** a chain of conditions that must all be true. These are blocks clear, turnout positions (later patterns), and *no other rule holding what this rule needs*.
3. **Action:** set a mast's aspect, and optionally lock turnouts (later patterns).
4. **Hold and release:** what the action reserves, and the event that frees it.

### Lifecycle

```
            trigger + checks pass
   IDLE ─────────────────────────────▶ ACTIVE
    ▲                                    │  action applied, hold taken
    │                                    │
    │          train passes the mast     ▼
    │   (first checked block occupied)  PASSED
    │                                    │  mast back to Stop, still holding
    │            release event           │
    └────────────────────────────────────┘  hold freed, turnouts unlocked,
                                            waiting triggers re-checked

   ACTIVE ── trigger block clears before the train passes ──▶ IDLE (backed off)
```

### Trigger events

- v1: **block becomes occupied.**
- If the checks fail, the train waits. The request stays queued for as long as the trigger block stays occupied, and it is re-checked whenever something it depends on changes.
- Later: a fascia button, a turnout changing, an MQTT message.

### Release events

- v1:
  - **block clear for N seconds** (the usual one)
  - **block occupied, then clear** (the train reached the far side and has moved on)
- More than one can be combined with **all of** or **any of**.
- There is **no release timeout.** A timer that fires while a train is stalled on dirty track would free the section under it. Stuck holds are cleared by hand (see [Manual release](#manual-release)).

### Built in, not configured

- **Mast to Stop when the train passes it.** This is the "first checked block occupied" step in the lifecycle. Real signals always do this.
- **Back-off cancel.** If the trigger block clears before the train passes, the rule goes back to IDLE.
- **Boot.** Every rule starts IDLE with its masts at Stop. Holds are not saved (`restore_value: false`). A train already in a section fails the checks until it leaves.

## Pattern 1: One-train section

A stretch of track that only one train may be on at a time, with a protected entrance at each end. This covers gauntlet track, single-line bridges and tunnels, diamond crossings, two lines merging onto one, and staging throats.

### Slots

| Slot | Notes |
|---|---|
| Name | Used for the rule's topic and entity names |
| Section | One or more blocks on this board |
| Entrances | 2 to 4 |
| Release | Prefilled as "all section blocks clear for 3s"; editable |

Each entrance has:

| Field | Notes |
|---|---|
| Trigger block | The approach block for this entrance |
| Mast | The mast protecting this entrance; becomes field-controlled |
| Proceed aspect | Chosen from the mast's aspects |
| Stop aspect | Chosen from the mast's aspects |
| Trains also leave through here | Off by default. See below |

### Rules it writes

One rule per entrance. All of them share a single hold on the section.

| Part | Each entrance |
|---|---|
| Trigger | Its trigger block occupied |
| Checks | Every section block clear; section not held. Plus every *other* entrance's trigger block clear, if that entrance has "trains also leave through here" ticked |
| Action | Its mast shows Proceed; take the section hold |
| Passed | First section block occupied → mast shows Stop |
| Release | The pattern's release event → free the hold |

### Waiting order

If more than one entrance is waiting when the section is released, the one that has waited longest goes next. Ties on the same loop go to the entrance listed first. This means two entrances cannot take turns starving a third.

### "Trains also leave through here"

From occupancy alone, the board cannot tell a train waiting in a trigger block from a train leaving the section through it. Each entrance therefore says which it is.

- **Off (double-track gauntlet).** Trains come off the section onto other track, so a train that pulls into this block is always a train waiting its turn. It queues normally, even while the section is held.
- **On (single-line bridge or tunnel).** Trains leave the section through this block. When ticked:
  - This block is added to the other entrances' checks. An entrance can only clear if this block is clear, so a train waiting here goes first.
  - A train arriving here while the section is held counts as a train leaving. It cannot ask for the section until the block has cleared once.

### Worked example: gauntlet over a bridge

Blocks Left, Bridge and Right. A mast at Left/Bridge and one at Right/Bridge. Trains leave the bridge onto the other track.

| | Left entrance | Right entrance |
|---|---|---|
| Trigger | Left occupied | Right occupied |
| Checks | Bridge clear, bridge not held | Bridge clear, bridge not held |
| Action | Left mast Proceed, hold bridge | Right mast Proceed, hold bridge |
| Passed | Bridge occupied → Left mast Stop | Bridge occupied → Right mast Stop |
| Release | Bridge clear for 3s | Bridge clear for 3s |
| Trains also leave through here | Off | Off |

For a single-line bridge with the same blocks, tick "trains also leave through here" on both entrances.

## Manual release

Each pattern gets a manual release so a stuck hold (a failed detector, a stalled train) can be cleared by hand.

- **ESPHome:** a template `button` entity named `Release <pattern>`. Pressing it frees the hold, puts the mast to Stop, unlocks any route turnouts, clears any CATS hold on the pattern's masts (see [Stale holds](#stale-holds)), and re-checks waiting trains. It logs at `WARN`. Releasing with a train still in the section is the operator's call.
- **MQTT** (when MQTT is on): the board subscribes to `trains/track/turnout/logic/<pattern>/Release`, so it is a **JMRI turnout** (`MTlogic/<pattern>/Release`). `THROWN` releases. The board then publishes `CLOSED`, retained, to the same topic and ignores `CLOSED`. That snaps the JMRI turnout back like a push button, and replaces any retained `THROWN` (JMRI publishes retained), so a Release cannot fire again when the board reconnects.

## Field logic on and off

Each pattern has a **field logic switch**, so the same board can run its masts locally or leave them to JMRI/CATS. It is a runtime switch: flipping it does not need a new YAML file.

| | Field logic **on** | Field logic **off** |
|---|---|---|
| Who sets the aspect | The pattern's rules | JMRI/CATS, exactly as today |
| JMRI/CATS messages on the mast topic | Only `Held` / `Unheld` is read. `Held` shows the mast's Stop aspect; the aspect name and `Lit` / `Unlit` are ignored | Read in full (exact match, then `Unlit` dark, `Held` Stop, then aspect name) |
| Rules | Running | IDLE, holds freed |

### The switch

- **ESPHome:** a template `switch` named `Field logic - <pattern>`, saved across reboots. The configurator picks its starting value ("Starts on" / "Starts off"), used until it is first changed.
- **MQTT** (when MQTT is on): `trains/track/light/logic/<pattern>`, so it is a **JMRI light** (`MLlogic/<pattern>`). `ON` / `OFF` switch it. The board publishes its own state to the same topic, retained, so the JMRI light shows the real state after a reboot or a change on the board. It then receives its own message back, which changes nothing; a retained command on reconnect is applied the same way.
- **Switching on:** like boot. Rules start IDLE, the masts go to Stop, then the rules are evaluated.
- **Switching off:** rules go IDLE and their holds are freed. Each mast shows the last aspect JMRI/CATS sent it, or Stop if nothing has arrived.

The board always subscribes to a field-controlled mast's topic, in both modes, so it can switch either way and remembers JMRI's last aspect and hold.

### CATS hold

This is what CATS's **Hold Only** option on a signal template is for. CATS's own description: it "should only 'hold' the signal mast (toggle between STOP and whatever the SignalMast Logic wants)". With field logic on, the pattern's rules are the "whatever it wants" part.

- CATS calls `setHeld(true)` when its logic says Stop and `setHeld(false)` otherwise (`PhysicalSignal.setAspect`). JMRI publishes `<aspect>; Lit; Held` or `…; Unheld`.
- CATS still sends a real aspect on `refresh()` (when a signal's history is cleared), even in Hold Only mode, and a mast that never got an aspect publishes `null; Lit; Held`. That is why only the Held part is read.
- A **held entrance is not granted** the section. Its request stays queued and is re-checked when it is unheld.
- **Held after the grant, before the train passes:** the rule backs off (as if its trigger had cleared), the mast shows Stop, the section hold is freed, and the request stays queued. Another entrance can go meanwhile.
- **Held after the train has passed:** nothing changes; the mast is already at Stop.

### Stale holds

JMRI publishes retained, and it does not reliably say when it has gone: its last will (`track/$state` = `lost`) only fires on an unclean disconnect, and it publishes nothing on reconnect. So a `Held` left on the broker when JMRI closes **keeps the mast at Stop**. That is the fail-safe choice and matches a real dispatcher's hold. To clear it:

- unhold the signal in CATS or JMRI, or
- press `Release <pattern>` (it also clears the board's copy of the hold until JMRI sends again), or
- wipe the retained message: `mosquitto_pub -h layout-mqtt.local -t '<mast-topic>' -r -n`.

There is no expiry; a timed-out hold would also drop a real one.

## MQTT and JMRI

- A field-controlled mast keeps its signalmast topic subscription (see [Field logic on and off](#field-logic-on-and-off)). With field logic on, JMRI/CATS can only hold it.
- Field-controlled masts stay in the **JMRI XML**, because JMRI/CATS drive them whenever field logic is off.
- It publishes its current aspect to `<mast-topic>/State`, retained. This matches turnout feedback (`<turnout-topic>/State`).
- Each pattern publishes **section held** to `trains/track/sensor/logic/<pattern>/Held`, retained: `ACTIVE` while a train holds the section, `INACTIVE` when it is free. That is a **JMRI sensor** (`MSlogic/<pattern>/Held`) for a panel indicator or a CATS input.
- Each pattern also publishes `trains/track/logic/<pattern>/State` (`IDLE`, `ACTIVE` or `PASSED`), retained, and each field-controlled mast publishes its current aspect to `<mast-topic>/State`, retained. JMRI cannot read these; they are for watching in MQTTX.

### Why the topics sit under JMRI's type topics

JMRI builds every MQTT topic as Channel + type topic (`track/turnout/`, `track/light/`, `track/sensor/`) + hardware address, so a JMRI item can only reach topics under its type topic. CATS goes further: it only ever talks to JMRI items, through an `IOSpec` (a JMRI device name plus `throw` / `close`), never to raw MQTT. Putting the three controls where a JMRI turnout, light and sensor can reach them makes them usable from JMRI panels, LogixNG, and CATS. The `logic/` prefix in the address keeps them apart from the board's own turnouts and sensors.

| Control | JMRI item | Topic (channel `trains/`) | Payloads |
|---|---|---|---|
| Field logic switch | Light `MLlogic/<pattern>` | `trains/track/light/logic/<pattern>` | `ON` / `OFF`, board echoes its state |
| Release | Turnout `MTlogic/<pattern>/Release` | `trains/track/turnout/logic/<pattern>/Release` | `THROWN` releases, board resets to `CLOSED` |
| Section held | Sensor `MSlogic/<pattern>/Held` | `trains/track/sensor/logic/<pattern>/Held` | `ACTIVE` / `INACTIVE` |

### JMRI XML

The configurator's **Download JMRI XML** adds these three items for each pattern, next to the board's sensors, turnouts and masts, built the same way (system name from the part of the topic after the type topic). With MQTT off they are left out.
- Masts not used by a pattern behave exactly as they do today.
- With **Disable MQTT** ticked, field logic still runs. Only the topics above are left out; the Release button and the field logic switch entities stay. There is no JMRI hold without MQTT.

## Aspect tags

Patterns will overlap later. For example, a gauntlet entrance signal could also be the last signal in a run of block signals. To make that possible without a format change:

- Each mast aspect gets a tag: `stop`, `caution` or `clear`.
- Each pattern decides the most a mast is **allowed** to show, and the mast shows the most restrictive answer it receives.

v1 allows only one pattern per mast, but it stores the tags from the start.

**Filling the tags in.** CATS aspects get their tag automatically from the speeds in the CATS signal template (`speed` is the speed past the signal, `speed2` the speed at the next one):

| Template speeds | Tag | CATS aspects |
|---|---|---|
| `speed` is Stop | `stop` | R292, R291 |
| `speed` is Restricted, or `speed2` is Stop | `caution` | RES_NORM, RES_LIM, RES_MED, RES_SLO, R285, R281D, R286, R288 |
| anything else | `clear` | the other 20 |

The configurator needs those speeds next to `CATS_ASPECTS`. They come from the same CATS table as the template (`AspectMap.Speed`), so keep the two in step. The tag stays editable. A custom aspect has no speeds, so it starts as `stop`: an untagged aspect is treated as the most restrictive.

## Generated YAML (shape)

`<s>` is the section rule's sanitized id and `<m>` a mast id. Existing pieces (`<m>_aspect`, `<m>_show`, `<block>_sensor`) are reused; no new lamp code is needed. `<m>_aspect` holds an aspect index, `-1` for nothing shown yet, or `-2` for dark.

- `globals`, all `restore_value: false`:
  - `<s>_holder` int, `-1` when free, otherwise the holding entrance's index.
  - `<s>_phase` int: IDLE, ACTIVE or PASSED.
  - Per entrance: `<s>_e<i>_waiting_since` uint32 (`millis()` when its trigger became occupied, `0` when clear), and `<s>_e<i>_leaving` bool.
  - Per field-controlled mast: `<m>_held` bool (the Held flag from the last JMRI message) and `<m>_remote` int (the aspect JMRI last picked, `-1` if none), so switching field logic off can show it straight away.
- `script`:
  - `<s>_evaluate`, `mode: queued`. One lambda that reads the sensors and globals, moves the lifecycle on, sets each mast's `<m>_aspect`, then runs `<m>_show` for any mast whose aspect changed and publishes the State topics.
  - `<s>_release_timer`, `mode: restart`. It waits the release delay, then re-checks the release condition and releases. It is started when the release condition becomes true and stopped (`script.stop`) when it stops being true.
  - `<s>_release`. Frees the hold and runs `<s>_evaluate`. Used by the timer, the button and the MQTT topic.
- `binary_sensor`: each involved sensor adds `script.execute: <s>_evaluate` to its existing `on_press` and `on_release`.
- `button`: the template `Release <pattern>` entity.
- `switch`: the template `Field logic - <pattern>` entity, `restore_mode` from the configurator's starting value (`RESTORE_DEFAULT_ON` or `RESTORE_DEFAULT_OFF`). `turn_on_action` / `turn_off_action` run the switch-on and switch-off steps.
- `mqtt: on_message`: the Release turnout topic and the field logic light topic, when MQTT is on.
- `mqtt.publish` (retained): `CLOSED` to the Release topic after a release, the switch state to the light topic, and `ACTIVE` / `INACTIVE` to the Held sensor topic whenever the hold changes.
- `text_sensor`: field-controlled masts keep their `mqtt_subscribe`. The handler always records `<m>_held` and `<m>_remote`. With field logic off it also shows `<m>_remote` as today; with it on, a change to `<m>_held` runs `<s>_evaluate`.
- `on_boot`: run `<s>_evaluate` once after the existing startup aspect step (priority below -150), so detectors have settled.

## Configurator

- A new **Logic** page between Signal Masts and Download.
- Dropdowns list only the sensors and masts on this board.
- Sensors, masts and aspects are referenced by name or label. Renaming one updates every pattern that uses it. Deleting one marks the pattern invalid until it is fixed.
- Each aspect card on the Signal Masts page gets a Stop / Caution / Clear control for its tag (see [Aspect tags](#aspect-tags)).
- Each pattern has **Field logic starts on / off**, the switch's starting value.
- **Try it** panel: tick blocks on and off and watch the masts and the rule state change in the browser before flashing. The state machine lives in one JS module (for example `configurator/logic.js`) used by both the panel and the tests. The generated C++ lambda mirrors it, so keep it small.

### Validation

- A sensor is in at most one slot across all patterns, apart from the section sensors being shared by that section's own rules.
- Sensor and turnout names cannot start with `logic/`, so they cannot collide with the logic topics.
- A mast is in at most one pattern (v1).
- The masts on one section are all different.
- Each chosen Proceed and Stop aspect exists on its mast, and aspect labels on a field-controlled mast are unique.
- Every referenced sensor and mast exists.

### Stored format

A new optional `logic` key in the existing `esphome-mr-config:1` blob. No new file format and no version bump: an older configurator ignores the key. `normalizeConfig` fills in defaults.

```json
"logic": [
  {
    "type": "one-train-section",
    "name": "Bridge",
    "enabled": true,
    "section": ["Bridge"],
    "release": {
      "match": "all",
      "events": [{ "kind": "clear-for", "block": "Bridge", "time": "3s" }]
    },
    "entrances": [
      { "trigger": "Left",  "mast": "Left Bridge",  "proceed": "Clear", "stop": "Stop", "exitsHere": false },
      { "trigger": "Right", "mast": "Right Bridge", "proceed": "Clear", "stop": "Stop", "exitsHere": false }
    ]
  }
]
```

Release event kinds: `clear-for` (`block`, `time`) and `occupied-then-clear` (`block`). `enabled` is the field logic switch's starting value; missing means `true`.

## Tests

In `configurator/test/`, run through `configurator/package.json`:

- **Generator:** YAML structure for a two-entrance and a four-entrance section, MQTT on and off, field-controlled masts still subscribing, and the Release / light / Held topics.
- **JMRI XML:** each pattern adds `MLlogic/<pattern>`, `MTlogic/<pattern>/Release` and `MSlogic/<pattern>/Held`, and they validate against JMRI's `layout-4-19-2.xsd`; none with MQTT off.
- **State machine** (against the JS module):
  - simultaneous triggers: one grant, chosen by list order
  - a train waiting while the section is held is granted after release
  - waiting order with three entrances
  - back-off before passing
  - a detector dropout shorter than the release delay does not release
  - "trains also leave through here": a departing train does not clear its own mast
  - manual release
  - boot with a train in the section
  - a held entrance is not granted; it is granted once unheld
  - held after the grant, before passing: backs off and another entrance can go
  - a JMRI message's aspect name is ignored with field logic on (`refresh()`, `null; Lit; Held`)
  - switching off shows JMRI's last aspect; switching on starts IDLE at Stop
  - a stale hold stays at Stop until released
- **Import:** round-trip of a config with `logic` through `parseConfigFromYaml`.

## v1 scope

In:
- the rule engine
- the One-train section pattern
- manual release
- the field logic switch and CATS hold
- aspect tags
- the Logic page and Try it panel

Out:
- sensors, turnouts or masts on other boards (that would depend on the broker)
- more than one pattern per mast
- triggers other than a block becoming occupied
- approach lighting
- a raw rule editor

## Turnout locks

These decisions are for the "Lock turnouts under a train" pattern. Two of them (re-sync and the lock report) also change how today's remote Lock works, so they can ship before field logic.

### Two lock flags

- `<id>_locked` stays the **remote lock**, set by `<turnout-topic>/Lock` (`LOCKED` / `UNLOCKED`), as today.
- Field logic gets its own `<id>_field_locked` (`restore_value: false`).
- The turnout is locked while **either** is set. Fascia buttons, toggle switches and `CLOSED` / `THROWN` are ignored while locked, as today.
- So JMRI's `UNLOCKED` cannot free a turnout with a train on it, and a train clearing cannot drop a dispatcher's lock.

### Toggle switches follow on unlock

A toggle switch moved while its turnout was locked disagrees with the point. **When the turnout unlocks** (both flags clear, whether a train cleared or a remote `UNLOCKED` arrived), the point moves to match the switch straight away, through the existing queued `<id>_latch_<n>` script. The switch never lies about where the point is. Push buttons are unaffected.

This replaces today's behaviour, where unlocking does not re-sync and the point only catches up when the switch is next flipped.

### Lock report

Each turnout that can be locked (Remote lock on, or used by a locking pattern) reports its lock state:

- `trains/track/sensor/<turnout>/Locked`, retained: `ACTIVE` while either flag is set, `INACTIVE` otherwise. It is published whenever either flag changes and when MQTT connects.
- That is a **JMRI sensor** `MS<turnout>/Locked`, added to the JMRI XML.
- **CATS:** use it as the turnout's *Turnout Locked Report*. CATS then keeps the signals over those points at Stop and ignores local requests to move them (`SwitchPoints.LockReceiver`). In a CATS `IOSpec`, a sensor listened for with `close` means `ACTIVE`.
- Validation: no sensor may be named `<turnout>/Locked`.

## Later patterns

In rough priority order:

1. **Lock turnouts under a train.** A turnout is locked while its block is occupied. See [Turnout locks](#turnout-locks) for how this sits with the remote Lock topic and toggle switches.
2. **Block signals.** An ordered list of blocks and masts in one direction. A mast shows Stop if the next block is occupied, Caution if the one after is, and Clear otherwise. Rules with no hold.
3. **Route signal.** A trigger block, a mast and a route table. Each row lists turnout positions, the blocks that must be clear, and the aspect to show. The first matching row wins; no match means Stop. A turnout that is still moving (its throw script is running) counts as unknown. Optional route locking holds that row's turnouts until the release event.
4. **Level crossing.** Alternating flashing lights, optionally a gate servo, from either approach until the crossing block clears. Needs a new output type.
5. **Platform dwell.** Hold the signal at Stop for N seconds after a train arrives, then clear.

Approach lighting (mast dark unless a train is in its approach block) fits better as an option on any field-controlled mast than as a pattern of its own. The board already has a dark state for this: setting `<m>_aspect` to `-2` runs the show script's dark branch, which turns every lamp off. It was added so JMRI's `Unlit` (CATS approach lighting) goes dark, so approach lighting needs no new lamp code.

## Open questions

- **Gauntlet exits.** Confirm that trains leave the gauntlet onto the other track rather than through the Left and Right blocks. This sets the default for "trains also leave through here".
- **Boot with "trains also leave through here".** At boot, the board cannot tell whether a train sitting in such a block is waiting or has just left. v1 treats it as waiting, so its mast may clear. Treating it as leaving instead would strand a train that really is waiting.
