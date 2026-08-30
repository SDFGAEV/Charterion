import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { computeSourceFingerprint } from './fingerprint.mjs';

const DIST_FILES = ['background.js', 'content.js', 'sidepanel.js', 'sidepanel.html', 'sidepanel.css'];

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

export async function writeDistFingerprint(root, dist) {
  const files = {};
  for (const name of DIST_FILES) files[name] = await sha256(resolve(dist, name));
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const meta = {
    schemaVersion: 1,
    version: pkg.version,
    sourceFingerprint: await computeSourceFingerprint(root),
    files,
  };
  await writeFile(resolve(dist, 'build-meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return meta;
}

export { DIST_FILES, sha256 };
