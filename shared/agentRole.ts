export type AgentRoleClass =
  | 'supervisor'
  | 'architect'
  | 'implementer'
  | 'tester'
  | 'integrator'
  | 'researcher'
  | 'operator'
  | 'general';

function roleTokens(role: string): string[] {
  return role.trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function agentRoleClass(role: string): AgentRoleClass {
  const normalized = role.trim().toLowerCase();
  const tokens = roleTokens(role);
  if (normalized.includes('supervisor') || normalized.includes('reviewer')) return 'supervisor';
  if (normalized.includes('architect')) return 'architect';
  if (normalized.includes('tester') || tokens.includes('qa')) return 'tester';
  if (normalized.includes('integrator')) return 'integrator';
  if (tokens.includes('impl') || tokens.includes('worker') || normalized.includes('implementer') ||
      normalized.includes('developer') || normalized.includes('engineer')) return 'implementer';
  if (normalized.includes('research')) return 'researcher';
  if (normalized.includes('operator') || tokens.includes('ops')) return 'operator';
  return 'general';
}
export function normalizedRole(role: string): string {
  return role.trim().replace(/\s+/g, ' ').toLowerCase();
}

const ROLE_NOISE = new Set([
  'gam', 'charterion', 'recursive', 'parallel', 'par', 'wave', 'selfhost', 'selfhosting',
  'impl', 'implementer', 'worker', 'developer', 'engineer', 'supervisor', 'reviewer',
  'architect', 'tester', 'qa', 'integrator', 'researcher', 'research', 'operator', 'ops',
  'agent', 'role', 'e2e', 'followup',
]);

export function roleSpecialties(role: string): string[] {
  return roleTokens(role).filter((token) =>
    !ROLE_NOISE.has(token) &&
    !/^\d+$/.test(token) &&
    !/^w\d+$/.test(token) &&
    !/^v\d+$/.test(token) &&
    !/^role\d*$/.test(token),
  );
}

export function roleAffinityKey(role: string): string {
  const roleClass = agentRoleClass(role);
  return roleClass === 'general' ? `role:${normalizedRole(role)}` : `class:${roleClass}`;
}
export function roleMatchScore(requestedRole: string, agentRole: string): number | undefined {
  if (normalizedRole(requestedRole) === normalizedRole(agentRole)) return 1000;
  const requestedClass = agentRoleClass(requestedRole);
  if (requestedClass === 'general' || requestedClass !== agentRoleClass(agentRole)) return undefined;

  const requestedSpecialties = roleSpecialties(requestedRole);
  const agentSpecialties = roleSpecialties(agentRole);
  if (requestedSpecialties.length === 0 || agentSpecialties.length === 0) return 600;
  const overlap = requestedSpecialties.filter((token) => agentSpecialties.includes(token)).length;
  return overlap > 0 ? 800 + overlap : 500;
}

export function rolesAreCompatible(requestedRole: string, agentRole: string): boolean {
  return roleMatchScore(requestedRole, agentRole) !== undefined;
}

const ROLE_LABELS: Record<Exclude<AgentRoleClass, 'general'>, string> = {
  supervisor: 'SUPERVISOR', architect: 'ARCHITECT', implementer: 'IMPLEMENTER', tester: 'TESTER',
  integrator: 'INTEGRATOR', researcher: 'RESEARCHER', operator: 'OPERATOR',
};

export function stableRoleLabel(requestedRole: string, occupiedRoles: readonly string[]): string {
  const roleClass = agentRoleClass(requestedRole);
  const base = roleClass === 'general' ? requestedRole.trim() : ROLE_LABELS[roleClass];
  const occupied = new Set(occupiedRoles.map(normalizedRole));
  if (!occupied.has(normalizedRole(base))) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base}_${index}`;
    if (!occupied.has(normalizedRole(candidate))) return candidate;
  }
  throw new Error(`Unable to allocate a stable role identity for ${base}`);
}
