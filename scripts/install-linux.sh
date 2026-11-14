#!/bin/bash
# ESPHome Device Builder + Mosquitto + MQTTX setup for Linux.
# Aimed at Raspberry Pi OS on a Pi-SPROG, and also Debian, Ubuntu, Fedora,
# RHEL and relatives, openSUSE, and Arch. 64-bit only.
# Anonymous MQTT on port 1883 is for a trusted home network only.
# Re-running this script is safe: it skips what is already in place.
# It does not change Pi boot files, the UART, or JMRI.
#
# One line (terminal). Do not pipe this into bash — the menu needs your keyboard.
#   curl -fsSL https://raw.githubusercontent.com/aaron9589/esphome-for-model-railroading/main/scripts/install-linux.sh -o /tmp/esphome-mr-setup.sh && bash /tmp/esphome-mr-setup.sh

set -euo pipefail

LOG="${HOME}/esphome-mr-setup.log"
CONFIGURATOR_URL="https://aaron9589.github.io/esphome-for-model-railroading/"
MARKER_BEGIN="# BEGIN esphome-for-model-railroading"
MARKER_END="# END esphome-for-model-railroading"
MIN_FREE_GB=8
OPT_DIR="/opt/esphome-for-model-railroading"
LAUNCHER_MARK="# esphome-for-model-railroading launcher"
UA="esphome-for-model-railroading-setup"

PKG_FAMILY=""
OS_ID=""
OS_ID_LIKE=""
OS_PRETTY=""
IS_PI=0
PI_MODEL=""
HAVE_GUI=0
ARCH_NAME=""
ARCH_DEB=""
ARCH_RPM=""
LAN_IP=""
TMP_FILES=()

mkdir -p "$(dirname "$LOG")"
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
  printf '%s' "$1" | sed -E $'s/\033\\[[0-9;?]*[A-Za-z]//g; s/\033\\][^\007]*\007//g'
}

log_file() {
  local plain
  plain="$(strip_ansi "$*")"
  printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$plain" >>"$LOG"
}

say() {
  printf '%s%s%s\n' "$C_TEXT" "$*" "$C_RESET" >&2
  log_file "$*"
}

log() {
  say "$*"
}

banner() {
  local subtitle="${1:-Linux setup}"
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
  printf '  %s%-14s%s %s%s%s\n' "$C_MUTE" "$1" "$C_RESET" "$C_TEXT" "$2" "$C_RESET" >&2
  log_file "  $1 $2"
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
  trap - ERR
  printf '  %s✗%s  %s%s%s\n' "$C_ERR" "$C_RESET" "$C_ERR" "$*" "$C_RESET" >&2
  log_file "ERROR: $*"
  info "Full log: $LOG"
  report_issue
  exit 1
}

on_err() {
  local code=$?
  trap - ERR
  printf '  %s✗%s  %sFAILED near line %s (exit %s).%s\n' "$C_ERR" "$C_RESET" "$C_ERR" "${BASH_LINENO[0]}" "$code" "$C_RESET" >&2
  log_file "FAILED near line ${BASH_LINENO[0]} (exit ${code})."
  info "Full log: $LOG"
  report_issue
  exit "$code"
}
trap on_err ERR

cleanup() {
  local f
  for f in "${TMP_FILES[@]+"${TMP_FILES[@]}"}"; do
    rm -rf "$f"
  done
}
trap cleanup EXIT

keep_tmp() {
  TMP_FILES+=("$1")
}

APT_UPDATED=0

sudo_cmd() {
  if [[ "${1:-}" == "-v" ]]; then
    sudo -v
    return
  fi
  sudo DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a "$@"
}

apt_update_once() {
  if [[ "$PKG_FAMILY" != "apt" || "$APT_UPDATED" -eq 1 ]]; then
    return
  fi
  info "Refreshing package lists..."
  sudo_cmd apt-get update
  APT_UPDATED=1
}

detect_os() {
  OS_ID=""
  OS_ID_LIKE=""
  OS_PRETTY="Linux"
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    OS_ID="${ID:-}"
    OS_ID_LIKE="${ID_LIKE:-}"
    OS_PRETTY="${PRETTY_NAME:-${OS_ID:-Linux}}"
  fi
  local blob=" ${OS_ID} ${OS_ID_LIKE} "
  PKG_FAMILY=""
  case "$blob" in
    *debian*|*ubuntu*|*raspbian*|*raspios*|*raspberrypi*|*armbian*|*mint*)
      PKG_FAMILY="apt"
      ;;
    *fedora*|*rhel*|*centos*|*rocky*|*alma*|*oracle*)
      PKG_FAMILY="dnf"
      ;;
    *suse*)
      PKG_FAMILY="zypper"
      ;;
    *arch*|*manjaro*)
      PKG_FAMILY="pacman"
      ;;
  esac
  if [[ -z "$PKG_FAMILY" ]]; then
    if command -v apt-get >/dev/null 2>&1; then
      PKG_FAMILY="apt"
    elif command -v dnf >/dev/null 2>&1; then
      PKG_FAMILY="dnf"
    elif command -v zypper >/dev/null 2>&1; then
      PKG_FAMILY="zypper"
    elif command -v pacman >/dev/null 2>&1; then
      PKG_FAMILY="pacman"
    fi
  fi

  IS_PI=0
  PI_MODEL=""
  if [[ -r /proc/device-tree/model ]]; then
    PI_MODEL="$(tr -d '\0' </proc/device-tree/model || true)"
    if [[ "$PI_MODEL" == *"Raspberry Pi"* ]]; then
      IS_PI=1
    fi
  fi
}

detect_arch() {
  local machine
  machine="$(uname -m)"
  case "$machine" in
    x86_64|amd64)
      ARCH_NAME="x86_64"
      ARCH_DEB="amd64"
      ARCH_RPM="x86_64"
      ;;
    aarch64|arm64)
      ARCH_NAME="aarch64"
      ARCH_DEB="arm64"
      ARCH_RPM="aarch64"
      ;;
    armv7l|armv6l|armhf)
      die "This is 32-bit ARM (${machine}). ESPHome Device Builder and MQTTX publish 64-bit Linux builds only. Use the 64-bit Raspberry Pi OS image (Pi 3, 4, or 5). The current Pi-SPROG Bookworm images are 64-bit."
      ;;
    *)
      die "Unrecognised CPU architecture: ${machine}. This script supports x86_64 and 64-bit ARM (aarch64)."
      ;;
  esac
}

require_linux_user() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    die "This script is for Linux. On a Mac, use scripts/install-mac.sh. On Windows, use scripts/install-windows.ps1."
  fi
  if [[ "${EUID}" -eq 0 ]]; then
    die "Do not run this as root. Run it as your normal user (the one that logs into the desktop). It will ask for your password when it needs it."
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    die "sudo is not installed. Install sudo, allow your user to use it, and run this again."
  fi
  if ! command -v systemctl >/dev/null 2>&1; then
    die "This script needs systemd (systemctl) so Mosquitto starts on boot."
  fi
  detect_os
  if [[ -z "$PKG_FAMILY" ]]; then
    die "This script supports Raspberry Pi OS, Debian, Ubuntu, Linux Mint, Fedora, RHEL and relatives, openSUSE, and Arch. This system looks like '${OS_PRETTY}' and has none of apt, dnf, zypper, or pacman."
  fi
  detect_arch
}

attach_desktop_session() {
  HAVE_GUI=0
  if [[ -n "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" ]]; then
    HAVE_GUI=1
    return
  fi
  local uid runtime sock
  uid="$(id -u)"
  runtime="${XDG_RUNTIME_DIR:-/run/user/${uid}}"
  if [[ -d "$runtime" ]]; then
    export XDG_RUNTIME_DIR="$runtime"
    if [[ -S "${runtime}/bus" && -z "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
      export DBUS_SESSION_BUS_ADDRESS="unix:path=${runtime}/bus"
    fi
    for sock in "$runtime"/wayland-*; do
      if [[ -S "$sock" ]]; then
        export WAYLAND_DISPLAY="$(basename "$sock")"
        break
      fi
    done
  fi
  if [[ -z "${DISPLAY:-}" && -S /tmp/.X11-unix/X0 ]]; then
    export DISPLAY=:0
    if [[ -z "${XAUTHORITY:-}" && -f "${HOME}/.Xauthority" ]]; then
      export XAUTHORITY="${HOME}/.Xauthority"
    fi
  fi
  if [[ -n "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" ]]; then
    HAVE_GUI=1
    info "Found a desktop session. Apps will open there."
  fi
}

choose_action() {
  local subtitle="Linux setup"
  if [[ "$IS_PI" -eq 1 ]]; then
    subtitle="Raspberry Pi setup"
  fi
  banner "$subtitle"
  printf '  %sWhat would you like to do?%s\n\n' "$C_BOLD" "$C_RESET" >&2
  printf '  %s┌─ 1 ─┐%s  %sInstall%s    ESPHome, Mosquitto, and MQTTX\n' "$C_OK" "$C_RESET" "$C_BOLD" "$C_RESET" >&2
  printf '  %s┌─ 2 ─┐%s  %sUninstall%s  those three (keeps board files, JMRI, and the Pi-SPROG)\n' "$C_WARN" "$C_RESET" "$C_BOLD" "$C_RESET" >&2
  printf '  %s┌─ 3 ─┐%s  Quit\n\n' "$C_MUTE" "$C_RESET" >&2
  info "A full copy of this run is saved to $LOG"
  printf '\n' >&2
  local choice
  while true; do
    printf '  %sChoose%s [%s1%s/%s2%s/%s3%s]: ' "$C_BOLD" "$C_RESET" "$C_OK" "$C_RESET" "$C_WARN" "$C_RESET" "$C_MUTE" "$C_RESET" >&2
    if ! read -r choice; then
      die "Could not read a choice. Run the script in a terminal, not with 'curl | bash'."
    fi
    case "$choice" in
      1|install) printf '%s\n' install; return ;;
      2|uninstall) printf '%s\n' uninstall; return ;;
      3|q|quit) printf '%s\n' quit; return ;;
      *) printf '  %sType 1, 2, or 3.%s\n' "$C_WARN" "$C_RESET" >&2 ;;
    esac
  done
}

pkg_is_installed() {
  case "$PKG_FAMILY" in
    apt) dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed' ;;
    dnf|zypper) rpm -q "$1" >/dev/null 2>&1 ;;
    pacman) pacman -Q "$1" >/dev/null 2>&1 ;;
    *) return 1 ;;
  esac
}

pkg_remove() {
  case "$PKG_FAMILY" in
    apt) sudo_cmd apt-get remove -y "$1" ;;
    dnf) sudo_cmd dnf remove -y "$1" ;;
    zypper) sudo_cmd zypper --non-interactive remove "$1" ;;
    pacman) sudo_cmd pacman -R --noconfirm "$1" ;;
    *) return 1 ;;
  esac
}

remove_if_installed() {
  local name
  for name in "$@"; do
    if pkg_is_installed "$name"; then
      info "Removing ${name}..."
      pkg_remove "$name"
      ok "Removed ${name}"
    fi
  done
}

ensure_base_packages() {
  local -a need=()
  command -v curl >/dev/null 2>&1 || need+=(curl)
  command -v python3 >/dev/null 2>&1 || need+=(python3)
  command -v ss >/dev/null 2>&1 || need+=(iproute2)
  if [[ "${#need[@]}" -eq 0 ]]; then
    ok "curl, python3, and ss are installed"
    return
  fi
  # Fedora and Arch call the iproute2 tools "iproute".
  local -a pkgs=("${need[@]}")
  if [[ "$PKG_FAMILY" != "apt" ]]; then
    local i
    for i in "${!pkgs[@]}"; do
      if [[ "${pkgs[$i]}" == "iproute2" ]]; then
        pkgs[$i]="iproute"
      fi
    done
  fi
  info "Installing ${pkgs[*]}..."
  case "$PKG_FAMILY" in
    apt)
      apt_update_once
      sudo_cmd apt-get install -y "${pkgs[@]}" ca-certificates
      ;;
    dnf)
      sudo_cmd dnf install -y "${pkgs[@]}" ca-certificates
      ;;
    zypper)
      sudo_cmd zypper --non-interactive install "${pkgs[@]}" ca-certificates
      ;;
    pacman)
      sudo_cmd pacman -Sy --noconfirm --needed "${pkgs[@]}" ca-certificates
      ;;
  esac
  ok "Base tools installed"
}

port_lines() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :${port}" 2>/dev/null || true
    return
  fi
  netstat -ltn 2>/dev/null | awk -v p=":${port}" '$4 ~ p"$"' || true
}

port_owner() {
  local port="$1"
  sudo_cmd ss -ltnp "sport = :${port}" 2>/dev/null | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | head -n 1 || true
}

listening_on_lan() {
  local port="$1"
  port_lines "$port" | grep -E "0\\.0\\.0\\.0:${port}|\\[::\\]:${port}|\\*:${port}" >/dev/null
}

free_gb() {
  df -Pk / | awk 'NR==2 {printf "%d", $4/1024/1024}'
}

fetch_release_asset() {
  # Usage: fetch_release_asset owner/repo suffix [suffix...]
  # Sets FETCH_VERSION, FETCH_URL, and FETCH_NAME. Returns 1 if none match.
  # For a bare ".AppImage" suffix on amd64, arm64 filenames are skipped.
  local repo="$1"
  shift
  local json parsed
  FETCH_VERSION=""
  FETCH_URL=""
  FETCH_NAME=""
  if ! json="$(curl -fsSL --max-time 30 -H "User-Agent: ${UA}" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/${repo}/releases/latest")"; then
    return 1
  fi
  if ! parsed="$(RELEASE_JSON="$json" ARCH_DEB="$ARCH_DEB" python3 - "$@" <<'PY'
import json, os, sys
data = json.loads(os.environ["RELEASE_JSON"])
arch = os.environ.get("ARCH_DEB", "")
assets = data.get("assets") or []
tag = data.get("tag_name") or ""
version = tag[1:] if tag.startswith("v") else tag
for suffix in sys.argv[1:]:
    for asset in assets:
        name = asset.get("name") or ""
        if not name.endswith(suffix) or name.endswith(".sig"):
            continue
        if suffix == ".AppImage" and arch == "amd64" and ("arm64" in name or "aarch64" in name):
            continue
        url = asset.get("browser_download_url") or ""
        if url.startswith("https://") and version:
            print(version)
            print(url)
            print(name)
            raise SystemExit(0)
raise SystemExit(1)
PY
  )"; then
    return 1
  fi
  FETCH_VERSION="$(printf '%s\n' "$parsed" | sed -n '1p')"
  FETCH_URL="$(printf '%s\n' "$parsed" | sed -n '2p')"
  FETCH_NAME="$(printf '%s\n' "$parsed" | sed -n '3p')"
}

version_is_current() {
  # True when $1 (installed) is present and >= $2 (latest).
  local installed="$1"
  local latest="$2"
  [[ -n "$installed" && -n "$latest" ]] || return 1
  printf '%s\n%s\n' "$latest" "$installed" | sort -V -C
}

installed_pkg_version() {
  local name
  for name in "$@"; do
    case "$PKG_FAMILY" in
      apt)
        if pkg_is_installed "$name"; then
          dpkg-query -W -f='${Version}' "$name" 2>/dev/null || true
          return
        fi
        ;;
      dnf|zypper)
        if pkg_is_installed "$name"; then
          rpm -q --queryformat '%{VERSION}' "$name" 2>/dev/null || true
          return
        fi
        ;;
    esac
  done
}

download_file() {
  local url="$1"
  local dest="$2"
  curl -fL --retry 3 --retry-delay 2 -o "$dest" "$url"
}

install_downloaded_pkg() {
  local file="$1"
  case "$PKG_FAMILY" in
    apt)
      apt_update_once
      sudo_cmd apt-get install -y "$file"
      ;;
    dnf)
      # GitHub release RPMs are fetched over HTTPS; they are not signed with a distro key.
      sudo_cmd dnf install -y --nogpgcheck "$file"
      ;;
    zypper)
      sudo_cmd zypper --non-interactive --no-gpg-checks install "$file"
      ;;
    *)
      return 1
      ;;
  esac
}

write_appimage_launcher() {
  local wrapper="$1"
  local target="$2"
  local body
  body="$(printf '%s\n%s\n%s\n%s\n' '#!/bin/sh' "$LAUNCHER_MARK" "export APPIMAGE_EXTRACT_AND_RUN=1" "exec $(printf '%q' "$target") \"\$@\"")"
  printf '%s\n' "$body" | sudo_cmd tee "$wrapper" >/dev/null
  sudo_cmd chmod 755 "$wrapper"
}

write_desktop_entry() {
  local dest="$1"
  local name="$2"
  local exec_cmd="$3"
  local comment="$4"
  local body
  body="$(cat <<EOF
[Desktop Entry]
Type=Application
Name=${name}
Comment=${comment}
Exec=${exec_cmd}
Terminal=false
Categories=Development;
EOF
)"
  printf '%s\n' "$body" | sudo_cmd tee "$dest" >/dev/null
}

install_appimage() {
  # $1 role (esphome|mqttx) $2 downloaded file $3 version
  local role="$1"
  local src="$2"
  local version="$3"
  local target wrapper desktop exec_name nice
  sudo_cmd install -d -m 0755 "$OPT_DIR"
  if [[ "$role" == "esphome" ]]; then
    target="${OPT_DIR}/ESPHome.Device.Builder.AppImage"
    wrapper="/usr/local/bin/esphome-desktop"
    desktop="/usr/share/applications/esphome-device-builder.desktop"
    exec_name="/usr/local/bin/esphome-desktop open"
    nice="ESPHome Device Builder"
  else
    target="${OPT_DIR}/MQTTX.AppImage"
    wrapper="/usr/local/bin/mqttx"
    desktop="/usr/share/applications/mqttx.desktop"
    exec_name="/usr/local/bin/mqttx"
    nice="MQTTX"
  fi
  sudo_cmd install -m 0755 "$src" "$target"
  printf '%s\n' "$version" | sudo_cmd tee "${OPT_DIR}/${role}.version" >/dev/null
  write_appimage_launcher "$wrapper" "$target"
  write_desktop_entry "$desktop" "$nice" "$exec_name" "Installed by esphome-for-model-railroading"
  hash -r || true
}

appimage_version() {
  local role="$1"
  if [[ -f "${OPT_DIR}/${role}.version" ]]; then
    tr -d '[:space:]' <"${OPT_DIR}/${role}.version"
  fi
}

remove_our_launcher() {
  local path="$1"
  if [[ -f "$path" ]] && grep -qF "$LAUNCHER_MARK" "$path"; then
    sudo_cmd rm -f "$path"
    ok "Removed ${path}"
  fi
}

apply_mosquitto_config() {
  local conf="$1"
  local persist="$2"
  local py out
  py="$(mktemp)"
  out="$(mktemp)"
  keep_tmp "$py"
  keep_tmp "$out"
  cat >"$py" <<'PY'
import sys
from pathlib import Path

conf_path, begin, end, persist_dir = sys.argv[1:]
persist_dir = persist_dir.rstrip("/") + "/"
disable_tag = "  # disabled by esphome-for-model-railroading setup"
managed_name = "esphome-mr.conf"

def read_text(path):
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8", errors="replace")

def strip_managed(text):
    lines = text.splitlines()
    out = []
    skip = False
    for line in lines:
        if line.strip() == begin:
            skip = True
            continue
        if skip:
            if line.strip() == end:
                skip = False
            continue
        out.append(line)
    return out

def active(line):
    stripped = line.strip()
    return bool(stripped) and not stripped.startswith("#")

def keyword(line):
    body = line.split("#", 1)[0].strip()
    if not body:
        return ""
    return body.split(None, 1)[0].lower()

def disable(line):
    return "# " + line + disable_tag

def listener_port(line: str):
    body = line.split("#", 1)[0].strip().split()
    if len(body) >= 2 and body[0].lower() == "listener" and body[1].isdigit():
        return body[1]
    return None

def include_dir(lines):
    for line in lines:
        if not active(line) or keyword(line) != "include_dir":
            continue
        body = line.split("#", 1)[0].strip()
        parts = body.split(None, 1)
        if len(parts) < 2:
            continue
        raw = parts[1].strip().strip('"').strip("'")
        return raw
    return None

def backup_once(path):
    if not path.exists():
        return
    dest = Path(str(path) + ".esphome-mr-backup")
    if not dest.exists():
        dest.write_bytes(path.read_bytes())
        print(f"backup {dest}")

def write_if_changed(path, text):
    current = read_text(path)
    if current == text:
        print(f"unchanged {path}")
        return
    backup_once(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    print(f"updated {path}")

main = Path(conf_path)
main.parent.mkdir(parents=True, exist_ok=True)
if not main.exists():
    main.write_text("", encoding="utf-8")

main_lines = strip_managed(read_text(main))
inc = include_dir(main_lines)
conf_d = None
if inc:
    inc_path = Path(inc)
    if not inc_path.is_absolute():
        inc_path = (main.parent / inc_path).resolve()
    conf_d = inc_path

files = [("main", main, main_lines)]
if conf_d is not None and conf_d.is_dir():
    for path in sorted(conf_d.glob("*.conf")):
        if path.name == managed_name:
            continue
        files.append((path.name, path, strip_managed(read_text(path))))

has_persistence_true = False
has_persistence_location = False
has_autosave = False
rewritten = []

for _label, path, lines in files:
    cleaned = []
    for line in lines:
        if not active(line):
            cleaned.append(line)
            continue
        key = keyword(line)
        if key in ("allow_anonymous", "bind_address"):
            cleaned.append(disable(line))
            continue
        if key == "listener" and listener_port(line) == "1883":
            cleaned.append(disable(line))
            continue
        if key in ("persistence", "persistence_location", "autosave_interval"):
            body = line.split("#", 1)[0].strip().split()
            value = body[1].lower() if len(body) >= 2 else ""
            if key == "persistence":
                if value == "true" and not has_persistence_true:
                    has_persistence_true = True
                else:
                    cleaned.append(disable(line))
                    continue
            elif key == "persistence_location":
                if value and not has_persistence_location:
                    has_persistence_location = True
                else:
                    cleaned.append(disable(line))
                    continue
            elif key == "autosave_interval":
                if value and not has_autosave:
                    has_autosave = True
                else:
                    cleaned.append(disable(line))
                    continue
        cleaned.append(line)
    rewritten.append((path, cleaned))

block = [begin]
if not has_persistence_true:
    block.append("persistence true")
if not has_persistence_location:
    block.append(f"persistence_location {persist_dir}")
if not has_autosave:
    block.append("autosave_interval 60")
block.append("listener 1883")
block.append("allow_anonymous true")
block.append(end)
block_text = "\n".join(block) + "\n"

if conf_d is not None:
    conf_d.mkdir(parents=True, exist_ok=True)
    for path, cleaned in rewritten:
        write_if_changed(path, "\n".join(cleaned).rstrip() + "\n")
    write_if_changed(conf_d / managed_name, block_text)
else:
    path, cleaned = rewritten[0]
    body = "\n".join(cleaned).rstrip() + "\n\n" + block_text
    write_if_changed(path, body)
PY
  sudo_cmd python3 "$py" "$conf" "$MARKER_BEGIN" "$MARKER_END" "$persist" >"$out"
  local line updated=0
  while IFS= read -r line; do
    case "$line" in
      backup\ *) info "Backed up config to ${line#backup }" ;;
      updated\ *) info "Updated ${line#updated }"; updated=1 ;;
      unchanged\ *) ;;
      *) info "$line" ;;
    esac
  done <"$out"
  if [[ "$updated" -eq 0 ]]; then
    ok "Mosquitto config already has the home-network settings"
  else
    ok "Mosquitto will accept connections on port 1883 with no username (home network)"
  fi
}

restore_mosquitto_backups() {
  local f orig
  shopt -s nullglob
  for f in /etc/mosquitto/mosquitto.conf.esphome-mr-backup \
           /etc/mosquitto.conf.esphome-mr-backup \
           /etc/mosquitto/conf.d/*.esphome-mr-backup; do
    if [[ -f "$f" ]]; then
      orig="${f%.esphome-mr-backup}"
      sudo_cmd cp -p "$f" "$orig"
      sudo_cmd rm -f "$f"
      ok "Restored ${orig}"
    fi
  done
  shopt -u nullglob
  if [[ -f /etc/mosquitto/conf.d/esphome-mr.conf ]]; then
    sudo_cmd rm -f /etc/mosquitto/conf.d/esphome-mr.conf
    ok "Removed /etc/mosquitto/conf.d/esphome-mr.conf"
  fi
}

open_firewall() {
  local opened=0
  if command -v ufw >/dev/null 2>&1; then
    local status
    status="$(sudo_cmd ufw status 2>/dev/null || true)"
    if [[ "$status" == *"Status: active"* ]]; then
      info "ufw is on. Allowing TCP 1883."
      if ! sudo_cmd ufw allow 1883/tcp comment 'esphome-mr mosquitto'; then
        sudo_cmd ufw allow 1883/tcp
      fi
      opened=1
      ok "ufw allows TCP 1883"
    fi
  fi
  if command -v firewall-cmd >/dev/null 2>&1; then
    if sudo_cmd firewall-cmd --state >/dev/null 2>&1; then
      info "firewalld is on. Allowing TCP 1883."
      sudo_cmd firewall-cmd --permanent --add-port=1883/tcp
      sudo_cmd firewall-cmd --reload
      opened=1
      ok "firewalld allows TCP 1883"
    fi
  fi
  if [[ "$opened" -eq 0 ]]; then
    ok "No ufw or firewalld firewall is active, so boards can reach port 1883"
  fi
}

close_firewall() {
  if command -v ufw >/dev/null 2>&1; then
    local verbose
    verbose="$(sudo_cmd ufw status verbose 2>/dev/null || true)"
    if [[ "$verbose" == *"esphome-mr"* ]]; then
      sudo_cmd ufw delete allow 1883/tcp || true
      ok "Removed the ufw rule for TCP 1883"
    fi
  fi
  if command -v firewall-cmd >/dev/null 2>&1 && sudo_cmd firewall-cmd --state >/dev/null 2>&1; then
    if sudo_cmd firewall-cmd --permanent --remove-port=1883/tcp >/dev/null 2>&1; then
      sudo_cmd firewall-cmd --reload >/dev/null 2>&1 || true
      ok "Removed the firewalld opening for TCP 1883"
    fi
  fi
}

lan_ip() {
  ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit }}'
}

install_esphome() {
  local -a suffixes=()
  local installed
  case "$PKG_FAMILY" in
    apt) suffixes=("_${ARCH_DEB}.deb") ;;
    dnf|zypper) suffixes=(".${ARCH_RPM}.rpm") ;;
    *)
      if [[ "$ARCH_DEB" == "arm64" ]]; then
        suffixes=("_aarch64.AppImage")
      else
        suffixes=("_amd64.AppImage")
      fi
      ;;
  esac
  info "Asking GitHub for the latest ESPHome Device Builder..."
  if ! fetch_release_asset esphome/esphome-desktop "${suffixes[@]}"; then
    die "Could not find an ESPHome Device Builder download for this computer. Check the internet and run this again."
  fi
  info "Latest desktop app: ${FETCH_VERSION}"
  if [[ "$PKG_FAMILY" == "pacman" ]]; then
    installed="$(appimage_version esphome)"
  else
    installed="$(installed_pkg_version esphome-desktop)"
  fi
  if version_is_current "$installed" "$FETCH_VERSION"; then
    ok "ESPHome Device Builder ${installed} is already current. Skipping download."
    return
  fi
  local work
  work="$(mktemp -d)"
  keep_tmp "$work"
  info "Downloading ${FETCH_NAME} (about 110 MB)..."
  if ! download_file "$FETCH_URL" "${work}/${FETCH_NAME}"; then
    die "The ESPHome download did not finish. Check the internet and run this again."
  fi
  if [[ "$PKG_FAMILY" == "pacman" ]]; then
    install_appimage esphome "${work}/${FETCH_NAME}" "$FETCH_VERSION"
  else
    info "Installing the package. This also installs its libraries."
    if ! install_downloaded_pkg "${work}/${FETCH_NAME}"; then
      die "Could not install ESPHome Device Builder. The package tool output above is the next clue."
    fi
  fi
  hash -r || true
  ok "Installed ESPHome Device Builder ${FETCH_VERSION}"
}

install_mqttx() {
  local -a suffixes=()
  local installed
  case "$PKG_FAMILY" in
    apt) suffixes=("_${ARCH_DEB}.deb") ;;
    dnf|zypper) suffixes=(".${ARCH_RPM}.rpm") ;;
    *)
      if [[ "$ARCH_DEB" == "arm64" ]]; then
        suffixes=("-arm64.AppImage")
      else
        suffixes=(".AppImage")
      fi
      ;;
  esac
  info "Asking GitHub for the latest MQTTX..."
  if ! fetch_release_asset emqx/MQTTX "${suffixes[@]}"; then
    warn "Could not find an MQTTX download. Watch topics with: mosquitto_sub -h 127.0.0.1 -t '#' -v"
    return
  fi
  info "Latest MQTTX: ${FETCH_VERSION}"
  if [[ "$PKG_FAMILY" == "pacman" ]]; then
    installed="$(appimage_version mqttx)"
  else
    installed="$(installed_pkg_version mqttx MQTTX)"
  fi
  if version_is_current "$installed" "$FETCH_VERSION"; then
    ok "MQTTX ${installed} is already current. Skipping download."
    return
  fi
  local work
  work="$(mktemp -d)"
  keep_tmp "$work"
  info "Downloading ${FETCH_NAME}..."
  if ! download_file "$FETCH_URL" "${work}/${FETCH_NAME}"; then
    warn "MQTTX did not download. Watch topics with: mosquitto_sub -h 127.0.0.1 -t '#' -v"
    return
  fi
  if [[ "$PKG_FAMILY" == "pacman" ]]; then
    install_appimage mqttx "${work}/${FETCH_NAME}" "$FETCH_VERSION"
  else
    info "Installing MQTTX..."
    if ! install_downloaded_pkg "${work}/${FETCH_NAME}"; then
      warn "MQTTX did not install. Watch topics with: mosquitto_sub -h 127.0.0.1 -t '#' -v"
      return
    fi
  fi
  hash -r || true
  ok "Installed MQTTX ${FETCH_VERSION}"
}

update_device_builder() {
  local bin
  bin="$(command -v esphome-desktop || true)"
  if [[ -z "$bin" ]]; then
    warn "Could not find esphome-desktop. Open ESPHome Device Builder from the application menu and choose Check for Updates."
    return 0
  fi
  if [[ "$HAVE_GUI" -ne 1 ]]; then
    info "No desktop session, so the dashboard was not started."
    info "Log in on the desktop (or VNC) and open ESPHome Device Builder. The first launch finishes its setup."
    return 0
  fi
  info "Starting the dashboard. The first start can take several minutes, longer on a Pi."
  "$bin" open >/dev/null 2>&1 || warn "Could not start ESPHome Device Builder. Open it from the application menu."
  local ready=0 i
  for i in $(seq 1 180); do
    if "$bin" status 2>/dev/null | grep -q "Backend:         running, healthy"; then
      ready=1
      break
    fi
    if (( i % 12 == 0 )); then
      info "Still waiting for the dashboard..."
    fi
    sleep 5
  done
  if [[ "$ready" -ne 1 ]]; then
    warn "The dashboard did not become ready. When it does, use the tray icon and choose Check for Updates."
    return 0
  fi
  info "Updating ESPHome and the device builder. This can take several minutes."
  if ! "$bin" update; then
    warn "The in-app update did not finish. Use the tray icon and choose Check for Updates."
    return 0
  fi
  ok "Builder update finished."
  "$bin" status 2>/dev/null | grep -E '^(ESPHome:|Device builder:)' || true
}

launch_mqttx() {
  if [[ "$HAVE_GUI" -ne 1 ]]; then
    info "No desktop session, so MQTTX was not opened."
    info "On the desktop, open MQTTX and connect to 127.0.0.1 port 1883 with no username."
    info "Or from this terminal: mosquitto_sub -h 127.0.0.1 -t '#' -v"
    return
  fi
  local cmd=""
  if command -v mqttx >/dev/null 2>&1; then
    cmd="$(command -v mqttx)"
  elif command -v MQTTX >/dev/null 2>&1; then
    cmd="$(command -v MQTTX)"
  elif [[ -x /opt/MQTTX/mqttx ]]; then
    cmd="/opt/MQTTX/mqttx"
  elif [[ -x /usr/local/bin/mqttx ]]; then
    cmd="/usr/local/bin/mqttx"
  fi
  if [[ -z "$cmd" ]]; then
    warn "MQTTX is not on PATH. Open it from the application menu, or use mosquitto_sub."
    return
  fi
  "$cmd" >/dev/null 2>&1 &
  disown 2>/dev/null || true
  ok "Launched MQTTX. Connect to host 127.0.0.1 port 1883 with no username or password."
}

add_dialout() {
  if ! getent group dialout >/dev/null 2>&1; then
    warn "This system has no dialout group. If the USB serial port does not appear, add your user to the group that owns /dev/ttyUSB0."
    return
  fi
  if id -nG "$USER" | tr ' ' '\n' | grep -qx dialout; then
    ok "Your user is in the dialout group, so a USB board can show up"
    return
  fi
  sudo_cmd usermod -aG dialout "$USER"
  ok "Added ${USER} to the dialout group"
  warn "Log out and back in (or reboot) before the first USB flash. Until then the serial port may be missing."
}

offer_configurator() {
  local lan_ip="${1:-}"
  step "Next: Board Configurator"
  say "This computer is ready. Next you build board.yaml in the Board Configurator."
  if [[ -n "$lan_ip" ]]; then
    info "When the form asks for the MQTT broker IP, use ${lan_ip}."
  else
    info "When the form asks for the MQTT broker IP, use this computer's LAN address (from: ip -4 addr)."
  fi
  if [[ "$HAVE_GUI" -ne 1 ]]; then
    info "No desktop session here, so a browser was not opened."
    info "Open this on the desktop: ${CONFIGURATOR_URL}"
    return
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
      if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$CONFIGURATOR_URL" >/dev/null 2>&1 || warn "Could not open a browser. Go to: $CONFIGURATOR_URL"
      else
        warn "xdg-open is not installed. Go to: $CONFIGURATOR_URL"
      fi
      ok "Opened Board Configurator"
      info "Click My first board, fill Wi-Fi and the MQTT broker IP, then Download board.yaml."
      ;;
  esac
}

cmd_uninstall() {
  step "Uninstall"
  say "This removes ESPHome Device Builder, Mosquitto, and MQTTX."
  info "Board files in ${HOME}/esphome stay. JMRI stays. The Pi serial port and boot files stay."
  info "Your user stays in the dialout group."
  printf '\n  %sType uninstall to continue:%s ' "$C_BOLD" "$C_RESET" >&2
  local confirm
  if ! read -r confirm; then
    die "Could not read a confirmation."
  fi
  if [[ "$confirm" != "uninstall" ]]; then
    warn "Cancelled. Nothing was removed."
    exit 0
  fi

  if command -v esphome-desktop >/dev/null 2>&1; then
    esphome-desktop quit >/dev/null 2>&1 || true
  fi

  restore_mosquitto_backups
  sudo_cmd systemctl disable --now mosquitto >/dev/null 2>&1 || true
  remove_if_installed esphome-desktop mqttx MQTTX mosquitto mosquitto-clients
  remove_our_launcher /usr/local/bin/esphome-desktop
  remove_our_launcher /usr/local/bin/mqttx
  if [[ -d "$OPT_DIR" ]]; then
    sudo_cmd rm -rf "$OPT_DIR"
    ok "Removed ${OPT_DIR}"
  fi
  if [[ -f /usr/share/applications/esphome-device-builder.desktop ]] && grep -q esphome-for-model-railroading /usr/share/applications/esphome-device-builder.desktop; then
    sudo_cmd rm -f /usr/share/applications/esphome-device-builder.desktop
  fi
  if [[ -f /usr/share/applications/mqttx.desktop ]] && grep -q esphome-for-model-railroading /usr/share/applications/mqttx.desktop; then
    sudo_cmd rm -f /usr/share/applications/mqttx.desktop
  fi
  close_firewall

  step "Done"
  ok "Uninstall finished."
  kv "Kept:" "board YAML in ${HOME}/esphome, JMRI, and the Pi-SPROG serial port"
  kv "Log:" "$LOG"
}

cmd_install() {
  say "This installs ESPHome Device Builder, the Mosquitto MQTT broker, and MQTTX."
  info "You may be asked for your Linux password."
  if [[ "$IS_PI" -eq 1 ]]; then
    info "Pi-SPROG and JMRI keep the serial port they already use. This does not change boot files or the UART."
  fi

  step "1/8  Preflight"
  info "${OS_PRETTY} (${PKG_FAMILY}, ${ARCH_NAME})"
  if [[ "$IS_PI" -eq 1 ]]; then
    ok "Raspberry Pi: ${PI_MODEL}"
  fi
  if grep -qi microsoft /proc/version 2>/dev/null; then
    warn "This is Windows Subsystem for Linux. A board on the LAN often cannot reach a broker inside WSL, and USB flashing is awkward. A Raspberry Pi or a normal Linux install is the better layout computer."
  fi

  local free
  free="$(free_gb)"
  if [[ "$IS_PI" -eq 1 ]]; then
    info "Free space on / : ${free} GB (the first ESPHome compile downloads a few GB of tools onto the SD card)"
  else
    info "Free space on / : ${free} GB (the first ESPHome compile downloads a few GB of tools)"
  fi
  if [[ "${free}" -lt "${MIN_FREE_GB}" ]]; then
    die "Need at least ${MIN_FREE_GB} GB free. Free some space (or use a larger SD card) and run this again."
  fi
  ok "Enough disk space"

  local mem_kb
  mem_kb="$(awk '/MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || true)"
  if [[ -n "$mem_kb" && "$mem_kb" -lt 1700000 ]]; then
    warn "This computer has about $((mem_kb / 1024)) MB of RAM. The first ESPHome compile may run out of memory. A Pi 4 or Pi 5 with 2 GB or more is the comfortable size."
  fi

  info "Checking sudo. Type your password if asked."
  sudo_cmd -v

  ensure_base_packages

  if ! curl -fsS --max-time 20 -o /dev/null -H "User-Agent: ${UA}" https://github.com; then
    die "Cannot reach github.com. Check the network, then run this again."
  fi
  ok "Internet works"

  local owner
  owner="$(port_owner 1883 || true)"
  if [[ -n "$owner" ]]; then
    if [[ "$owner" == "mosquitto" ]]; then
      ok "Port 1883 is already Mosquitto. Config will be checked."
    else
      die "Port 1883 is in use by '${owner}', not Mosquitto. Quit that program and run this again."
    fi
  elif port_lines 1883 | grep -q ':1883'; then
    ok "Port 1883 is in use. Config will be checked."
  else
    ok "Port 1883 is free"
  fi

  if port_lines 6052 | grep -q ':6052'; then
    warn "Port 6052 is already in use. If that is ESPHome, the dashboard is already up. If not, quit the other app before opening the dashboard."
  else
    ok "Port 6052 is free"
  fi

  attach_desktop_session

  step "2/8  Mosquitto"
  if pkg_is_installed mosquitto; then
    ok "Mosquitto is already installed. Checking the config."
  else
    info "Installing Mosquitto..."
    case "$PKG_FAMILY" in
      apt)
        apt_update_once
        sudo_cmd apt-get install -y mosquitto mosquitto-clients
        ;;
      dnf)
        if ! sudo_cmd dnf install -y mosquitto; then
          case "$OS_ID" in
            rhel|centos|rocky|almalinux|ol)
              info "Mosquitto was not in the main repos. Trying EPEL."
              sudo_cmd dnf install -y epel-release
              sudo_cmd dnf install -y mosquitto
              ;;
            *)
              die "Could not install Mosquitto with dnf."
              ;;
          esac
        fi
        ;;
      zypper)
        sudo_cmd zypper --non-interactive install mosquitto
        ;;
      pacman)
        sudo_cmd pacman -Sy --noconfirm --needed mosquitto
        ;;
    esac
    hash -r || true
    ok "Mosquitto installed"
  fi
  if ! command -v mosquitto_pub >/dev/null 2>&1 || ! command -v mosquitto_sub >/dev/null 2>&1; then
    if [[ "$PKG_FAMILY" == "apt" ]]; then
      sudo_cmd apt-get install -y mosquitto-clients
      hash -r || true
    fi
  fi
  if ! command -v mosquitto_pub >/dev/null 2>&1; then
    die "mosquitto_pub is missing. Install the Mosquitto clients package and run this again."
  fi

  local conf="/etc/mosquitto/mosquitto.conf"
  if [[ ! -f "$conf" && -f /etc/mosquitto.conf ]]; then
    conf="/etc/mosquitto.conf"
  fi
  if [[ ! -e "$conf" ]]; then
    sudo_cmd install -d -m 0755 /etc/mosquitto
    sudo_cmd touch "$conf"
  fi
  local persist="/var/lib/mosquitto"
  if id mosquitto >/dev/null 2>&1; then
    sudo_cmd install -d -o mosquitto -g mosquitto -m 0750 "$persist"
  else
    sudo_cmd install -d -m 0750 "$persist"
  fi
  apply_mosquitto_config "$conf" "$persist"
  ok "Retained messages are kept across broker restarts"

  info "Starting Mosquitto so it comes back after a reboot..."
  sudo_cmd systemctl enable mosquitto
  if ! sudo_cmd systemctl restart mosquitto; then
    sudo_cmd journalctl -u mosquitto -n 40 --no-pager >&2 || true
    die "Mosquitto did not start. The lines above are from: journalctl -u mosquitto"
  fi
  sleep 1
  if ! sudo_cmd systemctl is-active --quiet mosquitto; then
    sudo_cmd journalctl -u mosquitto -n 40 --no-pager >&2 || true
    die "Mosquitto is not running."
  fi
  if ! sudo_cmd systemctl is-enabled --quiet mosquitto; then
    die "Mosquitto is running but is not set to start on boot. Run: sudo systemctl enable --now mosquitto"
  fi
  if ! listening_on_lan 1883; then
    die "Mosquitto is not listening on the LAN address of port 1883. Boards on Wi-Fi would not be able to connect."
  fi
  ok "Mosquitto is listening on port 1883 and will start on boot"

  local sub_out sub_pid
  sub_out="$(mktemp)"
  keep_tmp "$sub_out"
  mosquitto_sub -h 127.0.0.1 -t 'esphome-mr/setup-test' -C 1 -W 8 >"$sub_out" &
  sub_pid=$!
  sleep 1
  mosquitto_pub -h 127.0.0.1 -t 'esphome-mr/setup-test' -m 'Mosquitto works'
  wait "$sub_pid" || true
  if ! grep -q "Mosquitto works" "$sub_out"; then
    die "Local publish/subscribe test failed. Mosquitto is not accepting clients on this computer."
  fi
  ok "Publish/subscribe test passed on this computer"

  open_firewall

  LAN_IP="$(lan_ip || true)"
  if [[ -n "$LAN_IP" ]]; then
    if python3 - "$LAN_IP" <<'PY'
import socket, sys
s = socket.create_connection((sys.argv[1], 1883), timeout=5)
s.close()
PY
    then
      mosquitto_pub -h "$LAN_IP" -t 'esphome-mr/setup-test' -m 'lan-ok'
      ok "Broker accepts connections on LAN IP ${LAN_IP}"
    else
      warn "Could not connect to ${LAN_IP}:1883. Boards on Wi-Fi will not connect until this works. Check the firewall."
    fi
  else
    warn "Could not find a LAN IP. Run 'ip -4 addr' and put that address in the Configurator and in JMRI."
  fi

  step "3/8  ESPHome Device Builder"
  install_esphome
  update_device_builder

  step "4/8  MQTTX"
  install_mqttx

  step "5/8  USB serial access"
  add_dialout
  if [[ "$IS_PI" -eq 1 ]]; then
    info "The ESP board is a USB serial port (often /dev/ttyUSB0). The Pi-SPROG stays on its own port."
  fi

  step "6/8  Open the apps"
  if [[ "$HAVE_GUI" -eq 1 ]]; then
    info "Opening ESPHome and MQTTX."
    if command -v esphome-desktop >/dev/null 2>&1; then
      esphome-desktop open >/dev/null 2>&1 || warn "Could not launch ESPHome. Open it from the application menu."
    fi
    launch_mqttx
  else
    info "This terminal has no desktop session, so the apps were not opened."
    info "On the Pi desktop, open ESPHome Device Builder and MQTTX from the application menu."
    info "Dashboard, once the app is running: http://localhost:6052"
    info "Topics from a terminal: mosquitto_sub -h 127.0.0.1 -t '#' -v"
  fi

  step "7/8  What you should see"
  printf '\n' >&2
  printf '  %s%s┌────────────────────────────────────────────────────┐%s\n' "$C_ACCENT" "$C_BOLD" "$C_RESET" >&2
  printf '  %s%s│%s  Ready — use these in the Configurator / JMRI     %s%s│%s\n' "$C_ACCENT" "$C_BOLD" "$C_RESET" "$C_ACCENT" "$C_BOLD" "$C_RESET" >&2
  printf '  %s%s└────────────────────────────────────────────────────┘%s\n' "$C_ACCENT" "$C_BOLD" "$C_RESET" >&2
  kv "Config files:" "${HOME}/esphome"
  kv "Dashboard:" "http://localhost:6052"
  kv "MQTTX:" "host 127.0.0.1   port 1883   (no username/password)"
  if [[ -n "$LAN_IP" ]]; then
    kv "MQTT broker:" "${LAN_IP}   port 1883   (no username/password)"
  else
    kv "MQTT broker:" "(LAN IP from ip -4 addr)   port 1883"
  fi
  info "Put that LAN IP in the Configurator and in JMRI. Do not use localhost in the board YAML."
  if [[ "$IS_PI" -eq 1 && -n "$LAN_IP" ]]; then
    info "JMRI on this Pi uses ${LAN_IP} too, even though Mosquitto is running here."
  fi
  info "In MQTTX, or with mosquitto_sub, use 127.0.0.1 so you can watch topics on this computer."
  info "The first USB flash uses Chrome, Edge, or Chromium. Firefox will not see the board."

  step "8/8  Done"
  ok "Setup finished."
  kv "Log:" "$LOG"
  kv "Then:" "docs/first-board-setup-guide.md"
  offer_configurator "${LAN_IP:-}"
}

require_linux_user
if [[ ! -t 0 || ! -t 1 ]]; then
  say "This setup asks whether to install or uninstall, so it has to run in a terminal."
  info "Paste this instead of piping the script into bash:"
  printf '  %scurl -fsSL https://raw.githubusercontent.com/aaron9589/esphome-for-model-railroading/main/scripts/install-linux.sh -o /tmp/esphome-mr-setup.sh && bash /tmp/esphome-mr-setup.sh%s\n' "$C_STEP" "$C_RESET" >&2
  log_file "  curl -fsSL https://raw.githubusercontent.com/aaron9589/esphome-for-model-railroading/main/scripts/install-linux.sh -o /tmp/esphome-mr-setup.sh && bash /tmp/esphome-mr-setup.sh"
  exit 1
fi

ACTION="${1:-}"
if [[ -z "$ACTION" ]]; then
  ACTION="$(choose_action)"
else
  if [[ "$IS_PI" -eq 1 ]]; then
    banner "Raspberry Pi setup"
  else
    banner "Linux setup"
  fi
fi
info "Selected: $ACTION"
case "$ACTION" in
  install) cmd_install ;;
  uninstall) cmd_uninstall ;;
  quit) warn "Cancelled. Nothing was changed."; exit 0 ;;
  *) die "Unknown action '$ACTION'. Use: bash install-linux.sh [install|uninstall]" ;;
esac
