param()

$ErrorActionPreference = 'Stop'
$env:PYTHONUTF8 = '1'

$specPath = Join-Path $PSScriptRoot '..\civvi\analysis\stage2-object-sculpt-spec.json'

python 'C:\Users\stefanie\.codex\skills\img2threejs\forge\stage2_spec\validate_sculpt_spec.py' $specPath
python 'C:\Users\stefanie\.codex\skills\img2threejs\forge\stage3_build\orchestrate_passes.py' check $specPath --pass-id blockout
