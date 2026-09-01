import { describe, expect, it } from 'vitest';
import { parseJsonObject, parseJsonStringArray } from '../src/persistenceCodec';

describe('persistence codecs', () => {
  it('reject malformed JSON and non-object values', () => {
    expect(() => parseJsonObject('{', 'metadata')).toThrow(/not valid JSON/);
    expect(() => parseJsonObject('[]', 'metadata')).toThrow(/JSON object/);
  });

  it('accept only string arrays', () => {
    expect(parseJsonStringArray('["a","b"]', 'scopes')).toEqual(['a', 'b']);
    expect(parseJsonStringArray('[]', 'scopes')).toEqual([]);
    expect(() => parseJsonStringArray('[1]', 'scopes')).toThrow(/string array/);
  });
});
