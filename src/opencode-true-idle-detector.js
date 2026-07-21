export class OpenCodeTrueIdleDetector {
  #log;
  #BASE_DELAY = 200;
  #currentDelay = this.#BASE_DELAY;
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
  #interrupted = false;
  #skipNextUserMessage = false;
  #skipNextUserMessageTimer = null;
  #skipNextIdleExit = false;
  #skipNextIdleExitTimer = null;

  constructor({ log, onIdle, onIdleExit, onUserInterrupt, onUserInput }) {
    this.#log = log;
    this.#onIdle = onIdle;
    this.#onIdleExit = onIdleExit;
    this.#onUserInterrupt = onUserInterrupt;
    this.#onUserInput = onUserInput;
  }

  get activeSessionID() {
    return this.#activeSessionID;
  }

  get interrupted() {
    return this.#interrupted;
  }

  setSkipNextUserMessage(delayMs = 0) {
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

  setSkipNextIdleExit(delayMs = 0) {
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

  clearSkipNextUserMessage() {
    if (this.#skipNextUserMessageTimer) {
      clearTimeout(this.#skipNextUserMessageTimer);
      this.#skipNextUserMessageTimer = null;
    }
    this.#skipNextUserMessage = false;
  }

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

  handleCancel(sessionID) {
    if (this.#pendingCheck) {
      clearTimeout(this.#pendingCheck);
      this.#pendingCheck = null;
    }
    this.#interrupted = true;
    this.#log('INTERRUPT', `session=${sessionID} session cancelled by user (ESC)`);
    this.#onUserInterrupt?.(sessionID);
  }

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

  handleChatMessage(input, output) {
    const { sessionID, messageID } = input;
    const { message } = output;
    const role = message?.role || 'unknown';

    if (role === 'assistant' && message?.error?.name === 'MessageAbortedError') {
      this.#interrupted = true;
      this.#log('INTERRUPT', `session=${sessionID} msg=${messageID} AI response aborted by user`);
      this.#onUserInterrupt?.(sessionID);
    } else if (role === 'user' && !this.#skipNextUserMessage) {
      this.#log('USER_INPUT', `session=${sessionID} msg=${messageID} manual user input`);
      this.handleUserInput(sessionID);
      this.#onUserInput?.(sessionID);
    }
    this.#skipNextUserMessage = false;
  }

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
      case 'question.replied2':
      case 'question.rejected2': {
        this.#waitingQuestion = false;
        this.#log('QUEST', `session=${sid} RESOLVED`);
        if (this.#status === 'idle') this.#scheduleCheck(sid, 200);
        break;
      }
      case 'session.error': {
        const err = properties.error || data.error;
        if (err?.name === 'MessageAbortedError') {
          this.#interrupted = true;
          this.#log('INTERRUPT', `session=${sid} session.error with MessageAbortedError`);
          this.#onUserInterrupt?.(sid);
        }
        break;
      }
    }
  }

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
  }
}
