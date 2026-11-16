# MSS-ESPHome

**Version 1.**

## 1. Scope

The [Modular Signal System](http://www.modularsignalsystem.info/) (MSS 2.0.2) animates signals from the blocks ahead. No computer has to choose each aspect. This standard keeps those indications on MQTT. A dispatcher can hold a home signal at Stop, and the same script fills the aspect once the hold lifts.

### 1.1 Normative references

- [MSS Design standard 2.0.2](http://www.modularsignalsystem.info/ModularSignalSystemStandardV2.0.2.pdf)
- [MSS User guide part 1, fundamentals](http://www.modularsignalsystem.info/MSSUserGuide1.pdf)
- [MSS User guide part 2, planning](http://www.modularsignalsystem.info/MSSUserGuide2.pdf)

## 2. Version and payloads

This document is version **1**.

The first word of every payload is the version that board implements, written `v1` for this standard. The words after it are the event. Each board sends its own version, so an older board and a newer board can share the broker.

A board reads a payload whose version is the same as its own or lower. A higher version is unheard. An unheard block, optic, or ahead fact counts as occupied. An unheard turnout counts as `NORMAL`. An unheard pair message is ignored.

```
v1 OCCUPIED
v1 CLEAR
v1 REVERSE
v1 NORMAL
v1 ONLINE
v1 OFFLINE
v1 Approach
v1 OFFER west-board/right
v1 ACCEPT east-board/left WITH west-board/right
```

## 3. Board types

A block runs from one boundary or junction to the next boundary or junction. Those two are marked *. An interim cannot be the end of a block.

![A boundary has the optic and the signals in the centre, and a block on each side. An interim is one block detector. A junction is a turnout with the optic in the centre, a throat block, a main block, and a diverging block.](../_img/block-overview.svg)

**Boundary \*.** The optic and the signals sit in the centre, facing both ways. A block detector sits on the left, and another on the right. The left detector occupies the block on the left. The right detector occupies the block on the right. The optic occupies both blocks that meet at the signals.

**Interim.** One block detector. No signals and no optic. The detector occupies the one block this board sits in. Several interims in a row all belong to that same block.

**Junction \*.** A turnout, with the optic in the centre of it, so a train on either leg is seen. One signal on each leg — throat, main, and branch — facing the turnout. Three block detectors. The throat detector and the optic occupy the throat. The main detector occupies the main route. The diverging detector occupies the diverging route. The optic does not occupy the main route or the diverging route.

## 4. Occupancy

Each signalled track is its own set of topics. A block is occupied when any of these is true:

- The left or right block detector on a boundary sees a train. That occupies the block on that side.
- A block detector on an interim in the block sees a train.
- The optic in the centre of a boundary sees any part of a train. That occupies both blocks that meet there, so the signals hold until the last car clears the boundary.
- The throat, main, or diverging block detector on a junction sees a train. That occupies that block.
- The optic in the centre of a turnout sees a train on either leg. That occupies the throat block.
- A turnout in a junction is set against the route that signal is protecting.

Sidings and spurs that are not signalled stay out of this. Both rails are still gapped at each block boundary, and every feeder for a block still passes through a current detector.

## 5. Aspects

Signals stand at the boundaries, and on each leg of a junction. The signal facing a block shows the first row that matches:

| What the script sees | Indication |
|---|---|
| An absolute mast, and CATS is holding it | Stop |
| The block it protects is occupied | Stop |
| That block is clear, this is the throat signal, and the turnout is REVERSE | Approach Diverging |
| That block is clear, and the next block is occupied | Approach |
| Those two are clear, and the one after is occupied | Advance Approach |
| Those are clear, and a train is in the block behind | Clear |
| Nothing ahead, and the block behind is clear, with approach lighting on | Dark |
| Nothing ahead, and approach lighting is off | Clear |

Stop wins over everything. Advance Approach, Approach Diverging, and approach lighting are optional. Stop, Approach, and Clear are not. MSS 2.0.2 lists the same three as required, and Advance Approach as optional.

A mast without Approach Diverging skips that row and continues down the table. A mast without Advance Approach skips that row and continues down the table. The absolute row applies only to a mast marked Absolute. A permissive mast skips it.

![The signal faces the blocks ahead. Stop comes from the block it protects. Approach comes from the next block. Approach Diverging comes from a REVERSE turnout with this block clear. Advance Approach comes from the one after next. Clear or Dark comes from the block behind.](../_img/block-aspects.svg)

### 5.1 What a signal protects

Each signal protects the track in front of it, up to the next signal. On a plain stretch the two signals that face each other across a block both protect that block. A train on an interim occupies the whole of that block, so both signals show Stop. The signal one block further back shows Approach only when that whole block is its next one.

A junction splits the road into the approach, the main, and the diverging route.

- The signal facing the junction from the approach protects the approach. That is the boundary block on the junction side, plus every interim up to the throat signal. A train there shows Stop on that signal. It does not, by itself, show Stop on the throat.
- The throat signal protects the lined route beyond the turnout, up to the next boundary signal. On the main, that is the main route up to the east signals. On the branch, that is the diverging route up to the branch boundary signals. A train on that route shows Stop on the throat, and on the boundary at the far end, until the train passes that boundary signal.
- The main signal and the branch signal face the turnout, so each protects the approach beyond the frog. A train in the approach shows Stop on the signal of the lined leg.
- The boundary on a route, facing the junction, protects that route up to the points signal.

### 5.2 Next, after, and the turnout

The table reads three blocks and one turnout.

- **This block** is the one the signal protects.
- **Next** is the block the next signal protects.
- **After** is the block after next. At a junction, after stays on the straight path when the branch is lined.
- **Turnout** is `REVERSE` when the branch is lined, and `NORMAL` when the main is lined. An interim copies that word through.

Approach Diverging is the throat signal only, and only when the branch is lined. This block is clear and the turnout is `REVERSE`. A signal one block back does not show it. With the approach empty and the branch lined, that signal shows Clear, or Advance Approach when the straight path is occupied and the mast has the aspect.

### 5.3 Two holds

The route that is not lined is held occupied. The signal on that leg shows Stop. The boundary one block back on that route shows Approach: its own block is clear, and the next signal is Stop.

A train already in the approach holds the lined route as well, so an opposing train cannot enter it. The boundary at the far end of that route shows Stop. The throat signal does not take this hold. With the branch lined, the branch boundary shows Stop and the diverging route is held. With the main lined, the east boundary shows Stop and the main route is held.

### 5.4 Junction turnout word

A junction is a starred end of every block that meets it. The three signals face the turnout. Which block each one protects, and the two holds, are in the clauses above.

![When the branch is lined, turnout lined is REVERSE and the main is held occupied. When the main is lined, turnout lined is NORMAL and the branch is held occupied. The optic sits in the centre of the turnout.](../_img/block-junction.svg)

The junction publishes `turnout/<board>/lined` as `v1 REVERSE` when the branch is lined, and `v1 NORMAL` when the main is lined, and the same word on `ahead/<board>/<end>/turnout`. An interim in the approach adds its detector to the approach block and copies `turnout` through to the boundary one block back.

## 6. Topics

The topic says what changed. The payload says what it is now. Facts are retained, QoS 1. A block or an optic is `v1 OCCUPIED` or `v1 CLEAR`. A turnout is `v1 NORMAL` or `v1 REVERSE`.

```
mss/<track>/block/<board>
mss/<track>/block/<board>/<place>
mss/<track>/optic/boundary/<board>
mss/<track>/optic/turnout/<board>
mss/<track>/turnout/<board>/lined
```

`block/<board>` is an interim's one block detector. `block/<board>/<place>` is one block on a boundary (`left`, `right`) or a junction (`throat`, `main`, `branch`). `optic/boundary` is the optic in the centre of a boundary. `optic/turnout` is the optic in the centre of the turnout. `turnout/<board>/lined` is `v1 REVERSE` when the branch is lined, and `v1 NORMAL` when the main is lined.

JMRI train tracking stays on `trains/track/sensor/...`, and those messages are not retained. The signal script does not read that topic.

Each end passes those facts on, one topic per fact, retained, QoS 1:

```
mss/<track>/ahead/<board>/<end>/block
mss/<track>/ahead/<board>/<end>/next
mss/<track>/ahead/<board>/<end>/after
mss/<track>/ahead/<board>/<end>/turnout
```

`block`, `next`, and `after` are `v1 OCCUPIED` or `v1 CLEAR`. `turnout` is `v1 NORMAL` or `v1 REVERSE`. A clear road is `block`, `next`, and `after` all `v1 CLEAR`, and `turnout` `v1 NORMAL`. When a train enters the block, `ahead/<board>/<end>/block` changes to `v1 OCCUPIED`. The topic that changed is the event.

An interim adds itself to the block and passes the rest through. `ahead/<board>/<end>/block` is occupied when its own block topic is occupied, or the block topic from the other end is occupied. `next`, `after`, and `turnout` are copied.

A boundary or a junction is the edge of a block. Across that edge, `block` is this block, `next` is the next signal block, and `after` is the one after that.

Two boundaries can be neighbours with no interim between them. Each reads the other's ahead topics. A row of interims still adds up to one block, and `next` still arrives at the far boundary.

The aspect that signal is showing:

```
mss/<track>/signal/<board>/<end>
```

The payload is the version, then the aspect name. Examples: `v1 Stop`, `v1 Approach`, `v1 Approach Diverging`. Other boards do not read this topic. An interim has no signals, so it does not publish it.

Each board also publishes:

```
mss/<track>/board/<board>/online
```

`v1 ONLINE` while it is connected, `v1 OFFLINE` as its last will. Both are retained. Block, optic, turnout, ahead, and signal topics are published again about once a second. A block input counts as occupied unless the board is `v1 ONLINE`, the payload is `v1 CLEAR`, and a copy arrived within the last three seconds. A missing turnout topic stays `v1 NORMAL`.

![A topic is clear only when its board is online, the payload is CLEAR, and a copy arrived within three seconds. Occupied, offline, quiet, and unheard all count as occupied.](../_img/block-failsafe.svg)

## 7. Pairing

A boundary has two ends, `left` and `right`. A junction has three legs, `throat`, `main`, and `branch`. An interim has two ends, `one` and `two`. Either interim end can take either neighbour. Each end is used once.

Each end stores the neighbour's address, such as `east-board/left` or `gap-board/one`. That address is `<board>/<end>` on the ahead topics.

Pairing uses one topic for the whole track:

```
mss/<track>/pair
```

It is not retained. QoS 1. Pair one end at a time.

1. One end publishes `v1 OFFER west-board/right` and flashes the signals on that side.
2. An end of the other board publishes `v1 ACCEPT east-board/left WITH west-board/right`. The first address is the end that accepted. `WITH` is the offer it accepted.
3. West stores `east-board/left` as its right neighbour. East stores `west-board/right` as its left neighbour.
4. Both ends flash three slow blinks. An interim has no signals, so the board with signals flashes. Both ends store the address.

An offer lasts 30 seconds. A new offer replaces one that has not been accepted. A board ignores an offer from itself.

## 8. Signal masts

The script picks the aspect by the name configured for that mast (`Stop`, `Approach`, and so on). One mast, one signal. The signal starts at Stop until the topics it reads have reported.

Approach lighting needs a Dark aspect with every lamp off, and the block behind the signal. It is off unless that mast is configured for it. With it off, a clear road stays Clear and the mast stays lit.

The board publishes that name on `signal/<board>/<end>`, and only that name. Example: `v1 Approach`.

## 9. Absolute signals and CATS

Permissive signals follow the blocks. Home signals, and the signals at a junction, are the ones marked Absolute.

![A permissive signal shows Approach when the next block is occupied. An absolute signal shows Stop while CATS sends Held, and shows Approach once CATS sends Unheld.](../_img/block-ctc.svg)

An absolute mast listens on the topic it already has, `trains/track/signalmast/<name>`. The payload is the JMRI line, such as `Stop; Lit; Held`.

- `Held` forces Stop. The aspect word in that message can be stale, so the board does not paint it. Lit and Unlit are ignored.
- `Unheld` means the dispatcher has cleared the signal. The script then shows Clear, Approach, Advance Approach, or Approach Diverging.
- The board publishes the bare aspect name. A full `Approach; Lit; Unheld` line would clear the hold CATS had just set.

The mast topic is not retained, and CATS publishes when its rule changes. After a reboot an absolute mast stays at Stop until a fresh `Held` or `Unheld` arrives.

While that signal is cleared, the board ignores fascia throws for the points in the block it protects. After CATS returns the signal to Stop, those points stay locked until the block is clear. A permissive signal does not take that lock. A turnout against the route still occupies the block.

With no dispatcher, leave Absolute off. The line runs from the blocks alone.

---

## Appendix A. Train movement examples

These pictures apply the clauses above. They are not additional requirements.

### A.1 A plain stretch

West and east are boundaries. An interim named gap sits between them. That is one block. The track past east is the next block.

![West boundary, an interim, and east boundary, snapped in a row. West's right block, the interim detector, and east's left block are one block. East's right block is the next block.](../_img/block-stretch.svg)

West's right neighbour is `gap-board/one`. The interim's `one` end stores `west-board/right`. Its `two` end stores `east-board/left`. East's left neighbour is `gap-board/two`.

The signal on west that faces east protects this block. Stop is this block. Approach is the next block, which arrives on `next`. The signal on east that faces east protects the next block. The signal on east that faces west protects this block. The signal on west that faces west protects the west block.

![No train. Every block and optic publishes v1 CLEAR. All four signals show Clear.](../_img/block-run-clear.svg)

![block/west-board/left is v1 OCCUPIED. The signal facing that block shows Stop. The other signals stay Clear.](../_img/block-run-interim.svg)

![block/gap-board is v1 OCCUPIED. Both ends publish that on the ahead block topic. The signals facing this block show Stop.](../_img/block-run-optic.svg)

![block/east-board/right is v1 OCCUPIED. East facing that block shows Stop. West reads next and shows Approach.](../_img/block-run-next.svg)

Approach lighting is off in these pictures, so a clear road shows Clear. Another interim between west and east still belongs to this one block. Pair west straight to east, with no interim, and the same two signals still protect the block between them.

### A.2 Two more interims

The same block, with two more interims between west and east. An interim still cannot end a block. A train on any of the three occupies the whole block, so moving from one interim to the next does not change the signals.

![West boundary, three interims, and east boundary. West's right block, the three detectors, and east's left block are one block.](../_img/block-stretch-interims.svg)

West's right neighbour is `near-board/one`. Near pairs onward to mid, mid pairs onward to far, and far's other end is `east-board/left`. East's left neighbour is `far-board/two`. Each interim adds its own detector to this block and passes `next` through.

![Three interims, no train. Every signal shows Clear.](../_img/block-interims-1.svg)

![block/west-board/left is occupied. West facing that block shows Stop. East facing the train shows Approach, because the next signal is at Stop.](../_img/block-interims-2.svg)

![The middle interim is occupied. Near and far pass that on, and both signals facing this block show Stop.](../_img/block-interims-3.svg)

![East's right block is occupied. That signal shows Stop. West shows Approach.](../_img/block-interims-4.svg)

### A.3 Two blocks

West, mid, and east are boundaries. Near sits in the first block, between west and mid. Far sits in the second, between mid and east.

![Boundary, interim, boundary, interim, boundary. The first block runs from west to mid. The second runs from mid to east.](../_img/block-stretch-two.svg)

West's right neighbour is `near-board/one`, and near's other end is `mid-board/left`. Mid's right neighbour is `far-board/one`, and far's other end is `east-board/left`.

The signal on west that faces east protects the first block, and so does the signal on mid that faces west. The signal on mid that faces east protects the second block, and so does the signal on east that faces west.

![No train. Every signal shows Clear.](../_img/block-two-1.svg)

![West's left block is occupied. West shows Stop. Mid facing the train shows Approach. East facing the train shows Clear, or Advance Approach if that mast has it.](../_img/block-two-2.svg)

![The near interim is occupied. West facing east and mid facing west show Stop. East facing west shows Approach.](../_img/block-two-3.svg)

![The far interim is occupied. Mid facing east and east facing west show Stop. West shows Approach.](../_img/block-two-4.svg)

![East's right block is occupied. East shows Stop and mid shows Approach. West shows Clear, or Advance Approach if that mast has it.](../_img/block-two-5.svg)

Advance Approach is the block after the next. It is optional. A mast without it stays Clear. With it, west shows Advance Approach here, because both signal blocks are clear and the block past east is occupied.

### A.4 A junction with its neighbours

West is a boundary. Near is an interim in the approach. Points is the junction. Straight is an interim on the main, then east is a boundary. The branch leg of that same board is on the row below, then curve and branch.

![West boundary, an interim, a junction, then an interim and a boundary on the main and on the branch.](../_img/block-junction-stretch.svg)

West's right end pairs to near, and near's other end pairs to the throat. The main pairs to straight, and straight's other end pairs to east's left. The branch pairs to curve, and curve's other end pairs to branch's left.

![The main is lined. The points branch signal shows Stop. The branch boundary facing it shows Approach. The throat is Clear.](../_img/block-junction-main.svg)

![The branch is lined. East shows Approach. The throat shows Approach Diverging, or continues down the table without it. West shows Clear, or Advance Approach.](../_img/block-junction-branch.svg)

![The train is on the near interim. West shows Stop. The throat shows Approach Diverging. The diverging route is held, so the branch boundary shows Stop.](../_img/block-junction-approach.svg)

![The train is on the curve. The throat stays at Stop until the train passes the branch boundary. The points branch signal shows Clear. West shows Approach.](../_img/block-junction-diverging.svg)

With the main lined, the branch signal is Stop and the branch boundary shows Approach. With the branch lined and the road empty, the throat shows Approach Diverging, east shows Approach, and west shows Clear or Advance Approach. A train in the approach holds the diverging route, so the branch boundary stays at Stop while west shows Stop and the throat stays on Approach Diverging. Once that train is on the diverging route, the throat and the branch boundary show Stop, the branch signal shows Clear, and west shows Approach.
