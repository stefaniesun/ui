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

Set-Content -Path $OutFile -Value $generated -NoNewline
