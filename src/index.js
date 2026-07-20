import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { OpenCodeTrueIdleDetector } from './opencode-true-idle-detector.js';

const DEFAULT_CONFIG = {
  prompt_file: 'idle-prompt.md',
  watch_files: ['task.md', 'wish-list.md'],
  check_interval_minutes: 30,
  max_idle_cycles: 5,
  enabled: true,
};

function createLogger(logDir) {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const logPath = path.join(logDir, `log-${ts}.log`);
  return (level, msg) => {
    const t = new Date().toISOString();
    fs.appendFileSync(logPath, `[${t}] [${level}] ${msg}\n`);
  };
}

function findConfigFile(directory) {
  const candidates = [
    path.join(directory, 'idle-continue.json'),
    path.join(directory, '.opencode', 'idle-continue.json'),
    path.join(homedir(), '.config', 'opencode', 'idle-continue.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadConfig(directory) {
  const configPath = findConfigFile(directory);
  if (!configPath) return { ...DEFAULT_CONFIG };
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function readFileSnapshot(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return { mtime: stat.mtimeMs, size: stat.size };
  } catch {
    return null;
  }
}

function fileChanged(snapshot, filePath) {
  const current = readFileSnapshot(filePath);
  if (current === null && snapshot === null) return false;
  if (current === null || snapshot === null) return true;
  return current.mtime !== snapshot.mtime || current.size !== snapshot.size;
}

function loadPromptFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    return { content, mtime: stat.mtimeMs };
  } catch {
    return { content: '', mtime: 0 };
  }
}

const server = async (input) => {
  const { directory, client } = input;
  const logDir = path.join(directory, '.log');
  const log = createLogger(logDir);

  const config = loadConfig(directory);
  log('INIT', `Config loaded: ${JSON.stringify(config)}`);

  const resolvedPromptPath = path.resolve(directory, config.prompt_file);
  let promptCache = loadPromptFile(resolvedPromptPath);

  const fileSnapshots = new Map();
  for (const f of config.watch_files) {
    const fp = path.resolve(directory, f);
    fileSnapshots.set(fp, readFileSnapshot(fp));
  }

  const waitState = {
    active: false,
    idleCycles: 0,
    currentInterval: config.check_interval_minutes,
    timer: null,
  };

  let sessionStatus = 'idle';
  let activeSessionID = null;

  function getPromptContent() {
    const loaded = loadPromptFile(resolvedPromptPath);
    if (loaded.mtime !== promptCache.mtime) {
      promptCache = loaded;
      log('HOT_RELOAD', `Prompt file reloaded: ${resolvedPromptPath}`);
    }
    return promptCache.content;
  }

  function checkFilesChanged() {
    let changed = false;
    for (const [fp, snapshot] of fileSnapshots) {
      if (fileChanged(snapshot, fp)) {
        fileSnapshots.set(fp, readFileSnapshot(fp));
        changed = true;
      }
    }
    return changed;
  }

  function resetWaitState() {
    if (waitState.timer) {
      clearTimeout(waitState.timer);
      waitState.timer = null;
    }
    waitState.active = false;
    waitState.idleCycles = 0;
    waitState.currentInterval = config.check_interval_minutes;
    log('RESET', 'Wait state reset to initial');
  }

  function scheduleWaitCheck() {
    if (waitState.timer) clearTimeout(waitState.timer);
    const ms = waitState.currentInterval * 60 * 1000;
    waitState.timer = setTimeout(async () => {
      waitState.timer = null;

      if (checkFilesChanged()) {
        log('WAIT', 'File change detected, exiting wait state');
        resetWaitState();
        return;
      }

      if (sessionStatus !== 'idle') {
        log('WAIT', `Not idle (status=${sessionStatus}), exiting wait state`);
        resetWaitState();
        return;
      }

      log('WAIT', `Sending prompt (cycle ${waitState.idleCycles + 1}, interval=${waitState.currentInterval}min)`);
      await sendPrompt(activeSessionID);

      if (checkFilesChanged()) {
        log('WAIT', 'File change detected after prompt, resetting');
        resetWaitState();
        return;
      }

      waitState.idleCycles++;
      log('WAIT', `Idle cycles=${waitState.idleCycles}/${config.max_idle_cycles}`);

      if (waitState.idleCycles >= config.max_idle_cycles) {
        waitState.currentInterval *= 2;
        log('WAIT', `Doubling interval to ${waitState.currentInterval}min`);
        waitState.idleCycles = 0;
      }

      scheduleWaitCheck();
    }, ms);
    log('WAIT', `Next check in ${waitState.currentInterval}min`);
  }

  function enterWaitState() {
    if (waitState.active) return;
    waitState.active = true;
    waitState.idleCycles = 0;
    waitState.currentInterval = config.check_interval_minutes;
    log('WAIT', `Entering wait state (interval=${waitState.currentInterval}min)`);
    scheduleWaitCheck();
  }

  async function sendPrompt(sessionID) {
    const promptContent = getPromptContent();
    if (!promptContent.trim()) {
      log('SKIP', 'Prompt content is empty, skipping');
      return;
    }

    const sid = sessionID || activeSessionID;
    if (!sid) {
      log('SKIP', 'No active session, skipping');
      return;
    }

    log('PROMPT', `session=${sid} sending prompt (len=${promptContent.length})`);
    try {
      await client.session.prompt({
        path: { id: sid },
        body: {
          parts: [{ type: 'text', text: promptContent }],
        },
      });
      log('PROMPT_DONE', `session=${sid} reply complete`);
    } catch (err) {
      log('PROMPT_ERR', `session=${sid} ${err.message}`);
    }
  }

  const detector = new OpenCodeTrueIdleDetector({
    log,
    onIdle: async (sessionID) => {
      if (!config.enabled) {
        log('SKIP', 'Plugin disabled');
        return;
      }
      if (waitState.active) return;

      activeSessionID = sessionID;
      log('ON_IDLE', `session=${sessionID} triggered, sending prompt`);
      await sendPrompt(sessionID);

      const changed = checkFilesChanged();
      if (changed) {
        log('FILES', 'File(s) changed, resetting idle cycle');
        resetWaitState();
      } else {
        log('FILES', 'No file changes, entering wait state');
        enterWaitState();
      }
    },
  });

  log('INIT', `Plugin idle-continue initialized | directory=${directory}`);
  log('DESIGN', JSON.stringify({
    signals: ['session.status', 'session.idle', 'permission.asked', 'permission.replied', 'question.asked', 'question.replied2', 'question.rejected2'],
    rule: 'TRUE_IDLE -> send prompt -> check watch_files -> wait state if unchanged -> periodic resend with backoff',
    config: {
      prompt_file: config.prompt_file,
      watch_files: config.watch_files,
      check_interval_minutes: config.check_interval_minutes,
      max_idle_cycles: config.max_idle_cycles,
      enabled: config.enabled,
    },
  }));

  return {
    event: async (input) => {
      const { event } = input;
      if (event?.type === 'session.status') {
        sessionStatus = event.properties?.status?.type || sessionStatus;
      }
      if (event?.type === 'session.idle') {
        activeSessionID = event.properties?.sessionID || event.properties?.info?.id || activeSessionID;
      }
      detector.handleEvent(input);
    },

    "chat.message": async (input, output) => {
      const { sessionID, messageID, model } = input;
      const { message, parts } = output;
      const role = message?.role || 'unknown';
      const textContent = parts?.map(p => p.text).filter(Boolean).join('\n');
      const modelStr = model ? `${model.providerID}/${model.modelID}` : '';
      const entry = textContent.slice(0, 2000);

      if (role === 'user') {
        log('USER_INPUT', `session=${sessionID} msg=${messageID} model=${modelStr} len=${textContent.length} text=${JSON.stringify(entry)}`);
        if (checkFilesChanged() && waitState.active) {
          log('WAIT', 'User input with file change, exiting wait state');
          resetWaitState();
        }
      } else if (role === 'assistant') {
        log('AI_REPLY', `session=${sessionID} msg=${messageID} model=${modelStr} len=${textContent.length} text=${JSON.stringify(entry)}`);
      }
    },

    dispose: async () => {
      log('DISPOSE', 'Plugin shutting down');
      resetWaitState();
      detector.dispose();
    },
  };
};

export default {
  id: 'idle-continue',
  server,
};
