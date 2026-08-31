export interface SelfHostingRuntimeBoundary {
  readonly repoPath: string;
  readonly gamHome: string;
  readonly databasePath: string;
  readonly pipeName: string;
  readonly browserProfilePath: string;
}

type FilesystemIdentityField = Exclude<keyof SelfHostingRuntimeBoundary, 'pipeName'>;

const FILESYSTEM_IDENTITY_FIELDS: readonly FilesystemIdentityField[] = [
  'repoPath',
  'gamHome',
  'databasePath',
  'browserProfilePath',
];

function requireIdentity(value: string, field: keyof SelfHostingRuntimeBoundary): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Self-hosting ${field} must be a non-empty string.`);
  }
  return value;
}

function normalizeWindowsFilesystemIdentity(value: string, field: FilesystemIdentityField): string {
  const raw = requireIdentity(value, field).replace(/\//g, '\\').toLowerCase();
  const unc = raw.startsWith('\\\\');
  const driveRoot = raw.match(/^[a-z]:\\/);
  const rooted = unc || Boolean(driveRoot) || raw.startsWith('\\');
  let prefix = '';
  let remainder = raw;

  if (unc) {
    prefix = '\\\\';
    remainder = raw.slice(2);
  } else if (driveRoot) {
    prefix = driveRoot[0];
    remainder = raw.slice(prefix.length);
  } else if (raw.startsWith('\\')) {
    prefix = '\\';
    remainder = raw.slice(1);
  } else if (/^[a-z]:/.test(raw)) {
    prefix = raw.slice(0, 2);
    remainder = raw.slice(2);
  }

  const segments: string[] = [];
  for (const segment of remainder.split(/\\+/)) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') segments.pop();
      else if (!rooted) segments.push(segment);
      continue;
    }
    segments.push(segment);
  }
  const joined = segments.join('\\');
  if (prefix.endsWith('\\')) return joined.length > 0 ? `${prefix}${joined}` : prefix;
  return `${prefix}${joined}`;
}

function isNestedWindowsPath(parent: string, candidate: string): boolean {
  if (parent === candidate) return false;
  const prefix = parent.endsWith('\\') ? parent : `${parent}\\`;
  return candidate.startsWith(prefix);
}

export function assertSelfHostingIsolation(
  parent: SelfHostingRuntimeBoundary,
  candidate: SelfHostingRuntimeBoundary,
): void {
  for (const field of FILESYSTEM_IDENTITY_FIELDS) {
    const parentIdentity = normalizeWindowsFilesystemIdentity(parent[field], field);
    const candidateIdentity = normalizeWindowsFilesystemIdentity(candidate[field], field);
    if (parentIdentity === candidateIdentity) {
      throw new Error(`Self-hosting collision: parent and candidate ${field} resolve to the same filesystem identity.`);
    }
  }

  const parentPipe = requireIdentity(parent.pipeName, 'pipeName').toLowerCase();
  const candidatePipe = requireIdentity(candidate.pipeName, 'pipeName').toLowerCase();
  if (parentPipe === candidatePipe) {
    throw new Error('Self-hosting collision: parent and candidate pipeName must be distinct.');
  }
  const parentGamHome = normalizeWindowsFilesystemIdentity(parent.gamHome, 'gamHome');
  const candidateGamHome = normalizeWindowsFilesystemIdentity(candidate.gamHome, 'gamHome');
  if (isNestedWindowsPath(parentGamHome, candidateGamHome)) {
    throw new Error('Self-hosting collision: candidate gamHome must not be nested inside parent gamHome.');
  }
}
