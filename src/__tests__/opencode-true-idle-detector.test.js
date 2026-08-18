import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenCodeTrueIdleDetector } from '../opencode-true-idle-detector.js';

function createDetector(opts = {}) {
  const log = opts.log ?? vi.fn();
  const onIdle = opts.onIdle ?? vi.fn();
  const onIdleExit = opts.onIdleExit ?? vi.fn();
  const onUserInterrupt = opts.onUserInterrupt ?? vi.fn();
  const onUserInput = opts.onUserInput ?? vi.fn();
  const onUserInputActivity = opts.onUserInputActivity ?? vi.fn();
  const onAiStuck = opts.onAiStuck ?? vi.fn();
  const detector = new OpenCodeTrueIdleDetector({
    log, onIdle, onIdleExit, onUserInterrupt, onUserInput, onUserInputActivity, onAiStuck,
    baseDelay: 200,
    stuckThresholdMinutes: opts.stuckThresholdMinutes,
    stuckAction: opts.stuckAction ?? 'ignore',
    stuckRetryPrompt: opts.stuckRetryPrompt ?? 'continue',
  });
  return { detector, log, onIdle, onIdleExit, onUserInterrupt, onUserInput, onUserInputActivity, onAiStuck };
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
    // 13. AbortedError via handleChatMessage (fixed from MessageAbortedError)
    it('should detect interrupt via handleChatMessage with AbortedError', async () => {
      det.detector.handleChatMessage(
        { sessionID: 's1', messageID: 'm1' },
        {
          message: { role: 'assistant', error: { name: 'AbortedError', data: { message: 'esc' } } },
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

    // session.error with AbortedError (fixed from MessageAbortedError)
    it('session.error with AbortedError should set #interrupted', async () => {
      det.detector.handleEvent({
        event: {
          type: 'session.error',
          properties: {
            sessionID: 's1',
            error: { name: 'AbortedError', data: { message: 'cancelled' } },
          },
        },
      });

      expect(det.log).toHaveBeenCalledWith('INTERRUPT',
        expect.stringContaining('session.error with AbortedError'));
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

    it('should NOT fire onIdleExit via session.error with AbortedError', async () => {
      det.detector.handleEvent({
        event: {
          type: 'session.error',
          properties: {
            sessionID: 's1',
            error: { name: 'AbortedError', data: { message: 'cancelled' } },
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

    // 7. question.replied restores (fixed from question.replied2)
    it('should recheck when question.replied resolves', async () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });
      det.detector.handleEvent({
        event: { type: 'question.asked', properties: { sessionID: 's1' } },
      });
      det.detector.handleEvent({
        event: { type: 'question.replied', properties: { sessionID: 's1' } },
      });

      vi.advanceTimersByTime(200);
      await flush();

      expect(det.onIdle).toHaveBeenCalledWith('s1');
    });

    // 8. question.rejected restores (fixed from question.rejected2)
    it('should recheck when question.rejected resolves', async () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });
      det.detector.handleEvent({
        event: { type: 'question.asked', properties: { sessionID: 's1' } },
      });
      det.detector.handleEvent({
        event: { type: 'question.rejected', properties: { sessionID: 's1' } },
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

  describe('user input activity detection', () => {
    it('should detect user input activity via tui.prompt.append', () => {
      det.detector.handleMessageEvent({
        event: { type: 'tui.prompt.append', properties: { sessionID: 's1' } },
      });

      expect(det.log).toHaveBeenCalledWith('USER_INPUT_ACTIVITY', expect.stringContaining('user input detected'));
      expect(det.onUserInputActivity).toHaveBeenCalled();
    });

    it('should call onUserInputActivity callback when tui.prompt.append occurs', () => {
      det.detector.handleMessageEvent({
        event: { type: 'tui.prompt.append', properties: { sessionID: 's1' } },
      });

      expect(det.onUserInputActivity).toHaveBeenCalledTimes(1);
    });
  });

  describe('AI stuck detection', () => {
    it('should start stuck check when entering busy state', () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } },
      });

      expect(det.log).toHaveBeenCalledWith('STATUS', 'session=s1 idle -> busy');
      expect(det.onIdleExit).toHaveBeenCalledWith('s1');
    });

    it('should cancel stuck check when leaving busy state', () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } },
      });
      vi.clearAllMocks();

      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });

      expect(det.log).toHaveBeenCalledWith('STUCK_CHECK', 'session=s1 stuck check cancelled (idle)');
    });

    it('should record activity on message events during busy state', () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } },
      });

      det.detector.handleMessageEvent({
        event: { type: 'message.updated', properties: { sessionID: 's1' } },
      });
      expect(det.log).toHaveBeenCalledWith('HEARTBEAT', expect.stringContaining('activity detected'));

      det.detector.handleMessageEvent({
        event: { type: 'message.part.updated', properties: { sessionID: 's1' } },
      });
      expect(det.log).toHaveBeenCalledWith('HEARTBEAT', expect.stringContaining('activity detected'));

      det.detector.handleMessageEvent({
        event: { type: 'message.part.delta', properties: { sessionID: 's1' } },
      });
      expect(det.log).toHaveBeenCalledWith('HEARTBEAT', expect.stringContaining('activity detected'));
    });

    it('should NOT record activity during idle state', () => {
      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });

      det.detector.handleMessageEvent({
        event: { type: 'message.updated', properties: { sessionID: 's1' } },
      });
      expect(det.log).not.toHaveBeenCalledWith('HEARTBEAT', expect.stringContaining('activity detected'));
    });

    it('should trigger onAiStuck when no activity for threshold duration', () => {
      const stuckDetector = createDetector({
        stuckThresholdMinutes: 1,
        onAiStuck: vi.fn(),
      });

      stuckDetector.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } },
      });

      vi.advanceTimersByTime(1.5 * 60 * 1000);

      expect(stuckDetector.log).toHaveBeenCalledWith('AI_STUCK', expect.stringContaining('no activity'));
      expect(stuckDetector.onAiStuck).toHaveBeenCalledWith('s1', { action: 'ignore', retryPrompt: 'continue' });

      stuckDetector.detector.dispose();
    });

    it('should NOT trigger onAiStuck when activity occurs within threshold', () => {
      const stuckDetector = createDetector({
        stuckThresholdMinutes: 2,
        onAiStuck: vi.fn(),
      });

      stuckDetector.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } },
      });

      vi.advanceTimersByTime(30 * 1000);

      stuckDetector.detector.handleMessageEvent({
        event: { type: 'message.part.delta', properties: { sessionID: 's1' } },
      });

      vi.advanceTimersByTime(30 * 1000);

      expect(stuckDetector.onAiStuck).not.toHaveBeenCalled();

      stuckDetector.detector.dispose();
    });

    it('should use configured stuck_threshold_minutes parameter', () => {
      const customThresholdDetector = createDetector({
        stuckThresholdMinutes: 0.5,
        onAiStuck: vi.fn(),
      });

      customThresholdDetector.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } },
      });

      vi.advanceTimersByTime(1 * 60 * 1000);

      expect(customThresholdDetector.onAiStuck).toHaveBeenCalledWith('s1', { action: 'ignore', retryPrompt: 'continue' });

      customThresholdDetector.detector.dispose();
    });
  });

  describe('user input state detection', () => {
    it('should set hasUncommittedInput to true when tui.prompt.content has content', () => {
      det.detector.handleMessageEvent({
        event: { type: 'tui.prompt.content', properties: { content: 'test input' } },
      });

      expect(det.detector.hasUncommittedInput).toBe(true);
      expect(det.log).toHaveBeenCalledWith('INPUT_STATE', 'Uncommitted input state: true');
    });

    it('should set hasUncommittedInput to false when tui.prompt.content is empty', () => {
      det.detector.handleMessageEvent({
        event: { type: 'tui.prompt.content', properties: { content: '' } },
      });

      expect(det.detector.hasUncommittedInput).toBe(false);
      expect(det.log).toHaveBeenCalledWith('INPUT_STATE', 'Uncommitted input state: false');
    });

    it('should skip idle detection when hasUncommittedInput is true', async () => {
      det.detector.setHasUncommittedInput(true);

      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });

      vi.advanceTimersByTime(200);
      await flush();

      expect(det.log).toHaveBeenCalledWith('SKIP', expect.stringContaining('user has uncommitted input'));
      expect(det.onIdle).not.toHaveBeenCalled();
    });

    it('should allow setHasUncommittedInput to change input state', () => {
      det.detector.setHasUncommittedInput(true);
      expect(det.detector.hasUncommittedInput).toBe(true);

      det.detector.setHasUncommittedInput(false);
      expect(det.detector.hasUncommittedInput).toBe(false);
    });
  });

  describe('page scroll detection', () => {
    it('should set isScrolling to true on ui.scroll event', () => {
      det.detector.handleMessageEvent({
        event: { type: 'ui.scroll', properties: { sessionID: 's1' } },
      });

      expect(det.detector.isScrolling).toBe(true);
      expect(det.log).toHaveBeenCalledWith('SCROLL_STATE', 'Page scrolling state: true');
    });

    it('should set isScrolling to false on ui.scroll.end event', () => {
      det.detector.handleMessageEvent({
        event: { type: 'ui.scroll', properties: { sessionID: 's1' } },
      });
      expect(det.detector.isScrolling).toBe(true);

      det.detector.handleMessageEvent({
        event: { type: 'ui.scroll.end', properties: { sessionID: 's1' } },
      });

      expect(det.detector.isScrolling).toBe(false);
      expect(det.log).toHaveBeenCalledWith('SCROLL_STATE', 'Page scrolling state: false');
    });

    it('should skip idle detection when isScrolling is true', async () => {
      det.detector.setIsScrolling(true);

      det.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } },
      });

      vi.advanceTimersByTime(200);
      await flush();

      expect(det.log).toHaveBeenCalledWith('SKIP', expect.stringContaining('user is scrolling page'));
      expect(det.onIdle).not.toHaveBeenCalled();
    });

    it('should allow setIsScrolling to change scroll state', () => {
      det.detector.setIsScrolling(true);
      expect(det.detector.isScrolling).toBe(true);

      det.detector.setIsScrolling(false);
      expect(det.detector.isScrolling).toBe(false);
    });
  });

  describe('AI stuck action configuration', () => {
    it('should provide stuck action and retry prompt in onAiStuck callback', () => {
      const configDetector = createDetector({
        stuckThresholdMinutes: 0.5,
        stuckAction: 'abort_and_retry',
        stuckRetryPrompt: 'please continue',
        onAiStuck: vi.fn(),
      });

      configDetector.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } },
      });

      vi.advanceTimersByTime(1 * 60 * 1000);

      expect(configDetector.onAiStuck).toHaveBeenCalledWith('s1', { action: 'abort_and_retry', retryPrompt: 'please continue' });

      configDetector.detector.dispose();
    });

    it('should use default action and prompt when not specified', () => {
      const defaultDetector = createDetector({
        stuckThresholdMinutes: 0.5,
        onAiStuck: vi.fn(),
      });

      defaultDetector.detector.handleEvent({
        event: { type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } },
      });

      vi.advanceTimersByTime(1 * 60 * 1000);

      expect(defaultDetector.onAiStuck).toHaveBeenCalledWith('s1', { action: 'ignore', retryPrompt: 'continue' });

      defaultDetector.detector.dispose();
    });
  });
});
