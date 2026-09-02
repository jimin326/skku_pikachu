[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$GameRoot
)

$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$officialRoot = (Resolve-Path -LiteralPath $GameRoot).Path
$relativeFiles = @(
  'src/resources/js/physics.js',
  'src/resources/js/rand.js',
  'src/resources/js/bot/botContract.js'
)

foreach ($relativePath in $relativeFiles) {
  $source = Join-Path $officialRoot $relativePath
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw "Required official engine file not found: $source"
  }
}

foreach ($relativePath in $relativeFiles) {
  $source = Join-Path $officialRoot $relativePath
  $destination = Join-Path $repositoryRoot $relativePath
  $destinationDirectory = Split-Path -Parent $destination
  New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Force
  $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash.ToLowerInvariant()
  Write-Host "$relativePath  $hash"
}

Write-Host 'Official engine files copied. Run: node bot-dev/rl/physics_clamp_smoke.mjs'
