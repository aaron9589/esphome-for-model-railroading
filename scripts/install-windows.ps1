# ESPHome Device Builder + Mosquitto setup for Windows 10/11.
# Anonymous MQTT on port 1883 is for a trusted home network only.
# Re-running this script is safe: it skips what is already in place.
#
# Open PowerShell (you do NOT need "Run as administrator") and paste:
#   irm https://raw.githubusercontent.com/aaron9589/esphome-for-model-railroading/main/scripts/install-windows.ps1 -OutFile "$env:TEMP\esphome-mr-setup.ps1"; Start-Process powershell -Verb RunAs -Wait -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$env:TEMP\esphome-mr-setup.ps1`""

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$MarkerBegin = '# BEGIN esphome-for-model-railroading'
$MarkerEnd = '# END esphome-for-model-railroading'
$FirewallName = 'Mosquitto MQTT 1883 (ESPHome model railroad)'
$MinFreeGb = 8
$Log = Join-Path $env:USERPROFILE 'esphome-mr-setup.log'
$DownloadDir = Join-Path $env:USERPROFILE 'esphome-mr-installers'

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdmin)) {
    $scriptPath = $PSCommandPath
    if (-not $scriptPath) {
        Write-Host ''
        Write-Host 'This script was piped into PowerShell, so Windows cannot show the admin prompt from it.' -ForegroundColor Yellow
        Write-Host 'Use the one-liner in installing-esphome-cheatsheet.md. It saves the file, then asks for admin.' -ForegroundColor Yellow
        exit 1
    }
    Write-Host 'Windows needs administrator permission to install Mosquitto and open the firewall.'
    Write-Host 'Approve the User Account Control prompt. A second window will open and do the work.'
    try {
        $elevated = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList @(
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $scriptPath
        )
    } catch {
        Write-Host 'The admin prompt was closed. Nothing was installed.' -ForegroundColor Red
        exit 1
    }
    if (-not $elevated -or $elevated.ExitCode -ne 0) {
        Write-Host 'Setup did not finish. If a second window opened, read the error there.' -ForegroundColor Red
        Write-Host "Log (after a real run): $Log"
        exit 1
    }
    exit 0
}

function Write-Step($Message) {
    Write-Host ''
    Write-Host "======== $Message ========" -ForegroundColor Cyan
}

function Write-Ok($Message) { Write-Host "  OK   $Message" -ForegroundColor Green }
function Write-Warn($Message) { Write-Host "  WARN $Message" -ForegroundColor Yellow }
function Write-Fail($Message) { Write-Host "  FAIL $Message" -ForegroundColor Red }

function Update-MosquittoConf {
    param([string]$Path)
    $dir = Split-Path $Path -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    if (-not (Test-Path $Path)) { New-Item -ItemType File -Path $Path -Force | Out-Null }
    Copy-Item -Path $Path -Destination "$Path.esphome-mr-backup" -Force
    Write-Host "  Backed up config to $Path.esphome-mr-backup"

    $raw = @(Get-Content -Path $Path -ErrorAction SilentlyContinue)
    $cleaned = New-Object System.Collections.Generic.List[string]
    $skip = $false
    foreach ($line in $raw) {
        $trim = $line.Trim()
        if ($trim -eq $MarkerBegin) { $skip = $true; continue }
        if ($skip) {
            if ($trim -eq $MarkerEnd) { $skip = $false }
            continue
        }
        if ($trim -match '^(allow_anonymous|bind_address)\s+') {
            $cleaned.Add("# $line  # disabled by esphome-for-model-railroading setup")
            continue
        }
        if ($trim -match '^listener\s+' -and $trim -match '127\.0\.0\.1') {
            $cleaned.Add("# $line  # disabled: was localhost-only")
            continue
        }
        $cleaned.Add($line)
    }

    $hasLanListener = $false
    foreach ($line in $cleaned) {
        $trim = $line.Trim()
        if ($trim -match '^listener\s+1883(?:\s+(\S+))?') {
            $bind = $Matches[1]
            if (-not $bind -or @('127.0.0.1', 'localhost', '::1') -notcontains $bind) {
                $hasLanListener = $true
            }
        }
    }

    $block = @($MarkerBegin, 'allow_anonymous true')
    if (-not $hasLanListener) { $block += 'listener 1883' }
    $block += $MarkerEnd
    $body = ($cleaned -join "`r`n").TrimEnd()
    $text = $body + "`r`n`r`n" + ($block -join "`r`n") + "`r`n"
    Set-Content -Path $Path -Value $text -Encoding ascii
}

function Get-LatestMosquittoUrl {
    Write-Host '  Looking up the latest Mosquitto Windows installer...'
    $page = Invoke-WebRequest -Uri 'https://mosquitto.org/files/binary/win64/' -UseBasicParsing
    $found = [regex]::Matches($page.Content, 'mosquitto-(\d+\.\d+\.\d+)-install-windows-x64\.exe')
    $bestName = $null
    $bestVersion = $null
    foreach ($item in $found) {
        $version = [version]$item.Groups[1].Value
        if ($null -eq $bestVersion -or $version -gt $bestVersion) {
            $bestVersion = $version
            $bestName = $item.Value
        }
    }
    if (-not $bestName) { throw 'Could not find a Mosquitto Windows installer on mosquitto.org.' }
    Write-Host "  Latest stable installer: $bestName"
    return "https://mosquitto.org/files/binary/win64/$bestName"
}

function Get-LanIPv4 {
    $profiles = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue)
    foreach ($profile in $profiles) {
        $addr = Get-NetIPAddress -InterfaceIndex $profile.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
            Select-Object -First 1
        if ($addr) {
            return [pscustomobject]@{
                IP = $addr.IPAddress
                Name = $profile.InterfaceAlias
                Category = [string]$profile.NetworkCategory
            }
        }
    }
    return $null
}

function Select-SetupAction {
    Write-Host ''
    Write-Host 'ESPHome for Model Railroading'
    Write-Host ''
    Write-Host '  1) Install    ESPHome Device Builder and Mosquitto'
    Write-Host '  2) Uninstall  those two (keeps your board files)'
    Write-Host '  3) Quit'
    Write-Host ''
    while ($true) {
        $choice = Read-Host 'Choose 1, 2, or 3'
        switch ($choice) {
            { $_ -in '1', 'install' } { return 'install' }
            { $_ -in '2', 'uninstall' } { return 'uninstall' }
            { $_ -in '3', 'q', 'quit' } { return 'quit' }
            default { Write-Host 'Type 1, 2, or 3.' }
        }
    }
}

function Get-UninstallEntries([string]$NameLike) {
    $paths = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($path in $paths) {
        Get-ItemProperty $path -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -like $NameLike }
    }
}

function Invoke-SilentUninstall($Entry) {
    $command = $Entry.QuietUninstallString
    if (-not $command) { $command = $Entry.UninstallString }
    if (-not $command) { return $false }
    $exe = $null
    if ($command -match '"([^"]+\.exe)"') { $exe = $Matches[1] }
    elseif ($command -match '([A-Za-z]:\\.+?\.exe)') { $exe = $Matches[1] }
    if ($exe -and (Test-Path $exe)) {
        $proc = Start-Process -FilePath $exe -ArgumentList '/S' -Wait -PassThru
        if ($proc.ExitCode -ne 0) { throw "Uninstall of $($Entry.DisplayName) exited with code $($proc.ExitCode)" }
        return $true
    }
    cmd.exe /c $command
    if ($LASTEXITCODE -ne 0) { throw "Uninstall of $($Entry.DisplayName) exited with code $LASTEXITCODE" }
    return $true
}

function Invoke-OurUninstall {
    Write-Step 'Uninstall'
    Write-Host 'This removes the ESPHome Device Builder app and the Mosquitto broker.'
    Write-Host "Your board files in $env:USERPROFILE\esphome stay."
    Write-Host ''
    $confirm = Read-Host 'Type uninstall to continue'
    if ($confirm -ne 'uninstall') {
        Write-Host 'Cancelled. Nothing was removed.'
        return
    }

    Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessName -like '*ESPHome*' -or $_.ProcessName -eq 'mosquitto' } |
        Stop-Process -Force -ErrorAction SilentlyContinue

    $rule = Get-NetFirewallRule -DisplayName $FirewallName -ErrorAction SilentlyContinue
    if ($rule) {
        Remove-NetFirewallRule -DisplayName $FirewallName
        Write-Ok 'Removed the port 1883 firewall rule'
    } else {
        Write-Ok 'No setup firewall rule was present'
    }

    $mosquittoExe = Join-Path ${env:ProgramFiles} 'mosquitto\mosquitto.exe'
    $service = Get-Service -Name mosquitto -ErrorAction SilentlyContinue
    if ($service) {
        if ($service.Status -eq 'Running') { Stop-Service mosquitto -Force -ErrorAction SilentlyContinue }
        if (Test-Path $mosquittoExe) {
            & $mosquittoExe uninstall
        }
        & sc.exe delete mosquitto | Out-Null
        Write-Ok 'Removed the Mosquitto service'
    } else {
        Write-Ok 'Mosquitto service was not installed'
    }
    $mosquittoApps = @(Get-UninstallEntries '*Mosquitto*')
    if ($mosquittoApps.Count -gt 0) {
        foreach ($app in $mosquittoApps) { Invoke-SilentUninstall $app | Out-Null }
        Write-Ok 'Ran the Mosquitto uninstaller'
    } elseif (Test-Path (Split-Path $mosquittoExe -Parent)) {
        Write-Warn "Mosquitto files are still in $(Split-Path $mosquittoExe -Parent). Remove that folder by hand if the uninstaller did not."
    } else {
        Write-Ok 'Mosquitto was not installed'
    }

    $esphomeApps = @(Get-UninstallEntries '*ESPHome Device Builder*')
    if ($esphomeApps.Count -gt 0) {
        foreach ($app in $esphomeApps) { Invoke-SilentUninstall $app | Out-Null }
        Write-Ok 'Removed ESPHome Device Builder'
    } else {
        Write-Ok 'ESPHome Device Builder was not installed'
    }

    Write-Step 'Done'
    Write-Host 'Uninstall finished.' -ForegroundColor Green
    Write-Host "Left in place: board files in $env:USERPROFILE\esphome"
    Write-Host "Full log: $Log"
}

$exitCode = 0
try {
    Start-Transcript -Path $Log -Force | Out-Null
    Write-Step 'ESPHome for Model Railroading — Windows setup'
    Write-Host 'Choose install or uninstall. A full copy of this output is saved to:'
    Write-Host "  $Log"

    $action = Select-SetupAction
    Write-Host "Selected: $action"
    if ($action -eq 'quit') {
        Write-Host 'Cancelled. Nothing was changed.'
        return
    }
    if ($action -eq 'uninstall') {
        Invoke-OurUninstall
        return
    }

    Write-Host 'This installs the ESPHome Device Builder app and the Mosquitto MQTT broker.'
    Write-Step '1/7 Preflight'
    $os = Get-CimInstance Win32_OperatingSystem
    Write-Host "  Windows: $($os.Caption) ($($os.Version))"
    if ([Environment]::OSVersion.Version.Major -lt 10) {
        throw 'This script needs Windows 10 or Windows 11.'
    }
    Write-Ok 'Windows version is new enough'

    if (-not [Environment]::Is64BitOperatingSystem) {
        throw 'This script needs 64-bit Windows. 32-bit Windows cannot run the current ESPHome installer.'
    }
    Write-Ok '64-bit Windows'

    $driveName = $env:SystemDrive.TrimEnd(':')
    $drive = Get-PSDrive -Name $driveName
    $freeGb = [math]::Round($drive.Free / 1GB, 1)
    Write-Host "  Free space on ${driveName}: ${freeGb} GB (ESPHome's first compile downloads a few GB of tools)"
    if ($freeGb -lt $MinFreeGb) {
        throw "Need at least $MinFreeGb GB free on $env:SystemDrive. Free some space and run this again."
    }
    Write-Ok 'Enough disk space'

    try {
        $null = Invoke-WebRequest -Uri 'https://github.com' -UseBasicParsing -TimeoutSec 20 -Method Head
        Write-Ok 'Internet works'
    } catch {
        throw 'Cannot reach github.com. Check Wi-Fi, then run this again.'
    }

    $port1883 = @(Get-NetTCPConnection -LocalPort 1883 -State Listen -ErrorAction SilentlyContinue)
    if ($port1883.Count -gt 0) {
        $owner = (Get-Process -Id $port1883[0].OwningProcess -ErrorAction SilentlyContinue).ProcessName
        if ($owner -match 'mosquitto') {
            Write-Ok 'Port 1883 is already Mosquitto. Config will be checked.'
        } else {
            throw "Port 1883 is in use by '$owner', not Mosquitto. Quit that program (an old EMQX or Docker container counts) and run this again."
        }
    } else {
        Write-Ok 'Port 1883 is free'
    }

    $port6052 = @(Get-NetTCPConnection -LocalPort 6052 -State Listen -ErrorAction SilentlyContinue)
    if ($port6052.Count -gt 0) {
        Write-Warn 'Port 6052 is already in use. If that is ESPHome, the dashboard is already up. If not, quit the other app before opening the dashboard.'
    } else {
        Write-Ok 'Port 6052 is free'
    }

    Write-Step '2/7 Mosquitto'
    New-Item -ItemType Directory -Path $DownloadDir -Force | Out-Null
    $mosquittoExe = Join-Path ${env:ProgramFiles} 'mosquitto\mosquitto.exe'
    if (Test-Path $mosquittoExe) {
        Write-Ok "Mosquitto is already installed at $mosquittoExe"
    } else {
        $mosquittoUrl = Get-LatestMosquittoUrl
        $installer = Join-Path $DownloadDir (Split-Path $mosquittoUrl -Leaf)
        Write-Host "  Downloading $mosquittoUrl"
        & curl.exe -fL --retry 3 --retry-delay 2 -o $installer $mosquittoUrl
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $installer)) {
            throw "Download failed. The installer URL was $mosquittoUrl"
        }
        Unblock-File -Path $installer
        Write-Host '  Running the Mosquitto installer silently...'
        $install = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
        if ($install.ExitCode -ne 0) {
            throw "Mosquitto installer exited with code $($install.ExitCode). You can run it by hand from $installer"
        }
        if (-not (Test-Path $mosquittoExe)) {
            throw "Installer finished but $mosquittoExe is missing. Run $installer by double-clicking it."
        }
        Write-Ok 'Mosquitto installed'
    }

    $conf = Join-Path ${env:ProgramFiles} 'mosquitto\mosquitto.conf'
    Update-MosquittoConf -Path $conf
    Write-Ok 'Mosquitto will accept connections on port 1883 with no username (home network)'

    $service = Get-Service -Name mosquitto -ErrorAction SilentlyContinue
    if (-not $service) {
        Write-Host '  Registering the Mosquitto Windows service...'
        & $mosquittoExe install
        if ($LASTEXITCODE -ne 0) { throw "mosquitto.exe install failed with exit code $LASTEXITCODE" }
    }
    $service = Get-Service -Name mosquitto -ErrorAction SilentlyContinue
    if (-not $service) { throw 'The Mosquitto service was not created. Install Mosquitto from the downloaded exe and include the Service component.' }

    if ($service.Status -eq 'Running') {
        Restart-Service mosquitto -Force
    } else {
        Start-Service mosquitto
    }
    $service.WaitForStatus('Running', '00:00:20')
    Write-Ok 'Mosquitto service is running'

    $pub = Join-Path ${env:ProgramFiles} 'mosquitto\mosquitto_pub.exe'
    $sub = Join-Path ${env:ProgramFiles} 'mosquitto\mosquitto_sub.exe'
    $subOut = Join-Path $env:TEMP 'esphome-mr-sub.txt'
    Remove-Item $subOut -ErrorAction SilentlyContinue
    $subProc = Start-Process -FilePath $sub -ArgumentList @('-h', '127.0.0.1', '-t', 'esphome-mr/setup-test', '-C', '1', '-W', '8') -RedirectStandardOutput $subOut -PassThru -WindowStyle Hidden
    Start-Sleep -Seconds 1
    & $pub -h 127.0.0.1 -t 'esphome-mr/setup-test' -m 'Mosquitto works'
    if ($LASTEXITCODE -ne 0) { throw "mosquitto_pub failed with exit code $LASTEXITCODE" }
    $subProc.WaitForExit(12000) | Out-Null
    $heard = ''
    if (Test-Path $subOut) { $heard = Get-Content $subOut -Raw }
    if ($heard -notmatch 'Mosquitto works') {
        throw 'Local publish/subscribe test failed. Mosquitto is not accepting clients on this PC.'
    }
    Write-Ok 'Publish/subscribe test passed on this PC'

    $lan = Get-LanIPv4
    if ($lan) {
        Write-Host "  LAN address: $($lan.IP) on $($lan.Name) ($($lan.Category))"
        $lanOk = $false
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            $iar = $client.BeginConnect($lan.IP, 1883, $null, $null)
            $lanOk = $iar.AsyncWaitHandle.WaitOne(5000, $false) -and $client.Connected
        } catch {
            $lanOk = $false
        } finally {
            $client.Close()
        }
        if ($lanOk) {
            Write-Ok "Broker accepts connections on LAN IP $($lan.IP)"
        } else {
            Write-Warn "Could not connect to $($lan.IP):1883. Boards on Wi-Fi will not connect until this works."
        }
        if ($lan.Category -eq 'Public') {
            Write-Warn "Windows calls '$($lan.Name)' a Public network. The firewall rule below is for Private networks only."
            Write-Warn "Set that network to Private (Settings → Network → your Wi-Fi → network profile) or boards on Wi-Fi will be blocked."
        }
    } else {
        Write-Warn 'Could not find a LAN IP. In PowerShell run ipconfig and use the IPv4 address of your Wi-Fi adapter.'
    }

    $rule = Get-NetFirewallRule -DisplayName $FirewallName -ErrorAction SilentlyContinue
    if (-not $rule) {
        New-NetFirewallRule -DisplayName $FirewallName -Direction Inbound -Action Allow -Protocol TCP -LocalPort 1883 -Profile Private, Domain | Out-Null
        Write-Ok 'Firewall allows inbound TCP 1883 on Private and Domain networks'
    } else {
        Write-Ok 'Firewall rule already exists'
    }

    Write-Step '3/7 ESPHome Device Builder'
    Write-Host '  Asking GitHub for the latest official desktop app...'
    $release = Invoke-RestMethod -Headers @{
        'User-Agent' = 'esphome-for-model-railroading-setup'
        'Accept' = 'application/vnd.github+json'
    } -Uri 'https://api.github.com/repos/esphome/esphome-desktop/releases/latest'
    $asset = @($release.assets | Where-Object { $_.name -like '*_x64-setup.exe' } | Select-Object -First 1)
    if (-not $asset -or -not $asset.browser_download_url) {
        throw 'Could not find an ESPHome Windows installer in the latest GitHub release.'
    }
    $version = $release.tag_name.TrimStart('v')
    Write-Host "  Latest ESPHome Device Builder: $version"
    $esphomeSetup = Join-Path $DownloadDir $asset.name
    $already = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -like '*ESPHome Device Builder*' } |
        Select-Object -First 1
    if ($already -and $already.DisplayVersion -eq $version) {
        Write-Ok "ESPHome Device Builder $version is already installed. Skipping download."
    } else {
        if ($already) { Write-Host "  Installed version is $($already.DisplayVersion). Upgrading to $version." }
        Write-Host "  Downloading $($asset.browser_download_url)"
        & curl.exe -fL --retry 3 --retry-delay 2 -o $esphomeSetup $asset.browser_download_url
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $esphomeSetup)) {
            throw "ESPHome download failed. URL was $($asset.browser_download_url)"
        }
        Unblock-File -Path $esphomeSetup
        Write-Host '  Running the ESPHome installer silently...'
        $appInstall = Start-Process -FilePath $esphomeSetup -ArgumentList '/S' -Wait -PassThru
        if ($appInstall.ExitCode -ne 0) {
            throw "ESPHome installer exited with code $($appInstall.ExitCode). Double-click $esphomeSetup and finish it by hand. If Windows says it protected your PC, choose More info → Run anyway."
        }
        Write-Ok "Installed ESPHome Device Builder $version"
    }

    Write-Step '4/7 Open the dashboard'
    Write-Host '  Launching ESPHome. The first time, it downloads its own Python and can sit there for several minutes.'
    Write-Host '  When it is ready it opens http://localhost:6052'
    $launch = @(
        (Join-Path $env:LOCALAPPDATA 'ESPHome Device Builder\ESPHome Device Builder.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\ESPHome Device Builder\ESPHome Device Builder.exe')
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $launch) {
        $shortcut = Get-ChildItem -Path "$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -Filter '*ESPHome*.lnk' -Recurse -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($shortcut) { $launch = $shortcut.FullName }
    }
    if ($launch) {
        Start-Process -FilePath $launch
        Write-Ok "Started $launch"
    } else {
        Write-Warn 'Could not find the ESPHome app to start it. Open "ESPHome Device Builder" from the Start menu.'
    }

    Write-Step '5/7 What you should see'
    Write-Host '  Notification area: an ESPHome icon. Use Open Dashboard and Open Config Folder.'
    Write-Host "  Config files: $env:USERPROFILE\esphome"
    Write-Host '  Dashboard:    http://localhost:6052'
    if ($lan) {
        Write-Host "  MQTT broker:  $($lan.IP)   port 1883   no username or password"
    } else {
        Write-Host '  MQTT broker:  (the IPv4 address from ipconfig)   port 1883'
    }
    Write-Host '  Put that LAN IP in the Configurator and in JMRI. Do not use localhost in the board YAML.'
    Write-Host "  Installers kept at: $DownloadDir"

    Write-Step '6/7 Done'
    Write-Host 'Setup finished.' -ForegroundColor Green
    Write-Host 'Next: https://aaron9589.github.io/esphome-for-model-railroading/  then first-board-setup-guide.md'
    Write-Host "Full log: $Log"
} catch {
    $exitCode = 1
    Write-Fail $_.Exception.Message
    Write-Host "Full log: $Log" -ForegroundColor Yellow
    Write-Host ''
    Write-Host 'Setup failed. Copy the error above and that log, then raise a GitHub issue:' -ForegroundColor Yellow
    Write-Host '  https://github.com/aaron9589/esphome-for-model-railroading/issues/new'
    Write-Host "Paste the error text and the contents of $Log"
} finally {
    try { Stop-Transcript | Out-Null } catch { }
    Write-Host ''
    Read-Host 'Press Enter to close this window'
}

exit $exitCode
