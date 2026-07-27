param()

$ErrorActionPreference = 'Stop'
$env:PYTHONUTF8 = '1'

$specPath = Join-Path $PSScriptRoot '..\civvi\analysis\stage2-object-sculpt-spec.json'
$forgeRoot = if ($env:IMG2THREEJS_FORGE_ROOT) {
  $env:IMG2THREEJS_FORGE_ROOT
} elseif ($env:CODEX_HOME) {
  Join-Path $env:CODEX_HOME 'skills\img2threejs\forge'
} else {
  Join-Path $env:USERPROFILE '.codex\skills\img2threejs\forge'
}

$validateScript = Join-Path $forgeRoot 'stage2_spec\validate_sculpt_spec.py'
$statusScript = Join-Path $forgeRoot 'stage3_build\orchestrate_passes.py'

python $validateScript $specPath

if ($LASTEXITCODE -ne 0) {
  throw 'Sculpt spec validation failed.'
}

$statusJson = python $statusScript status $specPath --json

if ($LASTEXITCODE -ne 0) {
  throw 'Failed to read sculpt pipeline status.'
}

$status = $statusJson | ConvertFrom-Json

if ($status.currentPass -ne 'blockout') {
  throw "Expected currentPass to be 'blockout' but got '$($status.currentPass)'."
}
