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
$forgeRoot = if ($env:IMG2THREEJS_FORGE_ROOT) {
  $env:IMG2THREEJS_FORGE_ROOT
} elseif ($env:CODEX_HOME) {
  Join-Path $env:CODEX_HOME 'skills\img2threejs\forge'
} else {
  Join-Path $env:USERPROFILE '.codex\skills\img2threejs\forge'
}

if (-not (Test-Path $forgeRoot)) {
  throw "IMG2THREEJS forge root not found: $forgeRoot"
}

$generatorScript = Join-Path $forgeRoot 'stage3_build\generate_threejs_factory.py'

if (-not (Test-Path $generatorScript)) {
  throw "Civic factory generator script not found: $generatorScript"
}

python $generatorScript `
  $specPath `
  --pass-id $PassId `
  --out $OutFile `
  --force

if ($LASTEXITCODE -ne 0) {
  throw 'Civic blockout generation failed.'
}

$generated = Get-Content $OutFile -Raw

$laterScopeStart = "export function create20162021HondaCivicSedanLookDevLights("
$laterScopeIndex = $generated.IndexOf($laterScopeStart)
if ($laterScopeIndex -ge 0) {
  $generated = $generated.Substring(0, $laterScopeIndex).TrimEnd() + [Environment]::NewLine
}

$laterScopeImports = @(
  "import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';",
  "import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';",
  "import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';",
  "import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';",
  "import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';",
  "import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';"
)

foreach ($importLine in $laterScopeImports) {
  $generated = $generated.Replace($importLine + [Environment]::NewLine, '')
}

$generatedLines = $generated -split "\r?\n"
$generated = (($generatedLines | Where-Object { $_ -notmatch 'lookDevTargets' }) -join [Environment]::NewLine).TrimEnd() + [Environment]::NewLine

$forbiddenMarkers = @(
  'LookDevLights',
  'PresentationComposer',
  'InspectControls',
  'RoomEnvironment',
  'EffectComposer',
  'RenderPass',
  'BokehPass',
  'UnrealBloomPass',
  'OrbitControls',
  'lookDevTargets'
)

foreach ($marker in $forbiddenMarkers) {
  if ($generated.Contains($marker)) {
    throw "Generated Task 3 artifact still contains forbidden later-scope marker: $marker"
  }
}

Set-Content -Path $OutFile -Value $generated -NoNewline
