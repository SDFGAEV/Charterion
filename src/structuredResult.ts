import type { StructuredTaskResult } from './contracts';

export const STRUCTURED_RESULT_OPEN = '<GAM_RESULT>';
export const STRUCTURED_RESULT_CLOSE = '</GAM_RESULT>';

const PLACEHOLDER = /^(?:read|ok(?:ay)?|ack(?:nowledged)?|done|noted|complete(?:d)?|finished)[.!]?$/i;
const MAX_SUMMARY_CHARS = 2000;
const MAX_EVIDENCE_ITEMS = 16;
const MAX_EVIDENCE_CHARS = 2000;

export type ParsedStructuredTaskResult =
  | { ok: true; result: StructuredTaskResult }
  | { ok: false; error: string };

export interface StructuredResultRetryContext {
  attemptId: string;
  error: string;
}

export function buildStructuredResultPrompt(instruction: string, retry?: StructuredResultRetryContext): string {
  const retryBlock = retry
    ? `\n\nProtocol retry: prior attempt ${retry.attemptId} was rejected because: ${retry.error}\nThis dispatch is an explicit retry of that protocol-invalid reply. Return a fresh compliant terminal block.`
    : '';
  return `${instruction.trim()}${retryBlock}

Structured result protocol (required): end your response with exactly one block in this form:
${STRUCTURED_RESULT_OPEN}
{"status":"completed","summary":"substantive outcome","evidence":["concrete inspected fact, artifact, or finding"]}
${STRUCTURED_RESULT_CLOSE}
The JSON object must contain exactly status, summary, and evidence. status must be "completed". summary must be substantive rather than a placeholder such as Read/OK/acknowledged. evidence must contain at least one concrete non-placeholder string. Do not place any text after the closing tag.`;
}

export function parseStructuredTaskResult(text: string): ParsedStructuredTaskResult {
  const trimmed = text.trim();
  const start = trimmed.lastIndexOf(STRUCTURED_RESULT_OPEN);
  const end = trimmed.lastIndexOf(STRUCTURED_RESULT_CLOSE);
  if (start < 0 || end < 0 || end < start || end + STRUCTURED_RESULT_CLOSE.length !== trimmed.length) {
    return { ok: false, error: 'Structured-result reply must end with one <GAM_RESULT> JSON block' };
  }
  if (trimmed.indexOf(STRUCTURED_RESULT_OPEN) !== start || trimmed.indexOf(STRUCTURED_RESULT_CLOSE) !== end) {
    return { ok: false, error: 'Structured-result reply must contain exactly one result block' };
  }

  const raw = trimmed.slice(start + STRUCTURED_RESULT_OPEN.length, end).trim();
  let value: unknown;
  try { value = JSON.parse(raw); } catch {
    return { ok: false, error: 'Structured-result block is not valid JSON' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Structured-result block must be a JSON object' };
  }

  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  if (keys.join(',') !== 'evidence,status,summary') {
    return { ok: false, error: 'Structured-result block must contain exactly status, summary, and evidence' };
  }
  if (object.status !== 'completed') {
    return { ok: false, error: 'Structured-result status must be completed' };
  }
  if (typeof object.summary !== 'string') {
    return { ok: false, error: 'Structured-result summary must be a string' };
  }
  const summary = object.summary.trim();
  if (!summary || summary.length > MAX_SUMMARY_CHARS || PLACEHOLDER.test(summary)) {
    return { ok: false, error: 'Structured-result summary must be substantive and non-placeholder' };
  }
  if (!Array.isArray(object.evidence) || object.evidence.length < 1 || object.evidence.length > MAX_EVIDENCE_ITEMS) {
    return { ok: false, error: `Structured-result evidence must contain 1-${MAX_EVIDENCE_ITEMS} strings` };
  }
  const evidence: string[] = [];
  for (const item of object.evidence) {
    if (typeof item !== 'string') return { ok: false, error: 'Structured-result evidence items must be strings' };
    const normalized = item.trim();
    if (!normalized || normalized.length > MAX_EVIDENCE_CHARS || PLACEHOLDER.test(normalized)) {
      return { ok: false, error: 'Structured-result evidence items must be concrete non-placeholder strings' };
    }
    evidence.push(normalized);
  }
  return { ok: true, result: { status: 'completed', summary, evidence } };
}
