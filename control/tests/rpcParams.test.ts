import { describe, expect, it } from 'vitest';
import { enumParam, numberParam, objectArrayParam, objectParam, record, stringParam } from '../src/rpcParams';

describe('RPC parameter contracts', () => {
  it('accepts object records and rejects arrays/null', () => {
    expect(record({ value: 1 })).toEqual({ value: 1 });
    expect(() => record([])).toThrow('params must be an object');
    expect(() => record(null)).toThrow('params must be an object');
  });

  it('trims required and optional strings', () => {
    expect(stringParam({ name: '  charterion  ' }, 'name')).toBe('charterion');
    expect(stringParam({}, 'name', true)).toBeUndefined();
    expect(() => stringParam({}, 'name')).toThrow('name must be a non-empty string');
    expect(() => stringParam({ name: '   ' }, 'name')).toThrow('name must be a non-empty string');
  });

  it('accepts finite numbers and rejects invalid values', () => {
    expect(numberParam({ limit: 3 }, 'limit')).toBe(3);
    expect(numberParam({}, 'limit', true)).toBeUndefined();
    expect(() => numberParam({ limit: Number.NaN }, 'limit')).toThrow('limit must be a number');
    expect(() => numberParam({ limit: '3' }, 'limit')).toThrow('limit must be a number');
  });
  it('validates nested objects and object arrays with precise labels', () => {
    expect(objectParam({ state: { ready: true } }, 'state')).toEqual({ ready: true });
    expect(objectParam({}, 'state', true)).toBeUndefined();
    expect(objectArrayParam({ items: [{ id: 'a' }, { id: 'b' }] }, 'items')).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(() => objectParam({ state: [] }, 'state')).toThrow('state must be an object');
    expect(() => objectArrayParam({ items: [{ id: 'a' }, null] }, 'items')).toThrow('items[1] must be an object');
  });

  it('validates enum values and preserves optional semantics', () => {
    const allowed = ['active', 'paused'] as const;
    expect(enumParam({ status: ' active ' }, 'status', allowed)).toBe('active');
    expect(enumParam({}, 'status', allowed, true)).toBeUndefined();
    expect(() => enumParam({ status: 'retired' }, 'status', allowed)).toThrow('status is invalid');
  });
});
