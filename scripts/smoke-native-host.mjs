import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const repo = process.cwd();
const packageVersion = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).version;
const home = mkdtempSync(join(tmpdir(), 'gam-native-smoke-'));
const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\gam-native-${randomUUID()}` : join(home, 'gamd.sock');
const env = { ...process.env, GAM_HOME: home, GAM_PIPE_NAME: pipe };
const daemon = spawn(process.execPath, [join(repo, 'dist-control', 'gamd.cjs')], {
  cwd: repo, env, stdio: ['ignore', 'ignore', 'pipe'],
});
let daemonError = '';
daemon.stderr.setEncoding('utf8');
daemon.stderr.on('data', (chunk) => { daemonError += chunk; });
const hostDir = join(repo, 'dist-native-host');
const hostExe = join(hostDir, 'GamNativeHost.exe');
const hostConfig = join(hostDir, 'gam-native-host.json');
const origin = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';
function cli(method, params = {}) {
  const result = spawnSync(process.execPath, [join(repo, 'dist-control', 'gamctl.cjs'), method, '--admin', '--stdin'], {
    cwd: repo, env, input: JSON.stringify(params), encoding: 'utf8', timeout: 10_000,
  });
  if (result.error) throw result.error;
  const response = JSON.parse(result.stdout.trim());
  if (!response.ok) throw new Error(`${method} failed: ${response.error?.message}`);
  return response.result;
}

async function waitReady() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { return cli('health'); } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw new Error(`gamd did not become ready: ${daemonError}`);
}

function frame(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}
function invokeNative(request) {
  const result = spawnSync(hostExe, [origin, '--parent-window=0'], {
    cwd: hostDir,
    input: frame(request),
    encoding: null,
    timeout: 10_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Native host failed: ${Buffer.from(result.stderr).toString('utf8')}`);
  const stdout = Buffer.from(result.stdout);
  if (stdout.length < 4) throw new Error('Native host returned an incomplete frame');
  const length = stdout.readUInt32LE(0);
  if (stdout.length !== length + 4) throw new Error('Native host response frame length is invalid');
  return JSON.parse(stdout.subarray(4).toString('utf8'));
}

try {
  const health = await waitReady();
  if (!/^[0-9a-f]{16}$/.test(health.instanceId ?? '')) throw new Error('gamd health did not expose a valid instanceId');
  const project = cli('project.create', {
    name: 'Native Host Project', rootPath: 'E:/native-host-smoke', isolationTier: 'c1-container',
  });
  const browserTokenPath = join(home, 'browser.token');
  if (readFileSync(browserTokenPath, 'utf8').trim().length < 32) throw new Error('browser.token was not created');
  writeFileSync(hostConfig, JSON.stringify({ pipeName: pipe, instanceId: health.instanceId, browserTokenPath, allowedOrigin: origin }, null, 2));
  const listed = invokeNative({ id: 'list', method: 'project.list', params: {} });
  if (!listed.ok || !Array.isArray(listed.result) || !listed.result.some((item) => item.id === project.id)) {
    throw new Error('Native host did not return the expected project');
  }
  const reported = invokeNative({ id: 'browser-report', method: 'browser.report', params: {
    profileId: 'gam-default', authStatus: 'authenticated', pageHealth: 'ready', openTabs: 2, extensionVersion: packageVersion, observedAt: Date.now(),
  }});
  if (!reported.ok || reported.result?.authStatus !== 'authenticated') throw new Error('Native host did not accept browser runtime report');
  const browserStatus = invokeNative({ id: 'browser-status', method: 'browser.status', params: {} });
  if (!browserStatus.ok || !Array.isArray(browserStatus.result) || browserStatus.result[0]?.authStatus !== 'authenticated') {
    throw new Error('Native host did not return browser runtime status');
  }  const slot = cli('agent.spawn', { projectId: project.id, role: 'ROLE_NATIVE' });
  const agentObserved = invokeNative({ id: 'agent-observe', method: 'agent.browser-report', params: {
    slotId: slot.id, profileId: 'gam-default', browserState: 'open', tabId: 77, conversationKey: 'conversation:native-worker', observedAt: Date.now(),
  }});
  if (!agentObserved.ok || agentObserved.result?.browserState !== 'open') throw new Error('Native host did not accept agent browser observation');
  const nativeSpawnDenied = invokeNative({ id: 'agent-spawn', method: 'agent.spawn', params: { projectId: project.id, role: 'ROLE_FORBIDDEN' } });
  if (nativeSpawnDenied.ok || nativeSpawnDenied.error?.code !== 'FORBIDDEN') throw new Error('Native host allowed browser-side fleet mutation');

  const denied = invokeNative({
    id: 'write', method: 'project.status', params: { projectId: project.id, status: 'paused' },
  });
  if (denied.ok || denied.error?.code !== 'FORBIDDEN') throw new Error('Native host did not block a mutation');

  const wrongOrigin = spawnSync(hostExe, ['chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/'], {
    cwd: hostDir, input: frame({ id: 'x', method: 'health' }), encoding: null, timeout: 10_000,
  });
  if (wrongOrigin.status === 0) throw new Error('Native host accepted an unapproved origin');
  console.log(JSON.stringify({ ok: true, projectId: project.id, nativeRead: true, browserReport: true, mutationBlocked: true, originBlocked: true }, null, 2));
} finally {
  daemon.kill();
  rmSync(hostConfig, { force: true });
  await new Promise((resolve) => setTimeout(resolve, 100));
  rmSync(home, { recursive: true, force: true });
}
