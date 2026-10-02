param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'

# Run both workspace builds together, without replacing the installed AX.
# This script lives in the repository's scripts/ directory.
$crewRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $crewRoot
$axPath = Join-Path $workspaceRoot 'ax\target\release\ax.exe'
$crewPath = Join-Path $crewRoot 'apps\desktop\src-tauri\target\release\ax-crew-desktop.exe'
$backendPath = Join-Path $crewRoot 'target\release\ax-crew.exe'
foreach ($binaryPath in @($axPath, $crewPath, $backendPath)) {
    if (-not (Test-Path -LiteralPath $binaryPath -PathType Leaf)) {
        throw "Build output missing: $binaryPath"
    }
}
if ($CheckOnly) {
    Write-Output $axPath, $crewPath, $backendPath
    return
}
if (Get-Process -Name 'ax-crew-desktop' -ErrorAction SilentlyContinue) {
    throw 'Quit the existing AX Crew from its system tray before starting the workspace build.'
}
$previousAx = $env:AX_CREW_AX
$previousBackend = $env:AX_CREW_BACKEND
try {
    $env:AX_CREW_AX = $axPath
    $env:AX_CREW_BACKEND = $backendPath
    Start-Process -FilePath $crewPath -WorkingDirectory $crewRoot -WindowStyle Hidden
} finally {
    $env:AX_CREW_AX = $previousAx
    $env:AX_CREW_BACKEND = $previousBackend
}
