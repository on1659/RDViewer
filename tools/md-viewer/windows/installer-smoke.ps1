param([Parameter(Mandatory = $true)][string]$Installer)
$ErrorActionPreference = 'Stop'
$Installer = (Resolve-Path -LiteralPath $Installer).Path
$origin = 'http://127.0.0.1:4318'
$workspace = Join-Path $env:RUNNER_TEMP ('RDViewer installer smoke ' + [guid]::NewGuid().ToString('N'))
$installDirectory = Join-Path $workspace 'Installed RDViewer'
$project = Join-Path $workspace 'Sample project'
$hiddenDirectory = Join-Path $project '.claude'
$hiddenDocument = Join-Path $hiddenDirectory 'WORKFLOW.md'
$dataDirectory = Join-Path $env:APPDATA 'RDViewer'
$sentinel = Join-Path $dataDirectory ('installer-smoke-' + [guid]::NewGuid().ToString('N') + '.txt')
$marker = 'RDViewer installed EXE smoke document'
$appProcess = $null
$agentDirectory = Join-Path $installDirectory 'resources/agent'
$agentCLI = Join-Path $agentDirectory 'cli.mjs'
$automationFile = Join-Path $dataDirectory 'automation.json'

function Invoke-AgentCLI([string[]]$AgentArguments) {
    $launch = [Diagnostics.ProcessStartInfo]::new((Join-Path $installDirectory 'RDViewer.exe'))
    $launch.UseShellExecute = $false
    $launch.CreateNoWindow = $true
    $launch.RedirectStandardOutput = $true
    $launch.RedirectStandardError = $true
    $launch.Environment['ELECTRON_RUN_AS_NODE'] = '1'
    $launch.ArgumentList.Add($agentCLI)
    foreach ($argument in $AgentArguments) { $launch.ArgumentList.Add($argument) }
    $launch.ArgumentList.Add('--descriptor')
    $launch.ArgumentList.Add($automationFile)
    $client = [Diagnostics.Process]::new()
    $client.StartInfo = $launch
    $client.Start() | Out-Null
    $stdout = $client.StandardOutput.ReadToEndAsync()
    $stderr = $client.StandardError.ReadToEndAsync()
    if (-not $client.WaitForExit(45000)) { $client.Kill(); throw 'Installed agent CLI timed out.' }
    $output = $stdout.GetAwaiter().GetResult()
    $errors = $stderr.GetAwaiter().GetResult()
    if ($client.ExitCode -ne 0) { throw ('Installed agent CLI failed: ' + $output + $errors) }
    return ($output | ConvertFrom-Json)
}

function Test-InstalledMCP {
    $launch = [Diagnostics.ProcessStartInfo]::new((Join-Path $installDirectory 'RDViewer.exe'))
    $launch.UseShellExecute = $false
    $launch.CreateNoWindow = $true
    $launch.RedirectStandardInput = $true
    $launch.RedirectStandardOutput = $true
    $launch.RedirectStandardError = $true
    $launch.Environment['ELECTRON_RUN_AS_NODE'] = '1'
    $launch.Environment['RDVIEWER_AUTOMATION_FILE'] = $automationFile
    $launch.ArgumentList.Add((Join-Path $agentDirectory 'mcp.mjs'))
    $client = [Diagnostics.Process]::new()
    $client.StartInfo = $launch
    $client.Start() | Out-Null
    $stdout = $client.StandardOutput.ReadToEndAsync()
    $stderr = $client.StandardError.ReadToEndAsync()
    $client.StandardInput.WriteLine('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"rdviewer-ci","version":"1"}}}')
    $client.StandardInput.WriteLine('{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
    $client.StandardInput.WriteLine('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"rdviewer_connection","arguments":{}}}')
    $client.StandardInput.Close()
    if (-not $client.WaitForExit(15000)) { $client.Kill(); throw 'Installed MCP helper timed out.' }
    $output = $stdout.GetAwaiter().GetResult()
    $errors = $stderr.GetAwaiter().GetResult()
    if ($client.ExitCode -ne 0) { throw ('Installed MCP helper failed: ' + $errors) }
    $messages = @($output -split '\r?\n' | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })
    $initialized = @($messages | Where-Object { $_.id -eq 1 })
    $listed = @($messages | Where-Object { $_.id -eq 2 })
    $connected = @($messages | Where-Object { $_.id -eq 3 })
    if ($initialized.Count -ne 1 -or $initialized[0].result.serverInfo.name -ne 'rdviewer' -or $listed.Count -ne 1 -or -not (@($listed[0].result.tools).name -contains 'rdviewer') -or $connected.Count -ne 1) {
        throw 'Installed MCP initialize/tools/list failed.'
    }
    $state = $connected[0].result.content[0].text | ConvertFrom-Json
    if (-not $state.connected -or $null -ne $state.token) { throw 'Installed MCP connection tool failed or exposed credentials.' }
}

function Wait-Until([scriptblock]$Check, [string]$Description, [int]$Seconds = 45) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        try { if (& $Check) { return } } catch { }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "Timed out: $Description"
}

function Invoke-Installer {
    # NSIS requires /D last and without quotes, including when the path has spaces.
    $process = Start-Process -FilePath $Installer -ArgumentList "/S /D=$installDirectory" -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Installer exited with $($process.ExitCode)" }
    Wait-Until { Test-Path -LiteralPath (Join-Path $installDirectory 'resources/app.asar') } 'installation files'
}

function Stop-InstalledApp {
    # Only terminate processes belonging to this test's installation.
    Get-Process -Name RDViewer -ErrorAction SilentlyContinue | Where-Object {
        $_.Path -eq (Join-Path $installDirectory 'RDViewer.exe')
    } | Stop-Process -Force -ErrorAction SilentlyContinue
    if ($null -ne $appProcess) { $appProcess.WaitForExit(10000) | Out-Null }
}

try {
    if (Get-NetTCPConnection -LocalPort 4318 -State Listen -ErrorAction SilentlyContinue) {
        throw 'RDViewer port 4318 is occupied before smoke test.'
    }
    New-Item -ItemType Directory -Path $hiddenDirectory, $dataDirectory -Force | Out-Null
    Set-Content -LiteralPath $hiddenDocument -Value "# $marker" -Encoding utf8
    Set-Content -LiteralPath (Join-Path $project '.workflow.md') -Value '# Dotfile at root' -Encoding utf8
    $pngFile = Join-Path $project 'sample.png'
    [IO.File]::WriteAllBytes($pngFile, [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII='))
    # Streaming fixture verifies transport and seeking; playback is checked with a valid H.264/AAC file in browser QA.
    $mp4File = Join-Path $project 'sample.mp4'
    [byte[]]$mp4Bytes = 0..255
    [IO.File]::WriteAllBytes($mp4File, $mp4Bytes)
    $htmlFile = Join-Path $project 'automation.html'
    Set-Content -LiteralPath $htmlFile -Encoding utf8 -Value @'
<!doctype html><html><head><meta charset="utf-8"><title>RDViewer automation fixture</title></head>
<body><h1>RDViewer native automation smoke</h1><label for="name">Name</label><input id="name"><button id="hello">Greet</button><p id="greeting">Waiting</p><button id="increment">Increment</button><p id="counter">0</p><canvas id="canvas" width="400" height="200"></canvas>
<script>let count=0;document.querySelector('#increment').onclick=()=>document.querySelector('#counter').textContent=String(++count);document.querySelector('#hello').onclick=()=>document.querySelector('#greeting').textContent='Hello '+document.querySelector('#name').value;const canvas=document.querySelector('#canvas'),context=canvas.getContext('2d');function draw(time){context.fillStyle='#211e29';context.fillRect(0,0,400,200);context.fillStyle='#c4a1f5';context.fillRect((time/8)%320,50,80,80);requestAnimationFrame(draw)}requestAnimationFrame(draw);</script></body></html>
'@
    Set-Content -LiteralPath $sentinel -Value 'preserve existing user data' -Encoding utf8
    $defaultAppKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.md\UserChoice'
    $originalDefault = if (Test-Path -LiteralPath $defaultAppKey) { (Get-ItemProperty -LiteralPath $defaultAppKey).ProgId } else { $null }

    Invoke-Installer
    if ((Get-Content -LiteralPath $sentinel -Raw).Trim() -ne 'preserve existing user data') { throw 'Install altered user data.' }
    $executable = Join-Path $installDirectory 'RDViewer.exe'
    $command = (Get-Item 'HKCU:\Software\Classes\RDViewer.Markdown\shell\open\command').GetValue('')
    if ($command -ne ('"' + $executable + '" "%1"')) { throw "Unexpected open command: $command" }
    foreach ($extension in @('.md', '.markdown', '.mdown')) {
        $candidate = Get-Item "HKCU:\Software\Classes\$extension\OpenWithProgids"
        if ($candidate.GetValueNames() -notcontains 'RDViewer.Markdown') { throw "$extension OpenWith registration missing." }
    }
    $currentDefault = if (Test-Path -LiteralPath $defaultAppKey) { (Get-ItemProperty -LiteralPath $defaultAppKey).ProgId } else { $null }
    if ($originalDefault -ne $currentDefault) { throw 'Installer changed the current default Markdown app.' }

    $appProcess = Start-Process -FilePath $executable -ArgumentList ('"' + $hiddenDocument + '"') -PassThru
    Wait-Until { (Invoke-RestMethod "$origin/api/info" -TimeoutSec 2).app -eq 'folio' } 'installed application server'
    $shortcuts = Invoke-WebRequest "$origin/shortcuts.mjs" -TimeoutSec 5
    if ($shortcuts.StatusCode -ne 200 -or $shortcuts.Headers['Content-Type'] -notmatch 'javascript' -or $shortcuts.Content -notmatch 'createShortcutRegistry') {
        throw 'Installed reader shortcut module is missing or invalid.'
    }
    $fonts = Invoke-WebRequest "$origin/font-preferences.mjs" -TimeoutSec 5
    if ($fonts.StatusCode -ne 200 -or $fonts.Headers['Content-Type'] -notmatch 'javascript' -or $fonts.Content -notmatch 'readerFontFamily') {
        throw 'Installed reader font module is missing or invalid.'
    }
    $fontCatalog = Invoke-RestMethod "$origin/api/fonts" -TimeoutSec 15
    if (-not $fontCatalog.available -or @($fontCatalog.fonts).Count -lt 1 -or @($fontCatalog.fonts).Count -gt 2000) {
        throw 'Installed Windows font catalog is missing or empty.'
    }
    foreach ($family in $fontCatalog.fonts) {
        if (-not $family.family -or -not $family.displayName -or @($family.PSObject.Properties.Name).Count -ne 2) {
            throw 'Installed Windows font catalog leaked metadata or returned invalid names.'
        }
    }
    $updates = Invoke-RestMethod "$origin/api/updates" -TimeoutSec 5
    if (-not $updates.supported -or $updates.currentVersion -notmatch '^\d+\.\d+\.\d+$' -or $updates.status -eq 'unsupported') {
        throw 'Installed EXE update manager is missing or unsupported.'
    }
    $initialAutoUpdate = [bool]$updates.autoUpdate
    $changed = Invoke-RestMethod "$origin/api/updates/settings" -Method Post -ContentType 'application/json' -Headers @{ 'X-Folio-Request' = '1' } -Body (@{ autoUpdate = $false } | ConvertTo-Json)
    if ($changed.autoUpdate -ne $false) { throw 'Automatic update toggle did not turn off.' }
    $savedUpdates = Get-Content -LiteralPath (Join-Path $dataDirectory 'updates.json') -Raw | ConvertFrom-Json
    if ($savedUpdates.autoUpdate -ne $false) { throw 'Automatic update preference did not persist.' }
    $forbiddenUpdate = Invoke-WebRequest "$origin/api/updates/install" -Method Post -ContentType 'application/json' -Body '{}' -SkipHttpErrorCheck
    if ($forbiddenUpdate.StatusCode -ne 403) { throw 'Update action accepted missing request marker.' }
    $forbiddenUpdateOrigin = Invoke-WebRequest "$origin/api/updates/install" -Method Post -ContentType 'application/json' -Headers @{ 'X-Folio-Request' = '1'; Origin = 'https://example.invalid' } -Body '{}' -SkipHttpErrorCheck
    if ($forbiddenUpdateOrigin.StatusCode -ne 403) { throw 'Update action accepted external browser origin.' }
    Invoke-RestMethod "$origin/api/updates/settings" -Method Post -ContentType 'application/json' -Headers @{ 'X-Folio-Request' = '1' } -Body (@{ autoUpdate = $initialAutoUpdate } | ConvertTo-Json) | Out-Null
    Write-Host 'Installed EXE: update status, saved automatic-update preference, and request guards passed.'
    Wait-Until { @((Invoke-RestMethod "$origin/api/tree?project=loose" -TimeoutSec 2).files).Count -ge 1 } 'command-line Markdown open'
    $opened = (Invoke-RestMethod "$origin/api/tree?project=loose").files | Where-Object { $_.name -eq 'WORKFLOW.md' } | Select-Object -First 1
    if ($null -eq $opened) { throw 'Launch argument was not opened.' }
    $document = Invoke-RestMethod ("$origin/api/document?path=" + [uri]::EscapeDataString($opened.path))
    if (-not $document.content.Contains($marker)) { throw 'Installed application could not read .claude/WORKFLOW.md.' }

    $registration = Invoke-RestMethod "$origin/api/projects" -Method Post -ContentType 'application/json' -Headers @{ 'X-Folio-Request' = '1' } -Body (@{input = $project} | ConvertTo-Json)
    $tree = Invoke-RestMethod ("$origin/api/tree?project=" + $registration.project.id)
    if (-not (@($tree.files).path -match '/\.claude/WORKFLOW\.md$')) { throw 'Hidden directory document missing from project tree.' }
    if (-not (@($tree.files).path -match '/\.workflow\.md$')) { throw 'Dotfile missing from project tree.' }
    $search = Invoke-RestMethod ("$origin/api/search?project=" + $registration.project.id + '&q=' + [uri]::EscapeDataString($marker))
    if (@($search.files).Count -ne 1 -or -not $search.files[0].matchedContent -or -not $search.files[0].snippet.Contains($marker)) {
        throw 'Installed application could not search document body text.'
    }
    if ($search.files[0].path -notmatch '/\.claude/WORKFLOW\.md$') { throw 'Content search returned the wrong document.' }
    foreach ($name in @('sample.png', 'sample.mp4')) {
        $media = @($tree.files | Where-Object { $_.name -eq $name })
        if ($media.Count -ne 1) { throw "Media missing from tree: $name" }
        $metadata = Invoke-RestMethod ("$origin/api/file?path=" + [uri]::EscapeDataString($media[0].path))
        $expectedKind = if ($name.EndsWith('.png')) { 'image' } else { 'video' }
        if ($metadata.kind -ne $expectedKind -or -not $metadata.mediaURL) { throw "Unexpected media metadata: $name" }
        if ($null -ne $metadata.content) { throw 'Media binary was returned as document text.' }
        $head = Invoke-WebRequest ($origin + $metadata.mediaURL) -Method Head
        if ($head.StatusCode -ne 200 -or [long]$head.Headers['Content-Length'][0] -ne (Get-Item -LiteralPath (Join-Path $project $name)).Length) {
            throw "Media HEAD metadata failed: $name"
        }
        $range = Invoke-WebRequest ($origin + $metadata.mediaURL) -Headers @{ Range = 'bytes=0-15' }
        if ($range.StatusCode -ne 206 -or $range.RawContentLength -ne 16 -or $range.Headers['Content-Range'][0] -notmatch '^bytes 0-15/') {
            throw "Media range streaming failed: $name"
        }
    }
    Write-Host 'Installed EXE: PNG/MP4 tree, metadata, HEAD, and 16-byte range streaming passed.'
    Write-Host 'Installed EXE: body text search returned the hidden document and matching snippet.'
    Write-Host 'Installed EXE: server, file launch, .claude document, dotfile tree, and file registration passed.'

    # Exercise installed helpers with the bundled Electron Node runtime. This
    # requires neither a host Node installation nor the source checkout.
    foreach ($helper in @('cli.mjs', 'mcp.mjs', 'rdviewer.cmd', 'rdviewer-mcp.cmd')) {
        if (-not (Test-Path -LiteralPath (Join-Path $agentDirectory $helper))) { throw "Installed agent helper missing: $helper" }
    }
    Wait-Until {
        if (-not (Test-Path -LiteralPath $automationFile)) { return $false }
        $connection = Get-Content -LiteralPath $automationFile -Raw | ConvertFrom-Json
        if ($connection.baseURL -ne $origin) { return $false }
        $state = Invoke-RestMethod "$origin/api/automation/status" -Headers @{ Authorization = ('Bearer ' + $connection.token) } -TimeoutSec 2
        return $state.connected
    } 'installed native automation bridge'
    $unauthorized = Invoke-WebRequest "$origin/api/automation/status" -SkipHttpErrorCheck
    if ($unauthorized.StatusCode -ne 401) { throw 'Automation API accepted a request without a token.' }
    $connection = Get-Content -LiteralPath $automationFile -Raw | ConvertFrom-Json
    $browserRequest = Invoke-WebRequest "$origin/api/automation/status" -Headers @{ Authorization = ('Bearer ' + $connection.token); Origin = 'http://example.invalid' } -SkipHttpErrorCheck
    if ($browserRequest.StatusCode -ne 403) { throw 'Automation API accepted a browser-origin request.' }
    Test-InstalledMCP

    Invoke-AgentCLI -AgentArguments @('open', $htmlFile) | Out-Null
    $snapshot = Invoke-AgentCLI -AgentArguments @('snapshot')
    if (-not $snapshot.result.text.Contains('RDViewer native automation smoke')) { throw 'Native HTML preview did not load.' }
    if (-not (@($snapshot.result.elements).selector -contains '#increment')) { throw 'Native snapshot omitted the HTML button.' }
    Invoke-AgentCLI -AgentArguments @('fill', '#name', 'Codex') | Out-Null
    Invoke-AgentCLI -AgentArguments @('click', '#hello') | Out-Null
    Invoke-AgentCLI -AgentArguments @('click', '#increment') | Out-Null
    $snapshot = Invoke-AgentCLI -AgentArguments @('snapshot')
    if (-not $snapshot.result.text.Contains('Hello Codex') -or -not ($snapshot.result.text -match '\b1\b')) {
        throw 'Native HTML fill/click did not update the page.'
    }
    $capture = (Invoke-AgentCLI -AgentArguments @('screenshot')).result
    [byte[]]$captureBytes = [IO.File]::ReadAllBytes($capture.path)
    if ($capture.mimeType -ne 'image/png' -or $captureBytes.Length -lt 100 -or [BitConverter]::ToString($captureBytes[0..7]) -ne '89-50-4E-47-0D-0A-1A-0A') {
        throw 'Native screenshot is not a PNG image.'
    }
    $recording = (Invoke-AgentCLI -AgentArguments @('record', '--seconds', '2', '--fps', '5', '--width', '640')).result
    [byte[]]$recordingBytes = [IO.File]::ReadAllBytes($recording.path)
    $recordingBoxes = [Text.Encoding]::ASCII.GetString($recordingBytes)
    if ($recording.mimeType -ne 'video/mp4' -or $recording.frames -lt 2 -or $recording.duration -lt 1 -or $recordingBytes.Length -lt 1000 -or [Text.Encoding]::ASCII.GetString($recordingBytes, 4, 4) -ne 'ftyp' -or -not $recordingBoxes.Contains('moov') -or -not $recordingBoxes.Contains('mdat')) {
        throw 'Native recording did not produce an MP4 with encoded frames.'
    }
    Invoke-AgentCLI -AgentArguments @('close') | Out-Null
    $closedState = (Invoke-AgentCLI -AgentArguments @('status')).result
    if ($closedState.previewOpen -or $closedState.activePreviewCount -ne 0 -or $closedState.recording.active) { throw 'Native preview resources remained active after close.' }
    Invoke-AgentCLI -AgentArguments @('open', $hiddenDocument) | Out-Null
    Write-Host 'Installed EXE: authenticated CLI, native HTML snapshot/fill/click, PNG capture, MP4 recording, and preview cleanup passed.'

    # Exercise the trusted native update adapter, using the real installer and
    # its exact cache filename. The production HTTP API still forbids caller
    # paths and same-version updates; this fixture exists only in the checkout.
    $beforeUpdate = Get-Content -LiteralPath $automationFile -Raw | ConvertFrom-Json
    $updateCache = Join-Path $dataDirectory 'updates'
    New-Item -ItemType Directory -Path $updateCache -Force | Out-Null
    $updateInstaller = Join-Path $updateCache ('RDViewer-' + $updates.currentVersion + '-windows-x64-setup.exe')
    Copy-Item -LiteralPath $Installer -Destination $updateInstaller -Force
    $updateHash = (Get-FileHash -LiteralPath $updateInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
    & node (Join-Path $PSScriptRoot 'update-roundtrip.mjs') $updateInstaller $installDirectory $updateCache $updates.currentVersion $updateHash ([string]$beforeUpdate.pid)
    if ($LASTEXITCODE -ne 0) { throw 'Native update adapter did not stage the actual installer.' }
    $mainProcess = Get-Process -Id $beforeUpdate.pid
    if (-not $mainProcess.CloseMainWindow()) { throw 'Installed app refused normal window close for update.' }
    Wait-Until {
        if (-not (Test-Path -LiteralPath $automationFile)) { return $false }
        $afterUpdate = Get-Content -LiteralPath $automationFile -Raw | ConvertFrom-Json
        if ($afterUpdate.pid -eq $beforeUpdate.pid) { return $false }
        $relaunched = Invoke-RestMethod "$origin/api/updates" -TimeoutSec 2
        return $relaunched.currentVersion -eq $updates.currentVersion -and $relaunched.supported
    } 'native update installer and relaunched application' 90
    if (-not (Test-Path -LiteralPath $sentinel)) { throw 'Native update removed user data.' }
    $retainedUpdates = Get-Content -LiteralPath (Join-Path $dataDirectory 'updates.json') -Raw | ConvertFrom-Json
    if ($retainedUpdates.autoUpdate -ne $initialAutoUpdate) { throw 'Native update lost the automatic-update preference.' }
    $retainedProjects = Invoke-RestMethod "$origin/api/projects" -TimeoutSec 5
    if (-not (@($retainedProjects.projects).id -contains $registration.project.id)) { throw 'Native update lost registered folders.' }
    Write-Host 'Installed EXE: verified native update helper, silent installation, normal exit, relaunch and retained user settings passed.'

    Stop-InstalledApp
    $uninstaller = Join-Path $installDirectory 'Uninstall RDViewer.exe'
    $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -PassThru -Wait
    if ($uninstall.ExitCode -ne 0) { throw "Uninstaller exited with $($uninstall.ExitCode)" }
    Wait-Until { -not (Test-Path -LiteralPath $executable) } 'uninstallation'
    if (-not (Test-Path -LiteralPath $sentinel)) { throw 'Uninstall removed user data.' }
    if (Test-Path 'HKCU:\Software\Classes\RDViewer.Markdown') { throw 'Uninstall left the file-open registration.' }
    Write-Host 'Silent install, reinstall, and uninstall passed; existing AppData retained.'
} catch {
    $updateResult = Join-Path $dataDirectory 'updates/update-result.json'
    if (Test-Path -LiteralPath $updateResult) {
        Write-Host 'Durable updater helper result:'
        Get-Content -LiteralPath $updateResult -Raw | Write-Host
    }
    Get-Process -Name RDViewer,powershell -ErrorAction SilentlyContinue | Select-Object Id,Path,StartTime,MainWindowTitle | Format-List | Out-String | Write-Host
    throw
} finally {
    Stop-InstalledApp
    Remove-Item -LiteralPath $sentinel -Force -ErrorAction SilentlyContinue
}
