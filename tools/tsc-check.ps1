$ErrorActionPreference = 'Stop'
Set-Location 'd:\26_Agent_Project\AI_comic\server'
& npx tsc -p tsconfig.json --noEmit 2>&1 | Select-Object -First 60
exit $LASTEXITCODE
