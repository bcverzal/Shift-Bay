param(
  [string]$OutputRoot = "tmp\hosted-static"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bundleName = "ShiftBay-HostedStatic-$timestamp"
$outputDir = Join-Path $repoRoot $OutputRoot
$stage = Join-Path $outputDir $bundleName
$zipPath = Join-Path $outputDir "$bundleName.zip"

$excludeDirs = @(
  ".git",
  ".agents",
  ".codex",
  "data",
  "storage",
  "tmp",
  "runtime",
  "supabase"
)

$excludeFiles = @(
  ".env",
  ".env.example",
  "server.js",
  "server-*.log",
  "*.err.log",
  "Start Restaurant Scheduler Server.bat",
  "Launch Restaurant Scheduler.ps1",
  "Launch Shift Bay Cloud.ps1",
  "Start Shift Bay Cloud Server.bat"
)

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

if (Test-Path $stage) {
  Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Path $stage | Out-Null

$items = Get-ChildItem -LiteralPath $repoRoot -Force | Where-Object {
  $name = $_.Name
  if ($_.PSIsContainer -and ($excludeDirs -contains $name)) { return $false }
  foreach ($pattern in $excludeFiles) {
    if ($name -like $pattern) { return $false }
  }
  return $true
}

foreach ($item in $items) {
  Copy-Item -LiteralPath $item.FullName -Destination $stage -Recurse -Force
}

$hostedConfig = Join-Path $stage "shift-bay-config.hosted.example.js"
$publicConfig = Join-Path $stage "shift-bay-config.js"
if (Test-Path $hostedConfig) {
  Copy-Item -LiteralPath $hostedConfig -Destination $publicConfig -Force
}

if (Test-Path $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -Force

Write-Host "Hosted static bundle created:"
Write-Host $zipPath
