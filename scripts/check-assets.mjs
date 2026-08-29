import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const assets = ['src/sidepanel.html', 'src/sidepanel.css', 'manifest.json'];
const forbidden = [
  { token: '`n', label: 'literal PowerShell newline escape' },
  { token: '`r', label: 'literal PowerShell carriage-return escape' },
  { token: '\u0000', label: 'NUL byte' },
];

for (const relative of assets) {
  const text = await readFile(resolve(root, relative), 'utf8');
  for (const rule of forbidden) {
    if (text.includes(rule.token)) {
      throw new Error(`${relative} contains ${rule.label}: ${JSON.stringify(rule.token)}`);
    }
  }
}

const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('manifest.json must stay on Manifest V3');
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(['https://chatgpt.com/*'])) {
  throw new Error('host_permissions must remain scoped to https://chatgpt.com/*');
}
console.log('Static extension asset checks passed.');