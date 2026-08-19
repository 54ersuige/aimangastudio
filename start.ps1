# ============================================================
#  AIMangaStudio one-click launcher (PowerShell)
#  - Checks Node.js 18+
#  - Auto-installs deps on first run
#  - Checks port 3001 / 5173
#  - Starts backend + frontend in minimized windows
#  - Opens browser automatically
#  - Subcommands: --shortcut / --stop / --status
# ============================================================
#
# NOTE: This file is intentionally written with ASCII-only comments
# and a BOM-less UTF-8 body. Windows PowerShell 5.1 reads files
# using the system ANSI codepage by default, which corrupts any
# non-ASCII characters. So we keep messages ASCII-safe (or use
# unicode escapes when needed) and never rely on literal Chinese
# strings inside the script.

[CmdletBinding()]
param(
    [switch]$shortcut,
    [switch]$stop,
    [switch]$status,
    [switch]$quiet,
    [switch]$silent,
    [switch]$help
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ScriptDir

$BackendPort  = 3001
$FrontendPort = 5173

# Unicode-safe banner writer. Pass strings via -u ("unicode") so the
# caller is responsible for unicode literals (the host shell must have
# a UTF-8 console codepage or use [System.Console]::OutputEncoding).
function Write-Banner {
    param([Parameter(Mandatory)][string]$Title)
    Write-Host ''
    Write-Host '============================================================' -ForegroundColor Cyan
    Write-Host ('  ' + $Title) -ForegroundColor Cyan
    Write-Host '============================================================' -ForegroundColor Cyan
    Write-Host ''
}

function Test-PortListening {
    param([int]$Port)
    # Fallback chain: Get-NetTCPConnection -> netstat -> assume free.
    # This is more robust across PowerShell versions and Windows SKUs.
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($conn) { return $true }
    # netstat fallback (some Windows editions don't have Get-NetTCPConnection)
    $netstatOut = cmd /c "netstat -ano" 2>$null
    foreach ($line in $netstatOut) {
        if ($line -match ":\s*$Port\s+" -and $line -match 'LISTENING') { return $true }
    }
    return $false
}

function Get-ListeningPid {
    param([int]$Port)
    $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($conn) { return ($conn | Select-Object -First 1).OwningProcess }
    # netstat fallback
    $netstatOut = cmd /c "netstat -ano" 2>$null
    foreach ($line in $netstatOut) {
        if ($line -match ":\s*$Port\s+" -and $line -match 'LISTENING') {
            $parts = ($line -split '\s+') | Where-Object { $_ -ne '' }
            # Last column is the PID
            $last = $parts[-1]
            if ($last -match '^\d+$') { return [int]$last }
        }
    }
    return $null
}

function Stop-NodeChildren {
    Write-Host '[*] Stopping AIMangaStudio processes...' -ForegroundColor Yellow
    Get-Process | Where-Object {
        $_.MainWindowTitle -in @('AIMangaStudio-Backend', 'AIMangaStudio-Frontend')
    } | ForEach-Object {
        try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
    foreach ($p in @($BackendPort, $FrontendPort)) {
        $pid_ = Get-ListeningPid -Port $p
        if ($pid_) {
            try { Stop-Process -Id $pid_ -Force -ErrorAction SilentlyContinue } catch {}
        }
    }
    Write-Host '[OK] Stopped.' -ForegroundColor Green
}

function Show-Status {
    Write-Banner 'AIMangaStudio status'
    foreach ($pair in @(@('Backend (3001)', $BackendPort), @('Frontend (5173)', $FrontendPort))) {
        $name = $pair[0]; $p = $pair[1]
        $pid_ = Get-ListeningPid -Port $p
        if ($pid_) {
            Write-Host ('  [RUNNING] {0,-18} port {1}  PID={2}' -f $name, $p, $pid_) -ForegroundColor Green
        } else {
            Write-Host ('  [STOPPED] {0,-18} port {1}' -f $name, $p) -ForegroundColor DarkGray
        }
    }
    Write-Host ''
}

function New-DesktopShortcut {
    Write-Banner 'Create shortcuts'

    $ws = New-Object -ComObject WScript.Shell
    $iconLoc = 'shell32.dll,13'
    $stopIcon = 'shell32.dll,27'   # different icon for the stop action

    # Shortcuts launch start.ps1 --silent directly via powershell.exe,
    # so no extra wrapper file (start-silent.bat) is needed.
    $silentTarget  = 'powershell.exe'
    $silentArgs    = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $ScriptDir 'start.ps1') + '" --silent'

    $results = @()

    # 1) Desktop "Start AIMangaStudio" shortcut
    try {
        $desktop = [Environment]::GetFolderPath('Desktop')
        $lnkPath = Join-Path $desktop 'AIMangaStudio.lnk'
        if (Test-Path -LiteralPath $lnkPath) { Remove-Item -LiteralPath $lnkPath -Force }
        $sc = $ws.CreateShortcut($lnkPath)
        $sc.TargetPath       = $silentTarget
        $sc.Arguments        = $silentArgs
        $sc.WorkingDirectory = $ScriptDir
        $sc.WindowStyle      = 7
        $sc.IconLocation     = $iconLoc
        $sc.Description      = 'AIMangaStudio (silent launch)'
        $sc.Save()
        $results += ('[OK] Desktop shortcut: ' + $lnkPath)
    } catch {
        $results += ('[SKIP] Desktop failed: ' + $_.Exception.Message)
    }

    # 2) Desktop "Stop AIMangaStudio" shortcut (uses different icon)
    try {
        $desktop = [Environment]::GetFolderPath('Desktop')
        $stopLnk = Join-Path $desktop 'AIMangaStudio - Stop.lnk'
        if (Test-Path -LiteralPath $stopLnk) { Remove-Item -LiteralPath $stopLnk -Force }
        $scStop = $ws.CreateShortcut($stopLnk)
        $scStop.TargetPath       = Join-Path $ScriptDir 'stop.bat'
        $scStop.WorkingDirectory = $ScriptDir
        $scStop.WindowStyle      = 7
        $scStop.IconLocation     = $stopIcon
        $scStop.Description      = 'AIMangaStudio (silent shutdown)'
        $scStop.Save()
        $results += ('[OK] Desktop stop shortcut: ' + $stopLnk)
    } catch {
        $results += ('[SKIP] Desktop stop shortcut failed: ' + $_.Exception.Message)
    }

    # 3) Start Menu (fallback if Desktop fails)
    try {
        $startMenu = [Environment]::GetFolderPath('StartMenu')
        if ($startMenu) {
            $lnkPath2 = Join-Path $startMenu 'AIMangaStudio.lnk'
            if (Test-Path -LiteralPath $lnkPath2) { Remove-Item -LiteralPath $lnkPath2 -Force }
            $sc2 = $ws.CreateShortcut($lnkPath2)
            $sc2.TargetPath       = $silentTarget
            $sc2.Arguments        = $silentArgs
            $sc2.WorkingDirectory = $ScriptDir
            $sc2.WindowStyle      = 7
            $sc2.IconLocation     = $iconLoc
            $sc2.Description      = 'AIMangaStudio (silent launch)'
            $sc2.Save()
            $results += ('[OK] Start Menu shortcut: ' + $lnkPath2)
        }
    } catch {
        $results += ('[SKIP] Start Menu failed: ' + $_.Exception.Message)
    }

    foreach ($r in $results) {
        $color = if ($r -like '[OK]*') { 'Green' } else { 'Yellow' }
        Write-Host ('  ' + $r) -ForegroundColor $color
    }
    Write-Host ''
    Write-Host 'Desktop icons created:' -ForegroundColor Gray
    Write-Host '  - AIMangaStudio          (launch, double-click to start)' -ForegroundColor Gray
    Write-Host '  - AIMangaStudio - Stop    (stop, double-click to shutdown)' -ForegroundColor Gray
    Write-Host ''
}

function Show-Help {
    Write-Banner 'AIMangaStudio launcher'
    Write-Host 'Usage: start.bat [option]'
    Write-Host ''
    Write-Host 'Default behavior (no option):'
    Write-Host '  Plain double-click = SILENT background launch.' -ForegroundColor Green
    Write-Host '  No visible window. Services run in background. Browser opens automatically.' -ForegroundColor Gray
    Write-Host '  On first run, a desktop / start-menu shortcut is created automatically.' -ForegroundColor Gray
    Write-Host ''
    Write-Host 'Options:'
    Write-Host '  (none)        Silent background launch (default)' -ForegroundColor Gray
    Write-Host '  --visible     Same as silent, but PS1 window stays open briefly' -ForegroundColor Gray
    Write-Host '                (useful for debugging)'
    Write-Host '  --status      Show whether ports are listening'
    Write-Host '  --stop        Kill backend and frontend processes'
    Write-Host '  --shortcut    (re)create the desktop / start-menu shortcut'
    Write-Host '  --help        Show this help'
    Write-Host ''
    Write-Host 'Typical workflow:'
    Write-Host '  1) First time: double-click start.bat -> creates desktop icon'
    Write-Host '  2) Every day: double-click the AIMangaStudio icon on your desktop'
    Write-Host '  3) When done: in any terminal, run: start.bat --stop'
    Write-Host ''
}

# ------------------- subcommand dispatch -------------------

if ($help) {
    Show-Help
    exit 0
}

# --shortcut-only: just create shortcuts and exit (no launch)
if ($shortcut -and -not $silent) {
    New-DesktopShortcut
    exit 0
}

# First-run auto-setup: if no desktop shortcut exists yet, create one
# automatically. This way a plain double-click on start.bat creates
# the launcher icon without the user needing to run any commands.
$desktopShortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'AIMangaStudio.lnk'
$startMenuShortcutPath = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'AIMangaStudio.lnk'
$hasShortcut = (Test-Path -LiteralPath $desktopShortcutPath) -or (Test-Path -LiteralPath $startMenuShortcutPath)

if (-not $hasShortcut -and -not $shortcut) {
    Write-Host '[*] First run detected: creating desktop shortcut automatically...' -ForegroundColor Cyan
    New-DesktopShortcut | Out-Null
    Write-Host '[OK] Shortcut created. From now on, just double-click the desktop icon.' -ForegroundColor Green
    Write-Host ''
}

if ($stop) {
    Stop-NodeChildren
    exit 0
}

if ($status) {
    Show-Status
    exit 0
}

# Silent mode implies quiet (no "Press Enter" prompt)
if ($silent) { $quiet = $true }

# ------------------- main flow -------------------

Write-Banner 'AIMangaStudio starting...'

# 1) Node.js check
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host '[X] Node.js not detected.' -ForegroundColor Red
    Write-Host '    Install Node.js 18 or newer: https://nodejs.org/' -ForegroundColor Red
    if (-not $quiet) { Read-Host 'Press Enter to exit' }
    exit 1
}
$nodeVersion = (& node -v) -replace '^v', ''
$nodeMajor   = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 18) {
    Write-Host ('[X] Node.js version too low (current v' + $nodeVersion + ', need 18+).') -ForegroundColor Red
    if (-not $quiet) { Read-Host 'Press Enter to exit' }
    exit 1
}
Write-Host ('[OK] Node.js v' + $nodeVersion + ' detected.') -ForegroundColor Green

# 2) Port check: handle two cases
#    a) A previous AIMangaStudio is still running -> just open browser, exit
#    b) Some other unrelated process is on the port -> warn, but offer auto-cleanup
$bothRunning = $false
$unrelatedProcess = $false

if (Test-PortListening -Port $BackendPort) {
    $pid_ = Get-ListeningPid -Port $BackendPort
    $proc = Get-Process -Id $pid_ -ErrorAction SilentlyContinue
    $procName = if ($proc) { $proc.ProcessName } else { 'unknown' }
    # Heuristic: node.exe holding the port = likely ours
    if ($procName -eq 'node') {
        Write-Host ('[*] Backend port ' + $BackendPort + ' already in use by node (PID=' + $pid_ + ') - looks like a previous AIMangaStudio.') -ForegroundColor Yellow
        $bothRunning = $true
    } else {
        Write-Host ('[!] Backend port ' + $BackendPort + ' is occupied by ' + $procName + ' (PID=' + $pid_ + ').') -ForegroundColor Yellow
        $unrelatedProcess = $true
    }
}
if (Test-PortListening -Port $FrontendPort) {
    $pid_ = Get-ListeningPid -Port $FrontendPort
    $proc = Get-Process -Id $pid_ -ErrorAction SilentlyContinue
    $procName = if ($proc) { $proc.ProcessName } else { 'unknown' }
    if ($procName -eq 'node') {
        Write-Host ('[*] Frontend port ' + $FrontendPort + ' already in use by node (PID=' + $pid_ + ') - looks like a previous AIMangaStudio.') -ForegroundColor Yellow
        $bothRunning = $true
    } else {
        Write-Host ('[!] Frontend port ' + $FrontendPort + ' is occupied by ' + $procName + ' (PID=' + $pid_ + ').') -ForegroundColor Yellow
        $unrelatedProcess = $true
    }
}

# If both ports are already serving and look like ours, just reuse them
if ($bothRunning -and -not $unrelatedProcess) {
    Write-Host '[OK] Detected existing AIMangaStudio instance. Opening browser and exiting.' -ForegroundColor Green
    Start-Process ('http://localhost:' + $FrontendPort)
    if (-not $silent) { Read-Host 'Press Enter to close' }
    exit 0
}

# If ports are taken by unrelated processes, ask user what to do.
# In silent / non-interactive mode, auto-fail without asking.
if ($unrelatedProcess) {
    Write-Host ''
    Write-Host 'What would you like to do?' -ForegroundColor Cyan
    Write-Host '  1) Auto-kill the conflicting process and start fresh' -ForegroundColor Gray
    Write-Host '  2) Exit (do nothing)' -ForegroundColor Gray
    if ($silent) {
        Write-Host '[!] Silent mode: cannot ask. Run: start.bat --stop (or kill PID manually), then retry.' -ForegroundColor Yellow
        exit 1
    }
    $choice = Read-Host 'Enter 1 or 2'
    if ($choice -eq '1') {
        Write-Host '[*] Killing conflicting processes...' -ForegroundColor Yellow
        foreach ($p in @($BackendPort, $FrontendPort)) {
            $pid_ = Get-ListeningPid -Port $p
            if ($pid_) {
                try { Stop-Process -Id $pid_ -Force -ErrorAction SilentlyContinue } catch {}
            }
        }
        Start-Sleep -Seconds 2
        Write-Host '[OK] Conflicting processes killed.' -ForegroundColor Green
    } else {
        Write-Host '[OK] Exiting without changes.' -ForegroundColor Green
        exit 0
    }
}

# 3) Install deps if missing
if (-not (Test-Path -LiteralPath (Join-Path $ScriptDir 'node_modules'))) {
    Write-Host '[*] First run: installing frontend deps (1-2 min)...' -ForegroundColor Cyan
    & npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host '[X] Frontend deps install failed.' -ForegroundColor Red
        if (-not $quiet) { Read-Host 'Press Enter to exit' }
        exit 1
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $ScriptDir 'server/node_modules'))) {
    Write-Host '[*] First run: installing backend deps...' -ForegroundColor Cyan
    Push-Location (Join-Path $ScriptDir 'server')
    & npm install
    $rc = $LASTEXITCODE
    Pop-Location
    if ($rc -ne 0) {
        Write-Host '[X] Backend deps install failed.' -ForegroundColor Red
        if (-not $quiet) { Read-Host 'Press Enter to exit' }
        exit 1
    }
}
Write-Host '[OK] Dependencies ready.' -ForegroundColor Green

# 4) Start backend (minimized window; hidden in --silent mode)
Write-Host ('[*] Starting backend (port ' + $BackendPort + ')...') -ForegroundColor Cyan
$backendCmd = 'title AIMangaStudio-Backend && cd /d "' + $ScriptDir + '/server" && npm run start'
if ($silent) {
    # Use cmd.exe /c (terminate) + hidden window so no console flashes
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $backendCmd -WindowStyle Hidden
} else {
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', $backendCmd -WindowStyle Minimized
}

# 5) Start frontend (minimized window; hidden in --silent mode)
Write-Host ('[*] Starting frontend (port ' + $FrontendPort + ')...') -ForegroundColor Cyan
$frontendCmd = 'title AIMangaStudio-Frontend && cd /d "' + $ScriptDir + '" && npm run dev:client'
if ($silent) {
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $frontendCmd -WindowStyle Hidden
} else {
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', $frontendCmd -WindowStyle Minimized
}

# 6) Wait for frontend port to come up, then open browser.
# In silent mode, do NOT block here — exit immediately and let
# the browser-opening happen in a background poll. This keeps the
# launcher window from lingering for up to 60 seconds.
if ($silent) {
    Write-Host '[*] Services starting in background. Exiting launcher.' -ForegroundColor Cyan
    # Background poll: open the browser when ready, no user-facing output
    Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
        '-Command', "& { while (-not (Test-NetTCPConnection -LocalPort $FrontendPort -State Listen -ErrorAction SilentlyContinue)) { Start-Sleep -Seconds 1 }; Start-Process 'http://localhost:$FrontendPort' }"
    ) -WindowStyle Hidden
} else {
    Write-Host '[*] Waiting for services...' -ForegroundColor Cyan
    $waited = 0
    while ($waited -lt 60) {
        if (Test-PortListening -Port $FrontendPort) { break }
        Start-Sleep -Seconds 1
        $waited++
    }
    if (Test-PortListening -Port $FrontendPort) {
        Write-Host '[OK] Frontend is up. Opening browser...' -ForegroundColor Green
        Start-Process ('http://localhost:' + $FrontendPort)
    } else {
        Write-Host '[!] Timeout waiting for frontend. Open http://localhost:5173 manually.' -ForegroundColor Yellow
    }
}

# In silent mode, exit immediately so the launcher window disappears.
# In normal mode, show a summary and wait for user confirmation.
if (-not $silent) {
    Write-Host ''
    Write-Host '============================================================' -ForegroundColor Green
    Write-Host '  AIMangaStudio is running.' -ForegroundColor Green
    Write-Host ''
    Write-Host ('    Browser:  http://localhost:' + $FrontendPort)
    Write-Host ('    Backend:  http://localhost:' + $BackendPort)
    Write-Host ''
    Write-Host '  Subcommands:'
    Write-Host '    start.bat --status    Show whether ports are listening'
    Write-Host '    start.bat --stop      Stop both processes'
    Write-Host '    start.bat --shortcut  Create a desktop silent-launch shortcut'
    Write-Host '============================================================' -ForegroundColor Green
    Write-Host ''
    Write-Host '(This window can be closed; backend and frontend keep running.)' -ForegroundColor DarkGray
    Write-Host 'To stop the app later, run: start.bat --stop' -ForegroundColor DarkGray
    Write-Host ''
    Read-Host 'Press Enter to close this window'
}

exit 0