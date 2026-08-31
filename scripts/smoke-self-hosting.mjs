import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConnection } from 'node:net';

const repo = process.cwd();
const root = mkdtempSync(join(tmpdir(), 'gam-selfhost-smoke-'));
const parentHome = join(root, 'parent-home');
const candidateHome = join(root, 'candidate-home');
const projectRoot = join(root, 'parent-repo');
const gitPath = process.env.GAM_GIT_PATH || 'git';
const parentPipe = process.platform === 'win32' ? `\\\\.\\pipe\\gam-parent-${randomUUID()}` : join(parentHome, 'gamd.sock');
const candidatePipe = process.platform === 'win32' ? `\\\\.\\pipe\\gam-candidate-${randomUUID()}` : join(candidateHome, 'gamd.sock');
const parentEnv = { ...process.env, GAM_HOME: parentHome, GAM_PIPE_NAME: parentPipe, GAM_GIT_PATH: gitPath };
const candidateEnv = { ...process.env, GAM_HOME: candidateHome, GAM_PIPE_NAME: candidatePipe, GAM_GIT_PATH: gitPath };
const daemons = [];

function git(cwd, args) {
  const result = spawnSync(gitPath, ['-C', cwd, ...args], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  return result.stdout.trim();
}
const gateSourceSha = git(repo, ['rev-parse', 'HEAD']);

function startDaemon(env) {
  const child = spawn(process.execPath, [join(repo, 'dist-control', 'gamd.cjs')], {
    cwd: repo, env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  daemons.push({ child, stderr: () => stderr });
  return child;
}

function invoke(env, method, params = {}, capabilityFile) {
  const args = [join(repo, 'dist-control', 'gamctl.cjs'), method];
  if (capabilityFile) args.push('--capability-file', capabilityFile);
  else if (method !== 'health') args.push('--admin');
  args.push('--stdin');
  return spawnSync(process.execPath, args, {
    cwd: repo, env, input: JSON.stringify(params), encoding: 'utf8', timeout: 15_000, windowsHide: true,
  });
}

function parseResponse(result) {
  const text = String(result.stdout || '').trim();
  if (!text) throw new Error(String(result.stderr || result.error?.message || 'empty gamctl response').trim());
  return JSON.parse(text);
}
function call(env, method, params = {}, capabilityFile) {
  const response = parseResponse(invoke(env, method, params, capabilityFile));
  if (!response.ok) throw new Error(`${method} failed: ${response.error?.code} ${response.error?.message}`);
  return response.result;
}

function expectFailure(env, method, params, pattern, capabilityFile) {
  const response = parseResponse(invoke(env, method, params, capabilityFile));
  if (response.ok) throw new Error(`${method} unexpectedly succeeded`);
  const message = `${response.error?.code ?? ''} ${response.error?.message ?? ''}`;
  if (!pattern.test(message)) throw new Error(`${method} failed for wrong reason: ${message}`);
  return message;
}

async function waitReady(env, label) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try { return call(env, 'health'); } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  const record = daemons.find((item) => item.child.exitCode === null);
  throw new Error(`${label} gamd did not become ready: ${record?.stderr() ?? ''}`);
}

function rawRpc(pipeName, request) {
  return new Promise((resolve, reject) => {
    const socket = createConnection(pipeName);
    let buffer = '';
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('raw RPC timeout')); }, 10_000);
    const finish = (error, value) => {
      clearTimeout(timer); socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    socket.setEncoding('utf8');
    socket.once('error', (error) => finish(error));
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`, 'utf8'));
    socket.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try { finish(undefined, JSON.parse(buffer.slice(0, newline))); }
      catch (error) { finish(error); }
    });
  });
}

async function browserCall(instanceId, browserToken, method, params = {}) {
  const response = await rawRpc(candidatePipe, {
    id: randomUUID(), method, instanceId, auth: { browserToken }, params,
  });
  if (!response.ok) throw new Error(`${method} failed: ${response.error?.code} ${response.error?.message}`);
  return response.result;
}
function issueCapability(subject, projectId, scopes, extra = {}) {
  const grant = call(candidateEnv, 'capability.issue', {
    subject, projectId, scopes, ttlMs: 120_000, ...extra,
  });
  const tokenPath = join(root, `cap-${grant.id}.token`);
  writeFileSync(tokenPath, `${grant.token}\n`, { encoding: 'utf8', mode: 0o600 });
  return { ...grant, tokenPath };
}

async function seedTask(project, slot, browserToken, instanceId, taskId) {
  const snapshot = call(candidateEnv, 'work.snapshot');
  const now = Date.now();
  const task = {
    id: taskId, kind: 'work', completionPolicy: 'verified-claim', title: taskId,
    project: project.name, instruction: `complete ${taskId}`, targetRole: slot.role,
    dependsOn: [], attemptIds: [], createdAt: now, updatedAt: now,
  };
  await browserCall(instanceId, browserToken, 'work.replace', {
    expectedRevision: snapshot.revision,
    transportGeneration: `selfhost-${taskId}`,
    transportSequence: snapshot.revision + 1,
    transportMessageId: `selfhost-${taskId}-${snapshot.revision + 1}`,
    tasks: [...snapshot.tasks, task], attempts: snapshot.attempts, messages: snapshot.messages,
  });
  return task;
}

async function createVerifiedCandidate(project, slot, browserToken, instanceId, taskId, filename) {
  const expectedParentSha = git(projectRoot, ['rev-parse', 'refs/heads/main']);
  await seedTask(project, slot, browserToken, instanceId, taskId);
  const workspace = call(candidateEnv, 'workspace.provision', { projectId: project.id, slotId: slot.id, taskId });
  if (workspace.baseSha !== expectedParentSha) throw new Error(`workspace base mismatch for ${taskId}`);
  writeFileSync(join(workspace.path, filename), `${taskId}\n`);
  git(workspace.path, ['add', filename]);
  git(workspace.path, ['commit', '-m', `test: ${taskId}`]);
  const candidateSha = git(workspace.path, ['rev-parse', 'HEAD']);
  if (candidateSha === expectedParentSha) throw new Error(`${taskId} did not create a candidate commit`);
  const claim = call(candidateEnv, 'claim.submit', {
    projectId: project.id, taskId, subject: slot.id,
    resourceId: workspace.resourceId, leaseEpoch: workspace.leaseEpoch,
    summary: `${taskId} candidate ready`, commitSha: candidateSha,
  }, workspace.capabilityTokenPath);
  const verification = call(candidateEnv, 'claim.verify', { claimId: claim.id }, workspace.capabilityTokenPath);
  if (verification.status !== 'passed') throw new Error(`${taskId} verification did not pass`);
  const listed = call(candidateEnv, 'workspace.list', { projectId: project.id });
  const finalized = listed.find((item) => item.id === workspace.id);
  if (!finalized || finalized.status !== 'released') throw new Error(`${taskId} workspace was not released after verification`);
  if (existsSync(workspace.capabilityTokenPath)) throw new Error(`${taskId} capability token survived verified cleanup`);
  return { taskId, workspace, claim, verification, candidateSha, expectedParentSha };
}

function requestPromotion(projectId, claim, candidateSha, expectedParentSha, key, requesterCap) {
  return call(candidateEnv, 'promotion.request', {
    projectId, idempotencyKey: key, claimId: claim.id, candidateSha,
    targetRef: 'refs/heads/main', expectedParentSha, requestedBy: 'promotion-requester',
  }, requesterCap.tokenPath);
}
mkdirSync(projectRoot, { recursive: true });
git(projectRoot, ['init', '-b', 'main']);
git(projectRoot, ['config', 'user.name', 'GAM Selfhost Smoke']);
git(projectRoot, ['config', 'user.email', 'gam-selfhost-smoke@example.invalid']);
writeFileSync(join(projectRoot, 'README.md'), 'parent base\n');
git(projectRoot, ['add', 'README.md']);
git(projectRoot, ['commit', '-m', 'parent base']);
const initialParentSha = git(projectRoot, ['rev-parse', 'HEAD']);

startDaemon(parentEnv);
startDaemon(candidateEnv);

try {
  const parentHealth = await waitReady(parentEnv, 'parent');
  const candidateHealth = await waitReady(candidateEnv, 'candidate');
  if (parentHealth.instanceId === candidateHealth.instanceId) throw new Error('Parent/Candidate instance identity collided');
  if (parentPipe === candidatePipe) throw new Error('Parent/Candidate pipe identity collided');
  if (!existsSync(join(parentHome, 'global.db')) || !existsSync(join(candidateHome, 'global.db'))) throw new Error('isolated databases were not created');
  if (!existsSync(join(parentHome, 'browser.token')) || !existsSync(join(candidateHome, 'browser.token'))) throw new Error('isolated browser tokens were not created');

  const project = call(candidateEnv, 'project.create', {
    name: 'Selfhost Smoke', rootPath: projectRoot, isolationTier: 'c0-host', minSlots: 0, maxSlots: 2,
  });
  const slot = call(candidateEnv, 'agent.create', { projectId: project.id, role: 'CANDIDATE' });
  const browserToken = readFileSync(join(candidateHome, 'browser.token'), 'utf8').trim();
  const parentSnapshot = call(parentEnv, 'control.snapshot');
  if (parentSnapshot.projects.length !== 0) throw new Error('Candidate project leaked into Parent state');
  const requester = issueCapability('promotion-requester', project.id, ['promotion:request','promotion:read']);
  const authority = issueCapability('promotion-authority', project.id, ['promotion:decide','promotion:apply','promotion:read']);
  const candidateAuthority = issueCapability(slot.id, project.id, ['promotion:decide']);
  const taskBoundAuthority = issueCapability('task-bound-authority', project.id, ['promotion:decide'], { taskId: 'selfhost-success' });

  const success = await createVerifiedCandidate(project, slot, browserToken, candidateHealth.instanceId, 'selfhost-success', 'candidate-success.txt');
  expectFailure(candidateEnv, 'promotion.request', {
    projectId: project.id, idempotencyKey: 'wrong-exact-sha', claimId: success.claim.id,
    candidateSha: success.expectedParentSha, targetRef: 'refs/heads/main',
    expectedParentSha: success.expectedParentSha, requestedBy: 'promotion-requester',
  }, /exactly match/i, requester.tokenPath);
  const promotion = requestPromotion(project.id, success.claim, success.candidateSha, success.expectedParentSha, 'selfhost-success', requester);
  expectFailure(candidateEnv, 'promotion.decide', {
    promotionId: promotion.id, authoritySubject: slot.id, decision: 'approve', reason: 'self approval must fail',
  }, /cannot decide its own promotion/i, candidateAuthority.tokenPath);
  expectFailure(candidateEnv, 'promotion.decide', {
    promotionId: promotion.id, authoritySubject: 'task-bound-authority', decision: 'approve', reason: 'task-bound authority must fail',
  }, /task-bound capability cannot decide/i, taskBoundAuthority.tokenPath);
  const approved = call(candidateEnv, 'promotion.decide', {
    promotionId: promotion.id, authoritySubject: 'promotion-authority', decision: 'approve', reason: 'independent smoke review passed',
  }, authority.tokenPath);
  if (approved.status !== 'approved') throw new Error('promotion was not approved');
  const applied = call(candidateEnv, 'promotion.apply', { promotionId: promotion.id, authoritySubject: 'promotion-authority' }, authority.tokenPath);
  if (applied.status !== 'promoted') throw new Error('approved promotion was not applied');
  const promotedParentSha = git(projectRoot, ['rev-parse', 'refs/heads/main']);
  if (promotedParentSha !== success.candidateSha) throw new Error('Parent ref did not move to exact candidate SHA');
  git(projectRoot, ['reset', '--hard', 'main']);
  const drift = await createVerifiedCandidate(project, slot, browserToken, candidateHealth.instanceId, 'selfhost-drift', 'candidate-drift.txt');
  const driftPromotion = requestPromotion(project.id, drift.claim, drift.candidateSha, drift.expectedParentSha, 'selfhost-drift', requester);
  call(candidateEnv, 'promotion.decide', {
    promotionId: driftPromotion.id, authoritySubject: 'promotion-authority', decision: 'approve', reason: 'approve before parent drift',
  }, authority.tokenPath);
  writeFileSync(join(projectRoot, 'parent-drift.txt'), 'parent drift\n');
  git(projectRoot, ['add', 'parent-drift.txt']);
  git(projectRoot, ['commit', '-m', 'parent drift']);
  const driftedParentSha = git(projectRoot, ['rev-parse', 'HEAD']);
  expectFailure(candidateEnv, 'promotion.apply', {
    promotionId: driftPromotion.id, authoritySubject: 'promotion-authority',
  }, /drifted/i, authority.tokenPath);
  if (git(projectRoot, ['rev-parse', 'refs/heads/main']) !== driftedParentSha) throw new Error('Parent drift was overwritten');
  if (git(projectRoot, ['cat-file', '-t', drift.candidateSha]) !== 'commit') throw new Error('Drift-rejected candidate commit was lost');

  const rejectedCandidate = await createVerifiedCandidate(project, slot, browserToken, candidateHealth.instanceId, 'selfhost-reject', 'candidate-reject.txt');
  const rejectPromotion = requestPromotion(project.id, rejectedCandidate.claim, rejectedCandidate.candidateSha, rejectedCandidate.expectedParentSha, 'selfhost-reject', requester);
  const rejected = call(candidateEnv, 'promotion.decide', {
    promotionId: rejectPromotion.id, authoritySubject: 'promotion-authority', decision: 'reject', reason: 'intentional reject-preserve smoke',
  }, authority.tokenPath);
  if (rejected.status !== 'rejected') throw new Error('promotion rejection was not durable');
  expectFailure(candidateEnv, 'promotion.apply', {
    promotionId: rejectPromotion.id, authoritySubject: 'promotion-authority',
  }, /preserved and cannot be applied/i, authority.tokenPath);
  if (git(projectRoot, ['rev-parse', 'refs/heads/main']) !== driftedParentSha) throw new Error('Rejected promotion mutated Parent ref');
  if (git(projectRoot, ['cat-file', '-t', rejectedCandidate.candidateSha]) !== 'commit') throw new Error('Rejected candidate commit was not preserved');
  const promotions = call(candidateEnv, 'promotion.list', { projectId: project.id }, authority.tokenPath);
  const driftRecord = promotions.find((item) => item.id === driftPromotion.id);
  const rejectRecord = promotions.find((item) => item.id === rejectPromotion.id);
  if (driftRecord?.status !== 'approved' || rejectRecord?.status !== 'rejected') throw new Error('Promotion terminal states are not durable');

  console.log(JSON.stringify({
    ok: true,
    runtimeIsolation: {
      parentInstanceId: parentHealth.instanceId, candidateInstanceId: candidateHealth.instanceId,
      distinctInstance: parentHealth.instanceId !== candidateHealth.instanceId,
      distinctPipe: parentPipe !== candidatePipe, distinctDatabase: parentHome !== candidateHome,
    },
    exactWorkspace: { baseSha: success.expectedParentSha, candidateSha: success.candidateSha, verificationStatus: success.verification.status },
    promotion: { id: promotion.id, status: applied.status, parentSha: promotedParentSha, exactCandidateApplied: promotedParentSha === success.candidateSha },
    authority: { selfApprovalRejected: true, taskBoundAuthorityRejected: true, independentAuthority: 'promotion-authority' },
    parentDrift: { promotionId: driftPromotion.id, status: driftRecord.status, parentSha: driftedParentSha, candidatePreserved: true },
    rejectPreserve: { promotionId: rejectPromotion.id, status: rejectRecord.status, parentSha: driftedParentSha, candidatePreserved: true },
    initialParentSha, gateSourceSha,
  }, null, 2));
} finally {
  for (const { child } of daemons) if (child.exitCode === null) child.kill();
  await new Promise((resolve) => setTimeout(resolve, 250));
  rmSync(root, { recursive: true, force: true });
}
