param(
    [string]$AppPath,
    [string]$InstallerPath,
    [Parameter(Mandatory = $true)][string]$BaselinePath,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [string]$LogPath = "performance.log",
    [string]$MeasurementPath,
    [int]$LaunchSamples = 3,
    [int]$MemorySamples = 7,
    [int]$HandleTimeoutMs = 10000,
    [int]$IdleDelayMs = 5000,
    [int]$MemoryIntervalMs = 500
)

$ErrorActionPreference = "Stop"
$absoluteTargets = @{ coldStartMs = 1500; idlePrivateMemoryBytes = 60MB; installerBytes = 10MB }

function Get-Median([double[]]$Values) {
    $ordered = @($Values | Sort-Object)
    if ($ordered.Count -eq 0) { throw "Cannot calculate the median of an empty sample." }
    $middle = [math]::Floor($ordered.Count / 2)
    if ($ordered.Count % 2) { return [double]$ordered[$middle] }
    return ([double]$ordered[$middle - 1] + [double]$ordered[$middle]) / 2
}

function Write-PerformanceLog([string]$Message) {
    $line = "$(Get-Date -Format o) $Message"
    Write-Host $line
    Add-Content -LiteralPath $LogPath -Value $line
}

function Stop-PerformanceMeasurement([string]$Message) {
    [ordered]@{
        schemaVersion = 1
        passed = $false
        failures = @($Message)
        measurement = [ordered]@{ schemaVersion = 1; smokeHealthy = $false }
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $OutputPath
    Write-PerformanceLog $Message
    throw $Message
}

function Get-ProcessWindowHandle([int]$ProcessId) {
    if (!("Ledge.Performance.NativeWindows" -as [type])) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace Ledge.Performance {
    public static class NativeWindows {
        private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr state);
        [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr state);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
        public static IntPtr FindForProcess(uint expectedProcessId) {
            IntPtr found = IntPtr.Zero;
            EnumWindows((hwnd, state) => {
                uint actualProcessId;
                GetWindowThreadProcessId(hwnd, out actualProcessId);
                if (actualProcessId != expectedProcessId) return true;
                found = hwnd;
                return false;
            }, IntPtr.Zero);
            return found;
        }
    }
}
"@
    }
    return [Ledge.Performance.NativeWindows]::FindForProcess([uint32]$ProcessId)
}

$outputDirectory = Split-Path -Parent $OutputPath
if ($outputDirectory) { New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null }
$logDirectory = Split-Path -Parent $LogPath
if ($logDirectory) { New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null }
Set-Content -LiteralPath $LogPath -Value "Ledge packaged performance measurement"

if ($MeasurementPath) {
    $measurement = Get-Content -LiteralPath $MeasurementPath -Raw | ConvertFrom-Json
    Write-PerformanceLog "Comparing existing measurement $MeasurementPath"
} else {
    if (!(Test-Path -LiteralPath $AppPath -PathType Leaf)) { throw "App executable not found: $AppPath" }
    if (!(Test-Path -LiteralPath $InstallerPath -PathType Leaf)) { throw "Installer not found: $InstallerPath" }

    $coldStarts = @()
    $memoryReadings = @()
    $smokePasses = @()
    for ($attempt = 1; $attempt -le $LaunchSamples; $attempt++) {
        $process = $null
        try {
            $watch = [Diagnostics.Stopwatch]::StartNew()
            $process = Start-Process -FilePath $AppPath -PassThru
            $handle = [IntPtr]::Zero
            while ($watch.ElapsedMilliseconds -lt $HandleTimeoutMs) {
                Start-Sleep -Milliseconds 50
                $process.Refresh()
                if ($process.HasExited) { break }
                $handle = Get-ProcessWindowHandle $process.Id
                if ($handle -ne [IntPtr]::Zero) { break }
            }
            $watch.Stop()
            $healthy = !$process.HasExited -and $handle -ne [IntPtr]::Zero
            $smokePasses += $healthy
            if ($process.HasExited) {
                Stop-PerformanceMeasurement "Packaged app exited with code $($process.ExitCode) before exposing a window handle (attempt $attempt). Another Ledge instance may already be running."
            }
            if (!$healthy) { Stop-PerformanceMeasurement "Packaged app did not expose a window handle within ${HandleTimeoutMs}ms (attempt $attempt)." }
            $coldStarts += $watch.Elapsed.TotalMilliseconds
            Write-PerformanceLog "Launch $attempt reached handle in $([math]::Round($watch.Elapsed.TotalMilliseconds, 1)) ms"

            if ($attempt -eq $LaunchSamples) {
                Start-Sleep -Milliseconds $IdleDelayMs
                for ($sample = 1; $sample -le $MemorySamples; $sample++) {
                    $process.Refresh()
                    if ($process.HasExited) { Stop-PerformanceMeasurement "Packaged app exited during idle memory sampling." }
                    $memoryReadings += [double]$process.PrivateMemorySize64
                    Start-Sleep -Milliseconds $MemoryIntervalMs
                }
            }
        } finally {
            if ($process -and !$process.HasExited) {
                Stop-Process -Id $process.Id -Force
                $process.WaitForExit(5000) | Out-Null
            }
        }
    }

    $measurement = [ordered]@{
        schemaVersion = 1
        measuredAtUtc = (Get-Date).ToUniversalTime().ToString("o")
        smokeHealthy = !($smokePasses -contains $false)
        metrics = [ordered]@{
            coldStartMs = [ordered]@{ median = Get-Median $coldStarts; samples = $coldStarts }
            idlePrivateMemoryBytes = [ordered]@{ median = Get-Median $memoryReadings; samples = $memoryReadings }
            installerBytes = [ordered]@{ median = [double](Get-Item -LiteralPath $InstallerPath).Length; samples = @([double](Get-Item -LiteralPath $InstallerPath).Length) }
        }
    }
}

$baseline = Get-Content -LiteralPath $BaselinePath -Raw | ConvertFrom-Json
$failures = @()
$comparisons = [ordered]@{}
foreach ($metric in @("coldStartMs", "idlePrivateMemoryBytes", "installerBytes")) {
    $actual = [double]$measurement.metrics.$metric.median
    $expected = [double]$baseline.metrics.$metric.median
    $tolerance = [double]$baseline.tolerances.$metric
    $regressionLimit = $expected * (1 + $tolerance)
    $absoluteLimit = [double]$absoluteTargets[$metric]
    $baselinePassed = $actual -le $regressionLimit
    $absolutePassed = $actual -le $absoluteLimit
    $comparisons[$metric] = [ordered]@{
        actual = $actual; baseline = $expected; tolerance = $tolerance
        regressionLimit = $regressionLimit; absoluteTarget = $absoluteLimit
        baselinePassed = $baselinePassed; absolutePassed = $absolutePassed
    }
    Write-PerformanceLog "$metric actual=$actual baselineLimit=$regressionLimit absoluteTarget=$absoluteLimit"
    if (!$baselinePassed) { $failures += "$metric regressed beyond its baseline budget" }
    if (!$absolutePassed) { $failures += "$metric exceeded the SPEC.md absolute target" }
}
if (!$measurement.smokeHealthy) { $failures += "packaged-app smoke health failed" }

$result = [ordered]@{
    schemaVersion = 1
    passed = $failures.Count -eq 0
    failures = $failures
    measurement = $measurement
    comparisons = $comparisons
}
$result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $OutputPath
if ($failures.Count) { throw ($failures -join "; ") }
Write-PerformanceLog "All packaged performance gates passed."
