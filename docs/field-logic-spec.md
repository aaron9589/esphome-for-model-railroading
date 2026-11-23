# Field Logic — Feature Spec (draft)

Status: draft, not built. What ships first is decided in the implementation plan, not here.

## Why

Today every signal mast waits for JMRI/CATS to send an aspect over MQTT. Field logic lets a board run signalling rules itself. Rules read sensors, turnouts and masts on this board, and on other boards over MQTT. Rules that read only this board keep working when JMRI is closed or the broker is down. Rules that read another board fail safe to Stop while they cannot hear it.

Rules are built in the configurator from cards, not written as code. **Starters** (such as "One-train section") fill in a set of cards to edit; after that they are ordinary rules.

## Terms

| Term | Meaning |
|---|---|
| Block | A stretch of track with one sensor |
| Sensor | A block's detector, on the Sensors page (stored as `blocks`) |
| Turnout | A point, on the Turnouts page (stored as `points`) |
| Input | Anything a rule reads: a sensor, a turnout's position, a mast's aspect, a button |
| Remote input | An input that belongs to another board, read over MQTT |
| Resource | Track that only one rule may reserve at a time, such as a single-line section. It has blocks, a release, and a waiting queue |
| Rule | A trigger, checks and actions (see [Rules](#rules)) |
| Layer | A named group of rules, usually what one starter wrote. Layers are how the Logic page shows who controls what |
| Starter | A configurator template that writes a layer of editable rules |
| Field-controlled mast | A mast that at least one rule sets. Other masts on the board stay with JMRI/CATS exactly as today |
| Field logic switch | One runtime switch per board that turns all of its rules on or off |

## Language

Every part of a rule uses the same four words:

| Word | Meaning | Example |
|---|---|---|
| **while** | a state, true for as long as it holds | while Left occupied |
| **when** | a moment (a change) | when Release is pressed |
| **for** | how long a *while* must hold before it counts | while Bridge clear for 3s |
| **then** | moments in order | when Far occupied, then clear |

States can be negated and combined with **all of** or **any of**. A *for* on a trigger also stops a detector flicker from cancelling a request.

## Rules

A rule card reads top to bottom:

| Part | Form | Example |
|---|---|---|
| Trigger | **WHILE** or **WHEN** | while Left occupied for 0.5s |
| Checks | **IF**: *while* states, all must be true | if Right clear |
| Actions | **THEN**: show an aspect, lock turnouts, reserve a resource | Left mast shows Clear; reserve Bridge |
| Cancel | **CANCEL**: only for a *when* trigger | when the button is pressed again |

### Plain rules

A rule that does not reserve a resource is active while its trigger and checks are true. While it is active, its actions apply: its mast aspect counts and its turnouts are locked. When it stops being active, they stop applying. A plain rule has no lifecycle and no release. Block signals and turnout locks are plain rules.

### Reserving rules

A rule that reserves a resource has a lifecycle:

```
         trigger + checks true, resource free, first in queue
   IDLE ──────────────────────────────────────────────────▶ ACTIVE
    ▲                                                         │ aspect shown, resource held,
    │                                                         │ turnouts locked
    │             when a resource block becomes occupied      ▼
    │                                                       PASSED
    │                                                         │ mast back to Stop, still holding
    │               resource's release                        │
    └─────────────────────────────────────────────────────────┘ resource freed, turnouts unlocked,
                                                                waiting rules re-checked

   ACTIVE ── cancel (trigger no longer true) ──▶ IDLE
```

- **Waiting.** If a rule's trigger is true but it cannot be granted, it waits. It is re-checked whenever something it reads changes.
- **Free** means no rule holds the resource and all its blocks are clear.
- **Waiting order.** When a resource is freed, the rule that has waited longest goes next. If two have waited equally long, the one listed first goes. Two rules cannot take turns starving a third.
- **Passed.** The train has gone past the mast. The mast goes back to Stop, as a real signal does. The resource stays held.
- **Cancel.** A *while* trigger cancels itself when it stops being true, honouring its *for*. Example: Left's mast clears, then the train backs out of Left before reaching Bridge. Without cancel, the mast would stay at Proceed and Bridge would stay held for a train that has gone, because the release only starts once the train has passed. A *when* trigger latches its request until it is granted. It cancels only through its CANCEL part, if it has one. Once granted, only the release or a manual release ends it.
- **Release** belongs to the resource, so every rule that reserves it shares one release. The release is a *while* (usually "all blocks clear for 3s") or a *then* sequence. It is only armed once the rule is PASSED. Moments are counted from the grant onwards.
- There is **no release timeout.** A timer that fires while a train is stalled on dirty track would free the section under it. Stuck holds are cleared by hand (see [Manual release](#manual-release)).

### Who wins a mast

More than one rule, and more than one layer, can set the same mast. Every mast aspect has a tag: `stop`, `caution` or `clear` (see [Aspect tags](#aspect-tags)).

- **Within a layer**, the first active rule in list order sets the mast. If no rule in the layer is active, the layer says Stop.
- **Across layers**, the mast shows the most restrictive answer. If two layers give different aspects with the same tag, the first layer wins and the configurator warns.
- A CATS hold acts as one more layer that says Stop (see [CATS hold](#cats-hold)).

Each layer is a set of conditions that must all agree before a mast clears. For example, a gauntlet's entrance mast that is also the last block signal only clears when both layers allow it.

Turnout locks combine with **any of**: a turnout is locked if any active rule locks it.

### Sharing inputs

Any number of rules and layers can read the same block. Only outputs (masts, locks) and resources can conflict. A block may belong to only one resource, and that resource lives on one board.

## Boot and switching on

On boot the board reads the field and puts the rules into the state the field implies, instead of starting blank:

1. Wait until the detectors have settled, after the existing startup aspect step. Remote inputs stay unknown until their first message arrives (see [Remote inputs](#remote-inputs)).
2. A resource with an occupied block is held and PASSED, with no holding rule. It releases through its normal release. This keeps the release delay when the train leaves.
3. A resource with all blocks clear is free.
4. Plain rules (block signals, turnout locks) are worked out from the current inputs.
5. Rules whose trigger is already true join the waiting queue in list order.
6. Field-controlled masts start at Stop, then show what the rules give.

Holds are not saved (`restore_value: false`). Turning the field logic switch on follows the same steps.

## Field logic switch

One switch per board, so the same board can run its field-controlled masts locally or leave them to JMRI/CATS. Flipping it does not need a new YAML file. Masts that no rule sets are never affected.

| | Field logic **on** | Field logic **off** |
|---|---|---|
| Who sets a field-controlled mast | The rules | JMRI/CATS, exactly as today |
| JMRI/CATS messages on its topic | Only `Held` / `Unheld` is read. The aspect name and `Lit` / `Unlit` are ignored | Read in full (exact match, then `Unlit` dark, `Held` Stop, then aspect name) |
| Rules | Running | Stopped, resources freed, locks from rules dropped |

- **ESPHome:** a template `switch` named `Field logic`, saved across reboots. Its starting value ("Starts on" / "Starts off") comes from the configurator and is used until the switch is first changed.
- **MQTT** (when MQTT is on): `trains/track/light/logic/<board>`, a **JMRI light** (`MLlogic/<board>`). `ON` / `OFF` switch it. The board publishes its state to the same topic, retained, so JMRI shows the real state after a reboot or a change on the board. The echo of its own message changes nothing. A retained command on reconnect is applied the same way.
- **Switching on:** as at boot.
- **Switching off:** each field-controlled mast shows the last aspect JMRI/CATS sent it, or Stop if nothing has arrived.

The board subscribes to every field-controlled mast's topic in both modes. That way it can switch either way and always knows JMRI's last aspect and hold.

## CATS hold

This is what CATS's **Hold Only** option on a signal template is for. CATS's own description: it "should only 'hold' the signal mast (toggle between STOP and whatever the SignalMast Logic wants)". With field logic on, the rules are the "whatever it wants" part.

- CATS calls `setHeld(true)` when its logic says Stop and `setHeld(false)` otherwise (`PhysicalSignal.setAspect`). JMRI publishes `<aspect>; Lit; Held` or `…; Unheld`.
- CATS still sends a real aspect on `refresh()` (when a signal's history is cleared), even in Hold Only mode. A mast that never got an aspect publishes `null; Lit; Held`. That is why only the Held part is read.
- A held mast shows Stop, whatever the rules say.
- A reserving rule that sets a held mast is **not granted**. Its request keeps waiting and is re-checked when the mast is unheld.
- **Held after the grant, before the train passes:** the rule is cancelled back to waiting, and the resource is freed for another rule.
- **Held after the train has passed:** nothing changes; the mast is already at Stop.

### Stale holds

JMRI publishes retained, and it does not reliably say when it has gone. Its last will (`track/$state` = `lost`) only fires on an unclean disconnect, and it publishes nothing on reconnect. So a `Held` left on the broker when JMRI closes **keeps the mast at Stop**. That is the fail-safe choice, and it matches a real dispatcher's hold. To clear it:

- unhold the signal in CATS or JMRI, or
- press the resource's manual release (it also clears the board's copy of the hold on the masts its rules set, until JMRI sends again), or
- wipe the retained message: `mosquitto_pub -h layout-mqtt.local -t '<mast-topic>' -r -n`.

There is no expiry, because a timed-out hold would also drop a real one.

## Manual release

Each resource has a manual release, so a stuck hold (a failed detector, a stalled train) can be cleared by hand. It frees the resource, puts its masts to Stop, unlocks its turnouts, clears the CATS hold copy (above), and re-checks waiting rules. It logs at `WARN`. Releasing with a train still in the section is the operator's call.

- **ESPHome:** a template `button` named `Release <resource>`.
- **MQTT** (when MQTT is on): `trains/track/turnout/logic/<board>/<resource>/Release`, a **JMRI turnout** (`MTlogic/<board>/<resource>/Release`). `THROWN` releases. The board then publishes `CLOSED`, retained, to the same topic and ignores `CLOSED`. That snaps the JMRI turnout back like a push button. It also replaces any retained `THROWN` (JMRI publishes retained), so a release cannot fire again when the board reconnects.

## Remote inputs

Rules can read sensors, turnouts and masts on other boards. Rules can only set masts, lock turnouts and reserve resources on **their own board**. Two boards granting the same track at once over MQTT is a race, so there is no shared reservation.

### Choosing them

- **Import a board as a reference:** load another board's `board.yaml`. Its sensors, turnouts and masts, with their aspects and tags, appear in the dropdowns under that board's name. The reference is stored in this board's config (see [Stored format](#stored-format)).
- **Type a name:** a sensor or turnout can also be typed. Its topic follows the standard syntax. A remote mast needs an imported board, because rules compare its aspect by tag.

### What each board publishes

Every board with MQTT on publishes these, field logic or not, so others can read it:

| What | Topic | Payload |
|---|---|---|
| Board online | `trains/track/sensor/board/<board>/Online`, a JMRI sensor `MSboard/<board>/Online` | `ACTIVE` as the MQTT birth message; `INACTIVE` as the will and shutdown message. Retained. `topic_prefix` is `null`, so `birth_message`, `will_message` and `shutdown_message` are set explicitly |
| Sensor state | `<sensor-topic>/State`, retained | `ACTIVE` / `INACTIVE`, on every change and on connect. The detector topic itself stays `retain: false`, so JMRI never sees a stale OCCUPIED |
| Turnout position | `trains/track/sensor/<turnout>/Thrown`, retained (the turnout position report) | `ACTIVE` thrown, `INACTIVE` closed |
| Mast aspect | `<mast-topic>/State`, retained | The aspect name the mast shows |

### Unknown inputs

A remote input is **unknown** until its first message arrives. It also becomes unknown while its board's Online sensor is `INACTIVE`, and while this board is disconnected from the broker. Unknown is restrictive:

- a sensor counts as occupied
- a turnout matches neither position
- a mast counts as `stop`.

With **Disable MQTT** ticked, remote inputs are a validation error.

## MQTT and JMRI

JMRI builds every MQTT topic as Channel + type topic (`track/turnout/`, `track/light/`, `track/sensor/`) + hardware address, so a JMRI item can only reach topics under its type topic. CATS only ever talks to JMRI items, through an `IOSpec` (a JMRI device name plus `throw` / `close`), never to raw MQTT. So the controls sit where a JMRI turnout, light or sensor can reach them, which makes them usable from panels, LogixNG and CATS. The `logic/` and `board/` prefixes keep them apart from the board's own items, and the board name keeps boards apart.

| Control | JMRI item | Topic (channel `trains/`) | Payloads |
|---|---|---|---|
| Field logic switch | Light `MLlogic/<board>` | `trains/track/light/logic/<board>` | `ON` / `OFF`, board echoes its state |
| Release | Turnout `MTlogic/<board>/<resource>/Release` | `trains/track/turnout/logic/<board>/<resource>/Release` | `THROWN` releases, board resets to `CLOSED` |
| Resource held | Sensor `MSlogic/<board>/<resource>/Held` | `trains/track/sensor/logic/<board>/<resource>/Held` | `ACTIVE` / `INACTIVE`, retained |
| Board online | Sensor `MSboard/<board>/Online` | `trains/track/sensor/board/<board>/Online` | `ACTIVE` / `INACTIVE`, retained |

Two topics are for watching in MQTTX only; JMRI does not read them:
- `trains/track/logic/<board>/<resource>/State`: `IDLE`, `ACTIVE` or `PASSED`, retained
- `<mast-topic>/State`.

- **Download JMRI XML** adds the logic and board items above, built the same way as the board's own items (system name from the part of the topic after the type topic). Field-controlled masts stay in the XML, because JMRI/CATS drive them whenever field logic is off. With MQTT off, none of these are added.
- **Disable MQTT:** field logic still runs on local inputs. The topics are left out; the release buttons and the switch entity stay. There is no JMRI hold without MQTT.

## Aspect tags

Each mast aspect has a tag: `stop`, `caution` or `clear`. Tags drive [who wins a mast](#who-wins-a-mast) and let rules read a mast by meaning, for example "while North mast is not stop".

CATS aspects get their tag automatically from the speeds in the CATS signal template (`speed` is the speed past the signal, `speed2` the speed at the next one):

| Template speeds | Tag | CATS aspects |
|---|---|---|
| `speed` is Stop | `stop` | R292, R291 |
| `speed` is Restricted, or `speed2` is Stop | `caution` | RES_NORM, RES_LIM, RES_MED, RES_SLO, R285, R281D, R286, R288 |
| anything else | `clear` | the other 20 |

The configurator needs those speeds next to `CATS_ASPECTS`. They come from the same CATS table as the template (`AspectMap.Speed`), so keep the two in step. The tag stays editable. A custom aspect has no speeds, so it starts as `stop`: an untagged aspect is treated as the most restrictive.

Each field-controlled mast has a **stop aspect**: what it shows when the rules say Stop. It defaults to the aspect named `R292` or `Stop`, else the first `stop`-tagged aspect, matching how `Held` is handled today.

## Turnout locks

Re-syncing toggle switches on unlock, and the `trains/track/sensor/<turnout>/Locked` report, already ship with remote Lock. Field logic adds a second flag:

- `<id>_locked` stays the **remote lock**, set by `<turnout-topic>/Lock`.
- Rules lock through their own `<id>_field_locked` (`restore_value: false`).
- The turnout is locked while **either** flag is set. The lock report, the re-sync on unlock, and the ignored fascia buttons and `CLOSED` / `THROWN` all follow the combined state.
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

The first active row wins; none means Stop. A turnout that is still moving (its throw script is running) matches neither position. Optional route locking makes each row a reserving rule over the route's blocks that also locks its turnouts.

### Platform dwell

Hold the signal at Stop for N seconds after a train arrives, then clear: "while Platform occupied for 30s, if Next clear → Clear".

### Level crossing

Alternating flashing lights, optionally a gate servo, from either approach until the crossing block clears. Needs a new output type, so it is not just rules.

### Approach lighting

This is a per-mast option, not a starter: the mast is dark unless a chosen block is occupied. The board already has a dark state for this. Setting `<m>_aspect` to `-2` runs the show script's dark branch, which turns every lamp off. That branch was added so JMRI's `Unlit` (CATS approach lighting) goes dark, so approach lighting needs no new lamp code.

## Configurator

- A new **Logic** page between Signal Masts and Download.
  - The board-wide **Field logic starts on / off**.
  - Resources, each with its blocks and release.
  - Layers, each a list of rule cards.
  - **Add from starter** writes a new layer.
- A **layers view** shows, for each mast, turnout and block, which layers read it and which set it. Overlaps are visible at a glance: masts shared across layers, locks, and blocks used by several layers.
- Dropdowns list this board's items and those of imported boards.
- Items and aspects are referenced by name. Renaming one updates every rule that uses it. Deleting one marks the rule invalid until it is fixed.
- Each aspect card on the Signal Masts page gets a Stop / Caution / Clear control for its tag. Each field-controlled mast also gets its stop aspect.

### Checking in the browser

The rule engine is one JS module (for example `configurator/logic.js`), used by the Try it panel, the checker and the tests.

- **Try it:** tick inputs on and off (remote ones too, including unknown), let timers run or skip them, and watch the masts, locks, rule states and resources.
- **Checker:** explores every reachable state of the board's rules. Each timer is treated as an "elapsed" event that can happen at any point. It reports:
  - a waiting rule that can never be granted (deadlock), or that can be passed over forever (starvation)
  - a rule that can never become active
  - a mast that can never leave Stop.
- If a board has too many states to explore fully, the checker says so and falls back to random runs. It only proves what the model expresses. Resources make "only one train on this track" true by construction. They cannot tell whether two masts lead onto the same track unless a resource says so.

### Validation

- Every referenced item, aspect and resource exists. Remote inputs need MQTT on.
- A block is in at most one resource. Across imported boards, it is in resources on only one board.
- No cycles: a rule cannot read, directly or through other rules, a mast it sets.
- Each chosen aspect exists on its mast, and aspect labels on a field-controlled mast are unique.
- Two layers giving different aspects with the same tag on one mast: warning.
- A *when* trigger with no CANCEL: warning.
- Sensor and turnout names cannot start with `logic/` or `board/`. No sensor may be named `<sensor>/State`, `<turnout>/Thrown` or `<turnout>/Locked`.

## Generated YAML (shape)

The rules go into the YAML as data (a table), run by one fixed interpreter. The C++ interpreter mirrors `configurator/logic.js`, so what the browser checks is what the board runs. Existing pieces (`<m>_aspect`, `<m>_show`, `<block>_sensor`) are reused, and no new lamp code is needed. `<m>_aspect` holds an aspect index, `-1` for nothing shown yet, or `-2` for dark.

- `globals`, all `restore_value: false`:
  - per resource: holder, phase, and per reserving rule its waiting-since time
  - per field-controlled mast: `<m>_held` (the Held flag from the last JMRI message) and `<m>_remote` (the aspect JMRI last picked, `-1` if none)
  - per remote input: its value and whether it is known
  - per locked turnout: `<id>_field_locked`.
- `script: logic_evaluate`, `mode: queued`: runs the interpreter, sets `<m>_aspect` and runs `<m>_show` for masts that changed, applies locks, and publishes what changed.
- *for* timers are deadlines checked by an `interval` that runs `logic_evaluate` only while a timer is pending.
- `binary_sensor`: each sensor a rule reads adds `script.execute: logic_evaluate` to its existing `on_press` and `on_release`.
- `text_sensor` (`mqtt_subscribe`):
  - one per remote input, and one per board Online topic
  - field-controlled masts keep theirs. The handler always records `<m>_held` and `<m>_remote`. With field logic off it shows `<m>_remote` as today; with it on, a change to `<m>_held` runs `logic_evaluate`.
- `button`: `Release <resource>` per resource. `switch`: `Field logic`, `restore_mode` `RESTORE_DEFAULT_ON` or `RESTORE_DEFAULT_OFF`.
- `mqtt`:
  - `birth_message`, `will_message` and `shutdown_message` on the Online topic
  - `on_message` for the release and switch topics
  - retained publishes of the Held, State and switch topics.
- `on_boot`: the [boot steps](#boot-and-switching-on), after the existing startup aspect step (priority below -150).

## Stored format

A new optional `logic` key in the existing `esphome-mr-config:1` blob. There is no new file format and no version bump: an older configurator ignores the key. `normalizeConfig` fills in defaults.

```json
"logic": {
  "startsOn": true,
  "remoteBoards": [
    { "name": "kiama-north", "blocks": [...], "points": [...], "signals": [...] }
  ],
  "resources": [
    { "name": "Bridge", "blocks": ["Bridge"],
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

- A remote item is referenced as `{ "board": "kiama-north", "block": "Up Main" }`.
- `remoteBoards` keeps just what the dropdowns and checks need: names and topics, plus each mast's aspects and tags.
- A mast's stop aspect and its aspects' tags are stored on the mast in `signals`.

## Tests

In `configurator/test/`, run through `configurator/package.json`:

- **Generator:**
  - YAML for a two-entrance and a four-entrance section, MQTT on and off
  - field-controlled masts still subscribing
  - the release, switch, Held and Online topics, and the sensor `/State` mirror
  - remote input subscriptions.
- **JMRI XML:** adds `MLlogic/<board>`, `MTlogic/<board>/<resource>/Release`, `MSlogic/<board>/<resource>/Held` and `MSboard/<board>/Online`, validating against JMRI's `layout-4-19-2.xsd`. None with MQTT off.
- **Engine** (against `logic.js`):
  - simultaneous triggers: one grant, chosen by list order
  - a waiting rule is granted after release, and waiting order with three entrances
  - cancel before passing, and a trigger flicker shorter than its *for* does not cancel
  - a detector dropout shorter than the release delay does not release
  - the leaving guard: a departing train does not clear its own mast
  - manual release
  - boot: with a train in the section (held, PASSED, releases after the delay), and with all clear
  - a held mast is not granted until unheld; held after the grant, before passing, cancels it so another rule can go
  - with field logic on, a JMRI message's aspect name is ignored (`refresh()`, `null; Lit; Held`)
  - switching off shows JMRI's last aspect; switching on follows the boot steps
  - a stale hold stays at Stop until released
  - who wins a mast: first active rule within a layer, most restrictive across layers
  - remote inputs: unknown before the first message and while the board is offline counts as occupied / Stop
  - the two lock flags.
- **Checker:** finds a deliberate deadlock, and passes the one-train section starter.
- **Import:** round-trip of a config with `logic` through `parseConfigFromYaml`.

## Open questions

- **Gauntlet exits.** Confirm that trains leave the gauntlet onto the other track rather than through the Left and Right blocks. This sets the default for "trains also leave through here".
- **Boot with the leaving guard.** At boot, the board cannot tell whether a train in such a block is waiting or has just left. The draft treats it as waiting, so its mast may clear. Treating it as leaving instead would strand a train that really is waiting.
- **Shipping the interpreter.** It could be inlined into `board.yaml` (still one file, but long), or be an ESPHome `external_components` entry pulled from this repo at compile time (short YAML, but the build needs GitHub).
- **Checker limits.** How many sensors and rules a board can have before the full check gives up.
- **Sensor `/State` mirror.** It is a change for every board, with or without field logic, so it could ship on its own first.
