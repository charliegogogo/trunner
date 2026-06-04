# Build a single-executable application (SEA) for Windows.
# Uses Node 25.5+ `node --build-sea` (one-step blob + inject, no postject).
# Usage: pnpm -F @trunner/cli build:sea:win
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $ScriptDir "..")

$SeaConfig = "sea-config.json"
$Out       = "dist\trunner.exe"

if (-not (Test-Path $SeaConfig)) { throw "SEA: missing $SeaConfig" }
if (-not (Test-Path "dist\trunner.mjs")) { throw "SEA: dist\trunner.mjs not found - run 'pnpm build' first" }

$NodeBin = (Get-Command node).Source
if (-not $NodeBin) { throw "SEA: node not on PATH" }

$NodeVersion = & $NodeBin -p "process.versions.node"
$NodeMajor = [int]$NodeVersion.Split('.')[0]
if ($NodeMajor -lt 25) { throw "SEA: --build-sea requires Node 25.5+ (you have $NodeVersion)" }

Write-Host "SEA: using node at $NodeBin ($NodeVersion)"
Write-Host "SEA: building single executable from $SeaConfig"
& node "--build-sea=$SeaConfig"

Write-Host "SEA: done - $Out"
Get-Item $Out | Select-Object Name, Length
