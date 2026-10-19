#!/usr/bin/env bash
# Read-only. Runs on the server and prints what is needed to deploy the
# game search service: Node, how Caddy is configured, how docs.mytavora.app is
# routed, which ports are taken, how the other Node apps run under systemd and
# how full the disk is (the module catalog's zips live in the state folder, C9).
# It changes nothing and prints no secrets (environment files are not read).
set -uo pipefail
section() { printf '\n== %s ==\n' "$1"; }

section 'node and sqlite'
command -v node && node -v
node -e "require('node:sqlite'); console.log('node:sqlite available')" 2>&1 | head -n 2

section 'caddy'
caddy version 2>&1 | head -n 1
systemctl cat caddy 2>/dev/null | grep -E '^(ExecStart|ExecReload|User|Environment)' | sed -E 's/(TOKEN|KEY|SECRET)=[^ ]*/\1=<hidden>/g'
ls -la /etc/caddy /etc/caddy/conf.d 2>&1 | head -n 40

section 'where mytavora is routed'
grep -rn --include='*' -E 'mytavora' /etc/caddy 2>/dev/null | sed -E 's/(token|key|secret)[^ ]*/<hidden>/Ig' | head -n 40

section 'ports in use on loopback'
ss -ltnH 2>/dev/null | awk '{print $4}' | grep -E '^127\.0\.0\.1:' | sort -t: -k2 -n

section 'app services'
systemctl list-units --type=service --state=running --no-legend 2>/dev/null | awk '{print $1}' | grep -vE '^(systemd|dbus|getty|ssh|cron|rsyslog|user|polkit|snapd|unattended|multipathd|networkd|chrony|qemu|serial|containerd)' | head -n 30
# Other units to show, as an example of a working setup: TAVORA_INSPECT_UNITS="unit1 unit2".
for unit in ${TAVORA_INSPECT_UNITS:-}; do
  if systemctl cat "$unit" >/dev/null 2>&1; then
    section "unit: $unit"
    systemctl cat "$unit" | grep -vE '^(#|$)' | sed -E 's/(TOKEN|KEY|SECRET|PASSWORD)=[^ ]*/\1=<hidden>/g' | head -n 30
  fi
done

section 'disk'
# The catalog refuses uploads with 507 at its own cap; this shows whether the disk runs out first.
state=/var/lib/tavora-api
df -h / /srv "$state" 2>/dev/null | awk 'NR == 1 || !seen[$0]++'
if [[ -d "$state/catalog/zips" ]]; then
  printf 'catalog zips: %s in %s files\n' "$(du -sh "$state/catalog/zips" 2>/dev/null | cut -f1)" "$(find "$state/catalog/zips" -type f 2>/dev/null | wc -l)"
else
  echo "catalog zips: none yet (or $state is not readable; run as root)"
fi
# A warning when the disk holding the state folder is 90 % full or has less than 5 GB left.
read -r used avail < <(df -P -k "$state" 2>/dev/null | awk 'NR == 2 { sub("%", "", $5); print $5, $4 }')
if [[ -n "${used:-}" ]] && { (( used >= 90 )) || (( avail < 5 * 1024 * 1024 )); }; then
  echo "WARNING: the disk with $state is ${used}% full, $(( avail / 1024 / 1024 )) GB left. Make room before the catalog, accounts and search stop writing."
fi

section 'srv and dns tooling'
ls -la /srv | head -n 30
ls /usr/local/bin | head -n 40
