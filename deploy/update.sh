#!/usr/bin/env bash
# Pull the latest game from GitHub and restart it. Run on the VPS as root:
#   bash /opt/prism-siege/app/deploy/update.sh
# The portal and the Caddy routing that sends treasurepast.com/prism-siege/ here live in the
# treasurepast-site repo and are updated with its own update.sh.
set -euo pipefail
cd /opt/prism-siege/app

sudo -H -u prism git pull --ff-only
if [ -f package-lock.json ]; then sudo -H -u prism npm ci --omit=dev; fi

install -m 644 deploy/prism-siege.service /etc/systemd/system/prism-siege.service
systemctl daemon-reload
systemctl restart prism-siege

sleep 1
curl -fsS http://127.0.0.1:3010/healthz > /dev/null && echo "Prism Siege is up: https://treasurepast.com/prism-siege/"
