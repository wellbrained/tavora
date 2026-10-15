#!/usr/bin/env bash
# Interactive, for Nik to run on the server (ssh -t): asks for the Steam Web API
# key without showing it, checks it against Steam, stores it where only root and
# the service can read it, and restarts the service. The key is never printed
# and never passes through an assistant.
#
# Get a key at https://steamcommunity.com/dev/apikey (domain name: api.mytavora.app).
set -euo pipefail
file=/srv/tavora-api/shared/production.env
[[ -d /srv/tavora-api/shared ]] || { echo 'Deploy the service first (the shared folder is missing).'; exit 1; }

read -rsp 'Steam Web API key (input is hidden): ' key; echo
key="$(printf '%s' "$key" | tr -d '[:space:]')"
[[ "$key" =~ ^[A-Fa-f0-9]{32}$ ]] || { echo 'That does not look like a Steam Web API key (32 hex characters).'; exit 1; }

code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H "x-webapi-key: $key" 'https://api.steampowered.com/ISteamWebAPIUtil/GetSupportedAPIList/v1/')"
[[ "$code" == 200 ]] || { echo "Steam rejected the key (status $code). Nothing was saved."; exit 1; }

umask 077
tmp="$(mktemp /srv/tavora-api/shared/.env.XXXXXX)"
printf 'STEAM_WEB_API_KEY=%s\n' "$key" > "$tmp"
chown root:tavora-api "$tmp"
chmod 640 "$tmp"
mv -f "$tmp" "$file"
unset key

systemctl restart tavora-api
sleep 2
systemctl is-active --quiet tavora-api && echo 'Key saved, service restarted and running.' || { echo 'Service is not running; check: journalctl -u tavora-api'; exit 1; }
journalctl -u tavora-api -n 5 --no-pager | grep -q 'Steam import is off' && echo 'Warning: the service still reports Steam import is off.' || echo 'Steam import is on.'
