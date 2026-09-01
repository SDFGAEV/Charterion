export interface NativeRpcResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code?: string; message?: string };
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
