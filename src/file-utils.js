import fs from 'node:fs';

export function readFileSnapshot(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return { mtime: stat.mtimeMs, size: stat.size };
  } catch {
    return null;
  }
}

export function fileChanged(snapshot, filePath) {
  const current = readFileSnapshot(filePath);
  if (current === null && snapshot === null) return false;
  if (current === null || snapshot === null) return true;
  return current.mtime !== snapshot.mtime || current.size !== snapshot.size;
}

export function getFileMtime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

export function loadPromptFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    return { content, mtime: stat.mtimeMs };
  } catch {
    return { content: '', mtime: 0 };
  }
}
