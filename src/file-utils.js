import fs from 'node:fs';

export function readFileSnapshot(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return { mtime: stat.mtimeMs, size: stat.size };
  } catch {
    return null;
  }
}

export function readDirectorySnapshot(dirPath) {
  try {
    const entries = {};
    const files = fs.readdirSync(dirPath);
    for (const name of files) {
      const fullPath = `${dirPath}/${name}`;
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          entries[name] = { type: 'file', mtime: stat.mtimeMs, size: stat.size };
        } else if (stat.isDirectory()) {
          entries[name] = { type: 'directory' };
        }
      } catch {
        continue;
      }
    }
    return { type: 'directory', entries };
  } catch {
    return null;
  }
}

export function isDirectory(path) {
  try {
    return fs.statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function fileChanged(snapshot, filePath) {
  const current = readFileSnapshot(filePath);
  if (current === null && snapshot === null) return false;
  if (current === null || snapshot === null) return true;
  return current.mtime !== snapshot.mtime || current.size !== snapshot.size;
}

export function directoryChanged(prevSnapshot, dirPath) {
  const current = readDirectorySnapshot(dirPath);
  if (current === null && prevSnapshot === null) return false;
  if (current === null || prevSnapshot === null) return true;
  if (prevSnapshot.type !== 'directory') return true;
  if (current.type !== 'directory') return true;

  const prevEntries = prevSnapshot.entries;
  const currEntries = current.entries;

  const allNames = new Set([...Object.keys(prevEntries), ...Object.keys(currEntries)]);

  for (const name of allNames) {
    const prev = prevEntries[name];
    const curr = currEntries[name];

    if (!prev || !curr) return true;
    if (prev.type !== curr.type) return true;

    if (prev.type === 'file' && curr.type === 'file') {
      if (prev.mtime !== curr.mtime || prev.size !== curr.size) return true;
    }
  }

  return false;
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
