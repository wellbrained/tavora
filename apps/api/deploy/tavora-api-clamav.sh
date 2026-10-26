#!/usr/bin/env bash
# For the maintainer, on the server (ssh -t): sets up ClamAV for the virus scan every new catalog version goes
# through (review before listing, decided 2026-10-26). Until it is set up, every new version waits for review,
# because a scan that did not run is never a clean one. Run it once; running it again is harmless.
#
#   tavora-api-clamav          installs clamav-daemon and its updater, lets the service reach clamd, and restarts the service
#   tavora-api-clamav status   shows whether clamd answers and which signature database it has
#
# It installs two Debian/Ubuntu packages (clamav-daemon, clamav-freshclam) that need about 1.2 GB of memory
# while clamd loads its signatures (it stays around 1 GB). The service itself keeps its 256 MB limit: it only talks
# to clamd over its socket.
set -euo pipefail
socket=/var/run/clamav/clamd.ctl

case "${1:-}" in
  status)
    systemctl is-active clamav-daemon || true
    if [[ -S "$socket" ]]; then
      printf 'PING\n' | timeout 5 socat - "UNIX-CONNECT:$socket" 2>/dev/null || echo 'clamd did not answer'
    else
      echo "No clamd socket at $socket"
    fi
    clamscan --version 2>/dev/null || true
    grep -E '^(CLAMD_|CLAMSCAN_)' /srv/tavora-api/shared/production.env 2>/dev/null || echo 'The service has no ClamAV setting yet.'
    exit 0
    ;;
  '') ;;
  *) echo 'Usage: tavora-api-clamav [status]'; exit 2 ;;
esac

[[ -d /srv/tavora-api/shared ]] || { echo 'Deploy the service first (the shared folder is missing).'; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq clamav-daemon clamav-freshclam socat
# The first signature download; freshclam keeps them up to date from then on.
systemctl stop clamav-freshclam || true
freshclam --quiet || echo 'freshclam could not download the signatures yet; the updater service will retry.'
systemctl enable --now clamav-freshclam
systemctl enable --now clamav-daemon
# The service's user reads clamd's socket through the clamav group (picked up when the service restarts).
usermod -aG clamav tavora-api
# clamd needs a moment to load its signatures before it answers.
for _ in $(seq 1 60); do [[ -S "$socket" ]] && printf 'PING\n' | timeout 3 socat - "UNIX-CONNECT:$socket" 2>/dev/null | grep -q PONG && break; sleep 2; done
printf 'PING\n' | timeout 3 socat - "UNIX-CONNECT:$socket" 2>/dev/null | grep -q PONG || { echo 'clamd is not answering yet; check: journalctl -u clamav-daemon'; exit 1; }

# Tell the service where it is (the other settings in the file stay).
/usr/local/sbin/tavora-api-set-setting clamav
