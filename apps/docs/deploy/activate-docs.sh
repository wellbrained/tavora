#!/usr/bin/env bash
# Runs on the server: unpacks an uploaded docs build into a new release,
# switches /srv/tavora-docs/current to it and rolls back if the site stops answering.
set -euo pipefail
release="${1:-}"
[[ "$release" =~ ^[0-9]{14}-[a-f0-9]{12}$ ]] || { echo 'Invalid release'; exit 1; }
root=/srv/tavora-docs
# Uploaded by Deploy-Docs.ps1 into root's own home (mode 0700), never /tmp (security review, finding 6).
incoming=/root/tavora-incoming/docs
[[ -d "$incoming" && ! -L "$incoming" && "$(stat -c %u "$incoming")" == 0 ]] || { echo "$incoming is missing or not root's"; exit 1; }
archive="$incoming/tavora-docs-$release.tar.gz"
install -d -m 755 "$root/releases"
previous="$(readlink "$root/current" || true)"
target="$root/releases/$release"
[[ ! -e "$target" ]] || { echo 'Release exists'; exit 1; }
install -d -m 755 "$target"
tar -xzf "$archive" -C "$target"
rm -rf "$incoming"
find "$target" -type d -exec chmod 755 {} +
find "$target" -type f -exec chmod 644 {} +
ln -sfn "$target" "$root/current-next"
mv -Tf "$root/current-next" "$root/current"
if ! curl --fail --silent --show-error --max-time 20 https://docs.mytavora.app/ -o /dev/null; then
  if [[ -n "$previous" ]]; then
    ln -sfn "$previous" "$root/current-next"
    mv -Tf "$root/current-next" "$root/current"
    echo 'Health check failed; restored previous release'
  else
    echo 'Health check failed; no previous release to restore'
  fi
  exit 1
fi
# Keep the five newest releases for rollback.
ls -1dt "$root"/releases/*/ | tail -n +6 | xargs -r rm -rf
printf 'Published %s at https://docs.mytavora.app/\n' "$release"
