import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenCodeTrueIdleDetector } from '../opencode-true-idle-detector.js';

describe('OpenCodeTrueIdleDetector', () => {
  let detector;
  let onIdle;
  let onIdleExit;
  let onUserInterrupt;
  let onUserInput;
  let log;

  beforeEach(() => {
    vi.useFakeTimers();
    onIdle = vi.fn();
    onIdleExit = vi.fn();
    onUserInterrupt = vi.fn();
    onUserInput = vi.fn();
    log = vi.fn();
    detector = new OpenCodeTrueIdleDetector({ log, onIdle, onIdleExit, onUserInterrupt, onUserInput });
  });

  afterEach(() => {
    detector.dispose();
    vi.useRealTimers();
  });

  // 1. Basic idle detection
  it('should call onIdle after 200ms debounce on idle status', () => {
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' }, sessionID: 's1' },
      },
    });

    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);

    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(onIdle).toHaveBeenCalledWith('s1');
  });

  // 2. Busy cancels debounce
  it('should cancel debounce when busy is received before 200ms elapses', () => {
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' }, sessionID: 's1' },
      },
    });

    vi.advanceTimersByTime(50);

    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'busy' }, sessionID: 's1' },
      },
    });

    vi.advanceTimersByTime(200);

    expect(onIdle).not.toHaveBeenCalled();
  });

  // 3. idle → busy → idle resets debounce
  it('should reset debounce when idle follows busy', () => {
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' }, sessionID: 's1' },
      },
    });

    vi.advanceTimersByTime(50);

    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'busy' }, sessionID: 's1' },
      },
    });

    vi.advanceTimersByTime(200);

    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' }, sessionID: 's1' },
      },
    });

    vi.advanceTimersByTime(200);

    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  // 4. permission.asked blocks idle
  it('should not call onIdle when permission is pending', () => {
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' }, sessionID: 's1' },
      },
    });

    detector.handleEvent({
      event: {
        type: 'permission.asked',
        properties: { sessionID: 's1', action: 'write' },
      },
    });

    vi.advanceTimersByTime(200);

    expect(onIdle).not.toHaveBeenCalled();
  });

  // 5. permission.replied restores
  it('should call onIdle after permission is replied', () => {
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' }, sessionID: 's1' },
      },
    });

    detector.handleEvent({
      event: {
        type: 'permission.asked',
        properties: { sessionID: 's1', action: 'write' },
      },
    });

    vi.advanceTimersByTime(200);
    expect(onIdle).not.toHaveBeenCalled();

    detector.handleEvent({
      event: {
        type: 'permission.replied',
        properties: { sessionID: 's1', reply: 'allow' },
      },
    });

    vi.advanceTimersByTime(200);

    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  // 6. question.asked blocks idle
  it('should not call onIdle when question is pending', () => {
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' }, sessionID: 's1' },
      },
    });

    detector.handleEvent({
      event: {
        type: 'question.asked',
        properties: { sessionID: 's1' },
      },
    });

    vi.advanceTimersByTime(200);

    expect(onIdle).not.toHaveBeenCalled();
  });

  // 7. question.replied2 restores
  it('should call onIdle after question.replied2', () => {
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' }, sessionID: 's1' },
      },
    });

    detector.handleEvent({
      event: {
        type: 'question.asked',
        properties: { sessionID: 's1' },
      },
    });

    vi.advanceTimersByTime(200);
    expect(onIdle).not.toHaveBeenCalled();

    detector.handleEvent({
      event: {
        type: 'question.replied2',
        properties: { sessionID: 's1' },
      },
    });

    vi.advanceTimersByTime(200);

    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  // 8. question.rejected2 restores
  it('should call onIdle after question.rejected2', () => {
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' }, sessionID: 's1' },
      },
    });

    detector.handleEvent({
      event: {
        type: 'question.asked',
        properties: { sessionID: 's1' },
      },
    });

    vi.advanceTimersByTime(200);
    expect(onIdle).not.toHaveBeenCalled();

    detector.handleEvent({
      event: {
        type: 'question.rejected2',
        properties: { sessionID: 's1' },
      },
    });

    vi.advanceTimersByTime(200);

    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  // 9. session.idle updates activeSessionID
  it('should track the latest sessionID from session.idle events', () => {
    expect(detector.activeSessionID).toBeNull();

    detector.handleEvent({
      event: {
        type: 'session.idle',
        properties: { sessionID: 'session-A' },
      },
    });

    expect(detector.activeSessionID).toBe('session-A');

    detector.handleEvent({
      event: {
        type: 'session.idle',
        properties: { sessionID: 'session-B' },
      },
    });

    expect(detector.activeSessionID).toBe('session-B');
  });

  // 10. dispose clears pending timers
  it('should clear pending timers on dispose', () => {
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' }, sessionID: 's1' },
      },
    });

    detector.dispose();

    vi.advanceTimersByTime(200);

    expect(onIdle).not.toHaveBeenCalled();
  });

  // 11. idle→busy triggers onIdleExit synchronously
  it('should call onIdleExit on idle→busy transition', () => {
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' }, sessionID: 's1' },
      },
    });

    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'busy' }, sessionID: 's1' },
      },
    });

    expect(onIdleExit).toHaveBeenCalledTimes(1);
    expect(onIdleExit).toHaveBeenCalledWith('s1');
  });

  // 12. idle→idle does NOT trigger onIdleExit
  it('should NOT call onIdleExit on idle→idle transition', () => {
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' }, sessionID: 's1' },
      },
    });

    vi.advanceTimersByTime(200);

    expect(onIdleExit).not.toHaveBeenCalled();

    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' }, sessionID: 's2' },
      },
    });

    expect(onIdleExit).not.toHaveBeenCalled();
  });

  // 13. handleChatMessage: MessageAbortedError calls onUserInterrupt
  it('should call onUserInterrupt when assistant message has MessageAbortedError', () => {
    detector.handleChatMessage(
      { sessionID: 's1', messageID: 'm1' },
      {
        message: { role: 'assistant', error: { name: 'MessageAbortedError', data: { message: 'cancelled' } } },
        parts: [],
      },
    );

    expect(onUserInterrupt).toHaveBeenCalledTimes(1);
    expect(onUserInterrupt).toHaveBeenCalledWith('s1');
  });

  // 14. handleChatMessage: no error → no interrupt
  it('should NOT call onUserInterrupt when assistant message has no error', () => {
    detector.handleChatMessage(
      { sessionID: 's1', messageID: 'm1' },
      { message: { role: 'assistant' }, parts: [{ type: 'text', text: 'ok' }] },
    );

    expect(onUserInterrupt).not.toHaveBeenCalled();
  });

  // 15. handleChatMessage: user role calls onUserInput
  it('should call onUserInput for manual user message', () => {
    detector.handleChatMessage(
      { sessionID: 's2', messageID: 'm2' },
      { message: { role: 'user' }, parts: [{ type: 'text', text: 'hello' }] },
    );

    expect(onUserInput).toHaveBeenCalledTimes(1);
    expect(onUserInput).toHaveBeenCalledWith('s2');
  });

  // 16. handleChatMessage: user role with promptInFlight → NO onUserInput
  it('should NOT call onUserInput when promptInFlight is set', () => {
    detector.setPromptInFlight(true);
    detector.handleChatMessage(
      { sessionID: 's2', messageID: 'm2' },
      { message: { role: 'user' }, parts: [{ type: 'text', text: 'plugin prompt' }] },
    );

    expect(onUserInput).not.toHaveBeenCalled();

    detector.setPromptInFlight(false);
    detector.handleChatMessage(
      { sessionID: 's3', messageID: 'm3' },
      { message: { role: 'user' }, parts: [{ type: 'text', text: 'manual' }] },
    );

    expect(onUserInput).toHaveBeenCalledTimes(1);
    expect(onUserInput).toHaveBeenCalledWith('s3');
  });
});
