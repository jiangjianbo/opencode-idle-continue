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
  echo '{"name":"opencode-config","version":"1.0.0"}' > package.json
  npm install @opencode-ai/plugin 2>/dev/null
  cd "$PROJECT_ROOT"
fi

# Step 5: Update opencode.json
if [ ! -f "$CONFIG_PATH" ]; then
  echo "{}" > "$CONFIG_PATH"
fi

PLUGIN_REF="./plugins/idle-continue/index.js"
# Create a temporary Node.js script to avoid shell escaping issues
cat > /tmp/update_opencode_config.js << 'EOF'
const fs = require('fs');
const path = require('path');

const configDir = process.argv[2];
const configPath = path.join(configDir, 'opencode.json');
const pluginRef = process.argv[3];

let cfg = {};
if (fs.existsSync(configPath)) {
  cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

cfg.plugin = cfg.plugin || [];
if (!cfg.plugin.includes(pluginRef)) {
  cfg.plugin.push(pluginRef);
}
cfg['$schema'] = 'https://opencode.ai/config.json';
fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n');
console.log('Config updated:', configPath);
EOF

node /tmp/update_opencode_config.js "$OPENCODE_DIR" "$PLUGIN_REF"

echo ""
echo "[install] === Install complete ==="
echo "[install] Plugin:  $PLUGIN_DIR"
echo "[install] Config:  $CONFIG_PATH"
echo "[install] Package: dist/$PACKAGE_NAME"
echo "[install] Restart opencode to load the plugin."
