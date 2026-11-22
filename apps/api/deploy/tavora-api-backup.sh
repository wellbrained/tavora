#!/usr/bin/env bash
# Daily backup of the Tavora service's own data (accounts, icons, reviews, conversations, leaderboards, stats,
# module-requests and activity databases, and the module catalog: its database, zips, pictures and signed lists), started by
# tavora-api-backup.timer. Consistent copies (SQLite's backup, safe while the service runs) go into /srv/tavora-api/backups;
# 7 days are kept, as the privacy page says. No secrets: production.env (the Brevo key, the admin token) and
# module-requests.salt are never part of it (a new salt only lets each network vote once more). The maintainer copies them
# off the server. The users' cloud copies (copies.sqlite) are left out on purpose (decided 2026-10-19): they are on the
# users' PCs, which upload again.
#
# Who does what: /var/lib/tavora-api is the service's own folder, so code running as the service decides what is in it
# (a file, a link, a database with a crafted journal). Everything that opens or parses it therefore runs as tavora-api:
# sqlite3 and tar, which streams the archive to stdout, and the gzip check of the result. Root only counts the bytes of
# that stream into its own folder, /srv/tavora-api/backups (root, mode 700; each archive root, mode 600), where the service
# can neither read nor change a backup, and removes the old ones there. Root never opens a path in the service's folder
# and never parses a byte the service chose.
set -euo pipefail
umask 077
state=/var/lib/tavora-api
dir=/srv/tavora-api/backups
mkdir -p "$dir"
chmod 700 "$dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="$dir/tavora-api-$stamp.tar.gz"
trap 'rm -f "$out.part"' EXIT
# A backup may take at most half the free space on its disk, so a state folder filled on purpose can't fill the disk.
free_kb=$(df -Pk "$dir" | awk 'NR == 2 { print $4 }')
cap=$(( free_kb * 1024 / 2 ))

# Run as tavora-api, with an empty environment: copies the databases into a folder of its own, then writes one .tar.gz to
# stdout with them and the catalog's zips, pictures and lists. Links are never followed (-f and -d with ! -L; tar keeps a
# link as a link). The catalog: its database, then its files. A zip is written before its row, and never changed, so every
# row backed up has its zip.
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
  for db in accounts icons reviews conversations leaderboards stats module-requests activity; do
    if plain "$state/$db.sqlite"; then sqlite3 "$state/$db.sqlite" ".backup '$work/$db.sqlite'" < /dev/null; fi
  done
  if folder "$state/catalog" && plain "$state/catalog/catalog.sqlite"; then
    mkdir "$work/catalog"
    sqlite3 "$state/catalog/catalog.sqlite" ".backup '$work/catalog/catalog.sqlite'" < /dev/null
    for files in zips pictures lists; do
      if folder "$state/catalog/$files"; then from_state="$from_state ./catalog/$files"; fi
    done
  fi
fi
# The catalog's files are read where they are (no copy on disk first); the archive's paths are the same either way.
# tar's exit 1 only says a file changed while it was read (a picture replaced): the archive is still whole, so the day's
# backup stands. Anything worse (2) fails it.
status=0
# shellcheck disable=SC2086
tar -czf - -C "$work" . ${from_state:+-C "$state" $from_state} || status=$?
[ "$status" -le 1 ]
EOF
)
set +e
runuser -u tavora-api -- env -i PATH=/usr/bin:/bin LC_ALL=C TMPDIR=/var/tmp sh -c "$collect" sh "$state" | head -c "$(( cap + 1 ))" > "$out.part"
statuses=("${PIPESTATUS[@]}")
set -e
size=$(stat -c %s "$out.part")
if (( size > cap )); then echo "The backup would be bigger than half the free space ($cap bytes); nothing was kept." >&2; exit 1; fi
if [[ "${statuses[*]}" != "0 0" ]]; then echo "Making the backup failed (exit ${statuses[*]}); nothing was kept." >&2; exit 1; fi
# Only a whole archive is kept: a stream cut short (or anything but gzip) fails here. Checked as the service's user too,
# on stdin, so root opens the file (its own) but never parses it.
runuser -u tavora-api -- env -i PATH=/usr/bin:/bin gzip -t < "$out.part"
mv -f "$out.part" "$out"
# Up to 7 days (the privacy page): anything older than 6 days 23 hours goes, so 7 daily copies remain, never one a week old.
find "$dir" -maxdepth 1 -type f -name 'tavora-api-*.tar.gz' -mmin +10020 -delete

# Tavora Admin shows when the last backup finished: one line with the time, readable by the service (the backups themselves are not).
# Written as the service's user, never as root: the folder is the service's, and a link in it must not make root write elsewhere.
# Written next to it and renamed: an older root-owned copy can be replaced (the folder is the service's), not opened.
runuser -u tavora-api -- env -i PATH=/usr/bin:/bin sh -c '[ -d "$2" ] && [ ! -L "$2" ] || exit 0; umask 022; printf "%s\n" "$1" > "$2/last-backup.txt.new" && mv -f "$2/last-backup.txt.new" "$2/last-backup.txt"' sh "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$state"
