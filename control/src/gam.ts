import { existsSync, mkdirSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ensureBrowserToken, resolveDaemonConfig } from './config';
import { sendRpc } from './ipc';
import type { RpcRequest, RpcResponse } from './contracts';

type Command = 'start' | 'status' | 'open' | 'doctor';
interface LaunchOptions {
  command: Command;
  project?: string;
  json: boolean;
  agent: boolean;
  noBrowser: boolean;
}
interface LauncherResult {
  status: 'ready' | 'not-running' | 'error';
  command: Command;
  daemon?: 'started' | 'already-running' | 'not-running';
  browser?: 'launched' | 'skipped' | 'unavailable';
  chromeProfile?: string;
  chatgpt?: 'unknown' | 'authentication-required' | 'authenticated';
  project?: Record<string, unknown>;
  details?: Record<string, unknown>;
}
export function parseLauncherArgs(argv: string[]): LaunchOptions {
  let command: Command = 'start';
  let project: string | undefined;
  let json = false;
  let agent = false;
  let noBrowser = false;
  const positional: string[] = [];
  for (const arg of argv) {
    if (arg === '--json') json = true;
    else if (arg === '--agent') agent = true;
    else if (arg === '--no-browser') noBrowser = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}`);
    else positional.push(arg);
  }
  if (positional[0]) {
    if (!['start', 'status', 'open', 'doctor'].includes(positional[0])) throw new Error(`Unknown command ${positional[0]}`);
    command = positional[0] as Command;
  }
  if (command === 'open') {
    project = positional.slice(1).join(' ').trim();
    if (!project) throw new Error('open requires a project id or name');
  } else if (positional.length > 1) throw new Error(`${command} does not accept positional arguments`);
  return { command, ...(project ? { project } : {}), json, agent: agent || json, noBrowser };
}
function launcherDir(): string {
  return dirname(resolve(process.argv[1] ?? process.cwd()));
}

function repoRoot(): string {
  const explicit = process.env.GAM_EXTENSION_DIR?.trim();
  if (explicit) return resolve(explicit);
  const candidate = dirname(launcherDir());
  return existsSync(join(candidate, 'manifest.json')) ? candidate : process.cwd();
}

function findChrome(): string | undefined {
  const explicit = process.env.GAM_BROWSER_PATH?.trim() || process.env.GAM_CHROME_PATH?.trim();
  const candidates = [
    explicit,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined,
    process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined,
    process.env['PROGRAMFILES(X86)'] ? join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined,
    process.env.SystemDrive ? join(process.env.SystemDrive, 'Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe') : undefined,
    process.env.PROGRAMFILES ? join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : undefined,
    process.env['PROGRAMFILES(X86)'] ? join(process.env['PROGRAMFILES(X86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe') : undefined,
    process.env.SystemDrive ? join(process.env.SystemDrive, 'Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe') : undefined,
  ].filter((value): value is string => Boolean(value));
  return candidates.find(existsSync);
}

async function rpc(request: RpcRequest, timeoutMs = 3000): Promise<RpcResponse> {
  const config = resolveDaemonConfig();
  return sendRpc(config.pipeName, { ...request, instanceId: config.instanceId }, timeoutMs);
}

type DaemonProbe =
  | { kind: 'absent' }
  | { kind: 'matching' }
  | { kind: 'foreign'; observedInstanceId?: string };

function healthInstance(response: RpcResponse): string | undefined {
  if (!response.ok || !response.result || typeof response.result !== 'object') return undefined;
  const value = (response.result as Record<string, unknown>).instanceId;
  return typeof value === 'string' ? value : undefined;
}

async function probeDaemon(): Promise<DaemonProbe> {
  const config = resolveDaemonConfig();
  try {
    const response = await sendRpc(config.pipeName, { id: randomUUID(), method: 'health' }, 1000);
    if (!response.ok) return { kind: 'absent' };
    const observedInstanceId = healthInstance(response);
    return observedInstanceId === config.instanceId
      ? { kind: 'matching' }
      : { kind: 'foreign', ...(observedInstanceId ? { observedInstanceId } : {}) };
  } catch { return { kind: 'absent' }; }
}

function foreignInstanceError(probe: Extract<DaemonProbe, { kind: 'foreign' }>): Error {
  const config = resolveDaemonConfig();
  return new Error(`GAM pipe ${config.pipeName} belongs to another instance: expected ${config.instanceId}, observed ${probe.observedInstanceId ?? 'legacy-or-unknown'}`);
}

async function ensureDaemon(): Promise<'started' | 'already-running'> {
  const initial = await probeDaemon();
  if (initial.kind === 'matching') return 'already-running';
  if (initial.kind === 'foreign') throw foreignInstanceError(initial);
  const config = resolveDaemonConfig();
  mkdirSync(config.homeDir, { recursive: true });
  const gamdPath = join(launcherDir(), 'gamd.cjs');
  if (!existsSync(gamdPath)) throw new Error(`gamd is missing at ${gamdPath}`);
  const logDir = join(config.homeDir, 'logs');
  mkdirSync(logDir, { recursive: true });
  const out = openSync(join(logDir, 'gamd.log'), 'a');
  const err = openSync(join(logDir, 'gamd-error.log'), 'a');
  const child = spawn(process.execPath, [gamdPath], {
    detached: true, windowsHide: true, stdio: ['ignore', out, err],
    env: { ...process.env, GAM_HOME: config.homeDir, GAM_PIPE_NAME: config.pipeName },
  });
  child.unref();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const probe = await probeDaemon();
    if (probe.kind === 'matching') return 'started';
    if (probe.kind === 'foreign') throw foreignInstanceError(probe);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`gamd did not become healthy for instance ${config.instanceId} on ${config.pipeName}`);
}
function launchBrowser(noBrowser: boolean): { browser: 'launched' | 'skipped' | 'unavailable'; chromeProfile: string; chromePath?: string } {
  const config = resolveDaemonConfig();
  const profile = join(config.homeDir, 'chrome-profile');
  if (noBrowser || process.env.GAM_NO_BROWSER === '1') return { browser: 'skipped', chromeProfile: profile };
  const chrome = findChrome();
  if (!chrome) return { browser: 'unavailable', chromeProfile: profile };
  mkdirSync(profile, { recursive: true });
  const extension = repoRoot();
  const args = [
    `--user-data-dir=${profile}`,
    '--new-window',
    'https://chatgpt.com/',
  ];
  if (existsSync(join(extension, 'manifest.json'))) args.splice(1, 0, `--load-extension=${extension}`);
  const child = spawn(chrome, args, { detached: true, windowsHide: false, stdio: 'ignore' });
  child.unref();
  return { browser: 'launched', chromeProfile: profile, chromePath: chrome };
}

async function browserSnapshot(): Promise<Record<string, unknown> | undefined> {
  const config = resolveDaemonConfig();
  const browserToken = ensureBrowserToken(config);
  try {
    const response = await rpc({ id: randomUUID(), method: 'control.snapshot', auth: { browserToken } }, 3000);
    return response.ok && response.result && typeof response.result === 'object' ? response.result as Record<string, unknown> : undefined;
  } catch { return undefined; }
}
async function browserAuthStatus(waitMs = 0): Promise<'unknown' | 'authenticated' | 'authentication-required'> {
  const config = resolveDaemonConfig();
  const browserToken = ensureBrowserToken(config);
  const deadline = Date.now() + waitMs;
  do {
    try {
      const response = await rpc({ id: randomUUID(), method: 'browser.status', auth: { browserToken } }, 1500);
      if (response.ok && Array.isArray(response.result)) {
        const row = response.result.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).profileId === 'gam-default') as Record<string, unknown> | undefined;
        const status = row?.authStatus;
        if (status === 'authenticated' || status === 'authentication-required') return status;
      }
    } catch { /* native browser runtime may not have reported yet */ }
    if (Date.now() < deadline) await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  } while (Date.now() < deadline);
  return 'unknown';
}
function projectFromSnapshot(snapshot: Record<string, unknown> | undefined, selector: string): Record<string, unknown> | undefined {
  if (!snapshot || !Array.isArray(snapshot.projects)) return undefined;
  const needle = selector.toLowerCase();
  const matches = snapshot.projects.filter((entry): entry is Record<string, unknown> => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const project = entry as Record<string, unknown>;
    return String(project.id ?? '').toLowerCase() === needle || String(project.name ?? '').toLowerCase() === needle;
  });
  if (matches.length > 1) throw new Error(`Project selector ${selector} is ambiguous`);
  return matches[0];
}

function doctor(): LauncherResult {
  const config = resolveDaemonConfig();
  const chrome = findChrome();
  const extension = repoRoot();
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const details = {
    node: process.version,
    nodeSupported: nodeMajor >= 22,
    gamHome: config.homeDir,
    instanceId: config.instanceId,
    pipeName: config.pipeName,
    chromePath: chrome ?? null,
    chromeAvailable: Boolean(chrome),
    extensionDir: extension,
    extensionManifest: existsSync(join(extension, 'manifest.json')),
    gamdBundle: existsSync(join(launcherDir(), 'gamd.cjs')),
    platform: process.platform,
  };
  const ready = details.nodeSupported && details.gamdBundle && details.extensionManifest;
  return { status: ready ? 'ready' : 'error', command: 'doctor', details };
}
async function execute(options: LaunchOptions): Promise<LauncherResult> {
  if (options.command === 'doctor') return doctor();
  if (options.command === 'status') {
    const probe = await probeDaemon();
    if (probe.kind === 'absent') {
      const config = resolveDaemonConfig();
      return { status: 'not-running', command: 'status', daemon: 'not-running', details: { instanceId: config.instanceId, pipeName: config.pipeName } };
    }
    if (probe.kind === 'foreign') throw foreignInstanceError(probe);
    const snapshot = await browserSnapshot();
    const projects = Array.isArray(snapshot?.projects) ? snapshot.projects.length : 0;
    const changes = Array.isArray(snapshot?.changeRequests) ? snapshot.changeRequests.length : 0;
    const chatgpt = await browserAuthStatus();
    const config = resolveDaemonConfig();
    return { status: 'ready', command: 'status', daemon: 'already-running', chatgpt, details: { projects, changeRequests: changes, instanceId: config.instanceId, pipeName: config.pipeName } };
  }
  const daemon = await ensureDaemon();
  const snapshot = await browserSnapshot();
  let project: Record<string, unknown> | undefined;
  if (options.command === 'open') {
    project = projectFromSnapshot(snapshot, options.project!);
    if (!project) throw new Error(`Project ${options.project} was not found`);
  }
  const browser = launchBrowser(options.noBrowser);
  const chatgpt = await browserAuthStatus(browser.browser === 'launched' ? 5000 : 0);
  return {
    status: 'ready', command: options.command, daemon,
    browser: browser.browser, chromeProfile: browser.chromeProfile,
    chatgpt, ...(project ? { project } : {}),
    details: { chromePath: browser.chromePath ?? null, humanLoginMayBeRequired: browser.browser === 'launched', instanceId: resolveDaemonConfig().instanceId, pipeName: resolveDaemonConfig().pipeName },
  };
}
function printHuman(result: LauncherResult): void {
  if (result.status !== 'ready') {
    console.error(`GAM ${result.status}`);
    return;
  }
  if (result.command === 'doctor') {
    console.log('GAM doctor');
    for (const [key, value] of Object.entries(result.details ?? {})) console.log(`  ${key}: ${String(value)}`);
    return;
  }
  console.log('Charterion is ready.');
  if (result.daemon) console.log(`  Kernel: ${result.daemon}`);
  if (result.browser) console.log(`  Browser: ${result.browser}`);
  if (result.chromeProfile) console.log(`  Chrome profile: ${result.chromeProfile}`);
  if (result.project) console.log(`  Project: ${String(result.project.name ?? result.project.id ?? 'selected')}`);
  if (result.browser === 'launched') console.log('  ChatGPT: use the opened GAM Chrome profile; sign in manually if ChatGPT asks.');
}

async function main(): Promise<void> {
  let options: LaunchOptions;
  try { options = parseLauncherArgs(process.argv.slice(2)); }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }
  try {
    const result = await execute(options);
    if (options.json) console.log(JSON.stringify(result));
    else printHuman(result);
    if (result.status === 'error') process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) console.log(JSON.stringify({ status: 'error', command: options.command, code: 'LAUNCH_FAILED', message, recoverable: true }));
    else console.error(`GAM failed: ${message}`);
    process.exitCode = 20;
  }
}

void main();
