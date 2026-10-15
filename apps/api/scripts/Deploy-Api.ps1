# Builds the game search service on this PC and publishes it to the Hetzner server
# (systemd unit tavora-api, 127.0.0.1:4010, behind Caddy at api.mytavora.app).
# Needs a real dataset: run `pnpm --filter @tavora/api dataset` first. Only apps/api
# has to be committed; other changes in the repository do not block a deploy.
param([switch]$AllowSmallDataset)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$api = Join-Path $repo 'apps\api'
$changes = & git -C $repo status --porcelain -- apps/api
if ($LASTEXITCODE -ne 0 -or $changes) { throw 'Commit the changes in apps/api before deploying.' }
$revision = (& git -C $repo rev-parse --short=12 HEAD).Trim()
if ($revision -notmatch '^[a-f0-9]{12}$') { throw 'Invalid source revision.' }

$dataset = Join-Path $api 'data\games.sqlite'
if (-not (Test-Path $dataset)) { throw 'No dataset. Run: pnpm --filter @tavora/api dataset' }
$count = [int](& node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(d.prepare('select count(*) c from games').get().c)" $dataset 2>$null)
if ($count -lt 20000 -and -not $AllowSmallDataset) { throw "The dataset has only $count games; build the full one, or pass -AllowSmallDataset for a test." }

& pnpm --dir $repo --filter @tavora/api build
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
$bundle = Join-Path $api 'dist\server.mjs'
if (-not (Test-Path $bundle)) { throw 'Build produced no server.mjs.' }

$release = "$((Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss'))-$revision"
$staging = Join-Path $env:TEMP "tavora-api-$release"
$archive = Join-Path $env:TEMP "tavora-api-$release.tar.gz"
$key = 'D:\Server\vpn ssh-key-2026-10-05.key'
$remote = 'root@100.92.36.114'
New-Item -ItemType Directory -Path $staging | Out-Null
try {
  Copy-Item $bundle (Join-Path $staging 'server.mjs')
  Copy-Item $dataset (Join-Path $staging 'games.sqlite')
  & tar.exe -czf $archive -C $staging .
  if ($LASTEXITCODE -ne 0) { throw 'Archive failed.' }
  $deploy = Join-Path $api 'deploy'
  & scp.exe -i $key -o BatchMode=yes -o StrictHostKeyChecking=yes $archive (Join-Path $deploy 'tavora-api.service') (Join-Path $deploy 'tavora-api.caddy') (Join-Path $deploy 'tavora-api-activate.sh') "${remote}:/tmp/"
  if ($LASTEXITCODE -ne 0) { throw 'Upload failed.' }
  & ssh.exe -i $key -o BatchMode=yes -o StrictHostKeyChecking=yes $remote "bash /tmp/tavora-api-activate.sh $release"
  if ($LASTEXITCODE -ne 0) { throw 'Deployment failed; inspect the server output. The previous release is kept.' }
} finally {
  Remove-Item $archive -ErrorAction SilentlyContinue
  Remove-Item $staging -Recurse -ErrorAction SilentlyContinue
}
