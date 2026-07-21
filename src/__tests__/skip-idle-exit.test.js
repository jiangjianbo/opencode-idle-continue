import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenCodeTrueIdleDetector } from '../opencode-true-idle-detector.js';

describe('OpenCodeTrueIdleDetector - skipNextIdleExit functionality', () => {
  let detector;
  let log;
  let onIdle;
  let onIdleExit;
  let onUserInterrupt;
  let onUserInput;

  beforeEach(() => {
    vi.useFakeTimers();
    log = vi.fn();
    onIdle = vi.fn();
    onIdleExit = vi.fn();
    onUserInterrupt = vi.fn();
    onUserInput = vi.fn();
    
    detector = new OpenCodeTrueIdleDetector({
      log,
      onIdle,
      onIdleExit,
      onUserInterrupt,
      onUserInput
    });
  });

  afterEach(() => {
    detector.dispose();
    vi.useRealTimers();
  });

  it('should skip onIdleExit when skipNextIdleExit is set', () => {
    // 1. 进入空闲状态
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' }, sessionID: 'test-session' }
      }
    });

    // 2. 去抖，200ms 后确认真正空闲
    vi.advanceTimersByTime(200);
    expect(onIdle).toHaveBeenCalledTimes(1);
    onIdle.mockClear();

    // 3. 设置 skipNextIdleExit 标志
    detector.setSkipNextIdleExit(1000);

    // 4. 状态变为 busy
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'busy' }, sessionID: 'test-session' }
      }
    });

    // 5. 验证 onIdleExit 没有被调用
    expect(onIdleExit).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalledWith('IDLE_END', expect.any(String));
  });

  it('should call onIdleExit when skipNextIdleExit is not set', () => {
    // 1. 进入空闲状态
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' }, sessionID: 'test-session' }
      }
    });

    // 2. 去抖，200ms 后确认真正空闲
    vi.advanceTimersByTime(200);
    expect(onIdle).toHaveBeenCalledTimes(1);
    onIdle.mockClear();

    // 3. 状态变为 busy（不设置 skipNextIdleExit）
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'busy' }, sessionID: 'test-session' }
      }
    });

    // 4. 验证 onIdleExit 被正常调用
    expect(onIdleExit).toHaveBeenCalledTimes(1);
    expect(onIdleExit).toHaveBeenCalledWith('test-session');
    expect(log).toHaveBeenCalledWith('IDLE_END', 'session=test-session idle -> busy');
  });

  it('should automatically clear skipNextIdleExit after delay', () => {
    // 1. 设置 skipNextIdleExit(1000)
    detector.setSkipNextIdleExit(1000);

    // 2. 状态变为 busy
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'busy' }, sessionID: 'test-session' }
      }
    });

    // 3. 验证 onIdleExit 被跳过
    expect(onIdleExit).not.toHaveBeenCalled();

    // 4. 等待 1000ms 后，标志应该自动清除
    vi.advanceTimersByTime(1000);

    // 5. 再次进入空闲
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' }, sessionID: 'test-session' }
      }
    });

    vi.advanceTimersByTime(200);
    expect(onIdle).toHaveBeenCalledTimes(1);
    onIdle.mockClear();

    // 6. 状态再次变为 busy，应该正常调用 onIdleExit
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'busy' }, sessionID: 'test-session' }
      }
    });

    expect(onIdleExit).toHaveBeenCalledTimes(1);
  });

  it('should not skip onIdleExit for non-idle to busy transitions', () => {
    // 1. 设置 skipNextIdleExit
    detector.setSkipNextIdleExit(1000);

    // 2. 直接从 busy 到 busy（没有 idle 到 busy 的转换）
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'busy' }, sessionID: 'test-session' }
      }
    });

    // 3. 验证 onIdleExit 没有被调用（因为没有 idle -> busy 转换）
    expect(onIdleExit).not.toHaveBeenCalled();
  });

  it('should work correctly with multiple skipNextIdleExit calls', () => {
    // 1. 进入空闲状态
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' }, sessionID: 'test-session' }
      }
    });

    vi.advanceTimersByTime(200);
    expect(onIdle).toHaveBeenCalledTimes(1);
    onIdle.mockClear();

    // 2. 多次设置 skipNextIdleExit
    detector.setSkipNextIdleExit(500);
    detector.setSkipNextIdleExit(1000);

    // 3. 状态变为 busy
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'busy' }, sessionID: 'test-session' }
      }
    });

    // 4. 验证 onIdleExit 被跳过
    expect(onIdleExit).not.toHaveBeenCalled();

    // 5. 500ms 后，仍然应该被跳过（因为第二次调用设置了 1000ms）
    vi.advanceTimersByTime(500);

    // 6. 再次进入空闲
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' }, sessionID: 'test-session' }
      }
    });

    vi.advanceTimersByTime(200);
    expect(onIdle).toHaveBeenCalledTimes(1);
    onIdle.mockClear();

    // 7. 状态再次变为 busy
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'busy' }, sessionID: 'test-session' }
      }
    });

    // 8. 仍然应该被跳过
    expect(onIdleExit).not.toHaveBeenCalled();

    // 9. 500ms 后（总共 1000ms），应该正常调用
    vi.advanceTimersByTime(500);

    // 10. 再次进入空闲
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' }, sessionID: 'test-session' }
      }
    });

    vi.advanceTimersByTime(200);
    expect(onIdle).toHaveBeenCalledTimes(1);
    onIdle.mockClear();

    // 11. 状态再次变为 busy
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'busy' }, sessionID: 'test-session' }
      }
    });

    // 12. 现在应该正常调用 onIdleExit
    expect(onIdleExit).toHaveBeenCalledTimes(1);
  });

  it('should handle skipNextIdleExit with zero delay (manual clear)', () => {
    // 1. 设置 skipNextIdleExit(0)
    detector.setSkipNextIdleExit(0);

    // 2. 进入空闲状态
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' }, sessionID: 'test-session' }
      }
    });

    vi.advanceTimersByTime(200);
    expect(onIdle).toHaveBeenCalledTimes(1);
    onIdle.mockClear();

    // 3. 状态变为 busy
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'busy' }, sessionID: 'test-session' }
      }
    });

    // 4. 验证 onIdleExit 被跳过
    expect(onIdleExit).not.toHaveBeenCalled();

    // 5. 等待任意时间，标志不会自动清除（延迟为 0）
    vi.advanceTimersByTime(1000);

    // 6. 再次进入空闲
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'idle' }, sessionID: 'test-session' }
      }
    });

    vi.advanceTimersByTime(200);
    expect(onIdle).toHaveBeenCalledTimes(1);
    onIdle.mockClear();

    // 7. 状态再次变为 busy，仍然应该被跳过
    detector.handleEvent({
      event: {
        type: 'session.status',
        properties: { status: { type: 'busy' }, sessionID: 'test-session' }
      }
    });

    expect(onIdleExit).not.toHaveBeenCalled();
  });
});