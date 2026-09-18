$ErrorActionPreference = 'Continue'
function Check($url, $tag) {
  try {
    $r = Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 5
    Write-Host ("{0}={1}" -f $tag, $r.StatusCode)
  } catch {
    Write-Host ("{0}=ERR {1}" -f $tag, $_.Exception.Message)
  }
}
Check 'http://localhost:5173' 'FE'
Check 'http://localhost:3001/api/series' 'BE'
exit 0
