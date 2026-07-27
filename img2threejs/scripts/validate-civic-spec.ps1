param()

$ErrorActionPreference = 'Stop'
$env:PYTHONUTF8 = '1'

$specPath = Join-Path $PSScriptRoot '..\civvi\analysis\stage2-object-sculpt-spec.json'

python 'C:\Users\stefanie\.codex\skills\img2threejs\forge\stage2_spec\validate_sculpt_spec.py' $specPath
$statusJson = python 'C:\Users\stefanie\.codex\skills\img2threejs\forge\stage3_build\orchestrate_passes.py' status $specPath --json

if ($LASTEXITCODE -ne 0) {
  throw 'Failed to read sculpt pipeline status.'
}

$status = $statusJson | ConvertFrom-Json

if ($status.currentPass -ne 'blockout') {
  throw "Expected currentPass to be 'blockout' but got '$($status.currentPass)'."
}
