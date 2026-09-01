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

const blankCreate = background.indexOf("chrome.tabs.create({ url: 'about:blank', active: false })");
const fleetBind = background.indexOf('await updateBinding(tab.id', blankCreate);
const fleetNavigate = background.indexOf("chrome.tabs.update(tab.id, { url: action.url, active: false })", fleetBind);
if (blankCreate < 0 || fleetBind < 0 || fleetNavigate < 0 || !(blankCreate < fleetBind && fleetBind < fleetNavigate)) {
  throw new Error('Fleet tab ownership must be persisted before ChatGPT navigation');
}

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
const adapter = textByFile.get(resolve(srcRoot, 'chatgptAdapter.ts')) ?? '';
if (!adapter.includes("!/^WEB:/i.test(decoded)")) throw new Error('Temporary WEB conversation ids must not become durable bindings');
const fleet = textByFile.get(resolve(srcRoot, 'fleet.ts')) ?? '';
if (!fleet.includes("/^WEB:/i.test(id)") || !fleet.includes("return 'https://chatgpt.com/'")) throw new Error('Fleet resume must reject temporary WEB conversation ids');
if (!fleet.includes("agent.browserState === 'opening'") || !fleet.includes("kind: 'report-absent'")) {
  throw new Error('Fleet opening reservation fence is missing');
}
const controlPlane = await readFile(resolve(root, 'control/src/controlPlane.ts'), 'utf8');
if (!controlPlane.includes('canonicalConversationKey(input.conversationKey)') || !controlPlane.includes("/^WEB:/i.test(id)")) throw new Error('Kernel canonical conversation authority fence is missing');
const rpcParams = await readFile(resolve(root, 'control/src/rpcParams.ts'), 'utf8');
const rpc = await readFile(resolve(root, 'control/src/rpc.ts'), 'utf8');
if (rpcParams.includes('ControlPlane') || rpcParams.includes('OrganizationRpcController')) throw new Error('RPC parameter contracts must remain independent of business controllers');
for (const helper of ['record', 'stringParam', 'numberParam', 'objectParam', 'objectArrayParam', 'enumParam']) {
  if (rpc.includes('function ' + helper)) throw new Error('RPC parameter helper leaked back into router: ' + helper);
}
for (const fence of ['Stale agent browser observation', 'Stale browser runtime observation']) {
  if (!controlPlane.includes(fence)) throw new Error(`Kernel observation fence missing: ${fence}`);
}
const nativeHost = await readFile(resolve(root, 'native-host/GamNativeHost/Program.cs'), 'utf8');
for (const method of ['agent.rollover-request','agent.rollover-begin','agent.rollover-bootstrap','agent.rollover-complete','agent.rollover-fail','agent.rollover-status']) {
  if (!nativeHost.includes(`"${method}"`)) throw new Error(`Native Host rollover allowlist is missing ${method}`);
}
const database = await readFile(resolve(root, 'control/src/database.ts'), 'utf8');
for (const token of ['CONTROL_SCHEMA_VERSION = 21', 'agent_conversations', 'worker_checkpoints', 'agent_rollovers', 'self_hosting_promotions']) {
  if (!database.includes(token)) throw new Error(`Control schema fence missing: ${token}`);
}
const conversationAuthority = await readFile(resolve(root, 'control/src/conversationAuthority.ts'), 'utf8');
if (!conversationAuthority.includes("operation.outcome !== 'reply-observed'")) throw new Error('Kernel rollover completion lost reply-evidence authority');
if (!fleet.includes("agent.rolloverState !== 'idle'")) throw new Error('Rollover workers must remain excluded from normal task dispatch');
const rolloverRuntime = textByFile.get(resolve(srcRoot, 'conversationRollover.ts')) ?? '';
for (const token of ['GAM CONVERSATION ROLLOVER HANDOFF', 'conversationLimitRetryTransition', 'bootstrapPendingConversationRollover']) {
  if (!rolloverRuntime.includes(token)) throw new Error(`Conversation rollover runtime fence missing: ${token}`);
}

console.log(`Architecture hard-cut checks passed (${files.length} src files; background ${backgroundLines} lines).`);
