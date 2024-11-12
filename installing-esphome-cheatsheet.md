
# Step-by-Step Guide for Setting Up Your System with Chocolatey, WSL, Docker, and ESPHome

This guide provides a comprehensive walkthrough for installing and configuring essential tools like Chocolatey, WSL (Windows Subsystem for Linux), Docker Desktop, and ESPHome. Follow these steps carefully to ensure a smooth setup.

---

## Step 1: Install Chocolatey

Chocolatey is a Package Manager that makes it easy to install applications. We will use Chocolatey to install Docker Desktop. Docker Desktop is used to run containers, which is what the ESPHome dashboard and EMQX (the MQTT Broker) run in. It saves you
from having to install applications directly on your PC.

1. Open **PowerShell** as an administrator:
   - Press `Win + S`, type "PowerShell," right-click, and select **Run as administrator**.

2. Run the following command to install Chocolatey:
   ```powershell
   Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
   ```

3. After installation, close PowerShell and reopen it as an administrator.

---

## Step 2: Install Docker Desktop Using Chocolatey

1. Use Chocolatey to install Docker Desktop:
   ```powershell
   choco install docker-desktop
   ```

2. Once installed:
   - Open Docker Desktop.
   - Sign in with your Docker account.
   - Enable **Auto Start** in the settings.

3. Navigate to **Resources > Network** in Docker Desktop and enable **Host Networking**.

4. Ensure at the bottom left, the Docker engine is running. 

---

## Step 3: Deploy EMQX MQTT Broker

1. Run the following command in PowerShell to deploy the EMQX broker:
   ```powershell
   docker run -d --restart always --name emqx -p 1883:1883 -p 8083:8083 -p 8084:8084 -p 8883:8883 -p 18083:18083 emqx/emqx:latest
   ```

2. Once running, access the EMQX dashboard by navigating to http://localhost:18083/ using the following credentials:
   - **Username:** `admin`
   - **Password:** `public`

---

## Step 4: Deploy ESPHome

1. Deploy ESPHome using the following command:
   ```powershell
   docker run -d --restart always --net=host --name esphome -e ESPHOME_DASHBOARD_USE_PING=true -v esphome-config:/config -it ghcr.io/esphome/esphome
   ```

2. Once Running, browse to http://localhost:6052 to access the ESPHome Dashboard. From here you can start creating a new device in the right hand corner by clicking 'new device'

## Step 5: Create Your First Device

1. Open the ESPHome Dashboard. Select 'New Device'

2. Give your device a name, click next
   
4. Under the 'Installation' Step - click skip. We will configure the device further before deploying.

5. Choose your device type. Generally ESP32 works best unless you have one with strange hardware.

6. Hit Skip instead of Install.

7. Click 'Edit' on the newly created file. Add any additional config such as MQTT brokers, etc.

8. Once ready, hit install. Generally on first provision of a device, you want to use your web browser (Chrome or Edge only). Afterwards you can deploy wirelessly.

---

## Troubleshooting Tips

- Ensure you have administrator privileges for every step requiring elevated access.
- Restart PowerShell or your machine if you encounter any installation issues.
- Verify Docker Desktop and its settings if services fail to start.

---
