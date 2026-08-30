import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { DaemonConfig } from './contracts';

export function resolveDaemonConfig(env: NodeJS.ProcessEnv = process.env): DaemonConfig {
  const homeDir = env.GAM_HOME?.trim() || join(homedir(), '.gpt-agent-manager');
  const defaultPipe = process.platform === 'win32' ? '\\\\.\\pipe\\gpt-agent-manager-v1' : join(homeDir, 'gamd.sock');
  return {
    homeDir,
    databasePath: join(homeDir, 'global.db'),
    adminTokenPath: join(homeDir, 'admin.token'),
    browserTokenPath: join(homeDir, 'browser.token'),
    gitPath: env.GAM_GIT_PATH?.trim() || 'git',
    pipeName: env.GAM_PIPE_NAME?.trim() || defaultPipe,
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
