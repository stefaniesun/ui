param(
  [Parameter(Mandatory = $true)]
  [string]$PassId,

  [Parameter(Mandatory = $true)]
  [string]$OutFile
)

$ErrorActionPreference = 'Stop'
$env:PYTHONUTF8 = '1'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$specPath = Join-Path $repoRoot 'civvi\analysis\stage2-object-sculpt-spec.json'

python 'C:\Users\stefanie\.codex\skills\img2threejs\forge\stage3_build\generate_threejs_factory.py' `
  $specPath `
  --pass-id $PassId `
  --out $OutFile `
  --force
