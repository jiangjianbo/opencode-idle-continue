#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Usage: install-local.sh [system|local|path]
#   system - Install to system config (~/.config/opencode/)
#   local  - Install to current project (.opencode/)
#   path   - Install to specified path's .opencode/

INSTALL_MODE="${1:-local}"

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

# Determine installation location based on mode
case "$INSTALL_MODE" in
  system)
    # System-wide installation
    ROOT="$HOME/.config/opencode"
    if [ ! -d "$ROOT" ]; then
      echo "[install] Creating system config directory: $ROOT"
      mkdir -p "$ROOT"
    fi
    ;;
  local)
    # Local project installation
    ROOT="$(find_project_root "$(pwd)")" || {
      echo "[install] Warning: Could not find project root (no AI agent config detected)."
      echo "[install] Falling back to current directory."
      ROOT="$(pwd)"
    }
    ;;
  *)
    # Specific path installation
    if [ -d "$INSTALL_MODE" ]; then
      ROOT="$INSTALL_MODE"
    else
      echo "[install] Error: Path does not exist: $INSTALL_MODE"
      echo "[install] Usage: $0 [system|local|/path/to/project]"
      exit 1
    fi
    ;;
esac

OPENCODE_DIR="$ROOT/.opencode"
PLUGIN_DIR="$OPENCODE_DIR/plugins/idle-continue"
CONFIG_PATH="$OPENCODE_DIR/opencode.json"

# Ensure .opencode/ directory exists
mkdir -p "$OPENCODE_DIR"

echo "[install] Installation mode: $INSTALL_MODE"
echo "[install] Installation root: $ROOT"
echo "[install] Building opencode-idle-continue ..."

# Step 1: Build to dist/ (from script dir, where source code lives)
cd "$SCRIPT_DIR"
npm run build

echo "[install] Build complete. Cleaning up old installation if exists ..."

# Step 2: Clean up old installation
# Remove old plugin directory if it exists
if [ -d "$PLUGIN_DIR" ]; then
  echo "[install] Removing old plugin directory: $PLUGIN_DIR"
  rm -rf "$PLUGIN_DIR"
fi

# Step 3: Install to target location
mkdir -p "$PLUGIN_DIR"
cp -R "$SCRIPT_DIR/dist/"* "$PLUGIN_DIR/"
rm -f "$PLUGIN_DIR/package.tgz" 2>/dev/null

# Copy root package.json for npm metadata so OpenCode can resolve @opencode-ai/plugin
cp "$SCRIPT_DIR/package.json" "$PLUGIN_DIR/root-package.json"

# Step 4: Use shared install-utils to handle config and dependency installation
# Create a temporary Node.js script to use shared install-utils
# Convert SCRIPT_DIR to proper Windows path for Node.js
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" ]]; then
    # Convert Git Bash path to Windows path
    SCRIPT_DIR_WIN=$(cd "$SCRIPT_DIR" && pwd -W)
else
    SCRIPT_DIR_WIN="$SCRIPT_DIR"
fi

cat > /tmp/install_local_helper.mjs << EOF
import { loadJson, saveJson, addPluginReference, cleanupOldPluginDirectories, installOpencodePluginDependency } from 'file:///${SCRIPT_DIR_WIN}/dist/cli/install-utils.js';
import * as path from 'node:path';
import * as fs from 'node:fs';

const openCodeDir = process.argv[2];
const pluginRef = './plugins/idle-continue/index.js';
const configPath = path.join(openCodeDir, 'opencode.json');

// Initialize config if doesn't exist
let opencodeConfig = loadJson(configPath);
if (!opencodeConfig) {
  opencodeConfig = {};
}

// Use shared addPluginReference with local-specific settings
addPluginReference(opencodeConfig, pluginRef, { 
  verbose: true, 
  upgradeMessage: 'Upgrading to local installation...' 
});

// Save config
saveJson(configPath, opencodeConfig);
console.log('[install] ✓ Config updated:', configPath);

// Cleanup old plugin directories using shared function
cleanupOldPluginDirectories(openCodeDir, { verbose: true });

// Install @opencode-ai/plugin dependency using shared function
installOpencodePluginDependency(openCodeDir, { verbose: true });
EOF

cd "$SCRIPT_DIR"
node /tmp/install_local_helper.mjs "$OPENCODE_DIR"
rm -f /tmp/install_local_helper.mjs

echo ""
echo "[install] === Install complete ==="
echo "[install] Installation mode: $INSTALL_MODE"
echo "[install] Installation root: $ROOT"
echo "[install] Plugin location:   $PLUGIN_DIR"
echo "[install] Config file:       $CONFIG_PATH"
if [ "$INSTALL_MODE" = "system" ]; then
  echo "[install] System-wide installation - available for all projects"
else
  echo "[install] Project-specific installation"
fi
echo "[install] Restart opencode to load the plugin."