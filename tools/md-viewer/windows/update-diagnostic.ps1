$ErrorActionPreference = 'Stop'
$diagnostics = Join-Path $env:RUNNER_TEMP 'RDViewer-update-diagnostics'
$workspace = Join-Path $env:RUNNER_TEMP ('RDViewer update diagnostic ' + [guid]::NewGuid().ToString('N'))
$installDirectory = Join-Path $workspace 'Installed RDViewer'
$dataDirectory = Join-Path $env:APPDATA 'RDViewer'
$cacheDirectory = Join-Path $dataDirectory 'updates'
$logFile = Join-Path $cacheDirectory 'update-result.json'
$automationFile = Join-Path $dataDirectory 'automation.json'
$executable = Join-Path $installDirectory 'RDViewer.exe'
$name = 'RDViewer-0.4.12-windows-x64-setup.exe'
$installer = Join-Path $workspace $name
$origin = 'http://127.0.0.1:4318'

New-Item -ItemType Directory -Path $workspace, $diagnostics, $cacheDirectory -Force | Out-Null

function Wait-Diagnostic([scriptblock]$Check, [string]$Description, [int]$Seconds = 60) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        try { if (& $Check) { return } } catch { }
        if (Test-Path -LiteralPath $logFile) {
            $state = Get-Content -LiteralPath $logFile -Raw | ConvertFrom-Json
            if ($state.stage -eq 'error') { throw ('Updater helper failed: ' + ($state | ConvertTo-Json -Compress)) }
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "Timed out: $Description"
}

try {
    if (Get-NetTCPConnection -LocalPort 4318 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 4318 occupied before diagnostic.' }
    Remove-Item -LiteralPath $logFile -Force -ErrorAction SilentlyContinue
    $base = 'https://github.com/on1659/RDViewer/releases/download/v0.4.12/'
    Invoke-WebRequest ($base + $name) -OutFile $installer -TimeoutSec 120
    $manifestFile = Join-Path $workspace ($name + '.sha256')
    Invoke-WebRequest ($base + $name + '.sha256') -OutFile $manifestFile -TimeoutSec 30
    $manifest = [IO.File]::ReadAllText($manifestFile)
    if ($manifest -notmatch ('^([a-fA-F0-9]{64})  ' + [regex]::Escape($name) + '\s*$')) { throw 'Invalid public installer checksum manifest.' }
    $expectedHash = $Matches[1].ToLowerInvariant()
    if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) { throw 'Public installer checksum did not match.' }
    $initialInstall = Start-Process -FilePath $installer -ArgumentList "/S /D=$installDirectory" -Wait -PassThru
    if ($initialInstall.ExitCode -ne 0) { throw 'Initial old-version installation failed.' }
    Start-Process -FilePath $executable | Out-Null
    Wait-Diagnostic { (Invoke-RestMethod "$origin/api/info" -TimeoutSec 2).app -eq 'folio' } 'old application server'
    Wait-Diagnostic {
        if (-not (Test-Path -LiteralPath $automationFile)) { return $false }
        $connection = Get-Content -LiteralPath $automationFile -Raw | ConvertFrom-Json
        return $connection.baseURL -eq $origin -and [bool](Get-Process -Id $connection.pid -ErrorAction SilentlyContinue)
    } 'old application descriptor'
    $before = Get-Content -LiteralPath $automationFile -Raw | ConvertFrom-Json
    $cacheInstaller = Join-Path $cacheDirectory $name
    Copy-Item -LiteralPath $installer -Destination $cacheInstaller -Force
    & node (Join-Path $PSScriptRoot 'update-roundtrip.mjs') $cacheInstaller $installDirectory $cacheDirectory '0.4.12' $expectedHash ([string]$before.pid)
    if ($LASTEXITCODE -ne 0) { throw 'Source native updater adapter failed.' }
    Write-Host ('Closing exact app process normally: ' + $before.pid)
    $main = Get-Process -Id $before.pid
    if (-not $main.CloseMainWindow()) { throw 'Normal main-window close failed.' }
    Wait-Diagnostic {
        if (-not (Test-Path -LiteralPath $automationFile)) { return $false }
        $after = Get-Content -LiteralPath $automationFile -Raw | ConvertFrom-Json
        if ($after.pid -eq $before.pid) { return $false }
        return (Invoke-RestMethod "$origin/api/info" -TimeoutSec 2).app -eq 'folio'
    } 'native adapter installation and relaunch' 180
    Wait-Diagnostic {
        if (-not (Test-Path -LiteralPath $logFile)) { return $false }
        return (Get-Content -LiteralPath $logFile -Raw | ConvertFrom-Json).stage -eq 'complete'
    } 'native helper completion'
    Write-Host 'Verified production Windows updater adapter: fixed real EXE, normal app exit, silent reinstall, relaunch.'
    Get-Content -LiteralPath $logFile -Raw | Write-Host
} catch {
    $_ | Format-List -Force | Out-String | Set-Content -LiteralPath (Join-Path $diagnostics 'failure.txt')
    if (Test-Path -LiteralPath $logFile) { Get-Content -LiteralPath $logFile -Raw | Write-Host }
    Get-Process -Name RDViewer,powershell -ErrorAction SilentlyContinue | Select-Object Id,Path,StartTime,MainWindowTitle | Format-List | Out-String | Write-Host
    throw
} finally {
    if (Test-Path -LiteralPath $logFile) { Copy-Item -LiteralPath $logFile -Destination (Join-Path $diagnostics 'update-result.json') -Force }
    Get-Process -Name RDViewer,powershell -ErrorAction SilentlyContinue | Select-Object Id,Path,StartTime,MainWindowTitle | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $diagnostics 'processes.json')
    Get-Process -Name RDViewer -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $executable } | Stop-Process -Force -ErrorAction SilentlyContinue
}
