# MSS Logic from the standard nodes — Feature Spec (draft)

Status: approved 2026-11-28; being built (milestone *MSS patterns*). It replaces the MSS Logic page described in the [MSS Logic spec](mss-emulation-spec.md) (its *Where it lives* and *Ease of use*). The engine side of that spec (masts, tracks, junctions, plant ends, what is built, validation and tests) stays as it is.

## Why

MSS Logic is the opinionated mode: a module signals itself the way an MSS module does, with nothing to design. Today the page asks for a free-form description (ends, tracks, junctions and a Signals grid) and offers the standard MSS modules only as a shortcut. That puts the design work back on the person.

The page is rebuilt around the **MSS node types**, as the MSS standard (an open standard) defines them, called **MSS boards** on the page. You place the boards your module is made of as cards, left to right, flipping them as needed, and they are stitched into one module; the page then steps you through wiring and signals on a picture of it. MSS is an open standard: the page and these documents name its node types, never a maker's boards. Every module is a mix of those three boards (amended 2026-11-28: no Siding end or Passing siding of their own; a passing siding is a sample, two Complex cascades). There is nothing to describe and nothing to draw freehand. A module that fits no pattern belongs in Field Logic's drawing.

## The nodes

| Node | Sides | What it is |
|---|---|---|
| **Crossover** | 1 \| 1 | One block, one current detector, no signals |
| **Cascade** | 1 \| 1 | A block each side of an IR sensor, and a signal facing each way at the IR sensor |
| **Complex cascade** | 1 \| 2 | Where the track divides at a turnout: a block to the points, then the main line and the diverging track (drawn as a siding). An IR sensor at the points, a two-head signal facing the points from the single track (upper head the main line, lower the diverging track), and a single-head signal facing back from each of the main and the diverging track |

A Complex cascade can be **flipped** (2 \| 1), so its points face the other way.

## A module is MSS boards on lines

A module is one or more MSS boards, placed left to right on its **lines** (amended 2026-11-28: lines, in place of one strip whose sides had to match). One ESP32 runs the whole module.

- **Lines.** The module starts with one line at its left edge (two when the first board joins two). Each board sits on one line; the other lines carry straight past it. A **Complex cascade** dropped on a line splits it in two: the main line carries on, and a diverging line starts just above it. Flipped, a Complex cascade **joins** a line and the one above it into one. So a Crossover, Cascade or another Complex cascade can go on either line after a split: a Cascade on the loop of a passing siding, a Crossover on its main line, a junction split again. A board cannot go on a line that is not there at that point.
- **A Crossover** on a line adds its current detector to the block it stands in (a block reaches across it, as across a joint between modules). On its own it is a block from end to end.
- **A joint is not a boundary.** The blocks either side of where two boards meet on a line are one block, with one current detector. A line's first block is named by the first board on it; each board names the blocks it starts. So Cascade + Cascade is three blocks with two signal pairs, and Complex cascade + Complex cascade flipped is a passing siding with one block on the main line and one on the siding between the points.
- **The module's ends.** Every line at the left edge is a track of end **A**, every line at the right edge a track of end **B**. An end's tracks are numbered from the left looking out of it (engine rule 25: track *k* meets the neighbour's *N* + 1 − *k*): end A from the bottom line up, end B from the top line down. A lone Complex cascade (end B: 1 the diverging line, 2 the main) then pairs main to main with a lone Complex cascade flipped on the next module. A line ending at its own end letter (a branch to end C), and a line that stops on the module (a stub siding), are not in this version.
- **Starting points.** Each of the three boards starts a module on its own, and **samples** start it as boards already stitched: **Passing siding** (Complex cascade + Complex cascade flipped) and **Two cascades**.

```
Passing siding:   End A ──[1]──┃◀▶ J1 ╭══[ Siding ]══╮ J2 ◀▶┃──[4]── End B
                                     ╰──[ Main 2 ]──╯
```

The row is stored; the [description](mss-emulation-spec.md#stored-format) (ends, tracks, junctions) is **built** from it and never edited by hand, so everything after it (the builder, plant ends, the YAML, the cases) works as today.

## Names

Each node makes its own parts on the Sensors, Turnouts and Signal Masts pages, with free pins, as the templates do today. Names are numbered along the row, and say which way a signal faces by the end its trains are heading for:

| Part | Name |
|---|---|
| Block current detector | `Block 1 current`, `Block 2 current` … along the main line; `Siding 1 current` on a siding |
| IR sensor | `IR 1`, `IR 2` … left to right |
| Turnout | `Points 1`, `Points 2` … |
| Signal | `Signal 1 to B` (for trains heading to end B), `Signal 1 to A`; at a Complex cascade `Signal 2 to A main` and `Signal 2 to A siding` |

The row keeps each node's names. Renaming a part on its own page renames it in the row; deleting one is a problem the page shows on the picture.

## The page

The MSS Logic page is these steps, one at a time, with the module picture above them. The picture is the same one throughout, and each step lights the part of it that the step is about.

1. **Pick your module** (amended 2026-11-28: drag and drop). The module on top, a row of board cards with a gap before, between and after them; under it the palette: a card for each of the three MSS boards, and the samples. Drag a board into a gap: while it is dragged, the gaps where it fits light up green, and a Complex cascade turns the way it fits. Drag a card of the module to move it, or onto the remove area to take it out; each card also has **Flip** (a Complex cascade) and **Remove**. Clicking a board adds it on the right, for anyone without a mouse; a sample loads (asking first when the module has boards). Plot, then make, then configure: nothing is made while the module is built, and the steps after this one stay closed. **Make the module** makes its sensors, turnouts and signals, with free pins, as the panel under the module lists, with the LEDs or WS2812B choice, and goes on to Wire it. The steps after this one open once every part of the module is made; a module changed after that is made again (only its new parts are added). Until it is made the module has one problem, *not made yet*, which the steps do not count.
2. **Wire it.** Each part in turn, in wiring order: blocks, IR sensors, points, then each end's Pair button and LED. The part being wired is lit on the picture with a numbered badge; finished parts get a tick, parts with a problem a red dot. Beside the picture: its pin, and one line on how to wire it (*current detector: output to the pin, GND to GND*). Clicking a part on the picture jumps to it.
3. **Signals.** Each signal in turn, lit on the picture: individual LEDs (three to a head, the default) or one WS2812B LED a head, and its pins. Its aspects are the pattern's, with the CATS names, so there is nothing to pick. Two ticks for the whole module: **Advance Approach** and **Approach Diverging** (off, as in MSS). Hovering an indication lights the signal on the picture as it would show it.
4. **Try it.** As today on the same picture: trains in blocks, turnouts to click, pretend neighbours at each end, Run a train.
5. **Download.** The YAML, the JMRI file, and the module card.
6. **Pair.** How to pair the ends at a meet, with the end LED patterns.

The step shown stays until you move on (**Next**), and each step says what is left to do. A count of pins used and free is always on show, and a node that would need more pins than are free says so before it is added.

## What goes

The cards for Ends, Tracks, Junctions and the Signals grid, and the *Or start from a standard MSS module* shortcut. The views made by MSS Logic (who uses what, the control table) stay, read-only, folded under the steps.

A file with a hand-written description and no row (made on `feature/logic` before this) still builds and generates as before. The page says *This module was described by hand, which MSS Logic no longer does* and offers **Start from a pattern**, which replaces it.

## Stored format

```json
"logic": {
  "mode": "mss",
  "mss": {
    "advanceApproach": false,
    "approachDiverging": false,
    "row": [
      { "node": "complex", "names": { "left": ["Block 1 current"], "ir": "IR 1", "right": ["Block 2 current", "Siding 1 current"], "points": "Points 1",
          "signals": { "single": "Signal 1 to B", "main": "Signal 1 to A main", "siding": "Signal 1 to A siding" } } },
      { "node": "complex", "turned": true, "names": { … } }
    ],
    "ends": [ { "name": "A", "pairPin": "GPIO32", "ledPin": "GPIO33" }, { "name": "B" } ]
  }
}
```

`ends`, `tracks` and `junctions` of the description are built from `row` and not stored. `ends` keeps only each end's Pair and LED pins. A node's `left` blocks are named only when it is first in the row; `right` are the blocks it starts on its right side (main, then siding).

## Validation

- Every side that meets another has the same number of tracks (an error; the page cannot make it, but a file can).
- Every part a node names is on its page; a missing one is an error, shown on the picture.
- The rest is the MSS Logic validation over the built description, each message pointed at the node it came from.

## Tests

- **Row to description:** each preset builds the description its hand-worked MSS case expects; a joint merges the blocks either side; flipping a Complex cascade swaps its sides; mismatched sides are rejected.
- **Row cases** (hand-worked, in `test/cases/mss/`, replayed in both engines; the existing MSS cases stay):
  - a row of nodes: two Cascades, the block across the joint one block with one detector
  - a row of nodes: a passing siding from a Complex cascade and a Complex cascade flipped
  - a row of nodes: a Cascade on the loop of a passing siding, between the two Complex cascades
- **Page:** the steps' pure parts (`stepsOf`, what each step has left) in Node; a browser check from an empty page to Download for a passing siding; the guide's pictures from the screenshot script.

## Work items

| # | Item | Done when |
|---|---|---|
| MP 1 | `mss-row.js`: the nodes, joining, presets, names, the row to the description, validation | the passing siding row builds the description, and its case passes in both engines |
| MP 2 | The page frame: the steps, the picture above them, the old cards and the shortcut removed, the hand-written notice | an empty MSS page shows Pick your module |
| MP 3 | Pick your module: the three boards and the samples as cards with pictures, Add an MSS board, Flip, Remove | a passing siding is made in two clicks |
| MP 4 | Wire it: parts in order, lit on the picture, pins, ends' Pair and LED | every part of a passing siding gets a pin from the picture |
| MP 5 | Signals: LEDs or WS2812B per signal, the two ticks, indications lit on the picture | a signal shows each aspect on the picture |
| MP 6 | Try it and Download on the row; the module card for a row | Run a train through a passing siding |
| MP 7 | The MSS guide rewritten around the steps, with its pictures | the guide's script runs from an empty page |
