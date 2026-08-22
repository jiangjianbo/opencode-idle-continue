/**
 * OpenCode Idle Continue 插件
 * 
 * 当 OpenCode 处于空闲状态时自动发送提示词，支持文件监控和周期性重发。
 * 支持 AI 卡死检测和自动恢复，以及用户输入和滚动状态的检测。
 * 
 * @module idle-continue
 */

import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { OpenCodeTrueIdleDetector } from './opencode-true-idle-detector.js';
import { SubagentTrigger } from './subagent-trigger.js';
import { FileWatch, WaitState } from './wait-state.js';
import { readFileSnapshot, fileChanged, loadPromptFile, fileExists, getDefaultPrompt } from './file-utils.js';

export { readFileSnapshot, fileChanged, loadPromptFile, fileExists, getDefaultPrompt };

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
  prompt_file: 'idle-prompt.md',
  watch_files: ['task.md', 'wish-list.md'],
  check_interval_minutes: 30,
  max_idle_cycles: 5,
  enabled: true,
  log_enabled: false,
  log_level: 'none',
  enable_default_prompt: false,
  subagent_enabled: false,
  subagent_agent_type: 'explore',
  subagent_delay_ms: 60_000,
  debounce_delay_ms: 60000,
  stuck_threshold_minutes: 20,
  ai_stuck_action: 'ignore',
  ai_stuck_retry_prompt: 'continue',
  initial_idle_delay_minutes: 10,
  user_activity_suppress_seconds: 300,
};

/**
 * 日志级别映射表
 * 格式: { [logTag]: level }
 * level: 'debug' | 'warn' | 'error' | 'none'
 */
const LOG_LEVEL_MAP = {
  'INIT': 'debug',
  'DESIGN': 'debug',
  'STATUS': 'debug',
  'IDLE': 'debug',
  'CANDIDATE': 'debug',
  'TRUE_IDLE': 'debug',
  'ON_IDLE_EXIT': 'debug',
  'SKIP': 'debug',
  'DEBOUNCE': 'debug',
  'PERM': 'debug',
  'QUEST': 'debug',
  'PROMPT': 'debug',
  'PROMPT_DONE': 'debug',
  'PROMPT_ERR': 'error',
  'HOT_RELOAD': 'debug',
  'FILES': 'debug',
  'WAIT': 'debug',
  'RESET': 'debug',
  'ON_IDLE': 'debug',
  'USER_INPUT': 'debug',
  'AI_REPLY': 'debug',
  'USER_INTERRUPT': 'debug',
  'CANCEL': 'error',
  'SCHEDULE': 'debug',
  'INTERRUPT': 'error',
  'TRIGGER': 'debug',
  'TRIGGER_DONE': 'debug',
  'TRIGGER_ERR': 'error',
  'AI_STUCK': 'warn',
  'AI_STUCK_ERR': 'error',
  'DISPOSE': 'debug',
  'INPUT_STATE': 'debug',
  'SCROLL_STATE': 'debug',
  'USER_INPUT_ACTIVITY': 'debug',
  'HEARTBEAT': 'debug',
  'IDLE_END': 'debug',
  'STUCK_CHECK': 'debug',
  'DEBUG_MSG_EVENT': 'debug',
};

/**
 * 日志级别优先级（数字越大越严格）
 */
const LOG_LEVEL_PRIORITY = {
  'debug': 0,
  'warn': 1,
  'error': 2,
  'none': 3,
};

/**
 * 创建日志记录器
 * @param {string} logDir - 日志目录
 * @param {string} logLevel - 日志级别 ('debug' | 'warn' | 'error' | 'none')
 * @returns {Function} 日志记录函数
 */
function createLogger(logDir, logLevel) {
  const levelPriority = LOG_LEVEL_PRIORITY[logLevel] ?? 3;
  
  // 当 log-level 为 none 时，不创建目录，返回空函数
  if (logLevel === 'none') {
    return () => {};
  }
  
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  const logPath = path.join(logDir, `log-${ts}.log`);
  
  return (level, msg) => {
    const tagPriority = LOG_LEVEL_PRIORITY[LOG_LEVEL_MAP[level] ?? 'debug'];
    if (tagPriority < levelPriority) {
      return;
    }
    
    const t = new Date().toISOString();
    fs.appendFileSync(logPath, `[${t}] [${level}] ${msg}\n`);
  };
}

/**
 * 查找配置文件
 * @param {string} directory - 项目目录
 * @returns {string|null} 配置文件路径或 null
 */
function findConfigFile(directory) {
  const candidates = [
    path.join(directory, 'idle-continue.json'),
    path.join(directory, '.opencode', 'idle-continue.json'),
    path.join(directory, '.ai', 'idle-continue.json'),
    path.join(homedir(), '.config', 'opencode', 'idle-continue.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * 查找提示词文件
 * @param {string} directory - 项目目录
 * @param {string} promptFileName - 提示词文件名
 * @returns {string|null} 提示词文件路径或 null
 */
function findPromptFile(directory, promptFileName) {
  let dir = path.resolve(directory);
  const root = path.parse(dir).root;
  while (dir !== root) {
    for (const p of [path.join(dir, promptFileName), path.join(dir, '.opencode', promptFileName), path.join(dir, '.ai', promptFileName)]) {
      if (fs.existsSync(p)) return p;
    }
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * 加载配置
 * @param {string} directory - 项目目录
 * @returns {Object} 配置对象
 */
function loadConfig(directory) {
  const configPath = findConfigFile(directory);
  if (!configPath) return { ...DEFAULT_CONFIG };
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const config = { ...DEFAULT_CONFIG, ...parsed };
    
    // 兼容旧的 log_enabled 字段
    if (parsed.log_enabled !== undefined && parsed.log_level === undefined) {
      config.log_level = parsed.log_enabled ? 'error' : 'none';
    }
    
    // 验证 log_level 的值
    const validLevels = ['debug', 'warn', 'error', 'none'];
    if (!validLevels.includes(config.log_level)) {
      config.log_level = 'none';
    }
    
    return config;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * 插件服务器主函数
 * @param {Object} input - 输入参数
 * @param {string} input.directory - 项目目录
 * @param {Object} input.client - OpenCode 客户端对象
 * @returns {Object} 插件钩子对象
 */
const server = async (input) => {
  const { directory, client } = input;
  const config = loadConfig(directory);

  const logDir = path.join(directory, '.log');
  const log = createLogger(logDir, config.log_level);
  log('INIT', `Config loaded: ${JSON.stringify(config)}`);

  const promptFilePath = findPromptFile(directory, config.prompt_file);
  const resolvedPromptPath = promptFilePath ? promptFilePath : path.resolve(directory, config.prompt_file);
  const watchPaths = config.watch_files.map(f => path.resolve(directory, f));

  const fileWatch = new FileWatch({
    promptFilePath: resolvedPromptPath,
    watchFilePaths: watchPaths,
    log,
    enableDefaultPrompt: config.enable_default_prompt,
    directory,
  });

  let sessionStatus = 'idle';
  let activeSessionID = null;
  let mainSessionID = null;
  let pendingTimer = null;

  /**
   * 取消待处理定时器
   * @param {string} sessionID - 会话 ID
   */
  function cancelPendingTimer(sessionID) {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
      log('CANCEL', `session=${sessionID} cancelled scheduled trigger`);
    }
  }

  const detector = new OpenCodeTrueIdleDetector({
    log,
    baseDelay: config.debounce_delay_ms,
    stuckThresholdMinutes: config.stuck_threshold_minutes,
    stuckAction: config.ai_stuck_action,
    stuckRetryPrompt: config.ai_stuck_retry_prompt,
    initialIdleDelayMinutes: config.initial_idle_delay_minutes || 10,
    userActivitySuppressSeconds: config.user_activity_suppress_seconds || 30,
    onIdle: async (sessionID) => {
      if (!config.enabled) {
        log('SKIP', 'Plugin disabled');
        return;
      }
      activeSessionID = sessionID;
      mainSessionID = sessionID;
      log('ON_IDLE', `session=${sessionID} triggered`);

      if (config.subagent_enabled) {
        if (trigger.inFlight) {
          log('SKIP', `session=${sessionID} trigger in flight`);
          return;
        }
        if (pendingTimer) {
          log('SKIP', `session=${sessionID} trigger already scheduled`);
          return;
        }
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          trigger.trigger(sessionID, {
            agentType: config.subagent_agent_type,
            prompt: fileWatch.readPrompt(),
          });
        }, config.subagent_delay_ms);
        log('SCHEDULE', `session=${sessionID} subagent trigger scheduled in ${config.subagent_delay_ms}ms`);
      } else {
        waitState.onIdle(sessionID);
      }
    },
    onIdleExit: (sessionID) => {
      if (!config.enabled) return;
      
      // 如果提示词正在发送中，跳过 idle exit 事件（防止插件自身活动重置 wait state）
      if (detector.promptInFlight) {
        log('ON_IDLE_EXIT', `session=${sessionID} idle exit skipped during prompt sending`);
        return;
      }
      
      log('ON_IDLE_EXIT', `session=${sessionID} idle exit`);
      cancelPendingTimer(sessionID);
      waitState.onIdleExit();
    },
    onUserInterrupt: (sessionID) => {
      if (mainSessionID && sessionID !== mainSessionID) return;
      cancelPendingTimer(sessionID);
      log('INTERRUPT', `session=${sessionID} user interrupt`);
      waitState.onUserInterrupt(sessionID);
    },
    onUserInput: (sessionID) => {
      if (mainSessionID && sessionID !== mainSessionID) return;
      cancelPendingTimer(sessionID);
      waitState.onUserInput(sessionID);
    },
    onUserInputActivity: () => {
      log('USER_INPUT_ACTIVITY', 'User typing detected');
    },
    onAiStuck: async (sessionID, opts) => {
      if (!config.enabled) return;
      const action = opts?.action || config.ai_stuck_action;
      const retryPrompt = opts?.retryPrompt || config.ai_stuck_retry_prompt;
      log('AI_STUCK', `session=${sessionID} AI appears stuck, action=${action}`);

      if (action === 'ignore') {
        log('AI_STUCK', `session=${sessionID} ignoring stuck state`);
        return;
      }

      if (action === 'abort' || action === 'abort_and_retry') {
        try {
          await client.session.abort({
            path: { id: sessionID },
            query: { directory },
          });
          log('AI_STUCK', `session=${sessionID} abort successful`);
        } catch (err) {
          log('AI_STUCK_ERR', `session=${sessionID} abort failed: ${err.message}`);
          return;
        }
      }

      if (action === 'abort_and_retry') {
        log('AI_STUCK', `session=${sessionID} waiting 30 seconds before retry`);
        await new Promise(resolve => setTimeout(resolve, 30000));

        const sid = sessionID || activeSessionID;
        if (!sid) {
          log('AI_STUCK', 'No active session, skipping retry');
          return;
        }

        await sendPrompt(sid, retryPrompt, 'AI_STUCK', { idleExit: 31000, userMessage: 32000 });
      }
    },
  });

  const trigger = new SubagentTrigger({ client, detector, log, directory });

  /**
   * 发送提示词到 OpenCode
   * @param {string} sessionID - 会话 ID
   * @param {string} promptContentOrCallback - 提示词内容或回调函数
   * @param {string} logPrefix - 日志前缀
   * @param {Object} additionalDelayMs - 额外延迟时间配置
   * @param {number} additionalDelayMs.idleExit - 空闲退出延迟
   * @param {number} additionalDelayMs.userMessage - 用户消息延迟
   */
  async function sendPrompt(sessionID, promptContentOrCallback, logPrefix = 'PROMPT', additionalDelayMs = { idleExit: 1000, userMessage: 2000 }) {
    const promptContent = typeof promptContentOrCallback === 'string' 
      ? promptContentOrCallback 
      : fileWatch.readPrompt();
    
    if (!promptContent.trim()) {
      log('SKIP', 'Prompt content is empty, skipping');
      return;
    }

    const sid = sessionID || activeSessionID;
    if (!sid) {
      log('SKIP', 'No active session, skipping');
      return;
    }

    const actualLogPrefix = typeof promptContentOrCallback === 'string' ? logPrefix : 'PROMPT';
    const actualAdditionalDelayMs = typeof promptContentOrCallback === 'string' ? additionalDelayMs : { idleExit: 1000, userMessage: 2000 };

    log(actualLogPrefix, `session=${sid} sending prompt (len=${promptContent.length})`);
    detector.setPromptInFlight(true);
    detector.setSkipNextIdleExit(actualAdditionalDelayMs.idleExit);
    detector.setSkipNextUserMessage(actualAdditionalDelayMs.userMessage);

    try {
      await client.session.prompt({
        path: { id: sid },
        body: {
          parts: [{ type: 'text', text: promptContent }],
        },
      });
      log(actualLogPrefix + '_DONE', `session=${sid} reply complete`);
      
      // Extend suppression after AI response completes to prevent immediate re-triggering
      detector.setSkipNextIdleExit(5000);
      detector.setSkipNextUserMessage(5000);
    } catch (err) {
      log(actualLogPrefix + '_ERR', `session=${sid} ${err.message}`);
    } finally {
      detector.setPromptInFlight(false);
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

  log('INIT', `Plugin idle-continue initialized | directory=${directory}`);
  log('DESIGN', JSON.stringify({
    signals: ['session.status', 'session.idle', 'permission.asked', 'permission.replied', 'question.asked', 'question.replied', 'question.rejected', 'chat.message', 'message.updated', 'message.part.updated', 'message.part.delta', 'tui.prompt.append'],
    limitations: 'OpenCode currently does not provide tui.prompt.content or ui.scroll events. User activity is detected via tui.prompt.append and chat.message hooks.',
    subagent_enabled: config.subagent_enabled,
    rule: config.subagent_enabled 
      ? 'TRUE_IDLE -> wait delay -> subagent trigger via Task tool'
      : 'TRUE_IDLE -> send prompt -> check watch_files -> wait state if unchanged -> periodic resend with backoff',
    config: {
      prompt_file: config.prompt_file,
      watch_files: config.watch_files,
      check_interval_minutes: config.check_interval_minutes,
      max_idle_cycles: config.max_idle_cycles,
      enabled: config.enabled,
      subagent_enabled: config.subagent_enabled,
      subagent_agent_type: config.subagent_agent_type,
      subagent_delay_ms: config.subagent_delay_ms,
      debounce_delay_ms: config.debounce_delay_ms,
      stuck_threshold_minutes: config.stuck_threshold_minutes,
    },
  }));

  /**
   * 返回插件钩子对象
   */
  return {
    /**
     * 事件处理钩子
     * @param {Object} input - 输入事件
     * @param {Object} input.event - 事件对象
     */
    event: async (input) => {
      const { event } = input;
      if (event?.type === 'session.status') {
        sessionStatus = event.properties?.status?.type || sessionStatus;
      }
      if (event?.type === 'session.idle') {
        activeSessionID = event.properties?.sessionID || event.properties?.info?.id || activeSessionID;
      }
      detector.handleEvent(input);
      detector.handleMessageEvent(input);
    },

    /**
     * 聊天消息处理钩子
     * @param {Object} input - 输入消息
     * @param {string} input.sessionID - 会话 ID
     * @param {string} input.messageID - 消息 ID
     * @param {Object} input.model - 模型信息
     * @param {Object} output - 输出消息
     * @param {Object} output.message - 消息对象
     * @param {Array} output.parts - 消息部分
     */
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

    /**
     * 插件清理钩子
     */
    dispose: async () => {
      log('DISPOSE', 'Plugin shutting down');
      cancelPendingTimer('dispose');
      waitState.dispose();
      detector.dispose();
    },
  };
};

export default {
  id: 'idle-continue',
  server,
};
