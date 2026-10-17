#!/bin/sh
# Daily backup of the Tavora service's own data (accounts.sqlite, icons.sqlite), run as root by
# tavora-api-backup.timer. Consistent copies (SQLite's backup, safe while the service runs) go into
# /srv/tavora-api/backups; 14 days are kept, as the privacy page says. No secrets: production.env
# (the Brevo key, the admin token) is never part of it. The maintainer copies them off the server.
set -eu
umask 077
state=/var/lib/tavora-api
dir=/srv/tavora-api/backups
mkdir -p "$dir"
chmod 700 "$dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
work=$(mktemp -d "$dir/staging.XXXXXX")
trap 'rm -rf "$work"' EXIT
for db in accounts icons; do
  if [ -f "$state/$db.sqlite" ]; then sqlite3 "$state/$db.sqlite" ".backup '$work/$db.sqlite'"; fi
done
tar -czf "$dir/tavora-api-$stamp.tar.gz" -C "$work" .
find "$dir" -maxdepth 1 -type f -name 'tavora-api-*.tar.gz' -mtime +14 -delete