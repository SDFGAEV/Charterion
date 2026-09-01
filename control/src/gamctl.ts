import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolveDaemonConfig } from './config';
import { sendRpc } from './ipc';
import type { DaemonConfig, RpcRequest, RpcResponse } from './contracts';

interface CliOptions {
  method: string;
  params: Record<string, unknown>;
  capabilityToken?: string;
  useAdmin: boolean;
}

function parseObjectJson(raw: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label} must contain a JSON object`);
  return parsed as Record<string, unknown>;
}

function parseArgs(argv: string[]): CliOptions {
  const method = argv[0];
  if (!method) throw new Error('Usage: gamctl <rpc-method> [--params JSON|--params-file PATH|--stdin] [--capability-file PATH|--admin]');
  let params: Record<string, unknown> = {};
  let capabilityToken = process.env.GAM_CAPABILITY_TOKEN?.trim() || undefined;
  let useAdmin = false;
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--params') {
      const raw = argv[++i];
      if (!raw) throw new Error('--params requires JSON');
      params = parseObjectJson(raw, '--params');
    } else if (arg === '--params-file') {
      const path = argv[++i];
      if (!path) throw new Error('--params-file requires a path');
      params = parseObjectJson(readFileSync(path, 'utf8'), '--params-file');
    } else if (arg === '--stdin') {
      params = parseObjectJson(readFileSync(0, 'utf8'), 'stdin');
    } else if (arg === '--capability-file') {
      const path = argv[++i];
      if (!path) throw new Error('--capability-file requires a path');
      capabilityToken = readFileSync(path, 'utf8').trim();
      useAdmin = false;
    } else if (arg === '--admin') {
      if (capabilityToken) throw new Error('--admin cannot be combined with a capability token');
      useAdmin = true;
    } else if (arg === '--no-admin') {
      useAdmin = false;
    } else throw new Error(`Unknown argument ${arg}`);
  }
  const result: CliOptions = { method, params, useAdmin };
  if (capabilityToken !== undefined) result.capabilityToken = capabilityToken;
  return result;
}

function healthInstance(response: RpcResponse): string | undefined {
  if (!response.ok || !response.result || typeof response.result !== 'object') return undefined;
  const value = (response.result as Record<string, unknown>).instanceId;
  return typeof value === 'string' ? value : undefined;
}

async function assertExpectedDaemon(config: DaemonConfig): Promise<void> {
  const response = await sendRpc(config.pipeName, { id: randomUUID(), method: 'health' }, 1500);
  if (!response.ok) throw new Error(`GAM daemon health check failed: ${response.error.code}`);
  const observed = healthInstance(response);
  if (observed !== config.instanceId) {
    throw new Error(`GAM instance mismatch: expected ${config.instanceId}, observed ${observed ?? 'legacy-or-unknown'} on ${config.pipeName}`);
  }
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(argv);
  const config = resolveDaemonConfig();
  await assertExpectedDaemon(config);
  const request: RpcRequest = {
    id: randomUUID(),
    method: options.method,
    instanceId: config.instanceId,
    params: options.params,
  };
  if (options.capabilityToken) request.auth = { capabilityToken: options.capabilityToken };
  else if (options.useAdmin && options.method !== 'health') {
    request.auth = { adminToken: readFileSync(config.adminTokenPath, 'utf8').trim() };
  }
  const response = await sendRpc(config.pipeName, request);
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
  return response.ok ? 0 : 2;
}

const invokedPath = process.argv[1]?.toLowerCase() ?? '';
const isMainModule = invokedPath.endsWith('gamctl.cjs') || invokedPath.endsWith('gamctl.js');
if (isMainModule) {
  void run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
