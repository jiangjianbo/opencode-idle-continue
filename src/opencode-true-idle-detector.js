/**
 * OpenCodeTrueIdleDetector - 空闲检测器核心类
 * 
 * ## 状态机设计说明
 * 
 * 本检测器基于有限状态机(FSM)设计，监控OpenCode会话状态并提供智能空闲检测。
 * 
 * ## 核心状态字段
 * 
 * ### 会话状态相关
 * - `#status`: 会话状态 ('idle' | 'busy')
 * - `#waitingPermission`: 是否在等待权限回复
 * - `#waitingQuestion`: 是否在等待问题回复
 * - `#activeSessionID`: 当前活动会话ID
 * 
 * ### 检测控制状态
 * - `#interrupted`: 用户中断标志 (阻止idle检测)
 * - `#pendingCheck`: 待执行的空闲检查定时器
 * - `#stuckCheckTimer`: AI卡死检查定时器
 * 
 * ### 临时抑制状态
 * - `#skipNextUserMessage`: 跳过下一个用户消息
 * - `#skipNextIdleExit`: 跳过下一次idle退出事件
 * - `#promptInFlight`: 提示词正在发送中
 * 
 * ### 用户活动状态
 * - `#hasUncommittedInput`: 用户输入框有未提交内容
 * - `#isScrolling`: 用户正在滚动页面
 * 
 * ## 真空闲判断条件
 * 
 * 触发空闲事件(`#onIdle`)需要同时满足以下条件：
 * 
 * ```javascript
 * trueIdle = 
 *   #status === 'idle' &&           // 会话状态为空闲
 *   !#waitingPermission &&          // 不在等待权限
 *   !#waitingQuestion &&            // 不在等待问题
 *   !#interrupted &&                 // 未被用户中断
 *   !#hasUncommittedInput &&         // 输入框为空
 *   !#isScrolling &&                 // 未在滚动页面
 *   !#promptInFlight                // 提示词不在发送中
 * ```
 * 
 * ## 状态转换真值表
 * 
 * | 事件 | 条件 | 状态变化 | 回调 |
 * |------|------|----------|------|
 * | `session.status: idle→busy` | - | status=busy, lastActivityAt=now | onIdleExit |
 * | `session.status: busy→idle` | - | status=idle, scheduleCheck | - |
 * | `permission.asked` | - | waitingPermission=true | - |
 * | `permission.replied` | - | waitingPermission=false | scheduleCheck if idle |
 * | `question.asked` | - | waitingQuestion=true | - |
 * | `question.replied` | - | waitingQuestion=false | scheduleCheck if idle |
 * | `session.status: idle` + 等待 | trueIdle | - | onIdle |
 * | `user message` | !promptInFlight | status=busy, cleared | onUserInput |
 * | `assistant error: AbortedError` | - | interrupted=true | onUserInterrupt |
 * | `user input` | - | interrupted=false | - |
 * | `message.part.delta` | status=busy | lastActivityAt=now | - |
 * | `tui.prompt.content` | content.length>0 | hasUncommittedInput=true | - |
 * | `ui.scroll` | - | isScrolling=true | - |
 * | `ui.scroll.end` | - | isScrolling=false | - |
 * 
 * ## 定时器管理
 * 
 * - `#pendingCheck`: 空闲检查定时器 (基于baseDelay，支持指数退避)
 * - `#stuckCheckTimer`: AI卡死检查定时器 (60秒周期)
 * - `#skipNextUserMessageTimer`: 跳过用户消息的临时定时器
 * - `#skipNextIdleExitTimer`: 跳过idle退出的临时定时器
 * 
 * ## 注意事项
 * 
 * 1. **状态原子性**: 所有状态修改应该是原子性的，避免中间状态暴露
 * 2. **定时器清理**: dispose时必须清理所有定时器，防止内存泄漏
 * 3. **回调幂等性**: 所有回调都应该幂等，避免重复调用
 * 4. **条件完整性**: trueIdle检查必须包含所有阻止条件，避免误触发
 * 
 * @class OpenCodeTrueIdleDetector
 */
export class OpenCodeTrueIdleDetector {
  #log;
  #BASE_DELAY;
  #currentDelay;
  #status = 'idle';
  #waitingPermission = false;
  #waitingQuestion = false;
  #activeSessionID = null;
  #idleSince = null;
  #pendingCheck = null;
  #onIdle;
  #onIdleExit;
  #onUserInterrupt;
  #onUserInput;
  #onUserInputActivity;
  #onAiStuck;
  #interrupted = false;
  #skipNextUserMessage = false;
  #skipNextIdleExit = false;
  #promptInFlight = false;
  #skipNextUserMessageTimer = null;
  #skipNextIdleExitTimer = null;
  #stuckThresholdMinutes = 20;
  #lastActivityAt = null;
  #stuckCheckTimer = null;
  #lastUserInputActivityAt = null;
  #hasUncommittedInput = false;
  #isScrolling = false;
  #stuckAction = 'ignore';
  #stuckRetryPrompt = 'continue';

  /**
   * 构造函数 - 初始化空闲检测器
   * 
   * @param {Object} options - 配置选项
   * @param {Function} options.log - 日志记录函数
   * @param {Function} options.onIdle - 空闲状态确认后的回调
   * @param {Function} options.onIdleExit - 从空闲状态退出时的回调
   * @param {Function} options.onUserInterrupt - 用户中断检测回调
   * @param {Function} options.onUserInput - 用户输入检测回调
   * @param {Function} options.onUserInputActivity - 用户输入活动检测回调
   * @param {Function} options.onAiStuck - AI 卡死检测回调
   * @param {number} options.baseDelay - 基础去抖延迟时间（毫秒）
   * @param {number} options.stuckThresholdMinutes - AI 卡死检测阈值（分钟）
   * @param {string} options.stuckAction - AI 卡死处置策略
   * @param {string} options.stuckRetryPrompt - AI 卡死重试提示词
   */
  constructor({ log, onIdle, onIdleExit, onUserInterrupt, onUserInput, onUserInputActivity, onAiStuck, baseDelay = 5000, stuckThresholdMinutes = 20, stuckAction = 'ignore', stuckRetryPrompt = 'continue' }) {
    this.#log = log;
    this.#BASE_DELAY = baseDelay;
    this.#currentDelay = baseDelay;
    this.#onIdle = onIdle;
    this.#onIdleExit = onIdleExit;
    this.#onUserInterrupt = onUserInterrupt;
    this.#onUserInput = onUserInput;
    this.#onUserInputActivity = onUserInputActivity;
    this.#onAiStuck = onAiStuck;
    this.#stuckThresholdMinutes = stuckThresholdMinutes;
    this.#stuckAction = stuckAction;
    this.#stuckRetryPrompt = stuckRetryPrompt;
  }

  /**
   * 获取当前活动会话 ID
   * @returns {string|null} 活动会话 ID
   */
  get activeSessionID() {
    return this.#activeSessionID;
  }

  /**
   * 获取中断状态
   * @returns {boolean} 是否处于中断状态
   */
  get interrupted() {
    return this.#interrupted;
  }

  /**
   * 获取用户输入状态
   * @returns {boolean} 是否有未提交的输入
   */
  get hasUncommittedInput() {
    return this.#hasUncommittedInput;
  }

  /**
   * 获取页面滚动状态
   * @returns {boolean} 用户是否正在滚动页面
   */
  get isScrolling() {
    return this.#isScrolling;
  }

  /**
   * 获取 AI 卡死处置策略
   * @returns {string} 处置策略（ignore/abort/abort_and_retry）
   */
  get stuckAction() {
    return this.#stuckAction;
  }

  /**
   * 获取 AI 卡死重试提示词
   * @returns {string} 重试提示词
   */
  get stuckRetryPrompt() {
    return this.#stuckRetryPrompt;
  }

  /**
   * 设置用户输入状态
   * @param {boolean} value - 是否有未提交的输入
   */
  setHasUncommittedInput(value) {
    this.#hasUncommittedInput = value;
    this.#log('INPUT_STATE', `Uncommitted input state: ${value}`);
  }

  /**
   * 设置页面滚动状态
   * @param {boolean} value - 用户是否正在滚动页面
   */
  setIsScrolling(value) {
    this.#isScrolling = value;
    this.#log('SCROLL_STATE', `Page scrolling state: ${value}`);
  }

  /**
   * 设置跳过下一个用户消息的标志
   * @param {number} delayMs - 延迟时间（毫秒），0 表示永久跳过直到手动清除
   */
  setSkipNextUserMessage(delayMs = 1000) {
    if (this.#skipNextUserMessageTimer) {
      clearTimeout(this.#skipNextUserMessageTimer);
      this.#skipNextUserMessageTimer = null;
    }
    this.#skipNextUserMessage = true;
    
    if (delayMs > 0) {
      this.#skipNextUserMessageTimer = setTimeout(() => {
        this.#skipNextUserMessage = false;
        this.#skipNextUserMessageTimer = null;
      }, delayMs);
    }
  }

  /**
   * 设置跳过下一个空闲退出的标志
   * @param {number} delayMs - 延迟时间（毫秒）
   */
  setSkipNextIdleExit(delayMs = 2000) {
    if (this.#skipNextIdleExitTimer) {
      clearTimeout(this.#skipNextIdleExitTimer);
      this.#skipNextIdleExitTimer = null;
    }
    this.#skipNextIdleExit = true;
    
    if (delayMs > 0) {
      this.#skipNextIdleExitTimer = setTimeout(() => {
        this.#skipNextIdleExit = false;
        this.#skipNextIdleExitTimer = null;
      }, delayMs);
    }
  }

  /**
   * 清除跳过下一个用户消息的标志
   */
  clearSkipNextUserMessage() {
    if (this.#skipNextUserMessageTimer) {
      clearTimeout(this.#skipNextUserMessageTimer);
      this.#skipNextUserMessageTimer = null;
    }
    this.#skipNextUserMessage = false;
  }

  /**
   * 设置提示词发送状态
   * @param {boolean} value - 提示词是否正在发送中
   */
  setPromptInFlight(value) {
    this.#promptInFlight = value;
  }

  /**
   * 调度空闲检查（去抖机制）
   * @private
   * @param {string} sessionID - 会话 ID
   * @param {number} delay - 延迟时间（毫秒）
   */
  #scheduleCheck(sessionID, delay) {
    const d = delay ?? this.#currentDelay;
    if (this.#pendingCheck) clearTimeout(this.#pendingCheck);
    this.#pendingCheck = setTimeout(() => {
      this.#pendingCheck = null;

      if (this.#interrupted) {
        this.#log('SKIP', `session=${sessionID} interrupted flag set, skipping idle`);
        return;
      }

      if (this.#hasUncommittedInput) {
        this.#log('SKIP', `session=${sessionID} user has uncommitted input, skipping idle`);
        return;
      }

      if (this.#isScrolling) {
        this.#log('SKIP', `session=${sessionID} user is scrolling page, skipping idle`);
        return;
      }

      const trueIdle = this.#status === 'idle' && !this.#waitingPermission && !this.#waitingQuestion;
      if (trueIdle) {
        this.#log('TRUE_IDLE', `session=${sessionID} status=idle perm=off quest=off input=empty scroll=off delay=${d}`);
        this.#currentDelay *= 2;
        this.#onIdle(sessionID);
      } else {
        this.#log('SKIP', `session=${sessionID} not true idle: status=${this.#status} perm=${this.#waitingPermission} quest=${this.#waitingQuestion}`);
      }
    }, d);
  }

  /**
   * 调度 AI 卡死检查
   * @private
   * @param {string} sessionID - 会话 ID
   */
  #scheduleStuckCheck(sessionID) {
    if (this.#stuckCheckTimer) clearTimeout(this.#stuckCheckTimer);
    this.#stuckCheckTimer = setTimeout(() => {
      this.#stuckCheckTimer = null;
      if (this.#status === 'busy' && !this.#waitingPermission && !this.#waitingQuestion) {
        const timeSinceLastActivity = Date.now() - this.#lastActivityAt;
        const thresholdMs = this.#stuckThresholdMinutes * 60 * 1000;
        if (timeSinceLastActivity >= thresholdMs && this.#lastActivityAt !== null) {
          this.#log('AI_STUCK', `session=${sessionID} no activity for ${Math.round(timeSinceLastActivity / 1000 / 60)} minutes, threshold=${this.#stuckThresholdMinutes} minutes`);
          this.#onAiStuck?.(sessionID, { action: this.#stuckAction, retryPrompt: this.#stuckRetryPrompt });
        } else {
          this.#scheduleStuckCheck(sessionID);
        }
      }
    }, 60000);
  }

  /**
   * 记录 AI 活动时间
   * @private
   */
  #recordActivity() {
    this.#lastActivityAt = Date.now();
  }

  /**
   * 记录用户输入活动时间
   * @private
   */
  #recordUserInputActivity() {
    this.#lastUserInputActivityAt = Date.now();
    this.#log('USER_INPUT_ACTIVITY', `user input detected at ${this.#lastUserInputActivityAt}`);
    this.#onUserInputActivity?.();
  }

  /**
   * 处理会话取消事件
   * @param {string} sessionID - 会话 ID
   */
  handleCancel(sessionID) {
    if (this.#pendingCheck) {
      clearTimeout(this.#pendingCheck);
      this.#pendingCheck = null;
    }
    this.#interrupted = true;
    this.#log('INTERRUPT', `session=${sessionID} session cancelled by user (ESC)`);
    this.#onUserInterrupt?.(sessionID);
  }

  /**
   * 处理用户输入事件
   * @param {string} sessionID - 会话 ID
   */
  handleUserInput(sessionID) {
    if (this.#pendingCheck) {
      clearTimeout(this.#pendingCheck);
      this.#pendingCheck = null;
    }
    if (this.#status === 'idle') {
      this.#log('IDLE_END', `session=${sessionID} handleUserInput while idle`);
      this.#onIdleExit?.(sessionID);
    }
    this.#interrupted = false;
    this.#waitingPermission = false;
    this.#waitingQuestion = false;
    this.#status = 'busy';
    this.#currentDelay = this.#BASE_DELAY;
    this.#log('RESET', `session=${sessionID} state reset on user input`);
  }

  /**
   * 处理聊天消息事件
   * @param {Object} input - 输入对象
   * @param {string} input.sessionID - 会话 ID
   * @param {string} input.messageID - 消息 ID
   * @param {Object} output - 输出对象
   * @param {Object} output.message - 消息对象
   */
  handleChatMessage(input, output) {
    const { sessionID, messageID } = input;
    const { message } = output;
    const role = message?.role || 'unknown';

    if (role === 'assistant' && message?.error?.name === 'AbortedError') {
      this.#interrupted = true;
      this.#log('INTERRUPT', `session=${sessionID} msg=${messageID} AI response aborted by user`);
      this.#onUserInterrupt?.(sessionID);
    } else if (role === 'user') {
      if (!this.#skipNextUserMessage) {
        this.#log('USER_INPUT', `session=${sessionID} msg=${messageID} manual user input`);
        if (!this.#promptInFlight) {
          this.handleUserInput(sessionID);
          this.#onUserInput?.(sessionID);
        }
      }
    }
    this.#skipNextUserMessage = false;
  }

  /**
   * 处理消息相关事件（心跳、用户输入、滚动等）
   * @param {Object} inputEvent - 事件对象
   * @param {Object} inputEvent.event - 事件数据
   * @param {string} inputEvent.event.type - 事件类型
   * @param {Object} inputEvent.event.properties - 事件属性
   * @param {Object} inputEvent.event.data - 事件数据
   */
  handleMessageEvent({ event }) {
    if (!event) return;
    const { type, properties = {}, data = {} } = event;
    const sid = properties.sessionID || data.sessionID || '-';

    switch (type) {
      case 'message.updated':
      case 'message.part.updated':
      case 'message.part.delta':
        if (this.#status === 'busy') {
          this.#recordActivity();
          this.#log('HEARTBEAT', `session=${sid} activity detected at ${this.#lastActivityAt}`);
        }
        break;
      case 'tui.prompt.append':
        this.#recordUserInputActivity();
        break;
      case 'tui.prompt.content':
        const content = properties.content || data.content;
        const hasContent = content !== undefined && content !== null && content.length > 0;
        this.setHasUncommittedInput(hasContent);
        break;
      case 'ui.scroll':
        this.setIsScrolling(true);
        break;
      case 'ui.scroll.end':
        this.setIsScrolling(false);
        break;
    }
  }

  /**
   * 处理 OpenCode 事件（会话状态、权限、问题等）
   * @param {Object} inputEvent - 事件对象
   * @param {Object} inputEvent.event - 事件数据
   * @param {string} inputEvent.event.type - 事件类型
   * @param {Object} inputEvent.event.properties - 事件属性
   * @param {Object} inputEvent.event.data - 事件数据
   */
  handleEvent({ event }) {
    if (!event) return;
    const { type, properties = {}, data = {} } = event;
    const sid = properties.sessionID || data.sessionID || properties.info?.id || '-';

    switch (type) {
      case 'session.status': {
        const s = properties.status;
        if (!s || !s.type) break;
        const oldStatus = this.#status;
        this.#status = s.type;
        this.#log('STATUS', `session=${sid} ${oldStatus} -> ${s.type}`);

        if (s.type === 'idle' && !this.#waitingPermission && !this.#waitingQuestion) {
          this.#log('CANDIDATE', `session=${sid} idle, scheduling check`);
          this.#scheduleCheck(sid);
        }

        if (oldStatus === 'idle' && s.type === 'busy') {
          this.#currentDelay = this.#BASE_DELAY;
          this.#lastActivityAt = Date.now();
          this.#scheduleStuckCheck(sid);
          if (!this.#skipNextIdleExit) {
            this.#log('IDLE_END', `session=${sid} idle -> busy`);
            this.#onIdleExit?.(sid);
          }
        }

        if (s.type === 'busy' && this.#pendingCheck) {
          clearTimeout(this.#pendingCheck);
          this.#pendingCheck = null;
          this.#log('DEBOUNCE', `session=${sid} cancelled (new busy)`);
        }

        if (oldStatus === 'busy' && s.type === 'idle') {
          if (this.#stuckCheckTimer) {
            clearTimeout(this.#stuckCheckTimer);
            this.#stuckCheckTimer = null;
            this.#log('STUCK_CHECK', `session=${sid} stuck check cancelled (idle)`);
          }
        }
        break;
      }
      case 'session.idle': {
        this.#activeSessionID = sid;
        this.#idleSince = Date.now();
        this.#log('IDLE', `session=${sid}`);
        break;
      }
      case 'permission.asked': {
        this.#waitingPermission = true;
        this.#log('PERM', `session=${sid} WAITING action=${properties.action}`);
        break;
      }
      case 'permission.replied': {
        this.#waitingPermission = false;
        this.#log('PERM', `session=${sid} RESOLVED reply=${properties.reply}`);
        if (this.#status === 'idle') this.#scheduleCheck(sid, 200);
        break;
      }
      case 'question.asked': {
        this.#waitingQuestion = true;
        this.#log('QUEST', `session=${sid} WAITING`);
        break;
      }
      case 'question.replied':
      case 'question.rejected': {
        this.#waitingQuestion = false;
        this.#log('QUEST', `session=${sid} RESOLVED`);
        if (this.#status === 'idle') this.#scheduleCheck(sid, 200);
        break;
      }
      case 'session.error': {
        const err = properties.error || data.error;
        if (err?.name === 'AbortedError') {
          this.#interrupted = true;
          this.#log('INTERRUPT', `session=${sid} session.error with AbortedError`);
          this.#onUserInterrupt?.(sid);
        }
        break;
      }
    }
  }

  /**
   * 清理资源，释放定时器
   */
  dispose() {
    if (this.#pendingCheck) {
      clearTimeout(this.#pendingCheck);
      this.#pendingCheck = null;
    }
    if (this.#skipNextUserMessageTimer) {
      clearTimeout(this.#skipNextUserMessageTimer);
      this.#skipNextUserMessageTimer = null;
    }
    if (this.#skipNextIdleExitTimer) {
      clearTimeout(this.#skipNextIdleExitTimer);
      this.#skipNextIdleExitTimer = null;
    }
    if (this.#stuckCheckTimer) {
      clearTimeout(this.#stuckCheckTimer);
      this.#stuckCheckTimer = null;
    }
  }
}
