# Builds the docs on this PC and publishes them to docs.mytavora.app on the server
# (Caddy serves /srv/tavora-docs/current). Only apps/docs has to be committed: changes elsewhere in the repo
# belong to the Tavora app and do not block a docs deploy (the build still reads the SDK sources as they are).
param()
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$docs = Join-Path $repo 'apps\docs'
$changes = & git -C $repo status --porcelain -- apps/docs
if ($LASTEXITCODE -ne 0 -or $changes) { throw 'Commit the changes in apps/docs before deploying.' }
$revision = (& git -C $repo rev-parse --short=12 HEAD).Trim()
if ($revision -notmatch '^[a-f0-9]{12}$') { throw 'Invalid source revision.' }
& pnpm --dir $repo --filter @tavora/docs build
if ($LASTEXITCODE -ne 0) { throw 'Docs build failed.' }
$dist = Join-Path $docs '.vitepress\dist'
if (-not (Test-Path (Join-Path $dist 'index.html'))) { throw 'Build produced no index.html.' }
$release = "$((Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss'))-$revision"
$archive = Join-Path $env:TEMP "tavora-docs-$release.tar.gz"
# The server and SSH key come from the maintainer's environment: TAVORA_DEPLOY_HOST (user@host) and
# TAVORA_DEPLOY_SSH_KEY (the private key's path).
$key = $env:TAVORA_DEPLOY_SSH_KEY
$remote = $env:TAVORA_DEPLOY_HOST
if (-not $key -or -not $remote) { throw 'Set TAVORA_DEPLOY_HOST and TAVORA_DEPLOY_SSH_KEY first.' }
$options = @('-i', $key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15')
& tar.exe -czf $archive -C $dist .
if ($LASTEXITCODE -ne 0) { throw 'Static archive failed.' }
# Staged in root's own home (mode 0700), never in /tmp, so no other user on the server can swap what root runs.
$incoming = '/root/tavora-incoming/docs'
try {
  & ssh.exe @options $remote "rm -rf $incoming && install -d -m 700 /root/tavora-incoming $incoming"
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare the upload folder.' }
  & scp.exe @options $archive (Join-Path $docs 'deploy\activate-docs.sh') "${remote}:${incoming}/"
  if ($LASTEXITCODE -ne 0) { throw 'Upload failed.' }
  & ssh.exe @options $remote "bash $incoming/activate-docs.sh $release"
  if ($LASTEXITCODE -ne 0) { throw 'Deployment failed; inspect server output. Previous release is retained.' }
} finally {
  Remove-Item $archive -ErrorAction SilentlyContinue
}
