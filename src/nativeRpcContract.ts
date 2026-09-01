export interface NativeRpcResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code?: string; message?: string };
}

export function parseNativeRpcResponse(value: unknown): NativeRpcResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Native response is invalid');
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || typeof item.ok !== 'boolean') throw new Error('Native response envelope is invalid');
  if (item.error !== undefined && (!item.error || typeof item.error !== 'object' || Array.isArray(item.error))) throw new Error('Native response error is invalid');
  const result: NativeRpcResponse = { id: item.id, ok: item.ok };
  if (item.result !== undefined) result.result = item.result;
  if (item.error) result.error = item.error as { code?: string; message?: string };
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
