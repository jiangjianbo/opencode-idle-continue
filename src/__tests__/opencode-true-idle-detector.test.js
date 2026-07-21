import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenCodeTrueIdleDetector } from '../opencode-true-idle-detector.js';

function createDetector(opts = {}) {
  const log = opts.log ?? vi.fn();
  const onIdle = opts.onIdle ?? vi.fn();
  const onIdleExit = opts.onIdleExit ?? vi.fn();
  const onUserInterrupt = opts.onUserInterrupt ?? vi.fn();
  const onUserInput = opts.onUserInput ?? vi.fn();
  const detector = new OpenCodeTrueIdleDetector({
    log, onIdle, onIdleExit, onUserInterrupt, onUserInput,
  });
  return { detector, log, onIdle, onIdleExit, onUserInterrupt, onUserInput };
}

async function flush() {
  await new Promise(r => setTimeout(r, 50));
}

describe('OpenCodeTrueIdleDetector', () => {
  let det;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    det = createDetector();
  });

  afterEach(() => {
    det.detector.dispose();
    vi.useRealTimers();
  });

  describe('basic idle detection', () => {
    // 1. Basic idle detection
    it('should detect TRUE_IDLE and call onIdle', async () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });
      det.detector.handleEvent({
        event: { type: 'session.idle', properties: { sessionID: 's1' } },
      });
      expect(det.log).toHaveBeenCalledWith('CANDIDATE', 'session=s1 idle, scheduling check');

      vi.advanceTimersByTime(200);
      await flush();

      expect(det.log).toHaveBeenCalledWith('TRUE_IDLE', expect.stringContaining('session=s1'));
      expect(det.onIdle).toHaveBeenCalledWith('s1');
    });

    // 2. Busy cancels debounce
    it('should cancel pending check when busy arrives before timeout', async () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });
      expect(det.log).toHaveBeenCalledWith('CANDIDATE', 'session=s1 idle, scheduling check');

      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } },
      });
      expect(det.log).toHaveBeenCalledWith('DEBOUNCE', 'session=s1 cancelled (new busy)');

      vi.advanceTimersByTime(200);
      await flush();

      expect(det.onIdle).not.toHaveBeenCalled();
    });

    // 3. idle → busy → idle resets debounce
    it('should reset debounce on idle after busy', async () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } },
      });
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });

      vi.advanceTimersByTime(200);
      await flush();

      expect(det.onIdle).toHaveBeenCalledTimes(1);
    });

    // 10. dispose clears timers
    it('should clean up pending timer on dispose', async () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });

      det.detector.dispose();
      vi.advanceTimersByTime(200);
      await flush();

      expect(det.onIdle).not.toHaveBeenCalled();
    });
  });

  describe('interrupt handling', () => {
    // 13. MessageAbortedError via handleChatMessage
    it('should detect interrupt via handleChatMessage with MessageAbortedError', async () => {
      det.detector.handleChatMessage(
        { sessionID: 's1', messageID: 'm1' },
        {
          message: { role: 'assistant', error: { name: 'MessageAbortedError', data: { message: 'esc' } } },
          parts: [],
        },
      );

      expect(det.log).toHaveBeenCalledWith('INTERRUPT', 'session=s1 msg=m1 AI response aborted by user');
      expect(det.detector.interrupted).toBe(true);
      expect(det.onUserInterrupt).toHaveBeenCalledWith('s1');
    });

    // 14. Normal assistant message does NOT trigger interrupt
    it('should NOT trigger interrupt for normal assistant message', async () => {
      det.detector.handleChatMessage(
        { sessionID: 's1', messageID: 'm1' },
        { message: { role: 'assistant' }, parts: [{ type: 'text', text: 'ok' }] },
      );

      expect(det.onUserInterrupt).not.toHaveBeenCalled();
      expect(det.detector.interrupted).toBe(false);
    });

    // handleCancel sets interrupted and blocks idle (new)
    it('handleCancel should set #interrupted and block subsequent idle', async () => {
      det.detector.handleCancel('s1');

      expect(det.log).toHaveBeenCalledWith('INTERRUPT', 'session=s1 session cancelled by user (ESC)');
      expect(det.detector.interrupted).toBe(true);
      expect(det.onUserInterrupt).toHaveBeenCalledWith('s1');

      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });
      expect(det.log).toHaveBeenCalledWith('CANDIDATE', 'session=s1 idle, scheduling check');

      vi.advanceTimersByTime(200);
      await flush();

      expect(det.log).toHaveBeenCalledWith('SKIP', expect.stringContaining('interrupted'));
      expect(det.onIdle).not.toHaveBeenCalled();
    });

    // session.error with MessageAbortedError (new)
    it('session.error with MessageAbortedError should set #interrupted', async () => {
      det.detector.handleEvent({
        event: {
          type: 'session.error',
          properties: {
            sessionID: 's1',
            error: { name: 'MessageAbortedError', data: { message: 'cancelled' } },
          },
        },
      });

      expect(det.log).toHaveBeenCalledWith('INTERRUPT',
        expect.stringContaining('session.error with MessageAbortedError'));
      expect(det.detector.interrupted).toBe(true);
      expect(det.onUserInterrupt).toHaveBeenCalledWith('s1');
    });
  });

  describe('user input after interrupt', () => {
    // 15. User role triggers onUserInput
    it('should call onUserInput for manual user message', async () => {
      det.detector.handleChatMessage(
        { sessionID: 's2', messageID: 'm2' },
        { message: { role: 'user' }, parts: [{ type: 'text', text: 'hello' }] },
      );

      expect(det.onUserInput).toHaveBeenCalledWith('s2');
    });

    // 16. skipNextUserMessage blocks onUserInput (replaces promptInFlight)
    it('should NOT call onUserInput when skipNextUserMessage is set', async () => {
      det.detector.setSkipNextUserMessage();
      det.detector.handleChatMessage(
        { sessionID: 's2', messageID: 'm2' },
        { message: { role: 'user' }, parts: [{ type: 'text', text: 'plugin message' }] },
      );

      expect(det.onUserInput).not.toHaveBeenCalled();
      expect(det.onIdleExit).not.toHaveBeenCalled();
    });

    // skipNextUserMessage auto-consumption
    it('should NOT skip subsequent user messages after skipNextUserMessage expires', async () => {
      det.detector.setSkipNextUserMessage();

      det.detector.handleChatMessage(
        { sessionID: 's1', messageID: 'm1' },
        { message: { role: 'user' }, parts: [{ type: 'text', text: 'skipped' }] },
      );
      expect(det.onUserInput).not.toHaveBeenCalled();

      det.detector.handleChatMessage(
        { sessionID: 's1', messageID: 'm2' },
        { message: { role: 'user' }, parts: [{ type: 'text', text: 'real' }] },
      );
      expect(det.onUserInput).toHaveBeenCalledWith('s1');
    });

    // clearSkipNextUserMessage
    it('clearSkipNextUserMessage should allow next user message to be processed', async () => {
      det.detector.setSkipNextUserMessage();
      det.detector.clearSkipNextUserMessage();

      det.detector.handleChatMessage(
        { sessionID: 's1', messageID: 'm1' },
        { message: { role: 'user' }, parts: [{ type: 'text', text: 'real' }] },
      );
      expect(det.onUserInput).toHaveBeenCalledWith('s1');
    });

    // Interrupt → user input → resume idle
    it('should resume idle detection after interrupt + user input', async () => {
      det.detector.handleCancel('s1');
      expect(det.detector.interrupted).toBe(true);

      vi.clearAllMocks();

      det.detector.handleChatMessage(
        { sessionID: 's1', messageID: 'm1' },
        { message: { role: 'user' }, parts: [{ type: 'text', text: 'hi' }] },
      );

      expect(det.detector.interrupted).toBe(false);
      expect(det.onUserInput).toHaveBeenCalledWith('s1');

      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });
      vi.advanceTimersByTime(200);
      await flush();

      expect(det.onIdle).toHaveBeenCalledWith('s1');
    });
  });

  describe('handleUserInput', () => {
    it('should cancel pending check and reset state', async () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });

      det.detector.handleUserInput('s1');

      vi.advanceTimersByTime(200);
      await flush();
      expect(det.onIdle).not.toHaveBeenCalled();
    });

    it('should reset ALL internal state', () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });
      det.detector.handleEvent({
        event: { type: 'permission.asked', properties: { sessionID: 's1', action: 'read' } },
      });
      det.detector.handleCancel('s1');
      vi.clearAllMocks();

      det.detector.handleUserInput('s1');

      expect(det.detector.interrupted).toBe(false);
      expect(det.log).toHaveBeenCalledWith('IDLE_END', 'session=s1 handleUserInput while idle');
      expect(det.log).toHaveBeenCalledWith('RESET', 'session=s1 state reset on user input');
    });
  });

  describe('onIdleExit', () => {
    // 11. idle→busy triggers onIdleExit
    it('should fire onIdleExit when idle→busy transition occurs', async () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });

      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } },
      });

      expect(det.onIdleExit).toHaveBeenCalledWith('s1');
    });

    // 12. idle→idle does NOT trigger onIdleExit
    it('should NOT fire onIdleExit on idle→idle transition', async () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });
      vi.advanceTimersByTime(200);
      await flush();
      expect(det.onIdleExit).not.toHaveBeenCalled();

      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });
      expect(det.onIdleExit).not.toHaveBeenCalled();
    });

    it('should NOT fire onIdleExit on busy→busy', async () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } },
      });
      vi.clearAllMocks();

      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } },
      });

      expect(det.onIdleExit).not.toHaveBeenCalled();
    });

    it('should fire onIdleExit once per idle→busy transition', async () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } },
      });
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } },
      });

      expect(det.onIdleExit).toHaveBeenCalledTimes(1);
    });

    it('should fire onIdleExit when handleUserInput is called while idle', async () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });
      vi.clearAllMocks();

      det.detector.handleUserInput('s1');

      expect(det.log).toHaveBeenCalledWith('IDLE_END', 'session=s1 handleUserInput while idle');
      expect(det.onIdleExit).toHaveBeenCalledWith('s1');
    });

    it('should NOT fire onIdleExit via handleCancel', async () => {
      det.detector.handleCancel('s1');
      expect(det.onIdleExit).not.toHaveBeenCalled();
    });

    it('should NOT fire onIdleExit via session.error with MessageAbortedError', async () => {
      det.detector.handleEvent({
        event: {
          type: 'session.error',
          properties: {
            sessionID: 's1',
            error: { name: 'MessageAbortedError', data: { message: 'cancelled' } },
          },
        },
      });
      expect(det.onIdleExit).not.toHaveBeenCalled();
    });
  });

  describe('session.idle', () => {
    // 9. session.idle updates activeSessionID
    it('should track the latest sessionID', () => {
      expect(det.detector.activeSessionID).toBeNull();

      det.detector.handleEvent({
        event: { type: 'session.idle', properties: { sessionID: 'session-A' } },
      });
      expect(det.detector.activeSessionID).toBe('session-A');

      det.detector.handleEvent({
        event: { type: 'session.idle', properties: { sessionID: 'session-B' } },
      });
      expect(det.detector.activeSessionID).toBe('session-B');
    });
  });

  describe('permission events', () => {
    // 4. permission.asked blocks idle
    it('should delay idle when permission is pending', async () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });
      det.detector.handleEvent({
        event: { type: 'permission.asked', properties: { sessionID: 's1', action: 'read' } },
      });

      vi.advanceTimersByTime(200);
      await flush();

      expect(det.onIdle).not.toHaveBeenCalled();
      expect(det.log).toHaveBeenCalledWith('SKIP', expect.stringContaining('not true idle'));
    });

    // 5. permission.replied restores
    it('should recheck when permission is resolved', async () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });
      det.detector.handleEvent({
        event: { type: 'permission.asked', properties: { sessionID: 's1', action: 'read' } },
      });
      det.detector.handleEvent({
        event: { type: 'permission.replied', properties: { sessionID: 's1', reply: 'allow' } },
      });

      vi.advanceTimersByTime(200);
      await flush();

      expect(det.onIdle).toHaveBeenCalledWith('s1');
    });

    it('should still fire onIdleExit when idle→busy with permission pending', async () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });
      det.detector.handleEvent({
        event: { type: 'permission.asked', properties: { sessionID: 's1', action: 'read' } },
      });

      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } },
      });

      expect(det.onIdleExit).toHaveBeenCalledWith('s1');
    });
  });

  describe('question events', () => {
    // 6. question.asked blocks idle
    it('should delay idle when question is pending', async () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });
      det.detector.handleEvent({
        event: { type: 'question.asked', properties: { sessionID: 's1' } },
      });

      vi.advanceTimersByTime(200);
      await flush();

      expect(det.onIdle).not.toHaveBeenCalled();
      expect(det.log).toHaveBeenCalledWith('SKIP', expect.stringContaining('not true idle'));
    });

    // 7. question.replied2 restores
    it('should recheck when question.replied2 resolves', async () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });
      det.detector.handleEvent({
        event: { type: 'question.asked', properties: { sessionID: 's1' } },
      });
      det.detector.handleEvent({
        event: { type: 'question.replied2', properties: { sessionID: 's1' } },
      });

      vi.advanceTimersByTime(200);
      await flush();

      expect(det.onIdle).toHaveBeenCalledWith('s1');
    });

    // 8. question.rejected2 restores
    it('should recheck when question.rejected2 resolves', async () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });
      det.detector.handleEvent({
        event: { type: 'question.asked', properties: { sessionID: 's1' } },
      });
      det.detector.handleEvent({
        event: { type: 'question.rejected2', properties: { sessionID: 's1' } },
      });

      vi.advanceTimersByTime(200);
      await flush();

      expect(det.onIdle).toHaveBeenCalledWith('s1');
    });
  });

  describe('exponential backoff', () => {
    it('should double delay after each TRUE_IDLE', async () => {
      for (let i = 0; i < 3; i++) {
        det.detector.handleEvent({
          event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
        });
        vi.advanceTimersByTime(200 * Math.pow(2, i));
        await flush();
      }

      const trueIdleCalls = det.log.mock.calls.filter(c => c[0] === 'TRUE_IDLE');
      expect(trueIdleCalls.length).toBe(3);
      expect(det.onIdle).toHaveBeenCalledTimes(3);
    });
  });
});
