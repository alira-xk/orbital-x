# ORBITAL-X Spacecraft Simulator Startup Script

param(
    [string]$Scenario = "normal",
    [int]$Duration = 0,
    [float]$Interval = 1.0,
    [int]$Speed = 1
)

$ErrorActionPreference = "Stop"

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  ORBITAL-X1 Spacecraft Simulator" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Scenario: $Scenario" -ForegroundColor Gray
Write-Host "Speed: ${Speed}x" -ForegroundColor Gray
Write-Host "Interval: $Interval s" -ForegroundColor Gray
Write-Host ""

# Check Python
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Python is not installed" -ForegroundColor Red
    exit 1
}

# Navigate to simulator directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SimulatorDir = Join-Path (Split-Path -Parent $ScriptDir) "simulator"

if (-not (Test-Path $SimulatorDir)) {
    Write-Host "Error: Simulator directory not found at $SimulatorDir" -ForegroundColor Red
    exit 1
}

Set-Location $SimulatorDir

# Install dependencies if needed
$VenvDir = Join-Path $SimulatorDir "..\ai\.venv"
if (Test-Path "$VenvDir\Scripts\Activate.ps1") {
    Write-Host "Using AI service virtual environment..." -ForegroundColor Gray
    & "$VenvDir\Scripts\Activate.ps1"
}

# Run simulator
$arguments = @(
    "main.py",
    "--scenario", $Scenario,
    "--interval", $Interval,
    "--speed", $Speed,
    "--output", "telemetry_output.jsonl"
)

if ($Duration -gt 0) {
    $arguments += @("--duration", $Duration)
    Write-Host "Duration: $Duration seconds" -ForegroundColor Gray
} else {
    Write-Host "Duration: infinite (Ctrl+C to stop)" -ForegroundColor Gray
}

Write-Host ""
python $arguments
