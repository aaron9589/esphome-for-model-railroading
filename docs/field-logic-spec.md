# Field Logic — Feature Spec (draft)

Status: draft, not built. This is the agreed design for v1 of field logic in the Board Configurator.

## Why

Today every signal mast on a board waits for JMRI/CATS to send an aspect over MQTT. Field logic lets the board run simple signalling rules itself, using the detectors, points and masts already configured on that board. It keeps working when JMRI is closed or the broker is down. That is the main reason to do it on the board.

Beginners do not write rules by hand. They pick a **pattern** (a named template, such as "One-train section") and fill in its slots from dropdowns. Every pattern turns into the same rule model underneath, so the board only needs one rule engine.

## Terms

| Term | Meaning |
|---|---|
| Rule | One trigger, its checks, its action, and its release |
| Pattern | A configurator template that writes one or more rules |
| Trigger block | The block a train enters to ask for a rule |
| Hold | Something a rule reserves while it is active, such as a section of track |
| Release | The event that ends a rule and frees its hold |
| Field-controlled mast | A mast driven by field logic instead of by JMRI |

## Rule model

Every rule has four parts:

1. **Trigger:** a block becomes occupied.
2. **Checks:** a chain of conditions that must all be true. These are blocks clear, point positions (later patterns), and *no other rule holding what this rule needs*.
3. **Action:** set a mast's aspect, and optionally lock points (later patterns).
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
    └────────────────────────────────────┘  hold freed, points unlocked,
                                            waiting triggers re-checked

   ACTIVE ── trigger block clears before the train passes ──▶ IDLE (backed off)
```

### Trigger events

- v1: **block becomes occupied.**
- If the checks fail, the train waits. The request stays queued for as long as the trigger block stays occupied, and it is re-checked whenever something it depends on changes.
- Later: a fascia button, a point changing, an MQTT message.

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

Each rule gets a manual release so a stuck hold (a failed detector, a stalled train) can be cleared by hand.

- **ESPHome:** a template `button` entity named `Release <rule>`. Pressing it frees the hold, puts the mast to Stop, unlocks any route points, and re-checks waiting trains. It logs at `WARN`. Releasing with a train still in the section is the operator's call.
- **MQTT** (when MQTT is on): the board subscribes to `trains/track/logic/<rule>/Release`. Any non-empty payload releases. The board then publishes an empty retained message to the same topic to wipe any retained copy, and ignores empty payloads. JMRI can publish retained, and without the wipe a retained Release would fire again every time the board reconnects. A JMRI MQTT turnout pointed at this topic works as a panel button.

## MQTT and JMRI

- A field-controlled mast **stops subscribing** to its signalmast topic, so JMRI cannot fight the logic.
- It publishes its current aspect to `<mast-topic>/State`, retained. This matches turnout feedback (`<turnout-topic>/State`).
- Each rule publishes `trains/track/logic/<rule>/State` (`IDLE`, `ACTIVE` or `PASSED`), retained, so a panel can show who holds the section.
- Masts not used by a pattern behave exactly as they do today.
- With **Disable MQTT** ticked, field logic still runs. Only the topics above are left out; the Release button entity stays.

## Aspect tags

Patterns will overlap later. For example, a gauntlet entrance signal could also be the last signal in a run of block signals. To make that possible without a format change:

- Each mast aspect gets a tag: `stop`, `caution` or `clear`.
- Each pattern decides the most a mast is **allowed** to show, and the mast shows the most restrictive answer it receives.

v1 allows only one pattern per mast, but it stores the tags from the start.

## Generated YAML (shape)

`<s>` is the section rule's sanitized id and `<m>` a mast id. Existing pieces (`<m>_aspect`, `<m>_show`, `<block>_sensor`) are reused; no new lamp code is needed.

- `globals`, all `restore_value: false`:
  - `<s>_holder` int, `-1` when free, otherwise the holding entrance's index.
  - `<s>_phase` int: IDLE, ACTIVE or PASSED.
  - Per entrance: `<s>_e<i>_waiting_since` uint32 (`millis()` when its trigger became occupied, `0` when clear), and `<s>_e<i>_leaving` bool.
- `script`:
  - `<s>_evaluate`, `mode: queued`. One lambda that reads the sensors and globals, moves the lifecycle on, sets each mast's `<m>_aspect`, then runs `<m>_show` for any mast whose aspect changed and publishes the State topics.
  - `<s>_release_timer`, `mode: restart`. It waits the release delay, then re-checks the release condition and releases. It is started when the release condition becomes true and stopped (`script.stop`) when it stops being true.
  - `<s>_release`. Frees the hold and runs `<s>_evaluate`. Used by the timer, the button and the MQTT topic.
- `binary_sensor`: each involved detector adds `script.execute: <s>_evaluate` to its existing `on_press` and `on_release`.
- `button`: the template `Release <rule>` entity.
- `mqtt: on_message`: the Release topic, when MQTT is on.
- `text_sensor`: no `mqtt_subscribe` for field-controlled masts.
- `on_boot`: run `<s>_evaluate` once after the existing startup aspect step (priority below -150), so detectors have settled.

## Configurator

- A new **Logic** tab between Signals and Download.
- Dropdowns list only the blocks and masts on this board.
- Blocks, masts and aspects are referenced by name or label. Renaming one updates every pattern that uses it. Deleting one marks the pattern invalid until it is fixed.
- The Signals tab gets the Stop / Caution / Clear tag on each aspect.
- **Try it** panel: tick blocks on and off and watch the masts and the rule state change in the browser before flashing. The state machine lives in one JS module (for example `configurator/logic.js`) used by both the panel and the tests. The generated C++ lambda mirrors it, so keep it small.

### Validation

- A block is in at most one slot across all patterns, apart from the section blocks being shared by that section's own rules.
- A mast is in at most one pattern (v1).
- The masts on one section are all different.
- Each chosen Proceed and Stop aspect exists on its mast, and aspect labels on a field-controlled mast are unique.
- Every referenced block and mast exists.

### Stored format

A new optional `logic` key in the existing `esphome-mr-config:1` blob. No new file format and no version bump: an older configurator ignores the key. `normalizeConfig` fills in defaults.

```json
"logic": [
  {
    "type": "one-train-section",
    "name": "Bridge",
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

Release event kinds: `clear-for` (`block`, `time`) and `occupied-then-clear` (`block`).

## Tests

In `configurator/test/`, run through `configurator/package.json`:

- **Generator:** YAML structure for a two-entrance and a four-entrance section, MQTT on and off, and field-controlled masts no longer subscribing.
- **State machine** (against the JS module):
  - simultaneous triggers: one grant, chosen by list order
  - a train waiting while the section is held is granted after release
  - waiting order with three entrances
  - back-off before passing
  - a detector dropout shorter than the release delay does not release
  - "trains also leave through here": a departing train does not clear its own mast
  - manual release
  - boot with a train in the section
- **Import:** round-trip of a config with `logic` through `parseConfigFromYaml`.

## v1 scope

In:
- the rule engine
- the One-train section pattern
- manual release
- aspect tags
- the Logic tab and Try it panel

Out:
- blocks, points or masts on other boards (that would depend on the broker)
- more than one pattern per mast
- triggers other than a block becoming occupied
- approach lighting
- a raw rule editor

## Later patterns

In rough priority order:

1. **Lock points under a train.** A point is locked while its block is occupied. It reuses the existing `<point>_locked` global.
2. **Block signals.** An ordered list of blocks and masts in one direction. A mast shows Stop if the next block is occupied, Caution if the one after is, and Clear otherwise. Rules with no hold.
3. **Route signal.** A trigger block, a mast and a route table. Each row lists point positions, the blocks that must be clear, and the aspect to show. The first matching row wins; no match means Stop. A point that is still moving (its throw script is running) counts as unknown. Optional route locking holds that row's points until the release event.
4. **Level crossing.** Alternating flashing lights, optionally a gate servo, from either approach until the crossing block clears. Needs a new output type.
5. **Platform dwell.** Hold the signal at Stop for N seconds after a train arrives, then clear.

Approach lighting (mast dark unless a train is in its approach block) fits better as an option on any field-controlled mast than as a pattern of its own.

## Open questions

- **Gauntlet exits.** Confirm that trains leave the gauntlet onto the other track rather than through the Left and Right blocks. This sets the default for "trains also leave through here".
- **Boot with "trains also leave through here".** At boot, the board cannot tell whether a train sitting in such a block is waiting or has just left. v1 treats it as waiting, so its mast may clear. Treating it as leaving instead would strand a train that really is waiting.
