# MSS-ESPHome in the configurator

This note is the configurator and the board web page for MSS-ESPHome. It is still being refined. The configurator does not generate this yet.

The configurator writes one `board.yaml`, the same file it already writes. A neighbour is stored as that end's address, such as `gap-board/one`.

## The pieces

![A boundary has the optic and the signals in the centre, and a block on each side. An interim is one block detector. A junction is a turnout with the optic in the centre, a throat block, a main block, and a diverging block.](../_img/block-overview.svg)

The page is a short track of these pieces. You drag a piece in and snap an end of one to an end of the next.

A **boundary** has a left socket and a right socket. The optic and the signals sit in the centre. A block detector sits on each side.

An **interim** is one block detector. Its sockets are Board one and Board two.

A **junction** has a throat socket, a main socket, and a branch socket. The turnout and its optic sit in the centre. The three block detectors are the throat (the approach and the turnout), the main route, and the diverging route.

Several pieces can sit on one ESP. Snapping two ends on that page writes both neighbour addresses. It does not use the pair topic. A socket you leave open is the end that meets the next module. That address stays empty until the web page pairs it.

Either interim socket can take either neighbour. You use each socket once.

## The web page

Open `http://<board-name>.local`.

A boundary shows Left and Right, each with Flash and Pair, and an address box. A junction shows Throat, Main, and Branch, each with Flash and Pair. An interim shows Board one and Board two, each with Pair and an address box. An interim has no Flash button.

**Flash** blinks the signals on that side so you can see which end the button is. Nothing is stored. Flash the boundary or the junction, then press Pair on the interim.

**Pair** follows the standard: one end offers, the other accepts, and the address box fills in. You can still correct the address by hand. Both boards must use the same signalled track, usually `main`. The broker address stays in the flashed file.

On a junction, thrown lines the branch. Untick that on the web page when thrown lines the main. Flash blinks the signal on the leg you are pairing.

## Signals

The Signals page still paints the lamps. The script uses the aspect name you type there. One mast, one signal.

Mark home signals, and the signals at a junction, as **Absolute**. Permissive signals follow the blocks.

Approach lighting is a switch per mast and starts off. It needs a Dark aspect with every lamp off. The same page has the brightness, blink, and pulse sliders.

The optic is a GPIO input for now, until the sensing circuit is filled in. Optical detectors and signal masts each have their own page. Skip this signalling when JMRI is still choosing every aspect.

The Blocks page stays the JMRI sensors (`trains/track/sensor/...`). A current sensor used here is one you already created there.

## CATS

In Designer, for each absolute mast:

- Check Hold on the signal template.
- Put the JMRI signal mast user name in the signal name field.
- Use a JMRI MQTT signal mast on `trains/track/signalmast/<name>`, with the same aspect names the Signals page shows.
- Leave the signal-head colour decoder fields empty. CATS is talking at mast level.

CATS lines points through the turnout topics the board already follows. With CATS closed, leave Absolute off.
