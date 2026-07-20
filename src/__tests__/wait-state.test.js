import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FileWatch, WaitState } from '../wait-state.js';

// Mock file-system-level functions
vi.mock('../file-utils.js', () => {
  let state = {};
  return {
    readFileSnapshot: vi.fn((fp) => state[fp]?.snapshot ?? null),
    fileChanged: vi.fn((snap, fp) => {
      const cur = state[fp]?.snapshot;
      if (cur === null && snap === null) return false;
      if (cur === null || snap === null) return true;
      return cur.mtime !== snap.mtime || cur.size !== snap.size;
    }),
    getFileMtime: vi.fn((fp) => state[fp]?.prompt?.mtime ?? 0),
    loadPromptFile: vi.fn((fp) => state[fp]?.prompt ?? { content: '', mtime: 0 }),
    __setState(s) { state = s; },
  };
});

describe('FileWatch', () => {
  let log;
  let fileUtils;

  beforeEach(async () => {
    log = vi.fn();
    fileUtils = await vi.importMock('../file-utils.js');
  });

  it('should read prompt content', () => {
    fileUtils.__setState({
      '/tmp/prompt.md': {
        prompt: { content: 'hello', mtime: 100 },
      },
    });
    const fw = new FileWatch({
      promptFilePath: '/tmp/prompt.md',
      watchFilePaths: [],
      log,
    });
    expect(fw.readPrompt()).toBe('hello');
  });

  it('should detect file changes via hasFilesChanged', () => {
    fileUtils.__setState({
      '/tmp/task.md': {
        snapshot: { mtime: 100, size: 5 },
        prompt: { content: '', mtime: 0 },
      },
    });
    const fw = new FileWatch({
      promptFilePath: '/tmp/prompt.md',
      watchFilePaths: ['/tmp/task.md'],
      log,
    });
    expect(fw.hasFilesChanged()).toBe(false);

    // Modify the file
    fileUtils.__setState({
      '/tmp/task.md': {
        snapshot: { mtime: 200, size: 10 },
        prompt: { content: '', mtime: 0 },
      },
    });
    expect(fw.hasFilesChanged()).toBe(true);
  });

  it('should sync file state via syncToLatest', () => {
    fileUtils.__setState({
      '/tmp/task.md': {
        snapshot: { mtime: 100, size: 5 },
        prompt: { content: '', mtime: 0 },
      },
    });
    const fw = new FileWatch({
      promptFilePath: '/tmp/prompt.md',
      watchFilePaths: ['/tmp/task.md'],
      log,
    });

    // File changed externally
    fileUtils.__setState({
      '/tmp/task.md': {
        snapshot: { mtime: 200, size: 10 },
        prompt: { content: '', mtime: 0 },
      },
    });
    expect(fw.hasFilesChanged()).toBe(true);

    // Sync → snapshots match current state
    fw.syncToLatest();
    expect(fw.hasFilesChanged()).toBe(false);
  });
});

describe('WaitState', () => {
  let log;
  let fileWatch;
  let sendPrompt;
  let isSessionIdle;
  let ws;

  beforeEach(() => {
    vi.useFakeTimers();
    log = vi.fn();

    const fwMock = {
      readPrompt: vi.fn().mockReturnValue('prompt content'),
      hasFilesChanged: vi.fn().mockReturnValue(false),
      syncToLatest: vi.fn(),
    };
    fileWatch = fwMock;

    sendPrompt = vi.fn().mockResolvedValue(undefined);
    isSessionIdle = vi.fn().mockReturnValue(true);

    ws = new WaitState({
      initialIntervalMinutes: 30,
      maxIdleCycles: 5,
      fileWatch,
      sendPrompt,
      isSessionIdle,
      log,
    });
  });

  afterEach(() => {
    ws.dispose();
    vi.useRealTimers();
  });

  // 22. onIdle sends prompt
  it('should send prompt on first onIdle and schedule timer', async () => {
    ws.onIdle('s1');

    // Wait for microtasks (sendPrompt is async but resolved)
    await vi.advanceTimersByTimeAsync(0);

    expect(sendPrompt).toHaveBeenCalledTimes(1);
    expect(sendPrompt).toHaveBeenCalledWith('s1');

    // Timer is scheduled
    expect(isSessionIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30 * 60 * 1000 - 1);
    expect(isSessionIdle).not.toHaveBeenCalled();

    // Timer fires
    vi.advanceTimersByTime(1);
    expect(isSessionIdle).toHaveBeenCalled();
  });

  // 23. onIdle is idempotent
  it('should be idempotent — second onIdle does not send another prompt', async () => {
    ws.onIdle('s1');
    ws.onIdle('s1');
    ws.onIdle('s1');

    await vi.advanceTimersByTimeAsync(0);

    expect(sendPrompt).toHaveBeenCalledTimes(1);
  });

  // 24. onIdleExit resets state
  it('should reset on onIdleExit so next onIdle works again', async () => {
    ws.onIdle('s1');
    await vi.advanceTimersByTimeAsync(0);
    expect(sendPrompt).toHaveBeenCalledTimes(1);

    ws.onIdleExit();

    expect(fileWatch.syncToLatest).toHaveBeenCalled();

    // Second onIdle works (state was reset)
    ws.onIdle('s1');
    await vi.advanceTimersByTimeAsync(0);
    expect(sendPrompt).toHaveBeenCalledTimes(2);
  });

  // 25. Timer fires → sends prompt again
  it('should send another prompt when the scheduled timer fires', async () => {
    ws.onIdle('s1');
    await vi.advanceTimersByTimeAsync(0);
    expect(sendPrompt).toHaveBeenCalledTimes(1);

    // Advance to timer fire
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

    expect(sendPrompt).toHaveBeenCalledTimes(2);
    expect(sendPrompt).toHaveBeenLastCalledWith('s1');
  });

  // 26. Timer fire → file changed → no new prompt, state resets
  it('should reset without sending prompt when timer detects file change', async () => {
    ws.onIdle('s1');
    await vi.advanceTimersByTimeAsync(0);
    expect(sendPrompt).toHaveBeenCalledTimes(1);

    fileWatch.hasFilesChanged.mockReturnValue(true);

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

    expect(sendPrompt).toHaveBeenCalledTimes(1);
    expect(fileWatch.syncToLatest).toHaveBeenCalledTimes(1);

    // State reset → next onIdle works
    ws.onIdle('s2');
    await vi.advanceTimersByTimeAsync(0);
    expect(sendPrompt).toHaveBeenCalledTimes(2);
  });

  // 27. Timer fire → not idle → resets
  it('should reset when session is no longer idle on timer fire', async () => {
    ws.onIdle('s1');
    await vi.advanceTimersByTimeAsync(0);
    expect(sendPrompt).toHaveBeenCalledTimes(1);

    isSessionIdle.mockReturnValue(false);

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

    expect(sendPrompt).toHaveBeenCalledTimes(1);

    // Reset → next onIdle works
    ws.onIdle('s2');
    await vi.advanceTimersByTimeAsync(0);
    expect(sendPrompt).toHaveBeenCalledTimes(2);
  });

  // 28. Backoff: interval doubles after max cycles
  it('should double interval after max_idle_cycles', async () => {
    ws.onIdle('s1');
    await vi.advanceTimersByTimeAsync(0);
    expect(sendPrompt).toHaveBeenCalledTimes(1);

    // Advance 5 × 30 min = 150 min.
    // Timer fires at t=30, 60, 90, 120 (4 timer prompts).
    // At t=120 the 4th timer fires: idleCycles = 5 → doubles interval to 60.
    // Next timer at t=180 (60 min from t=120).
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    }
    // 1 initial + 4 timer prompts = 5 total
    expect(sendPrompt).toHaveBeenCalledTimes(5);

    sendPrompt.mockClear();

    // Advance to t=180 → timer fires (doubled 60 min period from t=120)
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(sendPrompt).toHaveBeenCalledTimes(1); // 6th prompt

    // Verify NEXT interval is also 60 min (persistent doubling)
    sendPrompt.mockClear();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(sendPrompt).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(sendPrompt).toHaveBeenCalledTimes(1); // 7th prompt
  });

  // 29. onIdleExit after backoff → resets interval
  it('should reset interval on idle exit after backoff', async () => {
    ws.onIdle('s1');
    await vi.advanceTimersByTimeAsync(0);
    expect(sendPrompt).toHaveBeenCalledTimes(1);

    // Double the interval (same logic as test 28)
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    }
    expect(sendPrompt).toHaveBeenCalledTimes(5);

    // idle-exit → reset
    ws.onIdleExit();
    sendPrompt.mockClear();

    // New onIdle should use initial 30 min interval
    ws.onIdle('s2');
    await vi.advanceTimersByTimeAsync(0);
    expect(sendPrompt).toHaveBeenCalledTimes(1);

    // Wait 30 min → should fire (initial interval)
    sendPrompt.mockClear();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(sendPrompt).toHaveBeenCalledTimes(1);
  });

  // 30. Dispose cleans timer
  it('should clean up on dispose', async () => {
    ws.onIdle('s1');
    await vi.advanceTimersByTimeAsync(0);
    expect(sendPrompt).toHaveBeenCalledTimes(1);

    ws.dispose();

    sendPrompt.mockClear();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  // 31. reset() clears state and stops timer
  it('should reset state via public reset()', async () => {
    ws.onIdle('s1');
    await vi.advanceTimersByTimeAsync(0);
    expect(sendPrompt).toHaveBeenCalledTimes(1);

    ws.reset();

    sendPrompt.mockClear();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(sendPrompt).not.toHaveBeenCalled();

    // Can be re-entered after reset
    ws.onIdle('s2');
    await vi.advanceTimersByTimeAsync(0);
    expect(sendPrompt).toHaveBeenCalledTimes(1);
  });

  // 32. #sendAndCheck guards against stale execution after reset
  it('should not continue sendAndCheck after reset', async () => {
    ws.onIdle('s1');
    await vi.advanceTimersByTimeAsync(0);
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    sendPrompt.mockClear();

    // Reset during sendPrompt (simulated by reset before sendPrompt is called)
    ws.reset();

    // Stale timer should not fire
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  // 33. onUserInterrupt blocks onIdle
  it('should skip onIdle after onUserInterrupt', async () => {
    ws.onUserInterrupt('s1');

    ws.onIdle('s2');
    await vi.advanceTimersByTimeAsync(0);

    expect(sendPrompt).not.toHaveBeenCalled();
  });

  // 34. onUserInput clears interrupt flag
  it('should resume onIdle after onUserInput clears interrupt', async () => {
    ws.onUserInterrupt('s1');

    ws.onIdle('s2');
    await vi.advanceTimersByTimeAsync(0);
    expect(sendPrompt).not.toHaveBeenCalled();

    ws.onUserInput('s3');

    ws.onIdle('s4');
    await vi.advanceTimersByTimeAsync(0);
    expect(sendPrompt).toHaveBeenCalledTimes(1);
  });

  // 35. onUserInterrupt resets active wait state
  it('should reset active wait state on interrupt', async () => {
    ws.onIdle('s1');
    await vi.advanceTimersByTimeAsync(0);
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    sendPrompt.mockClear();

    // Interrupt while wait state is active
    ws.onUserInterrupt('s1');

    // Timer should not fire (reset by interrupt)
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  // 36. Interrupted flag prevents timer from sending prompt
  it('should not send prompt on timer when interrupted', async () => {
    ws.onIdle('s1');
    await vi.advanceTimersByTimeAsync(0);
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    sendPrompt.mockClear();

    // Wait timer fires normally
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    sendPrompt.mockClear();

    // Set interrupted, advance another interval
    ws.onUserInterrupt('s1');
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(sendPrompt).not.toHaveBeenCalled();
  });
});
