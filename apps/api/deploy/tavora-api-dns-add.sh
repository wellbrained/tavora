#!/usr/bin/env bash
# Adds api.mytavora.app as a CNAME to mytavora.app through the Hetzner Cloud DNS
# API, using the token Caddy already has. Idempotent: if any record named "api"
# exists in the zone it changes nothing and says so. Prints no secrets.
set -euo pipefail
# shellcheck disable=SC1091
set -a; . /etc/caddy/dns.env; set +a
[[ -n "${HETZNER_API_TOKEN:-}" ]] || { echo 'No HETZNER_API_TOKEN in /etc/caddy/dns.env'; exit 1; }
api=https://api.hetzner.cloud/v1
auth=(-H "Authorization: Bearer $HETZNER_API_TOKEN" -H 'Content-Type: application/json')

zone="$(curl -fsS "${auth[@]}" "$api/zones?name=mytavora.app" | python3 -c 'import json,sys; z=json.load(sys.stdin)["zones"]; print(z[0]["id"] if z else "")')"
[[ -n "$zone" ]] || { echo 'Zone mytavora.app not found'; exit 1; }

existing="$(curl -fsS "${auth[@]}" "$api/zones/$zone/rrsets?name=api" | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("rrsets", [])))')"
if [[ "$existing" != 0 ]]; then
  echo "A record named api already exists in the zone ($existing rrset); nothing changed."
  exit 0
fi

result="$(mktemp)"
code="$(curl -sS -o "$result" -w '%{http_code}' "${auth[@]}" -X POST "$api/zones/$zone/rrsets" \
  -d '{"name":"api","type":"CNAME","ttl":3600,"records":[{"value":"mytavora.app.","comment":"Tavora game search service"}]}')"
echo "create status $code"
if [[ "$code" != 201 && "$code" != 200 ]]; then
  python3 -c 'import json, sys; d=json.load(open(sys.argv[1])); print(d.get("error", d))' "$result" || true
  rm -f "$result"
  exit 1
fi
rm -f "$result"
echo 'Added api.mytavora.app CNAME -> mytavora.app'
