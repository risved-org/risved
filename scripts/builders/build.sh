#!/usr/bin/env bash
# Build pre-warmed builder images for Risved.
# Run on install and weekly via cron to pick up upstream security patches.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Building risved-node-builder..."
docker build -t risved-node-builder -f "$SCRIPT_DIR/node.Dockerfile" "$SCRIPT_DIR"

echo "Building risved-bun-builder..."
docker build -t risved-bun-builder -f "$SCRIPT_DIR/bun.Dockerfile" "$SCRIPT_DIR"

echo "Done. Builder images ready."
