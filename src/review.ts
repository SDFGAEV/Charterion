import type { ReviewResult } from './contracts';

const OPEN = '<GAM_REVIEW>';
const CLOSE = '</GAM_REVIEW>';

export type ParsedReview =
  | { ok: true; result: ReviewResult }
  | { ok: false; error: string };

export function buildReviewPrompt(instruction: string): string {
  return `${instruction.trim()}

Review protocol (required): end your response with exactly one block in this form:
${OPEN}
{"decision":"pass|fail","reason":"concise reason","nextInstruction":"required remediation when fail, empty when pass"}
${CLOSE}
Do not place any text after the closing tag.`;
}

export function parseReviewResult(text: string): ParsedReview {
  const trimmed = text.trim();
  const start = trimmed.lastIndexOf(OPEN);
  const end = trimmed.lastIndexOf(CLOSE);
  if (start < 0 || end < 0 || end < start || end + CLOSE.length !== trimmed.length) {
    return { ok: false, error: 'Review reply must end with one <GAM_REVIEW> JSON block' };
  }
  if (trimmed.indexOf(OPEN) !== start || trimmed.indexOf(CLOSE) !== end) {
    return { ok: false, error: 'Review reply must contain exactly one review block' };
  }
  const raw = trimmed.slice(start + OPEN.length, end).trim();
  let value: unknown;
  try { value = JSON.parse(raw); } catch {
    return { ok: false, error: 'Review block is not valid JSON' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Review block must be a JSON object' };
  }
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  if (keys.join(',') !== 'decision,nextInstruction,reason') {
    return { ok: false, error: 'Review block must contain exactly decision, reason, and nextInstruction' };
  }
  if (object.decision !== 'pass' && object.decision !== 'fail') {
    return { ok: false, error: 'Review decision must be pass or fail' };
  }
  if (typeof object.reason !== 'string' || !object.reason.trim()) {
    return { ok: false, error: 'Review reason must be a non-empty string' };
  }
  if (typeof object.nextInstruction !== 'string') {
    return { ok: false, error: 'Review nextInstruction must be a string' };
  }
  const nextInstruction = object.nextInstruction.trim();
  if (object.decision === 'fail' && !nextInstruction) {
    return { ok: false, error: 'Failed review requires a remediation instruction' };
  }
  if (object.decision === 'pass' && nextInstruction) {
    return { ok: false, error: 'Passed review must use an empty nextInstruction' };
  }
  return {
    ok: true,
    result: { decision: object.decision, reason: object.reason.trim(), nextInstruction },
  };
}
