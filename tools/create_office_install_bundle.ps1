param(
  [string]$OutputRoot = ""
)

$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $OutputRoot) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $OutputRoot = Join-Path $appRoot "tmp\ShiftBay-OfficeInstall-$stamp"
}

$excludeDirs = @(".git", "data", "tmp", "node_modules")
$excludeFiles = @(".env", "*.log", "server-*.log", "server-*.err.log")

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null

Get-ChildItem -Path $appRoot -Force | ForEach-Object {
  if ($excludeDirs -contains $_.Name) { return }
  foreach ($pattern in $excludeFiles) {
    if ($_.Name -like $pattern) { return }
  }
  $destination = Join-Path $OutputRoot $_.Name
  if ($_.PSIsContainer) {
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Recurse -Force
  } else {
    Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
  }
}

$zipPath = "$OutputRoot.zip"
if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
Compress-Archive -Path (Join-Path $OutputRoot "*") -DestinationPath $zipPath -Force

Write-Host "Created office install folder:"
Write-Host $OutputRoot
Write-Host ""
Write-Host "Created zip:"
Write-Host $zipPath
Write-Host ""
Write-Host "Reminder: copy the real .env separately. It is intentionally not included."
