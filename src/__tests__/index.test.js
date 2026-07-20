import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import plugin from '../index.js';

const { server } = plugin;

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'idle-continue-int-'));
}

function writeJSON(dir, name, obj) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(obj), 'utf-8');
}

function writeFile(dir, name, content) {
  fs.writeFileSync(path.join(dir, name), content, 'utf-8');
}

async function createTestEnv(options = {}) {
  const dir = createTempDir();

  const config = {
    prompt_file: 'prompt.md',
    watch_files: ['task.md', 'wish.md'],
    check_interval_minutes: 30,
    max_idle_cycles: 5,
    enabled: true,
    ...(options.config || {}),
  };

  writeJSON(dir, 'idle-continue.json', config);
  writeFile(dir, config.prompt_file, options.promptContent ?? 'continue working');

  for (const f of config.watch_files) {
    writeFile(dir, f, `${f} content`);
  }

  const mockPrompt = vi.fn().mockResolvedValue(undefined);
  const hooks = await server({
    directory: dir,
    client: { session: { prompt: mockPrompt } },
  });

  return {
    dir,
    hooks,
    mockPrompt,
    config,
    async cleanup() {
      await hooks.dispose();
      vi.useRealTimers();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function idleEvent(sessionID = 's1') {
  return {
    event: {
      type: 'session.status',
      properties: { status: { type: 'idle' }, sessionID },
    },
  };
}

function busyEvent(sessionID = 's1') {
  return {
    event: {
      type: 'session.status',
      properties: { status: { type: 'busy' }, sessionID },
    },
  };
}

describe('Integration: server()', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // 31. idle → prompt → files unchanged → wait state
  it('should send prompt and enter wait state when files do not change', async () => {
    vi.useFakeTimers();
    const env = await createTestEnv();
    try {
      env.hooks.event(idleEvent('s1'));
      await vi.advanceTimersByTimeAsync(200);

      expect(env.mockPrompt).toHaveBeenCalledTimes(1);

      // Wait state active → second idle should NOT trigger onIdle
      env.mockPrompt.mockClear();
      env.hooks.event(idleEvent('s2'));
      await vi.advanceTimersByTimeAsync(200);
      expect(env.mockPrompt).not.toHaveBeenCalled();
    } finally {
      await env.cleanup();
    }
  });

  // 32. idle → prompt → file changed → reset (no wait)
  it('should not enter wait state when watch file changed during initial onIdle', async () => {
    vi.useFakeTimers();
    const env = await createTestEnv();
    try {
      // Modify a watch file before onIdle → first prompt sends, then detects change, resets
      writeFile(env.dir, 'task.md', 'modified before idle');

      env.hooks.event(idleEvent('s1'));
      await vi.advanceTimersByTimeAsync(200);

      expect(env.mockPrompt).toHaveBeenCalledTimes(1);

      // State reset → second idle triggers onIdle again
      env.mockPrompt.mockClear();
      env.hooks.event(idleEvent('s2'));
      await vi.advanceTimersByTimeAsync(200);
      expect(env.mockPrompt).toHaveBeenCalledTimes(1);
    } finally {
      await env.cleanup();
    }
  });

  // 33. Wait timer → file change → exit wait
  it('should exit wait state when wait timer detects file change', async () => {
    vi.useFakeTimers();
    const env = await createTestEnv();
    try {
      env.hooks.event(idleEvent('s1'));
      await vi.advanceTimersByTimeAsync(200);
      expect(env.mockPrompt).toHaveBeenCalledTimes(1);

      writeFile(env.dir, 'task.md', 'modified');
      env.mockPrompt.mockClear();

      // Advance wait timer → detects change → syncs and resets, no prompt
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      expect(env.mockPrompt).not.toHaveBeenCalled();

      // State reset → new idle triggers again
      env.hooks.event(idleEvent('s2'));
      await vi.advanceTimersByTimeAsync(200);
      expect(env.mockPrompt).toHaveBeenCalledTimes(1);
    } finally {
      await env.cleanup();
    }
  });

  // 34. idle-exit → reset + re-snapshot
  it('should reset on idle-exit so next idle works with fresh file state', async () => {
    vi.useFakeTimers();
    const env = await createTestEnv();
    try {
      env.hooks.event(idleEvent('s1'));
      await vi.advanceTimersByTimeAsync(200);
      expect(env.mockPrompt).toHaveBeenCalledTimes(1);

      // Modify a watch file while in wait state
      writeFile(env.dir, 'task.md', 'modified during wait');

      // Busy event → onIdleExit → waitState.onIdleExit() → sync + reset
      env.hooks.event(busyEvent('s1'));

      // File was synced during onIdleExit → snapshots match modified state

      // New idle → trigger (state reset)
      env.mockPrompt.mockClear();
      env.hooks.event(idleEvent('s2'));
      await vi.advanceTimersByTimeAsync(200);
      expect(env.mockPrompt).toHaveBeenCalledTimes(1);
    } finally {
      await env.cleanup();
    }
  });

  // 35. Wait cycle → still idle → resend prompt
  it('should resend prompt on each wait cycle when idle', async () => {
    vi.useFakeTimers();
    const env = await createTestEnv();
    try {
      env.hooks.event(idleEvent('s1'));
      await vi.advanceTimersByTimeAsync(200);
      expect(env.mockPrompt).toHaveBeenCalledTimes(1);

      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      }
      expect(env.mockPrompt).toHaveBeenCalledTimes(4);
    } finally {
      await env.cleanup();
    }
  });

  // 36. max_idle_cycles → interval doubles
  it('should double interval after max_idle_cycles consecutive cycles', async () => {
    vi.useFakeTimers();
    const env = await createTestEnv();
    try {
      env.hooks.event(idleEvent('s1'));
      await vi.advanceTimersByTimeAsync(200);
      expect(env.mockPrompt).toHaveBeenCalledTimes(1);

      // Advance 5 × 30 min = 150 min.
      // Timers fire at t=30, 60, 90, 120 (4 timer prompts).
      // At t=120 the 4th timer triggers doubling (idleCycles reaches max).
      await vi.advanceTimersByTimeAsync(5 * 30 * 60 * 1000);
      // 1 initial + 4 timer prompts = 5 total
      expect(env.mockPrompt).toHaveBeenCalledTimes(5);

      env.mockPrompt.mockClear();

      // Advance to t=180 → timer fires (60 min doubled interval from t=120)
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      expect(env.mockPrompt).toHaveBeenCalledTimes(1); // 6th prompt

      // Verify next interval is also 60 min (persistent doubling)
      env.mockPrompt.mockClear();
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      expect(env.mockPrompt).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      expect(env.mockPrompt).toHaveBeenCalledTimes(1); // 7th prompt
    } finally {
      await env.cleanup();
    }
  });

  // 37. Empty prompt → skip
  it('should skip sending when prompt file is empty', async () => {
    vi.useFakeTimers();
    const env = await createTestEnv({ promptContent: '' });
    try {
      env.hooks.event(idleEvent('s1'));
      await vi.advanceTimersByTimeAsync(200);
      expect(env.mockPrompt).not.toHaveBeenCalled();
    } finally {
      await env.cleanup();
    }
  });

  // 38. Disabled → skip
  it('should skip when plugin is disabled', async () => {
    vi.useFakeTimers();
    const env = await createTestEnv({ config: { enabled: false } });
    try {
      env.hooks.event(idleEvent('s1'));
      await vi.advanceTimersByTimeAsync(200);
      expect(env.mockPrompt).not.toHaveBeenCalled();
    } finally {
      await env.cleanup();
    }
  });

  // 39. Hot reload
  it('should hot-reload prompt content when mtime changes during wait', async () => {
    vi.useFakeTimers();
    const env = await createTestEnv({ promptContent: 'version A' });
    try {
      env.hooks.event(idleEvent('s1'));
      await vi.advanceTimersByTimeAsync(200);
      expect(env.mockPrompt).toHaveBeenCalledTimes(1);
      expect(env.mockPrompt.mock.calls[0][0].body.parts[0].text).toBe('version A');

      const promptPath = path.join(env.dir, 'prompt.md');
      writeFile(env.dir, 'prompt.md', 'version B');
      const now = Date.now() + 2000;
      fs.utimesSync(promptPath, now / 1000, now / 1000);

      // Wait cycle → fileWatch.readPrompt detects hot reload
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      expect(env.mockPrompt).toHaveBeenCalledTimes(2);
      expect(env.mockPrompt.mock.calls[1][0].body.parts[0].text).toBe('version B');
    } finally {
      await env.cleanup();
    }
  });

  // 41. chat.message with MessageAbortedError blocks idle
  it('should block idle after user interrupt via chat.message', async () => {
    vi.useFakeTimers();
    const env = await createTestEnv();
    try {
      env.hooks.event(idleEvent('s1'));
      await vi.advanceTimersByTimeAsync(200);
      expect(env.mockPrompt).toHaveBeenCalledTimes(1);

      // Send chat.message with MessageAbortedError → waitState.onUserInterrupt called
      await env.hooks["chat.message"](
        { sessionID: 's1', messageID: 'm1', model: { providerID: 'test', modelID: 'test' } },
        { message: { role: 'assistant', error: { name: 'MessageAbortedError', data: { message: 'aborted' } } }, parts: [] },
      );

      // Subsequent idle → blocked by waitState.interrupted
      env.hooks.event(idleEvent('s2'));
      await vi.advanceTimersByTimeAsync(200);
      expect(env.mockPrompt).toHaveBeenCalledTimes(1);
    } finally {
      await env.cleanup();
    }
  });

  // 42. Manual user message via chat.message clears interrupt
  it('should resume idle after manual user message clears interrupt', async () => {
    vi.useFakeTimers();
    const env = await createTestEnv();
    try {
      env.hooks.event(idleEvent('s1'));
      await vi.advanceTimersByTimeAsync(200);
      expect(env.mockPrompt).toHaveBeenCalledTimes(1);

      // User interrupt
      await env.hooks["chat.message"](
        { sessionID: 's1', messageID: 'm1', model: { providerID: 'test', modelID: 'test' } },
        { message: { role: 'assistant', error: { name: 'MessageAbortedError', data: { message: 'aborted' } } }, parts: [] },
      );

      // Blocked
      env.hooks.event(idleEvent('s2'));
      await vi.advanceTimersByTimeAsync(200);
      expect(env.mockPrompt).toHaveBeenCalledTimes(1);

      // User sends manual message → detector.onUserInput → waitState.onUserInput → clears interrupt
      await env.hooks["chat.message"](
        { sessionID: 's1', messageID: 'm2', model: { providerID: 'test', modelID: 'test' } },
        { message: { role: 'user' }, parts: [{ type: 'text', text: 'manual' }] },
      );

      // Now idle works again
      env.hooks.event(idleEvent('s3'));
      await vi.advanceTimersByTimeAsync(200);
      expect(env.mockPrompt).toHaveBeenCalledTimes(2);
    } finally {
      await env.cleanup();
    }
  });

  // 43. Dispose cleans all
  it('should clean up all pending timers on dispose', async () => {
    vi.useFakeTimers();
    const env = await createTestEnv();
    try {
      env.hooks.event(idleEvent('s1'));
      await vi.advanceTimersByTimeAsync(200);
      expect(env.mockPrompt).toHaveBeenCalledTimes(1);

      env.mockPrompt.mockClear();
      await env.hooks.dispose();

      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      expect(env.mockPrompt).not.toHaveBeenCalled();
    } finally {
      await env.cleanup();
    }
  });
});
