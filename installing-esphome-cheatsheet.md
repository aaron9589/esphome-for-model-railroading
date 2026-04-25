
# Simple Setup: ESPHome + EMQX on Windows

This is the easiest path for first-time users on Windows.

Goal:
- Install Docker Desktop
- Enable host networking
- Start MQTT (EMQX)
- Start ESPHome Dashboard
- Create and flash your first board

If you get stuck, use the Copilot prompts in [copilot-steering-prompts.md](copilot-steering-prompts.md).

---

## 10-Minute Quickstart

If you only want the fastest path, run these in **PowerShell as Administrator**:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
choco install docker-desktop -y
```

Reboot, open Docker Desktop, enable host networking (see Step 2), then run:

```powershell
docker run -d --restart always --name emqx -p 1883:1883 -p 18083:18083 emqx/emqx:5
docker run -d --restart always --name esphome --network host -e ESPHOME_DASHBOARD_USE_PING=true -v esphome-config:/config ghcr.io/esphome/esphome:stable dashboard /config
```

Open:
- EMQX: http://localhost:18083
- ESPHome: http://localhost:6052

If this fails, go straight to the **If Something Fails** section.

---

## Before You Start

You need:
- Windows 10/11
- Admin access on your PC
- 2.4 GHz Wi-Fi (ESP boards usually cannot use 5 GHz)
- Chrome or Edge (for first-time USB flash)

Open **PowerShell as Administrator** once and keep using that same window.

---

## 1. Install Docker Desktop (includes WSL support)

Run these commands:

```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
choco install docker-desktop -y
```

Then:
1. Reboot Windows.
2. Open Docker Desktop and finish first-run setup.
3. Wait until Docker says it is running.

Quick check:

```powershell
docker version
docker info
```

If these commands show server info, Docker is ready.

---

## 2. Enable Host Networking

Do this before starting any containers. Without it, ESPHome cannot see your ESP boards on the network for OTA updates or device discovery.

Host networking lets containers share your PC's network adapter directly, so they can reach mDNS announcements from ESP boards on your LAN.

**You must be logged in to Docker Hub.** Create a free account at https://hub.docker.com if you don't have one, then log in:

```powershell
docker login
```

**Enable host networking in Docker Desktop:**
1. Open Docker Desktop.
2. Click the **Settings** gear (top right).
3. Go to **Resources → Network**.
4. Tick **Enable host networking**.
5. Click **Apply & Restart** and wait for Docker to restart.

---

## 3. Start EMQX (MQTT broker)

Run:

```powershell
docker run -d --restart always --name emqx -p 1883:1883 -p 18083:18083 emqx/emqx:5
```

Open http://localhost:18083

Default login:
- Username: admin
- Password: public

Important:
- Change the admin password immediately.
- Create a normal user for your ESP devices.

Quick check:

```powershell
docker ps --filter "name=emqx"
```

---

## 4. Start ESPHome Dashboard

Start ESPHome without port mapping — host networking handles it:

```powershell
docker run -d --restart always --name esphome --network host -e ESPHOME_DASHBOARD_USE_PING=true -v esphome-config:/config ghcr.io/esphome/esphome:stable dashboard /config
```

Open http://localhost:6052

Quick check:

```powershell
docker ps --filter "name=esphome"
```

---

## Next Step

Your PC is ready. Now go to [first-board-setup-guide.md](first-board-setup-guide.md) to create and flash your first board.

---

## Useful Docker Commands

Keep these handy for day-to-day use.

Check what is running:

```powershell
docker ps
```

View recent logs:

```powershell
docker logs emqx --tail 50
docker logs esphome --tail 50
```

Restart a service:

```powershell
docker restart emqx
docker restart esphome
```

---

## If Something Fails

**Docker command not found or fails:**
Docker Desktop is not running yet. Open it from the Start menu and wait 1-2 minutes until it shows "Running".

**Port already in use:**
Something else on your PC is using port 1883, 18083, or 6052. Run this to find the process:
```powershell
netstat -ano | findstr ":1883 :18083 :6052"
```
Then close the conflicting program, or contact your IT support.

**ESP board not found on first flash:**
- Use a data USB cable, not a charge-only cable. Charge-only cables look identical but carry no data.
- Install the board's USB chip driver. Boards with a CP2102 chip: [Silicon Labs CP210x driver](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers). Boards with a CH340 chip: search "CH340 driver Windows".
- Close any other programs that may be using the serial port (e.g. Arduino IDE, PuTTY).
- Use Chrome or Edge. Firefox does not support WebSerial.

**Board will not connect to Wi-Fi:**
- Confirm your network is 2.4 GHz. ESP boards cannot use 5 GHz.
- Double-check the Wi-Fi name and password in `secrets.yaml`. Both are case-sensitive.
- Make sure your router has DHCP enabled (it almost always is by default).
