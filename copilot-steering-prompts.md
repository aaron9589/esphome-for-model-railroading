# Copilot Steering Prompts (Beginner Friendly)

Use these prompts in VS Code Copilot Chat while this repo is open.

Tip:
- Paste one prompt at a time.
- Keep outputs short and practical.
- Ask Copilot to update files directly when possible.

---

## 1. First-Time Setup Check

Prompt:

```text
Review my environment for this repo and tell me exactly what to do next. The supported install is the one-liner in README.md (scripts/install-mac.sh or scripts/install-windows.ps1). Keep it beginner-friendly and only give one step at a time. Do not suggest Docker.
```

---

## 2. Broker and Dashboard Check

Prompt:

```text
Check my native ESPHome + Mosquitto setup against installing-esphome-cheatsheet.md. Give me a pass/fail checklist for the desktop app, Mosquitto listener 1883, and a mosquitto_pub/sub test. Include the exact commands for my OS and what success looks like. Do not suggest Docker.
```

---

## 3. Create First Board Config From Samples

Prompt:

```text
Use the samples in this repo to help me create my first board config. Ask me for board name, chip type, and Wi-Fi details, then produce the exact YAML edits.
```

---

## 4. Add MQTT to a Board YAML

Prompt:

```text
Help me add MQTT config to my ESPHome board YAML for Mosquitto on this PC. Broker is the PC's LAN IP, port 1883, no username. Explain each field in one sentence.
```

---

## 5. Troubleshoot First Flash

Prompt:

```text
My first USB flash is failing. Give me a fastest-path troubleshooting flow for Windows or Mac, including cable, driver, serial port, and Chrome/Edge checks. Stop after each step and wait for my result.
```

---

## 6. Troubleshoot Wi-Fi Provisioning

Prompt:

```text
My ESP device flashed but will not come online over Wi-Fi. Give me the top 5 likely causes and exact checks in order, with expected output for each check.
```

---

## 7. Safe Refactor Request

Prompt:

```text
Refactor my ESPHome YAML to be simpler and easier to maintain using packages from the samples folder. Keep behavior unchanged and show the final diff.
```

---

## 8. Ask Copilot to Teach, Not Just Fix

Prompt:

```text
Explain what this YAML is doing like I am new to ESPHome. Use short sections: purpose, inputs, outputs, and what to change safely.
```

---

## 9. JMRI/CATS Integration Help

Prompt:

```text
Using this repo context, help me map one sensor topic and one turnout topic between ESPHome MQTT and JMRI/CATS. Give concrete topic examples and naming rules.
```

---

## 10. Quick Recovery Prompt

Prompt:

```text
I broke my config. Compare my board YAML with the samples and suggest the minimum edits to get back to a working baseline.
```

---

## Best Results Pattern

You can append this line to any prompt:

```text
Keep this beginner-safe: one step at a time, include exact commands, and tell me what output confirms success before moving on.
```
