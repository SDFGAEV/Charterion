import { existsSync, unlinkSync } from 'node:fs';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import type { RpcRequest, RpcResponse } from './contracts';
import type { RpcRouter } from './rpc';

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

function writeResponse(socket: Socket, response: RpcResponse): void {
  if (socket.destroyed || !socket.writable) return;
  const frame = `${JSON.stringify(response)}\n`;
  if (Buffer.byteLength(frame, 'utf8') > MAX_RESPONSE_BYTES) {
    socket.destroy();
    return;
  }
  socket.write(frame, 'utf8');
}

export function startIpcServer(pipeName: string, router: RpcRouter): Promise<Server> {
  if (process.platform !== 'win32' && existsSync(pipeName)) unlinkSync(pipeName);
  const server = createServer((socket) => {
    socket.on('error', () => { /* connection-scoped transport failures must not terminate gamd */ });
    socket.setNoDelay(true);
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > MAX_REQUEST_BYTES) {
        writeResponse(socket, { id: 'unknown', ok: false, error: { code: 'REQUEST_TOO_LARGE', message: 'RPC request is too large' } });
        socket.destroy();
        return;
      }
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) handleLine(socket, line, router);
        newline = buffer.indexOf('\n');
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipeName, () => { server.off('error', reject); resolve(server); });
  });
}
function handleLine(socket: Socket, line: string, router: RpcRouter): void {
  let request: RpcRequest;
  try {
    request = JSON.parse(line) as RpcRequest;
  } catch {
    writeResponse(socket, { id: 'unknown', ok: false, error: { code: 'INVALID_JSON', message: 'RPC request is not valid JSON' } });
    return;
  }
  writeResponse(socket, router.handle(request));
}

export function sendRpc(pipeName: string, request: RpcRequest, timeoutMs = 5000): Promise<RpcResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(pipeName);
    socket.setNoDelay(true);
    let buffer = '';
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error, response?: RpcResponse): void => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(response!);
    };
    timer = setTimeout(() => finish(new Error('RPC timeout')), timeoutMs);
    socket.setEncoding('utf8');
    socket.once('error', (error) => finish(error));
    socket.once('close', () => finish(new Error('RPC connection closed before response')));
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`, 'utf8'));
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, 'utf8') > MAX_RESPONSE_BYTES) {
        finish(new Error('RPC response is too large'));
        return;
      }
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try {
        const parsed = JSON.parse(buffer.slice(0, newline)) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Daemon returned an invalid response envelope');
        const response = parsed as Record<string, unknown>;
        if (typeof response.id !== 'string' || typeof response.ok !== 'boolean') throw new Error('Daemon returned an invalid response envelope');
        if (response.id !== request.id) throw new Error('Daemon returned a response for a different request');
        finish(undefined, parsed as RpcResponse);
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Daemon returned invalid JSON'));
      }
    });
  });
}
