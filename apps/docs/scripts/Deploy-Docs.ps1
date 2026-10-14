# Builds the docs on this PC and publishes them to docs.mytavora.app on the Hetzner server
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
$key = 'D:\Server\vpn ssh-key-2026-10-05.key'
$remote = 'root@100.64.0.1'
$options = @('-i', $key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15')
& tar.exe -czf $archive -C $dist .
if ($LASTEXITCODE -ne 0) { throw 'Static archive failed.' }
try {
  & scp.exe @options $archive (Join-Path $docs 'deploy\activate-docs.sh') "${remote}:/tmp/"
  if ($LASTEXITCODE -ne 0) { throw 'Upload failed.' }
  & ssh.exe @options $remote "bash /tmp/activate-docs.sh $release"
  if ($LASTEXITCODE -ne 0) { throw 'Deployment failed; inspect server output. Previous release is retained.' }
} finally {
  Remove-Item $archive -ErrorAction SilentlyContinue
}
