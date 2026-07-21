import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WaitState, FileWatch } from '../wait-state.js';

describe('WaitState - integration bug reproduction', () => {
  let waitState;
  let fileWatch;
  let sendPrompt;
  let isSessionIdle;
  let log;
  let tempDir;

  beforeEach(() => {
    vi.useFakeTimers();
    log = vi.fn();
    sendPrompt = vi.fn(async () => {});
    isSessionIdle = vi.fn(() => true);

    // 创建临时文件和文件监控
    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'idle-continue-test-'));
    
    // 创建 task.md 和 wish-list.md
    fs.writeFileSync(path.join(tempDir, 'task.md'), '# Current Task\n');
    fs.writeFileSync(path.join(tempDir, 'wish-list.md'), '# Wish List\n');
    fs.writeFileSync(path.join(tempDir, 'idle-prompt.md'), 'test prompt');

    fileWatch = new FileWatch({
      promptFilePath: path.join(tempDir, 'idle-prompt.md'),
      watchFilePaths: [
        path.join(tempDir, 'task.md'),
        path.join(tempDir, 'wish-list.md')
      ],
      log
    });

    waitState = new WaitState({
      initialIntervalMinutes: 30,
      maxIdleCycles: 5,
      fileWatch,
      sendPrompt,
      isSessionIdle,
      log
    });
  });

  afterEach(() => {
    waitState?.dispose();
    vi.useRealTimers();
    
    // 清理临时文件
    const fs = require('fs');
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true });
    }
  });

  it('should maintain wait state and handle backoff logic correctly', async () => {
    // 1. 进入空闲状态，触发初始提示词
    waitState.onIdle('test-session');
    
    // 等待初始提示词发送完成
    await vi.advanceTimersByTimeAsync(100);
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('WAIT', 'WAIT Entering wait state, sending initial prompt');
    
    // 2. 验证初始发送不增加循环计数
    expect(log).not.toHaveBeenCalledWith('WAIT', expect.stringContaining('Idle cycles='));
    
    // 3. 验证等待状态保持活动
    expect(waitState.active).toBe(true);
    
    // 4. 验证定时器已调度（30分钟 = 30 * 60 * 1000 = 1800000ms）
    expect(log).toHaveBeenCalledWith('WAIT', 'WAIT Next check in 30min');
    
    // 5. 模拟 30 分钟后定时器到期
    vi.advanceTimersByTime(30 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(100);
    
    // 6. 验证周期性提示词被发送
    expect(sendPrompt).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith('WAIT', 'WAIT Timer fired, sending prompt');
    
    // 7. 验证循环计数增加
    expect(log).toHaveBeenCalledWith('WAIT', 'WAIT Idle cycles=1/5');
    
    // 8. 继续执行 4 个循环（总共 5 次周期性发送）
    for (let i = 2; i <= 5; i++) {
      vi.advanceTimersByTime(30 * 60 * 1000);
      await vi.advanceTimersByTimeAsync(100);
      
      expect(log).toHaveBeenCalledWith('WAIT', `WAIT Idle cycles=${i}/5`);
      expect(sendPrompt).toHaveBeenCalledTimes(i + 1); // +1 因为有初始发送
    }
    
    // 9. 验证间隔翻倍
    expect(log).toHaveBeenCalledWith('WAIT', 'WAIT Doubling interval to 60min');
    expect(log).toHaveBeenCalledWith('WAIT', 'WAIT Next check in 60min');
    
    // 10. 验证循环计数重置
    expect(log).toHaveBeenCalledWith('WAIT', 'WAIT Idle cycles=0/5');
    
    // 11. 验证等待状态仍然保持活动
    expect(waitState.active).toBe(true);
  });

  it('should not exit wait state when files remain unchanged', async () => {
    // 进入等待状态
    waitState.onIdle('test-session');
    await vi.advanceTimersByTimeAsync(100);
    
    // 验证等待状态活跃
    expect(waitState.active).toBe(true);
    
    // 30 分钟后定时器到期
    vi.advanceTimersByTime(30 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(100);
    
    // 验证等待状态仍然活跃（文件未变化）
    expect(waitState.active).toBe(true);
    expect(sendPrompt).toHaveBeenCalledTimes(2);
    
    // 再次验证文件未变化时状态保持
    vi.advanceTimersByTime(30 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(100);
    
    expect(waitState.active).toBe(true);
    expect(sendPrompt).toHaveBeenCalledTimes(3);
  });

  it('should exit wait state when session becomes busy', async () => {
    // 进入等待状态
    waitState.onIdle('test-session');
    await vi.advanceTimersByTimeAsync(100);
    
    // 模拟会话变为 busy
    isSessionIdle.mockReturnValue(false);
    vi.advanceTimersByTime(30 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(100);
    
    // 验证等待状态退出
    expect(waitState.active).toBe(false);
    expect(log).toHaveBeenCalledWith('WAIT', 'WAIT Session not idle, exiting wait state');
  });

  it('should exit wait state when files change', async () => {
    const fs = require('fs');
    const path = require('path');
    
    // 进入等待状态
    waitState.onIdle('test-session');
    await vi.advanceTimersByTimeAsync(100);
    
    // 修改监控文件
    fs.writeFileSync(path.join(tempDir, 'task.md'), '# Current Task\n1. New task');
    
    // 定时器到期
    vi.advanceTimersByTime(30 * 60 * 1000);
    await vi.advanceTimersByTimeAsync(100);
    
    // 验证等待状态退出
    expect(waitState.active).toBe(false);
    expect(log).toHaveBeenCalledWith('WAIT', 'WAIT Files changed on check, resetting');
  });
});