#!/usr/bin/env bash
# Run by the maintainer as root on the server, through deploy/send-server-setup.mjs, which uploads the files
# it needs as a folder that mirrors the repo (plus keys/<user>.pub and pc-address). Safe to run again: it
# changes only what differs and says what it did. It is the only way the deploy setup changes; a deploy
# can't change any of it.
#
# What it sets up (decided 2026-10-31, CoreHub #421):
#  - four deploy users, one per job, each with one key that only works from this PC's tailnet address
#    and only runs /usr/local/sbin/tavora-receive (sshd ForceCommand + authorized_keys restrict), on sshd's
#    own port 2222 (port 22 on the tailnet stays with Tailscale SSH, which would skip all of this);
#  - the folders those users publish into (updates and docs need no root at all);
#  - one sudo rule each for the API and Admin switch helpers;
#  - the API service's root-level files the deploy used to install: the systemd unit, the Caddy site,
#    the maintainer's helper commands and the backup timer;
#  - /etc/tavora-deploy/installed.sha256, which deploys compare with the repo to say when this needs a rerun.
set -euo pipefail
umask 022
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export LC_ALL=C
die() { echo "setup: $*" >&2; exit 1; }
say() { echo "  $*"; }

[[ "$(id -u)" == 0 ]] || die 'run this as root'
src="${1:-}"
[[ -n "$src" && -d "$src" ]] || die 'usage: setup-deploy-access.sh <folder with the uploaded files>'
src="$(cd "$src" && pwd)"
for tool in sshd ssh-keygen sudo visudo curl openssl sha256sum tar runuser systemctl base64 useradd install; do
  command -v "$tool" >/dev/null || die "$tool is missing"
done

readonly USERS=(tavora-updates tavora-docs tavora-api-deploy tavora-admin-deploy)
readonly KEYS=/etc/ssh/tavora-deploy-keys
readonly DROPIN=/etc/ssh/sshd_config.d/60-tavora-deploy.conf
readonly SUDOERS=/etc/sudoers.d/tavora-deploy
readonly MANIFEST=/etc/tavora-deploy/installed.sha256
# sshd's port for the deploy users only (port 22 on the tailnet may belong to Tailscale SSH). Same in scripts/deploy-client.mjs.
readonly DEPLOY_PORT=2222

# --- Inputs: this PC's tailnet address and one public key per user.
pc="$(tr -d ' \r\n' < "$src/pc-address")"
[[ "$pc" =~ ^100\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] || die "pc-address is not a tailnet address: $pc"
for user in "${USERS[@]}"; do
  pub="$src/keys/$user.pub"
  [[ -s "$pub" && "$(grep -c . "$pub")" == 1 ]] || die "keys/$user.pub is missing or not one line"
  [[ "$(cut -d' ' -f1 "$pub")" =~ ^(ssh-ed25519|sk-ssh-ed25519@openssh.com)$ ]] || die "keys/$user.pub is not an ed25519 key"
  ssh-keygen -l -f "$pub" >/dev/null 2>&1 || die "keys/$user.pub is not a valid public key"
done
# One key per job: the same key twice would let one job's key run another job.
[[ "$(for u in "${USERS[@]}"; do cut -d' ' -f2 "$src/keys/$u.pub"; done | sort -u | wc -l)" == "${#USERS[@]}" ]] || die 'two users got the same key; make one key per job'


echo 'Users'
for user in "${USERS[@]}"; do
  home="/var/lib/tavora-deploy/$user"
  if ! id "$user" >/dev/null 2>&1; then
    useradd --system --home-dir "$home" --no-create-home --shell /bin/sh --user-group "$user"
    say "created $user"
  fi
  # A shell is needed: sshd runs the forced command through it. /bin/sh (dash) reads no startup file, so
  # nothing in the home folder runs first. No password ('*': none can match).
  usermod -p '*' -s /bin/sh "$user"
  install -d -m 755 -o root -g root /var/lib/tavora-deploy
  install -d -m 700 -o "$user" -g "$user" "$home"
done

echo 'Folders'
# A folder that a root-owned service setup made before is handed over once, while it still belongs to root.
handover() { # folder user
  local dir="$1" user="$2"
  if [[ -L "$dir" ]]; then die "$dir is a link"; fi
  if [[ ! -e "$dir" ]]; then install -d -m 755 -o "$user" -g "$user" "$dir"; say "made $dir"; return; fi
  if [[ "$(stat -c %U "$dir")" == root ]]; then chown -R --no-dereference "$user:$user" "$dir"; say "handed $dir to $user"; fi
  [[ "$(stat -c %U "$dir")" == "$user" ]] || die "$dir belongs to $(stat -c %U "$dir"), not $user"
}
handover /srv/tavora-updates tavora-updates
handover /srv/tavora-docs tavora-docs
# The API's and Admin's own folders stay root's (the backup job and the switch helpers write there as root);
# only their releases/ belong to the deploy users.
install -d -m 755 -o root -g root /srv/tavora-api /srv/tavora-admin
handover /srv/tavora-api/releases tavora-api-deploy
handover /srv/tavora-admin/releases tavora-admin-deploy

echo 'Commands'
installed=()
put() { # repo-path destination mode [owner group]
  local from="$src/$1" to="$2" mode="$3" owner="${4:-root}" group="${5:-root}"
  [[ -f "$from" ]] || die "missing in the upload: $1"
  if ! cmp -s "$from" "$to" || [[ "$(stat -c '%a %U %G' "$to")" != "$mode $owner $group" ]]; then
    install -m "$mode" -o "$owner" -g "$group" "$from" "$to.new" && mv -f "$to.new" "$to"
    say "installed $to"
  fi
  installed+=("$1")
}
put deploy/server/tavora-receive /usr/local/sbin/tavora-receive 755
put deploy/server/tavora-api-switch /usr/local/sbin/tavora-api-switch 755
put deploy/server/tavora-admin-switch /usr/local/sbin/tavora-admin-switch 755
installed+=(deploy/server/setup-deploy-access.sh)

echo 'sudo'
sudo_rules="$(mktemp)"
cat > "$sudo_rules" <<'EOF'
# Written by setup-deploy-access.sh (Tavora). Each deploy user may run only its own switch helper as root;
# the helper checks its one argument itself.
tavora-api-deploy ALL=(root) NOPASSWD: /usr/local/sbin/tavora-api-switch
tavora-admin-deploy ALL=(root) NOPASSWD: /usr/local/sbin/tavora-admin-switch
EOF
visudo -cqf "$sudo_rules" || { rm -f "$sudo_rules"; die 'the sudo rules did not validate'; }
if ! cmp -s "$sudo_rules" "$SUDOERS"; then install -m 440 -o root -g root "$sudo_rules" "$SUDOERS"; say "wrote $SUDOERS"; fi
rm -f "$sudo_rules"
visudo -cq || die 'sudo config does not validate as a whole; check /etc/sudoers.d'

echo 'SSH'
install -d -m 755 -o root -g root "$KEYS"
for user in "${USERS[@]}"; do
  line="restrict,from=\"$pc\",command=\"/usr/local/sbin/tavora-receive\" $(cut -d' ' -f1,2 "$src/keys/$user.pub") $user"
  if [[ "$(cat "$KEYS/$user" 2>/dev/null || true)" != "$line" ]]; then
    printf '%s\n' "$line" > "$KEYS/$user.new" && chmod 644 "$KEYS/$user.new" && mv -f "$KEYS/$user.new" "$KEYS/$user"
    say "key for $user"
  fi
done
grep -qE '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config\.d/\*\.conf' /etc/ssh/sshd_config || die '/etc/ssh/sshd_config does not include sshd_config.d/*.conf'
# The deploys use their own port: Tailscale SSH (if on) answers port 22 on the tailnet address itself and would
# skip everything here. Setting the ports here replaces sshd's default (all addresses, port 22), so this only
# works where nothing else sets them.
others="$(grep -lEis '^[[:space:]]*(Port|ListenAddress)[[:space:]]' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf | grep -vxF "$DROPIN" || true)"
[[ -z "$others" ]] || die "sshd's ports are set in $others; add port $DEPLOY_PORT there by hand instead"
userlist="$(IFS=,; echo "${USERS[*]}")"
notlist="$(printf ',!%s' "${USERS[@]}")"
probe22="host=pc,addr=$pc,laddr=127.0.0.1,lport=22"
probe_deploy="host=pc,addr=$pc,laddr=127.0.0.1,lport=$DEPLOY_PORT"
strip_ports() { grep -viE '^(port|listenaddress) '; }
before="$(sshd -T -C "user=root,$probe22" | strip_ports)"
dropin="$(mktemp)"
cat > "$dropin" <<EOF
# Written by setup-deploy-access.sh (Tavora). Tavora's deploy users can only run tavora-receive, with the
# keys in $KEYS (root's, so a deploy can't change them), and nothing else: no shell, no tty, no forwarding.
# They log in on port $DEPLOY_PORT only, and port $DEPLOY_PORT takes nobody else. Port 22 stays as it was.
Port 22
Port $DEPLOY_PORT
Match LocalPort $DEPLOY_PORT User *$notlist
    DenyUsers *
Match LocalPort 22 User $userlist
    DenyUsers *
Match User $userlist
    AuthorizedKeysFile $KEYS/%u
    AuthenticationMethods publickey
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    ForceCommand /usr/local/sbin/tavora-receive
    PermitTTY no
    PermitUserRC no
    AllowTcpForwarding no
    AllowAgentForwarding no
    AllowStreamLocalForwarding no
    X11Forwarding no
    PermitTunnel no
    GatewayPorts no
# Ends the block above, so nothing after this file is limited to these users.
Match all
EOF
if ! cmp -s "$dropin" "$DROPIN"; then
  old="$(mktemp)"; had=0
  if [[ -f "$DROPIN" ]]; then cp -p "$DROPIN" "$old"; had=1; fi
  install -m 644 -o root -g root "$dropin" "$DROPIN"
  restore() { if [[ "$had" == 1 ]]; then install -m 644 "$old" "$DROPIN"; else rm -f "$DROPIN"; fi; rm -f "$old" "$dropin"; die "$1; put the previous sshd setup back"; }
  sshd -t || restore 'sshd rejected the new config'
  [[ "$(sshd -T -C "user=root,$probe22" | strip_ports)" == "$before" ]] || restore "the change would also have changed root's SSH settings on port 22"
  sshd -T -C "user=root,$probe_deploy" | grep -qixF 'denyusers *' || restore "root would be allowed on port $DEPLOY_PORT"
  for user in "${USERS[@]}"; do
    effective="$(sshd -T -C "user=$user,$probe_deploy")"
    for want in 'forcecommand /usr/local/sbin/tavora-receive' "authorizedkeysfile $KEYS/%u" 'permittty no' 'allowtcpforwarding no' 'passwordauthentication no'; do
      grep -qixF "$want" <<< "$effective" || restore "sshd would not apply '$want' to $user"
    done
    if grep -qiE '^(allowusers|allowgroups|denyusers) ' <<< "$effective"; then restore "sshd would not let $user in on port $DEPLOY_PORT (AllowUsers/AllowGroups/DenyUsers elsewhere)"; fi
    sshd -T -C "user=$user,$probe22" | grep -qixF 'denyusers *' || restore "$user would be allowed on port 22"
  done
  # New ports need sshd (or Ubuntu's ssh.socket) to listen again; open sessions stay.
  relisten() {
    if systemctl is-active --quiet ssh.socket || systemctl is-enabled --quiet ssh.socket 2>/dev/null; then
      systemctl daemon-reload && systemctl restart ssh.socket
    elif systemctl is-active --quiet ssh.service; then systemctl restart ssh.service
    elif systemctl is-active --quiet sshd.service; then systemctl restart sshd.service
    else say 'sshd is not running as a service; start it to use the new ports'; return 0; fi
  }
  listening() { ! command -v ss >/dev/null || [[ -n "$(ss -ltnH "sport = :$1")" ]]; }
  relisten || true
  sleep 1
  if ! listening 22 || ! listening "$DEPLOY_PORT"; then
    # Put the previous setup back and listen as before, so port 22 never stays down.
    if [[ "$had" == 1 ]]; then install -m 644 "$old" "$DROPIN"; else rm -f "$DROPIN"; fi
    relisten || true
    rm -f "$old" "$dropin"
    die "sshd did not come up on ports 22 and $DEPLOY_PORT; put the previous sshd setup back"
  fi
  rm -f "$old"
  say "wrote $DROPIN; sshd listens on 22 and $DEPLOY_PORT"
fi
rm -f "$dropin"
# A firewall on the server itself must let the tailnet reach the deploy port (Hetzner's cloud firewall never
# sees tailnet traffic, which arrives inside WireGuard).
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q '^Status: active'; then
  if ! ufw status | grep -qE "^$DEPLOY_PORT/tcp on tailscale0 +ALLOW"; then
    ufw allow in on tailscale0 to any port "$DEPLOY_PORT" proto tcp comment 'Tavora deploys' >/dev/null
    say "ufw: allowed port $DEPLOY_PORT on tailscale0"
  fi
fi

echo 'API service'
# What Deploy-Api.ps1 installed as root until 2026-10-31: the service user, its settings folder, the
# systemd unit, the Caddy site, the maintainer's helpers and the daily backup.
id tavora-api >/dev/null 2>&1 || { useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin tavora-api; say 'created tavora-api'; }
install -d -m 750 -o root -g tavora-api /srv/tavora-api/shared
unit_changed=0
before_unit="$(sha256sum /etc/systemd/system/tavora-api.service 2>/dev/null || true)"
put apps/api/deploy/tavora-api.service /etc/systemd/system/tavora-api.service 644
put apps/api/deploy/tavora-api-backup.service /etc/systemd/system/tavora-api-backup.service 644
put apps/api/deploy/tavora-api-backup.timer /etc/systemd/system/tavora-api-backup.timer 644
[[ "$(sha256sum /etc/systemd/system/tavora-api.service)" == "$before_unit" ]] || unit_changed=1
for helper in set-steam-key set-setting catalog backup clamav; do
  put "apps/api/deploy/tavora-api-$helper.sh" "/usr/local/sbin/tavora-api-$helper" 750
done
systemctl daemon-reload
systemctl enable tavora-api >/dev/null 2>&1 || true
systemctl enable --now tavora-api-backup.timer >/dev/null
if [[ "$unit_changed" == 1 && -L /srv/tavora-api/current ]]; then systemctl restart tavora-api; say 'restarted tavora-api for its new unit'; fi

if ! cmp -s "$src/apps/api/deploy/tavora-api.caddy" /etc/caddy/tavora-api.caddy; then
  stamp="$(date -u +%Y%m%d%H%M%S)"
  cp -p /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.before-tavora-api-$stamp"
  had_site=0; [[ -f /etc/caddy/tavora-api.caddy ]] && { cp -p /etc/caddy/tavora-api.caddy "/etc/caddy/tavora-api.caddy.before-$stamp"; had_site=1; }
  install -m 644 "$src/apps/api/deploy/tavora-api.caddy" /etc/caddy/tavora-api.caddy
  grep -qxF 'import /etc/caddy/tavora-api.caddy' /etc/caddy/Caddyfile || printf '\nimport /etc/caddy/tavora-api.caddy\n' >> /etc/caddy/Caddyfile
  if HETZNER_API_TOKEN=validate-only /usr/local/bin/caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
    systemctl reload caddy
    say 'Caddy reloaded with the new api.mytavora.app site'
  else
    cp -p "/etc/caddy/Caddyfile.before-tavora-api-$stamp" /etc/caddy/Caddyfile
    if [[ "$had_site" == 1 ]]; then cp -p "/etc/caddy/tavora-api.caddy.before-$stamp" /etc/caddy/tavora-api.caddy; else rm -f /etc/caddy/tavora-api.caddy; fi
    die 'the Caddy config did not validate; put the previous one back'
  fi
fi
installed+=(apps/api/deploy/tavora-api.caddy)

# The upload folders of the old root deploys are no longer used.
if [[ -d /root/tavora-incoming ]]; then rm -rf /root/tavora-incoming; say 'removed /root/tavora-incoming'; fi

echo 'Manifest'
install -d -m 755 -o root -g root /etc/tavora-deploy
manifest="$(mktemp)"
for file in "${installed[@]}"; do printf '%s  %s\n' "$(sha256sum "$src/$file" | cut -d' ' -f1)" "$file"; done | sort -k2 > "$manifest"
install -m 644 -o root -g root "$manifest" "$MANIFEST"
rm -f "$manifest"
say "$MANIFEST lists ${#installed[@]} files"
echo 'Done.'
