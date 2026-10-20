param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$exe = Join-Path $PSScriptRoot 'RDViewer.exe'
$classKey = 'HKCU:\Software\Classes\RDViewer.Markdown'
$appKey = 'HKCU:\Software\RDViewer'
$registered = 'HKCU:\Software\RegisteredApplications'
$extensions = @('.md', '.markdown', '.mdown')

if ($Remove) {
    Remove-Item -LiteralPath $classKey -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $appKey -Recurse -Force -ErrorAction SilentlyContinue
    Remove-ItemProperty -LiteralPath $registered -Name 'RDViewer' -ErrorAction SilentlyContinue
    foreach ($extension in $extensions) {
        Remove-ItemProperty -LiteralPath "HKCU:\Software\Classes\$extension\OpenWithProgids" -Name 'RDViewer.Markdown' -ErrorAction SilentlyContinue
    }
    Write-Host 'RDViewer file-type registration removed. Original documents were not changed.'
    exit
}
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw 'Keep this script beside RDViewer.exe.' }
function Set-RegistryValue($key, $name, $value) {
    New-Item -Path $key -Force | Out-Null
    New-ItemProperty -LiteralPath $key -Name $name -Value $value -PropertyType String -Force | Out-Null
}
Set-RegistryValue $classKey '(default)' 'RDViewer Markdown Document'
Set-RegistryValue "$classKey\DefaultIcon" '(default)' "`"$exe`",0"
Set-RegistryValue "$classKey\shell\open\command" '(default)' "`"$exe`" `"%1`""
Set-RegistryValue "$appKey\Capabilities" 'ApplicationName' 'RDViewer'
Set-RegistryValue "$appKey\Capabilities" 'ApplicationDescription' 'Local Markdown reader'
foreach ($extension in $extensions) {
    Set-RegistryValue "$appKey\Capabilities\FileAssociations" $extension 'RDViewer.Markdown'
    Set-RegistryValue "HKCU:\Software\Classes\$extension\OpenWithProgids" 'RDViewer.Markdown' ''
}
Set-RegistryValue $registered 'RDViewer' 'Software\RDViewer\Capabilities'
Write-Host 'Registered RDViewer for the current user. Select it in Windows Default apps.'
Start-Process 'ms-settings:defaultapps'
