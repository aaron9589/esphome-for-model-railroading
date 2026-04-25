# Screenshot Checklist

Work through these in order — earlier ones set up the context for later ones.

## installing-esphome-cheatsheet.md

- [ ] Docker Desktop main window — green **Engine running** indicator bottom-left
- [ ] VS Code Extensions panel — YAML by Red Hat showing as installed
- [ ] Docker Desktop **Settings → Resources → Network** — Enable host networking ticked
- [ ] EMQX http://localhost:18083 — login page, then Overview dashboard after sign-in
- [ ] ESPHome http://localhost:6052 — empty dashboard with **New Device** button

## first-board-setup-guide.md

- [ ] ESPHome Dashboard — empty, New Device button visible (same as above, can reuse)
- [ ] ESPHome **New Device** wizard — device name filled in, ESP32 selected
- [ ] ESPHome YAML editor — sample board.yaml pasted in, no red error banner
- [ ] VS Code Explorer — board folder expanded showing `board.yaml` + `modules/` subfolder with both yaml files inside
- [ ] VS Code — `secrets.yaml` open with all four keys filled in (use placeholder values, not real credentials)
- [ ] Chrome/Edge **Select a serial port** dialog — CP210x or CH340 port listed
- [ ] ESPHome flash progress — 100% complete screen
- [ ] ESPHome Dashboard — device tile showing **Online** badge + Logs panel open with boot lines
- [ ] EMQX **Clients** page — ESP board listed as a connected client

## jmri-mqtt-verification-guide.md

- [ ] JMRI Preferences → Connections → MQTT — broker IP, MQTT Channel, Sensor receive topic, Turnout send topic fields visible
- [ ] JMRI Sensor Table — new entry added, System Name and User Name filled in, State showing Unknown or Inactive
- [ ] ESPHome Logs — `OCCUPIED` and `UNOCCUPIED` lines scrolling as train placed/removed
- [ ] JMRI Sensor Table — State column showing **Active** with train on block
- [ ] JMRI Turnout Table — new entry added, State showing Unknown or Closed
- [ ] ESPHome Logs — `THROWN (reverse)` and `CLOSED (normal)` lines as JMRI turnout toggled
- [ ] JMRI Turnout Table — State column showing **Thrown**
- [ ] EMQX WebSocket Client — both MQTT messages visible: THROWN command from JMRI + THROWN state reply from ESP32
