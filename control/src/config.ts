import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, win32 } from 'node:path';
import type { DaemonConfig } from './contracts';

function canonicalHomeIdentity(homeDir: string, platform = process.platform): string {
  const absolute = platform === 'win32' ? win32.resolve(homeDir) : resolve(homeDir);
  const normalized = absolute.replace(/\\/g, '/');
  return platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function deriveInstanceId(homeDir: string, platform = process.platform): string {
  return createHash('sha256').update(canonicalHomeIdentity(homeDir, platform)).digest('hex').slice(0, 16);
}

export function derivePipeName(homeDir: string, platform = process.platform): string {
  const instanceId = deriveInstanceId(homeDir, platform);
  return platform === 'win32'
    ? `\\\\.\\pipe\\charterion-${instanceId}`
    : join(resolve(homeDir), `gamd-${instanceId}.sock`);
}

export function resolveDaemonConfig(env: NodeJS.ProcessEnv = process.env): DaemonConfig {
  const homeDir = resolve(env.GAM_HOME?.trim() || join(homedir(), '.charterion'));
  const instanceId = deriveInstanceId(homeDir);
  return {
    homeDir,
    instanceId,
    databasePath: join(homeDir, 'global.db'),
    adminTokenPath: join(homeDir, 'admin.token'),
    browserTokenPath: join(homeDir, 'browser.token'),
    gitPath: env.GAM_GIT_PATH?.trim() || 'git',
    pipeName: env.GAM_PIPE_NAME?.trim() || derivePipeName(homeDir),
  };
}

function ensureToken(path: string, homeDir: string): string {
  mkdirSync(homeDir, { recursive: true, mode: 0o700 });
  try {
    const existing = readFileSync(path, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch { /* create below */ }
  const token = randomBytes(32).toString('base64url');
  writeFileSync(path, `${token}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return token;
}

export function ensureAdminToken(config: DaemonConfig): string {
  return ensureToken(config.adminTokenPath, config.homeDir);
}

export function ensureBrowserToken(config: DaemonConfig): string {
  return ensureToken(config.browserTokenPath, config.homeDir);
}
