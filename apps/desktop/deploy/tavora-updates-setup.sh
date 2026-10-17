#!/usr/bin/env bash
# Runs once on the server (uploaded with tavora-updates.caddy into a folder only root can write, such as /root/tavora-incoming/setup; never /tmp): adds the
# updates.mytavora.app DNS record, creates /srv/tavora-updates and installs the Caddy
# site file. Safe to run again: it only changes what is missing, and restores the
# previous Caddyfile if the new config does not validate. Prints no secrets.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

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
  if HETZNER_API_TOKEN=validate-only /usr/local/bin/caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
    systemctl reload caddy
    echo 'Caddy reloaded with updates.mytavora.app'
  else
    cp -p "/etc/caddy/Caddyfile.before-tavora-updates-$stamp" /etc/caddy/Caddyfile
    rm -f /etc/caddy/tavora-updates.caddy
    echo 'Caddy config did not validate; restored the previous Caddyfile.'
    exit 1
  fi
else
  echo 'Caddy: site file unchanged.'
fi
rm -f "$here/tavora-updates.caddy"
echo 'Setup done. The certificate is issued on the first request once DNS has propagated.'
