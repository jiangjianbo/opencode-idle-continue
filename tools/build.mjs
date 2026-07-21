import fs from 'node:fs';
import path from 'node:path';

const srcDir = 'src';
const distDir = 'dist';

fs.mkdirSync(distDir, { recursive: true });

const files = fs.readdirSync(srcDir)
  .filter(f => f.endsWith('.js'));

for (const f of files) {
  fs.copyFileSync(path.join(srcDir, f), path.join(distDir, f));
}

const rootPkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const distPkg = {
  name: rootPkg.name,
  version: rootPkg.version,
  type: rootPkg.type,
  main: 'index.js',
  exports: {
    ".": {
      "default": "./index.js"
    }
  },
  files: rootPkg.files,
  keywords: rootPkg.keywords,
  dependencies: rootPkg.dependencies
};

fs.writeFileSync(
  path.join(distDir, 'package.json'),
  JSON.stringify(distPkg, null, 2)
);
