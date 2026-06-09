#!/usr/bin/env bash
#
# Build and redeploy jobradar.
#
# Why not just `rm -rf .next && npm run build && pm2 restart`:
# pm2 runs jobradar with autorestart on. The moment you delete .next out from
# under the live `next start`, pm2 relaunches it, it dies instantly with
# "Could not find a production build", and pm2 relaunches it again — a tight
# crash-loop that pins a CPU core. On this 2-core / 2 GB box that starves
# `next build`, so it hangs on "Creating an optimized production build".
#
# Stopping the app first removes the crash-loop, so the build gets the machine.
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Stopping jobradar so it doesn't crash-loop against the build"
pm2 stop jobradar || true

# shelfsense-dev runs `next dev`, a file-watcher that pins both cores of this
# 2-core box. Leaving it up makes `next build` swap and crawl (~7 min). Pause it
# for the build and bring it back after.
echo "==> Pausing shelfsense-dev to free the cores for the build"
pm2 stop shelfsense-dev || true

echo "==> Clean build"
rm -rf .next
npm run build

echo "==> Starting jobradar"
pm2 restart jobradar --update-env

echo "==> Resuming shelfsense-dev"
pm2 restart shelfsense-dev --update-env || true

echo "==> Done"
pm2 status jobradar
