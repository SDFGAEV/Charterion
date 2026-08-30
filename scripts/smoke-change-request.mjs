import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const repo = process.cwd();
const root = mkdtempSync(join(tmpdir(), 'gam-cr-smoke-'));
const home = join(root, 'home');
const projectRoot = join(root, 'project');
mkdirSync(projectRoot);
const gitPath = process.env.GAM_GIT_PATH || 'git';
const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\gam-cr-${randomUUID()}` : join(home, 'gamd.sock');
const env = { ...process.env, GAM_HOME: home, GAM_PIPE_NAME: pipe, GAM_GIT_PATH: gitPath };

function git(args) {
  const result = spawnSync(gitPath, args, { cwd: projectRoot, encoding: 'utf8', timeout: 10_000 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}
git(['init', '-b', 'main']);
git(['config', 'user.name', 'GAM Smoke']);
git(['config', 'user.email', 'gam-smoke@example.invalid']);
writeFileSync(join(projectRoot, 'work.txt'), 'base\n');
git(['add', 'work.txt']);
git(['commit', '-m', 'base']);
const baseSha = git(['rev-parse', 'HEAD']);
git(['switch', '-c', 'gam/smoke/T1/A1']);
writeFileSync(join(projectRoot, 'work.txt'), 'worker change\n');
git(['add', 'work.txt']);
git(['commit', '-m', 'feat: worker change']);
const headSha = git(['rev-parse', 'HEAD']);

const daemon = spawn(process.execPath, [join(repo, 'dist-control', 'gamd.cjs')], {
  cwd: repo, env, stdio: ['ignore', 'ignore', 'pipe'],
});
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
  const result = invoke(method, params, extraEnv);
  if (result.error) throw result.error;
  const response = JSON.parse(result.stdout.trim());
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
  const project = call('project.create', { name: 'CR Smoke', rootPath: projectRoot, isolationTier: 'c1-container' });
  const resource = call('resource.declare', { projectId: project.id, kind: 'workspace', label: 'T1' });
  const lease = call('lease.acquire', {
    resourceId: resource.id, projectId: project.id, holderId: 'worker', taskId: 'T1', mode: 'exclusive', ttlMs: 60_000,
  });
  const worker = call('capability.issue', {
    subject: 'worker', projectId: project.id, taskId: 'T1', leaseEpoch: lease.epoch,
    scopes: ['claim:submit','change:open','change:read'], resourceIds: [resource.id], ttlMs: 60_000,
  });
  const workerEnv = { GAM_CAPABILITY_TOKEN: worker.token };  const claim = call('claim.submit', {
    projectId: project.id, taskId: 'T1', subject: 'worker', resourceId: resource.id,
    leaseEpoch: lease.epoch, summary: 'ready for supervisor review', commitSha: headSha,
  }, workerEnv);
  const verification = call('claim.verify', { claimId: claim.id });
  if (verification.status !== 'passed') throw new Error('Machine evidence did not pass');
  const change = call('change.open', {
    projectId: project.id, taskId: 'T1', subject: 'worker', branch: 'gam/smoke/T1/A1', targetBranch: 'main',
    baseSha, headSha, claimId: claim.id,
  }, workerEnv);
  const supervisor = call('capability.issue', {
    subject: 'supervisor', projectId: project.id, scopes: ['change:review','change:read'], ttlMs: 60_000,
  });
  const supervisorEnv = { GAM_CAPABILITY_TOKEN: supervisor.token };
  const review = call('review.submit', {
    changeRequestId: change.id, reviewerSubject: 'supervisor', headSha,
    verdict: 'approve', body: 'independent review passed',
  }, supervisorEnv);
  const queued = call('merge.queue', { changeRequestId: change.id });
  const prepared = call('merge.prepare', { queueEntryId: queued.id });
  if (prepared.status !== 'validating' || !prepared.candidateSha) throw new Error('Merge candidate was not prepared');
  git(['update-ref', 'refs/heads/main', prepared.candidateSha]);
  const observed = call('merge.observe', { queueEntryId: queued.id });
  if (observed.status !== 'integrated') throw new Error('Real Git integration was not observed');
  const listed = call('change.list', { projectId: project.id }, supervisorEnv);
  if (!Array.isArray(listed) || !listed.some((item) => item.id === change.id && item.status === 'integrated')) throw new Error('Integrated Change Request not observable');
  console.log(JSON.stringify({ ok: true, baseSha, headSha, candidateSha: prepared.candidateSha, integratedSha: observed.integratedSha, claimId: claim.id, changeRequestId: change.id, reviewId: review.id, queueEntryId: queued.id }, null, 2));
} finally {
  daemon.kill();
  await new Promise((resolve) => setTimeout(resolve, 100));
  rmSync(root, { recursive: true, force: true });
}