$ErrorActionPreference = "SilentlyContinue"

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8798
$envFile = Join-Path $appDir ".env"
$portableNode = Join-Path $appDir "runtime\node\node.exe"
$nodeCommand = $null
if (Test-Path $portableNode) {
  $nodeCommand = Get-Item $portableNode
} else {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
}
$url = "http://localhost:$port/"
$chromePaths = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
)
$chrome = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

function Test-ShiftBayServer {
  try {
    $response = Invoke-WebRequest -UseBasicParsing "$url/api/status" -TimeoutSec 1
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-Path $envFile)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("Shift Bay needs a .env file in this folder before cloud mode can start.", "Shift Bay Setup Needed", "OK", "Warning") | Out-Null
  Invoke-Item $appDir
  exit 1
}

if (-not $nodeCommand) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("Shift Bay cannot find Node.js. Use the office install bundle that includes runtime\node\node.exe.", "Shift Bay Setup Needed", "OK", "Warning") | Out-Null
  exit 1
}

if (-not (Test-ShiftBayServer)) {
  $env:PORT = "$port"
  $env:HOST = "127.0.0.1"
  $nodePath = if ($nodeCommand.FullName) { $nodeCommand.FullName } else { $nodeCommand.Source }
  Start-Process -WindowStyle Hidden -FilePath $nodePath -ArgumentList "server.js" -WorkingDirectory $appDir
  Start-Sleep -Seconds 2
}

if ($chrome) {
  Start-Process -FilePath $chrome -ArgumentList "--new-window", $url
} else {
  Start-Process $url
}
