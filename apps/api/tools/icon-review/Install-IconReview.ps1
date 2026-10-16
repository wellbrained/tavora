# Installs the icon review proxy where CoreHub runs it from: D:\Server\CoreHub\TavoraIconReview
# (CoreHub project "Tavora Icon Review"; it starts scripts\start-server.ps1 -Port <prod port>).
# Run again after changing proxy.mjs, then restart the project's prod server in CoreHub.
$ErrorActionPreference = 'Stop'
$target = 'D:\Server\CoreHub\TavoraIconReview'
New-Item -ItemType Directory -Force (Join-Path $target 'scripts') | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'proxy.mjs') $target -Force
Copy-Item (Join-Path $PSScriptRoot 'start-server.ps1') (Join-Path $target 'scripts') -Force
Write-Host "Installed to $target"
