$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectPath
try {
  if (-not (Test-Path -LiteralPath 'node_modules')) {
    throw 'Run npm ci in this project folder first.'
  }
  $env:LOCAL_DEMO = 'true'
  $env:NEXT_TELEMETRY_DISABLED = '1'
  npm run dev -- --hostname localhost --port 3000
} finally {
  Pop-Location
}
