# Started by tracker (project "Tavora-IconReview") as: start-server.ps1 -Port <prod port>.
param([Parameter(Mandatory)][int]$Port)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
New-Item -ItemType Directory -Force (Join-Path $root 'logs') | Out-Null
& node (Join-Path $root 'proxy.mjs') $Port *>> (Join-Path $root 'logs\proxy.log')
