export type JsonObject = Record<string, unknown>;

export function parseJsonObject(value: string, label: string): JsonObject {
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch (error) { throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object`);
  return parsed as JsonObject;
}

export function parseJsonStringArray(value: string, label: string): string[] {
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch (error) { throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string' && item.trim().length > 0)) {
    throw new Error(`${label} must be a string array`);
  }
  return [...parsed];
}

export function parseJsonRecord(value: string, label: string): Record<string, unknown> {
  return parseJsonObject(value, label);
}
