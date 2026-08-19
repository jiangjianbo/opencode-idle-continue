#!/usr/bin/env node
import * as fs from 'node:fs';
import * as path from 'node:path';
import packageJson from '../../package.json' with { type: 'json' };
import {
  PLUGIN_NAME,
  PLUGIN_VERSION,
  DEFAULT_PLUGIN_CONFIG,
  getOpencodeConfigDir,
  ensureDir,
  loadJson,
  saveJson,
  findProjectRoot,
  addPluginReference,
  cleanupOldPluginDirectories,
  evictPluginCaches,
} from './install-utils.js';

const { version } = packageJson;

const CONFIG_DIR = getOpencodeConfigDir();
const OPENCODE_CONFIG_PATH = path.join(CONFIG_DIR, 'opencode.json');
const PLUGIN_CONFIG_PATH = path.join(CONFIG_DIR, 'idle-continue.json');

const AI_AGENT_DIRS = [
  '.opencode', '.claude', '.cursor', '.windsurf', '.continue', '.github', '.copilot',
];
const AI_AGENT_FILES = [
  'agents.md', 'AGENTS.md', 'claude.md', 'CLAUDE.md', '.cursorrules', '.windsurfrules',
  'continue.json', 'continue.md', 'COPILOT_INSTRUCTIONS.md',
];

function findProjectRootLocal(startDir) {
  let dir = path.resolve(startDir);

  while (dir !== path.dirname(dir)) {
    for (const marker of AI_AGENT_DIRS) {
      try {
        if (fs.statSync(path.join(dir, marker)).isDirectory()) {
          return dir;
        }
      } catch {}
    }
    for (const marker of AI_AGENT_FILES) {
      try {
        if (fs.statSync(path.join(dir, marker)).isFile()) {
          return dir;
        }
      } catch {}
    }
    dir = path.dirname(dir);
  }

  return null;
}

function printHelp() {
  console.log(`
opencode-idle-continue - OpenCode plugin for automatic task continuation during idle time

Usage: opencode-idle-continue [command] [OPTIONS]

Commands:
  install [system|local|<path>]  Install the plugin to opencode configuration
                                 - system: Install to system config (~/.config/opencode/)
                                 - local:  Install to current project (.opencode/)
                                 - <path>:  Install to specified directory (e.g., e:\\\\work\\\\xxx)
  uninstall [system|local|<path>] Remove the plugin from opencode config
                                 - system: Remove from system config (~/.config/opencode/)
                                 - local:  Remove from current project (.opencode/)
                                 - <path>:  Remove from specified directory
                                 --clean: Also remove plugin config file
  update                          Refresh opencode's plugin cache
  -h, --help                      Show this help message
  -v, --version                   Show version

Configuration:
  System config:  ~/.config/opencode/idle-continue.json
  Local config:   .opencode/idle-continue.json
  Custom prompt:  idle-prompt.md (in project directory)

Examples:
   install examples:
   opencode-idle-continue install system
   opencode-idle-continue install local
   opencode-idle-continue install e:\\\\work\\\\myproject
   opencode-idle-continue install /home/user/project

   update example:
   opencode-idle-continue update

   uninstall examples:
   opencode-idle-continue uninstall system
   opencode-idle-continue uninstall local
   opencode-idle-continue uninstall /home/user/project
   opencode-idle-continue uninstall --clean  # also remove plugin config
  `);
}

async function installToSystem() {
  console.log(`🔧 Installing ${PLUGIN_NAME} v${PLUGIN_VERSION} to system config...\n`);

  ensureDir(CONFIG_DIR);

  let opencodeConfig = loadJson(OPENCODE_CONFIG_PATH);
  if (!opencodeConfig) {
    opencodeConfig = {};
  }

  addPluginReference(opencodeConfig, PLUGIN_NAME, { 
    verbose: true, 
    upgradeMessage: 'Upgrading to global CLI installation...' 
  });

  saveJson(OPENCODE_CONFIG_PATH, opencodeConfig);
  console.log(`✓ OpenCode config: ${OPENCODE_CONFIG_PATH}`);

  if (!fs.existsSync(PLUGIN_CONFIG_PATH)) {
    saveJson(PLUGIN_CONFIG_PATH, DEFAULT_PLUGIN_CONFIG);
    console.log(`✓ Created default plugin config: ${PLUGIN_CONFIG_PATH}`);
  } else {
    console.log(`✓ Plugin config exists: ${PLUGIN_CONFIG_PATH}`);
  }

  cleanupOldPluginDirectories(CONFIG_DIR, { verbose: true });

  const evicted = evictPluginCaches();
  if (evicted.cleared.length > 0) {
    console.log(`✓ Cleared plugin cache: ${evicted.cleared.join(', ')}`);
  }

  console.log('\n🚀 System installation complete!');
  console.log('Restart OpenCode to load the plugin.');
  
  return 0;
}

async function installToLocal() {
  const cwd = process.cwd();

  const root = findProjectRootLocal(cwd);
  if (root) {
    console.log(`🔧 Installing ${PLUGIN_NAME} v${PLUGIN_VERSION} to local project...\n`);
    console.log(`📁 Project root (detected): ${root}\n`);
  } else {
    console.log(`🔧 Installing ${PLUGIN_NAME} v${PLUGIN_VERSION} to local project...\n`);
    console.log(`📁 Project directory: ${cwd}\n`);
  }

  const projectRoot = root || cwd;
  const opencodeDir = path.join(projectRoot, '.opencode');
  ensureDir(opencodeDir);

  const localConfigPath = path.join(opencodeDir, 'opencode.json');
  const pluginConfigPath = path.join(opencodeDir, 'idle-continue.json');

  let opencodeConfig = loadJson(localConfigPath);
  if (!opencodeConfig) {
    opencodeConfig = {};
  }

  addPluginReference(opencodeConfig, PLUGIN_NAME, { 
    verbose: true, 
    upgradeMessage: 'Upgrading to local CLI installation...' 
  });

  saveJson(localConfigPath, opencodeConfig);
  console.log(`✓ Local config: ${localConfigPath}`);

  if (!fs.existsSync(pluginConfigPath)) {
    saveJson(pluginConfigPath, DEFAULT_PLUGIN_CONFIG);
    console.log(`✓ Created default plugin config: ${pluginConfigPath}`);
  } else {
    console.log(`✓ Plugin config exists: ${pluginConfigPath}`);
  }

  cleanupOldPluginDirectories(opencodeDir, { verbose: true });

  console.log('\n🚀 Local installation complete!');
  console.log('Restart OpenCode in this directory to load the plugin.');
  
  return 0;
}

async function installToDir(targetDir) {
  const resolvedDir = path.resolve(targetDir);
  
  if (!fs.existsSync(resolvedDir)) {
    console.error(`✗ Directory does not exist: ${resolvedDir}`);
    return 1;
  }

  console.log(`🔧 Installing ${PLUGIN_NAME} v${PLUGIN_VERSION} to directory...\n`);
  console.log(`📁 Target directory: ${resolvedDir}\n`);

  const opencodeDir = path.join(resolvedDir, '.opencode');
  ensureDir(opencodeDir);

  const localConfigPath = path.join(opencodeDir, 'opencode.json');
  const pluginConfigPath = path.join(opencodeDir, 'idle-continue.json');

  let opencodeConfig = loadJson(localConfigPath);
  if (!opencodeConfig) {
    opencodeConfig = {};
  }

  addPluginReference(opencodeConfig, PLUGIN_NAME, { 
    verbose: true, 
    upgradeMessage: 'Upgrading to local CLI installation...' 
  });

  saveJson(localConfigPath, opencodeConfig);
  console.log(`✓ Config: ${localConfigPath}`);

  if (!fs.existsSync(pluginConfigPath)) {
    saveJson(pluginConfigPath, DEFAULT_PLUGIN_CONFIG);
    console.log(`✓ Created default plugin config: ${pluginConfigPath}`);
  } else {
    console.log(`✓ Plugin config exists: ${pluginConfigPath}`);
  }

  cleanupOldPluginDirectories(opencodeDir, { verbose: true });

  console.log('\n🚀 Installation complete!');
  console.log('Restart OpenCode in this directory to load the plugin.');
  
  return 0;
}

async function install() {
  const args = process.argv.slice(2);
  const installMode = args[1] || 'system';

  if (installMode === 'system') {
    return installToSystem();
  } else if (installMode === 'local') {
    return installToLocal();
  } else {
    return installToDir(installMode);
  }
}

async function update() {
  console.log(`🔄 Refreshing ${PLUGIN_NAME} plugin cache...\n`);
  const result = evictPluginCaches();
  
  if (result.cleared.length > 0) {
    for (const cleared of result.cleared) {
      console.log(`✓ Cleared: ${cleared}`);
    }
    console.log('\nRestart OpenCode to fetch the latest version from npm.');
  }
  
  if (result.failed.length > 0) {
    for (const failed of result.failed) {
      console.error(`✗ Could not clear: ${failed}`);
    }
  }
  
  if (result.cleared.length === 0 && result.failed.length === 0) {
    console.log('No cached plugin found.');
    console.log('Restart OpenCode to fetch the latest version from npm.');
  }
  
  return result.failed.length > 0 ? 1 : 0;
}

async function uninstall() {
  const args = process.argv.slice(2);
  const uninstallMode = args[1] || 'system';

  if (uninstallMode === 'system') {
    return uninstallFromSystem();
  } else if (uninstallMode === 'local') {
    return uninstallFromLocal();
  } else {
    return uninstallFromDir(uninstallMode);
  }
}

async function uninstallFromSystem() {
  console.log(`🗑️  Uninstalling ${PLUGIN_NAME} from system config...\n`);

  let opencodeConfig = loadJson(OPENCODE_CONFIG_PATH);
  
  if (!opencodeConfig) {
    console.log(`⚠ No opencode config found at: ${OPENCODE_CONFIG_PATH}`);
    return 0;
  }

  if (!opencodeConfig.plugin || opencodeConfig.plugin.length === 0) {
    console.log(`⚠ ${PLUGIN_NAME} is not installed.`);
    return 0;
  }

  const filteredPlugins = opencodeConfig.plugin.filter(
    (p) => p !== PLUGIN_NAME && !p.startsWith(`${PLUGIN_NAME}@`)
  );

  if (filteredPlugins.length === opencodeConfig.plugin.length) {
    console.log(`⚠ ${PLUGIN_NAME} is not installed.`);
    return 0;
  }

  opencodeConfig.plugin = filteredPlugins;
  saveJson(OPENCODE_CONFIG_PATH, opencodeConfig);
  console.log(`✓ Removed ${PLUGIN_NAME} from OpenCode plugins`);

  const cleanFlag = process.argv.includes('--clean');
  if (cleanFlag) {
    if (fs.existsSync(PLUGIN_CONFIG_PATH)) {
      fs.unlinkSync(PLUGIN_CONFIG_PATH);
      console.log(`✓ Removed plugin config: ${PLUGIN_CONFIG_PATH}`);
    }
  }

  console.log('\n✅ Uninstall complete!');
  return 0;
}

async function uninstallFromLocal() {
  const cwd = process.cwd();
  const root = findProjectRootLocal(cwd);
  const projectRoot = root || cwd;
  const opencodeDir = path.join(projectRoot, '.opencode');
  const localConfigPath = path.join(opencodeDir, 'opencode.json');
  const pluginConfigPath = path.join(opencodeDir, 'idle-continue.json');

  console.log(`🗑️  Uninstalling ${PLUGIN_NAME} from local project...\n`);
  console.log(`📁 Target directory: ${projectRoot}\n`);

  if (!fs.existsSync(localConfigPath)) {
    console.log(`⚠ No opencode config found at: ${localConfigPath}`);
    return 0;
  }

  let opencodeConfig = loadJson(localConfigPath);
  
  if (!opencodeConfig || !opencodeConfig.plugin || opencodeConfig.plugin.length === 0) {
    console.log(`⚠ ${PLUGIN_NAME} is not installed.`);
    return 0;
  }

  const filteredPlugins = opencodeConfig.plugin.filter(
    (p) => p !== PLUGIN_NAME && !p.startsWith(`${PLUGIN_NAME}@`)
  );

  if (filteredPlugins.length === opencodeConfig.plugin.length) {
    console.log(`⚠ ${PLUGIN_NAME} is not installed.`);
    return 0;
  }

  opencodeConfig.plugin = filteredPlugins;
  saveJson(localConfigPath, opencodeConfig);
  console.log(`✓ Removed ${PLUGIN_NAME} from local plugins`);
  console.log(`✓ Local config: ${localConfigPath}`);

  const cleanFlag = process.argv.includes('--clean');
  if (cleanFlag) {
    if (fs.existsSync(pluginConfigPath)) {
      fs.unlinkSync(pluginConfigPath);
      console.log(`✓ Removed plugin config: ${pluginConfigPath}`);
    }
  }

  console.log('\n✅ Uninstall complete!');
  return 0;
}

async function uninstallFromDir(targetDir) {
  const resolvedDir = path.resolve(targetDir);
  const opencodeDir = path.join(resolvedDir, '.opencode');
  const localConfigPath = path.join(opencodeDir, 'opencode.json');
  const pluginConfigPath = path.join(opencodeDir, 'idle-continue.json');

  console.log(`🗑️  Uninstalling ${PLUGIN_NAME} from directory...\n`);
  console.log(`📁 Target directory: ${resolvedDir}\n`);

  if (!fs.existsSync(localConfigPath)) {
    console.log(`⚠ No opencode config found at: ${localConfigPath}`);
    return 0;
  }

  let opencodeConfig = loadJson(localConfigPath);
  
  if (!opencodeConfig || !opencodeConfig.plugin || opencodeConfig.plugin.length === 0) {
    console.log(`⚠ ${PLUGIN_NAME} is not installed.`);
    return 0;
  }

  const filteredPlugins = opencodeConfig.plugin.filter(
    (p) => p !== PLUGIN_NAME && !p.startsWith(`${PLUGIN_NAME}@`)
  );

  if (filteredPlugins.length === opencodeConfig.plugin.length) {
    console.log(`⚠ ${PLUGIN_NAME} is not installed.`);
    return 0;
  }

  opencodeConfig.plugin = filteredPlugins;
  saveJson(localConfigPath, opencodeConfig);
  console.log(`✓ Removed ${PLUGIN_NAME} from plugins`);
  console.log(`✓ Config: ${localConfigPath}`);

  const cleanFlag = process.argv.includes('--clean');
  if (cleanFlag) {
    if (fs.existsSync(pluginConfigPath)) {
      fs.unlinkSync(pluginConfigPath);
      console.log(`✓ Removed plugin config: ${pluginConfigPath}`);
    }
  }

  console.log('\n✅ Uninstall complete!');
  return 0;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('-v') || args.includes('--version')) {
    console.log(`${PLUGIN_NAME} v${version}`);
    process.exit(0);
  }

  if (args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  const command = args[0] || 'install';

  if (command === 'install') {
    const exitCode = await install();
    process.exit(exitCode);
  } else if (command === 'update') {
    const exitCode = await update();
    process.exit(exitCode);
  } else if (command === 'uninstall') {
    const exitCode = await uninstall();
    process.exit(exitCode);
  } else {
    console.error(`Unknown command: ${command}`);
    console.error('Run with --help for usage information');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});