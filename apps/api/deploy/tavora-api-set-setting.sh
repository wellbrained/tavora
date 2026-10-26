#!/usr/bin/env bash
# Interactive, for the maintainer to run on the server (ssh -t): sets one of the service's
# settings in /srv/tavora-api/shared/production.env without touching the others,
# and restarts the service.
#
#   tavora-api-set-setting.sh takedown [address]
#                                            where publishers ask for an icon to be removed
#                                            (an email address or a link); hosted icons are
#                                            only served while it is set
#   tavora-api-set-setting.sh admin-token    makes a new token for the review page and prints
#                                            it once; it is stored nowhere else, so save it
#   tavora-api-set-setting.sh maintainer-email [address]
#                                            who hears when the module catalog is full
#   tavora-api-set-setting.sh clamav         tells the service where ClamAV's clamd socket is, for the virus scan of new
#                                            catalog versions (tavora-api-clamav installs ClamAV and runs this)
#   tavora-api-set-setting.sh brevo-key      asks for the Brevo API key (not shown while typed);
#                                            the service sends sign-in codes with it
#
# Nothing here passes through an assistant.
set -euo pipefail
file=/srv/tavora-api/shared/production.env
[[ -d /srv/tavora-api/shared ]] || { echo 'Deploy the service first (the shared folder is missing).'; exit 1; }

set_var() {
  local name="$1" value="$2" tmp
  umask 077
  tmp="$(mktemp /srv/tavora-api/shared/.env.XXXXXX)"
  { [[ -f "$file" ]] && grep -v "^${name}=" "$file" || true; printf '%s=%s\n' "$name" "$value"; } > "$tmp"
  chown root:tavora-api "$tmp"
  chmod 640 "$tmp"
  mv -f "$tmp" "$file"
}

case "${1:-}" in
  takedown)
    contact="${2:-}"
    [[ -n "$contact" ]] || read -rp 'Takedown contact (an email address or a link): ' contact
    # Text piped from Windows PowerShell can start with a byte-order mark: drop it with the whitespace.
    contact="$(printf '%s' "$contact" | LC_ALL=C sed 's/^\xef\xbb\xbf//' | tr -d '[:space:]')"
    # Letters, digits and . _ - @ : / ? = & % + ~ # only, so nothing can end up in the shell or the env file as code.
    case "$contact" in *[!A-Za-z0-9._@:/?=\&%+~#-]*) contact="" ;; esac
    (( ${#contact} >= 3 && ${#contact} <= 200 )) || { echo 'That does not look like an address or a link (letters, digits and . _ - @ : / ? = & % + ~ # only). Nothing was saved.'; exit 1; }
    set_var TAKEDOWN_CONTACT "$contact"
    shown="$contact"
    ;;
  maintainer-email)
    email="${2:-}"
    [[ -n "$email" ]] || read -rp 'Maintainer email (told when the module catalog is full): ' email
    email="$(printf '%s' "$email" | LC_ALL=C sed 's/^\xef\xbb\xbf//' | tr -d '[:space:]')"
    # One plain address: letters, digits and . _ + - with a single @.
    [[ "$email" =~ ^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] && (( ${#email} <= 200 )) || { echo 'That does not look like an email address. Nothing was saved.'; exit 1; }
    set_var MAINTAINER_EMAIL "$email"
    shown="$email"
    ;;
  brevo-key)
    read -rsp 'Brevo API key (not shown): ' key; echo
    key="$(printf '%s' "$key" | LC_ALL=C sed 's/^\xef\xbb\xbf//' | tr -d '[:space:]')"
    # Brevo's keys are letters, digits and dashes (xkeysib-...); anything else is not saved.
    case "$key" in *[!A-Za-z0-9-]*) key="" ;; esac
    (( ${#key} >= 20 && ${#key} <= 200 )) || { echo 'That does not look like a Brevo API key (xkeysib-...). Nothing was saved.'; exit 1; }
    set_var BREVO_API_KEY "$key"
    shown='the Brevo API key'
    ;;
  clamav)
    set_var CLAMD_SOCKET /var/run/clamav/clamd.ctl
    shown='the ClamAV socket'
    ;;
  admin-token)
    token="$(openssl rand -hex 24)"
    set_var ADMIN_TOKEN "$token"
    shown='a new admin token'
    ;;
  *)
    echo 'Usage: tavora-api-set-setting.sh takedown [address] | maintainer-email [address] | admin-token | brevo-key | clamav'
    exit 2
    ;;
esac

systemctl restart tavora-api
sleep 2
systemctl is-active --quiet tavora-api && echo "Saved ($shown). Service restarted and running." || { echo 'Service is not running; check: journalctl -u tavora-api'; exit 1; }
if [[ "${1:-}" == admin-token ]]; then
  echo
  echo "Admin token (shown once, save it now):"
  echo "$token"
fi
journalctl -u tavora-api -n 8 --no-pager | grep -E 'TAKEDOWN_CONTACT|MAINTAINER_EMAIL|ADMIN_TOKEN|review page|accounts|email|[Vv]irus scan' || true