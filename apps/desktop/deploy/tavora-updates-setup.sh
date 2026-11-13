#!/usr/bin/env bash
# Runs once on the server (uploaded with tavora-updates.caddy into a folder only root can write, such as /root/tavora-incoming/setup; never /tmp): adds the
# updates.mytavora.app DNS record, creates /srv/tavora-updates and installs the Caddy
# site file. Safe to run again: it only changes what is missing, and restores the
# previous Caddyfile if the new config does not validate. Prints no secrets.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

# Checks /etc/caddy/Caddyfile as Caddy's own user and groups, the way Caddy runs it, never as root (CoreHub
# #425): it imports /srv/corehub/shared/hosting.caddy, which the corehub user can write, and checking it opens
# (creates, chmods) the log files it names, so as root a crafted log route could make any file. Same as
# CoreHub's scripts/secure-caddy-admin.sh. On failure it says what Caddy said.
caddy_validate() {
  local user group groups home err
  command -v setpriv >/dev/null || { echo '  setpriv is missing (package util-linux)' >&2; return 1; }
  user="$(systemctl show -P User caddy 2>/dev/null || true)"
  if [[ -z "$user" || "$user" == root ]]; then
    echo "  Caddy's service runs as root (or isn't there); its config is never checked as root. Give caddy.service a User= first." >&2
    return 1
  fi
  id "$user" >/dev/null 2>&1 || { echo "  Caddy's user $user doesn't exist" >&2; return 1; }
  group="$(systemctl show -P Group caddy 2>/dev/null || true)"
  group="${group:-$(id -gn "$user")}"
  # Its groups from /etc/group, the unit's SupplementaryGroups and corehub (to read hosting.caddy), as Caddy has.
  groups="$({ id -Gn "$user"; systemctl show -P SupplementaryGroups caddy 2>/dev/null || true; if getent group corehub >/dev/null; then echo corehub; fi; } | tr -s ' ' '\n' | grep -v '^$' | sort -u | paste -sd, -)"
  home="$(getent passwd "$user" | cut -d: -f6)"
  err="$(mktemp)"
  if (cd / && setpriv --reuid="$user" --regid="$group" --groups="$groups" --inh-caps=-all --no-new-privs \
    env -i PATH=/usr/bin:/bin HOME="${home:-/}" HETZNER_API_TOKEN=validate-only \
    /usr/local/bin/caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile) </dev/null >/dev/null 2>"$err"; then
    rm -f "$err"
    return 0
  fi
  echo "  Caddy (checked as $user) says:" >&2
  tail -n 5 "$err" | sed 's/^/    /' >&2
  if grep -qi 'permission denied' "$err"; then
    echo "  Caddy can't open that file either: give $user (or the corehub group) access to it." >&2
  fi
  rm -f "$err"
  return 1
}

# --- DNS: updates.mytavora.app as a CNAME to mytavora.app, with the token Caddy already has.
# shellcheck disable=SC1091
set -a; . /etc/caddy/dns.env; set +a
[[ -n "${HETZNER_API_TOKEN:-}" ]] || { echo 'No HETZNER_API_TOKEN in /etc/caddy/dns.env'; exit 1; }
api=https://api.hetzner.cloud/v1
auth=(-H "Authorization: Bearer $HETZNER_API_TOKEN" -H 'Content-Type: application/json')
zone="$(curl -fsS "${auth[@]}" "$api/zones?name=mytavora.app" | python3 -c 'import json,sys; z=json.load(sys.stdin)["zones"]; print(z[0]["id"] if z else "")')"
[[ -n "$zone" ]] || { echo 'Zone mytavora.app not found'; exit 1; }
existing="$(curl -fsS "${auth[@]}" "$api/zones/$zone/rrsets?name=updates" | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("rrsets", [])))')"
if [[ "$existing" != 0 ]]; then
  echo 'DNS: a record named updates already exists; nothing changed.'
else
  result="$(mktemp)"
  code="$(curl -sS -o "$result" -w '%{http_code}' "${auth[@]}" -X POST "$api/zones/$zone/rrsets" \
    -d '{"name":"updates","type":"CNAME","ttl":3600,"records":[{"value":"mytavora.app.","comment":"Tavora app updates"}]}')"
  if [[ "$code" != 201 && "$code" != 200 ]]; then
    echo "DNS: create failed with status $code"
    python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("error", d))' "$result" || true
    rm -f "$result"
    exit 1
  fi
  rm -f "$result"
  echo 'DNS: added updates.mytavora.app CNAME -> mytavora.app'
fi

# --- Files: the folder the feed is served from.
install -d -m 755 /srv/tavora-updates

# --- Caddy: the site file, only when it changed; the main Caddyfile imports it once.
if ! cmp -s "$here/tavora-updates.caddy" /etc/caddy/tavora-updates.caddy 2>/dev/null; then
  stamp="$(date -u +%Y%m%d%H%M%S)"
  cp -p /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.before-tavora-updates-$stamp"
  install -m 644 "$here/tavora-updates.caddy" /etc/caddy/tavora-updates.caddy
  grep -qxF 'import /etc/caddy/tavora-updates.caddy' /etc/caddy/Caddyfile || printf '\nimport /etc/caddy/tavora-updates.caddy\n' >> /etc/caddy/Caddyfile
  if caddy_validate; then
    systemctl reload caddy
    echo 'Caddy reloaded with updates.mytavora.app'
  else
    cp -p "/etc/caddy/Caddyfile.before-tavora-updates-$stamp" /etc/caddy/Caddyfile
    rm -f /etc/caddy/tavora-updates.caddy
    echo 'Caddy config did not validate (see above); restored the previous Caddyfile.'
    exit 1
  fi
else
  echo 'Caddy: site file unchanged.'
fi
rm -f "$here/tavora-updates.caddy"
echo 'Setup done. The certificate is issued on the first request once DNS has propagated.'
