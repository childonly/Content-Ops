param(
  [ValidateSet('dev', 'serve', 'start')]
  [string]$Mode = 'dev',
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$serverRoot = Join-Path $projectRoot 'server'
$configuredNode = $env:CONTENT_OPS_NODE
$knownNode22 = 'E:\Documents\.runtimes\node-v22.23.1-win-x64\node.exe'

function Get-CompatibleNode([string[]]$Candidates) {
  foreach ($candidate in $Candidates) {
    if (-not $candidate -or -not (Test-Path -LiteralPath $candidate)) { continue }
    try {
      $version = & $candidate -p "process.versions.node" 2>$null
      $major = [int]($version.Split('.')[0])
      if ($major -ge 18 -and $major -lt 24) { return $candidate }
    } catch { }
  }
  return $null
}

$pathNode = (Get-Command node -ErrorAction SilentlyContinue).Source
$nodePath = Get-CompatibleNode @($configuredNode, $knownNode22, $pathNode)
if (-not $nodePath) {
  throw 'Compatible Node.js not found. Required: Node >=18 and <24. Set CONTENT_OPS_NODE to node.exe.'
}
if ($CheckOnly) {
  $version = & $nodePath -p "process.versions.node"
  Write-Output "compatible-node=$nodePath version=$version"
  exit 0
}

Set-Location -LiteralPath $serverRoot
if ($Mode -eq 'start') {
  & $nodePath 'dist/index.js'
  exit $LASTEXITCODE
}

$tsNodeDev = Join-Path $projectRoot 'node_modules\ts-node-dev\lib\bin.js'
$arguments = @($tsNodeDev, '--transpile-only')
if ($Mode -eq 'dev') { $arguments += '--respawn' } else { $arguments += '--no-respawn' }
$arguments += 'src/index.ts'
& $nodePath @arguments
exit $LASTEXITCODE
