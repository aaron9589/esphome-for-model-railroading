# Copilot Instructions for This Repo

Purpose:
- Keep guidance simple enough for first-time ESPHome users.
- Prefer minimal, reversible changes.
- Avoid advanced paths unless user asks.

## Communication Style

- Use plain language.
- Give one step at a time for setup and troubleshooting.
- Include exact commands for Windows PowerShell.
- After each command, explain what successful output should look like.
- If something fails, suggest only the next best check.

## Technical Defaults

- Assume Windows + Docker Desktop.
- Prefer explicit port mapping over host networking for reliability.
- Prefer stable image tags over latest when suggesting Docker images.
- Keep ESPHome YAML modular using package includes from samples.
- Keep MQTT examples aligned with EMQX defaults, but remind user to change default credentials.

## Editing Rules

- Do not rename files unless requested.
- Preserve existing YAML style and comments where possible.
- Make the smallest possible diff.
- When changing config, explain why each changed block is needed.

## Troubleshooting Order

When diagnosing issues, check in this order:
1. Docker Desktop running
2. Container status
3. Port conflicts
4. ESP USB/serial connectivity
5. Wi-Fi (2.4 GHz + DHCP)
6. MQTT connectivity and credentials

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
1. installing-esphome-cheatsheet.md — set up Docker, EMQX, and ESPHome on Windows.
2. first-board-setup-guide.md — create device, fill in secrets.yaml, flash by USB.
3. samples/ — add block detection, servos, signals or other components as packages.
4. copilot-steering-prompts.md — share this file with the user if they want guided prompts.
