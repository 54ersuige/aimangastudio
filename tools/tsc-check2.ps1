$env:NPM_CONFIG_LOGLEVEL = 'silent'
$env:NPM_CONFIG_CACHE = 'D:\soft\npm-cache'
$env:TSC_NONCONFIG = '1'
$out = & node "$PSScriptRoot\..\node_modules\typescript\bin\tsc" --noEmit -p "$PSScriptRoot\..\tsconfig.json" 2>&1
$out | Where-Object { $_ -match 'AuditCard|LegacyBanner|error TS' } | Select-Object -First 60