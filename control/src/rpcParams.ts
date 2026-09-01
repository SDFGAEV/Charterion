export type RpcParams = Record<string, unknown>;

export function record(value: unknown, label = 'params'): RpcParams {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as RpcParams;
}

export function stringParam(params: RpcParams, key: string, optional = false): string | undefined {
  const value = params[key];
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} must be a non-empty string`);
  return value.trim();
}

export function numberParam(params: RpcParams, key: string, optional = false): number | undefined {
  const value = params[key];
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${key} must be a number`);
  return value;
}

export function objectParam(params: RpcParams, key: string, optional = false): RpcParams | undefined {
  const value = params[key];
  if (value === undefined && optional) return undefined;
  return record(value, key);
}

export function objectArrayParam(params: RpcParams, key: string): RpcParams[] {
  const value = params[key];
  if (!Array.isArray(value)) throw new Error(`${key} must be an array`);
  return value.map((item, index) => record(item, `${key}[${index}]`));
}
export function enumParam<T extends string>(
  params: RpcParams,
  key: string,
  allowed: readonly T[],
  optional = false,
): T | undefined {
  const value = stringParam(params, key, optional);
  if (value === undefined) return undefined;
  if (!allowed.includes(value as T)) throw new Error(`${key} is invalid`);
  return value as T;
}
