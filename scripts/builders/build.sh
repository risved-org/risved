#!/usr/bin/env bash
# Build pre-warmed builder images for Risved.
# Run on install and weekly via cron to pick up upstream security patches.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Building risved-node-build (unified Node + Corepack pnpm/yarn + Bun)..."
docker build -t risved-node-build:22 -f "$SCRIPT_DIR/node-build.Dockerfile" "$SCRIPT_DIR"

# The legacy per-manager images below are retained during the migration to the
# unified builder. Once the unified image has shipped through one full Sunday
# rebuild cycle, drop them from this script and delete the registry images
# after the 2-week rollback grace period.
echo "Building risved-node-builder (legacy — remove after migration)..."
docker build -t risved-node-builder -f "$SCRIPT_DIR/node.Dockerfile" "$SCRIPT_DIR"

echo "Building risved-bun-builder (legacy — remove after migration)..."
docker build -t risved-bun-builder -f "$SCRIPT_DIR/bun.Dockerfile" "$SCRIPT_DIR"

echo "Done. Builder images ready."
