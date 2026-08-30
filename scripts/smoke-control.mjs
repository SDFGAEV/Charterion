import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const repo = process.cwd();
const home = mkdtempSync(join(tmpdir(), 'gam-smoke-'));
const pipe = process.platform === 'win32'
  ? `\\\\.\\pipe\\gam-smoke-${randomUUID()}`
  : join(home, 'gamd.sock');
const env = { ...process.env, GAM_HOME: home, GAM_PIPE_NAME: pipe };
const daemon = spawn(process.execPath, [join(repo, 'dist-control', 'gamd.cjs')], {
  cwd: repo, env, stdio: ['ignore', 'ignore', 'pipe'],
});
let daemonError = '';
daemon.stderr.setEncoding('utf8');
daemon.stderr.on('data', (chunk) => { daemonError += chunk; });
function call(method, params = {}, extraEnv = {}) {
  const result = spawnSync(process.execPath, [join(repo, 'dist-control', 'gamctl.cjs'), method, '--stdin'], {
    cwd: repo,
    env: { ...env, ...extraEnv },
    input: JSON.stringify(params),
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (result.error) throw result.error;
  const text = result.stdout.trim();
  if (!text) throw new Error(`gamctl ${method} produced no output: ${result.stderr}`);
  const response = JSON.parse(text);
  if (!response.ok) throw new Error(`gamctl ${method} failed: ${response.error?.code} ${response.error?.message}`);
  return response.result;
}

function callExpectFailure(method, params, extraEnv = {}) {
  const result = spawnSync(process.execPath, [join(repo, 'dist-control', 'gamctl.cjs'), method, '--stdin'], {
    cwd: repo, env: { ...env, ...extraEnv }, input: JSON.stringify(params), encoding: 'utf8', timeout: 10_000,
  });
  const response = JSON.parse(result.stdout.trim());
  if (response.ok) throw new Error(`${method} unexpectedly succeeded`);
  return response.error;
}
async function waitReady() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try { return call('health'); } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw new Error(`gamd did not become ready: ${daemonError}`);
}

try {
  const health = await waitReady();
  const project = call('project.create', { name: 'Smoke Project', rootPath: 'E:/smoke/project', isolationTier: 'c1-container' });
  const resource = call('resource.declare', { projectId: project.id, kind: 'workspace', label: 'smoke-workspace' });
  const lease = call('lease.acquire', {
    resourceId: resource.id, projectId: project.id, holderId: 'smoke-worker', mode: 'exclusive', ttlMs: 60_000,
  });
  const capability = call('capability.issue', {
    subject: 'smoke-worker', projectId: project.id, leaseEpoch: lease.epoch,
    scopes: ['resource:read', 'status:read'], resourceIds: [resource.id], ttlMs: 60_000,
  });
  const capEnv = { GAM_CAPABILITY_TOKEN: capability.token };
  const visible = call('resource.list', { projectId: project.id }, capEnv);
  if (!Array.isArray(visible) || !visible.some((item) => item.id === resource.id)) throw new Error('Capability read did not return resource');
  const denied = callExpectFailure('events.list', { projectId: project.id }, capEnv);
  if (denied.code !== 'INVALID_REQUEST' && denied.code !== 'UNAUTHORIZED') throw new Error(`Unexpected denial code ${denied.code}`);

  const events = call('events.list', { projectId: project.id });
  if (!Array.isArray(events) || events.length < 4) throw new Error('Expected durable control events');
  console.log(JSON.stringify({
    ok: true,
    protocolVersion: health.protocolVersion,
    projectId: project.id,
    resourceId: resource.id,
    leaseEpoch: lease.epoch,
    capabilityId: capability.id,
    eventCount: events.length,
  }, null, 2));
} finally {
  daemon.kill();
  await new Promise((resolve) => setTimeout(resolve, 100));
  rmSync(home, { recursive: true, force: true });
}
