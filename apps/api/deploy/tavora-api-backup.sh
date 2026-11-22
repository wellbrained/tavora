#!/bin/sh
# Daily backup of the Tavora service's own data (accounts.sqlite, icons.sqlite, reviews.sqlite, conversations.sqlite,
# leaderboards.sqlite, stats.sqlite, module-requests.sqlite, the module catalog), started by tavora-api-backup.timer.
# Consistent copies (SQLite's backup, safe while the service runs) go into /srv/tavora-api/backups; 7 days are kept, as
# the privacy page says. No secrets: production.env (the Brevo key, the admin token) is never part of it. The maintainer
# copies them off the server. The users' cloud copies (copies.sqlite) are left out on purpose (decided 2026-10-19): they
# are on the users' PCs, which upload again.
#
# Who does what: /var/lib/tavora-api is the service's own folder, so code running as the service decides what is in it
# (a file, a link, a database with a crafted journal). Everything that opens it therefore runs as tavora-api: sqlite3,
# the copy of the zips and lists, and tar, which streams the archive to stdout. Root only writes that stream into its own
# folder, /srv/tavora-api/backups (root, mode 700; each archive root, mode 600), where the service can neither read nor
# change a backup, and removes the old ones there. Root never opens a path in the service's folder.
set -eu
umask 077
state=/var/lib/tavora-api
dir=/srv/tavora-api/backups
mkdir -p "$dir"
chmod 700 "$dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="$dir/tavora-api-$stamp.tar.gz"
trap 'rm -f "$out.part"' EXIT

# Run as tavora-api, with an empty environment: copies the databases into a folder of its own, then writes one .tar.gz to
# stdout with them, the catalog's zips and its signed lists. Links are never followed (-f and -d with ! -L; tar keeps a link
# as a link). The catalog: its database, then its zips. A zip is written before its row, and never changed, so every row
# backed up has its zip.
collect=$(cat <<'EOF'
set -eu
umask 077
state="$1"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
plain() { [ -f "$1" ] && [ ! -L "$1" ]; }
folder() { [ -d "$1" ] && [ ! -L "$1" ]; }
from_state=""
if folder "$state"; then
  for db in accounts icons reviews conversations leaderboards stats module-requests; do
    if plain "$state/$db.sqlite"; then sqlite3 "$state/$db.sqlite" ".backup '$work/$db.sqlite'" < /dev/null; fi
  done
  if folder "$state/catalog" && plain "$state/catalog/catalog.sqlite"; then
    mkdir "$work/catalog"
    sqlite3 "$state/catalog/catalog.sqlite" ".backup '$work/catalog/catalog.sqlite'" < /dev/null
    if folder "$state/catalog/zips"; then from_state="./catalog/zips"; fi
    if folder "$state/catalog/lists"; then from_state="$from_state ./catalog/lists"; fi
  fi
fi
# The zips are read where they are (no copy on disk first); the archive's paths are the same either way.
# shellcheck disable=SC2086
tar -czf - -C "$work" . ${from_state:+-C "$state" $from_state}
EOF
)
runuser -u tavora-api -- env -i PATH=/usr/bin:/bin LC_ALL=C TMPDIR=/var/tmp sh -c "$collect" sh "$state" > "$out.part"
# Only a whole archive is kept: a stream cut short (or anything but gzip) fails here and is removed.
gzip -t "$out.part"
mv -f "$out.part" "$out"
# Up to 7 days (the privacy page): anything older than 6 days 23 hours goes, so 7 daily copies remain, never one a week old.
find "$dir" -maxdepth 1 -type f -name 'tavora-api-*.tar.gz' -mmin +10020 -delete

# Tavora Admin shows when the last backup finished: one line with the time, readable by the service (the backups themselves are not).
# Written as the service's user, never as root: the folder is the service's, and a link in it must not make root write elsewhere.
# Written next to it and renamed: an older root-owned copy can be replaced (the folder is the service's), not opened.
runuser -u tavora-api -- env -i PATH=/usr/bin:/bin sh -c '[ -d "$2" ] && [ ! -L "$2" ] || exit 0; umask 022; printf "%s\n" "$1" > "$2/last-backup.txt.new" && mv -f "$2/last-backup.txt.new" "$2/last-backup.txt"' sh "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$state"
