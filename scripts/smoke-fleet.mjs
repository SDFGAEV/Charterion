import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const repo = process.cwd();
const home = mkdtempSync(join(tmpdir(), 'gam-fleet-smoke-'));
const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\gam-fleet-${randomUUID()}` : join(home, 'gamd.sock');
const env = { ...process.env, GAM_HOME: home, GAM_PIPE_NAME: pipe };
const daemon = spawn(process.execPath, [join(repo, 'dist-control', 'gamd.cjs')], { cwd: repo, env, stdio: ['ignore', 'ignore', 'pipe'] });
let daemonError = '';
daemon.stderr.setEncoding('utf8');
daemon.stderr.on('data', (chunk) => { daemonError += chunk; });

function invoke(method, params = {}, extraEnv = {}) {
  const args = [join(repo, 'dist-control', 'gamctl.cjs'), method, ...(extraEnv.GAM_CAPABILITY_TOKEN ? [] : ['--admin']), '--stdin'];
  return spawnSync(process.execPath, args, {
    cwd: repo, env: { ...env, ...extraEnv }, input: JSON.stringify(params), encoding: 'utf8', timeout: 10_000,
  });
}
function call(method, params = {}, extraEnv = {}) {
  const result = invoke(method, params, extraEnv); if (result.error) throw result.error;
  const response = JSON.parse(result.stdout.trim());
  if (!response.ok) throw new Error(`${method} failed: ${response.error?.code} ${response.error?.message}`);
  return response.result;
}
function expectFailure(method, params, extraEnv = {}) {
  const result = invoke(method, params, extraEnv);
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
  await waitReady();
  const project = call('project.create', { name: 'Fleet Smoke', rootPath: 'E:/fleet-smoke', maxSlots: 2 });
  const supervisor = call('capability.issue', {
    subject: 'supervisor', projectId: project.id,
    scopes: ['agent:fleet','agent:read','request:review','request:read'], ttlMs: 60_000,
  });
  const supervisorEnv = { GAM_CAPABILITY_TOKEN: supervisor.token };
  const slot = call('agent.spawn', { projectId: project.id, role: 'ROLE01' }, supervisorEnv);
  const worker = call('capability.issue', {
    subject: slot.id, projectId: project.id, agentSlotId: slot.id,
    scopes: ['request:submit','request:read'], ttlMs: 60_000,
  });
  const workerEnv = { GAM_CAPABILITY_TOKEN: worker.token };
  expectFailure('agent.spawn', { projectId: project.id, role: 'ROLE-X' }, workerEnv);
  const request = call('request.submit', {
    projectId: project.id, fromSubject: slot.id, type: 'suggestion',
    title: 'Add a second worker', body: 'The next task can run independently.', suggestedAction: 'spawn ROLE02',
  }, workerEnv);
  const beforeDecision = call('agent.list', { projectId: project.id }, supervisorEnv);
  if (beforeDecision.length !== 1) throw new Error('Worker request changed fleet state without Supervisor decision');
  const accepted = call('request.decide', {
    requestId: request.id, supervisorSubject: 'supervisor', decision: 'accept', note: 'Approved for parallel work.',
  }, supervisorEnv);
  if (accepted.status !== 'accepted') throw new Error('Supervisor decision was not persisted');
  const second = call('agent.spawn', { projectId: project.id, role: 'ROLE02' }, supervisorEnv);
  expectFailure('agent.spawn', { projectId: project.id, role: 'ROLE03' }, supervisorEnv);
  const suspended = call('agent.suspend', { slotId: slot.id }, supervisorEnv);
  if (suspended.desiredState !== 'suspended') throw new Error('Suspend desired state was not persisted');
  expectFailure('request.list', { projectId: project.id }, workerEnv);
  const resumed = call('agent.resume', { slotId: slot.id }, supervisorEnv);
  if (resumed.desiredState !== 'active') throw new Error('Resume desired state was not persisted');
  expectFailure('request.list', { projectId: project.id }, workerEnv);
  const retired = call('agent.retire', { slotId: second.id }, supervisorEnv);
  if (retired.desiredState !== 'retired') throw new Error('Retire desired state was not persisted');
  expectFailure('agent.resume', { slotId: second.id }, supervisorEnv);
  const resolved = call('request.resolve', {
    requestId: request.id, supervisorSubject: 'supervisor', note: 'Fleet action completed.',
  }, supervisorEnv);
  const agents = call('agent.list', { projectId: project.id }, supervisorEnv);
  const events = call('events.list', { projectId: project.id });
  console.log(JSON.stringify({
    ok: true, projectId: project.id, firstSlotId: slot.id, secondSlotId: second.id,
    requestId: request.id, requestStatus: resolved.status,
    activeAgents: agents.filter((item) => item.desiredState === 'active').length,
    retiredAgents: agents.filter((item) => item.desiredState === 'retired').length,
    eventCount: events.length,
  }, null, 2));
} finally {
  daemon.kill();
  await new Promise((resolve) => setTimeout(resolve, 100));
  rmSync(home, { recursive: true, force: true });
}
