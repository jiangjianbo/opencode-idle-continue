#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
OPENCODE_DIR="$PROJECT_ROOT/.opencode"
PLUGIN_DIR="$OPENCODE_DIR/plugins/idle-continue"
CONFIG_PATH="$OPENCODE_DIR/opencode.json"

echo "[install] Building opencode-idle-continue ..."

# Step 1: Build to dist/ (supports both npm and bun)
cd "$PROJECT_ROOT"
npm run build

echo "[install] Build complete. Packing npm package ..."

# Step 2: Create npm tarball from dist/
PACKAGE_NAME="opencode-idle-continue-$(node -p "require('./package.json').version").tgz"
cd "$PROJECT_ROOT/dist"
npm pack --pack-destination "$PROJECT_ROOT/dist" 2>/dev/null
cd "$PROJECT_ROOT"

echo "[install] Package created: dist/$PACKAGE_NAME"

# Step 3: Install to .opencode/plugins/idle-continue/
echo "[install] Installing plugin to $PLUGIN_DIR ..."
mkdir -p "$PLUGIN_DIR"
cp -R "$PROJECT_ROOT/dist/"* "$PLUGIN_DIR/"
rm -f "$PLUGIN_DIR/package.tgz" 2>/dev/null

# Copy root package.json for npm metadata so OpenCode can resolve @opencode-ai/plugin
cp "$PROJECT_ROOT/package.json" "$PLUGIN_DIR/root-package.json"

# Step 4: Ensure .opencode/ has its own node_modules with @opencode-ai/plugin
if [ ! -d "$OPENCODE_DIR/node_modules/@opencode-ai/plugin" ]; then
  echo "[install] Installing @opencode-ai/plugin in .opencode/ ..."
  cd "$OPENCODE_DIR"
  npm init -y 2>/dev/null
  npm install @opencode-ai/plugin 2>/dev/null
  cd "$PROJECT_ROOT"
fi

# Step 5: Update opencode.json
if [ ! -f "$CONFIG_PATH" ]; then
  echo "{}" > "$CONFIG_PATH"
fi

PLUGIN_REF="./plugins/idle-continue/index.js"
node -e "
const fs = require('fs');
let cfg = JSON.parse(fs.readFileSync('$CONFIG_PATH', 'utf-8'));
cfg.plugin = cfg.plugin || [];
if (!cfg.plugin.includes('$PLUGIN_REF')) cfg.plugin.push('$PLUGIN_REF');
cfg['\$schema'] = 'https://opencode.ai/config.json';
fs.writeFileSync('$CONFIG_PATH', JSON.stringify(cfg, null, 2) + '\n');
"

echo ""
echo "[install] === Install complete ==="
echo "[install] Plugin:  $PLUGIN_DIR"
echo "[install] Config:  $CONFIG_PATH"
echo "[install] Package: dist/$PACKAGE_NAME"
echo "[install] Restart opencode to load the plugin."
