/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();

const roots = [
  'packages',
  'apps',
  'admin-portal',
  'authority-node',
  'backend-api'
]
  .map((p) => path.join(repoRoot, p))
  .filter((p) => fs.existsSync(p));

const ignoreDirs = new Set(['node_modules', 'dist', 'build', '.turbo']);
const exts = new Set(['.ts', '.tsx']);

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  /** @type {string[]} */
  const out = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (ignoreDirs.has(entry.name)) continue;
      out.push(...walk(fullPath));
      continue;
    }

    if (exts.has(path.extname(entry.name))) out.push(fullPath);
  }

  return out;
}

const files = roots.flatMap(walk);

/** @type {Array<[RegExp, string]>} */
const rules = [
  [/\b(from\s+['"])(?:\.\.\/)+core\/src\//g, '$1@roadwatch/core/src/'],
  [/\b(from\s+['"])(?:\.\.\/)+providers\/src\//g, '$1@roadwatch/providers/src/'],
  [/\b(from\s+['"])(?:\.\.\/)+providers\/storage-sqlite\/src\//g, '$1@roadwatch/providers/storage-sqlite/src/'],
  [/\b(from\s+['"])(?:\.\.\/)+adapters\/src\//g, '$1@roadwatch/adapters/src/'],
  [/\b(from\s+['"])(?:\.\.\/)+config\/src\//g, '$1@roadwatch/config/src/'],
  [/\b(from\s+['"])(?:\.\.\/)+features\/src\//g, '$1@roadwatch/features/src/']
];

let updated = 0;

for (const filePath of files) {
  const before = fs.readFileSync(filePath, 'utf8');
  let after = before;

  for (const [re, replacement] of rules) {
    after = after.replace(re, replacement);
  }

  if (after !== before) {
    fs.writeFileSync(filePath, after, 'utf8');
    updated++;
  }
}

console.log(`codemod-rewrite-imports: updated ${updated} / ${files.length} files`);
