export class OpenCodeTrueIdleDetector {
  #log;
  #status = 'idle';
  #waitingPermission = false;
  #waitingQuestion = false;
  #activeSessionID = null;
  #pendingCheck = null;
  #onIdle;
  #onIdleExit;
  #onUserInterrupt;
  #onUserInput;
  #promptInFlight = false;

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

  setPromptInFlight(v) {
    this.#promptInFlight = v;
  }

  #scheduleCheck(sessionID, delay = 200) {
    if (this.#pendingCheck) clearTimeout(this.#pendingCheck);
    this.#pendingCheck = setTimeout(() => {
      this.#pendingCheck = null;
      const trueIdle = this.#status === 'idle' && !this.#waitingPermission && !this.#waitingQuestion;
      if (trueIdle) {
        this.#log('TRUE_IDLE', `session=${sessionID} status=idle perm=off quest=off`);
        this.#onIdle(sessionID);
      } else {
        this.#log('SKIP', `session=${sessionID} not true idle: status=${this.#status} perm=${this.#waitingPermission} quest=${this.#waitingQuestion}`);
      }
    }, delay);
  }

  handleEvent({ event }) {
    const { type, properties = {} } = event;
    const sid = properties.sessionID || properties.info?.id || '-';

    switch (type) {
      case 'session.status': {
        const s = properties.status;
        if (!s || !s.type) break;
        const oldStatus = this.#status;
        this.#status = s.type;
        this.#log('STATUS', `session=${sid} ${oldStatus} -> ${s.type}`);

        if (oldStatus === 'idle' && s.type === 'busy') {
          this.#log('ON_IDLE_EXIT', `session=${sid} idle->busy`);
          this.#onIdleExit?.(sid);
        }

        if (s.type === 'idle' && !this.#waitingPermission && !this.#waitingQuestion) {
          this.#log('CANDIDATE', `session=${sid} idle, scheduling check`);
          this.#scheduleCheck(sid, 200);
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
    }
  }

  handleChatMessage(input, output) {
    const { sessionID, messageID } = input;
    const { message } = output;
    const role = message?.role || 'unknown';

    if (role === 'assistant' && message?.error?.name === 'MessageAbortedError') {
      this.#log('USER_INTERRUPT', `session=${sessionID} msg=${messageID} AI response aborted by user`);
      this.#onUserInterrupt?.(sessionID);
    } else if (role === 'user' && !this.#promptInFlight) {
      this.#log('USER_INPUT', `session=${sessionID} msg=${messageID} manual user input`);
      this.#onUserInput?.(sessionID);
    }
  }

  dispose() {
    if (this.#pendingCheck) {
      clearTimeout(this.#pendingCheck);
      this.#pendingCheck = null;
    }
  }
}
