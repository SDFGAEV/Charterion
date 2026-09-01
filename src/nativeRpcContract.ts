export interface NativeRpcError {
  code?: string;
  message?: string;
}

export interface NativeRpcResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: NativeRpcError;
}

function parseNativeRpcError(value: unknown): NativeRpcError {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Native response error is invalid');
  const item = value as Record<string, unknown>;
  if (item.code !== undefined && typeof item.code !== 'string') throw new Error('Native response error code is invalid');
  if (item.message !== undefined && typeof item.message !== 'string') throw new Error('Native response error message is invalid');
  if (item.code === undefined && item.message === undefined) throw new Error('Native response error is empty');
  const error: NativeRpcError = {};
  if (item.code !== undefined) error.code = item.code;
  if (item.message !== undefined) error.message = item.message;
  return error;
}

export function parseNativeRpcResponse(value: unknown): NativeRpcResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Native response is invalid');
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || !item.id || typeof item.ok !== 'boolean') throw new Error('Native response envelope is invalid');
  if (item.ok && item.error !== undefined) throw new Error('Successful native response cannot contain an error');
  if (!item.ok && item.error === undefined) throw new Error('Failed native response must contain an error');
  const result: NativeRpcResponse = { id: item.id, ok: item.ok };
  if (item.result !== undefined) result.result = item.result;
  if (item.error !== undefined) result.error = parseNativeRpcError(item.error);
  return result;
}

export function nativeResult(
  response: NativeRpcResponse,
  requestId: string,
  operation: string,
): unknown {
  if (!response || response.id !== requestId) {
    throw new Error(`Native control response does not match ${operation} request`);
  }
  if (!response.ok) {
    throw new Error(response.error?.message ?? `Native control host rejected ${operation}`);
  }
  return response.result;
}
