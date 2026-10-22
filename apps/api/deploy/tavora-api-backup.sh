#!/bin/sh
# Daily backup of the Tavora service's own data (accounts.sqlite, icons.sqlite, reviews.sqlite, the module catalog), run as root by
# tavora-api-backup.timer. Consistent copies (SQLite's backup, safe while the service runs) go into
# /srv/tavora-api/backups; 14 days are kept, as the privacy page says. No secrets: production.env
# (the Brevo key, the admin token) is never part of it. The maintainer copies them off the server. The players'
# cloud copies (copies.sqlite) are left out on purpose (decided 2026-10-19): they are on the players' PCs, which upload again.
set -eu
umask 077
state=/var/lib/tavora-api
dir=/srv/tavora-api/backups
mkdir -p "$dir"
chmod 700 "$dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
work=$(mktemp -d "$dir/staging.XXXXXX")
trap 'rm -rf "$work"' EXIT
for db in accounts icons reviews; do
  if [ -f "$state/$db.sqlite" ]; then sqlite3 "$state/$db.sqlite" ".backup '$work/$db.sqlite'"; fi
done
# The catalog: its database, then its zips. A zip is written before its row, and never changed, so every row backed up has its zip.
if [ -f "$state/catalog/catalog.sqlite" ]; then
  mkdir -p "$work/catalog"
  sqlite3 "$state/catalog/catalog.sqlite" ".backup '$work/catalog/catalog.sqlite'"
  cp -a "$state/catalog/zips" "$work/catalog/zips"
  if [ -d "$state/catalog/lists" ]; then cp -a "$state/catalog/lists" "$work/catalog/lists"; fi
fi
tar -czf "$dir/tavora-api-$stamp.tar.gz" -C "$work" .
find "$dir" -maxdepth 1 -type f -name 'tavora-api-*.tar.gz' -mtime +14 -delete