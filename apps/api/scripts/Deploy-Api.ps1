# Builds the game search service on this PC and publishes it to the server
# (systemd unit tavora-api, 127.0.0.1:4010, behind Caddy at api.mytavora.app).
# Needs a real dataset: run `pnpm --filter @tavora/api dataset` first. Only apps/api
# has to be committed (Tavora Admin, which the API serves, deploys from its own repo, wellbrained/tavora-admin); other changes in the repository do not block a deploy.
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
# The server and SSH key come from the maintainer's environment: TAVORA_DEPLOY_HOST (user@host) and
# TAVORA_DEPLOY_SSH_KEY (the private key's path).
$key = $env:TAVORA_DEPLOY_SSH_KEY
$remote = $env:TAVORA_DEPLOY_HOST
if (-not $key -or -not $remote) { throw 'Set TAVORA_DEPLOY_HOST and TAVORA_DEPLOY_SSH_KEY first.' }
New-Item -ItemType Directory -Path $staging | Out-Null
try {
  Copy-Item $bundle (Join-Path $staging 'server.mjs')
  # The maintainer's tool for adding catalog modules by hand (tavora-api-catalog on the server).
  Copy-Item (Join-Path $api 'dist\catalog.mjs') (Join-Path $staging 'catalog.mjs')
  Copy-Item $dataset (Join-Path $staging 'games.sqlite')
  # The hosted game icons travel with the release. They are only served once TAKEDOWN_CONTACT is set in shared/production.env.
  $icons = Join-Path $api 'data\icons'
  if (Test-Path (Join-Path $icons 'index.json')) { Copy-Item $icons (Join-Path $staging 'icons') -Recurse }
  # Windows' own tar: from Git Bash, `tar.exe` is GNU tar, which reads C:\... as a remote host.
  & (Join-Path $env:SystemRoot 'System32\tar.exe') -czf $archive -C $staging .
  if ($LASTEXITCODE -ne 0) { throw 'Archive failed.' }
  $deploy = Join-Path $api 'deploy'
  # Staged in root's own home (mode 0700), never in /tmp, so no other user on the server can swap what root installs.
  $incoming = '/root/tavora-incoming/api'
  & ssh.exe -i $key -o BatchMode=yes -o StrictHostKeyChecking=yes $remote "rm -rf $incoming && install -d -m 700 /root/tavora-incoming $incoming"
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare the upload folder.' }
  & scp.exe -i $key -o BatchMode=yes -o StrictHostKeyChecking=yes $archive (Join-Path $deploy 'tavora-api.service') (Join-Path $deploy 'tavora-api.caddy') (Join-Path $deploy 'tavora-api-activate.sh') (Join-Path $deploy 'tavora-api-set-steam-key.sh') (Join-Path $deploy 'tavora-api-set-setting.sh') (Join-Path $deploy 'tavora-api-catalog.sh') (Join-Path $deploy 'tavora-api-clamav.sh') (Join-Path $deploy 'tavora-api-backup.sh') (Join-Path $deploy 'tavora-api-backup.service') (Join-Path $deploy 'tavora-api-backup.timer') "${remote}:${incoming}/"
  if ($LASTEXITCODE -ne 0) { throw 'Upload failed.' }
  & ssh.exe -i $key -o BatchMode=yes -o StrictHostKeyChecking=yes $remote "bash $incoming/tavora-api-activate.sh $release"
  if ($LASTEXITCODE -ne 0) { throw 'Deployment failed; inspect the server output. The previous release is kept.' }
} finally {
  Remove-Item $archive -ErrorAction SilentlyContinue
  Remove-Item $staging -Recurse -ErrorAction SilentlyContinue
}
