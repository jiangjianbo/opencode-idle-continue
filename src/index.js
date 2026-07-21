import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { OpenCodeTrueIdleDetector } from './opencode-true-idle-detector.js';
import { FileWatch, WaitState } from './wait-state.js';
import { readFileSnapshot, fileChanged, loadPromptFile } from './file-utils.js';

export { readFileSnapshot, fileChanged, loadPromptFile };

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

const server = async (input) => {
  const { directory, client } = input;
  const logDir = path.join(directory, '.log');
  const log = createLogger(logDir);

  const config = loadConfig(directory);
  log('INIT', `Config loaded: ${JSON.stringify(config)}`);

  const resolvedPromptPath = path.resolve(directory, config.prompt_file);
  const watchPaths = config.watch_files.map(f => path.resolve(directory, f));

  const fileWatch = new FileWatch({
    promptFilePath: resolvedPromptPath,
    watchFilePaths: watchPaths,
    log,
  });

  let sessionStatus = 'idle';
  let activeSessionID = null;

  async function sendPrompt(sessionID) {
    const promptContent = fileWatch.readPrompt();
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
    detector.setSkipNextUserMessage(1000);  // 1s 后自动清除，防止提示词被误识别
    detector.setSkipNextIdleExit(2000);     // 2s 后自动清除，防止发送期间触发 idle exit
    
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

  const waitState = new WaitState({
    initialIntervalMinutes: config.check_interval_minutes,
    maxIdleCycles: config.max_idle_cycles,
    fileWatch,
    sendPrompt,
    isSessionIdle: () => sessionStatus === 'idle',
    log,
  });

  const detector = new OpenCodeTrueIdleDetector({
    log,
    onIdle: async (sessionID) => {
      if (!config.enabled) {
        log('SKIP', 'Plugin disabled');
        return;
      }
      activeSessionID = sessionID;
      log('ON_IDLE', `session=${sessionID} triggered`);
      waitState.onIdle(sessionID);
    },
    onIdleExit: (sessionID) => {
      if (!config.enabled) return;
      log('ON_IDLE_EXIT', `session=${sessionID} idle exit`);
      waitState.onIdleExit();
    },
    onUserInterrupt: (sessionID) => {
      waitState.onUserInterrupt(sessionID);
    },
    onUserInput: (sessionID) => {
      waitState.onUserInput(sessionID);
    },
  });

  log('INIT', `Plugin idle-continue initialized | directory=${directory}`);
  log('DESIGN', JSON.stringify({
    signals: ['session.status', 'session.idle', 'permission.asked', 'permission.replied', 'question.asked', 'question.replied2', 'question.rejected2', 'chat.message'],
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
      const textContent = (parts ?? []).map(p => p.text).filter(Boolean).join('\n');
      const modelStr = model ? `${model.providerID}/${model.modelID}` : '';
      const entry = textContent.slice(0, 2000);

      if (role === 'user') {
        log('USER_INPUT', `session=${sessionID} msg=${messageID} model=${modelStr} len=${textContent.length} text=${JSON.stringify(entry)}`);
        if (fileWatch.hasFilesChanged()) {
          log('WAIT', 'User input with file change');
          fileWatch.syncToLatest();
        }
      } else if (role === 'assistant') {
        log('AI_REPLY', `session=${sessionID} msg=${messageID} model=${modelStr} len=${textContent.length} text=${JSON.stringify(entry)}`);
      }

      detector.handleChatMessage(input, output);
    },

    dispose: async () => {
      log('DISPOSE', 'Plugin shutting down');
      waitState.dispose();
      detector.dispose();
    },
  };
};

export default {
  id: 'idle-continue',
  server,
};
