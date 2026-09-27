# ORBITAL-X AI Service Startup Script
# Start the Python FastAPI service

$ErrorActionPreference = "Stop"

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  ORBITAL-X AI Service" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Check Python
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Python is not installed" -ForegroundColor Red
    exit 1
}

$pythonVersion = python --version
Write-Host "Python version: $pythonVersion" -ForegroundColor Green

# Navigate to AI directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$AIDir = Join-Path $ProjectDir "ai"

if (-not (Test-Path $AIDir)) {
    Write-Host "Error: AI directory not found at $AIDir" -ForegroundColor Red
    exit 1
}

Set-Location $AIDir

# Create virtual environment if it doesn't exist
$VenvDir = Join-Path $AIDir ".venv"
if (-not (Test-Path $VenvDir)) {
    Write-Host "Creating Python virtual environment..." -ForegroundColor Yellow
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Error: Failed to create virtual environment" -ForegroundColor Red
        exit 1
    }
}

# Activate virtual environment
Write-Host "Activating virtual environment..." -ForegroundColor Gray
& "$VenvDir\Scripts\Activate.ps1"

# Install dependencies
Write-Host "Installing dependencies..." -ForegroundColor Yellow
pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: pip install failed" -ForegroundColor Red
    exit 1
}

# Copy .env.example to .env if it doesn't exist
if (-not (Test-Path (Join-Path $ProjectDir ".env"))) {
    if (Test-Path (Join-Path $ProjectDir ".env.example")) {
        Copy-Item (Join-Path $ProjectDir ".env.example") (Join-Path $ProjectDir ".env")
        Write-Host "Created .env from .env.example" -ForegroundColor Yellow
    }
}

# Start the service
Write-Host ""
Write-Host "Starting AI service..." -ForegroundColor Green
Write-Host "URL: http://localhost:8000" -ForegroundColor Gray
Write-Host "Docs: http://localhost:8000/docs" -ForegroundColor Gray
Write-Host ""

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
