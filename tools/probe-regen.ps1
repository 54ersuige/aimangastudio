$ErrorActionPreference = 'Stop'
$seriesId   = 'ed4b3c91-ca35-4117-b32e-9eb8d8eca2b0'
$characterId = '8c082058-17af-4e0f-8322-f5f41c89fc02'
$body = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'probe-regen.json')

Write-Host '[1] POST regenerate-image ...'
$taskResp = Invoke-WebRequest -Uri ("http://localhost:3001/api/series/$seriesId/characters/$characterId/regenerate-image") -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 60
Write-Host '  status=' $taskResp.StatusCode
Write-Host '  body  =' $taskResp.Content
$data = $taskResp.Content | ConvertFrom-Json
$taskId = $data.task.id
Write-Host '  taskId=' $taskId

Write-Host '[2] poll task ...'
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Seconds 2
  $p = Invoke-WebRequest -Uri ("http://localhost:3001/api/tasks/$taskId") -Method GET -TimeoutSec 30
  Write-Host "  [$i] $($p.Content)"
  $state = ($p.Content | ConvertFrom-Json).task.state
  if ($state -in @('success','error')) { break }
}
