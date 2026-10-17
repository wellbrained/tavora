#!/usr/bin/env bash
# Runs on the server (as root) after Deploy-Api.ps1 uploaded a release:
# unpacks it, installs the systemd unit and Caddy site file when they changed,
# switches /srv/tavora-api/current to the new release, and rolls back when the
# service does not answer its health check.
set -euo pipefail
release="${1:-}"
[[ "$release" =~ ^[0-9]{14}-[a-f0-9]{12}$ ]] || { echo 'Invalid release'; exit 1; }
root=/srv/tavora-api
# Everything Deploy-Api.ps1 uploaded waits in root's own home (mode 0700), never in /tmp, where another
# user on the server could put a file first and swap what root installs (security review, finding 6).
incoming=/root/tavora-incoming/api
[[ -d "$incoming" && ! -L "$incoming" && "$(stat -c %u "$incoming")" == 0 ]] || { echo "$incoming is missing or not root's"; exit 1; }
archive="$incoming/tavora-api-$release.tar.gz"
[[ -f "$archive" ]] || { echo "Missing $archive"; exit 1; }

id tavora-api >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin tavora-api
install -d -m 755 "$root" "$root/releases"
# Settings that are not part of a release (the Steam key); only root and the service read it.
install -d -m 750 -o root -g tavora-api "$root/shared"

previous="$(readlink "$root/current" || true)"
target="$root/releases/$release"
[[ ! -e "$target" ]] || { echo 'Release exists'; exit 1; }
install -d -m 755 "$target"
tar -xzf "$archive" -C "$target"
rm -f "$archive"
find "$target" -type d -exec chmod 755 {} +
find "$target" -type f -exec chmod 644 {} +
[[ -s "$target/server.mjs" && -s "$target/games.sqlite" ]] || { echo 'Release is missing server.mjs or games.sqlite'; rm -rf "$target"; exit 1; }

rollback() {
  echo "$1"
  if [[ -n "$previous" ]]; then
    ln -sfn "$previous" "$root/current-next"
    mv -Tf "$root/current-next" "$root/current"
    systemctl restart tavora-api || true
    echo 'Restored the previous release'
  else
    systemctl stop tavora-api || true
    echo 'No previous release to restore; the service is stopped'
  fi
  exit 1
}

# systemd unit
if ! cmp -s "$incoming/tavora-api.service" /etc/systemd/system/tavora-api.service; then
  install -m 644 "$incoming/tavora-api.service" /etc/systemd/system/tavora-api.service
  systemctl daemon-reload
fi
systemctl enable tavora-api >/dev/null 2>&1

# switch and start
ln -sfn "$target" "$root/current-next"
mv -Tf "$root/current-next" "$root/current"
systemctl restart tavora-api

health="$(mktemp)"
healthy=0
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl --fail --silent --max-time 3 http://127.0.0.1:4010/v1/health -o "$health"; then healthy=1; break; fi
  sleep 1
done
[[ "$healthy" == 1 ]] || rollback 'Health check failed.'
grep -q '"ok":true' "$health" || rollback 'Health check did not report ok.'
cat "$health"; echo
rm -f "$health"

# Caddy site file, only when it changed; the main Caddyfile imports it once.
if ! cmp -s "$incoming/tavora-api.caddy" /etc/caddy/tavora-api.caddy; then
  stamp="$(date -u +%Y%m%d%H%M%S)"
  cp -p /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.before-tavora-api-$stamp"
  install -m 644 "$incoming/tavora-api.caddy" /etc/caddy/tavora-api.caddy
  grep -qxF 'import /etc/caddy/tavora-api.caddy' /etc/caddy/Caddyfile || printf '\nimport /etc/caddy/tavora-api.caddy\n' >> /etc/caddy/Caddyfile
  if HETZNER_API_TOKEN=validate-only /usr/local/bin/caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
    systemctl reload caddy
    echo 'Caddy reloaded with api.mytavora.app'
  else
    cp -p "/etc/caddy/Caddyfile.before-tavora-api-$stamp" /etc/caddy/Caddyfile
    rm -f /etc/caddy/tavora-api.caddy
    echo 'Caddy config did not validate; restored the previous Caddyfile. The service itself is running.'
    exit 1
  fi
fi

# The helper scripts the maintainer runs by hand (ssh -t root@... tavora-api-set-setting takedown), kept next to the other server tools.
for helper in set-steam-key set-setting backup; do
  if [[ -f "$incoming/tavora-api-$helper.sh" ]]; then install -m 750 -o root -g root "$incoming/tavora-api-$helper.sh" "/usr/local/sbin/tavora-api-$helper"; fi
done

# The daily backup of accounts and icons (14 days kept in /srv/tavora-api/backups; the PC downloads them).
for unit in tavora-api-backup.service tavora-api-backup.timer; do
  if [[ -f "$incoming/$unit" ]]; then install -m 644 "$incoming/$unit" "/etc/systemd/system/$unit"; fi
done
if [[ -f /etc/systemd/system/tavora-api-backup.timer ]]; then systemctl daemon-reload; systemctl enable --now tavora-api-backup.timer >/dev/null; fi

rm -rf "$incoming"

# Keep the five newest releases for rollback.
ls -1dt "$root"/releases/*/ | tail -n +6 | xargs -r rm -rf
printf 'Published %s (service on 127.0.0.1:4010)\n' "$release"
