$body = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'probe-image.json')
$resp = Invoke-WebRequest -Uri 'http://localhost:3001/api/image' -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 120
Write-Host 'status=' $resp.StatusCode
Write-Host $resp.Content.Substring(0, [Math]::Min(1200, $resp.Content.Length))
