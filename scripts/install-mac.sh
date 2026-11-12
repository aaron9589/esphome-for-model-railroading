#!/bin/bash
# ESPHome Device Builder + Mosquitto setup for macOS.
# Anonymous MQTT on port 1883 is for a trusted home network only.
# Re-running this script is safe: it skips what is already in place.
#
# One line (Terminal). Do not pipe this into bash — the menu needs your keyboard.
#   curl -fsSL https://raw.githubusercontent.com/aaron9589/esphome-for-model-railroading/main/scripts/install-mac.sh -o /tmp/esphome-mr-setup.sh && bash /tmp/esphome-mr-setup.sh

set -euo pipefail

LOG="${HOME}/Library/Logs/esphome-mr-setup.log"
MARKER_BEGIN="# BEGIN esphome-for-model-railroading"
MARKER_END="# END esphome-for-model-railroading"
MIN_FREE_GB=8

mkdir -p "${HOME}/Library/Logs"
touch "$LOG"

log() {
  local line="[$(date '+%H:%M:%S')] $*"
  printf '%s\n' "$line" | tee -a "$LOG" >&2
}

report_issue() {
  trap - ERR
  log ""
  log "Setup failed. Copy the error above and this log, then raise a GitHub issue:"
  log "  https://github.com/aaron9589/esphome-for-model-railroading/issues/new"
  log "Paste the error text and the contents of:"
  log "  $LOG"
}

die() {
  log "ERROR: $*"
  log "Full log: $LOG"
  report_issue
  exit 1
}

on_err() {
  local code=$?
  log "FAILED near line ${BASH_LINENO[0]} (exit ${code})."
  log "Full log: $LOG"
  report_issue
  exit "$code"
}
trap on_err ERR

step() {
  log ""
  log "======== $* ========"
}

ok() { log "  OK   $*"; }
warn() { log "  WARN $*"; }

load_brew() {
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

require_mac_user() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    die "This script is for macOS. On Windows, use scripts/install-windows.ps1."
  fi
  if [[ "${EUID}" -eq 0 ]]; then
    die "Do not run this with sudo. Run it as your normal user. It will ask for a password only when it needs one."
  fi
}

choose_action() {
  printf '\nESPHome for Model Railroading\n\n' >&2
  printf '  1) Install    ESPHome Device Builder and Mosquitto\n' >&2
  printf '  2) Uninstall  those two (keeps Homebrew and your board files)\n' >&2
  printf '  3) Quit\n\n' >&2
  local choice
  while true; do
    printf 'Choose 1, 2, or 3: ' >&2
    if ! read -r choice; then
      die "Could not read a choice. Run the script in Terminal, not with 'curl | bash'."
    fi
    case "$choice" in
      1|install) printf '%s\n' install; return ;;
      2|uninstall) printf '%s\n' uninstall; return ;;
      3|q|quit) printf '%s\n' quit; return ;;
      *) printf 'Type 1, 2, or 3.\n' >&2 ;;
    esac
  done
}

cmd_uninstall() {
  step "Uninstall"
  log "This removes the ESPHome Device Builder app and the Mosquitto broker."
  log "Homebrew stays. Board files in ${HOME}/esphome stay."
  printf 'Type uninstall to continue: ' >&2
  local confirm
  if ! read -r confirm; then
    die "Could not read a confirmation."
  fi
  if [[ "$confirm" != "uninstall" ]]; then
    log "Cancelled. Nothing was removed."
    exit 0
  fi

  osascript -e 'quit app "ESPHome Device Builder"' >/dev/null 2>&1 || true
  if [[ -d "/Applications/ESPHome Device Builder.app" ]]; then
    log "  Removing /Applications/ESPHome Device Builder.app (password prompt is normal)..."
    sudo rm -rf "/Applications/ESPHome Device Builder.app"
    ok "Removed ESPHome Device Builder"
  else
    ok "ESPHome Device Builder was not in /Applications"
  fi

  load_brew
  local mosq_bin=""
  if command -v brew >/dev/null 2>&1; then
    local prefix
    prefix="$(brew --prefix mosquitto 2>/dev/null || true)"
    if [[ -n "$prefix" && -x "$prefix/sbin/mosquitto" ]]; then
      mosq_bin="$prefix/sbin/mosquitto"
    elif [[ -n "$prefix" && -x "$prefix/bin/mosquitto" ]]; then
      mosq_bin="$prefix/bin/mosquitto"
    fi
    if brew list mosquitto >/dev/null 2>&1; then
      brew services stop mosquitto >/dev/null 2>&1 || true
      brew uninstall mosquitto
      ok "Removed Mosquitto"
    else
      ok "Mosquitto was not installed with Homebrew"
    fi
    if [[ -n "$mosq_bin" ]]; then
      sudo /usr/libexec/ApplicationFirewall/socketfilterfw --remove "$mosq_bin" >/dev/null 2>&1 || true
    fi
  else
    warn "Homebrew is not installed, so this script did not remove Mosquitto."
  fi

  step "Done"
  log "Uninstall finished."
  log "Left in place: Homebrew, and any board YAML in ${HOME}/esphome"
  log "Full log: $LOG"
}

cmd_install() {
step "ESPHome for Model Railroading — Mac setup"
log "This installs the ESPHome Device Builder app and the Mosquitto MQTT broker."
log "You may be asked for your Mac login password (the one you use to unlock the Mac)."
log "Log file: $LOG"

step "1/7 Preflight"
load_brew

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) ESPHOME_ASSET_SUFFIX="_aarch64.dmg"; ok "Apple Silicon ($ARCH)" ;;
  x86_64)
    ESPHOME_ASSET_SUFFIX="_x64.dmg"
    warn "Intel Mac. ESPHome is dropping Intel Mac support (around 2027.6). This still installs today's x64 app."
    ;;
  *) die "Unrecognised CPU architecture: $ARCH" ;;
esac

PRODUCT_VERSION="$(sw_vers -productVersion)"
log "  macOS $PRODUCT_VERSION"
MAJOR="${PRODUCT_VERSION%%.*}"
REST="${PRODUCT_VERSION#*.}"
MINOR="${REST%%.*}"
if [[ "$MAJOR" -lt 10 ]] || { [[ "$MAJOR" -eq 10 ]] && [[ "$MINOR" -lt 15 ]]; }; then
  die "Need macOS 10.15 Catalina or newer. This Mac is $PRODUCT_VERSION."
fi
ok "macOS version is new enough"

FREE_GB="$(df -g / | awk 'NR==2 {print $4}')"
log "  Free space on / : ${FREE_GB} GB (ESPHome's first compile downloads a few GB of tools)"
if [[ "${FREE_GB}" -lt "${MIN_FREE_GB}" ]]; then
  die "Need at least ${MIN_FREE_GB} GB free. Free some space and run this again."
fi
ok "Enough disk space"

if ! curl -fsS --max-time 20 -o /dev/null -H "User-Agent: esphome-for-model-railroading-setup" https://github.com; then
  die "Cannot reach github.com. Check Wi-Fi, then run this again."
fi
ok "Internet works"

if ! xcode-select -p >/dev/null 2>&1; then
  log "  macOS command line tools are not installed. Opening the installer popup."
  xcode-select --install || true
  die "Click Install on the popup, wait until it finishes, then run this same command again."
fi
ok "Command line tools are installed"

if ! command -v python3 >/dev/null 2>&1; then
  die "python3 is missing even after command line tools. Install them from Software Update and run this again."
fi

if lsof -nP -iTCP:1883 -sTCP:LISTEN >/dev/null 2>&1; then
  OWNER="$(lsof -nP -iTCP:1883 -sTCP:LISTEN | awk 'NR==2 {print $1}')"
  if [[ "$OWNER" == "mosquitto" ]]; then
    ok "Port 1883 is already Mosquitto. Config will be checked."
  else
    die "Port 1883 is in use by '${OWNER}', not Mosquitto. Quit that program (old EMQX/Docker counts) and run this again."
  fi
else
  ok "Port 1883 is free"
fi

if lsof -nP -iTCP:6052 -sTCP:LISTEN >/dev/null 2>&1; then
  warn "Port 6052 is already in use. If that is ESPHome, the dashboard is already up. If not, quit the other app before opening the dashboard."
else
  ok "Port 6052 is free"
fi

step "2/7 Homebrew"
load_brew

if ! command -v brew >/dev/null 2>&1; then
  log "  Homebrew is not installed. Installing it now."
  log "  The installer will ask for your Mac password."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  else
    die "Homebrew installed but brew is not on PATH. Close Terminal, open a new window, and run this again."
  fi
fi
ok "Homebrew $(brew --version | head -n 1)"

step "3/7 Mosquitto"
if brew list mosquitto >/dev/null 2>&1; then
  ok "Mosquitto is already installed. Checking the config."
else
  log "  Installing Mosquitto..."
  brew install mosquitto
  ok "Mosquitto installed"
fi

CONF="$(brew --prefix)/etc/mosquitto/mosquitto.conf"
mkdir -p "$(dirname "$CONF")"
if [[ ! -f "$CONF" ]]; then
  log "  No config file yet. Creating $CONF"
  touch "$CONF"
fi

BACKUP="${CONF}.esphome-mr-backup"
cp -p "$CONF" "$BACKUP"
log "  Backed up config to $BACKUP"

python3 - "$CONF" "$MARKER_BEGIN" "$MARKER_END" <<'PY'
import sys
from pathlib import Path
path, begin, end = sys.argv[1:]
text = Path(path).read_text(encoding="utf-8", errors="replace")
lines = text.splitlines()
cleaned = []
skip = False
for line in lines:
    if line.strip() == begin:
        skip = True
        continue
    if skip:
        if line.strip() == end:
            skip = False
        continue
    stripped = line.strip()
    if stripped.startswith("allow_anonymous ") or stripped.startswith("bind_address "):
        cleaned.append("# " + line + "  # disabled by esphome-for-model-railroading setup")
        continue
    if stripped.startswith("listener ") and "127.0.0.1" in stripped:
        cleaned.append("# " + line + "  # disabled: was localhost-only")
        continue
    cleaned.append(line)

joined = "\n".join(cleaned)
has_lan_listener = False
for line in cleaned:
    s = line.strip()
    if not s.startswith("listener "):
        continue
    parts = s.split()
    if len(parts) >= 2 and parts[1] == "1883" and (len(parts) == 2 or parts[2] not in ("127.0.0.1", "localhost", "::1")):
        has_lan_listener = True
        break

block = [begin, "allow_anonymous true"]
if not has_lan_listener:
    block.append("listener 1883")
block.append(end)
out = joined.rstrip() + "\n\n" + "\n".join(block) + "\n"
Path(path).write_text(out, encoding="utf-8")
print("lan_listener_added" if not has_lan_listener else "lan_listener_kept")
PY
ok "Mosquitto will accept connections on port 1883 with no username (home network)"

log "  Starting Mosquitto so it comes back after a reboot..."
brew services restart mosquitto
sleep 2

if ! lsof -nP -iTCP:1883 -sTCP:LISTEN >/dev/null 2>&1; then
  die "Mosquitto did not start. Look at: brew services info mosquitto"
fi
ok "Mosquitto is listening on port 1883"

SUB_OUT="$(mktemp)"
mosquitto_sub -h 127.0.0.1 -t 'esphome-mr/setup-test' -C 1 -W 8 >"$SUB_OUT" &
SUB_PID=$!
sleep 1
mosquitto_pub -h 127.0.0.1 -t 'esphome-mr/setup-test' -m 'Mosquitto works'
wait "$SUB_PID" || true
if ! grep -q "Mosquitto works" "$SUB_OUT"; then
  rm -f "$SUB_OUT"
  die "Local publish/subscribe test failed. Mosquitto is not accepting clients on this Mac."
fi
rm -f "$SUB_OUT"
ok "Publish/subscribe test passed on this Mac"

LAN_IP=""
for iface in en0 en1 bridge0; do
  if ipconfig getifaddr "$iface" >/dev/null 2>&1; then
    LAN_IP="$(ipconfig getifaddr "$iface")"
    break
  fi
done

if [[ -n "$LAN_IP" ]]; then
  if python3 - "$LAN_IP" <<'PY'
import socket, sys
s = socket.create_connection((sys.argv[1], 1883), timeout=5)
s.close()
PY
  then
    mosquitto_pub -h "$LAN_IP" -t 'esphome-mr/setup-test' -m 'lan-ok'
    ok "Broker accepts connections on LAN IP $LAN_IP"
  else
    warn "Could not connect to ${LAN_IP}:1883. Boards on Wi-Fi will not connect until this works. Check the firewall prompt."
  fi
else
  warn "Could not find a LAN IP. Use System Settings → Network and put that address in the Configurator."
fi

FW_STATE="$(/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null || true)"
MOSQ_BIN="$(brew --prefix mosquitto)/sbin/mosquitto"
if [[ ! -x "$MOSQ_BIN" ]]; then
  MOSQ_BIN="$(brew --prefix mosquitto)/bin/mosquitto"
fi
if echo "$FW_STATE" | grep -qi "enabled"; then
  log "  macOS firewall is on. Allowing Mosquitto through it (password prompt is normal)."
  sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "$MOSQ_BIN" || warn "Could not add Mosquitto to the firewall. If boards cannot connect, allow incoming connections for mosquitto."
  sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp "$MOSQ_BIN" || true
  ok "Firewall rule requested for Mosquitto"
else
  ok "macOS firewall is off, so boards can reach port 1883"
fi

step "4/7 ESPHome Device Builder"
log "  Asking GitHub for the latest official desktop app..."
RELEASE_JSON="$(curl -fsSL -H "User-Agent: esphome-for-model-railroading-setup" -H "Accept: application/vnd.github+json" https://api.github.com/repos/esphome/esphome-desktop/releases/latest)"
PARSED="$(RELEASE_JSON="$RELEASE_JSON" python3 - "$ESPHOME_ASSET_SUFFIX" <<'PY'
import json, os, sys
suffix = sys.argv[1]
data = json.loads(os.environ["RELEASE_JSON"])
tag = data.get("tag_name", "")
version = tag[1:] if tag.startswith("v") else tag
url = ""
for asset in data.get("assets", []):
    if asset.get("name", "").endswith(suffix):
        url = asset["browser_download_url"]
        break
if not url or not version:
    sys.exit("Could not find an ESPHome desktop download in the latest GitHub release.")
print(version)
print(url)
PY
)"
ESPHOME_VERSION="$(printf '%s\n' "$PARSED" | sed -n '1p')"
ESPHOME_URL="$(printf '%s\n' "$PARSED" | sed -n '2p')"
log "  Latest ESPHome Device Builder: $ESPHOME_VERSION"
log "  Download: $ESPHOME_URL"

APP="/Applications/ESPHome Device Builder.app"
INSTALLED=""
if [[ -d "$APP" ]]; then
  INSTALLED="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || true)"
  log "  Already installed: ${INSTALLED:-unknown}"
fi

if [[ -n "$INSTALLED" && "$INSTALLED" == "$ESPHOME_VERSION" ]]; then
  ok "ESPHome Device Builder $INSTALLED is already the latest. Skipping download."
else
  WORK="$(mktemp -d)"
  log "  Downloading the disk image (this is about 100 MB)..."
  curl -fL --retry 3 --retry-delay 2 -o "$WORK/ESPHome.dmg" "$ESPHOME_URL"
  MOUNT="$WORK/mnt"
  mkdir -p "$MOUNT"
  hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT" "$WORK/ESPHome.dmg" >/dev/null
  SRC_APP="$(find "$MOUNT" -maxdepth 2 -name '*.app' -print -quit)"
  if [[ -z "$SRC_APP" ]]; then
    hdiutil detach "$MOUNT" >/dev/null || true
    die "The disk image did not contain an app."
  fi
  log "  Copying into /Applications (password prompt is normal)..."
  sudo rm -rf "$APP"
  sudo ditto "$SRC_APP" "$APP"
  sudo chown -R "$(whoami):staff" "$APP" || sudo chown -R "$(whoami)" "$APP"
  sudo xattr -dr com.apple.quarantine "$APP" || true
  hdiutil detach "$MOUNT" >/dev/null || true
  rm -rf "$WORK"
  ok "Installed ESPHome Device Builder $ESPHOME_VERSION"
fi

step "5/7 Open the dashboard"
log "  Launching ESPHome. The first time, it downloads its own Python and can sit there for several minutes."
log "  When it is ready it opens http://localhost:6052"
open -a "ESPHome Device Builder" || warn "Could not launch the app. Open ESPHome Device Builder from Applications."

step "6/7 What you should see"
log "  Menu bar: an ESPHome icon. Use Open Dashboard and Open Config Folder."
log "  Config files: ${HOME}/esphome"
log "  Dashboard:    http://localhost:6052"
if [[ -n "$LAN_IP" ]]; then
  log "  MQTT broker:  ${LAN_IP}   port 1883   no username or password"
else
  log "  MQTT broker:  (your LAN IP from System Settings → Network)   port 1883"
fi
log "  Put that LAN IP in the Configurator and in JMRI. Do not use localhost in the board YAML."

step "7/7 Done"
log "Setup finished."
log "Next: https://aaron9589.github.io/esphome-for-model-railroading/  then first-board-setup-guide.md"
log "Full log: $LOG"
}

require_mac_user
if [[ ! -t 0 || ! -t 1 ]]; then
  log "This setup asks whether to install or uninstall, so it has to run in Terminal."
  log "Paste this instead of piping the script into bash:"
  log "  curl -fsSL https://raw.githubusercontent.com/aaron9589/esphome-for-model-railroading/main/scripts/install-mac.sh -o /tmp/esphome-mr-setup.sh && bash /tmp/esphome-mr-setup.sh"
  exit 1
fi

ACTION="${1:-}"
if [[ -z "$ACTION" ]]; then
  ACTION="$(choose_action)"
fi
log "Selected: $ACTION"
case "$ACTION" in
  install) cmd_install ;;
  uninstall) cmd_uninstall ;;
  quit) log "Cancelled. Nothing was changed."; exit 0 ;;
  *) die "Unknown action '$ACTION'. Use: bash install-mac.sh [install|uninstall]" ;;
esac
