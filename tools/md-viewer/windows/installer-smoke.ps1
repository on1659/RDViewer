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

function Wait-Until([scriptblock]$Check, [string]$Description) {
    $deadline = (Get-Date).AddSeconds(45)
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

    Stop-InstalledApp
    # Reinstall the same build to exercise the same upgrade path used by updates.
    Invoke-Installer
    if (-not (Test-Path -LiteralPath $sentinel)) { throw 'Reinstall removed user data.' }
    $uninstaller = Join-Path $installDirectory 'Uninstall RDViewer.exe'
    $uninstall = Start-Process -FilePath $uninstaller -ArgumentList '/S' -PassThru -Wait
    if ($uninstall.ExitCode -ne 0) { throw "Uninstaller exited with $($uninstall.ExitCode)" }
    Wait-Until { -not (Test-Path -LiteralPath $executable) } 'uninstallation'
    if (-not (Test-Path -LiteralPath $sentinel)) { throw 'Uninstall removed user data.' }
    if (Test-Path 'HKCU:\Software\Classes\RDViewer.Markdown') { throw 'Uninstall left the file-open registration.' }
    Write-Host 'Silent install, reinstall, and uninstall passed; existing AppData retained.'
} finally {
    Stop-InstalledApp
    Remove-Item -LiteralPath $sentinel -Force -ErrorAction SilentlyContinue
}
