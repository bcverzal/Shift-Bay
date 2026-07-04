param(
  [string]$AccessToken = $env:SUPABASE_ACCESS_TOKEN,
  [string]$ProjectRef = "aynvsocycljrhmjtyjib"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$cli = Join-Path $repoRoot "tools\supabase-cli\supabase.exe"
$envPath = Join-Path $repoRoot ".env"
$functionName = "shift-bay-api"

if (-not (Test-Path $cli)) {
  throw "Supabase CLI was not found at $cli. Run the standalone CLI setup first."
}

if (-not $AccessToken) {
  throw "Supabase access token is required. Create one at https://supabase.com/dashboard/account/tokens, then run this script with -AccessToken '<token>'."
}

if (-not (Test-Path $envPath)) {
  throw ".env was not found. The Edge Function secrets are read from the local .env file."
}

function Read-DotEnv($path) {
  $result = @{}
  Get-Content -LiteralPath $path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#") -or -not $line.Contains("=")) { return }
    $parts = $line.Split("=", 2)
    $key = $parts[0].Trim()
    $value = $parts[1].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $result[$key] = $value
  }
  return $result
}

$envValues = Read-DotEnv $envPath
$required = @(
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SHIFT_BAY_LOCATION_ID"
)

$missing = $required | Where-Object { -not $envValues[$_] }
if ($missing.Count) {
  throw "Missing required .env values: $($missing -join ', ')"
}

$tempDir = Join-Path $repoRoot "tmp\deploy"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
$secretFile = Join-Path $tempDir "shift-bay-edge-secrets.env"
$documentKey = if ($envValues.SHIFT_BAY_DOCUMENT_KEY) { $envValues.SHIFT_BAY_DOCUMENT_KEY } else { "primary" }

@(
  "SUPABASE_URL=$($envValues.SUPABASE_URL)",
  "SUPABASE_ANON_KEY=$($envValues.SUPABASE_ANON_KEY)",
  "SUPABASE_SERVICE_ROLE_KEY=$($envValues.SUPABASE_SERVICE_ROLE_KEY)",
  "SHIFT_BAY_LOCATION_ID=$($envValues.SHIFT_BAY_LOCATION_ID)",
  "SHIFT_BAY_DOCUMENT_KEY=$documentKey"
) | Set-Content -LiteralPath $secretFile -Encoding UTF8

try {
  $previousAccessToken = $env:SUPABASE_ACCESS_TOKEN
  $env:SUPABASE_ACCESS_TOKEN = $AccessToken

  Write-Host "Setting Edge Function secrets for $ProjectRef..."
  & $cli secrets set --project-ref $ProjectRef --env-file $secretFile

  Write-Host "Deploying $functionName to $ProjectRef..."
  & $cli functions deploy $functionName --project-ref $ProjectRef --use-api --no-verify-jwt

  Write-Host "Deployment complete. Test:"
  Write-Host "https://$ProjectRef.supabase.co/functions/v1/$functionName/status"
} finally {
  Remove-Item -LiteralPath $secretFile -Force -ErrorAction SilentlyContinue
  if ($previousAccessToken) {
    $env:SUPABASE_ACCESS_TOKEN = $previousAccessToken
  } else {
    Remove-Item Env:\SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
  }
}
