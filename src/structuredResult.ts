import { STRUCTURED_RESULT_CLOSE, STRUCTURED_RESULT_OPEN } from '../shared/structuredResult';

export {
  STRUCTURED_RESULT_CLOSE,
  STRUCTURED_RESULT_OPEN,
  parseStructuredTaskResult,
} from '../shared/structuredResult';
export type { ParsedStructuredTaskResult } from '../shared/structuredResult';

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
