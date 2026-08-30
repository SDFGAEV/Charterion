import { describe, expect, it } from 'vitest';
import { deriveInstanceId, derivePipeName, resolveDaemonConfig } from '../src/config';

describe('GAM runtime identity', () => {
  it('derives a stable Windows identity from the canonical GAM_HOME', () => {
    const upper = deriveInstanceId('C:\\Users\\Alice\\.gpt-agent-manager', 'win32');
    const lower = deriveInstanceId('c:/users/alice/.gpt-agent-manager', 'win32');
    expect(upper).toBe(lower);
    expect(upper).toMatch(/^[0-9a-f]{16}$/);
  });

  it('isolates different homes onto different default pipes', () => {
    const firstHome = process.platform === 'win32' ? 'C:\\gam\\first' : '/tmp/gam/first';
    const secondHome = process.platform === 'win32' ? 'C:\\gam\\second' : '/tmp/gam/second';
    const firstId = deriveInstanceId(firstHome);
    const secondId = deriveInstanceId(secondHome);
    expect(firstId).not.toBe(secondId);
    expect(derivePipeName(firstHome)).not.toBe(derivePipeName(secondHome));
    expect(derivePipeName(firstHome)).toContain(firstId);
  });

  it('keeps an explicit pipe override without changing instance identity', () => {
    const home = process.platform === 'win32' ? 'C:\\gam\\override' : '/tmp/gam/override';
    const config = resolveDaemonConfig({ GAM_HOME: home, GAM_PIPE_NAME: 'custom-pipe' });
    expect(config.instanceId).toBe(deriveInstanceId(config.homeDir));
    expect(config.pipeName).toBe('custom-pipe');
  });
});
