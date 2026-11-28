# Screenshot Checklist

Work through these in order — earlier ones set up the context for later ones.

## first-board-setup-guide.md

- [ ] ESPHome Dashboard at http://localhost:6052 — empty, **New Device** button, menu-bar or tray icon visible
- [ ] MQTTX connected to localhost:1883, subscribed to `#`, showing a test message
- [ ] ESPHome **New Device** wizard — device name filled in, ESP32 selected
- [ ] ESPHome YAML editor — Configurator `board.yaml` pasted in, no red error banner
- [ ] Board Configurator — credentials filled (use placeholder values, not real credentials)
- [ ] Chrome/Edge **Select a serial port** dialog — CP210x or CH340 port listed
- [ ] ESPHome flash progress — 100% complete screen
- [ ] ESPHome Dashboard — device tile showing **Online** badge + Logs panel open with boot lines
- [ ] MQTTX or `mosquitto_sub -t '#' -v` showing the board's topic after it comes online

## jmri-mqtt-verification-guide.md

- [ ] JMRI Preferences → Connections → MQTT — broker IP, MQTT Channel, Sensor receive topic, Turnout send topic fields visible
- [ ] JMRI Sensor Table — new entry added, System Name and User Name filled in, State showing Unknown or Inactive
- [ ] ESPHome Logs — `OCCUPIED` and `UNOCCUPIED` lines scrolling as train placed/removed
- [ ] JMRI Sensor Table — State column showing **Active** with train on block
- [ ] JMRI Turnout Table — new entry added, State showing Unknown or Closed
- [ ] ESPHome Logs — `THROWN (reverse)` and `CLOSED (normal)` lines as JMRI turnout toggled
- [ ] JMRI Turnout Table — State column showing **Thrown**
- [ ] MQTTX — both MQTT messages visible: THROWN command from JMRI + THROWN state reply from ESP32

## field-logic-guide.md and mss-logic-guide.md

Pictures of the configurator in these two guides are not on this list. They are taken by a script that follows each guide in a browser (`configurator/test/screenshots/`); run it again when the page changes. These are the pictures it cannot take: hardware, MQTTX, JMRI and the board's own web page.

Field Logic guide:

- [ ] Sketch of Int 2: the current detector's feeder across the whole block, and an optical sensor in the track at each end (*The worked example*)
- [ ] MQTTX showing `trains/track/sensor/Int 2` and `trains/track/sensor/Int 2 East` both ACTIVE, and the board's Online topic (*Step 6*)
- [ ] JMRI Sensor Table with `MSInt 2` Active and the board's Online sensor (*Step 7*)
- [ ] Sketch of the gauntlet: two tracks converging onto a bridge, blocks Left, Bridge and Right marked, and a signal at each end of the bridge (*The gauntlet over a bridge*)
- [ ] MQTTX showing the Bridge Held and State topics, and Left Bridge's State (*Check it in MQTTX*)
- [ ] The board's web page with the Field logic switch, Logic version and the Release Bridge button (*Check it in MQTTX*)
- [ ] The board's web page with Pair End A, End A link (empty) and End A state (*Not paired*) (*Step D*)
- [ ] Two boards side by side, one LED blinking slowly, then both steady (*Step E*)
- [ ] MQTTX showing the end topics for both boards, with Link set on each (*Step F*)

MSS Logic guide:

- [ ] Sketch of the two modules side by side. West: end A, Block 1, IR 1 with a signal each way, Block 2, end B. East: end A, Block 1, Points 1, the main line and the siding, Points 2, Block 3, end B (*The three MSS boards*)
- [ ] East's web page with Pair End A, End A paired and heard, and MQTTX showing the two end topics (*Step 8*)
