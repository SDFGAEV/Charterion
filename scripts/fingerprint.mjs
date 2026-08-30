import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

async function collect(dir, predicate) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return collect(path, predicate);
    return entry.isFile() && predicate(path) ? [path] : [];
  }));
  return nested.flat();
}

export async function computeSourceFingerprint(root) {
  const srcRoot = resolve(root, 'src');
  const files = await collect(srcRoot, (path) => /\.(ts|html|css)$/.test(path));
  files.push(resolve(root, 'manifest.json'), resolve(root, 'package.json'));
  files.sort();
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(relative(root, file).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}
