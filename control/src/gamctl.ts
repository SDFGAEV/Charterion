import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolveDaemonConfig } from './config';
import { sendRpc } from './ipc';
import type { RpcRequest } from './contracts';

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
  if (!method) throw new Error('Usage: gamctl <rpc-method> [--params JSON|--params-file PATH|--stdin] [--capability-file PATH]');
  let params: Record<string, unknown> = {};
  let capabilityToken = process.env.GAM_CAPABILITY_TOKEN?.trim() || undefined;
  let useAdmin = capabilityToken === undefined;
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
    } else if (arg === '--no-admin') {
      useAdmin = false;
    } else throw new Error(`Unknown argument ${arg}`);
  }
  const result: CliOptions = { method, params, useAdmin };
  if (capabilityToken !== undefined) result.capabilityToken = capabilityToken;
  return result;
}
async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = resolveDaemonConfig();
  const request: RpcRequest = {
    id: randomUUID(),
    method: options.method,
    params: options.params,
  };
  if (options.capabilityToken) request.auth = { capabilityToken: options.capabilityToken };
  else if (options.useAdmin && options.method !== 'health') {
    request.auth = { adminToken: readFileSync(config.adminTokenPath, 'utf8').trim() };
  }
  const response = await sendRpc(config.pipeName, request);
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
  if (!response.ok) process.exitCode = 2;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
