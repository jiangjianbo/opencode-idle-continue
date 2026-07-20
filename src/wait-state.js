import { readFileSnapshot, fileChanged, getFileMtime, loadPromptFile } from './file-utils.js';

export class FileWatch {
  #promptFilePath;
  #watchPaths;
  #promptCache;
  #snapshots;
  #log;

  constructor({ promptFilePath, watchFilePaths, log }) {
    this.#promptFilePath = promptFilePath;
    this.#watchPaths = watchFilePaths;
    this.#log = log;
    this.#promptCache = loadPromptFile(promptFilePath);
    this.#snapshots = new Map(
      watchFilePaths.map(fp => [fp, readFileSnapshot(fp)]),
    );
  }

  readPrompt() {
    const mtime = getFileMtime(this.#promptFilePath);
    if (mtime !== this.#promptCache.mtime) {
      this.#promptCache = loadPromptFile(this.#promptFilePath);
      this.#log?.('HOT_RELOAD', `Prompt file reloaded: ${this.#promptFilePath}`);
    }
    return this.#promptCache.content;
  }

  hasFilesChanged() {
    for (const fp of this.#watchPaths) {
      if (fileChanged(this.#snapshots.get(fp), fp)) return true;
    }
    return false;
  }

  syncToLatest() {
    for (const fp of this.#watchPaths) {
      this.#snapshots.set(fp, readFileSnapshot(fp));
    }
  }
}

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

  constructor({ initialIntervalMinutes, maxIdleCycles, fileWatch, sendPrompt, isSessionIdle, log }) {
    this.#initialInterval = initialIntervalMinutes;
    this.#currentInterval = initialIntervalMinutes;
    this.#maxIdleCycles = maxIdleCycles;
    this.#fileWatch = fileWatch;
    this.#sendPrompt = sendPrompt;
    this.#isSessionIdle = isSessionIdle;
    this.#log = log;
  }

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
    this.#sendAndCheck(sessionID);
  }

  onIdleExit() {
    this.#reset();
    this.#fileWatch.syncToLatest();
    this.#log('WAIT', 'WAIT Exited idle, reset and file state synced');
  }

  onUserInterrupt(sessionID) {
    this.#interrupted = true;
    this.#reset();
    this.#log('WAIT', `WAIT Interrupted by user session=${sessionID}, waiting for manual input`);
  }

  onUserInput(sessionID) {
    if (this.#interrupted) {
      this.#log('WAIT', `WAIT User input received session=${sessionID}, resuming idle detection`);
    }
    this.#interrupted = false;
  }

  reset() {
    this.#reset();
  }

  #sendAndCheck(sessionID) {
    (async () => {
      await this.#sendPrompt(sessionID);

      if (!this.#active) return;

      if (this.#fileWatch.hasFilesChanged()) {
        this.#fileWatch.syncToLatest();
        this.#log('WAIT', 'WAIT Files changed, resetting');
        this.#reset();
        return;
      }

      this.#idleCycles++;
      this.#log('WAIT', `WAIT Idle cycles=${this.#idleCycles}/${this.#maxIdleCycles}`);

      if (this.#idleCycles >= this.#maxIdleCycles) {
        this.#currentInterval *= 2;
        this.#log('WAIT', `WAIT Doubling interval to ${this.#currentInterval}min`);
        this.#idleCycles = 0;
      }

      this.#schedule();
    })();
  }

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

  dispose() {
    this.#reset();
  }
}
