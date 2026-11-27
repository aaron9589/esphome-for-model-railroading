# Engine cases

Shared test cases for the logic engine: the JS engine (`configurator/logic.js`, work item 2.2) and the C++ core (`engine-tests/`, 2.3) must both pass every one. Each file is one board and one timeline: inputs in, expected state out, scan by scan. A [multi-board case](#multi-board-cases) is several boards wired by their plant ends, with one timeline.

The expected values are **worked out by hand from the spec** ([field-logic-spec.md](../../../docs/field-logic-spec.md)), never by running an engine. A case that an engine fails is a bug in the engine or a question about the spec, never something to regenerate. `test/engine-cases.test.js` checks that every case refers only to things its board has, and that every Scan, Rules, Fail safe and Plant ends bullet in the spec's Tests section is covered by at least one case.

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
| `logic` | the Logic page, in the spec's [Stored format](../../../docs/field-logic-spec.md#stored-format): `blocks`, `buttons`, `resources`, `layers`, `ends`. A block may give its neighbouring blocks, `next`, for where a train came from (rule 31). A layer with `"routes": true` is one signal's routes: its reserving *when* rules share one request (rule 5) |

A mast has:
- `aspects`, in order, each with its tag (`stop`, `restricting`, `approach`, `advance`, `clear`).
- `diverging` (optional): the aspects marked diverging.
- `stop` (optional): its stop aspect. Default: the aspect named `R292` or `Stop`, else the first `stop` aspect (spec, Aspect tags).
- `states` (optional): `{ "<aspect>": ["<JMRI message>", ...] }`, the strings that match the aspect exactly. Default `["<aspect>; Lit; Unheld"]`, what the configurator writes for a CATS aspect.
- `startup` (optional): the aspect shown from power-on while logic is off.

A mast that some rule's `then` names is **field-controlled**. Any other mast on the board is driven by JMRI/CATS, and rules read the aspect JMRI last sent it.

Wherever a block is named (`"block": "Bridge"`, a resource's `blocks`), a sensor's name works too: a sensor is a block of one.

A [plant end](../../../docs/field-logic-spec.md#plant-ends) is `{ "name": "A", "tracks": [ … ] }` in `logic.ends`, its tracks in order, numbered from 1, left to right looking out through the end. A track is one of:
- `{ "sensors": ["Home in"], "mast": "Home" }`: its end sensors, and the first mast facing inward (a mast on this board, real or virtual);
- `{ "sensors": [], "through": { "end": "B", "track": 2 } }`: a pass-through to track 2 of end B.

`sensors` are this board's sensors, not blocks **(decided:** the spec says sensors, and a block could hold what the end hears, which an end must never offer back**)**. Either key may be left out. An end's `pairPin` and `ledPin` are for the board, not the engine. Its link is not in `board`: it lives on the board (see `start` and the events).

### Rules

As in the spec's Stored format, with these shapes:

- **Condition** (a state, read by *while*): `{ "block": "Left", "is": "occupied" | "clear" }`, `{ "sensor": … }`, `{ "turnout": "P1", "is": "closed" | "thrown" }`, `{ "mast": "Home", "is": "<tag>" | ["<tag>", …] | "diverging" }`, `{ "button": "Depart", "is": "pressed" }`. Add `"board": "<name>"` for another board's item. Combine with `{ "all": [ … ] }`, `{ "any": [ … ] }`, `{ "not": … }`.
- **What a plant end hears:** `{ "end": "A", "track": 1, "hears": "block", "is": "occupied" | "clear" }` and `{ "end": "A", "track": 1, "hears": "mast", "is": "<tag>" | ["<tag>", …] }`. A heard Mast is a tag only, so `"is": "diverging"` is never true there. In a block's `sensors`, `{ "end": "A", "track": 1 }` is the Block that track hears **(decided:** the spec gives `{ "end": "A", "track": 1 }` and no way to say which of the two values; `hears` says it, because `clear` is both a block state and a tag**)**.
- **The Auto/Manual switch** (a condition): `{ "auto": "on" | "off" }`. **A hold** (a condition): `{ "mast": "Home", "is": "held" | "unheld" }`, what JMRI's last message said of a field mast's hold (rule 30); no message yet is neither.
- **Moment** (a change, read by *when* and *then*): the same shapes. `"is": "occupied"` means *went* occupied, and `"is": "pressed"` means was pressed. Also:
  - `{ "mast": "Home", "is": "held" | "unheld" }`: the hold changed (rule 30);
  - `{ "block": "Left", "is": "occupied", "notFrom": ["Bridge"] }`: a train entered, and not from those blocks (rule 31);
  - `{ "any": [<moment>, …] }`: any of them happened;
  - on any moment, `"if": <condition>` counts it only while that condition holds, and `"for": "1s"` only once its state has then held that long (rule 32).
- **Trigger:** `{ "while": <condition>, "for": "0.5s", "leavingGuard": true }`, or `{ "when": <moment>, "then": [<moment>, …] }`. `for` and `leavingGuard` are optional. `leavingGuard` is `true` (it watches the rule's own resources) or a list of the resources it watches.
- **Checks:** a list of conditions, all of which must hold.
- **Then:** `{ "mast": "Left Bridge", "aspect": "R281", "reserve": "Bridge", "lock": ["P1"] }`. Each part is optional. `reserve` is a resource or a list of them, taken all at once (a track plan's move and its pieces). A name with no resource is left out, and each is taken once. A lock is a turnout, held while the rule holds anything, or `{ "turnout": "P1", "with": "Bridge" }`, held only while the rule holds that resource (one it does not take makes it the rule's). `next` gives, for each resource, the blocks its train must be seen going into before it is freed: `{ "Bridge": ["Right"] }` (sequential release, rule 9).
- **Cancel** (a *when* trigger only): `{ "when": <moment> }`. **Withdraw** (likewise): `{ "when": <moment> }`, which takes back a request still waiting but leaves a granted rule alone.
- **Approach locking of its own** (a rule): `"approachLock": { "block": "Left", "for": "10s" }`, in place of its resources' `approachLock` (rule 10).
- **Resource:** `{ "name": "Bridge", "blocks": ["Bridge"], "release": <trigger>, "approachLock": "10s" }`. `approachLock` is optional (off).

A rule is named `<layer>/<n>`, with *n* counted from 1 in its layer: `Gauntlet/2`.

### `start`

The field at power-on, before the first scan. Everything is optional.

| Key | Default |
|---|---|
| `logic` | `"on"` |
| `auto` | `"on"`: the Auto/Manual switch |
| `broker` | `"connected"` (connected at time 0) |
| `sensors` | `{ "<name>": "occupied" }`; others clear |
| `turnouts` | `{ "<name>": "thrown" }`; others closed |
| `jmri` | `{ "<mast>": "<message>" }`: the retained JMRI message each mast has; others none |
| `remote` | `{ "<board>": { "online": true, "sensors": {}, "turnouts": {}, "masts": {} } }`; anything not listed is not known |
| `remoteLocks` | `{ "<turnout>": "locked" }`; others unlocked |
| `board` | this board's name, as in its topics; default `""` |
| `links` | `{ "<end>": "<board>/<end>" \| "end" \| "" }`, each end's saved link; others empty |

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
| `{ "auto": "on" \| "off" }` | the Auto/Manual switch |
| `{ "releaseGroup": "<group>", "via": "button" \| "mqtt" }` | **Release** for a group's routes (rule 33) |
| `{ "broker": "connected" \| "disconnected" }` | this board's MQTT connection |
| `{ "board": "south", "online": true \| false }` | that board's Online topic |
| `{ "board": "south", "sensor": "S1", "is": "occupied" \| "clear" \| "unknown" }` | its `/State` (`unknown`: an empty message). `"block"` the same |
| `{ "board": "south", "turnout": "T1", "is": "closed" \| "thrown" \| "moving" \| "unknown" }` | its `/Thrown` and `/Moving` |
| `{ "board": "south", "mast": "Home", "aspect": "R281" }` | its `/State`; `""` is not known |
| `{ "end": "A", "link": "south/B" \| "end" \| "" }` | this end's link is set: on the board's web page, or on its `Link` topic |
| `{ "end": "A", "theirLink": "mid/A" }` | the linked end's `Link` topic; `""` is not known |
| `{ "end": "A", "online": true \| false }` | the linked board's Online topic |
| `{ "end": "A", "track": 2, "block": "occupied" \| "clear" \| "unknown" }` | the linked end's track 2 `Block`, numbered as **that** end numbers it |
| `{ "end": "A", "track": 2, "mast": "<tag>" }` | its `Mast`; anything but one of the five tags is not known |
| `{ "end": "A", "pair": "pressed" }` | Pair is pressed for end A: its button on the web page, or its pin |
| `{ "pairing": "south/B/2" }` | an announcement heard on `trains/track/end/pairing` |

**Expect** (each key checks only the items it lists):

| Key | Value |
|---|---|
| `logic` | `"on"` or `"off"` |
| `auto` | `"on"` or `"off"` |
| `masts` | `{ "<mast>": "<aspect>" \| "dark" \| null }`; `null` means nothing shown yet |
| `rules` | `{ "<layer>/<n>": "idle" \| "waiting" \| "active" \| "passed" \| "cancelling" }` |
| `resources` | `{ "<name>": "IDLE" \| "ACTIVE" \| "PASSED" \| "CANCELLING" }`, the resource's published State |
| `holders` | `{ "<resource>": "<layer>/<n>" \| null }` |
| `locks` | `{ "<turnout>": true \| false }`: the field lock (`<id>_field_locked`) |
| `locked` | `{ "<turnout>": true \| false }`: field lock or remote lock |
| `events` | the exact list of what this scan logged, in order |
| `writes` | the exact list of outputs this scan wrote |
| `publishes` | the exact list of what this scan published |
| `ends` | `{ "<end>": "pairing" \| "empty" \| "end" \| "unheard" \| "disagrees" \| "heard" }` (rule 26) |
| `links` | `{ "<end>": "<link>" }` |

`events`:
- `{ "startup": true }`
- `{ "grant": "<resource>", "rule": "<layer>/<n>" }`
- `{ "cancel": "<resource>", "rule": "<layer>/<n>" }`
- `{ "pass": "<resource>", "rule": "<layer>/<n>" \| null }`, with `null` for a resource held at start-up
- `{ "release": "<resource>", "by": "release" \| "cancel" \| "time" \| "left" \| "manual" \| "switch" }`
- `{ "ignored": "release", "resource": "<resource>" }`: an MQTT release in the first 5 seconds after connecting; `{ "ignored": "releaseGroup", "group": "<group>" }` likewise
- `{ "releaseGroup": "<group>" }`: Release pressed for a group (`WARN`), before what it frees
- `{ "resync": "<turnout>" }`: the turnout went from locked (either flag) to unlocked.
- `{ "pairing": "<end>", "result": "paired", "with": "<board>/<end>" }`, or `"result": "crowded" | "tracks" | "alone"` (rule 28). `paired` is logged at `INFO`, the others at `WARN`
- `{ "disagrees": "<end>", "link": "<board>/<end>", "theirs": "<their link>" }`: the end's state became `disagrees` (`WARN`).

`writes`: `{ "mast": "<mast>", "aspect": "<aspect>" | "dark" }` and `{ "lock": "<turnout>", "on": true | false }`.

`publishes`: `{ "resource": "<name>", "held": "ACTIVE" | "INACTIVE" }`, `{ "resource": "<name>", "state": "<State>" }`, `{ "release": "<resource>", "value": "CLOSED" }`, `{ "releaseGroup": "<group>", "value": "CLOSED" }`, and for plant ends `{ "pairing": "<board>/<end>/<tracks>" }`, `{ "end": "<end>", "link": "<link>" }`, `{ "end": "<end>", "track": n, "block": "ACTIVE" | "INACTIVE" }`, `{ "end": "<end>", "track": n, "mast": "<tag>" }`.

## How a scan works, exactly

These are the spec's rules made exact enough to write expected values. Where the spec does not say, the choice made here is marked **(decided)**, so that it can be reviewed.

1. **Timing.** Scan *n* is at *n* × 100 ms. An event in `do` is recorded at scan *n*'s time.
2. **Values and latches.** Each input keeps its value and two latches: went on, went off since the last scan. *while* reads the value at the scan. *when* and *then* read the latches, which each scan clears after reading. A sensor that went occupied and back to clear between two scans has both latches set and reads clear, so it went occupied, then clear, in that order.
3. **for on a trigger** works both ways. Let *r* be the first scan of the current unbroken run of scans in which the state holds. The trigger becomes true at the first scan *n* with (*n* − *r*) × 100 ms ≥ the time: `0.5s` is 5 scans. Once true, it becomes false only after the state has failed for the same time, counted the same way. A state that holds for fewer scans never counts, and a gap shorter than the time never cancels.
4. **for on a release or check** only delays becoming true. It is false as soon as the state fails.
5. **Waiting since.** A rule's waiting time runs from the first scan of the current unbroken run in which its trigger (after *for*) is true, whatever its phase. A *when* trigger's request is latched at the scan of the moment and stays until granted, cancelled or withdrawn. A rule cancelled by a hold keeps its waiting time **(decided:** the spec times waiting "from the scan that first saw its trigger true", and its trigger has not stopped**)**.

   **A reserving *when* rule's request**, each scan, once every rule's trigger has been read: a *withdraw* moment takes back a request still waiting. Then a *cancel* moment with something to cancel (a request still waiting, or the rule ACTIVE) takes the request back, cancels the ACTIVE rule (rule 10), and takes this scan's own asking moment with it; a cancel with nothing to cancel lets this scan's asking moment ask **(decided:** so one button can ask and cancel, and a cancel always wins over what it cancels**)**. A routes group's reserving *when* rules share **one request**, made, cancelled and withdrawn by any of their moments: the first of them granted uses it up for all, so a signal sets one route each time it is asked for, the one its turnouts are set for. A cancel by a hold puts the request back for all of them.
6. **Evaluate order** within a scan:
   1. start-up or switch-off work, then manual releases, in resource order;
   2. every rule's trigger, in list order (layers in order, rules in order); the requests (rule 5); then each reserving rule in list order: passed, then cancel, then approach locking, then release **(decided:** passed before cancel, so a cancel in the scan its train enters frees nothing: a CATS hold comes as its train passes**)**. A rule with several resources does each step for each resource it holds, in the order it names them;
   3. grants: the waiting rules, earliest waiting time first, then the rule listed first. A rule is granted when every one of its resources is free and not wanted by a rule before it in this order, which keeps them; it takes them all, or none. Then `grant` is logged for each resource granted, in resource list order;
   4. work out the outputs (who wins), then the turnout locks.

   `events` come out in that order.
7. **Free** means no holder, not held from start-up, and every block clear. A resource is not granted in the scan in which it was manually released.
8. **Passed.** A resource its rule holds is passed in the first scan in which one of its blocks is occupied, or went occupied since the last scan (`pass`, once per resource). Its rule is PASSED from the first **(decided:** a rule with several resources keeps checking each of them while PASSED, since its train reaches them one after another**)**.
9. **Release** is armed only for a passed resource. A *while* release is true when its state has held for its *for*. A *then* release counts moments from the grant onwards. Passed and release can happen in the same scan. A rule that holds none of its resources is idle again. **Sequential release:** a resource for which the rule's `next` gives blocks is freed only once one of them has also gone occupied, in the scan it passed or later **(decided:** went occupied, not was occupied, so another train already standing there is no proof that this one went on**)**; with none given, as before.
10. **Cancel.** A *while* trigger cancels an ACTIVE rule when it becomes false (honouring *for*). Each resource it holds logs `cancel`; with approach locking off, it is freed at once (`release … by cancel`, right after its `cancel`). With it on, the rule is CANCELLING: the mast is at Stop, the resource stays held, its locks stay. It ends with `release … by time` once its own time has passed since the cancel scan, unless one of the rule's resources is passed first (the rule is PASSED, and nothing is freed by time from then on) or it is released by hand. A *when* trigger cancels by its cancel (rule 5). A rule with **approach locking of its own** holds its resources only if its block is occupied at the cancel, for its own time, and frees them at once (`release … by left`) when that block is clear.
11. **Active.** A plain rule is active in a scan where its trigger and checks are true. A reserving rule is active only while ACTIVE: waiting, PASSED and CANCELLING rules do not set their mast. A reserving rule holds its turnout locks while ACTIVE, PASSED or CANCELLING.
12. **Who wins.** For each field-controlled mast and each layer whose rules set it: the first active rule in list order, else that layer says the stop aspect. Across layers, the most restrictive tag wins; between two aspects with the same tag, the first layer. A hold is one more layer saying the stop aspect.
13. **Reading masts.** A rule reads this board's field-controlled masts as the previous scan wrote them; before the start-up scan they show their stop aspect. A JMRI-driven mast reads the aspect today's handler picks from its last JMRI message, at this scan. A mast with nothing shown, or dark, reads `stop` **(decided:** the spec gives no value; Stop is the fail-safe one**)**. Another board's mast reads its `/State` aspect's tag, or `stop` when not known or not one of its aspects.
14. **Not known.** Another board's item is known once its first message has come, while its board's Online is `ACTIVE`, and while this board is connected to the broker. Not known: a sensor or block is occupied, a turnout is in neither position, a mast is `stop`. A turnout `moving`, here or there, is in neither position.
15. **Holds.** With logic on, a field-controlled mast's message is read only for its hold: held if it contains `; Held`. A held mast shows its stop aspect. A reserving rule that sets a held mast is not granted. An ACTIVE rule whose mast becomes held is cancelled back to waiting (rule 10). Holds stay until JMRI sends again, or a manual release of a resource whose rules set the mast.
16. **Manual release.** In the next scan: the resource is freed (`release … by manual`, logged even if it was free **(decided:** a press is always logged at `WARN`**)**), its rules' turnouts are unlocked, the holds on the masts its rules set are cleared, and those masts show Stop that scan. A rule that still holds other resources is PASSED **(decided:** its mast must not stay clear over track it no longer holds, and the rest stays held until its train has gone through, which is the safe way round**)**; its turnouts stay locked while it holds any. An MQTT release (`via: mqtt`) in the first 5 seconds after this board connects is ignored instead (`ignored`). Either way `CLOSED` is published.
17. **Logic switch.** Switching off: the next scan is the last. It frees every resource (`release … by switch`), drops the field locks, and each field-controlled mast shows what today's handler picks from the last JMRI message it got, or its stop aspect if none. While off, there are no scans: a JMRI message changes the mast at once, exactly as today. Switching on: the next scan is a start-up scan, with every field-controlled mast starting at its stop aspect.
18. **Today's handler** (logic off, and JMRI-driven masts): an exact match on one of an aspect's `states` wins; otherwise a message containing `; Unlit` is dark; otherwise one containing `; Held` shows the aspect named `R292` or `Stop` (dark if there is none); otherwise the name before the first `;`, with trailing spaces removed, picks the first aspect with that name; otherwise the message is ignored.
19. **Start-up scan.** An ordinary scan, except: a resource with an occupied block is held and PASSED with no holder (`pass … rule null`), and releases through its release; no leaving guard is set. *for* timers start at the start-up scan, so rules whose trigger is already true all become true together and list order decides **(decided:** the board cannot know how long a detector was occupied before power-on**)**. The scan logs `{ "startup": true }` first. A board waits for this scan before a toggle switch's boot move.
20. **Leaving guard.** A trigger with `leavingGuard` is guarded from a scan in which its block is occupied but was clear at the previous scan, if one of the resources it watches (its rule's own, or those it names) is held at that moment, that is, as the previous scan left it: a release pressed before the same scan acts only at the scan, after the train arrived. While guarded it counts as false, and its *for* counts it false too **(decided:** otherwise a trigger that was true before the guard, or whose *for* ran on while guarded, would be true as the guard lifts, and the mast would clear just as the train leaves**)**. The guard lifts at the first scan in which the block is clear.
21. **Locks.** `locks` is the field lock: any active lock rule, or a holding reserving rule, locks; a lock held with a resource only while the rule holds that resource. `locked` is the field lock or the remote lock. When `locked` goes from true to false, the scan logs `resync`: that is when the board moves a toggle-switch turnout to match its switch. One flag clearing while the other is set does nothing, and nor does a repeated `UNLOCKED`.
22. **Writes and publishes** happen only on change, from the end of one scan to the end of the next. On a broker connect (including at start), the next scan publishes every resource's Held and State. Nothing is published while disconnected. Order: masts in board order, then locks in turnout order; resources in list order, Held before State, then release echoes.

### Routes

These rule numbers follow on from the plant ends' (23-29) below.

30. **A hold, as a moment.** A field mast's hold *went held* when a message with `; Held` comes and the last one did not have it (or there was none), and *went unheld* when one without it comes and the last one had it. Messages in `start` are no moment: an Unheld left on the broker never asks. A manual release clears the board's hold (rule 16) but not what JMRI last said, so the next Unheld after a Held still counts.
31. **Entered, and not from.** `{ "block": B, "is": "occupied", "notFrom": [A] }` happens when B went occupied (rule 2) and its train did not come from A. It came from a block when exactly one of B's `next`, or of the blocks named, is occupied at that scan; none or several cannot tell, which counts as not from A. In the start-up scan, a B already occupied counts as entered from where the board cannot tell **(decided:** a train standing behind a signal at power-on would otherwise never ask**)**.
32. **Any, if and for.** `any` happens when one of its moments does. `if` reads its condition at the scan of the moment. A moment with `for` starts a run in the scan its moment happens (a repeat restarts it), and happens once, at the first scan *n* with (*n* − *r*) × 100 ms ≥ the time, if its state (the moment read as a condition) has held at every scan since.
33. **Release for a group.** In the next scan, after the resources' manual releases: `releaseGroup` is logged, then each resource held by a rule of that group is released by hand (rule 16), in resource order. An MQTT press in the first 5 seconds after connecting is ignored instead. Either way `CLOSED` is published for the group. A name that is no group does nothing.
34. **The Auto/Manual switch** changes at the event, and is read at the scan.

### Plant ends

23. **Ends work with logic on or off (decided:** an end is detection and a link, like a [block](../../../docs/field-logic-spec.md#blocks), which does not depend on the switch**).** Every scan, after everything above and after the edges for the next scan's moments are taken: the pairing decisions (rule 28), each end's state (rule 26), then its offers (rule 27), published on change (rule 29). So a link set in scan *n* is read from scan *n* + 1.
24. **A link** is `""` (empty), `end`, or `<board>/<end>`, split at the last `/`. Anything else, and a link to this same end, counts as empty **(decided:** a link to itself would hear its own offers**)**. Setting a new link forgets everything heard through the end, which then waits for the new neighbour's messages **(decided:** they belong to another board**)**. Setting the same link again changes nothing. The link is not in `board`, so it is not in the rule table and cannot change the version code.
25. **What an end hears.** Track *k* of an end with *N* tracks meets the linked end's track *N* + 1 − *k*: an event names the linked end's track, and the engine finds its own. A track number outside 1 … *N* is ignored. A heard value is known while the link is `<board>/<end>`, this board is connected, the linked board's Online is `ACTIVE`, the linked end's Link is exactly `<this board>/<this end>`, and the value has come. Reading track *k*:
    - link `end`: Block clear, Mast `stop`;
    - empty, not known, or disagreeing: Block occupied, Mast `stop`;
    - otherwise what was heard. A track or end that does not exist reads occupied and `stop`.

    An end that is pairing keeps reading through its old link until the group is decided.
26. **An end's state**, in this order: `pairing` while it is in a pairing group that has not been decided; `empty`; `end`; `unheard` while this board is disconnected; `disagrees` when the linked end's Link has come and names anything but this end; `unheard` until the linked board's Online is `ACTIVE` and its Link has come; else `heard`. A Link that is `""` has not come **(decided:** an end with nothing to say is not heard, rather than a disagreement**)**. An end whose state becomes `disagrees` logs `disagrees` once.
27. **What an end offers**, per track, from this scan's outputs:
    - Block `ACTIVE` while any of its sensors is occupied; on a pass-through, also while the far track hears occupied (rule 25).
    - Mast: the tag of what its mast shows now, `stop` for nothing, dark or an aspect with no tag (as rule 13); a pass-through's is what the far track hears; a track with neither is `stop` **(decided)**.
    - A pass-through to a track of the **same** end offers its own sensors and `stop` **(decided:** an end never offers what it hears through itself, so two paired ends cannot hold each other occupied**)**. A pass-through goes one step only: the far track's heard values, never its offer.
28. **Pairing.** Pressing Pair puts the end in the pairing group for 30 s from the press, and the next scan publishes the announcement `<board>/<end>/<tracks>` (if connected; otherwise it is not sent). An announcement heard puts that end in the group for 30 s from when it is heard; one naming this board is its own echo and is ignored, since this board's ends join by their press. An end already in the group has its 30 s start again. An announcement that is not `<board>/<end>/<tracks>`, with the tracks a whole number of at most four digits, is ignored **(decided)**. The group is open while any member's 30 s is running; an end that joins after it has closed starts a new group. At the first scan at or after the group closes, each of this board's ends in it, in end order:
    - exactly one other end, with as many tracks: link set to it, `paired`;
    - exactly one other, with a different number of tracks: `tracks`;
    - more than one other: `crowded`;
    - none: `alone`.

    Only `paired` changes the link **(decided:** the spec's "exactly two ends pairing at once" is worked out over the whole group, ends whose 30 s overlap one after another, not over each end's own 30 s, so every board in the group reaches the same answer. A group closes 30 s after its last press**)**.
29. **End publishes** follow rule 22, after the resources: for each end in order, its announcement, its Link (`""` too: an empty retained message clears the topic), then each track's Block and Mast. All of them again on connect, logic on or off.

## Multi-board cases

A multi-board case has `boards` in place of `board`: `{ "<name>": <board>, … }`, each board as above. `start` is `{ "<name>": <start>, … }`, each board's `start` as above, with `board` set to its name. A step's `do` and `expect` are `{ "<name>": [ … ] }` and `{ "<name>": { … } }`. Scan *n* runs on every board, in `boards` order.

The harness is the broker between them:
- **Retained messages.** Each board's end publishes are kept, by board, end and track. A connected board's Online is `ACTIVE` from the start.
- **Subscriptions.** Each end whose link (`links` in its state after the scan) is `<board>/<end>` hears that board's Online, that end's Link, and each of its tracks' Block and Mast, as the end events above. Every connected board hears the pairing topic, its own announcements too.
- **Timing.** What boards publish in scan *n* reaches the boards that hear it after scan *n* and before scan *n* + 1, before that step's `do` events. An end whose link changed in scan *n*, and every end of a board that connected, gets the retained messages it now hears at that time instead.
- **Broker.** `{ "broker": "disconnected" }` on a board makes its Online `INACTIVE` (its will), and it neither sends nor hears until `{ "broker": "connected" }`, which makes it `ACTIVE` again.

## MSS Logic cases

`mss/` holds the cases for [MSS Logic](../../../docs/mss-emulation-spec.md) (work item 4.1). An MSS board's rule table is built from its description by `mss-builder.js`, so these cases give the **description**, not the rules: `test/mss-builder.test.js` turns each module into a configurator board, builds its rule table the way the YAML does (`logicTable`), and replays the timeline in the JS engine. The engines themselves are cross-checked by the cases above, so these are not replayed by the C++ core. As above, the expected values are worked out by hand from the spec, never from a build or a run.

A case has `module` in place of `board` (or `modules`, by board name, in place of `boards`), with `name`, `covers` (a bullet of the MSS spec's Tests, word for word), `about`, `start` and `steps` as above:

| Key | What |
|---|---|
| `sensors`, `turnouts` | the board's sensors and turnouts, by name |
| `masts` | the board's masts by name, each with the CATS aspects R292, R285, ADV_NORM, R281, R282, R283 and R286 |
| `mss` | `logic.mss`, in the spec's [Stored format](../../../docs/mss-emulation-spec.md#stored-format) |

Built items have the builder's names: a block is `<track> block <n>`, where a track is `<From> to <To>` and a place is `A1` (end A, track 1), `J1 leg 2`, or `dead end`; a signal with no lights at a boundary is `<track> boundary <n> towards <place>`, and at a junction leg `<junction> leg <n> signal`. Their aspects are named for the indications (`Stop`, `Approach`, ...).

| MSS spec bullet (Tests) | Cases |
|---|---|
| MSS behaviour: the four rows of MSS Appendix B | `mss-appendix-b-advance`, `mss-appendix-b-no-advance` |
| MSS behaviour: the User Guide's train passing a block | `mss-user-guide-train` |
| MSS behaviour: a boundary with no signal one way | `mss-no-signal-boundary` |
| MSS behaviour: a reversed turnout in a block | `mss-reversed-turnout` |
| Junctions: a turnout junction | `mss-junction-turnout`, `mss-junction-no-approach-diverging` |
| Junctions: a CATS hold on a junction mast | `mss-junction-turnout` |
| Junctions: Approach Diverging gives Advance Approach, or Clear | `mss-junction-turnout`, `mss-approach-diverging-no-advance` |
| Junctions: a double-track crossover | `mss-crossover` |
| Junctions: validation rejects two routes from one leg | a builder test in `test/mss-builder.test.js` |
| Across modules: three modules, the middle one turned round | `mss-three-modules` |

**Appendix B** is taken as the MSS Design Standard's table of occupancy ahead to indication: the next block occupied gives Stop; the one after it, Approach; the third, Advance Approach (Clear without it); all three clear, Clear.

## Track plan cases

`plan/` holds the cases for the [Field Logic track plan](../../../docs/field-logic-plan-spec.md) (work items TP 2 and TP 4). Like the MSS cases, each gives the drawing in `module` (`sensors`, `turnouts`, `masts` by name, each mast with the seven CATS aspects, and `plan`, which is `logic.plan`), not the rules. `test/plan-cases.js` builds each into its rule table; `test/plan-builder.test.js` replays the timeline in the JS engine, and `test/engine-diff.test.js` in the C++ core. Built blocks keep the drawing's names; a signal's group is named for the signal, and a controlled signal's routes are the routes group `<signal> moves`, its rules in the order of the signal's routes. A piece of track a route takes is named for its block, numbered in the order the routes first use them when a block has several (`North scissors 1`, `North scissors 2`). A signal's button is the button `<signal> button`. A case's `start` may set `auto`: the cases in Manual say `"auto": "off"`.

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
| Rules: lock turnouts under a train | `starter-lock-turnouts` |
| Rules: several resources, all at once, first come first; passed and freed one by one | `rules-several-resources` |
| Rules: several resources, approach locking and manual release | `rules-several-resources-cancel` |
| Rules: a leaving guard that names its resources | `rules-leaving-guard-named` |
| Rules: route signal | `starter-route-signal` |
| Fail safe: start-up with a train in the section, and all clear | `failsafe-startup-train`, `failsafe-startup-clear` |
| Fail safe: toggle switch boot move waits | `failsafe-toggle-boot-wait` |
| Fail safe: remote inputs not known | `failsafe-remote-not-known` |
| Fail safe: a moving turnout matches neither position | `failsafe-moving-turnout` |
| Fail safe: held mast not granted; held after grant cancels | `failsafe-hold-grant` |
| Fail safe: with logic on, the aspect name is ignored | `failsafe-hold-aspect-ignored` |
| Fail safe: a stale hold stays at Stop until released | `failsafe-stale-hold` |
| Fail safe: start-up counts a leaving-guard train as waiting | `failsafe-startup-leaving-guard` |
| Fail safe: switching off and on | `failsafe-switch-off-on` |
| Plant ends: an end offers its Block and Mast; a pass-through | `ends-offer` |
| Plant ends: two paired ends cannot hold each other occupied | `ends-no-echo` |
| Plant ends: an empty, unheard or disagreeing link; `end` | `ends-links` |
| Plant ends: track numbering at a joint, with one board turned round | `ends-three-boards-turned` |
| Plant ends: changing a link changes no rule and not the version code | `ends-link-change` |
| Plant ends: pairing | `pairing-two-ends`, `pairing-third-end`, `pairing-track-mismatch`, `pairing-expires` |
| Rules: block signals round a continuous run | `plan-loop-block-signals`, `plan-loop-advance` |
