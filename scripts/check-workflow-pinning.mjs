import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workflowRoot = resolve(root, '.github', 'workflows');
const violations = [];
for (const name of await readdir(workflowRoot)) {
  if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue;
  const file = resolve(workflowRoot, name);
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/^\s*uses:\s*([^\s]+)@([^\s#]+)/gm)) {
    if (!/^[0-9a-f]{40}$/i.test(match[2])) violations.push(`${relative(root, file)}: ${match[1]}@${match[2]}`);
  }
}
if (violations.length) throw new Error(`Unpinned workflow actions:\n${violations.join('\n')}`);
console.log('All workflow actions are pinned to immutable commit SHAs.');
