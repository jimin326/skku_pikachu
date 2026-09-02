[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$GameRoot
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$officialRoot = (Resolve-Path -LiteralPath $GameRoot).Path
$manifestPath = Join-Path $repositoryRoot 'bot-dev/rl/engine_manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.hashMode -ne 'sha256-lf-v1') {
  throw "Unsupported engine manifest hash mode: $($manifest.hashMode)"
}

function Get-NormalizedSha256 {
  param([Parameter(Mandatory = $true)][string]$Path)

  $text = [System.IO.File]::ReadAllText($Path)
  $normalized = $text.Replace("`r`n", "`n")
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($normalized)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try {
    $digest = $algorithm.ComputeHash($bytes)
    return -join ($digest | ForEach-Object { $_.ToString('x2') })
  }
  finally {
    $algorithm.Dispose()
  }
}

$actualCommitOutput = & git -c "safe.directory=$officialRoot" -C $officialRoot rev-parse HEAD
if ($LASTEXITCODE -ne 0) {
  throw "Could not read the official engine commit from: $officialRoot"
}
$actualCommit = $actualCommitOutput.Trim()
if ($actualCommit -ne $manifest.commit) {
  throw "Official engine commit mismatch. Expected $($manifest.commit), got $actualCommit"
}

foreach ($property in $manifest.files.PSObject.Properties) {
  $relativePath = $property.Name
  $source = Join-Path $officialRoot $relativePath
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Required official engine file not found: $source"
  }
  $actualHash = Get-NormalizedSha256 -Path $source
  if ($actualHash -ne $property.Value) {
    throw "Official engine hash mismatch for $relativePath. Expected $($property.Value), got $actualHash"
  }
}

foreach ($relativePath in $manifest.runtimeFiles) {
  $source = Join-Path $officialRoot $relativePath
  $destination = Join-Path $repositoryRoot $relativePath
  $destinationDirectory = Split-Path -Parent $destination
  New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Force
  $hash = Get-NormalizedSha256 -Path $destination
  if ($hash -ne $manifest.files.$relativePath) {
    throw "Copied engine hash mismatch for $relativePath"
  }
  Write-Host "$relativePath  $hash"
}

Write-Host "Official engine commit verified: $actualCommit"
Write-Host 'Official engine files copied. Run: node bot-dev/rl/physics_clamp_smoke.mjs'
