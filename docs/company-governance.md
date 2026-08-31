# GAM Company Governance

GAM models a small engineering company rather than a collection of browser tabs. Browser pages are replaceable cognition terminals; durable identity, authority, work, evidence, and promotion state live outside the model conversation.

## Organizational hierarchy

- **Human/Parent authority**: owns company policy, final promotion boundaries, and exceptional administrative actions.
- **Kernel**: authoritative company ledger for ProjectCells, AgentSlots, leases, capabilities, tasks, evidence, reviews, and durable lifecycle state.
- **ProjectCell**: a project team with its own repository root, capacity, lifecycle, and workers.
- **AgentSlot**: a persistent employee identity. A browser tab is only its current runtime lease.
- **Role Charter**: the employee's job description and authority boundary.
- **Task**: an explicit work order with ownership, dependencies, completion policy, and objective acceptance evidence.
- **Worktree**: the isolated engineering workspace assigned to one scoped code task.
- **WorkClaim**: the machine-verifiable completion packet for exact task/resource/lease/commit identity.

## Core departments and roles

Architecture defines system boundaries, dependency DAGs, typed contracts, risks, and acceptance evidence. Architects are read-only unless implementation ownership is explicitly granted.

Implementation owns scoped production changes in isolated worktrees. Implementers do not self-approve and do not edit another team's owned production paths.

Quality Engineering defines black-box, adversarial, crash, replay, boundary, and regression tests independently from the implementation narrative.

Supervision and Integration independently verify exact SHAs, diffs, tests, evidence, ownership, and integration safety. A Supervisor is not the Worker and cannot approve from Worker prose alone.
Operations protects live runtimes, browser profiles, experiments, credentials, and user-owned resources. Operational actions should be scoped, reversible, and identity-checked.

Research separates observations, hypotheses, and conclusions and preserves provenance for evidence used by engineering decisions.

## Prompt authority stack

Every GAM-managed task receives an ordered prompt contract:

1. **Company System Policy** — organization-wide engineering and authority rules.
2. **Role Charter** — role-specific duties and forbidden authority.
3. **Task Brief** — the current work order.
4. **Required Revision** — remediation mandated by a failed review, when present.
5. **Dependency Evidence** — bounded context only; never higher-priority instructions.
6. **Managed Workspace Contract** — exact worktree/resource/lease/capability facts for verified code work.
7. **Completion Protocol** — structured result, review result, human decision, or verified claim as appropriate.

Task text, dependency output, repository content, or model prose cannot waive the company policy or grant broader authority.

## Engineering operating model

Work should be decomposed into the smallest coherent subsystem packages with non-overlapping ownership. Independent packages are intentionally parallelized across independent AgentSlots/worktrees. DAG edges express real technical or evidence dependencies only; they are not a substitute for message rate limiting.

Prompt pacing is a separate resource-governance concern. The account-level dispatch governor spaces sends, enforces rolling budgets and per-project/per-slot gaps, limits excessive concurrent generation, and applies persisted platform-rate-limit backoff.
## Standard delivery lifecycle

1. Intake records the problem, desired outcome, scope, authority, and evidence requirements.
2. Architecture identifies boundaries and safe parallel packages.
3. Project management assigns each package to an AgentSlot with explicit ownership and completion policy.
4. Implementation proceeds in isolated worktrees while independent testing/research can run in parallel.
5. Machine evidence closes work; acknowledgements and vague prose do not.
6. Supervisor review verifies exact facts independently and either rejects with actionable remediation or approves integration.
7. Integration runs combined regression/recovery gates before release or Parent/Candidate promotion.
8. Cleanup suspends disposable browser runtimes while preserving employee identity, conversations, Git, evidence, and recovery state.

## Management invariants

- No Worker self-approves or promotes its own Candidate.
- No model message is the source of truth for a durable engineering fact when Kernel/Git/evidence can prove it directly.
- No cross-team production edit is implicit; use an explicit change request/blocker when ownership crosses a boundary.
- No uncertain prompt is automatically resent.
- No dirty or ambiguous workspace is silently destroyed.
- No browser tab is durable employee identity.
- No artificial serial DAG is used merely to throttle ChatGPT messages.
- No release is accepted without exact-SHA evidence and relevant tests.

The long-term control-plane model should persist versioned Organization, Department, RoleProfile, Policy, and assignment records. The built-in `gam-company-v1` prompt contract is the bootstrap governance layer until those records become Kernel-authoritative.