import { readFileSnapshot, fileChanged, getFileMtime, loadPromptFile, readDirectorySnapshot, directoryChanged, isDirectory, fileExists, getDefaultPrompt } from './file-utils.js';

/**
 * FileWatch - 文件监控类
 * 
 * 负责监控提示词文件和监控文件的变化，支持热重载和文件变更检测。
 * 
 * @class FileWatch
 */
export class FileWatch {
  #promptFilePath;
  #watchPaths;
  #promptCache;
  #snapshots;
  #log;
  #enableDefaultPrompt;
  #directory;

  /**
   * 构造函数 - 初始化文件监控
   * @param {Object} options - 配置选项
   * @param {string} options.promptFilePath - 提示词文件路径
   * @param {Array<string>} options.watchFilePaths - 监控文件路径列表
   * @param {Function} options.log - 日志记录函数
   * @param {boolean} options.enableDefaultPrompt - 是否启用默认提示词
   * @param {string} options.directory - 项目目录
   */
  constructor({ promptFilePath, watchFilePaths, log, enableDefaultPrompt, directory }) {
    this.#promptFilePath = promptFilePath;
    this.#watchPaths = watchFilePaths;
    this.#log = log;
    this.#enableDefaultPrompt = enableDefaultPrompt;
    this.#directory = directory;
    
    const promptExists = fileExists(promptFilePath);
    if (promptExists) {
      this.#promptCache = loadPromptFile(promptFilePath);
    } else if (enableDefaultPrompt) {
      this.#promptCache = { content: getDefaultPrompt(), mtime: 0 };
    } else {
      this.#promptCache = { content: '', mtime: 0 };
    }
    
    this.#snapshots = new Map(
      watchFilePaths.map(fp => [fp, isDirectory(fp) ? readDirectorySnapshot(fp) : readFileSnapshot(fp)]),
    );
  }

  /**
   * 读取提示词内容，支持热重载
   * @returns {string} 提示词内容
   */
  readPrompt() {
    const promptExists = fileExists(this.#promptFilePath);
    
    if (promptExists) {
      const mtime = getFileMtime(this.#promptFilePath);
      if (mtime !== this.#promptCache.mtime) {
        this.#promptCache = loadPromptFile(this.#promptFilePath);
        this.#log('HOT_RELOAD', `Prompt file reloaded: ${this.#promptFilePath}`);
      }
      return this.#promptCache.content;
    } else if (this.#enableDefaultPrompt) {
      return getDefaultPrompt();
    } else {
      return '';
    }
  }

  /**
   * 检查监控文件是否有变化
   * @returns {boolean} 是否有文件变化
   */
  hasFilesChanged() {
    for (const fp of this.#watchPaths) {
      const prev = this.#snapshots.get(fp);
      if (isDirectory(fp)) {
        if (directoryChanged(prev, fp)) return true;
      } else {
        if (fileChanged(prev, fp)) return true;
      }
    }
    return false;
  }

  /**
   * 同步监控文件快照到最新状态
   */
  syncToLatest() {
    for (const fp of this.#watchPaths) {
      this.#snapshots.set(fp, isDirectory(fp) ? readDirectorySnapshot(fp) : readFileSnapshot(fp));
    }
  }
}

/**
 * WaitState - 等待状态管理类
 * 
 * 负责管理空闲检测后的等待状态，支持周期性重发和间隔退避机制。
 * 
 * @class WaitState
 */
export class WaitState {
  #active = false;
  #interrupted = false;
  #idleCycles = 0;
  #currentInterval;
  #initialInterval;
  #maxIdleCycles;
  #sessionID = null;
  #timer = null;
  #fileWatch;
  #sendPrompt;
  #isSessionIdle;
  #log;

  /**
   * 构造函数 - 初始化等待状态管理器
   * @param {Object} options - 配置选项
   * @param {number} options.initialIntervalMinutes - 初始检查间隔（分钟）
   * @param {number} options.maxIdleCycles - 最大空闲循环次数
   * @param {FileWatch} options.fileWatch - 文件监控对象
   * @param {Function} options.sendPrompt - 发送提示词函数
   * @param {Function} options.isSessionIdle - 检查会话是否空闲的函数
   * @param {Function} options.log - 日志记录函数
   */
  constructor({ initialIntervalMinutes, maxIdleCycles, fileWatch, sendPrompt, isSessionIdle, log }) {
    this.#initialInterval = initialIntervalMinutes;
    this.#currentInterval = initialIntervalMinutes;
    this.#maxIdleCycles = maxIdleCycles;
    this.#fileWatch = fileWatch;
    this.#sendPrompt = sendPrompt;
    this.#isSessionIdle = isSessionIdle;
    this.#log = log;
  }

  /**
   * 进入空闲状态
   * @param {string} sessionID - 会话 ID
   */
  onIdle(sessionID) {
    if (this.#interrupted) {
      this.#log('WAIT', 'WAIT Interrupted by user, skipping idle');
      return;
    }
    if (this.#active) return;
    this.#active = true;
    this.#sessionID = sessionID;
    this.#idleCycles = 0;
    this.#currentInterval = this.#initialInterval;

    this.#log('WAIT', 'WAIT Entering wait state, sending initial prompt');
    this.#sendAndCheck(sessionID, true);  // true 表示初始发送
  }

  /**
   * 从空闲状态退出
   */
  onIdleExit() {
    this.#reset();
    this.#fileWatch.syncToLatest();
    this.#log('WAIT', 'WAIT Exited idle, reset and file state synced');
  }

  /**
   * 用户中断处理
   * @param {string} sessionID - 会话 ID
   */
  onUserInterrupt(sessionID) {
    this.#interrupted = true;
    this.#reset();
    this.#log('WAIT', `WAIT Interrupted by user session=${sessionID}, waiting for manual input`);
  }

  /**
   * 用户输入处理
   * @param {string} sessionID - 会话 ID
   */
  onUserInput(sessionID) {
    if (this.#interrupted) {
      this.#log('WAIT', `WAIT User input received session=${sessionID}, resuming idle detection`);
    }
    this.#interrupted = false;
  }

  /**
   * 获取活动状态
   * @returns {boolean} 是否处于活动等待状态
   */
  get active() {
    return this.#active;
  }

  /**
   * 重置等待状态
   */
  reset() {
    this.#reset();
  }

  /**
   * 发送提示词并检查文件变化
   * @private
   * @param {string} sessionID - 会话 ID
   * @param {boolean} initial - 是否为初始发送
   */
  #sendAndCheck(sessionID, initial = false) {
    (async () => {
      await this.#sendPrompt(sessionID);

      if (!this.#active) return;

      if (this.#fileWatch.hasFilesChanged()) {
        this.#fileWatch.syncToLatest();
        this.#log('WAIT', 'WAIT Files changed, resetting');
        this.#reset();
        return;
      }

      // 如果不是初始发送，才记录循环次数
      if (!initial) {
        this.#idleCycles++;
        this.#log('WAIT', `WAIT Idle cycles=${this.#idleCycles}/${this.#maxIdleCycles}`);

        if (this.#idleCycles >= this.#maxIdleCycles) {
          this.#currentInterval *= 2;
          this.#log('WAIT', `WAIT Doubling interval to ${this.#currentInterval}min`);
          this.#idleCycles = 0;
        }
      }

      this.#schedule();
    })();
  }

  /**
   * 调度下一次检查
   * @private
   */
  #schedule() {
    if (this.#timer) clearTimeout(this.#timer);
    const ms = this.#currentInterval * 60 * 1000;
    this.#timer = setTimeout(async () => {
      this.#timer = null;

      if (this.#interrupted) {
        this.#log('WAIT', 'WAIT Interrupted on timer, resetting');
        this.#reset();
        return;
      }

      if (!this.#isSessionIdle()) {
        this.#log('WAIT', 'WAIT Session not idle, exiting wait state');
        this.#reset();
        return;
      }

      if (this.#fileWatch.hasFilesChanged()) {
        this.#fileWatch.syncToLatest();
        this.#log('WAIT', 'WAIT Files changed on check, resetting');
        this.#reset();
        return;
      }

      this.#log('WAIT', 'WAIT Timer fired, sending prompt');
      this.#sendAndCheck(this.#sessionID);
    }, ms);
    this.#log('WAIT', `WAIT Next check in ${this.#currentInterval}min`);
  }

  /**
   * 重置等待状态（内部方法）
   * @private
   */
  #reset() {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#active = false;
    this.#idleCycles = 0;
    this.#currentInterval = this.#initialInterval;
    this.#sessionID = null;
  }

  /**
   * 清理资源
   */
  dispose() {
    this.#reset();
  }
}
