# Engine cases

Shared test cases for the logic engine: the JS engine (`configurator/logic.js`, work item 2.2) and the C++ core (`engine-tests/`, 2.3) must both pass every one. Each file is one board and one timeline: inputs in, expected state out, scan by scan.

The expected values are **worked out by hand from the spec** ([field-logic-spec.md](../../../docs/field-logic-spec.md)), never by running an engine. A case that an engine fails is a bug in the engine or a question about the spec, never something to regenerate. `test/engine-cases.test.js` checks that every case refers only to things its board has, and that every Scan, Rules and Fail safe bullet in the spec's Tests section is covered by at least one case.

## A case

```json
{
  "name": "gauntlet: a waiting rule is granted after release",
  "covers": ["<a Tests bullet from the spec, word for word>"],
  "about": "What the timeline shows, in a sentence or two.",
  "board": { ... },
  "start": { ... },
  "steps": [
    { "at": 1, "do": [{ "sensor": "Left", "is": "occupied" }] },
    { "at": 6, "expect": { "masts": { "Left Bridge": "R281" } } }
  ]
}
```

### `board`

| Key | What |
|---|---|
| `sensors` | this board's sensors, by name |
| `turnouts` | this board's turnouts, by name |
| `masts` | this board's masts: `{ "<name>": { "aspects": { "<aspect>": "<tag>" }, ... } }` |
| `remote` | other boards: `{ "<board>": { "sensors": [], "blocks": [], "turnouts": [], "masts": {} } }` |
| `logic` | the Logic page, in the spec's [Stored format](../../../docs/field-logic-spec.md#stored-format): `blocks`, `buttons`, `resources`, `layers` |

A mast has:
- `aspects`, in order, each with its tag (`stop`, `restricting`, `approach`, `advance`, `clear`).
- `diverging` (optional): the aspects marked diverging.
- `stop` (optional): its stop aspect. Default: the aspect named `R292` or `Stop`, else the first `stop` aspect (spec, Aspect tags).
- `states` (optional): `{ "<aspect>": ["<JMRI message>", ...] }`, the strings that match the aspect exactly. Default `["<aspect>; Lit; Unheld"]`, what the configurator writes for a CATS aspect.
- `startup` (optional): the aspect shown from power-on while logic is off.

A mast that some rule's `then` names is **field-controlled**. Any other mast on the board is driven by JMRI/CATS, and rules read the aspect JMRI last sent it.

Wherever a block is named (`"block": "Bridge"`, a resource's `blocks`), a sensor's name works too: a sensor is a block of one.

### Rules

As in the spec's Stored format, with these shapes:

- **Condition** (a state, read by *while*): `{ "block": "Left", "is": "occupied" | "clear" }`, `{ "sensor": … }`, `{ "turnout": "P1", "is": "closed" | "thrown" }`, `{ "mast": "Home", "is": "<tag>" | ["<tag>", …] | "diverging" }`, `{ "button": "Depart", "is": "pressed" }`. Add `"board": "<name>"` for another board's item. Combine with `{ "all": [ … ] }`, `{ "any": [ … ] }`, `{ "not": … }`.
- **Moment** (a change, read by *when* and *then*): the same shapes. `"is": "occupied"` means *went* occupied, and `"is": "pressed"` means was pressed.
- **Trigger:** `{ "while": <condition>, "for": "0.5s", "leavingGuard": true }`, or `{ "when": <moment>, "then": [<moment>, …] }`. `for` and `leavingGuard` are optional.
- **Checks:** a list of conditions, all of which must hold.
- **Then:** `{ "mast": "Left Bridge", "aspect": "R281", "reserve": "Bridge", "lock": ["P1"] }`. Each part is optional.
- **Cancel** (a *when* trigger only): `{ "when": <moment> }`.
- **Resource:** `{ "name": "Bridge", "blocks": ["Bridge"], "release": <trigger>, "approachLock": "10s" }`. `approachLock` is optional (off).

A rule is named `<layer>/<n>`, with *n* counted from 1 in its layer: `Gauntlet/2`.

### `start`

The field at power-on, before the first scan. Everything is optional.

| Key | Default |
|---|---|
| `logic` | `"on"` |
| `broker` | `"connected"` (connected at time 0) |
| `sensors` | `{ "<name>": "occupied" }`; others clear |
| `turnouts` | `{ "<name>": "thrown" }`; others closed |
| `jmri` | `{ "<mast>": "<message>" }`: the retained JMRI message each mast has; others none |
| `remote` | `{ "<board>": { "online": true, "sensors": {}, "turnouts": {}, "masts": {} } }`; anything not listed is not known |
| `remoteLocks` | `{ "<turnout>": "locked" }`; others unlocked |

### `steps`

Each step is `{ "at": n, "do": [ … ], "expect": { … } }`, with `at` going up. Scan *n* runs at time *n* × 100 ms; scan 0 is the start-up scan. The `do` events happen after scan *n* − 1 and before scan *n*, in the order listed. Scans with no step still run. `expect` is checked after scan *n* (with logic off there are no scans, and `expect` is checked after the events).

**Events** (`do`):

| Event | Meaning |
|---|---|
| `{ "sensor": "Left", "is": "occupied" \| "clear" }` | a detector on this board changes |
| `{ "button": "Depart", "is": "pressed" \| "released" }` | a rule button |
| `{ "turnout": "P1", "is": "closed" \| "thrown" \| "moving" }` | this board's turnout; `moving` while a throw script runs |
| `{ "remoteLock": "P1", "is": "locked" \| "unlocked" }` | `LOCKED` / `UNLOCKED` on the turnout's Lock topic |
| `{ "jmri": "<mast>", "message": "R281; Lit; Unheld" }` | a message on a mast's topic |
| `{ "release": "<resource>", "via": "button" \| "mqtt" }` | a manual release press: the `Release` button, or `THROWN` on its topic |
| `{ "logic": "on" \| "off" }` | the logic switch |
| `{ "broker": "connected" \| "disconnected" }` | this board's MQTT connection |
| `{ "board": "south", "online": true \| false }` | that board's Online topic |
| `{ "board": "south", "sensor": "S1", "is": "occupied" \| "clear" \| "unknown" }` | its `/State` (`unknown`: an empty message). `"block"` the same |
| `{ "board": "south", "turnout": "T1", "is": "closed" \| "thrown" \| "moving" \| "unknown" }` | its `/Thrown` and `/Moving` |
| `{ "board": "south", "mast": "Home", "aspect": "R281" }` | its `/State`; `""` is not known |

**Expect** (each key checks only the items it lists):

| Key | Value |
|---|---|
| `logic` | `"on"` or `"off"` |
| `masts` | `{ "<mast>": "<aspect>" \| "dark" \| null }`; `null` means nothing shown yet |
| `rules` | `{ "<layer>/<n>": "idle" \| "waiting" \| "active" \| "passed" \| "cancelling" }` |
| `resources` | `{ "<name>": "IDLE" \| "ACTIVE" \| "PASSED" \| "CANCELLING" }`, the resource's published State |
| `holders` | `{ "<resource>": "<layer>/<n>" \| null }` |
| `locks` | `{ "<turnout>": true \| false }`: the field lock (`<id>_field_locked`) |
| `locked` | `{ "<turnout>": true \| false }`: field lock or remote lock |
| `events` | the exact list of what this scan logged, in order |
| `writes` | the exact list of outputs this scan wrote |
| `publishes` | the exact list of what this scan published |

`events`:
- `{ "startup": true }`
- `{ "grant": "<resource>", "rule": "<layer>/<n>" }`
- `{ "cancel": "<resource>", "rule": "<layer>/<n>" }`
- `{ "pass": "<resource>", "rule": "<layer>/<n>" \| null }`, with `null` for a resource held at start-up
- `{ "release": "<resource>", "by": "release" \| "cancel" \| "time" \| "manual" \| "switch" }`
- `{ "ignored": "release", "resource": "<resource>" }`: an MQTT release in the first 5 seconds after connecting
- `{ "resync": "<turnout>" }`: the turnout went from locked (either flag) to unlocked.

`writes`: `{ "mast": "<mast>", "aspect": "<aspect>" | "dark" }` and `{ "lock": "<turnout>", "on": true | false }`.

`publishes`: `{ "resource": "<name>", "held": "ACTIVE" | "INACTIVE" }`, `{ "resource": "<name>", "state": "<State>" }`, `{ "release": "<resource>", "value": "CLOSED" }`.

## How a scan works, exactly

These are the spec's rules made exact enough to write expected values. Where the spec does not say, the choice made here is marked **(decided)**, so that it can be reviewed.

1. **Timing.** Scan *n* is at *n* × 100 ms. An event in `do` is recorded at scan *n*'s time.
2. **Values and latches.** Each input keeps its value and two latches: went on, went off since the last scan. *while* reads the value at the scan. *when* and *then* read the latches, which each scan clears after reading. A sensor that went occupied and back to clear between two scans has both latches set and reads clear, so it went occupied, then clear, in that order.
3. **for on a trigger** works both ways. Let *r* be the first scan of the current unbroken run of scans in which the state holds. The trigger becomes true at the first scan *n* with (*n* − *r*) × 100 ms ≥ the time: `0.5s` is 5 scans. Once true, it becomes false only after the state has failed for the same time, counted the same way. A state that holds for fewer scans never counts, and a gap shorter than the time never cancels.
4. **for on a release or check** only delays becoming true. It is false as soon as the state fails.
5. **Waiting since.** A rule's waiting time runs from the first scan of the current unbroken run in which its trigger (after *for*) is true, whatever its phase. A *when* trigger's request is latched at the scan of the moment and stays until granted or cancelled. A rule cancelled by a hold keeps its waiting time **(decided:** the spec times waiting "from the scan that first saw its trigger true", and its trigger has not stopped**)**.
6. **Evaluate order** within a scan:
   1. start-up or switch-off work, then manual releases, in resource order;
   2. each rule in list order (layers in order, rules in order): cancel, then passed, then approach locking, then release;
   3. each free resource in list order: grant it to the waiting rule with the earliest waiting time; on a tie, the rule listed first. Once per resource per scan;
   4. work out the outputs (who wins), then the turnout locks.

   `events` come out in that order.
7. **Free** means no holder, not held from start-up, and every block clear. A resource is not granted in the scan in which it was manually released.
8. **Passed.** An ACTIVE or CANCELLING rule goes to PASSED in the first scan in which one of its resource's blocks is occupied, or went occupied since the last scan.
9. **Release** is armed only while PASSED. A *while* release is true when its state has held for its *for*. A *then* release counts moments from the grant onwards. Passed and release can happen in the same scan.
10. **Cancel.** A *while* trigger cancels an ACTIVE rule when it becomes false (honouring *for*). With approach locking off, the resource is freed at once (`release … by cancel`). With it on, the rule is CANCELLING: the mast is at Stop, the resource stays held, its locks stay. It ends with `release … by time` once the time has passed since the cancel scan, unless a block is occupied first (PASSED) or it is released by hand.
11. **Active.** A plain rule is active in a scan where its trigger and checks are true. A reserving rule is active only while ACTIVE: waiting, PASSED and CANCELLING rules do not set their mast. A reserving rule holds its turnout locks while ACTIVE, PASSED or CANCELLING.
12. **Who wins.** For each field-controlled mast and each layer whose rules set it: the first active rule in list order, else that layer says the stop aspect. Across layers, the most restrictive tag wins; between two aspects with the same tag, the first layer. A hold is one more layer saying the stop aspect.
13. **Reading masts.** A rule reads this board's field-controlled masts as the previous scan wrote them; before the start-up scan they show their stop aspect. A JMRI-driven mast reads the aspect today's handler picks from its last JMRI message, at this scan. A mast with nothing shown, or dark, reads `stop` **(decided:** the spec gives no value; Stop is the fail-safe one**)**. Another board's mast reads its `/State` aspect's tag, or `stop` when not known or not one of its aspects.
14. **Not known.** Another board's item is known once its first message has come, while its board's Online is `ACTIVE`, and while this board is connected to the broker. Not known: a sensor or block is occupied, a turnout is in neither position, a mast is `stop`. A turnout `moving`, here or there, is in neither position.
15. **Holds.** With logic on, a field-controlled mast's message is read only for its hold: held if it contains `; Held`. A held mast shows its stop aspect. A reserving rule that sets a held mast is not granted. An ACTIVE rule whose mast becomes held is cancelled back to waiting (rule 10). Holds stay until JMRI sends again, or a manual release of a resource whose rules set the mast.
16. **Manual release.** In the next scan: the resource is freed (`release … by manual`, logged even if it was free **(decided:** a press is always logged at `WARN`**)**), its rules' turnouts are unlocked, the holds on the masts its rules set are cleared, and those masts show Stop that scan. An MQTT release (`via: mqtt`) in the first 5 seconds after this board connects is ignored instead (`ignored`). Either way `CLOSED` is published.
17. **Logic switch.** Switching off: the next scan is the last. It frees every resource (`release … by switch`), drops the field locks, and each field-controlled mast shows what today's handler picks from the last JMRI message it got, or its stop aspect if none. While off, there are no scans: a JMRI message changes the mast at once, exactly as today. Switching on: the next scan is a start-up scan, with every field-controlled mast starting at its stop aspect.
18. **Today's handler** (logic off, and JMRI-driven masts): an exact match on one of an aspect's `states` wins; otherwise a message containing `; Unlit` is dark; otherwise one containing `; Held` shows the aspect named `R292` or `Stop` (dark if there is none); otherwise the name before the first `;`, with trailing spaces removed, picks the first aspect with that name; otherwise the message is ignored.
19. **Start-up scan.** An ordinary scan, except: a resource with an occupied block is held and PASSED with no holder (`pass … rule null`), and releases through its release; no leaving guard is set. *for* timers start at the start-up scan, so rules whose trigger is already true all become true together and list order decides **(decided:** the board cannot know how long a detector was occupied before power-on**)**. The scan logs `{ "startup": true }` first. A board waits for this scan before a toggle switch's boot move.
20. **Leaving guard.** A trigger with `leavingGuard` is guarded from a scan in which its block is occupied but was clear at the previous scan, if its resource is held at that moment, that is, as the previous scan left it: a release pressed before the same scan acts only at the scan, after the train arrived. While guarded it counts as false. The guard lifts at the first scan in which the block is clear.
21. **Locks.** `locks` is the field lock: any active lock rule, or a holding reserving rule, locks. `locked` is the field lock or the remote lock. When `locked` goes from true to false, the scan logs `resync`: that is when the board moves a toggle-switch turnout to match its switch. One flag clearing while the other is set does nothing, and nor does a repeated `UNLOCKED`.
22. **Writes and publishes** happen only on change, from the end of one scan to the end of the next. On a broker connect (including at start), the next scan publishes every resource's Held and State. Nothing is published while disconnected. Order: masts in board order, then locks in turnout order; resources in list order, Held before State, then release echoes.

## Which case covers which bullet

| Spec bullet (Tests) | Cases |
|---|---|
| Scan: a pulse shorter than a scan | `scan-short-pulses` |
| Scan: two rules wanting the same resource in one scan | `scan-same-scan-grant` |
| Scan: outputs and publishes only on change, all again on connect | `scan-publish-on-change` |
| Scan: release, hold and switch at the next scan; release waiting at connect | `scan-next-scan`, `scan-release-at-connect` |
| Scan: logic off behaves as today | `scan-logic-off-equivalence` |
| Rules: granted after release, waiting order with three entrances | `rules-waiting-order` |
| Rules: cancel before passing; flicker shorter than *for* | `rules-cancel-and-flicker` |
| Rules: approach locking | `rules-approach-locking-off`, `-time`, `-overrun`, `-manual` |
| Rules: detector dropout shorter than the release delay | `rules-detector-dropout` |
| Rules: the leaving guard | `rules-leaving-guard` |
| Rules: who wins a mast | `rules-who-wins` |
| Rules: block signals | `blocksig-worked-example`, `blocksig-tumbledown-advance`, `blocksig-tumbledown-no-advance`, `blocksig-approach-diverging`, `blocksig-remote-offline`, `blocksig-turnout-in-block` |
| Rules: the two lock flags | `rules-two-lock-flags` |
| Fail safe: start-up with a train in the section, and all clear | `failsafe-startup-train`, `failsafe-startup-clear` |
| Fail safe: toggle switch boot move waits | `failsafe-toggle-boot-wait` |
| Fail safe: remote inputs not known | `failsafe-remote-not-known` |
| Fail safe: a moving turnout matches neither position | `failsafe-moving-turnout` |
| Fail safe: held mast not granted; held after grant cancels | `failsafe-hold-grant` |
| Fail safe: with logic on, the aspect name is ignored | `failsafe-hold-aspect-ignored` |
| Fail safe: a stale hold stays at Stop until released | `failsafe-stale-hold` |
| Fail safe: start-up counts a leaving-guard train as waiting | `failsafe-startup-leaving-guard` |
| Fail safe: switching off and on | `failsafe-switch-off-on` |
