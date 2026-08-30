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
const expectedPermissions = ['tabs', 'storage', 'sidePanel'];
if (JSON.stringify(manifest.permissions) !== JSON.stringify(expectedPermissions)) {
  throw new Error(`permissions must remain exactly ${expectedPermissions.join(', ')}`);
}
if (manifest.background?.service_worker !== 'dist/background.js') {
  throw new Error('background service worker path changed unexpectedly');
}
if (manifest.side_panel?.default_path !== 'dist/sidepanel.html') {
  throw new Error('side panel path changed unexpectedly');
}

const html = await readFile(resolve(root, 'src/sidepanel.html'), 'utf8');
const requiredIds = [
  'instruction', 'send-selected', 'select-idle', 'clear-selection',
  'supervisor-enabled', 'run-ready', 'task-title', 'task-role', 'task-project',
  'task-kind', 'task-deps', 'task-review-target', 'task-review-rounds',
  'task-instruction', 'create-task', 'dag-view', 'tasks',
  'message-project', 'message-from', 'message-target-kind', 'message-target-role',
  'message-type', 'message-task', 'message-content', 'queue-message', 'messages',
  'state-json', 'export-state', 'import-state', 'agents', 'summary', 'empty',
];
for (const id of requiredIds) {
  if (!html.includes(`id="${id}"`)) throw new Error(`sidepanel.html is missing required #${id}`);
}
console.log('Static extension asset and permission checks passed.');
