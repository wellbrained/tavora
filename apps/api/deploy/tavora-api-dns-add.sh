#!/usr/bin/env bash
# Adds api.mytavora.app as a CNAME to mytavora.app through the Hetzner Cloud DNS
# API, using the token Caddy already has. Idempotent: if any record named "api"
# exists in the zone it changes nothing and says so. Prints no secrets.
set -euo pipefail
# Reads HETZNER_API_TOKEN from /etc/caddy/dns.env as data, never as shell code (sourcing it as root would run whatever
# it holds), and only while the file and its folder are root's alone: owned by root, not a link, writable by nobody else.
# The token goes to curl in a config file only this user can read (never as an argument, which other users see in /proc).
# The same in apps/api/deploy/tavora-api-dns-add.sh, tavora-api-dns-probe.sh and apps/desktop/deploy/tavora-updates-setup.sh
# (a test checks that they stay the same).
dns_token() {
  local file=/etc/caddy/dns.env path owner mode line value=""
  for path in /etc/caddy "$file"; do
    if [[ -L "$path" || ! -e "$path" ]]; then echo "$path is missing or a link; nothing was read." >&2; return 1; fi
    read -r owner mode < <(stat -c '%u %a' "$path")
    if [[ "$owner" != 0 ]] || (( (8#$mode & 8#022) != 0 )); then
      echo "$path must belong to root and be writable by root only (it is owner $owner, mode $mode); nothing was read." >&2
      return 1
    fi
  done
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?HETZNER_API_TOKEN=(.*)$ ]]; then value="${BASH_REMATCH[2]}"; fi
  done < "$file"
  # Quotes around the value, as systemd's EnvironmentFile (Caddy's unit reads the file too) allows.
  if [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]]; then value="${BASH_REMATCH[1]}"; fi
  if [[ ! "$value" =~ ^[A-Za-z0-9._~+/=-]+$ ]]; then echo "No usable HETZNER_API_TOKEN in $file" >&2; return 1; fi
  printf '%s' "$value"
}
# Puts the path of a curl config file (mode 600, removed on exit) holding one header in <variable>.
curl_configs=()
trap 'rm -f "${curl_configs[@]}"' EXIT
curl_auth() { # <variable> <header name> <value>
  local config
  config="$(umask 077 && mktemp)"
  curl_configs+=("$config")
  printf 'header = "%s: %s"\n' "$2" "$3" > "$config"
  printf -v "$1" '%s' "$config"
}
token="$(dns_token)"
api=https://api.hetzner.cloud/v1
curl_auth bearer_config Authorization "Bearer $token"
unset token
auth=(-K "$bearer_config" -H 'Content-Type: application/json')

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
