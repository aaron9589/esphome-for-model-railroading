# Screenshot Checklist

Work through these in order — earlier ones set up the context for later ones.

## installing-esphome-cheatsheet.md

- [ ] ESPHome Dashboard at http://localhost:6052 — empty, **New Device** button, menu-bar or tray icon visible
- [ ] MQTT Explorer connected to localhost:1883, subscribed to `#`, showing a test message

## first-board-setup-guide.md

- [ ] ESPHome Dashboard — empty, New Device button visible (same as above, can reuse)
- [ ] ESPHome **New Device** wizard — device name filled in, ESP32 selected
- [ ] ESPHome YAML editor — Configurator `board.yaml` pasted in, no red error banner
- [ ] VS Code Explorer — optional modules path: board folder expanded showing `board.yaml` + `modules/`
- [ ] Board Configurator — credentials filled (use placeholder values, not real credentials)
- [ ] Chrome/Edge **Select a serial port** dialog — CP210x or CH340 port listed
- [ ] ESPHome flash progress — 100% complete screen
- [ ] ESPHome Dashboard — device tile showing **Online** badge + Logs panel open with boot lines
- [ ] MQTT Explorer or `mosquitto_sub -t '#' -v` showing the board's topic after it comes online

## jmri-mqtt-verification-guide.md

- [ ] JMRI Preferences → Connections → MQTT — broker IP, MQTT Channel, Sensor receive topic, Turnout send topic fields visible
- [ ] JMRI Sensor Table — new entry added, System Name and User Name filled in, State showing Unknown or Inactive
- [ ] ESPHome Logs — `OCCUPIED` and `UNOCCUPIED` lines scrolling as train placed/removed
- [ ] JMRI Sensor Table — State column showing **Active** with train on block
- [ ] JMRI Turnout Table — new entry added, State showing Unknown or Closed
- [ ] ESPHome Logs — `THROWN (reverse)` and `CLOSED (normal)` lines as JMRI turnout toggled
- [ ] JMRI Turnout Table — State column showing **Thrown**
- [ ] MQTT Explorer — both MQTT messages visible: THROWN command from JMRI + THROWN state reply from ESP32
