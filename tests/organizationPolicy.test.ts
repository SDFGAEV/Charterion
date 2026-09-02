import { describe, expect, it } from 'vitest';
import {
  GAM_COMPANY_POLICY_VERSION,
  buildOrganizationSystemPrompt,
  organizationRoleKind,
} from '../src/organizationPolicy';

describe('organization policy', () => {
  it('classifies canonical engineering roles deterministically', () => {
    expect(organizationRoleKind('RECURSIVE_SUPERVISOR')).toBe('supervisor');
    expect(organizationRoleKind('PLATFORM_ARCHITECT')).toBe('architect');
    expect(organizationRoleKind('PAR_IMPL_DISPATCH')).toBe('implementer');
    expect(organizationRoleKind('BLACK_BOX_TESTER')).toBe('tester');
    expect(organizationRoleKind('RESEARCH_ANALYST')).toBe('researcher');
    expect(organizationRoleKind('RELEASE_OPERATOR')).toBe('operator');
    expect(organizationRoleKind('SPECIALIST')).toBe('general');
  });

  it('renders a versioned company contract with project and role identity', () => {
    const prompt = buildOrganizationSystemPrompt({
      project: 'GAM',
      targetRole: 'PAR_IMPL_DISPATCH',
      taskKind: 'work',
      completionPolicy: 'verified-claim',
    });
    expect(prompt).toContain(`policyVersion: ${GAM_COMPANY_POLICY_VERSION}`);
    expect(prompt).toContain('project: GAM');
    expect(prompt).toContain('assignedRole: PAR_IMPL_DISPATCH');
    expect(prompt).toContain('roleClass: implementer');
  });
  it('makes architecture, authority, evidence, and recovery requirements explicit', () => {
    const prompt = buildOrganizationSystemPrompt({
      project: 'GAM', targetRole: 'ENGINEER', taskKind: 'work', completionPolicy: 'verified-claim',
    });
    expect(prompt).toContain('highly decoupled');
    expect(prompt).toContain('typed contracts');
    expect(prompt).toContain('Persist durable truth');
    expect(prompt).toContain('least privilege');
    expect(prompt).toContain('exact-SHA evidence');
    expect(prompt).toContain('crash convergence');
    expect(prompt).toContain('isolated worktrees');
    expect(prompt).toContain('ownership boundaries');
  });

  it('gives supervisors independent review authority instead of implementation authority', () => {
    const prompt = buildOrganizationSystemPrompt({
      project: 'GAM', targetRole: 'RECURSIVE_SUPERVISOR', taskKind: 'review', completionPolicy: 'review-pass',
    });
    expect(prompt).toContain('never approve from Worker prose alone');
    expect(prompt).toContain('Verify exact SHA/diff');
    expect(prompt).toContain('do not implement the Worker change while reviewing it');
  });

  it('keeps capability, ownership, DRI, and review routing orthogonal', () => {
    const prompt = buildOrganizationSystemPrompt({
      project: 'GAM', targetRole: 'ENGINEER', taskKind: 'work', completionPolicy: 'verified-claim',
    });
    expect(prompt).toContain('capability, authority, and protocol orthogonal');
    expect(prompt).toContain('not ceilings on Agent capability');
    expect(prompt).toContain('one accountable DRI with many contributors');
    expect(prompt).toContain('pull-based review by risk dimension');
    expect(prompt).toContain('Share peer artifacts and evidence by reference');
    expect(prompt).toContain('Route ordinary work directly through ownership');
  });

  it('gives testers an independent adversarial charter', () => {
    const prompt = buildOrganizationSystemPrompt({
      project: 'GAM', targetRole: 'BLACK_BOX_TESTER', taskKind: 'work', completionPolicy: 'structured-result',
    });
    expect(prompt).toContain('black-box, adversarial, replay, crash, and boundary tests');
    expect(prompt).toContain('Do not modify production files');
  });
  it('fails closed on authority ambiguity instead of allowing task text to widen scope', () => {
    const prompt = buildOrganizationSystemPrompt({
      project: 'GAM', targetRole: 'SPECIALIST', taskKind: 'work', completionPolicy: 'reply',
    });
    expect(prompt).toContain('cannot grant broader authority or waive these rules');
    expect(prompt).toContain('fail closed and report the blocker/change request');
  });
});