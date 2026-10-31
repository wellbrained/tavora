# Deploys and the server setup

Tavora puts four things on the Hetzner server: the app's update feed (`pnpm release`), the docs
(`apps/docs`, `Deploy-Docs.ps1`), the API service (`apps/api`, `Deploy-Api.ps1`) and Tavora Admin (its own
repo, `Deploy-Admin.ps1`). Each has **its own user and key on the server, and that key can do nothing but
hand over one upload** (decided 2026-10-31, CoreHub #421). No deploy key gets a shell, and none is root.

| Job | Server user | Key setting on the PC | What the key can change |
| --- | --- | --- | --- |
| updates | `tavora-updates` | `TAVORA_UPDATES_SSH_KEY` | `/srv/tavora-updates` (a newer version only) |
| docs | `tavora-docs` | `TAVORA_DOCS_SSH_KEY` | `/srv/tavora-docs` |
| api | `tavora-api-deploy` | `TAVORA_API_SSH_KEY` | `/srv/tavora-api/releases`, then a switch and restart through `tavora-api-switch` |
| admin | `tavora-admin-deploy` | `TAVORA_ADMIN_SSH_KEY` | `/srv/tavora-admin/releases`, then a switch through `tavora-admin-switch` (the panel only; the gateway proxy is installed by hand with tavora-admin's `proxy/setup-server.sh`) |

`TAVORA_DEPLOY_HOST` is the server's tailnet address (no user). The root key is only for the maintainer's own
admin work and is never in a `TAVORA_*` setting.

## How it works

- sshd forces every login of these users into `/usr/local/sbin/tavora-receive`
  ([server/tavora-receive](server/tavora-receive)): no shell, no tty, no forwarding, no scp or sftp, and the keys
  work only from this PC's tailnet address. The keys sit in `/etc/ssh/tavora-deploy-keys/<user>`, owned by root.
- The deploy users log in on **sshd's port 2222** only, and port 2222 takes nobody else. Port 22 on the
  tailnet address belongs to Tailscale SSH, which decides by tailnet policy, ignores keys and would skip every
  restriction here; Nik keeps it for his own devices (decided 2026-10-31). Root's SSH on port 22 is unchanged.
- A deploy sends one tar over stdin with its SHA-256 ([../scripts/deploy-client.mjs](../scripts/deploy-client.mjs)).
  The receiver checks the hash and every entry (plain files and folders, safe names, only the expected files),
  unpacks it as the job's user and publishes it. Nothing uploaded is ever run on the server by root.
- Updates and docs need no root at all. The API and Admin switch through one sudo rule each, to a fixed helper
  that checks its one argument and never reads uploaded files as root.
- Before each deploy the client asks the server `hello`. It stops when the key opened a shell (the old root
  key), belongs to another job, or the server's setup is older than this repo.
- The update feed refuses a version that is not newer than the live one. A bad release is fixed by a newer one.

What a stolen deploy key can still do (accepted 2026-10-31): the API key runs code as the `tavora-api` service
(that is what a deploy is), the docs key can change the docs, the Admin key can change the panel, and the
updates key can ship a bad installer until updates are signed (parked until the first public release). The
tailnet-only rule and the passphrases below make using a stolen key harder.

**Caddy's admin API** listens only on the Unix socket `/run/caddy-admin/admin.sock`, which only root, Caddy
and CoreHub (the `corehub` group) can open (CoreHub #422, decided 2026-10-31). Before, it listened on
`127.0.0.1:2019` without a password, so any program on the server, code shipped with the API key included,
could rewrite Caddy and reach the update feed, the Hetzner DNS token and the TLS keys. The root helpers here
keep using `systemctl reload caddy`, which finds the socket in the Caddyfile. CoreHub's
`scripts/secure-caddy-admin.sh --check` (as root on the server) says whether it is still in place.

## Change the server setup

The setup ([server/setup-deploy-access.sh](server/setup-deploy-access.sh)) makes the users, folders, keys,
sshd and sudo rules, and installs the API's root-level files (systemd unit, Caddy site, the `tavora-api-*`
helpers, the backup timer), which a deploy no longer touches. Run it again whenever one of those changes or a
deploy says the server's setup is older than the repo. It changes only what differs and prints what it did.

```powershell
node deploy/send-server-setup.mjs --admin-key "D:\Server\vpn ssh-key-2026-10-05.key"
node scripts/deploy-client.mjs hello
```

It sends only committed files. It needs the root admin key, `TAVORA_DEPLOY_HOST` and the four key settings
(it sends their public halves). Another PC (the Mac) is added with `--pc-address <its tailnet address>`;
that replaces the address for all four keys.

## First-time setup (maintainer, once)

Every step is yours: no agent handles the keys. Run the steps in a normal PowerShell unless it says
**Admin**. "Same passphrase" means one passphrase for the four deploy keys; the root key gets its own. Keep
both in your password manager.

1. **Make the four deploy keys** (same passphrase for all four):
   ```powershell
   foreach ($k in 'tavora-updates','tavora-docs','tavora-api-deploy','tavora-admin-deploy') { ssh-keygen -t ed25519 -C $k -f "$HOME\.ssh\$k" }
   ```
2. **Make the new root key in the old key's place.** The old file is moved aside first, so every script and
   scheduled task that uses this path keeps working:
   ```powershell
   Move-Item "D:\Server\vpn ssh-key-2026-10-05.key" "D:\Server\old-root.key"
   Move-Item "D:\Server\vpn ssh-key-2026-10-05.key.pub" "D:\Server\old-root.key.pub" -ErrorAction SilentlyContinue
   ssh-keygen -t ed25519 -C hetzner-root -f "D:\Server\vpn ssh-key-2026-10-05.key"
   ```
3. **Start the ssh-agent** (**Admin** PowerShell, once):
   ```powershell
   Get-Service ssh-agent | Set-Service -StartupType Automatic; Start-Service ssh-agent
   ```
4. **Add the keys to the agent** (normal PowerShell; it asks for each passphrase once, then remembers them,
   even after a restart):
   ```powershell
   foreach ($k in 'tavora-updates','tavora-docs','tavora-api-deploy','tavora-admin-deploy') { ssh-add "$HOME\.ssh\$k" }
   ssh-add "D:\Server\vpn ssh-key-2026-10-05.key"
   ```
5. **Put the new root key on the server** (with the old key, one last time):
   ```powershell
   Get-Content "D:\Server\vpn ssh-key-2026-10-05.key.pub" | ssh -i "D:\Server\old-root.key" root@100.92.36.114 "cat >> /root/.ssh/authorized_keys"
   ssh -i "D:\Server\vpn ssh-key-2026-10-05.key" -o IdentitiesOnly=yes root@100.92.36.114 "echo new root key works"
   ```
6. **Set the PC's settings** (then open a new terminal):
   ```powershell
   setx TAVORA_DEPLOY_HOST 100.92.36.114
   foreach ($k in @{UPDATES='tavora-updates'; DOCS='tavora-docs'; API='tavora-api-deploy'; ADMIN='tavora-admin-deploy'}.GetEnumerator()) { setx "TAVORA_$($k.Key)_SSH_KEY" "$HOME\.ssh\$($k.Value)" }
   [Environment]::SetEnvironmentVariable('TAVORA_DEPLOY_SSH_KEY', $null, 'User')
   ```
7. **Run the server setup** from a checkout of this branch (new terminal). Then let this PC learn the
   server's key on the deploy port (over the tailnet, which already proves it is your server) and check all
   four keys:
   ```powershell
   node deploy/send-server-setup.mjs --admin-key "D:\Server\vpn ssh-key-2026-10-05.key"
   ssh-keyscan -p 2222 -t ed25519 100.92.36.114 | Out-File -Append -Encoding ascii "$HOME\.ssh\known_hosts"
   node scripts/deploy-client.mjs hello
   ```
   Each job should say `OK`. If they time out, the tailnet's access rules must let this PC reach the server on
   TCP 2222. From now on deploy only with the new scripts: the old ones would write as root
   into folders that now belong to the deploy users.
8. **Take the old key off the server** (over the tailnet, where Tailscale SSH lets you in without a key) and
   check on the server that it is gone:
   ```powershell
   $body = (ssh-keygen -y -f "D:\Server\old-root.key").Split(' ')[1]
   if ($body) { ssh root@100.92.36.114 "cp -p /root/.ssh/authorized_keys /root/.ssh/authorized_keys.before-rotation && grep -vF '$body' /root/.ssh/authorized_keys.before-rotation > /root/.ssh/authorized_keys; echo old key lines left: `$(grep -cF '$body' /root/.ssh/authorized_keys); echo keys left: `$(grep -c . /root/.ssh/authorized_keys)" } else { "Could not read the old key; nothing changed." }
   ```
   It must say `old key lines left: 0`, and `keys left` must be at least 1 (the new root key). Then delete the old key:
   `Remove-Item "D:\Server\old-root.key", "D:\Server\old-root.key.pub" -ErrorAction SilentlyContinue`.
