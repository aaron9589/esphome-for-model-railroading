# Copilot Instructions for This Repo

Purpose:
- Keep guidance simple enough for first-time ESPHome users.
- Prefer minimal, reversible changes.
- Avoid advanced paths unless user asks.

## Communication Style

- Use plain language.
- Give one step at a time for setup and troubleshooting.
- Include exact commands for the user's OS (Windows PowerShell or macOS Terminal).
- After each command, explain what successful output should look like.
- If something fails, suggest only the next best check.

## Technical Defaults

- Assume the ESPHome Device Builder desktop app and native Mosquitto. Do not suggest Docker unless the user already uses it and asks to keep it.
- MQTT is Mosquitto on port 1883, anonymous on a trusted home LAN, broker address = the PC's LAN IP (never localhost in board YAML).
- Beginner YAML comes from the Board Configurator (credentials embedded). Modular `samples/` + `secrets.yaml` is the hand-edit path only.

## Editing Rules

- Do not rename files unless requested.
- Preserve existing YAML style and comments where possible.
- Make the smallest possible diff.
- When changing config, explain why each changed block is needed.

## Troubleshooting Order

When diagnosing issues, check in this order:
1. ESPHome Device Builder running (http://localhost:6052)
2. Mosquitto running and listening on 1883 (not local-only)
3. Port conflicts (1883, 6052)
4. ESP USB/serial connectivity
5. Wi-Fi (2.4 GHz + DHCP)
6. MQTT broker IP is the PC's LAN address, and firewall allows inbound 1883

## Safety

- Never expose or log real passwords in docs.
- Tell users to move secrets to secrets.yaml when relevant.
- Prefer examples with placeholder values.

## Repo-Aware Suggestions

- Point users to sample files in samples for reusable configs.
- Point users to installing-esphome-cheatsheet.md for first-time environment setup.
- Point users to first-board-setup-guide.md for first board configuration steps.
- Point users to copilot-steering-prompts.md for copy-paste prompts they can use in this chat.
- Keep recommendations aligned with the model railroading use case in README.md.

## Beginner Onboarding Path

If a user seems new, guide them through this order without skipping steps:
1. installing-esphome-cheatsheet.md — install ESPHome Device Builder and Mosquitto on Windows or Mac.
2. first-board-setup-guide.md — paste Configurator YAML, flash by USB, confirm MQTT with mosquitto_sub.
3. samples/ — add block detection, servos, signals or other components as packages.
4. copilot-steering-prompts.md — share this file with the user if they want guided prompts.
