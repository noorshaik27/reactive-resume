#!/usr/bin/env bash
# Production serve entrypoint for a process supervisor (launchd / pm2 / systemd).
#
# Ensures the externalized deps are linked into the Nitro output (a no-op if
# they already are — needed after every `pnpm build`, which wipes .output),
# then runs the server in the foreground via `exec` so the supervisor tracks
# the node PID directly.
#
# Build is intentionally NOT done here — that's a deploy step (`pnpm build`),
# not something to repeat on every crash-restart. Required env: PORT,
# DATABASE_URL (APP_URL and secrets are read from the repo .env).
set -euo pipefail
cd "$(dirname "$0")/.."

node scripts/relink-output-externals.mjs
exec node apps/web/.output/server/index.mjs
