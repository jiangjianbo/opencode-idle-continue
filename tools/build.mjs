import fs from 'node:fs';
import path from 'node:path';

const srcDir = 'src';
const distDir = 'dist';

// Clean dist directory first
if (fs.existsSync(distDir)) {
  const items = fs.readdirSync(distDir);
  for (const item of items) {
    const itemPath = path.join(distDir, item);
    const stat = fs.statSync(itemPath);
    if (stat.isDirectory()) {
      fs.rmSync(itemPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(itemPath);
    }
  }
}

fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(path.join(distDir, 'cli'), { recursive: true });

const files = fs.readdirSync(srcDir)
  .filter(f => f.endsWith('.js'));

for (const f of files) {
  fs.copyFileSync(path.join(srcDir, f), path.join(distDir, f));
}

const cliFiles = fs.readdirSync(path.join(srcDir, 'cli'))
  .filter(f => f.endsWith('.js'));

for (const f of cliFiles) {
  fs.copyFileSync(path.join(srcDir, 'cli', f), path.join(distDir, 'cli', f));
}

const rootPkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const distPkg = {
  name: rootPkg.name,
  version: rootPkg.version,
  type: rootPkg.type,
  description: rootPkg.description,
  author: rootPkg.author,
  license: rootPkg.license,
  main: 'index.js',
  bin: {
    'opencode-idle-continue': './cli/index.js'
  },
  exports: {
    ".": {
      "default": "./index.js"
    }
  },
  files: [
    "*.js",
    "cli/",
    "README.md",
    "LICENSE"
  ],
  keywords: rootPkg.keywords,
  repository: rootPkg.repository,
  bugs: rootPkg.bugs,
  homepage: rootPkg.homepage,
  dependencies: rootPkg.dependencies
};

fs.writeFileSync(
  path.join(distDir, 'package.json'),
  JSON.stringify(distPkg, null, 2)
);
