import { describe, expect, it } from 'vitest';
import { parseStructuredTaskResult, STRUCTURED_RESULT_CLOSE, STRUCTURED_RESULT_OPEN } from '../src/structuredResult';
import { defaultCompletionPolicy } from '../src/taskPolicy';

const valid = `${STRUCTURED_RESULT_OPEN}{"status":"completed","summary":"Audited the completion path and found the reply-only gate.","evidence":["src/taskGraph.ts completed any non-review reply-observed attempt"]}${STRUCTURED_RESULT_CLOSE}`;

describe('structured-result protocol', () => {
  it('defaults ordinary work to structured-result completion', () => {
    expect(defaultCompletionPolicy('work')).toBe('structured-result');
  });

  it('parses a valid strict terminal result', () => {
    expect(parseStructuredTaskResult(`Audit details.\n${valid}`)).toEqual({
      ok: true,
      result: {
        status: 'completed',
        summary: 'Audited the completion path and found the reply-only gate.',
        evidence: ['src/taskGraph.ts completed any non-review reply-observed attempt'],
      },
    });
  });

  it.each(['Read', 'OK', 'acknowledged'])('rejects placeholder reply %s', (reply) => {
    expect(parseStructuredTaskResult(reply)).toMatchObject({ ok: false });
  });

  it('rejects malformed JSON', () => {
    expect(parseStructuredTaskResult(`${STRUCTURED_RESULT_OPEN}{bad}${STRUCTURED_RESULT_CLOSE}`))
      .toEqual({ ok: false, error: 'Structured-result block is not valid JSON' });
  });
  it('rejects duplicate result markers', () => {
    expect(parseStructuredTaskResult(`${valid}\n${valid}`)).toEqual({
      ok: false,
      error: 'Structured-result reply must contain exactly one result block',
    });
  });

  it('rejects trailing text after the terminal marker', () => {
    expect(parseStructuredTaskResult(`${valid}\ntrailing`)).toEqual({
      ok: false,
      error: 'Structured-result reply must end with one <GAM_RESULT> JSON block',
    });
  });

  it('enforces exact JSON keys and substantive evidence', () => {
    const extra = `${STRUCTURED_RESULT_OPEN}{"status":"completed","summary":"Audited files","evidence":["src/taskGraph.ts"],"extra":true}${STRUCTURED_RESULT_CLOSE}`;
    expect(parseStructuredTaskResult(extra)).toMatchObject({ ok: false });
    const placeholderEvidence = `${STRUCTURED_RESULT_OPEN}{"status":"completed","summary":"Audited files","evidence":["OK"]}${STRUCTURED_RESULT_CLOSE}`;
    expect(parseStructuredTaskResult(placeholderEvidence)).toMatchObject({ ok: false });
  });
});
