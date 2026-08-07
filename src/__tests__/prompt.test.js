import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadPromptFile, fileExists, getDefaultPrompt } from '../file-utils.js';

function tempFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prompt-test-'));
  const fp = path.join(dir, 'test.md');
  fs.writeFileSync(fp, content, 'utf-8');
  return { dir, fp };
}

describe('fileExists', () => {
  it('should return true for existing file', () => {
    const { dir, fp } = tempFile('test');
    try {
      expect(fileExists(fp)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should return false for non-existent file', () => {
    expect(fileExists('/tmp/nonexistent-file-12345.md')).toBe(false);
  });
});

describe('getDefaultPrompt', () => {
  it('should return the default prompt string', () => {
    const defaultPrompt = getDefaultPrompt();
    expect(typeof defaultPrompt).toBe('string');
    expect(defaultPrompt.length).toBeGreaterThan(0);
    expect(defaultPrompt).toContain('helpful AI assistant');
  });
});

describe('loadPromptFile', () => {
  // 13. Reads existing file
  it('should read content and return mtime for existing file', () => {
    const { dir, fp } = tempFile('hello');
    try {
      const result = loadPromptFile(fp);
      expect(result.content).toBe('hello');
      expect(typeof result.mtime).toBe('number');
      expect(result.mtime).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // 14. Returns empty for non-existent file
  it('should return empty content and mtime=0 for non-existent file', () => {
    const result = loadPromptFile('/tmp/nonexistent-promp-file-12345.md');
    expect(result.content).toBe('');
    expect(result.mtime).toBe(0);
  });

  // 15. Reads empty file
  it('should return empty string for empty file with valid mtime', () => {
    const { dir, fp } = tempFile('');
    try {
      const result = loadPromptFile(fp);
      expect(result.content).toBe('');
      expect(typeof result.mtime).toBe('number');
      expect(result.mtime).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
