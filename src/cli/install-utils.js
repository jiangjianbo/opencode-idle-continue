#!/usr/bin/env node
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as child_process from 'node:child_process';
import packageJson from '../../package.json' with { type: 'json' };

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

const AI_AGENT_DIRS = [
  '.opencode', '.claude', '.cursor', '.windsurf', '.continue', '.github', '.copilot',
];
const AI_AGENT_FILES = [
  'agents.md', 'AGENTS.md', 'claude.md', 'CLAUDE.md', '.cursorrules', '.windsurfrules',
  'continue.json', 'continue.md', 'COPILOT_INSTRUCTIONS.md',
];

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

function findProjectRoot(startDir) {
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

function isIdleContinuePath(ref) {
  // Match paths where idle-continue is a directory name, not part of other names
  // This prevents matching like "some-other-idle-continue/index.js"
  return /(^|\/|\\)idle-continue(\/|\\)index\.js(\?|$)/i.test(ref);
}

function removeOldPluginReferences(config, options = {}) {
  const { verbose = false } = options;
  
  if (!config.plugin) {
    config.plugin = [];
  }

  const oldRefsToRemove = [
    'opencode-idle-continue',
  ];

  const originalPlugins = [...config.plugin];
  config.plugin = config.plugin.filter(ref => 
    !oldRefsToRemove.includes(ref) && 
    !ref.startsWith('opencode-idle-continue@') && 
    !isIdleContinuePath(ref)
  );

  const removedRefs = originalPlugins.filter(ref => !config.plugin.includes(ref));
  
  if (verbose && removedRefs.length > 0) {
    console.log('🔄 Detected previous installation:');
    removedRefs.forEach(ref => {
      if (ref === 'opencode-idle-continue') {
        console.log('   - Global CLI installation: opencode-idle-continue');
      } else if (isIdleContinuePath(ref)) {
        console.log('   - Local installation:', ref);
      } else {
        console.log('   - Previous installation:', ref);
      }
    });
  }
  
  return { removedRefs, originalPlugins };
}

function addPluginReference(config, pluginRef, options = {}) {
  const { verbose = false, upgradeMessage = 'Upgrading to installation...' } = options;
  
  // Preserve existing schema if present (both $schema and schema variants)
  const existingSchema = config['$schema'] || config['schema'];
  
  const { removedRefs } = removeOldPluginReferences(config, { verbose });
  
  if (removedRefs.length > 0 && verbose) {
    console.log(`🔄 ${upgradeMessage}`);
    console.log('🔄 Old references will be removed, new installation will be added.');
    console.log('');
  }

  // Only add if not already present
  if (!config.plugin.includes(pluginRef)) {
    config.plugin.push(pluginRef);
    if (verbose) {
      console.log(`✓ Added plugin reference: ${pluginRef}`);
    }
  } else if (verbose) {
    console.log(`✓ Plugin reference already exists: ${pluginRef}`);
  }

  // Remove any incorrect schema fields and set the correct one
  delete config['schema'];
  config['$schema'] = existingSchema || 'https://opencode.ai/config.json';
}

function cleanupOldPluginDirectories(opencodeDir, options = {}) {
  const { verbose = false } = options;
  
  const oldPluginDirs = [
    path.join(opencodeDir, 'plugins', 'idle-continue'),
  ];
  
  let cleaned = false;
  for (const oldPluginDir of oldPluginDirs) {
    if (fs.existsSync(oldPluginDir)) {
      if (verbose) {
        console.log('');
        console.log(`🧹 Removing old plugin directory: ${oldPluginDir}`);
      }
      fs.rmSync(oldPluginDir, { recursive: true, force: true });
      if (verbose) {
        console.log('✓ Old plugin installation cleaned up.');
      }
      cleaned = true;
    }
  }
  
  return cleaned;
}

function installOpencodePluginDependency(opencodeDir, options = {}) {
  const { verbose = false } = options;
  
  const pluginDir = path.join(opencodeDir, 'node_modules', '@opencode-ai', 'plugin');
  if (fs.existsSync(pluginDir)) {
    if (verbose) {
      console.log('✓ @opencode-ai/plugin dependency already installed');
    }
    return false;
  }

  if (verbose) {
    console.log('📦 Installing @opencode-ai/plugin dependency...');
  }
  
  const originalDir = process.cwd();
  try {
    process.chdir(opencodeDir);
    fs.writeFileSync(path.join(opencodeDir, 'package.json'), '{"name":"opencode-config","version":"1.0.0"}');
    
    const result = child_process.spawnSync('npm', ['install', '@opencode-ai/plugin', '--silent', '--no-audit', '--no-fund'], {
      stdio: verbose ? 'inherit' : 'pipe',
      shell: true
    });
    
    if (result.status !== 0 && verbose) {
      console.log('⚠ Warning: Failed to install @opencode-ai/plugin, but installation may still work');
    } else if (verbose) {
      console.log('✓ @opencode-ai/plugin dependency installed');
    }
    
    return true;
  } finally {
    process.chdir(originalDir);
  }
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

export {
  PLUGIN_NAME,
  PLUGIN_VERSION,
  DEFAULT_PLUGIN_CONFIG,
  getOpencodeConfigDir,
  ensureDir,
  loadJson,
  saveJson,
  findProjectRoot,
  isIdleContinuePath,
  removeOldPluginReferences,
  addPluginReference,
  cleanupOldPluginDirectories,
  installOpencodePluginDependency,
  getPluginCachePaths,
  isSafeCachePath,
  evictPluginCaches,
};