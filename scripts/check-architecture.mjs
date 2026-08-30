import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const srcRoot = resolve(root, 'src');

async function sourceFiles(dir = srcRoot) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  }));
  return nested.flat();
}

const files = await sourceFiles();
const textByFile = new Map();
for (const file of files) textByFile.set(file, await readFile(file, 'utf8'));

function locations(token) {
  return [...textByFile.entries()]
    .filter(([, text]) => text.includes(token))
    .map(([file]) => relative(root, file).replaceAll('\\', '/'));
}

const background = textByFile.get(resolve(srcRoot, 'background.ts')) ?? '';
const backgroundLines = background.split(/\r?\n/).length;
if (backgroundLines > 950) throw new Error(`src/background.ts exceeded 950-line coordinator budget: ${backgroundLines}`);

const tabCreateOwners = locations('chrome.tabs.create(');
const tabRemoveOwners = locations('chrome.tabs.remove(');
if (tabCreateOwners.some((file) => file !== 'src/background.ts')) throw new Error(`chrome.tabs.create escaped fleet runtime: ${tabCreateOwners.join(', ')}`);
if (tabRemoveOwners.some((file) => file !== 'src/background.ts')) throw new Error(`chrome.tabs.remove escaped fleet runtime: ${tabRemoveOwners.join(', ')}`);

const clickOwners = locations('.click();');
if (clickOwners.some((file) => file !== 'src/chatgptAdapter.ts')) {
  throw new Error(`Direct DOM click escaped ChatGPT adapter: ${clickOwners.join(', ')}`);
}
const sessionStorageOwners = locations('sessionStorage.');
if (sessionStorageOwners.some((file) => file !== 'src/content.ts')) {
  throw new Error(`sessionStorage escaped content runtime projection: ${sessionStorageOwners.join(', ')}`);
}

for (const required of [
  'new TabOperationQueue()',
  'new CoalescingRunner(',
  'new ContentRuntimeFence()',
  'controlFeedbackMessages(snapshot',
]) {
  if (!background.includes(required)) throw new Error(`background coordinator lost required boundary: ${required}`);
}
if (/\blet\s+supervisorRun\s*:/.test(background)) throw new Error('Legacy drop-on-busy Supervisor runner returned');
if (/\blet\s+fleetReconcileRun\s*:/.test(background)) throw new Error('Legacy drop-on-busy fleet reconciler returned');

const policy = textByFile.get(resolve(srcRoot, 'browserOperationPolicy.ts')) ?? '';
for (const operation of [
  'page.snapshot', 'prompt.send', 'tab.open', 'tab.close', 'binding.update', 'runtime.observe',
]) {
  if (!policy.includes(`'${operation}'`)) throw new Error(`Browser operation manifest is missing ${operation}`);
}
if (!policy.includes("'prompt.send': { operation: 'prompt.send', operationClass: 'write', retryPolicy: 'never'")) {
  throw new Error('prompt.send must remain a non-auto-retryable physical browser write');
}

const attempts = textByFile.get(resolve(srcRoot, 'attempts.ts')) ?? '';
if (!attempts.includes("uncertain: new Set(['reply-observed'])")) {
  throw new Error('uncertain delivery must not become auto-retryable or acknowledged later');
}
const controlPlane = await readFile(resolve(root, 'control/src/controlPlane.ts'), 'utf8');
for (const fence of ['Stale agent browser observation', 'Stale browser runtime observation']) {
  if (!controlPlane.includes(fence)) throw new Error(`Kernel observation fence missing: ${fence}`);
}

console.log(`Architecture hard-cut checks passed (${files.length} src files; background ${backgroundLines} lines).`);
