<# 
    Simple launcher script for the Froggy Flash Electron app.
    Usage:
      - Double-click this file and choose "Run with PowerShell", or
      - From PowerShell:  .\launch-froggy-flash.ps1
    Prerequisite:
      - Run "npm install" once in this folder to install dependencies.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Change to the directory where this script lives (the project root)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $scriptDir

Write-Host "Froggy Flash launcher" -ForegroundColor Green
Write-Host "Project path: $scriptDir"
Write-Host ""

Write-Host 'If this is your first time running the app, run "npm install" in this folder.' -ForegroundColor Yellow
Write-Host "Starting Froggy Flash with 'npm start'..." -ForegroundColor Cyan
Write-Host ""

try {
    npm start
}
catch {
    Write-Error "Failed to start Froggy Flash. Ensure Node.js and npm are installed and that you've run 'npm install' at least once."
}


