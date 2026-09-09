param(
  [switch]$ImportCopy
)

$ErrorActionPreference = "Stop"

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8797
$url = "http://localhost:$port"
$browserUrl = if ($ImportCopy) { "$url/?localCopy=1" } else { "$url/" }
$portableNode = Join-Path $appDir "runtime\node\node.exe"
$workspaceNode = Join-Path ($env:USERPROFILE) ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$nodeCommand = if (Test-Path $portableNode) { Get-Item $portableNode } elseif (Test-Path $workspaceNode) { Get-Item $workspaceNode } else { Get-Command node -ErrorAction SilentlyContinue }

if (-not $nodeCommand) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("Shift Bay cannot find Node.js.", "Shift Bay Setup Needed", "OK", "Warning") | Out-Null
  exit 1
}

function Get-VerifiedLocalStatus {
  try {
    $status = Invoke-RestMethod "$url/api/status" -TimeoutSec 5
    if ($status.mode -eq "local-json") { return $status }
  } catch {
    # The caller decides whether to wait for a fresh server or stop safely.
  }
  return $null
}

if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
  if (Get-VerifiedLocalStatus) {
    Start-Process $browserUrl
    exit 0
  }
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("Shift Bay Local did not start because port $port is already in use by an unverified server. It will not open it.", "Shift Bay Local Safety Stop", "OK", "Warning") | Out-Null
  exit 1
}

$env:PORT = "$port"
$env:HOST = "127.0.0.1"
$env:SHIFT_BAY_STORAGE_MODE = "local-json"
$nodePath = if ($nodeCommand.FullName) { $nodeCommand.FullName } else { $nodeCommand.Source }
$serverProcess = Start-Process -WindowStyle Hidden -FilePath $nodePath -ArgumentList "server.js" -WorkingDirectory $appDir -PassThru

$localReady = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
  Start-Sleep -Seconds 1
  if (Get-VerifiedLocalStatus) {
    $localReady = $true
    break
  }
  if ($serverProcess.HasExited) { break }
}

if (-not $localReady) {
  if (-not $serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id -Force }
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("Shift Bay Local could not verify its local-only storage mode. No browser window was opened.", "Shift Bay Local Safety Stop", "OK", "Warning") | Out-Null
  exit 1
}

Start-Process $browserUrl
