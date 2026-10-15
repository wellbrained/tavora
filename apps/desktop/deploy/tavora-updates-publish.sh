#!/usr/bin/env bash
# Runs on the Hetzner server for `pnpm release`: files uploaded to /tmp/tavora-updates-incoming
# become the feed's newest version. The installer and its blockmap go in first and
# latest.yml last (replaced in one step), so nobody ever sees a manifest that points at a
# file that is not there yet. Keeps the three newest versions for differential updates.
set -euo pipefail
version="${1:-}"
mode="${2:-}"
if [[ "$mode" == allow-patch ]]; then
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "Not a version: '$version'"; exit 1; }
else
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.0$ ]] || { echo "Only minor versions (x.y.0) are published, not '$version' (use allow-patch for a one-off)"; exit 1; }
fi
incoming=/tmp/tavora-updates-incoming
root=/srv/tavora-updates
installer="Tavora-Setup-$version.exe"
for f in "$installer" "$installer.blockmap" latest.yml; do
  [[ -s "$incoming/$f" ]] || { echo "Missing upload: $f"; exit 1; }
done
grep -qxF "version: $version" "$incoming/latest.yml" || { echo "latest.yml does not say version $version"; exit 1; }

install -d -m 755 "$root"
previous="$(grep -m1 '^version:' "$root/latest.yml" 2>/dev/null | awk '{print $2}' || true)"

# 1. Versioned files first. They never change once published.
install -m 644 "$incoming/$installer" "$root/$installer.part"
mv -f "$root/$installer.part" "$root/$installer"
install -m 644 "$incoming/$installer.blockmap" "$root/$installer.blockmap"
# 2. The manifest last, replaced atomically; the old one is kept to put back if the feed check fails.
[[ -f "$root/latest.yml" ]] && cp -p "$root/latest.yml" "$root/latest.yml.previous"
install -m 644 "$incoming/latest.yml" "$root/latest.yml.new"
mv -f "$root/latest.yml.new" "$root/latest.yml"
rm -rf "$incoming"

# 3. Check the public feed answers with the new version; put the old manifest back if not.
live="$(curl --fail --silent --show-error --max-time 30 https://updates.mytavora.app/latest.yml | grep -m1 '^version:' | awk '{print $2}' || true)"
if [[ "$live" != "$version" ]]; then
  echo "The feed answers '$live', not $version."
  if [[ -f "$root/latest.yml.previous" ]]; then mv -f "$root/latest.yml.previous" "$root/latest.yml"; echo 'Put the previous latest.yml back.'; fi
  exit 1
fi
rm -f "$root/latest.yml.previous"

# 4. Keep the three newest versions (installers and their blockmaps).
mapfile -t keep < <(ls -1 "$root"/Tavora-Setup-*.exe 2>/dev/null | sed -E 's/.*Tavora-Setup-([0-9.]+)\.exe/\1/' | sort -t. -k1,1nr -k2,2nr -k3,3nr | head -n 3)
for f in "$root"/Tavora-Setup-*.exe "$root"/Tavora-Setup-*.exe.blockmap; do
  [[ -e "$f" ]] || continue
  v="$(basename "$f" | sed -E 's/Tavora-Setup-([0-9.]+)\.exe.*/\1/')"
  printf '%s\n' "${keep[@]}" | grep -qxF "$v" || rm -f "$f"
done
printf 'Published %s at https://updates.mytavora.app/%s (was %s)\n' "$version" "$installer" "${previous:-nothing}"
