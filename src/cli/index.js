#!/usr/bin/env node
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import packageJson from '../package.json' with { type: 'json' };

const { version } = packageJson;

const CONFIG_DIR = getOpencodeConfigDir();
const OPENCODE_CONFIG_PATH = path.join(CONFIG_DIR, 'opencode.json');
const PLUGIN_CONFIG_PATH = path.join(CONFIG_DIR, 'idle-continue.json');

const PLUGIN_NAME = 'opencode-idle-continue';
const PLUGIN_VERSION = packageJson.version;

const DEFAULT_PLUGIN_CONFIG = {
  prompt_file: 'idle-prompt.md',
  watch_files: ['task.md', 'wish-list.md'],
  check_interval_minutes: 30,
  max_idle_cycles: 5,
  enabled: true,
  subagent_enabled: false,
  subagent_agent_type: 'explore',
  subagent_delay_ms: 60_000,
};

function getOpencodeConfigDir() {
  const platform = os.platform();
  
  if (platform === 'win32') {
    return path.join(os.homedir(), '.config', 'opencode');
  } else if (platform === 'darwin') {
    return path.join(os.homedir(), '.config', 'opencode');
  } else {
    return path.join(os.homedir(), '.config', 'opencode');
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadJson(filepath) {
  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    const stripped = content
      .replace(/\\"|"(?:\\"|[^"])*"|(\/\/.*|\/\*[\s\S]*?\*\/)/g, (match, comment) => (comment ? '' : match))
      .replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

function saveJson(filepath, data) {
  fs.writeFileSync(filepath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

function printHelp() {
  console.log(`
opencode-idle-continue - OpenCode plugin for automatic task continuation during idle time

Usage: opencode-idle-continue [command] [OPTIONS]

Commands:
  install [system|local|<path>]  Install the plugin to opencode configuration
                                 - system: Install to system config (~/.config/opencode/)
                                 - local:  Install to current project (.opencode/)
                                 - <path>:  Install to specified directory (e.g., e:\\work\\xxx)
  update                          Refresh opencode's plugin cache
  uninstall                       Remove the plugin from opencode config
  -h, --help                      Show this help message
  -v, --version                   Show version

Configuration:
  System config:  ~/.config/opencode/idle-continue.json
  Local config:   .opencode/idle-continue.json
  Custom prompt:  idle-prompt.md (in project directory)

Examples:
  opencode-idle-continue install system
  opencode-idle-continue install local
  opencode-idle-continue install e:\\work\\myproject
  opencode-idle-continue install /home/user/project
  opencode-idle-continue update
  opencode-idle-continue uninstall
  `);
}

async function installToSystem() {
  console.log(`🔧 Installing ${PLUGIN_NAME} v${PLUGIN_VERSION} to system config...\n`);

  ensureDir(CONFIG_DIR);

  let opencodeConfig = loadJson(OPENCODE_CONFIG_PATH);
  if (!opencodeConfig) {
    opencodeConfig = {};
  }

  if (!opencodeConfig.plugin) {
    opencodeConfig.plugin = [];
  }

  opencodeConfig.plugin = opencodeConfig.plugin.filter(
    (p) => p !== PLUGIN_NAME && !p.startsWith(`${PLUGIN_NAME}@`)
  );
  opencodeConfig.plugin.push(PLUGIN_NAME);

  saveJson(OPENCODE_CONFIG_PATH, opencodeConfig);
  console.log(`✓ Added ${PLUGIN_NAME} to OpenCode plugins`);
  console.log(`✓ OpenCode config: ${OPENCODE_CONFIG_PATH}`);

  if (!fs.existsSync(PLUGIN_CONFIG_PATH)) {
    saveJson(PLUGIN_CONFIG_PATH, DEFAULT_PLUGIN_CONFIG);
    console.log(`✓ Created default plugin config: ${PLUGIN_CONFIG_PATH}`);
  } else {
    console.log(`✓ Plugin config exists: ${PLUGIN_CONFIG_PATH}`);
  }

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
  console.log(`🔧 Installing ${PLUGIN_NAME} v${PLUGIN_VERSION} to local project...\n`);
  console.log(`📁 Project directory: ${cwd}\n`);

  const opencodeDir = path.join(cwd, '.opencode');
  ensureDir(opencodeDir);

  const localConfigPath = path.join(opencodeDir, 'opencode.json');
  const pluginConfigPath = path.join(opencodeDir, 'idle-continue.json');

  let opencodeConfig = loadJson(localConfigPath);
  if (!opencodeConfig) {
    opencodeConfig = {};
  }

  if (!opencodeConfig.plugin) {
    opencodeConfig.plugin = [];
  }

  opencodeConfig.plugin = opencodeConfig.plugin.filter(
    (p) => p !== PLUGIN_NAME && !p.startsWith(`${PLUGIN_NAME}@`)
  );
  opencodeConfig.plugin.push(PLUGIN_NAME);

  saveJson(localConfigPath, opencodeConfig);
  console.log(`✓ Added ${PLUGIN_NAME} to local plugins`);
  console.log(`✓ Local config: ${localConfigPath}`);

  if (!fs.existsSync(pluginConfigPath)) {
    saveJson(pluginConfigPath, DEFAULT_PLUGIN_CONFIG);
    console.log(`✓ Created default plugin config: ${pluginConfigPath}`);
  } else {
    console.log(`✓ Plugin config exists: ${pluginConfigPath}`);
  }

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

  if (!opencodeConfig.plugin) {
    opencodeConfig.plugin = [];
  }

  opencodeConfig.plugin = opencodeConfig.plugin.filter(
    (p) => p !== PLUGIN_NAME && !p.startsWith(`${PLUGIN_NAME}@`)
  );
  opencodeConfig.plugin.push(PLUGIN_NAME);

  saveJson(localConfigPath, opencodeConfig);
  console.log(`✓ Added ${PLUGIN_NAME} to plugins`);
  console.log(`✓ Config: ${localConfigPath}`);

  if (!fs.existsSync(pluginConfigPath)) {
    saveJson(pluginConfigPath, DEFAULT_PLUGIN_CONFIG);
    console.log(`✓ Created default plugin config: ${pluginConfigPath}`);
  } else {
    console.log(`✓ Plugin config exists: ${pluginConfigPath}`);
  }

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
  console.log(`🗑️  Uninstalling ${PLUGIN_NAME}...\n`);

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

function getPluginCachePaths() {
  const home = os.homedir();
  const paths = [];

  const xdgCache = process.env.XDG_CACHE_HOME || path.join(home, '.cache');
  
  paths.push(
    path.join(xdgCache, 'opencode', 'node_modules', PLUGIN_NAME),
    path.join(xdgCache, 'opencode', 'node_modules', `${PLUGIN_NAME}@latest`),
    path.join(xdgCache, 'opencode', 'packages', `${PLUGIN_NAME}@latest`),
    path.join(home, '.config', 'opencode', 'node_modules', PLUGIN_NAME),
  );

  if (os.platform() === 'win32') {
    paths.push(
      path.join(os.homedir(), 'AppData', 'Local', 'opencode', 'node_modules', PLUGIN_NAME),
      path.join(os.homedir(), 'AppData', 'Local', 'opencode', 'node_modules', `${PLUGIN_NAME}@latest`),
    );
  } else if (os.platform() === 'darwin') {
    paths.push(
      path.join(home, 'Library', 'Caches', 'opencode', 'node_modules', PLUGIN_NAME),
      path.join(home, 'Library', 'Caches', 'opencode', 'node_modules', `${PLUGIN_NAME}@latest`),
    );
  }

  return paths;
}

function isSafeCachePath(p) {
  const resolved = path.resolve(p);
  const home = path.resolve(os.homedir());
  
  if (resolved === '/' || resolved === home || resolved.length <= home.length) {
    return false;
  }
  
  const segments = resolved.split(path.sep).filter((s) => s.length > 0);
  if (segments.length < 4) {
    return false;
  }
  
  const leaf = path.basename(resolved);
  if (leaf !== `${PLUGIN_NAME}@latest` && leaf !== PLUGIN_NAME) {
    return false;
  }
  
  const parent = path.basename(path.dirname(resolved));
  if (parent !== 'packages' && parent !== 'node_modules') {
    return false;
  }
  
  const grandparent = path.basename(path.dirname(path.dirname(resolved)));
  if (grandparent !== 'opencode') {
    return false;
  }
  
  return true;
}

function evictPluginCaches() {
  const cleared = [];
  const failed = [];
  
  for (const cachePath of getPluginCachePaths()) {
    if (!fs.existsSync(cachePath)) continue;
    if (!isSafeCachePath(cachePath)) {
      failed.push(`${cachePath} (refused: failed safety check)`);
      continue;
    }
    
    try {
      fs.rmSync(cachePath, { recursive: true, force: true });
      cleared.push(cachePath);
    } catch (err) {
      failed.push(`${cachePath} (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  
  return { cleared, failed };
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