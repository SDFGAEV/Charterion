import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const repo = process.cwd();
const root = mkdtempSync(join(tmpdir(), 'gam-evidence-smoke-'));
const home = join(root, 'home');
const projectRoot = join(root, 'project');
mkdirSync(projectRoot);
const gitPath = process.env.GAM_GIT_PATH || 'git';
const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\gam-evidence-${randomUUID()}` : join(home, 'gamd.sock');
const env = { ...process.env, GAM_HOME: home, GAM_PIPE_NAME: pipe, GAM_GIT_PATH: gitPath };

function git(...args) {
  const result = spawnSync(gitPath, args, { cwd: projectRoot, encoding: 'utf8', timeout: 10_000, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}
git('init', '-b', 'main');
git('config', 'user.name', 'GAM Evidence Smoke');
git('config', 'user.email', 'gam-evidence@example.invalid');
writeFileSync(join(projectRoot, 'tracked.txt'), 'committed evidence\n');
git('add', 'tracked.txt');
git('commit', '-m', 'test: seed evidence');
const commitSha = git('rev-parse', 'HEAD');
const daemon = spawn(process.execPath, [join(repo, 'dist-control', 'gamd.cjs')], {
  cwd: repo, env, stdio: ['ignore', 'ignore', 'pipe'],
});
let daemonError = '';
daemon.stderr.setEncoding('utf8');
daemon.stderr.on('data', (chunk) => { daemonError += chunk; });

function invoke(method, params = {}, extraEnv = {}) {
  return spawnSync(process.execPath, [join(repo, 'dist-control', 'gamctl.cjs'), method, '--stdin'], {
    cwd: repo, env: { ...env, ...extraEnv }, input: JSON.stringify(params), encoding: 'utf8', timeout: 10_000,
  });
}
function call(method, params = {}, extraEnv = {}) {
  const result = invoke(method, params, extraEnv);
  if (result.error) throw result.error;
  const text = result.stdout.trim();
  if (!text) throw new Error(`${method} produced no output: ${result.stderr}`);
  const response = JSON.parse(text);
  if (!response.ok) throw new Error(`${method} failed: ${response.error?.code} ${response.error?.message}`);
  return response.result;
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
  const project = call('project.create', { name: 'Evidence Smoke', rootPath: projectRoot, isolationTier: 'c1-container' });
  const resource = call('resource.declare', { projectId: project.id, kind: 'workspace', label: 'evidence-workspace' });
  const lease = call('lease.acquire', {
    resourceId: resource.id, projectId: project.id, holderId: 'worker', taskId: 'T-EVID', mode: 'exclusive', ttlMs: 60_000,
  });
  const capability = call('capability.issue', {
    subject: 'worker', projectId: project.id, taskId: 'T-EVID', leaseEpoch: lease.epoch,
    scopes: ['claim:submit', 'artifact:register', 'claim:read'], resourceIds: [resource.id], ttlMs: 60_000,
  });
  const workerEnv = { GAM_CAPABILITY_TOKEN: capability.token };
  const firstClaim = call('claim.submit', {
    projectId: project.id, taskId: 'T-EVID', subject: 'worker', resourceId: resource.id,
    leaseEpoch: lease.epoch, summary: 'verified evidence', commitSha,
  }, workerEnv);
  call('artifact.register', { claimId: firstClaim.id, subject: 'worker', path: 'tracked.txt', kind: 'file' }, workerEnv);
  const firstVerification = call('claim.verify', { claimId: firstClaim.id });
  if (firstVerification.status !== 'passed') throw new Error('Expected committed evidence to pass verification');
  writeFileSync(join(projectRoot, 'tamper.txt'), 'before\n');
  const secondClaim = call('claim.submit', {
    projectId: project.id, taskId: 'T-EVID', subject: 'worker', resourceId: resource.id,
    leaseEpoch: lease.epoch, summary: 'tamper detection', commitSha,
  }, workerEnv);
  call('artifact.register', { claimId: secondClaim.id, subject: 'worker', path: 'tamper.txt', kind: 'report' }, workerEnv);
  writeFileSync(join(projectRoot, 'tamper.txt'), 'after mutation\n');
  const secondVerification = call('claim.verify', { claimId: secondClaim.id });
  if (secondVerification.status !== 'failed') throw new Error('Tampered evidence unexpectedly passed');
  console.log(JSON.stringify({
    ok: true, projectId: project.id, resourceId: resource.id, leaseEpoch: lease.epoch,
    commitSha, verifiedClaimId: firstClaim.id, rejectedClaimId: secondClaim.id,
    verifiedStatus: firstVerification.status, tamperStatus: secondVerification.status,
  }, null, 2));
} finally {
  daemon.kill();
  await new Promise((resolve) => setTimeout(resolve, 100));
  rmSync(root, { recursive: true, force: true });
}
