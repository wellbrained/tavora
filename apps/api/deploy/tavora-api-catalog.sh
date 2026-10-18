#!/usr/bin/env bash
# For the maintainer, on the server: adds community modules to the catalog by hand, next to what
# publishers upload with tavora-pack publish. It runs the release's catalog.mjs as the service's user, so
# the catalog's files stay the service's own. The zip is read from stdin, so it can sit anywhere root can read.
#
#   tavora-api-catalog add <module.zip>     a zip packed and signed with tavora-pack
#   tavora-api-catalog delist <module id>   takes a module out of the catalog; its versions are kept
#   tavora-api-catalog relist <module id>
#   tavora-api-catalog list
#   tavora-api-catalog set-list <revocations|blocks|successions> <file.json>
#                                           a list signed offline with pnpm tavora-catalog-sign
set -euo pipefail
run() { runuser -u tavora-api -- env TAVORA_STATE_DIR=/var/lib/tavora-api /usr/local/bin/node --no-warnings /srv/tavora-api/current/catalog.mjs "$@"; }
case "${1:-}" in
  add)
    [[ $# -eq 2 && -f "$2" ]] || { echo 'Usage: tavora-api-catalog add <module.zip>'; exit 2; }
    run add - < "$2"
    ;;
  set-list)
    [[ $# -eq 3 && -f "$3" ]] || { echo 'Usage: tavora-api-catalog set-list <revocations|blocks|successions> <file.json>'; exit 2; }
    run set-list "$2" - < "$3"
    ;;
  *) run "$@" ;;
esac
