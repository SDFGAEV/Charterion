import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { computeSourceFingerprint } from './fingerprint.mjs';
import { DIST_FILES, sha256 } from './dist-fingerprint.mjs';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const meta = JSON.parse(await readFile(resolve(dist, 'build-meta.json'), 'utf8'));
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

if (meta.schemaVersion !== 1) throw new Error('Unsupported dist fingerprint schema');
if (meta.version !== pkg.version) throw new Error('dist version does not match package version');
const sourceFingerprint = await computeSourceFingerprint(root);
if (meta.sourceFingerprint !== sourceFingerprint) {
  throw new Error('dist was not built from the current source tree');
}
for (const name of DIST_FILES) {
  const actual = await sha256(resolve(dist, name));
  if (meta.files?.[name] !== actual) throw new Error(`dist artifact hash mismatch: ${name}`);
}
console.log(`Dist fingerprint verified: ${sourceFingerprint.slice(0, 16)} (${DIST_FILES.length} files).`);
