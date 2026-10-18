#Requires -Version 5.1
<#
.SYNOPSIS
  Installs AKU from source on Windows.

.DESCRIPTION
  Clones (or updates) the AKU music player, installs its dependencies and adds
  Desktop / Start Menu shortcuts. Safe to re-run.

.PARAMETER InstallDir
  Where to put the checkout. Defaults to %LOCALAPPDATA%\AKU-PLAYER.

.PARAMETER Build
  Also build the portable dist\AKU.exe and point the shortcuts at it.

.PARAMETER Uninstall
  Remove the shortcuts and the installed copy.

.EXAMPLE
  irm https://raw.githubusercontent.com/4KIR4fo/AKU-PLAYER/main/scripts/install.ps1 | iex
#>
[CmdletBinding()]
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'AKU-PLAYER'),
  [switch]$Build,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$RepoUrl = 'https://github.com/4KIR4fo/AKU-PLAYER.git'
$AppName = 'AKU'

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Get-ShortcutPaths {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $startMenu = [Environment]::GetFolderPath('Programs')
  @(
    (Join-Path $desktop "$AppName.lnk"),
    (Join-Path $startMenu "$AppName.lnk")
  )
}

if ($Uninstall) {
  Write-Step "Removing $AppName"
  foreach ($link in Get-ShortcutPaths) {
    if (Test-Path $link) { Remove-Item $link -Force }
  }
  if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
  Write-Host "$AppName was removed." -ForegroundColor Green
  return
}

foreach ($tool in 'git', 'node', 'npm') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "Missing required tool '$tool'. Install Git and Node.js 20 or newer first."
  }
}

$nodeVersion = (& node --version) -replace '^v', ''
if ([int]($nodeVersion.Split('.')[0]) -lt 20) {
  throw "Node.js 20 or newer is required (found $nodeVersion)."
}

if (Test-Path (Join-Path $InstallDir '.git')) {
  Write-Step "Updating existing copy in $InstallDir"
  git -C $InstallDir pull --ff-only
}
else {
  Write-Step "Cloning into $InstallDir"
  git clone --depth 1 $RepoUrl $InstallDir
}

Write-Step 'Installing dependencies'
Push-Location $InstallDir
try {
  if (Test-Path 'package-lock.json') { npm ci } else { npm install }
}
finally {
  Pop-Location
}

if ($Build) {
  Write-Step 'Building portable executable'
  Push-Location $InstallDir
  try { npm run dist }
  finally { Pop-Location }
  $target = Join-Path $InstallDir 'dist\AKU.exe'
}
else {
  $target = Join-Path $InstallDir 'node_modules\electron\dist\electron.exe'
  $arguments = '.'
}

Write-Step 'Creating shortcuts'
$shell = New-Object -ComObject WScript.Shell
foreach ($link in Get-ShortcutPaths) {
  $shortcut = $shell.CreateShortcut($link)
  $shortcut.TargetPath = $target
  $shortcut.WorkingDirectory = $InstallDir
  if ($Build) { $shortcut.Arguments = '' } else { $shortcut.Arguments = '.' }
  $shortcut.IconLocation = "$target,0"
  $shortcut.Description = 'AKU music player'
  $shortcut.Save()
}

Write-Host ''
Write-Host "$AppName is ready - launch it from the Desktop or Start Menu." -ForegroundColor Green
