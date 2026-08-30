import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const repo = process.cwd();
const home = mkdtempSync(join(tmpdir(), 'gam-launcher-smoke-'));
const pipe = process.platform === 'win32'
  ? `\\\\.\\pipe\\gam-launcher-${randomUUID()}`
  : join(home, 'gamd.sock');
const env = { ...process.env, GAM_HOME: home, GAM_PIPE_NAME: pipe, GAM_NO_BROWSER: '1' };
const gamd = join(repo, 'dist-control', 'gamd.cjs');
const gamctl = join(repo, 'dist-control', 'gamctl.cjs');
const gam = join(repo, 'dist-control', 'gam.cjs');
const daemon = spawn(process.execPath, [gamd], { cwd: repo, env, stdio: ['ignore', 'ignore', 'pipe'] });
let daemonError = '';
daemon.stderr.setEncoding('utf8');
daemon.stderr.on('data', (chunk) => { daemonError += chunk; });
function run(file, args = [], input) {
  const result = spawnSync(process.execPath, [file, ...args], {
    cwd: repo, env, input, encoding: 'utf8', timeout: 10_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${file} failed: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout.trim());
}

async function waitReady() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = run(gamctl, ['health']);
      if (response.ok) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`gamd did not become ready: ${daemonError}`);
}
try {
  await waitReady();
  const created = run(gamctl, ['project.create', '--stdin'], JSON.stringify({
    name: 'Launcher Smoke', rootPath: repo, isolationTier: 'c0-host',
  }));
  if (!created.ok) throw new Error('project.create failed');
  const status = run(gam, ['status', '--json']);
  if (status.status !== 'ready' || status.daemon !== 'already-running') throw new Error('launcher status is incorrect');
  const started = run(gam, ['start', '--json', '--no-browser']);
  if (started.status !== 'ready' || started.browser !== 'skipped') throw new Error('launcher start is incorrect');
  const opened = run(gam, ['open', 'Launcher Smoke', '--json', '--no-browser']);
  if (opened.status !== 'ready' || opened.project?.id !== created.result.id) throw new Error('launcher open did not resolve project');
  const doctor = run(gam, ['doctor', '--json']);
  if (doctor.status !== 'ready') throw new Error('launcher doctor failed');
  console.log(JSON.stringify({ ok: true, projectId: created.result.id, status, started, opened, doctor }, null, 2));
} finally {
  daemon.kill();
  await new Promise((resolve) => setTimeout(resolve, 100));
  rmSync(home, { recursive: true, force: true });
}
