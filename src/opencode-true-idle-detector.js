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
 * ### 临时抑制状态 (统一管理)
 * - `#idleExitSuppressor`: idle退出抑制器
 * - `#userMessageSuppressor`: 用户消息抑制器
 * - `#promptInFlight`: 提示词正在发送中
 * 
 * ### 用户活动状态
 * - 注意：OpenCode 目前不支持 tui.prompt.content、ui.scroll 等UI事件
 * - 用户活动检测通过以下机制实现：
 *   - `tui.prompt.append` 事件：检测用户输入活动（输入文本时触发）
 *   - `chat.message` hook：检测用户发送消息
 *   - `message.part.delta` 事件：检测AI生成活动
 * - **限制**：无法检测页面滚动活动，需要向OpenCode团队请求添加滚动事件
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
 *   !#promptInFlight &&             // 提示词不在发送中
 *   !#idleExitSuppressor.isSuppressed() &&   // 不在idle退出抑制期间
 *   !#userMessageSuppressor.isSuppressed() // 不在用户消息抑制期间
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
 * | `user message` | !promptInFlight && !userMessageSuppressor.isSuppressed() | status=busy, cleared | onUserInput |
 * | `assistant error: AbortedError` | - | interrupted=true | onUserInterrupt |
 * | `user input` | - | interrupted=false, clearSuppressors | - |
 * | `message.part.delta` | status=busy | lastActivityAt=now | - |
 * | `suppressIdleExit(duration)` | - | idleExitSuppressor.suppress(duration) | - |
 * | `suppressUserMessage(duration)` | - | userMessageSuppressor.suppress(duration) | - |
 * 
 * ## 定时器管理
 * 
 * - `#pendingCheck`: 空闲检查定时器 (基于baseDelay，支持指数退避)
 * - `#stuckCheckTimer`: AI卡死检查定时器 (60秒周期)
 * 
 * ## 抑制器使用场景
 * 
 * ### idleExitSuppressor 使用场景
 * - 插件发送提示词后1-2秒内跳过idle退出事件
 * - AI卡死恢复后30秒内跳过idle退出事件
 * - 其他插件操作期间防止意外的idle退出
 * 
 * ### userMessageSuppressor 使用场景  
 * - 插件发送提示词后2秒内跳过用户消息处理
 * - AI卡死恢复后32秒内跳过用户消息处理
 * - 防止插件自身消息被当作用户输入
 * 
 * ## 注意事项
 * 
 * 1. **状态原子性**: 所有状态修改应该是原子性的，避免中间状态暴露
 * 2. **定时器清理**: dispose时必须清理所有定时器，防止内存泄漏
 * 3. **回调幂等性**: 所有回调都应该幂等，避免重复调用
 * 4. **条件完整性**: trueIdle检查必须包含所有阻止条件，避免误触发
 * 5. **抑制器统一管理**: 所有临时跳过状态通过抑制器统一管理，避免分散
 * 
 * @class OpenCodeTrueIdleDetector
 */
export class OpenCodeTrueIdleDetector {
  /**
   * 活跃抑制器 - 管理临时跳过状态
   * 
   * 集中管理所有临时跳过状态和过期时间，避免状态不一致。
   * 
   * @private
   */
  #Suppressor = class {
    #active = false;
    #expiryTime = 0;
    #reason = null;
    #log;
    #name;

    constructor(log, name = 'Suppressor') {
      this.#log = log;
      this.#name = name;
    }

    suppress(durationMs, reason = 'unknown') {
      this.#active = true;
      this.#expiryTime = Date.now() + durationMs;
      this.#reason = reason;
      this.#log(this.#name.toUpperCase(), `suppressed for ${durationMs}ms, reason: ${reason}`);
    }

    isSuppressed() {
      if (!this.#active) return false;
      
      if (this.#expiryTime !== Infinity && Date.now() >= this.#expiryTime) {
        this.#active = false;
        this.#reason = null;
        this.#log(this.#name.toUpperCase(), 'suppress expired');
        return false;
      }
      return true;
    }

    clear() {
      if (this.#active) {
        this.#log(this.#name.toUpperCase(), 'cleared manually');
      }
      this.#active = false;
      this.#expiryTime = 0;
      this.#reason = null;
    }

    getRemainingTime() {
      if (!this.#active) return 0;
      return Math.max(0, this.#expiryTime - Date.now());
    }

    getStatus() {
      return {
        active: this.isSuppressed(),
        remainingTime: this.getRemainingTime(),
        reason: this.#reason
      };
    }
  };

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
  #idleExitSuppressor;
  #userMessageSuppressor;
  #promptInFlight = false;
  #stuckThresholdMinutes = 20;
  #lastActivityAt = null;
  #stuckCheckTimer = null;
  #lastUserInputActivityAt = null;
  #stuckAction = 'ignore';
  #initialIdleTimer = null;
  #initialIdleDelay = 10 * 60 * 1000; // 10分钟初始延迟
  #userActivitySuppressDuration = 30 * 1000; // 30秒用户活动抑制
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
  constructor({ log, onIdle, onIdleExit, onUserInterrupt, onUserInput, onUserInputActivity, onAiStuck, baseDelay = 15000, stuckThresholdMinutes = 20, stuckAction = 'ignore', stuckRetryPrompt = 'continue', initialIdleDelayMinutes = 10, userActivitySuppressSeconds = 30 }) {
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
    this.#initialIdleDelay = initialIdleDelayMinutes * 60 * 1000;
    this.#userActivitySuppressDuration = userActivitySuppressSeconds * 1000;
    
    this.#idleExitSuppressor = new this.#Suppressor(log, 'IDLE_EXIT');
    this.#userMessageSuppressor = new this.#Suppressor(log, 'USER_MESSAGE');
    
    // 启动初始空闲倒计时
    this.#startInitialIdleCheck();
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
    * 设置提示词发送状态
    * @param {boolean} value - 提示词是否正在发送中
    */
  setPromptInFlight(value) {
    this.#promptInFlight = value;
  }

  /**
    * 获取提示词发送状态
    * @returns {boolean} 提示词是否正在发送中
    */
  get promptInFlight() {
    return this.#promptInFlight;
  }

  /**
    * 抑制空闲退出事件（向后兼容方法）
   * @param {number} delayMs - 抑制持续时间（毫秒），0表示永久抑制直到手动清除
   */
  setSkipNextIdleExit(delayMs = 2000) {
    if (delayMs === 0) {
      this.#idleExitSuppressor.suppress(Infinity, 'permanent skip (backward compatibility)');
    } else {
      this.#idleExitSuppressor.suppress(delayMs, 'backward compatibility');
    }
  }

  /**
   * 抑制用户消息处理（向后兼容方法）
   * @param {number} delayMs - 抑制持续时间（毫秒），0表示永久抑制直到手动清除
   */
  setSkipNextUserMessage(delayMs = 1000) {
    if (delayMs === 0) {
      this.#userMessageSuppressor.suppress(Infinity, 'permanent skip (backward compatibility)');
    } else {
      this.#userMessageSuppressor.suppress(delayMs, 'backward compatibility');
    }
  }

  /**
   * 清除用户消息抑制（向后兼容方法）
   */
  clearSkipNextUserMessage() {
    this.#userMessageSuppressor.clear();
  }

  /**
   * 抑制空闲退出事件（新推荐方法）
   * @param {number} durationMs - 抑制持续时间（毫秒）
   * @param {string} reason - 抑制原因
   */
  suppressIdleExit(durationMs, reason = 'unknown') {
    this.#idleExitSuppressor.suppress(durationMs, reason);
  }

  /**
   * 抑制用户消息处理（新推荐方法）
   * @param {number} durationMs - 抑制持续时间（毫秒）
   * @param {string} reason - 抑制原因
   */
  suppressUserMessage(durationMs, reason = 'unknown') {
    this.#userMessageSuppressor.suppress(durationMs, reason);
  }

  /**
   * 清除所有抑制状态
   */
  clearSuppressors() {
    this.#idleExitSuppressor.clear();
    this.#userMessageSuppressor.clear();
  }

  /**
   * 获取抑制器状态（用于调试）
   * @returns {Object} 抑制器状态信息
   */
  getSuppressorStatus() {
    return {
      idleExit: this.#idleExitSuppressor.getStatus(),
      userMessage: this.#userMessageSuppressor.getStatus()
    };
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

      const trueIdle = this.#status === 'idle' && !this.#waitingPermission && !this.#waitingQuestion;
      if (trueIdle) {
        this.#log('TRUE_IDLE', `session=${sessionID} status=idle perm=off quest=off delay=${d}`);
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
    * 启动初始空闲检查
    * @private
    */
  #startInitialIdleCheck() {
    if (this.#initialIdleTimer) {
      clearTimeout(this.#initialIdleTimer);
    }
    
    this.#log('INIT', `Starting initial idle check: will trigger TRUE_IDLE after ${this.#initialIdleDelay / 1000 / 60} minutes if no user activity`);
    
    this.#initialIdleTimer = setTimeout(() => {
      this.#initialIdleTimer = null;
      
      // 检查是否已被用户活动重置
      const timeSinceLastActivity = this.#lastUserInputActivityAt 
        ? Date.now() - this.#lastUserInputActivityAt 
        : Infinity;
      
      if (timeSinceLastActivity >= this.#initialIdleDelay) {
        this.#log('TRUE_IDLE', `Initial idle period completed, no user activity for ${this.#initialIdleDelay / 1000 / 60} minutes`);
        this.#onIdle('initial');
      } else {
        // 如果有用户活动，重新等待
        this.#log('INIT', `User activity detected, restarting initial idle check`);
        this.#startInitialIdleCheck();
      }
    }, this.#initialIdleDelay);
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
    
    // 重置初始空闲检查
    if (this.#initialIdleTimer) {
      clearTimeout(this.#initialIdleTimer);
      this.#initialIdleTimer = null;
      this.#startInitialIdleCheck();
    }
    
    // 用户活动后抑制30秒
    this.#userMessageSuppressor.suppress(this.#userActivitySuppressDuration, 'user activity suppression');
    this.#idleExitSuppressor.suppress(this.#userActivitySuppressDuration, 'user activity suppression');
    
    this.#log('RESET', `session=${sessionID} state reset on user input, idle detection suppressed for ${this.#userActivitySuppressDuration / 1000} seconds`);
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
       if (!this.#userMessageSuppressor.isSuppressed()) {
         this.#log('USER_INPUT', `session=${sessionID} msg=${messageID} manual user input`);
         if (!this.#promptInFlight) {
           this.handleUserInput(sessionID);
           this.#onUserInput?.(sessionID);
         }
       } else {
         this.#log('USER_INPUT', `session=${sessionID} msg=${messageID} user message suppressed`);
       }
     }
     // 处理完每个用户消息后清除抑制器状态（向后兼容行为）
     this.#userMessageSuppressor.clear();
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

    // Debug: log all message event types to help diagnose missing events
    this.#log('DEBUG_MSG_EVENT', `Received message event: type=${type}, session=${sid}`);

    switch (type) {
      // 用户输入活动检测 - 这是目前可用的关键事件
      case 'tui.prompt.append':
        this.#recordUserInputActivity();
        this.#log('USER_INPUT_ACTIVITY', `User typing detected via tui.prompt.append`);
        break;
      case 'message.updated':
      case 'message.part.updated':
      case 'message.part.delta':
        if (this.#status === 'busy') {
          this.#recordActivity();
          this.#log('HEARTBEAT', `session=${sid} activity detected at ${this.#lastActivityAt}`);
        }
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
          if (!this.#idleExitSuppressor.isSuppressed()) {
            this.#log('IDLE_END', `session=${sid} idle -> busy`);
            this.#onIdleExit?.(sid);
          }
        }

        // 修复：处理会话开始时就是 busy 状态的情况
        if (s.type === 'busy' && this.#lastActivityAt === null) {
          this.#lastActivityAt = Date.now();
          this.#scheduleStuckCheck(sid);
          this.#log('INIT', `session=${sid} initial busy state, stuck check started`);
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
    this.#log('DISPOSE', 'Cleaning up detector resources');
    
    if (this.#pendingCheck) {
      clearTimeout(this.#pendingCheck);
      this.#pendingCheck = null;
    }
    if (this.#stuckCheckTimer) {
      clearTimeout(this.#stuckCheckTimer);
      this.#stuckCheckTimer = null;
    }
    if (this.#initialIdleTimer) {
      clearTimeout(this.#initialIdleTimer);
      this.#initialIdleTimer = null;
    }
    
    // 清理抑制器（Suppressor内部会清理自己的定时器）
    this.#idleExitSuppressor.clear();
    this.#userMessageSuppressor.clear();
    
    this.#log('DISPOSE', 'Detector resources cleaned up');
  }
}
