#Requires -Version 5.1

param(
    [switch]$BackendOnly,
    [switch]$FrontendOnly,
    [switch]$OpenBrowser
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $MyInvocation.MyCommand.Path -Parent
$nodeExe = & (Join-Path $projectRoot 'scripts\resolve-node22.ps1')
$nodeVersion = (& $nodeExe -p "process.versions.node").Trim()
$logDir = Join-Path $projectRoot 'logs'

# Windows PowerShell 5.1 may inherit both Path and PATH. Start-Process
# treats them as duplicate keys, so remove both environment entries and add
# back one canonical Path entry in this launcher process.
$processPath = [Environment]::GetEnvironmentVariable('Path', 'Process')
Remove-Item -LiteralPath 'Env:\Path' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'Env:\PATH' -ErrorAction SilentlyContinue
$env:Path = $processPath

if (-not (Test-Path -LiteralPath $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

function Test-PortListening([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $connectTask = $client.ConnectAsync('127.0.0.1', $Port)
        if (-not $connectTask.Wait(750)) {
            return $false
        }
        return $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Wait-Port([int]$Port, [int]$TimeoutSeconds = 60) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (Test-PortListening $Port) {
            return
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)

    throw "Startup timeout. Port $Port is not listening. Check $logDir."
}

function Start-NodeService(
    [string]$Name,
    [int]$Port,
    [string]$WorkingDirectory,
    [string[]]$Arguments
) {
    if (Test-PortListening $Port) {
        Write-Host "[OK] $Name is already listening on port $Port"
        return
    }

    $stdout = Join-Path $logDir "$Name-node22.out.log"
    $stderr = Join-Path $logDir "$Name-node22.err.log"
    $quotedArguments = $Arguments | ForEach-Object {
        if ($_ -match '\s') {
            '"' + $_.Replace('"', '\"') + '"'
        } else {
            $_
        }
    }
    Start-Process `
        -FilePath $nodeExe `
        -ArgumentList $quotedArguments `
        -WorkingDirectory $WorkingDirectory `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr | Out-Null

    Write-Host "[START] Starting $Name with Node.js $nodeVersion"
    Wait-Port $Port
    Write-Host "[OK] $Name is listening on port $Port"
}

$startBackend = -not $FrontendOnly
$startFrontend = -not $BackendOnly

if ($startBackend) {
    Start-NodeService `
        -Name 'backend' `
        -Port 3100 `
        -WorkingDirectory (Join-Path $projectRoot 'server') `
        -Arguments @(
            (Join-Path $projectRoot 'node_modules\ts-node\dist\bin.js'),
            '--transpile-only',
            'src/index.ts'
        )
}

if ($startFrontend) {
    Start-NodeService `
        -Name 'frontend' `
        -Port 5180 `
        -WorkingDirectory (Join-Path $projectRoot 'client') `
        -Arguments @(
            (Join-Path $projectRoot 'node_modules\vite\bin\vite.js'),
            '--port',
            '5180',
            '--host',
            '127.0.0.1'
        )
}

Write-Host "[OK] Startup baseline passed with Node.js $nodeVersion"
if ($startBackend) { Write-Host '     Backend: http://127.0.0.1:3100' }
if ($startFrontend) { Write-Host '     Frontend: http://127.0.0.1:5180' }

if ($OpenBrowser -and $startFrontend) {
    Start-Process 'http://127.0.0.1:5180/dashboard'
}
