$ErrorActionPreference = "SilentlyContinue"

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = "http://localhost:8787"
$chromePaths = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
)
$chrome = $chromePaths | Where-Object { Test-Path $_ } | Select-Object -First 1

function Test-SchedulerServer {
  try {
    $response = Invoke-WebRequest -UseBasicParsing "$url/api/status" -TimeoutSec 1
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-SchedulerServer)) {
  Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $appDir
  Start-Sleep -Seconds 2
}

if ($chrome) {
  Start-Process -FilePath $chrome -ArgumentList "--new-window", $url
} else {
  Start-Process $url
}
