#!/bin/bash
# ESPHome Device Builder + Mosquitto + MQTTX setup for macOS.
# Anonymous MQTT on port 1883 is for a trusted home network only.
# Re-running this script is safe: it skips what is already in place.
#
# One line (Terminal). Do not pipe this into bash — the menu needs your keyboard.
#   curl -fsSL https://raw.githubusercontent.com/aaron9589/esphome-for-model-railroading/main/scripts/install-mac.sh -o /tmp/esphome-mr-setup.sh && bash /tmp/esphome-mr-setup.sh

set -euo pipefail

LOG="${HOME}/Library/Logs/esphome-mr-setup.log"
CONFIGURATOR_URL="https://aaron9589.github.io/esphome-for-model-railroading/"
MARKER_BEGIN="# BEGIN esphome-for-model-railroading"
MARKER_END="# END esphome-for-model-railroading"
MIN_FREE_GB=8

mkdir -p "${HOME}/Library/Logs"
touch "$LOG"

# TUI: colour when stderr is a real terminal; plain text in the log file.
USE_COLOR=0
if [[ -t 2 && -z "${NO_COLOR:-}" && "${TERM:-}" != "dumb" ]]; then
  USE_COLOR=1
fi

if [[ "$USE_COLOR" -eq 1 ]]; then
  C_RESET=$'\033[0m'
  C_BOLD=$'\033[1m'
  C_DIM=$'\033[2m'
  C_ACCENT=$'\033[38;5;214m'   # amber — brand
  C_STEP=$'\033[38;5;75m'      # soft blue — section headers
  C_OK=$'\033[38;5;114m'       # soft green — success
  C_WARN=$'\033[38;5;221m'     # soft yellow — caution
  C_ERR=$'\033[38;5;203m'      # soft red — failure
  C_MUTE=$'\033[38;5;245m'     # gray — secondary
  C_TEXT=$'\033[38;5;252m'     # near-white body
else
  C_RESET='' C_BOLD='' C_DIM='' C_ACCENT='' C_STEP='' C_OK='' C_WARN='' C_ERR='' C_MUTE='' C_TEXT=''
fi

strip_ansi() {
  # Remove CSI / OSC sequences so the log stays readable in a text editor.
  printf '%s' "$1" | sed -E $'s/\033\\[[0-9;?]*[A-Za-z]//g; s/\033\\][^\007]*\007//g'
}

log_file() {
  local plain
  plain="$(strip_ansi "$*")"
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$plain" >>"$LOG"
}

say() {
  # Body text on the terminal; always mirrored (plain) to the log.
  printf '%s%s%s\n' "$C_TEXT" "$*" "$C_RESET" >&2
  log_file "$*"
}

log() {
  # Back-compat alias used throughout the script.
  say "$*"
}

banner() {
  local subtitle="${1:-macOS setup}"
  printf '\n' >&2
  printf '%s%s╭──────────────────────────────────────────────────────╮%s\n' "$C_ACCENT" "$C_BOLD" "$C_RESET" >&2
  printf '%s%s│%s  %sESPHome%s for Model Railroading                       %s%s│%s\n' \
    "$C_ACCENT" "$C_BOLD" "$C_RESET" "$C_BOLD" "$C_RESET$C_TEXT" "$C_ACCENT" "$C_BOLD" "$C_RESET" >&2
  printf '%s%s│%s  %s%-52s%s%s│%s\n' \
    "$C_ACCENT" "$C_BOLD" "$C_RESET" "$C_MUTE" "$subtitle" "$C_ACCENT" "$C_BOLD" "$C_RESET" >&2
  printf '%s%s╰──────────────────────────────────────────────────────╯%s\n\n' "$C_ACCENT" "$C_BOLD" "$C_RESET" >&2
  log_file "ESPHome for Model Railroading — $subtitle"
}

step() {
  local title="$*"
  printf '\n' >&2
  printf '%s%s── %s %s%s\n' "$C_STEP" "$C_BOLD" "$title" "$(printf '─%.0s' {1..40})" "$C_RESET" >&2
  log_file "======== $title ========"
}

ok() {
  printf '  %s✓%s  %s%s%s\n' "$C_OK" "$C_RESET" "$C_TEXT" "$*" "$C_RESET" >&2
  log_file "  OK   $*"
}

warn() {
  printf '  %s!%s  %s%s%s\n' "$C_WARN" "$C_RESET" "$C_WARN" "$*" "$C_RESET" >&2
  log_file "  WARN $*"
}

info() {
  printf '  %s·%s  %s%s%s\n' "$C_MUTE" "$C_RESET" "$C_MUTE" "$*" "$C_RESET" >&2
  log_file "  ..   $*"
}

kv() {
  # Label / value pair for the summary panel.
  printf '  %s%-14s%s %s%s%s\n' "$C_MUTE" "$1" "$C_RESET" "$C_TEXT" "$2" "$C_RESET" >&2
  log_file "  $1 $2"
}

offer_configurator() {
  local lan_ip="${1:-}"
  step "Next: Board Configurator"
  say "Your Mac is ready. Next you build board.yaml in the Board Configurator."
  if [[ -n "$lan_ip" ]]; then
    info "When the form asks for the MQTT broker IP, use ${lan_ip}."
  else
    info "When the form asks for the MQTT broker IP, use this Mac's LAN address (System Settings → Network)."
  fi
  printf '\n' >&2
  printf '  %sPress Enter%s to open the Configurator in your browser\n' "$C_BOLD" "$C_RESET" >&2
  printf '  %s(or type n then Enter to skip)%s\n\n' "$C_MUTE" "$C_RESET" >&2
  printf '  %s>%s ' "$C_ACCENT" "$C_RESET" >&2
  local ans=""
  if ! read -r ans; then
    info "Skipped. Open later: $CONFIGURATOR_URL"
    return
  fi
  case "$ans" in
    n|N|q|Q|no|No)
      info "Skipped. Open later: $CONFIGURATOR_URL"
      ;;
    *)
      open "$CONFIGURATOR_URL" || warn "Could not open a browser. Go to: $CONFIGURATOR_URL"
      ok "Opened Board Configurator"
      info "Click My first board, fill Wi-Fi and the MQTT broker IP, then Download board.yaml."
      ;;
  esac
}

report_issue() {
  trap - ERR
  printf '\n' >&2
  printf '%s%sSetup failed.%s Copy the error above and this log, then raise a GitHub issue:\n' "$C_ERR" "$C_BOLD" "$C_RESET" >&2
  printf '  %shttps://github.com/aaron9589/esphome-for-model-railroading/issues/new%s\n' "$C_STEP" "$C_RESET" >&2
  printf '  Paste the error text and the contents of:\n' >&2
  printf '  %s%s%s\n' "$C_MUTE" "$LOG" "$C_RESET" >&2
  log_file "Setup failed. Raise a GitHub issue with the contents of $LOG"
}

die() {
  printf '  %s✗%s  %s%s%s\n' "$C_ERR" "$C_RESET" "$C_ERR" "$*" "$C_RESET" >&2
  log_file "ERROR: $*"
  info "Full log: $LOG"
  report_issue
  exit 1
}

on_err() {
  local code=$?
  printf '  %s✗%s  %sFAILED near line %s (exit %s).%s\n' "$C_ERR" "$C_RESET" "$C_ERR" "${BASH_LINENO[0]}" "$code" "$C_RESET" >&2
  log_file "FAILED near line ${BASH_LINENO[0]} (exit ${code})."
  info "Full log: $LOG"
  report_issue
  exit "$code"
}
trap on_err ERR

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
  banner "macOS setup"
  printf '  %sWhat would you like to do?%s\n\n' "$C_BOLD" "$C_RESET" >&2
  printf '  %s┌─ 1 ─┐%s  %sInstall%s    ESPHome, Mosquitto, and MQTTX\n' "$C_OK" "$C_RESET" "$C_BOLD" "$C_RESET" >&2
  printf '  %s┌─ 2 ─┐%s  %sUninstall%s  those three (keeps Homebrew and board files)\n' "$C_WARN" "$C_RESET" "$C_BOLD" "$C_RESET" >&2
  printf '  %s┌─ 3 ─┐%s  Quit\n\n' "$C_MUTE" "$C_RESET" >&2
  info "A full copy of this run is saved to $LOG"
  printf '\n' >&2
  local choice
  while true; do
    printf '  %sChoose%s [%s1%s/%s2%s/%s3%s]: ' "$C_BOLD" "$C_RESET" "$C_OK" "$C_RESET" "$C_WARN" "$C_RESET" "$C_MUTE" "$C_RESET" >&2
    if ! read -r choice; then
      die "Could not read a choice. Run the script in Terminal, not with 'curl | bash'."
    fi
    case "$choice" in
      1|install) printf '%s\n' install; return ;;
      2|uninstall) printf '%s\n' uninstall; return ;;
      3|q|quit) printf '%s\n' quit; return ;;
      *) printf '  %sType 1, 2, or 3.%s\n' "$C_WARN" "$C_RESET" >&2 ;;
    esac
  done
}

cmd_uninstall() {
  step "Uninstall"
  say "This removes ESPHome Device Builder, Mosquitto, and MQTTX."
  info "Homebrew stays. Board files in ${HOME}/esphome stay."
  printf '\n  %sType uninstall to continue:%s ' "$C_BOLD" "$C_RESET" >&2
  local confirm
  if ! read -r confirm; then
    die "Could not read a confirmation."
  fi
  if [[ "$confirm" != "uninstall" ]]; then
    warn "Cancelled. Nothing was removed."
    exit 0
  fi

  osascript -e 'quit app "ESPHome Device Builder"' >/dev/null 2>&1 || true
  osascript -e 'quit app "MQTTX"' >/dev/null 2>&1 || true
  osascript -e 'quit app "MQTT Explorer"' >/dev/null 2>&1 || true
  if [[ -d "/Applications/ESPHome Device Builder.app" ]]; then
    info "Removing /Applications/ESPHome Device Builder.app (password prompt is normal)..."
    sudo rm -rf "/Applications/ESPHome Device Builder.app"
    ok "Removed ESPHome Device Builder"
  else
    ok "ESPHome Device Builder was not in /Applications"
  fi

  load_brew
  if command -v brew >/dev/null 2>&1 && brew list --cask mqttx >/dev/null 2>&1; then
    brew uninstall --cask mqttx
    ok "Removed MQTTX"
  elif [[ -d "/Applications/MQTTX.app" ]]; then
    info "Removing /Applications/MQTTX.app (password prompt is normal)..."
    sudo rm -rf "/Applications/MQTTX.app"
    ok "Removed MQTTX"
  else
    ok "MQTTX was not installed"
  fi
  if [[ -d "/Applications/MQTT Explorer.app" ]]; then
    info "Removing leftover MQTT Explorer.app..."
    sudo rm -rf "/Applications/MQTT Explorer.app"
    ok "Removed leftover MQTT Explorer"
  fi

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
  ok "Uninstall finished."
  kv "Kept:" "Homebrew, and any board YAML in ${HOME}/esphome"
  kv "Log:" "$LOG"
}

cmd_install() {
say "This installs ESPHome Device Builder, the Mosquitto MQTT broker, and MQTTX."
info "You may be asked for your Mac login password (the one you use to unlock the Mac)."

step "1/8  Preflight"
load_brew

ARCH="$(uname -m)"
case "$ARCH" in
  arm64)
    ESPHOME_ASSET_SUFFIX="_aarch64.dmg"
    ok "Apple Silicon ($ARCH)"
    ;;
  x86_64)
    ESPHOME_ASSET_SUFFIX="_x64.dmg"
    warn "Intel Mac. ESPHome is dropping Intel Mac support (around 2027.6). This still installs today's x64 app."
    ;;
  *) die "Unrecognised CPU architecture: $ARCH" ;;
esac

PRODUCT_VERSION="$(sw_vers -productVersion)"
info "macOS $PRODUCT_VERSION"
MAJOR="${PRODUCT_VERSION%%.*}"
REST="${PRODUCT_VERSION#*.}"
MINOR="${REST%%.*}"
if [[ "$MAJOR" -lt 10 ]] || { [[ "$MAJOR" -eq 10 ]] && [[ "$MINOR" -lt 15 ]]; }; then
  die "Need macOS 10.15 Catalina or newer. This Mac is $PRODUCT_VERSION."
fi
ok "macOS version is new enough"

FREE_GB="$(df -g / | awk 'NR==2 {print $4}')"
info "Free space on / : ${FREE_GB} GB (ESPHome's first compile downloads a few GB of tools)"
if [[ "${FREE_GB}" -lt "${MIN_FREE_GB}" ]]; then
  die "Need at least ${MIN_FREE_GB} GB free. Free some space and run this again."
fi
ok "Enough disk space"

if ! curl -fsS --max-time 20 -o /dev/null -H "User-Agent: esphome-for-model-railroading-setup" https://github.com; then
  die "Cannot reach github.com. Check Wi-Fi, then run this again."
fi
ok "Internet works"

if ! xcode-select -p >/dev/null 2>&1; then
  info "macOS command line tools are not installed. Opening the installer popup."
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

step "2/8  Homebrew"
load_brew

if ! command -v brew >/dev/null 2>&1; then
  info "Homebrew is not installed. Installing it now."
  info "The installer will ask for your Mac password."
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

step "3/8  Mosquitto"
if brew list mosquitto >/dev/null 2>&1; then
  ok "Mosquitto is already installed. Checking the config."
else
  info "Installing Mosquitto..."
  brew install mosquitto
  ok "Mosquitto installed"
fi

CONF="$(brew --prefix)/etc/mosquitto/mosquitto.conf"
mkdir -p "$(dirname "$CONF")"
if [[ ! -f "$CONF" ]]; then
  info "No config file yet. Creating $CONF"
  touch "$CONF"
fi

BACKUP="${CONF}.esphome-mr-backup"
cp -p "$CONF" "$BACKUP"
info "Backed up config to $BACKUP"

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

info "Starting Mosquitto so it comes back after a reboot..."
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
  info "macOS firewall is on. Allowing Mosquitto through it (password prompt is normal)."
  sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add "$MOSQ_BIN" || warn "Could not add Mosquitto to the firewall. If boards cannot connect, allow incoming connections for mosquitto."
  sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp "$MOSQ_BIN" || true
  ok "Firewall rule requested for Mosquitto"
else
  ok "macOS firewall is off, so boards can reach port 1883"
fi

step "4/8  ESPHome Device Builder"
info "Asking GitHub for the latest official desktop app..."
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
info "Latest ESPHome Device Builder: $ESPHOME_VERSION"
info "Download: $ESPHOME_URL"

APP="/Applications/ESPHome Device Builder.app"
INSTALLED=""
if [[ -d "$APP" ]]; then
  INSTALLED="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || true)"
  info "Already installed: ${INSTALLED:-unknown}"
fi

if [[ -n "$INSTALLED" && "$INSTALLED" == "$ESPHOME_VERSION" ]]; then
  ok "ESPHome Device Builder $INSTALLED is already the latest. Skipping download."
else
  WORK="$(mktemp -d)"
  info "Downloading the disk image (this is about 100 MB)..."
  curl -fL --retry 3 --retry-delay 2 -o "$WORK/ESPHome.dmg" "$ESPHOME_URL"
  MOUNT="$WORK/mnt"
  mkdir -p "$MOUNT"
  hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT" "$WORK/ESPHome.dmg" >/dev/null
  SRC_APP="$(find "$MOUNT" -maxdepth 2 -name '*.app' -print -quit)"
  if [[ -z "$SRC_APP" ]]; then
    hdiutil detach "$MOUNT" >/dev/null || true
    die "The disk image did not contain an app."
  fi
  info "Copying into /Applications (password prompt is normal)..."
  sudo rm -rf "$APP"
  sudo ditto "$SRC_APP" "$APP"
  sudo chown -R "$(whoami):staff" "$APP" || sudo chown -R "$(whoami)" "$APP"
  sudo xattr -dr com.apple.quarantine "$APP" || true
  hdiutil detach "$MOUNT" >/dev/null || true
  rm -rf "$WORK"
  ok "Installed ESPHome Device Builder $ESPHOME_VERSION"
fi

step "5/8  MQTTX"
# MQTTX is the topic browser for Mosquitto. Prefer Homebrew — MQTT Explorer's Mac
# builds currently trip Gatekeeper ("damaged and can't be opened").
if [[ -d "/Applications/MQTT Explorer.app" ]]; then
  info "Removing leftover MQTT Explorer.app (replaced by MQTTX)..."
  osascript -e 'quit app "MQTT Explorer"' >/dev/null 2>&1 || true
  sudo rm -rf "/Applications/MQTT Explorer.app" || true
  ok "Removed leftover MQTT Explorer"
fi
if brew list --cask mqttx >/dev/null 2>&1 || [[ -d "/Applications/MQTTX.app" ]]; then
  ok "MQTTX is already installed"
else
  info "Installing MQTTX with Homebrew..."
  brew install --cask mqttx
  ok "MQTTX installed"
fi

step "6/8  Open the apps"
info "Launching ESPHome. The first time, it downloads its own Python and can sit there for several minutes."
info "When it is ready it opens http://localhost:6052"
open -a "ESPHome Device Builder" || warn "Could not launch the app. Open ESPHome Device Builder from Applications."
info "Launching MQTTX. Connect to host 127.0.0.1 port 1883 with no username or password."
open -a "MQTTX" || warn "Could not launch MQTTX. Open it from Applications."

step "7/8  What you should see"
printf '\n' >&2
printf '  %s%s┌────────────────────────────────────────────────────┐%s\n' "$C_ACCENT" "$C_BOLD" "$C_RESET" >&2
printf '  %s%s│%s  Ready — use these in the Configurator / JMRI     %s%s│%s\n' "$C_ACCENT" "$C_BOLD" "$C_RESET" "$C_ACCENT" "$C_BOLD" "$C_RESET" >&2
printf '  %s%s└────────────────────────────────────────────────────┘%s\n' "$C_ACCENT" "$C_BOLD" "$C_RESET" >&2
info "Menu bar: an ESPHome icon. Use Open Dashboard and Open Config Folder."
kv "Config files:" "${HOME}/esphome"
kv "Dashboard:" "http://localhost:6052"
kv "MQTTX:" "host 127.0.0.1   port 1883   (no username/password)"
if [[ -n "$LAN_IP" ]]; then
  kv "MQTT broker:" "${LAN_IP}   port 1883   (no username/password)"
else
  kv "MQTT broker:" "(LAN IP from System Settings → Network)   port 1883"
fi
info "Put that LAN IP in the Configurator and in JMRI. Do not use localhost in the board YAML."
info "In MQTTX, use 127.0.0.1 so you can watch topics on this Mac."

step "8/8  Done"
ok "Setup finished."
kv "Log:" "$LOG"
kv "Then:" "docs/first-board-setup-guide.md"
offer_configurator "${LAN_IP:-}"
}

require_mac_user
if [[ ! -t 0 || ! -t 1 ]]; then
  say "This setup asks whether to install or uninstall, so it has to run in Terminal."
  info "Paste this instead of piping the script into bash:"
  printf '  %scurl -fsSL https://raw.githubusercontent.com/aaron9589/esphome-for-model-railroading/main/scripts/install-mac.sh -o /tmp/esphome-mr-setup.sh && bash /tmp/esphome-mr-setup.sh%s\n' "$C_STEP" "$C_RESET" >&2
  log_file "  curl -fsSL https://raw.githubusercontent.com/aaron9589/esphome-for-model-railroading/main/scripts/install-mac.sh -o /tmp/esphome-mr-setup.sh && bash /tmp/esphome-mr-setup.sh"
  exit 1
fi

ACTION="${1:-}"
if [[ -z "$ACTION" ]]; then
  ACTION="$(choose_action)"
else
  banner "macOS setup"
fi
info "Selected: $ACTION"
case "$ACTION" in
  install) cmd_install ;;
  uninstall) cmd_uninstall ;;
  quit) warn "Cancelled. Nothing was changed."; exit 0 ;;
  *) die "Unknown action '$ACTION'. Use: bash install-mac.sh [install|uninstall]" ;;
esac
