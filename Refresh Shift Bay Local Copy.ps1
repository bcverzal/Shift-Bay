$ErrorActionPreference = "Stop"

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$portableNode = Join-Path $appDir "runtime\node\node.exe"
$workspaceNode = Join-Path ($env:USERPROFILE) ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$nodeCommand = if (Test-Path $portableNode) { Get-Item $portableNode } elseif (Test-Path $workspaceNode) { Get-Item $workspaceNode } else { Get-Command node -ErrorAction SilentlyContinue }

if (-not $nodeCommand) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("Shift Bay cannot find Node.js.", "Shift Bay Setup Needed", "OK", "Warning") | Out-Null
  exit 1
}

$nodePath = if ($nodeCommand.FullName) { $nodeCommand.FullName } else { $nodeCommand.Source }
& $nodePath (Join-Path $appDir "tools\copy_live_state_to_local.js")
if ($LASTEXITCODE -ne 0) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show("Shift Bay could not create the local copy. The live schedule was not changed.", "Local Copy Failed", "OK", "Error") | Out-Null
  exit $LASTEXITCODE
}

& (Join-Path $appDir "Launch Shift Bay Local.ps1") -ImportCopy
