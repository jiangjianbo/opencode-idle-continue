import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readFileSnapshot, fileChanged } from '../file-utils.js';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'filewatch-test-'));
}

function tempFile(content) {
  const dir = tempDir();
  const fp = path.join(dir, 'test.md');
  fs.writeFileSync(fp, content, 'utf-8');
  return { dir, fp };
}

describe('readFileSnapshot', () => {
  // 16. Snapshot for existing file
  it('should return mtime and size for existing file', () => {
    const { dir, fp } = tempFile('some content');
    try {
      const snap = readFileSnapshot(fp);
      expect(snap).not.toBeNull();
      expect(typeof snap.mtime).toBe('number');
      expect(snap.mtime).toBeGreaterThan(0);
      expect(typeof snap.size).toBe('number');
      expect(snap.size).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // 17. Snapshot for non-existent file returns null
  it('should return null for non-existent file', () => {
    expect(readFileSnapshot('/tmp/nonexistent-12345.md')).toBeNull();
  });
});

describe('fileChanged', () => {
  // 18. Unchanged file → false
  it('should return false when file has not changed', () => {
    const { dir, fp } = tempFile('content');
    try {
      const snap = readFileSnapshot(fp);
      expect(fileChanged(snap, fp)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // 19. Changed file → true
  it('should return true when file content changes', () => {
    const { dir, fp } = tempFile('old content');
    try {
      const snap = readFileSnapshot(fp);
      fs.writeFileSync(fp, 'new content', 'utf-8');
      expect(fileChanged(snap, fp)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // 20. One side null → true
  it('should return true when snapshot is null but file exists', () => {
    const { dir, fp } = tempFile('content');
    try {
      expect(fileChanged(null, fp)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should return true when snapshot exists but file is missing', () => {
    const snap = { mtime: 1234, size: 10 };
    expect(fileChanged(snap, '/tmp/nonexistent-67890.md')).toBe(true);
  });

  // 21. Both null → false
  it('should return false when both snapshot and file do not exist', () => {
    expect(fileChanged(null, '/tmp/nonexistent-11111.md')).toBe(false);
  });
});
