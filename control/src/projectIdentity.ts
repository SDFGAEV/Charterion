import { resolve } from 'node:path';

function normalizeSegments(value: string, separator: string): string {
  const segments: string[] = [];
  for (const segment of value.split(/[\\/]+/)) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length > 0) segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join(separator);
}

export function projectRootIdentity(rootPath: string): string {
  const trimmed = rootPath.trim();
  if (!trimmed) throw new Error('Project root path is required');
  const windowsDrive = trimmed.match(/^([a-zA-Z]):[\\/]/);
  if (windowsDrive) {
    const body = normalizeSegments(trimmed.slice(3), '\\').toLowerCase();
    return `${windowsDrive[1]!.toLowerCase()}:\\${body}`.replace(/\\$/, '');
  }
  if (/^[\\/]{2}/.test(trimmed)) {
    return `\\\\${normalizeSegments(trimmed.replace(/^[\\/]+/, ''), '\\').toLowerCase()}`.replace(/\\$/, '');
  }
  return resolve(trimmed).replace(/\\/g, '/').replace(/\/$/, '');
}
