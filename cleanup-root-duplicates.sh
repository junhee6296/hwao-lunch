#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
rm -rf JS CSS
rm -f index.html qr.html scanner.html admin.html admin_list.html \
  config.js qr_app.js scanner_app.js scanner_bootstrap.js admin_bootstrap.js admin_list_app.js camera.js auth.js admin_app.js \
  common.css qr.css scanner.css admin.css admin_list.css
rm -f cleanup-root-duplicates.sh
