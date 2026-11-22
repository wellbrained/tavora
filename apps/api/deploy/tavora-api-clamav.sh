#!/usr/bin/env bash
# For the maintainer, on the server (ssh -t): sets up ClamAV for the virus scan every new catalog version goes
# through (review before listing, decided 2026-10-26). Until it is set up, every new version waits for review,
# because a scan that did not run is never a clean one. Run it once; running it again is harmless.
#
#   tavora-api-clamav          installs clamav-daemon and its updater, starts the clamd filter, and restarts the service
#   tavora-api-clamav status   shows whether clamd and the filter answer, and which signature database clamd has
#
# It installs two Debian/Ubuntu packages (clamav-daemon, clamav-freshclam) that need about 1.2 GB of memory
# while clamd loads its signatures (it stays around 1 GB). The service itself keeps its 256 MB limit: it only talks
# to clamd over a socket.
#
# The service never reaches clamd's own socket: clamd takes any command there (SCAN a path on the server, RELOAD,
# SHUTDOWN) and has no setting to turn them off. It talks to tavora-clamd-filter instead (installed by the server
# setup), which passes on only INSTREAM, PING and VERSION. clamd's socket is open to the clamav group only (mode 660; Debian
# makes it 666), the service's user is not in that group, and the service's unit hides /run/clamav from it too: so neither
# the service nor anything else that runs as its user (tavora-api-catalog, the backup) can reach clamd itself.
set -euo pipefail
clamd=/run/clamav/clamd.ctl
filter=/run/tavora-clamd/clamd.sock
conf=/etc/clamav/clamd.conf

# One PING in clamd's newline form (nPING), which both clamd and the filter take; the filter refuses a bare PING.
answers() { printf 'nPING\n' | timeout 5 socat - "UNIX-CONNECT:$1" 2>/dev/null | grep -q PONG; }
# clamd's socket as it must be: "660 clamav" (mode and group).
socket_mode() { stat -c '%a %G' "$clamd" 2>/dev/null || echo missing; }

case "${1:-}" in
  status)
    systemctl is-active clamav-daemon || true
    if [[ -S "$clamd" ]]; then answers "$clamd" && echo 'clamd answers' || echo 'clamd did not answer'; else echo "No clamd socket at $clamd"; fi
    if [[ "$(socket_mode)" == '660 clamav' ]]; then echo "clamd's socket is open to the clamav group only."; else echo "Warning: clamd's socket is $(socket_mode), not 660 clamav: run tavora-api-clamav again."; fi
    systemctl is-active tavora-clamd-filter || true
    if [[ -S "$filter" ]]; then answers "$filter" && echo 'The filter answers' || echo 'The filter did not answer'; else echo "No filter socket at $filter"; fi
    if id -nG tavora-api 2>/dev/null | tr ' ' '\n' | grep -qx clamav; then echo 'Warning: tavora-api is still in the clamav group; run tavora-api-clamav again.'; fi
    pid="$(systemctl show -P MainPID tavora-api 2>/dev/null || echo 0)"
    if [[ "$pid" =~ ^[1-9][0-9]*$ ]]; then
      if nsenter --mount="/proc/$pid/ns/mnt" -- test -e "$clamd" 2>/dev/null; then echo 'Warning: the service can still see clamd'"'"'s own socket; restart it (systemctl restart tavora-api).'; else echo 'The service sees only the filter.'; fi
    fi
    clamscan --version 2>/dev/null || true
    grep -E '^(CLAMD_|CLAMSCAN_)' /srv/tavora-api/shared/production.env 2>/dev/null || echo 'The service has no ClamAV setting yet.'
    exit 0
    ;;
  '') ;;
  *) echo 'Usage: tavora-api-clamav [status]'; exit 2 ;;
esac

[[ -d /srv/tavora-api/shared ]] || { echo 'Deploy the service first (the shared folder is missing).'; exit 1; }
[[ -f /usr/local/lib/tavora/tavora-clamd-filter.mjs && -f /etc/systemd/system/tavora-clamd-filter.service ]] || { echo 'The clamd filter is not installed; run the server setup first (deploy/README.md).'; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq clamav-daemon clamav-freshclam socat
# clamd on a TCP port would be open to the service (it may reach the network) and to every other program here.
if grep -qiE '^[[:space:]]*TCPSocket[[:space:]]' /etc/clamav/clamd.conf 2>/dev/null; then
  echo 'clamd listens on a TCP port (TCPSocket in /etc/clamav/clamd.conf). Turn that off first: the service must reach clamd only through the filter.'
  exit 1
fi
# The first signature download; freshclam keeps them up to date from then on.
systemctl stop clamav-freshclam || true
freshclam --quiet || echo 'freshclam could not download the signatures yet; the updater service will retry.'
systemctl enable --now clamav-freshclam
# clamd's socket for the clamav group only. Debian writes clamd.conf from debconf (and again on upgrades), so both are set.
printf '%s\n' 'clamav-daemon clamav-daemon/LocalSocketGroup string clamav' 'clamav-daemon clamav-daemon/LocalSocketMode string 660' | debconf-set-selections 2>/dev/null || true
set_conf() { # <name> <value>: the one line for <name> in clamd.conf, replaced or added
  if grep -qE "^[[:space:]]*$1[[:space:]]" "$conf"; then sed -i -E "s|^[[:space:]]*$1[[:space:]].*|$1 $2|" "$conf"; else printf '%s %s\n' "$1" "$2" >> "$conf"; fi
}
before_conf="$(sha256sum "$conf")"
set_conf LocalSocketGroup clamav
set_conf LocalSocketMode 660
systemctl enable --now clamav-daemon
if [[ "$(sha256sum "$conf")" != "$before_conf" ]]; then systemctl restart clamav-daemon; echo "clamd's socket is now for the clamav group only."; fi
# Earlier versions of this script put the service's user in the clamav group, for clamd's socket. It needs the filter only.
if id -nG tavora-api 2>/dev/null | tr ' ' '\n' | grep -qx clamav; then gpasswd -d tavora-api clamav >/dev/null; echo 'Took tavora-api out of the clamav group.'; fi
# clamd needs a moment to load its signatures before it answers.
for _ in $(seq 1 60); do [[ -S "$clamd" ]] && answers "$clamd" && break; sleep 2; done
answers "$clamd" || { echo 'clamd is not answering yet; check: journalctl -u clamav-daemon'; exit 1; }
[[ "$(socket_mode)" == '660 clamav' ]] || { echo "clamd's socket is $(socket_mode), not 660 clamav; check LocalSocketMode and LocalSocketGroup in $conf."; exit 1; }
systemctl enable tavora-clamd-filter >/dev/null
systemctl restart tavora-clamd-filter
for _ in $(seq 1 10); do [[ -S "$filter" ]] && answers "$filter" && break; sleep 1; done
answers "$filter" || { echo 'The clamd filter is not answering; check: journalctl -u tavora-clamd-filter'; exit 1; }

# Tell the service where it is (the other settings in the file stay); this restarts it, so its unit hides clamd's socket again.
/usr/local/sbin/tavora-api-set-setting clamav
