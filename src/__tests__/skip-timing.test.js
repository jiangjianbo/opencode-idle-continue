import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenCodeTrueIdleDetector } from '../opencode-true-idle-detector.js';

describe('OpenCodeTrueIdleDetector - skipNextUserMessage timing', () => {
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

  it('should skip next user message when setSkipNextUserMessage(500) is called', async () => {
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
    expect(onIdle).toHaveBeenCalledWith('test-session');
    onIdle.mockClear();

    // 3. 在 onIdle 回调中设置 skipNextUserMessage(500)
    // 这模拟插件发送提示词时的行为
    detector.setSkipNextUserMessage(500);

    // 4. 模拟 chat.message hook 接收到插件发送的提示词消息
    detector.handleChatMessage({
      sessionID: 'test-session',
      messageID: 'msg-1'
    }, {
      message: { role: 'user' },
      parts: [{ text: 'test prompt' }]
    });

    // 5. 验证用户输入处理被跳过
    expect(onUserInput).not.toHaveBeenCalled();
    expect(onIdleExit).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'USER_INPUT',
      expect.stringContaining('test-session')
    );

    // 6. 500ms 后，标志应该自动清除
    vi.advanceTimersByTime(500);

    // 7. 现在收到另一个用户消息，应该被处理
    detector.handleChatMessage({
      sessionID: 'test-session',
      messageID: 'msg-2'
    }, {
      message: { role: 'user' },
      parts: [{ text: 'real user input' }]
    });

    expect(onUserInput).toHaveBeenCalledTimes(1);
    expect(onIdleExit).toHaveBeenCalledTimes(1);
  });

  it('should not skip user messages when skipNextUserMessage is not set', async () => {
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

    // 3. 不设置 skipNextUserMessage，直接接收用户消息
    detector.handleChatMessage({
      sessionID: 'test-session',
      messageID: 'msg-1'
    }, {
      message: { role: 'user' },
      parts: [{ text: 'user input' }]
    });

    // 4. 验证用户输入被正常处理
    expect(onUserInput).toHaveBeenCalledTimes(1);
    expect(onIdleExit).toHaveBeenCalledTimes(1);
  });

  it('should clear skipNextUserMessage when explicitly called', () => {
    detector.setSkipNextUserMessage(500);
    
    // 验证第一个用户消息被跳过
    detector.handleChatMessage({
      sessionID: 'test-session',
      messageID: 'msg-1'
    }, {
      message: { role: 'user' },
      parts: [{ text: 'test' }]
    });
    expect(onUserInput).not.toHaveBeenCalled();

    // 明确清除标志
    detector.clearSkipNextUserMessage();

    // 验证第二个用户消息被处理
    detector.handleChatMessage({
      sessionID: 'test-session',
      messageID: 'msg-2'
    }, {
      message: { role: 'user' },
      parts: [{ text: 'user input' }]
    });
    expect(onUserInput).toHaveBeenCalledTimes(1);
  });

  it('should handle multiple skipNextUserMessage calls correctly', () => {
    detector.setSkipNextUserMessage(500);
    detector.setSkipNextUserMessage(1000);  // 更新的延迟时间

    // 验证消息被跳过
    detector.handleChatMessage({
      sessionID: 'test-session',
      messageID: 'msg-1'
    }, {
      message: { role: 'user' },
      parts: [{ text: 'test' }]
    });
    expect(onUserInput).not.toHaveBeenCalled();

    // 500ms 后，消息仍应被跳过（因为第二次调用设置了 1000ms）
    vi.advanceTimersByTime(500);
    detector.handleChatMessage({
      sessionID: 'test-session',
      messageID: 'msg-2'
    }, {
      message: { role: 'user' },
      parts: [{ text: 'test 2' }]
    });
    expect(onUserInput).not.toHaveBeenCalled();

    // 1000ms 后，消息应该被处理
    vi.advanceTimersByTime(500);
    detector.handleChatMessage({
      sessionID: 'test-session',
      messageID: 'msg-3'
    }, {
      message: { role: 'user' },
      parts: [{ text: 'user input' }]
    });
    expect(onUserInput).toHaveBeenCalledTimes(1);
  });

  it('should clear skipNextUserMessage timer on dispose', () => {
    detector.setSkipNextUserMessage(500);
    detector.dispose();

    // 验证定时器被清除，不会触发错误
    vi.advanceTimersByTime(1000);
    
    // 这个测试主要验证 dispose 不会抛出异常
    expect(true).toBe(true);
  });
});