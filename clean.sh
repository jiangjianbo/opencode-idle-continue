#!/usr/bin/env bash
set -euo pipefail

PLUGIN_DIR=".opencode/plugins/idle-continue"

if [ -d "$PLUGIN_DIR" ]; then
  rm -rf "$PLUGIN_DIR"
  echo "[clean] Deleted $PLUGIN_DIR"
else
  echo "[clean] $PLUGIN_DIR not found, nothing to clean"
fi

if [ -d ".log" ]; then
  rm -rf .log
  echo "[clean] Deleted .log/"
fi

read -p "Reset .opencode/opencode.json plugin entries? (y/N) " yn
if [ "$yn" = "y" ]; then
  cat > .opencode/opencode.json << 'ENDJSON'
{
  "plugin": [],
  "$schema": "https://opencode.ai/config.json"
}
ENDJSON
  echo "[clean] Reset .opencode/opencode.json"
fi
