param([string]$InstallDirectory = $env:AX_CREW_INSTALL_DIR)

$ErrorActionPreference = 'Stop'
try {
    if ([string]::IsNullOrWhiteSpace($InstallDirectory)) { throw 'Installation directory is required.' }
    $installRoot = [IO.Path]::GetFullPath($InstallDirectory)
    $executables = @(
        (Join-Path $installRoot 'ax-crew-desktop.exe'),
        (Join-Path $installRoot 'bin\ax-crew.exe')
    )
    # Match full installed paths, never terminate another installation, AX runtime,
    # development gateway or an unrelated process with the same filename.
    $running = Get-CimInstance Win32_Process -Filter "Name='ax-crew-desktop.exe' OR Name='ax-crew.exe'"
    foreach ($executable in $executables) {
        foreach ($item in $running) {
            if (-not [string]::Equals($item.ExecutablePath, $executable, [StringComparison]::OrdinalIgnoreCase)) { continue }
            $process = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
            if (-not $process) { continue }
            if (-not [string]::Equals($process.Path, $executable, [StringComparison]::OrdinalIgnoreCase)) { continue }
            Stop-Process -Id $process.Id -Force -ErrorAction Stop
            if (-not $process.WaitForExit(10000)) { throw "Process did not exit: $executable" }
        }
    }
    Write-Output 'AX Crew installed processes stopped; binaries can be replaced.'
    exit 0
} catch {
    Write-Output "Unable to stop installed AX Crew: $($_.Exception.Message)"
    exit 1
}
