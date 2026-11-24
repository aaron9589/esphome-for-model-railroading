# MSS Logic — Feature Spec (draft)

Status: draft, not built; see the [implementation plan](field-logic-implementation-plan.md). A [logic mode](field-logic-spec.md#logic-modes) that runs on the same engine as Field Logic, which must exist first.

## Why

The Modular Signal System (MSS Design Standard 2.0.2 and User Guide, http://www.modularsignalsystem.info/) lets modules signal their own track and join together at a meet with a cable, in any order and either way round. MSS Logic gives a board that behaviour over MQTT, with nothing to program.

It is **emulation, not a fork, and not MSS hardware**. There is no RJ45 occupancy bus and no 12V logic. A board in MSS Logic mode runs the same engine as Field Logic: the same scan, inputs, fail-safe values, start-up scan, logic switch, CATS hold and version code. The difference is how the logic is made. Field Logic is written as rules. MSS Logic is **described**: the ends, tracks and junctions of the module. The board's blocks, masts and layers are **built** from that description. Modules join through [plant ends](field-logic-spec.md#plant-ends), the engine's way for neighbouring boards to read each other, paired on the day. MSS Logic builds them from the description.

## Where it lives

On the Logic page, choose logic mode **MSS Logic**. The page then shows these parts, in place of Field Logic's:

| Part | What you declare |
|---|---|
| Settings | logic starts on / off. Share with other boards is always on in this mode, because neighbours read it |
| Ends | the module's ends (A, B, C…), how many tracks each has, and an optional Pair button pin and status LED pin for each |
| Tracks | each detected track between two ends or junction legs (see [Tracks](#tracks)) |
| Junctions | each junction, crossover or single-to-double track (see [Junctions](#junctions)) |
| Signals | which optional indications are used (Advance Approach and Approach Diverging, both off by default, as in MSS), and for each mast the module uses, the aspect it shows for each indication (see [Masts](#masts)) |

It picks sensors, turnouts and masts from the foundational pages by name, and never changes them.

There are no rule cards, resources, rule buttons or linked boards in this mode. The layers view, control table, Try it and checker are still there. They show the built items, read-only, so nothing is hidden.

### What it builds

MSS Logic **builds** ordinary engine items from its description:

- one block per MSS block
- a virtual mast for each boundary direction and junction leg that has no signal
- tags and a stop aspect for each mast, from the Signals part
- its [plant ends](#plant-ends), filled in from the tracks
- one [Block signals](field-logic-spec.md#block-signals) layer per direction per track
- one [Route signal](field-logic-spec.md#route-signal) layer per junction leg.

They are rebuilt whenever the description changes. Only the description is stored; the built items are rebuilt from it when the file is loaded. They are part of the rule table, so they count towards the version code.

**Convert to Field Logic** copies the built items into Field Logic as ordinary, editable blocks, masts, plant ends and layers, and switches the mode. Use it when a module needs something MSS does not do, such as a one-train section or a platform dwell. It only goes one way: the converted board is no longer described the MSS way. Its plant ends come with it, so it still pairs at a meet.

## Masts

MSS names indications, not aspects. Each mast the module uses gets an aspect for each indication it can show:

| Indication | Tag it gives | CATS aspect (prefilled) | Shown by |
|---|---|---|---|
| Stop | `stop` | R292 | every mast; also its stop aspect |
| Approach | `approach` | R285 | every mast |
| Advance Approach | `advance` | ADV_NORM | every mast, if used |
| Clear | `clear` | R281 | every mast |
| Approach Diverging | `approach` | R282 | every mast, if used |
| Diverging Clear | `clear`, diverging | R283 | junction masts, on a diverging route |
| Diverging Approach | `approach`, diverging | R286 | junction masts, on a diverging route |

The tags are what the masts behind read. Approach Diverging is tagged `approach`, so the mast behind it shows Advance Approach (Clear when Advance Approach is not used), as an MSS bus does. A diverging aspect makes the mast behind show Approach Diverging, or Approach when that is not used. Virtual masts get a built aspect for each indication.

Approach lighting is set per mast here too (see [Approach lighting](field-logic-spec.md#approach-lighting)).

## Tracks

MSS divides track into **blocks** (each with at least one current detector) separated by **boundaries** (an optical detector, and signals facing each way). A track is described the same way, from its first side to its other side:

- **From** and **to**: each an end and track number (for example A 1), or a junction leg (for example J1 leg 2). A track can also stop on the module, as at a terminus.
- **Blocks**, in order. Each has its sensors (usually one current sensor) and, optionally, turnouts in it with their through position.
- **Boundaries** between blocks. Each has its sensors (usually one optical sensor) and two masts: one for trains **heading towards From** and one for trains **heading towards To**. Either can be a mast from the Signal Masts page or **none**.

The directions follow the module's own ends and junctions, so the description does not change when the module is turned round.

A track with no boundaries is one block from side to side. Between two ends, that is a **pass-through**, as on an MSS Crossover Node.

For each track, MSS Logic builds:

| Built item | From |
|---|---|
| One engine [block](field-logic-spec.md#blocks) per block | the block's sensors, plus the sensors of the boundary at each end of it. A block at an end also includes what that [end](#plant-ends) hears. A block at a junction also includes the junction's sensors. So an optical sensor holds both blocks either side of it, as in MSS |
| A [virtual mast](field-logic-spec.md#virtual-masts) | each boundary direction with mast **none**, so the tumbledown carries across it |
| A Block signals layer each way | that direction's boundary masts in order, each protecting the block beyond it, with that block's turnouts. Beyond the last block: what the end hears, the junction's mast on this leg, or *end of signalled track* |

## Junctions

A **junction** is an MSS Complex Cascade Node: a boundary where the track has two or more routes, set by turnouts. Examples are a wye or turnout junction, a double-track crossover, a single-to-double track transition, and the ends of a detected siding.

A junction has:
- **legs**, numbered 1, 2, 3…: where tracks meet it. Each leg is the From or To of one track.
- **sensors**: the optical sensors at the junction. MSS needs at least one for each route.
- **routes**: each joins two legs and has the turnout positions that set it, and whether it is **diverging**.
- for each leg, the **mast facing into the junction** from that leg, or **none**.

A route is **active** while every one of its turnouts is in its position. A moving turnout matches neither position, so no route through it is active.

For each leg, MSS Logic builds a [Route signal](field-logic-spec.md#route-signal) layer for the mast facing into the junction. It has one row per route from that leg, and each row follows the next mast on its route: the first mast heading away from the junction on the other leg's track. Each row checks that the route is active and its first block is clear:

| Route | Next mast | Junction mast shows |
|---|---|---|
| main | as in [Block signals](field-logic-spec.md#block-signals) | Clear, Advance Approach, Approach Diverging or Approach |
| diverging | `stop` or `restricting` | Diverging Approach |
| diverging | anything else | Diverging Clear |
| no route from this leg active | — | Stop |

That is the MSS behaviour:
- **An inactive route shows Stop**, so the mast behind it on that leg shows Approach. MSS drives *Approach Out* low on an inactive route.
- **A diverging route shows a diverging aspect**, so the mast behind it shows Approach Diverging, or Approach without it. MSS drives *Approach Diverging* high and *Approach Out* low.
- **An interlocking or dispatcher Stop** is a [CATS hold](field-logic-spec.md#cats-hold) on the junction mast. It shows Stop, and the masts behind tumble down, as when MSS makes that entrance inactive.

**Junction sensors are in the first block of every leg.** MSS lets an optical sensor at a junction hold only the active route's two ends. Holding every leg is more restrictive and simpler, and a car standing on the junction fouls every leg anyway.

## Plant ends

The module's ends are [plant ends](field-logic-spec.md#plant-ends): pairing, links, what an end offers and hears, and how it fails safe are all in the core spec. MSS Logic fills each end track in from the description:

- **End sensors:** the first block's own sensors: its current sensor, and the sensors at its inner boundary or junction.
- **First mast facing inward:** the inner boundary's mast heading away from this end, or the junction's mast on that leg. A virtual mast where that is *none*.
- **Passes through:** a track with no boundaries between two ends.
- **What the end hears:** the Block is part of the first block, so the block reaches across the joint. The Mast is the next mast for the last mast heading out through this end.

## How MSS maps to MSS Logic

| MSS function | How it is emulated |
|---|---|
| A current detector on every block | a block's sensor |
| An optical detector at every block boundary, holding both blocks | a boundary's sensor, built into both blocks either side |
| Local Block wire: Stop while the block beyond is occupied | the mast's block, in the built checks |
| Approach and Advance Approach wires, carried two blocks each way | each mast reads the next mast's [tag](field-logic-spec.md#aspect-tags) |
| A block boundary with no signal facing one way | a virtual mast there |
| A track switch thrown against the main counts as Block Occupied | a block's turnouts, in the built checks |
| Complex Cascade Node: occupancy and status follow the route set | a junction: each leg's mast follows the next mast on its active route |
| Complex Cascade Node: an inactive route drives *Approach Out* low | no route active from a leg: its junction mast shows Stop, and the mast behind shows Approach |
| Interlocking or dispatcher Stop makes an entrance inactive | a [CATS hold](field-logic-spec.md#cats-hold) on the junction mast |
| Approach Diverging wire, from a Source Node to a Display Node | a diverging aspect on the junction mast; the mast behind reads it as diverging |
| Signals in both directions from the same detectors | a Block signals layer each way over the same blocks |
| Crossover Node: a block running across modules with no signals | a pass-through track |
| Modules plugged together in any order and either way round | plant ends, paired on the day |
| Approach lighting from spare bus wires | per-mast [approach lighting](field-logic-spec.md#approach-lighting) |
| Slow and Restricting treated as Stop by the signal behind | the `restricting` tag |

### Where it deliberately behaves differently

- **A lost neighbour means Stop.** On an MSS bus, an unplugged cable floats high and reads as clear. Here a neighbour that is not heard counts as occupied.
- **Modules need a broker.** MSS needs nothing but the cable. Here each module has an ESP32 (one board can serve several modules that always travel together) and the layout has an MQTT broker. If the broker goes down, each board still signals its own track, and masts at module joins drop to Stop.
- **Not instant.** An MSS cascade is electrical. Here each mast is one scan (100 ms) behind the next, plus MQTT time across a module join.
- **The tumbledown can be any length.** MSS sees two blocks ahead. Reading the next mast passes a Stop back as far as there are masts. With Advance Approach on, that gives the same four aspects as MSS.
- **Junction sensors hold every leg**, not only the active route's (see [Junctions](#junctions)).
- **No head-on protection.** That matches MSS: ABS is for following moves. A board that needs it can [convert to Field Logic](#what-it-builds) and add a one-train section.

## Ease of use

MSS Logic is the simple mode, so it should be the easiest thing on the page. It follows the shared rules in [Ease of use](field-logic-spec.md#ease-of-use), plus these. The test: could someone who has built an MSS module, or just wired a detector, describe their module and get working signals without reading this spec?

### A guided setup

Choosing MSS Logic opens the parts as numbered steps, each with a short hint and a picture:

1. **Ends.** How many ends the module has and how many tracks cross each.
2. **Tracks.** Draw each track (below).
3. **Junctions**, if any (below).
4. **Signals.** Choose the indications to use and pick each signal's aspects (below).
5. **Try it.** Run a train through, and play with pretend neighbours.
6. **Download.** The YAML, the module card, and the wiring list.

Steps can be revisited in any order. A step with a problem shows a red dot.

### Drawing a track

A track is edited as a **strip**, drawn left to right the way it lies on the module, with its end or junction labelled at each side:

```
  End A ──[ S1 current ]──┃──[ S2 current ]──┃──[ S3 current ]── End B
                          ┃ optical          ┃ optical
                ◀ S1/S2 West  ▶ (none)   ◀ (none)  ▶ S2/S3 East
```

- **Add a boundary** splits a block in two. Click a block to pick its sensors and any turnouts in it. Click a boundary to pick its optical sensor and its two signals.
- The two signals at a boundary are drawn as arrows, **◀ towards From** and **▶ towards To**. A side with no signal is drawn dashed and labelled *no signal*. The page explains that a signal with no lights is made there so the signals behind keep working.
- The ends are labelled with their letters, so it is plain which way the module faces. Turning the module round needs no change.
- A track with no boundaries is labelled **Through track (no signals)**.

### Junctions from a shape

Adding a junction starts from a **shape**, with its legs and routes filled in and drawn:

| Shape | Legs | Routes |
|---|---|---|
| Turnout (left or right) | 3 | straight (main), turnout (diverging) |
| Wye | 3 | left (diverging), right (diverging) |
| Siding end | 3 | main, into siding (diverging) |
| Single to double track | 3 | to each track |
| Double-track crossover | 4 | both straights (main), both crossovers (diverging) |

Pick the turnout for each route from a dropdown and click each leg to choose the signal facing in. Hovering a route lights it on the drawing. **Custom** is there for anything else, with routes edited as a table.

### Signals by indication

One grid: a row per signal, a column per indication in use (Stop, Approach, Advance Approach, Clear, Approach Diverging, and Diverging Clear and Diverging Approach for junction signals). Each cell is an aspect picker showing the mast picture lit in that aspect. CATS aspects are filled in already. **Same as above** copies a row. Turning an indication off hides its column.

### Trying it with neighbours

Try it draws the whole module from the strips and junctions. Each end gets a **pretend neighbour** with four choices: *clear*, *train in the next block*, *next signal at Stop*, and *not linked*, which shows the fail-safe Stop. **Run a train** can enter from any end, so the tumbledown can be watched across the module and out the other side.

### Plain labels for MSS terms

The page uses MSS's own words for indications, because that is what MSS modellers know, and plain words for the rest:

| In this spec | On the page |
|---|---|
| Boundary | Block boundary |
| Pass-through track | Through track (no signals) |
| Junction leg | Leg |
| Route active | Route set |
| Plant end | End |
| Link | Paired with |
| Built item | Made by MSS Logic |

### The module card

The Download page makes a printable **module card** for the underside of the module or the meet paperwork. It is generated with the YAML, so it always matches:

- the module's name, its ends with their letters and track numbers, and a drawing of the strips and junctions
- every sensor and signal with its pin and where it sits (block, boundary, leg)
- at a new meet: *if the board cannot find Wi-Fi, join its `<board> setup` hotspot from a phone and pick the meet's network* (see [At a meet](field-logic-spec.md#at-a-meet))
- how to pair: *press Pair on both sides of the joint within 30 seconds; the end LED goes steady when it is working*
- what each LED pattern means, and the first checks when a joint shows Stop.

### A guide

`docs/mss-logic-guide.md` works through one plain-track module and one turnout junction module, from empty page to two modules paired on a test track. It covers wiring the current and optical sensors, describing the tracks, Try it, flashing, pairing, and watching the end topics in MQTTX.

## Validation

- Every block has at least one sensor. Every boundary has at least one sensor (warning if not: the masts there can clear behind unpowered cars).
- Each track's From and To are real end tracks or junction legs, each is used by exactly one track, and pass-throughs do not loop.
- A junction has at least two routes and at least one sensor (warning: MSS asks for one per route). Two routes from the same leg cannot both be active: their turnout positions must differ somewhere (error).
- Every indication in use has an aspect on every mast that shows it. Junction masts with a diverging route need Diverging Clear and Diverging Approach.
- The core [Validation](field-logic-spec.md#validation) runs over the built items as well, so a cycle or a missing aspect is reported against the part of the description that caused it.

## Generated YAML (shape)

The built items, plant ends included, generate exactly as Field Logic items do (see [Generated YAML](field-logic-spec.md#generated-yaml-shape)). MSS Logic adds nothing of its own.

## Stored format

Inside `logic`, with `"mode": "mss"`. Only the description is stored; the built items are not.

```json
"logic": {
  "mode": "mss",
  "startsOn": true,
  "mss": {
    "advanceApproach": true,
    "approachDiverging": true,
    "masts": [
      { "mast": "J1 Leg 1", "aspects": { "stop": "R292", "approach": "R285", "advance": "ADV_NORM",
          "clear": "R281", "approachDiverging": "R282", "divergingClear": "R283", "divergingApproach": "R286" } }
    ],
    "ends": [ { "name": "A", "tracks": 1, "pairPin": "GPIO32", "ledPin": "GPIO33" }, { "name": "B", "tracks": 1 } ],
    "tracks": [
      { "from": { "end": "A", "track": 1 }, "to": { "junction": "J1", "leg": 1 },
        "blocks": [ { "sensors": ["S1 current"] }, { "sensors": ["S2 current"] } ],
        "boundaries": [ { "sensors": ["S1/S2 optical"], "towardsFrom": "S1/S2 West", "towardsTo": null } ] },
      { "from": { "junction": "J1", "leg": 2 }, "to": { "end": "B", "track": 1 },
        "blocks": [ { "sensors": ["S3 current"] } ], "boundaries": [] },
      { "from": { "junction": "J1", "leg": 3 }, "to": null,
        "blocks": [ { "sensors": ["Siding current"] } ], "boundaries": [] }
    ],
    "junctions": [
      { "name": "J1", "sensors": ["J1 optical"],
        "masts": { "1": "J1 Leg 1", "2": "J1 Leg 2", "3": null },
        "routes": [
          { "legs": [1, 2], "turnouts": [{ "turnout": "P1", "position": "closed" }] },
          { "legs": [1, 3], "turnouts": [{ "turnout": "P1", "position": "thrown" }], "diverging": true }
        ] }
    ]
  }
}
```

`null` for a mast means none: a virtual mast is built there. `"to": null` is a track that stops on the module. The Field Logic keys can sit beside `mss` in the same file; only the chosen mode generates.

## Tests

In `configurator/test/`, run through `configurator/package.json`, against the same `logic.js` engine as Field Logic:

- **Builder:**
  - a two-block track builds two engine blocks (the boundary sensor in both), one layer each way, and a virtual mast for a `null` mast
  - blocks at an end include what it hears; blocks at a junction include its sensors; a pass-through builds one block
  - built items are read-only and rebuilt on change
  - Convert to Field Logic gives editable items, plant ends included, with the same YAML and version code.
- **MSS behaviour:**
  - the four rows of MSS Appendix B (occupancy ahead to indication), with and without Advance Approach
  - the User Guide's train passing a block: the leading optical sensor, then the current sensor, then the trailing optical sensor hold the block occupied until the last car has gone
  - a boundary with no signal one way passes the tumbledown across it
  - a reversed turnout in a block gives Stop on its mast and Approach behind.
- **Junctions:**
  - a turnout junction: main set gives the main ladder; diverging set gives Diverging Clear or Diverging Approach, and Approach Diverging behind (Approach when it is not used); a moving turnout gives Stop, and Approach behind
  - a CATS hold on a junction mast gives Stop, and the masts behind tumble down
  - a mast showing Approach Diverging gives Advance Approach behind it, or Clear when Advance Approach is not used
  - a double-track crossover: both straight routes active together; a crossover route makes both straight routes inactive
  - validation rejects two routes from one leg that can be active together.
- **Across modules:** three modules paired by their ends, the middle one turned round, behave like one board. The plant end tests themselves are in the core spec.
- **Import:** round-trip of a config with `logic.mss`; the built items come back identical.
