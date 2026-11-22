#!/usr/bin/env bash
# Read-only. Checks which Hetzner DNS API the server's Caddy token works with
# and whether the mytavora.app zone already has an "api" record. Prints status
# codes and record names only, never the token or any response secrets.
set -uo pipefail
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
token="$(dns_token)" || exit 1
curl_auth bearer_config Authorization "Bearer $token"
curl_auth legacy_config Auth-API-Token "$token"
unset token

zones="$(mktemp)"; legacy="$(mktemp)"
echo '== new Hetzner Cloud DNS API (api.hetzner.cloud/v1/zones) =='
code="$(curl -s -o "$zones" -w '%{http_code}' -K "$bearer_config" 'https://api.hetzner.cloud/v1/zones?name=mytavora.app')"
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
code="$(curl -s -o "$legacy" -w '%{http_code}' -K "$legacy_config" 'https://dns.hetzner.com/api/v1/zones?name=mytavora.app')"
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
