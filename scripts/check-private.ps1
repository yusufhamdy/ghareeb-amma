# check-private.ps1 - fail loudly if any owner-only day note leaks into public/.
# Scans every text file under public/ for the content of each private note.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$private = Join-Path $root 'data\challenge-notes-private.json'
$publicDir = Join-Path $root 'public'

if (-not (Test-Path $private)) {
  Write-Host 'SKIP: data/challenge-notes-private.json not present'
  exit 0
}

$notes = Get-Content $private -Raw | ConvertFrom-Json
$needles = @()
foreach ($prop in $notes.PSObject.Properties) {
  $v = [string]$prop.Value
  $t = $v.Trim()
  if ($t.Length -ge 8) {
    if ($t.Length -gt 24) { $t = $t.Substring(0, 24) }
    $needles += $t
  }
}
if ($needles.Count -eq 0) {
  Write-Host 'SKIP: no non-trivial notes to scan for'
  exit 0
}

$files = Get-ChildItem $publicDir -Recurse -File |
  Where-Object { $_.Extension -match '\.(html|js|json|css|txt|md|xml)$' }

$found = $false
foreach ($f in $files) {
  $text = Get-Content $f.FullName -Raw -ErrorAction SilentlyContinue
  if (-not $text) { continue }
  foreach ($needle in $needles) {
    if ($text.IndexOf($needle) -ge 0) {
      Write-Host ("FOUND in {0}: {1}" -f $f.FullName, $needle)
      $found = $true
    }
  }
}

if ($found) { Write-Host 'FOUND'; exit 1 } else { Write-Host 'OK' ; exit 0 }
