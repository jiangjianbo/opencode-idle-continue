import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readFileSnapshot, fileChanged, readDirectorySnapshot, directoryChanged, isDirectory } from '../file-utils.js';

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

  it('should return null for non-existent file', () => {
    expect(readFileSnapshot('/tmp/nonexistent-12345.md')).toBeNull();
  });
});

describe('isDirectory', () => {
  it('should return true for directory', () => {
    const dir = tempDir();
    try {
      expect(isDirectory(dir)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should return false for file', () => {
    const { dir, fp } = tempFile('content');
    try {
      expect(isDirectory(fp)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should return false for non-existent path', () => {
    expect(isDirectory('/tmp/nonexistent-99999')).toBe(false);
  });
});

describe('readDirectorySnapshot', () => {
  it('should return null for non-existent directory', () => {
    expect(readDirectorySnapshot('/tmp/nonexistent-dir-88888')).toBeNull();
  });

  it('should snapshot empty directory', () => {
    const dir = tempDir();
    try {
      const snap = readDirectorySnapshot(dir);
      expect(snap).not.toBeNull();
      expect(snap.type).toBe('directory');
      expect(snap.entries).toEqual({});
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should snapshot directory with files', () => {
    const dir = tempDir();
    try {
      fs.writeFileSync(path.join(dir, 'file1.txt'), 'content1', 'utf-8');
      fs.writeFileSync(path.join(dir, 'file2.txt'), 'content2', 'utf-8');

      const snap = readDirectorySnapshot(dir);
      expect(snap.type).toBe('directory');
      expect(Object.keys(snap.entries)).toHaveLength(2);
      expect(snap.entries['file1.txt'].type).toBe('file');
      expect(snap.entries['file2.txt'].type).toBe('file');
      expect(typeof snap.entries['file1.txt'].mtime).toBe('number');
      expect(snap.entries['file1.txt'].size).toBe(8);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should snapshot directory with subdirectories', () => {
    const dir = tempDir();
    try {
      fs.mkdirSync(path.join(dir, 'subdir1'));
      fs.mkdirSync(path.join(dir, 'subdir2'));
      fs.writeFileSync(path.join(dir, 'file.txt'), 'content', 'utf-8');

      const snap = readDirectorySnapshot(dir);
      expect(snap.type).toBe('directory');
      expect(Object.keys(snap.entries)).toHaveLength(3);
      expect(snap.entries['subdir1'].type).toBe('directory');
      expect(snap.entries['subdir2'].type).toBe('directory');
      expect(snap.entries['file.txt'].type).toBe('file');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('directoryChanged', () => {
  it('should return false when both are null', () => {
    expect(directoryChanged(null, '/tmp/nonexistent-dir-77777')).toBe(false);
  });

  it('should return true when directory does not exist but snapshot exists', () => {
    const snap = { type: 'directory', entries: {} };
    expect(directoryChanged(snap, '/tmp/nonexistent-dir-66666')).toBe(true);
  });

  it('should return false when directory unchanged', () => {
    const dir = tempDir();
    try {
      fs.writeFileSync(path.join(dir, 'file.txt'), 'content', 'utf-8');
      const snap1 = readDirectorySnapshot(dir);
      const snap2 = readDirectorySnapshot(dir);
      expect(directoryChanged(snap1, dir)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should return true when file is added', () => {
    const dir = tempDir();
    try {
      const snap1 = readDirectorySnapshot(dir);
      fs.writeFileSync(path.join(dir, 'newfile.txt'), 'new content', 'utf-8');
      expect(directoryChanged(snap1, dir)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should return true when file is removed', () => {
    const dir = tempDir();
    try {
      const fp = path.join(dir, 'todelete.txt');
      fs.writeFileSync(fp, 'content', 'utf-8');
      const snap1 = readDirectorySnapshot(dir);
      fs.unlinkSync(fp);
      expect(directoryChanged(snap1, dir)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should return true when file is modified', () => {
    const dir = tempDir();
    try {
      const fp = path.join(dir, 'file.txt');
      fs.writeFileSync(fp, 'original', 'utf-8');
      const snap1 = readDirectorySnapshot(dir);
      fs.writeFileSync(fp, 'modified', 'utf-8');
      expect(directoryChanged(snap1, dir)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should return true when subdirectory is added', () => {
    const dir = tempDir();
    try {
      const snap1 = readDirectorySnapshot(dir);
      fs.mkdirSync(path.join(dir, 'newdir'));
      expect(directoryChanged(snap1, dir)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should return true when subdirectory is removed', () => {
    const dir = tempDir();
    try {
      const subdir = path.join(dir, 'subdir');
      fs.mkdirSync(subdir);
      const snap1 = readDirectorySnapshot(dir);
      fs.rmSync(subdir, { recursive: true });
      expect(directoryChanged(snap1, dir)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should return true when subdirectory content changes but not track nested', () => {
    const dir = tempDir();
    try {
      const subdir = path.join(dir, 'subdir');
      fs.mkdirSync(subdir);
      const snap1 = readDirectorySnapshot(dir);
      fs.writeFileSync(path.join(subdir, 'nested.txt'), 'nested content', 'utf-8');
      expect(directoryChanged(snap1, dir)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should return true when file changes to directory', () => {
    const dir = tempDir();
    try {
      const fp = path.join(dir, 'item');
      fs.writeFileSync(fp, 'file', 'utf-8');
      const snap1 = readDirectorySnapshot(dir);
      fs.unlinkSync(fp);
      fs.mkdirSync(fp);
      expect(directoryChanged(snap1, dir)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should return true when directory changes to file', () => {
    const dir = tempDir();
    try {
      const fp = path.join(dir, 'item');
      fs.mkdirSync(fp);
      const snap1 = readDirectorySnapshot(dir);
      fs.rmSync(fp, { recursive: true });
      fs.writeFileSync(fp, 'file', 'utf-8');
      expect(directoryChanged(snap1, dir)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('fileChanged', () => {
  it('should return false when file has not changed', () => {
    const { dir, fp } = tempFile('content');
    try {
      const snap = readFileSnapshot(fp);
      expect(fileChanged(snap, fp)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

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

  it('should return false when both snapshot and file do not exist', () => {
    expect(fileChanged(null, '/tmp/nonexistent-11111.md')).toBe(false);
  });
});
