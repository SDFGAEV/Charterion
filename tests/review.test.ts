import { describe, expect, it } from 'vitest';
import { buildReviewPrompt, parseReviewResult } from '../src/review';

describe('review protocol', () => {
  it('accepts a strict final pass block', () => {
    const parsed = parseReviewResult('Checked.\n<GAM_REVIEW>\n{"decision":"pass","reason":"all criteria met","nextInstruction":""}\n</GAM_REVIEW>');
    expect(parsed).toEqual({ ok: true, result: { decision: 'pass', reason: 'all criteria met', nextInstruction: '' } });
  });

  it('requires remediation for fail', () => {
    const parsed = parseReviewResult('<GAM_REVIEW>\n{"decision":"fail","reason":"tests fail","nextInstruction":"fix test A"}\n</GAM_REVIEW>');
    expect(parsed).toEqual({ ok: true, result: { decision: 'fail', reason: 'tests fail', nextInstruction: 'fix test A' } });
  });

  it('rejects natural-language guesses, trailing text, duplicate blocks and schema drift', () => {
    expect(parseReviewResult('Looks good, PASS').ok).toBe(false);
    expect(parseReviewResult('<GAM_REVIEW>{"decision":"pass","reason":"ok","nextInstruction":""}</GAM_REVIEW> trailing').ok).toBe(false);
    expect(parseReviewResult('<GAM_REVIEW>{"decision":"pass","reason":"ok","nextInstruction":""}</GAM_REVIEW>\n<GAM_REVIEW>{"decision":"pass","reason":"ok","nextInstruction":""}</GAM_REVIEW>').ok).toBe(false);
    expect(parseReviewResult('<GAM_REVIEW>{"decision":"pass","reason":"ok","nextInstruction":"","extra":true}</GAM_REVIEW>').ok).toBe(false);
  });

  it('builds a prompt that requires the machine-readable final block', () => {
    const prompt = buildReviewPrompt('Review the implementation.');
    expect(prompt).toContain('Review the implementation.');
    expect(prompt).toContain('<GAM_REVIEW>');
    expect(prompt).toContain('Do not place any text after the closing tag.');
  });
});
