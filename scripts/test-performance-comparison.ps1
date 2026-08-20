$ErrorActionPreference = "Stop"
$runner = Join-Path $PSScriptRoot "measure-performance.ps1"
$baseline = Join-Path $PSScriptRoot "performance-baseline.json"
$results = Join-Path $env:TEMP "perch-performance-fixtures"
New-Item -ItemType Directory -Force -Path $results | Out-Null

& $runner -BaselinePath $baseline -MeasurementPath (Join-Path $PSScriptRoot "fixtures/performance-pass.json") -OutputPath (Join-Path $results "pass.json") -LogPath (Join-Path $results "pass.log")

$regressionFailed = $false
try {
    & $runner -BaselinePath $baseline -MeasurementPath (Join-Path $PSScriptRoot "fixtures/performance-regressed.json") -OutputPath (Join-Path $results "regressed.json") -LogPath (Join-Path $results "regressed.log")
} catch {
    $regressionFailed = $true
}
if (!$regressionFailed) { throw "Regressed performance fixture was accepted." }
Write-Host "Performance comparison fixtures passed."
