#Requires -Version 5.1

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path $PSScriptRoot -Parent
$workspaceRoot = Split-Path $projectRoot -Parent
$documentsRoot = [Environment]::GetFolderPath('MyDocuments')
$projectDrive = Split-Path -Qualifier $projectRoot
$runtimeRoots = @(
    (Join-Path $workspaceRoot '.runtimes'),
    (Join-Path $documentsRoot '.runtimes'),
    (Join-Path $projectDrive 'Documents\.runtimes'),
    (Join-Path $env:USERPROFILE '.runtimes')
) | Select-Object -Unique

$candidates = New-Object System.Collections.Generic.List[string]
if ($env:CONTENT_OPS_NODE_EXE) {
    $candidates.Add($env:CONTENT_OPS_NODE_EXE)
}

foreach ($runtimeRoot in $runtimeRoots) {
    if (-not (Test-Path -LiteralPath $runtimeRoot)) {
        continue
    }
    Get-ChildItem -LiteralPath $runtimeRoot -Directory -Filter 'node-v22*-win-x64' |
        Sort-Object Name -Descending |
        ForEach-Object {
            $candidates.Add((Join-Path $_.FullName 'node.exe'))
        }
}

$pathNode = Get-Command node.exe -ErrorAction SilentlyContinue
if ($pathNode) {
    $candidates.Add($pathNode.Source)
}

foreach ($candidate in $candidates | Select-Object -Unique) {
    if (-not (Test-Path -LiteralPath $candidate)) {
        continue
    }

    try {
        $version = (& $candidate -p "process.versions.node").Trim()
        if ([int]($version.Split('.')[0]) -eq 22) {
            (Resolve-Path -LiteralPath $candidate).Path
            exit 0
        }
    } catch {
        continue
    }
}

throw 'Node.js 22 not found. Set CONTENT_OPS_NODE_EXE or place a Node 22 Windows x64 runtime in a .runtimes directory.'
