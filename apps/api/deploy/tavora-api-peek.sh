#!/usr/bin/env bash
# Read-only. Prints the Caddy site files for the other Tavora sites and how the
# main Caddyfile pulls them in, plus the names (never the values) in dns.env.
set -uo pipefail
for file in /etc/caddy/Caddyfile /etc/caddy/tavora-docs.caddy /etc/caddy/tavora-website.caddy; do
  printf '\n== %s ==\n' "$file"
  cat "$file"
done
printf '\n== names in /etc/caddy/dns.env (values hidden) ==\n'
sed -E 's/=.*/=<hidden>/' /etc/caddy/dns.env
printf '\n== docs and website release layout ==\n'
ls -la /srv/tavora-docs /srv/tavora-docs/releases 2>&1 | head -n 12
printf '\n== dns for api.mytavora.app ==\n'
getent hosts api.mytavora.app || echo 'no record yet'
getent hosts docs.mytavora.app
