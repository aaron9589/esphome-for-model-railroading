# Field Logic Track Plan — Feature Spec

Status: design approved on 2026-11-26 from a clickable mock (#135, kept as a private design canvas). Protection amended on 2026-11-27 to follow prototype interlocking: [routes are asked for, set and released](#routes-asked-for-set-and-released), not inferred from a train standing at a signal; who asks is [Auto or Manual](#auto-or-manual). The stored format and builder (`configurator/plan-builder.js`, TP 2), turnout locking, and routes asked for, set and released (TP 4, with the Auto/Manual switch, signal buttons and Release for a route on the board) are built. The page described here is not: the Field Logic page on `feature/logic` today is the old one, which this replaces. It changes how the Field Logic mode of the [Field Logic spec](field-logic-spec.md) is **set up**. The engine and its fail-safe rules stay; the [engine changes](#engine-and-board-changes) it needs are listed.

## Why

Feedback on the first Field Logic page:

- Plant ends are not needed on a permanent layout: linked boards are enough.
- Field Logic is a lot to understand. It should be **building blocks**, so you know where to start and what builds on what.
- Instead of starters, you should **draw the track**, place blocks and signals, and put logic on top.

## Two kinds of building block

Everything on the page is one of two things.

1. **The drawing.** You draw the track and place blocks, sensors, signals and turnouts on it. From the drawing the board works out what each signal shows, which moves would clash, and when each turnout is locked. You never add or choose any of that.
2. **Your own pieces and rules.** You place buttons, switches and lamps on the drawing, and write rules, one sentence each, on the signal, turnout or lamp they affect. An **example** can write pieces and rules for you; they are ordinary pieces and rules you can read, change or remove.

There is no third kind. No starters, no named behaviours, nothing to turn on to make the track safe, and no setting that picks how protection works. A new kind of layout must never need a new named behaviour: what the drawing can't say is a rule, and what rules can't say makes the rule words grow, on purpose and with tests ([Field Logic spec](field-logic-spec.md), principle 4).

## Decisions

| Question | Decision |
|---|---|
| The old Field Logic page | Discarded: Blocks, Masts, Buttons, Sections, Groups and rule cards, Starters, Who uses what, the control table, Next steps and its Try it. The grid editor from TP 3 is rebuilt too |
| Kept underneath | The engine (JS and C++), the rule table, the board YAML, the checker, and the drawing's stored format and builder |
| Kept on the page | The mode picker, Share, Linked boards, and all of MSS Logic |
| Files saved with the old page | Not supported. MSS Logic's *Convert to Field Logic* is removed |
| Signals, sensors, turnouts | Can be made from the drawing. Their own pages keep the full settings |
| Your own rules | On the signal, turnout or lamp they affect, as one sentence |
| Size | A station: about 20 blocks, 10 signals and 8 turnouts on one board |
| Plant ends in Field Logic | Not shown. [Linked boards](#linked-boards-instead-of-plant-ends) cover a permanent layout. MSS Logic keeps them |
| MSS Logic | Unchanged. The drawing is designed so MSS Logic can move to it later |
| Protection | As on the prototype (route relay, SSI, Microlok): a signal that leads onto track another signal's route can use clears only for a route that has been **asked for** and **set**, and the route is **released behind the train**. Amended 2026-11-27 |
| Who asks for a route | **Auto**: the board, for each train that arrives. **Manual**: a person, through CATS or JMRI (clearing the signal) or the signal's button on the fascia. One Auto/Manual switch for the board; a signal can be marked **Manual only** |
| Turnouts | The board never moves them to set a route. You (or CATS) set the turnouts, then ask, as with levers or CTC |

## The page

Above the steps, one line: the mode, Share, linked boards, and a link to their settings.

Then the steps, in order: **Draw → Sensors → Signals → Behaviour and rules → Try it → Download**. An empty page offers Draw only, with one sentence: *Draw your track. Start at one end and drag to the other.* Each later step opens once the one before has something in it. A step with problems shows how many.

Below the steps, the drawing on the left and, on the right, a panel for whatever is selected. The panel ends with what to do next. On a narrow screen the panel goes under the drawing.

| Step | You do | You see |
|---|---|---|
| Draw | Drag track onto the grid. Settle each **?** (a join the drawing can't work out) | Turnouts, joins and crossings where lines meet |
| Sensors | Cut the track into blocks; give each block its sensors, or make a new sensor there | Solid track has a sensor; dashed has none |
| Signals | Put a signal at a block break, facing its trains; pick one or make one. Say what is beyond each end. Give a controlled signal a button, or mark it Manual only, if wanted | The track a selected signal checks, shaded; controlled signals marked |
| Behaviour and rules | Read what the drawing already does. Place pieces, write rules, or start from an example | What protects a selected block; a dotted line from a rule's thing to what it reads |
| Try it | Put trains in blocks, throw turnouts, ask for routes (a signal's button, or hold and clear it as CATS would), flip Auto/Manual, run a train | The signals, set routes, locks and taken track change on the same picture, with what happened and why |
| Download | As today | What the board will do in plain words, the checks, the Logic version |

## Drawing

Track is drawn between grid points in eight directions: drag, or click one point then another; a drag that isn't straight bends at 45 degrees. **Erase** takes away a clicked piece or a dragged line. **Select** picks a piece of track, a point, a signal, a piece or an end. The arrow keys and Enter do the same.

| Lines at a point | Becomes | You choose |
|---|---|---|
| 1 | an end of the drawing | [what is beyond it](#ends-of-the-drawing) |
| 2 | plain track or a bend | — |
| 3 | a turnout, or a **join with no turnout** (gauntlet track) | the turnout (or make one), which leg is straight, which position is straight; or *no turnout*. Until chosen it shows **?** |
| 4 | a crossing | — trains run straight through, never round the corner |

A bend sharper than 45 degrees is not allowed. Each stretch of track runs **both ways** unless you make it **one way**; one way applies up to the next turnout, crossing or end.

A station (about 20 blocks, 10 signals, 8 turnouts) fits without zoom; a bigger drawing scrolls.

### Making hardware from the drawing

| Where | Make | You give |
|---|---|---|
| a block | a sensor | name, pin (free pins offered) |
| a join | a turnout | name, servo channel or pin |
| a block break | a signal | name, kind of mast, pin |
| anywhere | a button, switch or lamp | name, pin |

The Sensors, Turnouts and Signal Masts pages keep their full settings and list what the drawing made. Renaming there renames on the drawing.

## Blocks and signals

- A **block break** is where one block stops and the next starts. A break can have a boundary sensor, which then holds both blocks.
- A **block** is the track between breaks and drawing ends: a name, a topic, its sensors. It publishes to JMRI like a sensor.
- A block with no sensor is **not detected**: drawn dashed, and nothing can be proved about it.
- A block can include a sensor on a linked board, but not a linked board's block, so two boards can never hold each other occupied.
- A **signal** stands at a break and faces trains going one way.

## Ends of the drawing

| Beyond | The signal before it |
|---|---|
| **End of signalled track** (default) | shows Approach at best |
| **Plain track, no more signals** | can show Clear |
| **Another board** | requires that board's chosen blocks clear, and reads its chosen signal. Unheard means occupied and Stop |

## What the drawing works out

### Routes and aspects

For each signal, the builder follows the track to the next signal facing the same way, or to an end. Each way through is a **route**, also called a **move**.

| From the drawing | Becomes |
|---|---|
| the blocks along a route | must all be clear |
| the turnouts along a route | must be set for it; a moving turnout matches neither position |
| a turnout's straight and diverging legs | whether the route is diverging |
| the next signal | the aspect: Approach behind a Stop, and so on, in the [Block signals](field-logic-spec.md#block-signals) order |
| no route set | Stop |

A signal asks only for the meanings it can show (prefilled for CATS masts). A rule row that waits for an aspect the next signal can never show is left out; leaving one out only ever gives Stop.

### Routes asked for, set and released

Protection follows prototype interlocking. A route is set only when it has been asked for, it takes all its track at once, and it gives that track back piece by piece behind the train. Nothing on the page turns protection on or chooses how it works.

#### Controlled signals and block signals

Two routes **clash** when they would put trains on the same track: over the same track in either direction, or across the same crossing by different lines. Two routes that need a turnout set differently never clash, since only one can be set.

| A signal is | When | It shows |
|---|---|---|
| a **block signal** | none of its routes can clash with another signal's | the best aspect the track ahead allows, on the route the turnouts are set for. A CATS or JMRI hold keeps it at Stop. Nothing asks for it |
| a **controlled signal** | one of its routes can clash | Stop, until a route from it is [set](#setting-a-route); then what the track ahead allows on that route |

A controlled signal's routes that can clash with nothing are routes like any other: they too need asking for.

#### Auto or Manual

A route is set only when something asks for it. Who asks is the only thing Auto and Manual change; what the board checks before the signal clears is the same either way.

| | Asks for a route | Cancels it (before the train has entered) |
|---|---|---|
| **Auto** | the board, when a train [enters the block behind the signal from the far side](#which-way-a-train-is-heading) | that train leaving the block behind: gone from it for 1 second, so a gap between two detectors as the train crosses into the route is not a cancel |
| **Manual** | CATS or JMRI clearing the signal (Held to Unheld), or the signal's button being pressed: whichever comes first | the signal being held, or its button being pressed again |

- **The Auto/Manual switch.** One for the board, set on the running layout: on the board's web page, on MQTT (`trains/track/light/auto/<board>`, a JMRI light `MLauto/<board>`, so CATS or a JMRI panel can flip it), and optionally a toggle on the fascia. It starts as the configurator says (Auto by default) and is kept across a restart, as the logic switch is.
- **Manual only.** A controlled signal marked Manual only on its panel is always Manual, whatever the switch says: a junction a person always works, say.
- **Flipping the switch** changes only who asks from then on. Routes already set stay set and release behind their trains as usual. Requests waiting from the side being switched away from are dropped.
- **Underneath, a request is an event.** Auto and Manual write each controlled signal's *ask when* and *cancel when* (a train entering a block from another, a signal unheld or held, a button pressed); your own rules may add others in a later version. A request is non-vital: whatever starts it, the route still sets only if the checks below pass.

#### Asking for a route

- **The route asked for is the one the turnouts are set for** when it is set. The board does not move turnouts: set them first (from their own buttons, JMRI or CATS), then ask, as a signaller pulls levers or a dispatcher lines switches and then calls the signal.
- **A request waits** until a route can be set, and is kept until it is set or cancelled. If the turnouts are moving or set for no route, or the track is taken or occupied, it is set as soon as it can be. When several wait, the one asked first is set first; to prefer one line, write a rule.
- **A request is used up** when its train enters the route. The signal goes back to Stop at once, and the next train needs asking for again. A route also takes the piece of track just past its signal, so a train entering any route is seen; that track needs a sensor of its own.
- **An Unheld left on the broker is not a request**: only a change from Held to Unheld asks. After the board restarts, CATS must hold the signal and clear it again, as a real interlocking comes back with every signal at Stop. Restarting CATS does that for every signal: it sets each one afresh as it starts.
- **CATS in Hold Only mode** unholds a signal exactly when its own logic wants it off Stop (`PhysicalSignal.setAspect` calls `setHeld(rule == STOP)`), and holds it again once its model sees the train go by. CATS sends Unheld again when its aspect changes (Approach to Clear, say); only a change from Held to Unheld asks. CATS keeps the direction of traffic on its own lines.
- **A signal button** is optional: a push button on the fascia, wired to GND, beside its signal. The board's web page has the same button for each signal that has one.
- **In Auto, a CATS or JMRI hold still holds a signal at Stop**, and cancels its route before the train has entered.

#### Setting a route

A route is set when it has been asked for and, in the same scan:

- every turnout on it is in position (a moving turnout is in neither);
- every block on it is clear;
- none of its track is taken by another set route.

It then takes all its track **at once**, so two routes can never each hold part of what the other needs. Its turnouts are locked ([route locking](#turnout-locks)) and the signal shows what the track ahead allows. If a block on it becomes occupied by anything but its own train, the signal goes to Stop and the route stays set.

Track is taken in **pieces**: the track between turnouts, crossings, breaks and ends, with a crossing a piece of its own. A route takes only the pieces another route can clash on, so on a scissors crossover a train along one line and a train along the other run together, and on a crossing loop a train can stand in one road while another is routed into the other. Where two routes clash on track that no sensor of its own sees, the board can't tell when it is free: that is an error, saying to give that track a sensor.

#### Releasing a route

- **Behind the train, piece by piece.** A piece is freed once its train has been in its block, the block has then been clear for its **Timing** (3 seconds unless changed), and the train has been seen in the next block along the route; the last piece of a route that ends at the drawing's end needs only the first two. A detector that drops out under a train therefore frees nothing. *Seen* is the next block becoming occupied after the train entered the piece: another train already standing there is no proof that this one went on. The next block is the next one with a sensor along the way, or past the signal the route ends at. The turnouts in a piece unlock with it.
- **Cancelled before the train enters:** the route is freed at once, unless a train is in the block behind the signal: then it is freed after the block's hold time (approach locking; off by default), or at once if that train leaves.
- **Once the train has entered, a cancel does nothing.** CATS holds a signal as soon as its train passes, so that hold must never free track ahead of the train.
- **A piece the train never reaches** (it backed out, or stalled on dead track) stays taken. Release the route by hand: **Release** on the board's web page, or its JMRI turnout, frees what is left of it at once, as today's manual release. That is the operator's call, as an emergency route release is the signaller's.

#### Which way a train is heading

Only Auto needs to know. Each block remembers where its train came from: the neighbouring block that was occupied when it became occupied. A train already standing behind a signal when the board starts counts as arriving from where the board can't tell, so it asks. In Auto, a train entering the block behind a signal asks only if it came from the side away from the signal, so a train that has just come the other way through the signal never asks. If the board can't tell (it came from track with no sensor, or both neighbours were occupied), the train counts as heading through: stranding a waiting train is worse, and the route's locking still protects the track.

Selecting a block shows what protects it in words: which signals' routes lead onto it, that only one is set at a time, and which is set now.

### Turnout locks

A turnout is locked so its points never move in front of a train:

| Locked while | Which turnouts | Railways call it |
|---|---|---|
| a route over it is set | that turnout, until the piece it is in is freed behind the train, or the route is cancelled | route locking |
| a train waits behind a block signal that is not at Stop | the turnouts of the route the signal is showing | approach locking |
| a block on a block signal's route, short of a turnout, is occupied | that turnout | track locking |
| the turnout's own block is occupied | that turnout; can be unticked for each turnout | lock under a train |

Approach locking on a block signal starts the scan after the signal clears. A signal with turnouts ahead and no sensor behind it can't be approach locked; the page warns.

### Turnouts that move together

Two turnouts joined by one diagonal between two parallel tracks make a **crossover**, and the drawing pairs them: throwing one throws the other, whether from a button, JMRI or CATS, unless the other is locked or moving. Each still reports its own position, and a route over a crossover needs both. A pair can be changed on the turnout's panel.

## Your own pieces and rules

### Pieces

| Piece | Is | You give |
|---|---|---|
| Button | a push button on the fascia, wired to GND | name, pin |
| Switch | a toggle on the fascia, wired to GND | name, pin, what *on* means (such as Local) |
| Lamp | an LED on the fascia | name, pin |

A piece does nothing on its own: rules read buttons and switches, and rules light lamps.

### Rules

A rule lives on the thing it affects and is one sentence:

| On | Rule |
|---|---|
| a signal | **Keep at Stop while** … · **Keep at Stop unless** … · **No better than Approach while** … |
| a turnout | **Lock it while** … · **Only its own buttons move it while** … (JMRI, CATS and rules can't, its fascia buttons can) |
| a lamp | **Light while** … · **Flash while** … |

The … is a condition: a block occupied or clear, or with a train in it for a time; a turnout closed or thrown; a signal at Stop or not, or *has shown Stop for* a time; a switch on or off; a button pressed in the last so many seconds; any of these on a linked board; joined with *and* or *or*.

- A rule can only hold a signal back. It never clears one past what the drawing allows.
- Rules do not throw turnouts in this version.
- A selected signal or turnout lists its rules, and a dotted line on the drawing joins it to what its rules read.
- The checker checks rules with everything else, and warns if one could keep a train waiting for good.

### Examples

An example writes pieces and rules for you, then is forgotten: nothing remembers it was an example. The first three:

| Example | Writes |
|---|---|
| Hold a signal until a button is pressed | a button; on the signal, *Keep at Stop unless the button was pressed in the last 30 seconds* |
| Hand a turnout to a local panel | a switch and a lamp; on each signal whose route crosses the turnout, *Keep at Stop while the switch is Local*; on the turnout, *Only its own buttons move it while the switch is Local and those signals have shown Stop for 30 seconds*; on the lamp, *Light while only the turnout's own buttons move it* and *Flash while the switch is Remote and the turnout is thrown* |
| Let one line go first at a crossing | on each signal of the other line, *Keep at Stop while a train waits on the first line* |

The drawing already keeps signals at Stop while a turnout is set against them, so an example never writes that.

## Try it

The same drawing, live. Click a block to put a train in or take it out, a turnout to throw it, a button to press it, a switch to flip it, a controlled signal to ask for or cancel its route (as its button, or CATS, would), the Auto/Manual switch to flip it. **Run a train** from an end. Taken track is shaded, a set route is green, locked turnouts show a lock. A list says what happened, and the panel says why the selected signal shows what it does. Step, Skip ahead and Start again as today.

## Download

What the board will do, a sentence for each signal (a block signal, or controlled and Manual only or not), each place two routes clash, and each rule. Then the checks (problems, the checker) and Download YAML, Download JMRI XML and Send to ESPHome. The Logic version as today.

## Problems

Marked on the drawing where they are: red for errors, which stop the download, amber for warnings. Each says what is wrong, why, and what to do.

- A **?** not settled: a join with no turnout chosen and not marked *no turnout*.
- A signal that faces an end with no track ahead.
- Nothing detected on a route (error).
- Two routes that clash on track no sensor of its own sees (error).
- A controlled signal with no sensor of its own just past it: the board can't see a train enter its route (error).
- A controlled signal that nothing can ask for: with no sensor behind it, no train can ask in Auto (error unless it is Manual only); with MQTT off and no button, nothing can ask in Manual (error).
- Undetected track on a route (warning), a block no signal checks (warning), a signal that can't be approach locked (warning).
- Everything the checker finds, pointed back at the signal, rule or block.

## How it is built

The drawing is **described, then built**, like MSS Logic: `plan-builder.js` turns it into ordinary blocks, masts, rules and resources, which `logic-yaml.js` hands to the YAML, JMRI XML, checker and component. Built items are never stored.

### Engine and board changes

| Change | Why |
|---|---|
| A rule can take several resources at once, all or nothing | A route takes its pieces together, so two can never hold half each |
| A moment when a mast goes from Held to Unheld, and back | In Manual, CATS and JMRI ask for and cancel routes. No moment from the start-up messages, so nothing left on the broker asks |
| A cancel that also withdraws a request still waiting | A button pressed again, or a hold, takes back a request not yet set |
| The Auto/Manual switch as an input | Auto and Manual |
| A release that also waits for the train in the next block along the route | Sequential release: a detector dropout frees nothing |
| A turnout lock held by a resource, not by the whole rule | Route locking frees each turnout with its piece |
| Manual release of everything a rule holds | **Release** for a route |
| A moment when a train enters a block from a given neighbouring block | In Auto, only a train heading through a signal asks |
| Switch inputs and lamp outputs | Pieces |
| A turnout lock that stops JMRI, CATS and rules but lets its own buttons through | *Only its own buttons move it* |
| Paired turnouts: one command throws both | Crossovers |
| A condition that a signal *has shown Stop for* a time | Examples and rules that wait for the line to be held |

Each change goes into the JS engine and the C++ core together, with hand-worked cases, as the [Field Logic spec](field-logic-spec.md) requires.

## Stored format

One key, `logic.plan`. `logic.mode` stays `field`. Positions are grid points, `[x, y]`, with y down the page.

```json
"plan": {
  "track": [ [[0,0],[3,0]], [[3,0],[4,1]] ],
  "points": [ { "at": [5,1], "turnout": "P1", "straight": [6,1], "straightIs": "closed", "lock": true, "pairedWith": "P2" },
              { "at": [4,1], "turnout": null } ],
  "arrows": [ { "from": [0,0], "to": [2,0] } ],
  "breaks": [ { "at": [2,0], "sensors": [], "signals": [ { "mast": "Left Bridge", "facing": [3,0], "aspects": {}, "approachLight": "", "manualOnly": false, "button": "GPIO25" } ] } ],
  "blocks": [ { "name": "Left", "at": [[0,0],[2,0]], "sensors": ["Left current"], "release": "3s", "approachLock": "" } ],
  "ends": [ { "at": [12,0], "beyond": "plain" },
            { "at": [12,2], "beyond": { "board": "kiama-south-p3q8w5", "mast": "Home", "blocks": ["Up"] } } ],
  "pieces": [ { "kind": "switch", "name": "Industry switch", "at": [7,4], "pin": "GPIO33", "on": "Local" } ],
  "rules": [ { "on": { "mast": "West Home" }, "kind": "stopWhile", "when": { "switch": "Industry switch", "is": "on" } } ],
  "auto": { "startsOn": true, "pin": "GPIO26" },
  "advanceApproach": false,
  "approachDiverging": false
}
```

- `track` is straight pieces along the grid or at 45 degrees. Lines meet only at grid points.
- A block break sits on plain track, never on a turnout, crossing or end, so a turnout or join is always inside a block.
- A point's `straight` is needed only where neither leg is in line with the third. `pairedWith` is set when the drawing finds a crossover and kept if changed.
- `facing` is the next grid point along the track, the way the signal's trains go.
- A controlled signal's `manualOnly` (left out when false) and `button` (its pin, left out when it has none). A block signal ignores both.
- `auto` is the Auto/Manual switch: `startsOn` (Auto at first, the default) and the fascia toggle's `pin` (left out when there is none).
- A block is named by any piece of track in it (`at`). `release` and `approachLock` are its Timing, left out when usual.
- `pieces[].kind` is `button`, `switch` or `lamp`. `rules[].on` is a `mast`, `turnout` or `lamp`; `kind` is one of the rule words above; `when` is a condition in the rule table's own form.
- `aspects` are the [MSS indications](mss-emulation-spec.md#masts); a CATS mast needs none.
- The `sections` key of TP 2 goes: routes replace it.
- A board in Field Logic reads only `logic.plan` (with Share and linked boards). The old page's keys (`blocks`, `layers`, `resources`, `buttons`, `masts`) are not read.

## Linked boards instead of plant ends

The Plant ends card is not shown in Field Logic. A permanent layout links boards instead, and an end of the drawing can be **Another board**. The engine, the C++ component and MSS Logic keep plant ends.

## Continuous run

Signals right round a loop read each other in a circle, which validation otherwise rejects. A loop made **only of the drawing's own signals** is allowed: each checks its own track, and what a signal shows for each meaning ahead never feeds back into itself, so the loop settles (engine cases `plan-loop-block-signals` and `plan-loop-advance`, replayed by both engines). A loop with any rule of yours in it is still an error, as is a loop with only one signal.

## Checker

The checker must check a station completely. Measured on the TP 2 plans: the gauntlet (120 states), junction (116) and diamond (536) are checked completely within the quick budget; the passing siding (7 signals, 2 turnouts) is not checked completely even by **Check every combination** (about 16,500 states in 20 s), because signals that read each other make one large part. Protection in pieces adds resources. Before the guide, the checker checks a drawing in smaller parts (TP 5).

## Work, in order

The milestone *Track plan* on GitHub has an issue for each.

| # | Work | Done when |
|---|---|---|
| 0 | Clickable mock | approved (2026-11-26) |
| 1 | Hide Plant ends in Field Logic | done |
| 2 | Stored format and builder | done; fail-safe sign-off open |
| 3 | First grid editor | done, replaced by 6 |
| 4 | Routes: controlled signals and block signals; asked for in Auto by the board, in Manual by CATS or JMRI or a signal button, with the Auto/Manual switch and Manual only; set all at once, released behind the train; route locking; paired turnouts; sections removed | done; fail-safe sign-off open. Hand-worked cases pass in both engines (`test/cases/plan/`): the gauntlet asked for by CATS, a crossing loop meet by signal buttons, a scissors crossover with parallel routes, a diamond and a merge in Auto, the switch flipped with a route set, a detector dropout that frees nothing, CATS holding a signal as its train passes, and a route cancelled and released by hand |
| 5 | Checker on drawn plans | the passing siding and a station of the size above are checked completely |
| 6 | The new page: steps, drawing, making hardware, protection shown | a newcomer on an empty page has one thing to do, and the four TP 2 drawings can be drawn |
| 7 | Pieces, rules and examples | the gauntlet with a button before Left Bridge, and the industry siding with a local panel, built from an empty page |
| 8 | Try it and Run a train on the drawing | a meet on a crossing loop runs on the drawing |
| 9 | Remove the old page | no Field Logic screen but the new one is left |
| 10 | New Field Logic guide | a newcomer builds the gauntlet from it |

## Open questions

- **Signals not on the drawing.** A signal set only by rules (a shunt signal, say) has no place in this design. Add one if a layout needs it.
- **Bigger drawings.** Zoom and pan, if a board needs more than a station.
- **Approach locking on by default?** The prototype always has it. Here it stays off by default, as before, with a hold time on each block.
- **An Auto/Manual switch for part of a board** (a station, say), or for each signal. One switch for the board, and Manual only per signal, in this version. The example *Hand a turnout to a local panel* will need rewriting for routes.
- **Fleeting** (a route that stays set for every train) and **entrance-exit** buttons (press two signals and the board sets the turnouts). Not in this version: entrance-exit needs the board to move turnouts.
