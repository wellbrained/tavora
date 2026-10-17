#!/usr/bin/env bash
# Read-only. Checks which Hetzner DNS API the server's Caddy token works with
# and whether the mytavora.app zone already has an "api" record. Prints status
# codes and record names only, never the token or any response secrets.
set -uo pipefail
# shellcheck disable=SC1091
set -a; . /etc/caddy/dns.env; set +a
[[ -n "${HETZNER_API_TOKEN:-}" ]] || { echo 'No HETZNER_API_TOKEN in /etc/caddy/dns.env'; exit 1; }

zones="$(mktemp)"; legacy="$(mktemp)"
echo '== new Hetzner Cloud DNS API (api.hetzner.cloud/v1/zones) =='
code="$(curl -s -o "$zones" -w '%{http_code}' -H "Authorization: Bearer $HETZNER_API_TOKEN" 'https://api.hetzner.cloud/v1/zones?name=mytavora.app')"
echo "status $code"
if [[ "$code" == 200 ]]; then
  python3 - "$zones" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
for zone in data.get('zones', []):
    print('zone', zone.get('id'), zone.get('name'), 'ttl', zone.get('ttl'), 'mode', zone.get('mode'))
PY
fi

echo '== legacy Hetzner DNS API (dns.hetzner.com/api/v1) =='
code="$(curl -s -o "$legacy" -w '%{http_code}' -H "Auth-API-Token: $HETZNER_API_TOKEN" 'https://dns.hetzner.com/api/v1/zones?name=mytavora.app')"
echo "status $code"
if [[ "$code" == 200 ]]; then
  python3 - "$legacy" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
for zone in data.get('zones', []):
    print('zone', zone.get('id'), zone.get('name'), 'ttl', zone.get('ttl'))
PY
fi
rm -f "$zones" "$legacy"
echo '== records seen by public DNS =='
for name in mytavora.app docs.mytavora.app api.mytavora.app; do
  printf '%s: ' "$name"; getent ahosts "$name" | awk '{print $1}' | sort -u | tr '\n' ' '; echo
done
