#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# ============================================================
# Project root detection
# Walks upward from CWD to find the first directory containing
# any AI agent config directory or file. Stops before root.
# ============================================================
AI_AGENT_DIRS=(
  ".opencode" ".claude" ".cursor" ".windsurf" ".continue" ".github" ".copilot"
)
AI_AGENT_FILES=(
  "agents.md" "AGENTS.md" "claude.md" "CLAUDE.md" ".cursorrules" ".windsurfrules"
  "continue.json" "continue.md" "COPILOT_INSTRUCTIONS.md"
)

find_project_root() {
  local dir
  dir="$(cd "$1" 2>/dev/null && pwd)" || return 1

  while [ "$dir" != "/" ]; do
    for marker in "${AI_AGENT_DIRS[@]}"; do
      if [ -d "$dir/$marker" ]; then
        echo "$dir"
        return 0
      fi
    done
    for marker in "${AI_AGENT_FILES[@]}"; do
      if [ -f "$dir/$marker" ]; then
        echo "$dir"
        return 0
      fi
    done
    dir="$(dirname "$dir")"
  done

  return 1
}

ROOT="$(find_project_root "$(pwd)")" || {
  echo "[install] Warning: Could not find project root (no AI agent config detected)."
  echo "[install] Falling back to current directory."
  ROOT="$(pwd)"
}

OPENCODE_DIR="$ROOT/.opencode"
PLUGIN_DIR="$OPENCODE_DIR/plugins/idle-continue"
CONFIG_PATH="$OPENCODE_DIR/opencode.json"

# Ensure .opencode/ directory exists
mkdir -p "$OPENCODE_DIR"

echo "[install] Building opencode-idle-continue ..."

# Step 1: Build to dist/ (from script dir, where source code lives)
cd "$SCRIPT_DIR"
npm run build

echo "[install] Build complete. Packing npm package ..."

# Step 2: Create npm tarball from dist/
PACKAGE_NAME="opencode-idle-continue-$(node -p "require('./package.json').version").tgz"
cd "$SCRIPT_DIR/dist"
npm pack --pack-destination "$SCRIPT_DIR/dist" 2>/dev/null
cd "$SCRIPT_DIR"

echo "[install] Package created: dist/$PACKAGE_NAME"

# Step 3: Install to project root .opencode/plugins/idle-continue/
echo "[install] Installing plugin to $PLUGIN_DIR ..."
mkdir -p "$PLUGIN_DIR"
cp -R "$SCRIPT_DIR/dist/"* "$PLUGIN_DIR/"
rm -f "$PLUGIN_DIR/package.tgz" 2>/dev/null

# Copy root package.json for npm metadata so OpenCode can resolve @opencode-ai/plugin
cp "$SCRIPT_DIR/package.json" "$PLUGIN_DIR/root-package.json"

# Step 4: Ensure .opencode/ has its own node_modules with @opencode-ai/plugin
if [ ! -d "$OPENCODE_DIR/node_modules/@opencode-ai/plugin" ]; then
  echo "[install] Installing @opencode-ai/plugin in .opencode/ ..."
  cd "$OPENCODE_DIR"
  echo '{"name":"opencode-config","version":"1.0.0"}' > package.json
  npm install @opencode-ai/plugin 2>/dev/null
  cd "$SCRIPT_DIR"
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
echo "[install] Project root: $ROOT"
echo "[install] Plugin:  $PLUGIN_DIR"
echo "[install] Config:  $CONFIG_PATH"
echo "[install] Package: dist/$PACKAGE_NAME"
echo "[install] Restart opencode to load the plugin."
