# Charterion Next-Generation Organization Architecture

Status: Design authority draft
Baseline: `48687bee12b04e79cd367f753661dce5fc9324dc`
Scope: next-generation Charterion organization, engineering workflow, review, and promotion architecture

## 1. Purpose

Charterion shall evolve from a task-centric multi-agent orchestrator into an autonomous software-organization runtime for persistent ChatGPT Web engineering agents.

The system must treat GPT agents like senior engineers rather than function calls. It should provide durable identity, shared engineering infrastructure, coordination, evidence, authority, concurrency control, and promotion safety while leaving reasoning, investigation, decomposition, implementation strategy, and most collaboration decisions to the agents themselves.

The design is optimized for four unusual strengths of Charterion:

1. ChatGPT Web conversations already provide powerful long-lived cognitive context.
2. Remote tooling lets agents inspect and operate on the same real filesystem and repositories.
3. Git worktrees and pull-request semantics provide natural isolation and collaboration boundaries.
4. Charterion can persist authoritative state independently of browser conversations.

This document is the architectural authority for the next-generation redesign. Existing role-class matching and wave-specific role conventions are transitional mechanisms, not the target model.

## 2. Constitutional Principles

1. **Agents are autonomous engineers, not function calls.**
2. **Conversation continuity is cognitive capital.** Preserve useful ChatGPT conversations across tasks, missions, tab closes, and Charterion code generations.
3. **Agent identity is not a role string, task, browser tab, conversation, project wave, or commit.**
4. **ChatGPT manages cognition; shared storage represents the common engineering world; the Charterion Kernel owns authoritative facts.**
5. **Ownership creates responsibility, not intellectual walls.** Reading, reasoning, investigation, and proposals are broadly open.
6. **Constrain irreversible authority, not intelligence.** Hard controls belong around conflicting writes, protected effects, evidence, integration, and promotion.
7. **One authoritative owner per active outcome.** Findings and Missions must not silently fork into duplicated competing work.
8. **Collaboration is sparse and purposeful.** References to shared artifacts are preferred over copying context between conversations.
9. **Changes are isolated.** Concurrent writers work through separate Git worktrees and branches.
10. **PR semantics are a first-class organizational boundary.** A formal Change contains diff, authorship, reviews, checks, evidence, and decision history.
11. **Reviews are pull-based by default.** Agents should not all be interrupted for every change.
12. **Evidence outranks prose.** Claims of completion never substitute for direct repository, test, runtime, or exact-SHA evidence.
13. **High-authority transitions require independent judgment.** Authors cannot self-approve protected changes or self-promote a Candidate.
14. **Many may advise; several may verify; one is accountable for the final release decision; only the Kernel may promote.**
15. **The organization itself is evolvable.** Departments, domains, policies, and interaction structures may change through evidence-gated Organization Change Proposals.

## 3. Layered Model

The target hierarchy is:

```text
Organization
  -> Department
    -> Domain / Maintainer Group
      -> Persistent Agent
        -> Mission
          -> Task / Finding / Change
            -> Worktree / Branch / PR
              -> Review / Evidence
                -> Candidate
                  -> Promotion
```

These layers are deliberately decoupled. A Task must not create an Agent identity. A Mission must not imply a new Project. A new Charterion Candidate must not recreate the engineering organization. A browser tab must not define a conversation, and a conversation must not define authoritative state.

The long-lived layers are Organization, Department, Domain, Agent identity, ownership, and conversation lineage. Missions are medium-lived. Tasks, Findings, Changes, worktrees, review claims, and browser tabs are shorter-lived. Evidence and promotion records are permanent.

### 3.1 Three state planes

`ChatGPT Conversation = Cognitive State`

`Shared Disk / Git / Docs / Logs = Shared Engineering World`

`Charterion Kernel = Authoritative State`

The cognitive plane stores the agent's accumulated understanding, design history, nuanced discussion, and local reasoning continuity. Charterion should exploit the native ChatGPT Web conversation instead of attempting to replace it with a weaker home-grown semantic memory system.

The shared-world plane stores inspectable reality: source code, branches, worktrees, commits, tests, logs, architecture documents, artifacts, runtime traces, and evidence. Because Remote agents can inspect the same disk, inter-agent communication should primarily transmit references to this world rather than duplicate it into prompts.

The authority plane stores facts that must be deterministic and auditable: identity, ownership, assignments, leases, capabilities, risk policy, exact SHAs, review decisions, evidence digests, protected resources, and promotion state.

No plane may impersonate another. A ChatGPT statement cannot change authoritative state. A database summary cannot claim to contain the full cognitive value of a conversation. A filesystem file is not authoritative merely because it exists.

## 4. Organization and Departments

The Organization is a persistent entity spanning Charterion code generations. Parent N, Candidate N+1, and Parent N+1 are versions of the product, not new companies.

A Department is a durable responsibility boundary. Departments should be stable enough for agents and conversations to accumulate expertise, but their exact structure is organization policy rather than a platform hard-coded enum.

A recommended Charterion self-hosting organization is:

- Architecture & Systems
- Control Plane
- Browser & Interaction
- Runtime & Reliability
- Verification & Quality
- Security & Governance
- Developer Platform & Release

### 4.1 Department responsibilities

Architecture & Systems owns architecture coherence, system boundaries, contracts, RFC/ADR process, dependency direction, and organization design.

Control Plane owns durable identity, missions/tasks, capabilities, leases, persistence, control protocols, evidence authority integration, and promotion-control contracts.

Browser & Interaction owns ChatGPT Web adapters, conversation lifecycle observation, prompt/reply effects, browser-page identity, tab lifecycle semantics, and browser/Remote-facing interaction behavior.

Runtime & Reliability owns native host/runtime integration, fleet lifecycle, concurrency, recovery, crash convergence, observability, runtime backpressure, and resource coordination.

Verification & Quality owns test systems, adversarial testing, evidence collection, regression gates, architecture gates, and black-box validation.

Security & Governance owns protected surfaces, authority auditing, isolation policy, self-approval prevention, security review, and organization-policy integrity.

Developer Platform & Release owns Git/worktree infrastructure, build systems, integration automation, packaging, release tooling, and developer-facing platform ergonomics.

Departments are defaults, not walls. Any Agent may inspect any department, discover issues, run safe tests, propose changes, and create Findings. Cross-domain integration is governed by ownership and review, not by suppressing exploration.

### 4.2 Domain ownership

A Domain is the smallest durable ownership unit. It may map to paths, exported contracts, resources, runtime effects, or a coherent subsystem rather than merely directories.

Each production Domain SHOULD have a Primary Maintainer and SHOULD have at least one Secondary Maintainer or explicitly declared recovery path to prevent bus-factor-one ownership.

A Domain declaration should be able to express:

```text
Domain
  id
  departmentId
  primaryMaintainers[]
  secondaryMaintainers[]
  ownedPaths[]
  ownedContracts[]
  ownedResources[]
  protectedSurfaces[]
  publicInterfaces[]
  upstreamDependencies[]
  downstreamConsumers[]
  defaultReviewPolicy
  riskClass
```

The organization may later split, merge, or transfer Domains through an Organization Change Proposal. These changes must not silently rewrite history: old ownership remains attached to historical Changes and Evidence.

## 5. Agent Identity and Conversation Continuity

An Agent is a durable organizational member. Its identity must survive tasks, missions, browser tabs, conversation rollover, worktree deletion, project iterations, Candidate promotion, and Charterion upgrades.

An Agent should contain stable identity plus evolving organizational attributes, not task-derived naming conventions.

Suggested Agent model:

```text
Agent
  agentId
  displayName
  departmentId
  primaryDomains[]
  secondaryDomains[]
  capabilityProfile
  authorityProfile
  missionMemberships[]
  currentLoad
  lifecycleState
  conversationLineage
  performanceHistory
```

Wave/date/task strings such as `W2_PROMOTION_IMPL_20260831` are not valid long-term identities. They belong in Mission or Task metadata.

### 5.1 Conversation is a durable cognitive asset

A persistent Agent should preferentially continue using the same canonical ChatGPT Web conversation for related work. Closing a tab suspends an execution surface; it must not retire the Agent or abandon its canonical conversation.

`tab = disposable execution surface`

`conversation = durable cognitive context`

`agent = durable organizational identity`

Conversation rollover should be conservative. A rollover creates a new conversation generation under the same Agent identity and lineage; it does not create a replacement employee.

A rollover should occur only for explicit hard/operational reasons such as conversation-limit behavior, unrecoverable page/session failure, clear domain discontinuity, or evidence that continuation is materially degraded. Charterion should not aggressively second-guess OpenAI's own context management.

Rollover handoff should contain authoritative references and the minimum critical state needed to resume work; it should not attempt to recreate every nuance of the previous conversation in a synthetic summary.

### 5.2 Conversation affinity in assignment

When compatible Agents exist, continuity receives strong weight. A scheduler must account for migration cost: a slightly higher raw capability score is insufficient to displace a current Mission/Domain owner with valuable active context.

Assignment policy should prefer, in order:

1. current Mission DRI when suitable;
2. existing Domain owner with relevant conversation continuity;
3. active compatible persistent Agent;
4. suspended compatible Agent with a durable canonical conversation;
5. elastic specialist already known to the organization;
6. creation of a new persistent Agent.

Assignment hysteresis must prevent needless organizational thrashing.

## 6. Authority Model

Responsibility and authority are separate. Domain ownership answers who is accountable for health; authority answers what irreversible effects an Agent may perform without additional approval.

Charterion should model at least these distinct capabilities:

```text
ObserveAuthority
ProposeAuthority
PrototypeAuthority
WriteAuthority
ReviewAuthority
MergeAuthority
PromotionAuthority
ResourceAuthority
```

Defaults should be intentionally asymmetric:

- Observe: broad by default.
- Propose: broad by default.
- Prototype in an isolated worktree: broad unless protected-resource policy forbids it.
- Write to shared/protected state: controlled by leases and domain policy.
- Review: capability/independence constrained, but broadly available.
- Merge: restricted to maintainers or integration authorities.
- Promotion: restricted to the Promotion Authority after an accountable release decision.
- Protected resources: capability-gated and explicit.

A cross-domain Agent may implement a cross-domain Change in its isolated worktree. What it may not do is silently make that Change authoritative without the required domain consent and evidence.

Principle: **cross-domain editing may be allowed; cross-domain integration requires the affected ownership dimensions to be satisfied.**

## 7. Mission, DRI, Task, and Finding

A Mission is the primary unit of meaningful engineering ownership. Humans, Architects, Maintainers, or authorized Agents may create Missions from broader goals. A Mission may last across many tasks, PRs, failures, browser sessions, and code generations.

Every active Mission has exactly one DRI (Directly Responsible Individual) at a time. The DRI owns convergence of the outcome, not every implementation action.

The DRI may autonomously:

- investigate the shared world;
- decompose work into Tasks;
- create Findings;
- request collaboration;
- ask another Department to own a subproblem;
- request extra capacity or specialist Agents;
- create Changes;
- request reviews;
- transfer or delegate sub-work;
- declare blockers and propose organization changes.

Task is a short-lived executable unit. It should express required capabilities, dependencies, evidence policy, risk hints, and related Mission/Domain; it should not define a new Agent identity.

### 7.1 Finding Registry

All independently discovered problems should enter a durable Finding Registry before they become duplicated repair efforts.

A Finding should contain enough stable identity to deduplicate discoveries without pretending semantic equality is trivial:

```text
Finding
  findingId
  fingerprint
  title
  domainId
  locations[]
  symptom
  evidenceRefs[]
  discoveredBy[]
  owningDepartmentId
  owningAgentId?
  relatedMissionId?
  status
```

When a second Agent discovers the same underlying issue, Charterion should attach new evidence or observations to the existing Finding rather than create a competing repair task whenever confidence is sufficient.

Finding ownership must be singular at the authoritative level even if many Agents contribute evidence. Uncertain deduplication should remain explicit and reviewable rather than silently merging unrelated bugs.

Department inboxes expose unowned Findings, review requests, change requests, incidents, questions, and Missions to relevant Agents without interrupting the whole organization.

## 8. Change, Git Worktree, Branch, and Pull Request

A Change is the canonical unit of proposed code/configuration modification. Each concurrent write effort receives an isolated Git worktree and branch. Worktree lifetime follows the Change, not the Agent conversation.

A Change should model:

```text
Change
  changeId
  missionId
  findingIds[]
  authorAgentId
  worktreeId
  branch
  baseSha
  headSha
  touchedDomains[]
  touchedProtectedSurfaces[]
  riskAssessment
  reviewPolicy
  evidenceRefs[]
  status
```

The Agent may make multiple commits inside a Change. Commits are immutable evidence points; the Change head is the reviewed object.

The worktree is disposable after the Change has been integrated, rejected, or archived and its evidence is preserved. The Agent and its conversation remain durable.

### 8.1 Internal PR as a first-class object

Charterion must implement PR semantics independently of whether GitHub is used as the current remote collaboration backend. GitHub PRs are valuable and should be used heavily where appropriate, but internal rapid self-iteration must not depend on public-release ceremony.

The canonical PR/Change Review object should contain at least:

```text
PullRequest
  prId
  changeId
  authorAgentId
  baseSha
  headSha
  touchedDomains[]
  requiredReviewSlots[]
  optionalReviewTags[]
  machineChecks[]
  reviewClaims[]
  reviewDecisions[]
  unresolvedThreads[]
  mergePolicy
  mergeEvidence
```

External GitHub PR integration should mirror or bind to this object rather than become the sole source of organizational truth. A future private/internal engineering repository may host rapid agent PR traffic while the public Charterion repository receives curated release-quality changes.

### 8.2 Concurrency and overlap

Charterion should inspect active Changes for overlapping touched paths, contracts, resources, or Domains. Overlap is not automatically forbidden, but it should produce an explicit coordination signal before merge-time conflict.

Agents may choose to sequence, rebase, combine, transfer ownership, or continue independently when the overlap is semantically safe. The Kernel should prevent conflicting authoritative writes, not preemptively forbid all parallel thought.

## 9. Machine Gates Before Semantic Review

Machines should eliminate mechanical review work before scarce Agent attention is consumed. Depending on the repository, machine gates may include:

- formatting/linting;
- type checking;
- unit/integration/fault tests;
- architecture rules;
- ownership/risk classification;
- forbidden/protected path checks;
- exact-SHA verification;
- dependency and generated-artifact checks;
- diff-overlap warnings;
- build/package validation.

A Change that fails mandatory machine gates should normally not consume semantic-review capacity unless the reviewer is explicitly investigating the failure itself.

GPT reviewers should concentrate on questions machines cannot reliably settle: design correctness, hidden behavioral gaps, boundary quality, recovery semantics, maintainability, unnecessary complexity, unsafe assumptions, and whether evidence actually supports the claimed outcome.

## 10. Pull-Based Review Market

Review must be pull-based by default. Creating a PR does not broadcast a prompt to every Agent conversation.

Review demand is persisted in Department/Domain queues. Agents inspect relevant queues when idle, when their current Mission has no ready work, or when they explicitly ask for useful work.

The default review modes are `welcome`, `required`, and `binding`.

`review:welcome` means review is optional. It is suitable for low-risk documentation, tests, refactors, or exploratory improvements where policy permits machine-gated integration without semantic approval.

`review:required` means at least one qualified independent semantic review is necessary, but no specific Agent is interrupted in advance. A compatible Agent claims the review from the pool.

`review:binding` means specific review dimensions are mandatory because the Change touches protected or high-risk behavior. The requirement targets expertise/independence dimensions, not necessarily named individuals.

### 10.1 Review Slots

Requirements should be expressed as review dimensions:

```text
ReviewSlot
  slotId
  dimension
  requiredCapabilities[]
  requiredDomains[]
  independencePolicy
  claimState
  reviewerAgentId?
  decision?
```

Examples include `peer`, `domain-maintainer`, `test`, `architecture`, `security`, `runtime-effects`, and `release`.

A normal PR may require only one peer slot. A high-risk PR may require domain-maintainer + test + security. Once required slots are satisfied, Charterion stops actively recruiting more reviewers; additional review is voluntary.

### 10.2 Review budget and aging

Review is a scarce cognitive resource. Policy should define a review budget proportional to risk. Low-risk Changes should not accumulate five redundant Agent reviews simply because reviewers are available.

Unclaimed required reviews increase in priority with waiting time and downstream blocking impact. Aging may trigger a targeted soft nudge to the best-qualified available Agent. It must not trigger organization-wide broadcast by default.

The review market should rank work using factors such as domain relevance, capability match, independence, current load, waiting time, blocked dependents, and prior context. Agents retain freedom to accept, decline, or recommend a better reviewer when policy allows.

## 11. Communication and Department Inboxes

Agent communication should be a durable coordination bus, not a substitute for the shared filesystem.

Messages should be typed and reference concrete artifacts wherever possible:

```text
AgentMessage
  fromAgentId
  recipientAgentId? / departmentId? / topic?
  type
  missionId?
  findingId?
  changeId?
  priority
  refs[]
  ttl?
```

Useful types include `question`, `answer`, `blocker`, `finding`, `change-request`, `review-request`, `review-result`, `handoff`, `capacity-request`, `evidence`, and `announcement`.

Because Remote agents share the filesystem, messages SHOULD prefer references such as commit SHA, file/symbol, test name, log path, evidence ID, PR ID, or worktree path instead of reproducing large source/context payloads.

Department inboxes are pull-oriented work surfaces. An inbox may contain Findings, unclaimed Missions, required reviews, cross-domain Change Requests, incidents, questions, and capacity requests. Supervisor intervention is not required for ordinary queue operation.

## 12. Remote Plugin and Shared-World Model

Remote access is a first-class architectural advantage, not merely another tool adapter.

All authorized Agents should be able to inspect the same shared engineering world while writing through isolated worktrees and resource leases. This permits independent verification without expensive context transfer.

Shared visibility does not imply shared mutation authority. Charterion must distinguish filesystem visibility from protected write/effect authority.

The shared world should provide discoverable canonical locations for:

- repositories and worktrees;
- architecture and organization manifests;
- evidence and test outputs;
- logs and runtime traces;
- durable handoffs and incident records;
- generated artifacts;
- local toolchains and reproducible commands.

Agents should be able to inspect peer worktrees and exact commits for review, but must not mutate a peer Change unless an explicit collaboration/ownership transition is recorded.

## 13. Risk-Driven Governance

Workflow depth is determined by objective risk plus Agent judgment, not by a universal hierarchy.

Objective risk signals may include protected paths/contracts, authority code, database/schema changes, browser physical effects, production/protected resources, cross-domain surface, large dependency impact, test removals, organization-policy changes, and promotion/self-hosting changes.

Agents may add semantic risk observations, but they may not downgrade objective protected-surface requirements by assertion.

Illustrative governance:

```text
low risk     -> machine gates -> optional/one peer review -> integrate
normal       -> machine gates -> one qualified independent review -> maintainer merge
cross-domain -> machine gates -> affected domain review slots -> integrate
high risk    -> domain + independent test/security/architecture slots -> accountable approval
promotion    -> candidate evidence set -> release decision -> Kernel promotion
```

## 14. Candidate and Final Promotion Governance

Merging ordinary PRs and promoting a new Charterion generation are different authority levels.

Many Changes may merge into an integration line before a Candidate is declared. A Candidate is an exact immutable SHA proposed to replace the current Parent generation.

The final model is:

**distributed evidence + required independent review dimensions + one accountable release decision + deterministic Kernel promotion.**

The accountable final decider may be called the Release Governor or Next-Generation Maintainer. This is a responsibility, not a permanent supreme rank. The role may rotate among qualified independent maintainers.

The Release Governor cannot waive failed evidence, rewrite the candidate SHA, remove required review dimensions, or bypass protected policy. It may approve, reject, or request changes among policy-eligible Candidates.

A `PromotionCertificate` is the only valid input to Parent-side promotion:

```text
PromotionCertificate
  certificateId
  expectedParentSha
  candidateSha
  candidateGeneration
  includedChanges[]
  includedMissions[]
  requiredChecks[]
  evidenceRefs[]
  reviewDecisions[]
  accountableDeciderAgentId
  finalDecision
  finalDecisionReason
  integrityDigest
```

The Promotion Authority verifies exact SHA, expected Parent CAS base, evidence freshness/integrity, required review dimensions, independence constraints, outstanding rejects/blockers, and final accountable approval before executing promotion.

Candidate code can never declare itself Parent. The promotion authority must remain outside the Candidate's self-asserted authority boundary.

Consensus/quorum may be used for evidence coverage or future replicated Kernel agreement, but consensus solves agreement, not engineering judgment. Majority voting does not replace the accountable final release decision.

## 15. Kernel Boundary: What Must Be Hard vs Soft

The Kernel should be small, deterministic, and difficult for Agents to bypass.

Hard Kernel responsibilities:

- durable identity and state transitions;
- exact-SHA and Git CAS rules;
- workspace/worktree leases and conflicting-write fencing;
- capability/resource authority;
- protected-resource policy;
- uncertain external-effect fencing;
- evidence integrity and review independence;
- merge/promotion authority;
- crash/replay convergence of authoritative state.

The Kernel SHOULD NOT decide:

- which files an Agent should read first;
- how an Agent reasons about a bug;
- how many implementation subtasks a Mission needs;
- whether to write a test before or after inspection;
- ordinary technical design choices;
- which safe exploratory commands to run;
- whether an Agent should ask a peer for conceptual advice.

Principle: **Agents decide how to work. Charterion decides what becomes authoritative.**

## 16. Autonomous Capacity and Team Formation

Persistent Agents may autonomously request collaborators, specialist capacity, additional same-domain Agents, or temporary Mission teams.

The Kernel evaluates resource feasibility, browser capacity, isolation, rate limits, and authority constraints; it should not micromanage whether the engineering judgment to ask for help was aesthetically optimal.

Temporary teams are Mission relationships, not new identities:

```text
Mission Team
  DRI: CONTROL_ENGINEER_A
  participants:
    BROWSER_ENGINEER_A
    TEST_ENGINEER_A
    ARCHITECT_A
```

When the Mission ends, team membership dissolves. The Agents, their domain identities, and their useful conversations remain.

Agents may decline work, leave optional teams, recommend another Agent, or state that a review dimension is unnecessary when policy allows. The system should avoid multi-agent theater in which many powerful agents redundantly surround trivial work.

Elastic specialists may be created on demand. Recurrent useful specialists can become durable core Agents; inactive Agents should normally be suspended rather than destroyed so that useful conversation continuity can be recovered later.

## 17. Organization Evolution

The organization is data/configuration governed by typed contracts, not a collection of role-name conditionals embedded throughout source code.

The platform should provide generic organizational primitives such as Organization, Department, Domain, Agent, Mission, Finding, Change, ReviewSlot, Evidence, Candidate, and Authority. Names such as CONTROL_ENGINEER or BROWSER_ENGINEER belong in an `OrganizationManifest`, not in platform enums.

An Organization Change Proposal may alter:

- departments or domains;
- ownership/maintainer assignments;
- review policies;
- protected surfaces;
- interaction defaults;
- capacity rules;
- Mission templates;
- organizational responsibilities.

Organization changes themselves are reviewed Changes with explicit risk and evidence. They may be trialed before promotion. The previous organization model remains historically queryable.

Organization evolution should eventually be informed by metrics such as ownership conflicts, duplicate Findings, review latency, rework rate, cross-domain communication frequency, Agent load, conversation reuse, regression rate, blocked Mission age, and promotion failure.

Charterion therefore supports two recursive loops:

`code self-improvement -> candidate code -> evidence -> promotion`

`organization self-improvement -> organization proposal -> trial/evidence -> policy promotion`

The organization may improve itself without granting the Candidate authority to approve itself.

## 18. Suggested Typed Aggregate Boundaries

To keep the system decoupled and evolvable, the next implementation should avoid one giant `ControlPlane` aggregate owning every concern. Recommended bounded contexts are:

```text
OrganizationRegistry
  Organization / Department / Domain / Maintainer / OrganizationPolicy

AgentRegistry
  AgentIdentity / Capability / AuthorityProfile / Lifecycle

ConversationRegistry
  ConversationLineage / Generation / Binding / Rollover

MissionRegistry
  Mission / DRI / Membership / Dependency / Status

FindingRegistry
  Finding / Fingerprint / Ownership / EvidenceAttachment

ChangeRegistry
  Change / WorktreeBinding / Branch / DiffScope / Risk

ReviewRegistry
  ReviewPool / ReviewSlot / Claim / Decision / Thread

EvidenceRegistry
  Evidence / CheckRun / ExactShaAttestation / Integrity

PromotionRegistry
  Candidate / PromotionCertificate / FinalDecision / PromotionRecord
```

Each registry exposes typed commands/queries and emits durable domain events. Cross-registry coordination should use IDs and contracts rather than direct mutation of another aggregate's internals.

Examples of domain events:

- `AgentRegistered`
- `AgentSuspended`
- `ConversationBound`
- `ConversationRolledOver`
- `MissionCreated`
- `MissionDriChanged`
- `FindingDiscovered`
- `FindingOwnershipAssigned`
- `ChangeOpened`
- `ChangeHeadAdvanced`
- `ReviewSlotOpened`
- `ReviewClaimed`
- `ReviewDecided`
- `CandidateDeclared`
- `PromotionEligible`
- `PromotionDecided`
- `ParentPromoted`

Events are not authority by themselves; they are durable facts produced by successful authoritative commands.

## 19. Core State Machines

Agent lifecycle:

`registered -> active <-> suspended -> retired`

Retirement is exceptional. Normal capacity reduction uses suspension so conversation continuity remains recoverable.

Conversation lifecycle:

`provisional -> canonical generation N -> closed generation N -> generation N+1`

A provisional identity must be scoped to the actual browser/runtime instance; the root URL `https://chatgpt.com/` is not a valid shared conversation identity.

Mission lifecycle:

`proposed -> active -> blocked? -> ready-for-review -> completed | cancelled`

Finding lifecycle:

`open -> triaged -> owned -> in-progress -> resolved | rejected | duplicate`

Change lifecycle:

`draft -> active -> checks-pending -> review-open -> approved -> integration-ready -> merged | rejected | abandoned`

Review slot lifecycle:

`open -> claimed -> approved | changes-requested | rejected | released`

Candidate lifecycle:

`declared -> verifying -> eligible -> final-decision -> promoted | rejected | superseded`

Every state transition must be replay-safe and crash-convergent where it affects authority.

## 20. Project Identity and Iterations

A durable Project represents the actual engineering product/repository identity. Self-improvement waves, dates, iterations, and experiments are not Projects.

A Project should have a stable projectId plus normalized repository/workspace identity. Human-facing project names may change without changing the identity used by Agents, Missions, Tasks, Findings, or Changes.

Iterations/Waves should be first-class optional metadata or Mission groupings:

```text
Iteration
  iterationId
  projectId
  parentGeneration
  goal
  startedAt
  candidateSha?
```

Creating `GAM Recursive Wave 2` must never implicitly create a new ProjectCell or new permanent Agent identities.

## 21. Relationship to Existing v0.5 Concepts

The next architecture should preserve proven mechanisms while relocating their responsibilities:

- existing AgentSlot durability evolves into durable Agent identity + runtime presence;
- ConversationAuthority remains useful but binds to Agent identity rather than transient role/wave conventions;
- Task graph becomes Mission-scoped execution detail rather than the organization model;
- WorkClaim/evidence concepts move under Change/Evidence/Review aggregates;
- elastic fleet becomes capacity/lifecycle infrastructure, not the place where role identity is defined;
- exact dispatch becomes one policy implementation underneath Mission/Agent assignment, not the global organizational abstraction;
- promotion authority remains Parent-side and is strengthened by PromotionCertificate and accountable final-decision semantics.

The experimental `roleClass()` affinity repair may provide migration heuristics for legacy records, but role-class fuzzy matching is not the target allocation model.

## 22. Immediate Architectural Defects This Redesign Must Eliminate

The redesign is specifically intended to remove several observed v0.5 organizational defects:

1. task/wave/date data embedded into long-lived role identity;
2. suspended Agents with valuable canonical conversations not reused because exact role strings changed;
3. repeated self-improvement waves creating distinct ProjectCells for the same repository;
4. Tasks referring to project display names instead of stable project identity;
5. root new-chat URLs collapsing unrelated provisional browser sessions into one pseudo conversation identity;
6. no first-class Mission/DRI concept above Tasks;
7. no Finding Registry to deduplicate independently discovered defects;
8. review logic oriented around designated flows rather than sparse pull-based review capacity;
9. Change/worktree/PR not unified as a single collaboration boundary;
10. organizational policy entangled with implementation role-name conventions.

These are structural defects, not merely allocator-tuning problems.

## 23. Migration Strategy

The migration should be deterministic and evidence-preserving. Backward compatibility with the old conceptual model is not a design goal, but historical evidence must remain queryable.

Recommended migration phases:

Phase 0: freeze this architecture and define typed IDs/contracts with no behavioral switch.

Phase 1: introduce stable Project, Organization, Department, Domain, Agent, and Conversation lineage registries alongside existing state.

Phase 2: migrate legacy AgentSlots into durable Agent identities. Select canonical conversation lineages deliberately; do not create duplicate identities merely because legacy role strings differ.

Phase 3: introduce Mission and Finding registries. New autonomous work begins through Missions/Findings rather than wave-specific task-role creation.

Phase 4: make Change/Worktree/Internal-PR the authoritative write workflow. Existing evidence/claim mechanisms bind to exact Change heads.

Phase 5: introduce Review Pool, Review Slots, review budgets, aging priority, and targeted escalation. Remove organization-wide review interruption patterns.

Phase 6: convert assignment from role-string matching to stable ownership/capability/conversation-affinity policy with hysteresis.

Phase 7: introduce PromotionCertificate and accountable Release Governor semantics over the existing independent Parent-side promotion authority.

Phase 8: remove obsolete role/wave/project-name coupling after migration evidence proves the new path complete.

Each phase requires typed contracts, focused tests, crash/replay coverage where state is durable, architecture gates, documentation, and an exact Git commit before the next destructive phase.

## 24. Required Acceptance Evidence

The next-generation organization is not complete until all of the following are demonstrated by tests or real controlled E2E evidence:

- the same persistent Agent executes multiple related Tasks through the same canonical ChatGPT conversation;
- closing and reopening a tab resumes the same Agent/conversation;
- conversation rollover preserves Agent identity and lineage;
- a new iteration/wave for the same repository does not create a new Project identity;

- two Agents discovering the same defect converge on one authoritative Finding with multiple evidence attachments;
- one Mission has exactly one authoritative DRI while allowing multiple contributors;
- concurrent Changes use isolated worktrees and do not mutate one another's working trees;
- cross-domain Changes may be implemented but cannot integrate without required affected-domain review dimensions;
- ordinary PR creation does not broadcast prompts to unrelated Agent conversations;
- qualified idle Agents can claim required reviews from a pool;
- filled review requirements stop active recruitment of redundant reviewers;
- unclaimed blocking reviews age in priority and escalate narrowly, not organization-wide;
- machine-gate failures are visible before semantic review capacity is spent;
- protected Changes reject author/self-review combinations when independence is required;
- a Candidate cannot mutate or approve its own PromotionCertificate;
- exact Parent SHA CAS failure prevents stale promotion;
- crash/replay converges Agent, Mission, Change, Review, and Promotion authoritative states;
- historical ownership/evidence remains queryable after Department/Domain reorganization;
- Agents can inspect shared peer artifacts through Remote while protected writes remain isolated;
- organization policy can evolve without changing Charterion platform enums for every new role name.

## 25. Explicit Anti-Patterns

The following patterns are forbidden in the target architecture:

- creating a new permanent Agent for each Task;
- encoding wave/date/task identity into Agent role names;
- creating a new Project for each self-improvement iteration;
- treating browser tab identity as Agent identity;
- treating `https://chatgpt.com/` as a shared durable conversation key;
- rebuilding ChatGPT conversation context into a home-grown summary and treating it as equivalent cognition;

- forcing every Agent to review every Change;
- using review count as a substitute for independent risk-dimension coverage;
- letting the Supervisor become the dispatcher for all ordinary work;
- allowing Domain ownership to block read/investigation or make one Agent the only possible expert;
- giving a Release Governor authority to waive mandatory evidence or rewrite Candidate identity;
- allowing Candidate code to promote itself;
- using a single giant ControlPlane aggregate as the write boundary for every organizational subsystem;
- hard-coding Charterion-specific department/role names into generic platform logic;
- deleting useful suspended Agent identities merely to reduce active browser count;
- silently mutating another Agent's worktree instead of coordinating through a Change relationship.

## 26. Initial Organization Manifest Shape

The platform should eventually load a typed organization manifest roughly capable of expressing:

```text
OrganizationManifest
  organizationId
  projectId
  departments[]
  domains[]
  agents[] / agentTemplates[]
  ownershipPolicies[]
  reviewPolicies[]
  protectedSurfaces[]
  resourcePolicies[]
  promotionPolicy
  evolutionPolicy
```

The manifest declares durable structure and policy. Runtime state such as current Mission ownership, Agent load, open review claims, browser presence, and worktree leases belongs in durable state stores, not static manifest text.

## 27. Design Test for Every Future Feature

Every proposed feature should answer these questions before implementation:

1. Does it strengthen durable Agent identity or accidentally recreate task-bound identity?
2. Does it preserve valuable ChatGPT conversation continuity?
3. Does it use the shared filesystem/Git world by reference instead of copying context unnecessarily?
4. Is the state cognitive, shared-world, or authoritative, and is it stored in the correct plane?
5. Does it increase Agent autonomy while keeping irreversible authority deterministic?
6. Does it create a clear single owner for outcomes without creating intellectual walls?
7. Can it operate without interrupting unrelated Agents?
8. Does it preserve isolated Change/worktree boundaries under concurrency?
9. Are review requirements driven by risk dimensions rather than social ceremony?
10. Can the organization evolve this policy later without source-level role-name conditionals?
11. Is there direct evidence for completion and a crash/replay story for durable authority?
12. Can a Candidate exploit the feature to approve or promote itself? If yes, the design is invalid.

## 28. Target Character of Charterion

The target product is not a central planner that tells models every next action. It is a thin but powerful autonomous-engineering substrate that makes highly capable ChatGPT Web agents safe and effective as a persistent software company.

The intended operating character is:

**stable people, durable conversations, explicit departments, clear ownership, broad autonomy, shared reality, isolated changes, pull-based review, independent evidence, accountable release judgment, and hard promotion boundaries.**

The architecture should optimize organizational learning and engineering throughput across thousands of internal iterations, not maximize the number of one-shot agents or public release events.

---

This design intentionally prioritizes systematic decoupling, typed boundaries, durable state, layered authority, worktree/PR-centered collaboration, and evolvable organization policy over backward compatibility with the current role/wave model.

## 29. Capability-Neutral Standardized Action Substrate

Charterion is not a software-development-only agent platform. Software engineering is one important organizational workload, not the boundary of Agent capability.

The platform MUST preserve the native breadth of capable ChatGPT Web Agents. Agents may research literature, write papers, create presentations, analyze data, operate browsers, manage documents, conduct experiments, perform engineering, coordinate projects, use remote computers, inspect systems, and undertake future classes of work not known when Charterion is implemented.

The platform's job is therefore **standardization without capability reduction**.

Charterion should normalize how actions are described, authorized, isolated, observed, evidenced, reviewed, recovered, and audited. It should not encode a closed list of things Agents are allowed to be capable of.

Principle: **standardize the interface; do not narrow the intelligence behind it.**

A capability should be discoverable and invokable through typed contracts while remaining open-ended through adapters/plugins. Unknown future capabilities must be addable without redesigning Agent identity, Mission, review, or authority models.

### 29.1 Generic capability contracts

The generic execution boundary should be based on typed capability and operation contracts rather than code-centric commands:

```text
CapabilityDescriptor
  capabilityId
  providerId
  operations[]
  inputSchema
  outputSchema
  effectClass
  authorityRequirements
  recoverability
  observability
```

```text
OperationRequest -> OperationReceipt -> EvidenceRefs / ArtifactRefs
```

Every provider may expose richer domain-specific semantics, but the organization layer should always be able to reason about identity, authority, effects, receipts, failure, retry safety, artifacts, and evidence through common contracts.

### 29.2 Open-ended capability providers

Examples of capability providers include Git/worktree/PR tooling, filesystem and terminal access, browser and Remote Desktop operation, web and literature research, document/PDF/slide/spreadsheet creation, data analysis, scientific experiment execution, communication systems, cloud applications, compute resources, and future plugins.

These are examples, not a platform allowlist. The generic platform must not contain assumptions such as `task.kind === code` or require every deliverable to become a Git commit.

A provider may add capabilities at runtime through a typed registration boundary. Organization policy can govern effects and authority by capability metadata rather than by embedding every provider name into core logic.

This preserves two properties simultaneously:

- Agents retain the full breadth of tools and reasoning available to them.
- Actions become normalized enough for multiple autonomous Agents to coordinate safely and predictably.

The correct abstraction is not `what is the Agent allowed to know how to do?`; it is `how is an effect represented and governed when the Agent chooses to do it?`.

## 30. Work Model Beyond Code

`Mission`, `Finding`, `Task`, `Review`, `Evidence`, `Artifact`, and `Authority` are universal organization primitives. `Change`, Git worktree, branch, commit, and PR are specialized software-engineering primitives beneath them.

Examples:

```text
Literature Mission -> Research Tasks -> Sources/Notes -> Synthesis -> Paper Artifact -> Review
Paper Mission      -> Draft Sections -> DOCX/LaTeX Artifact -> Peer Review -> Submission
Presentation       -> Research -> Narrative -> PPTX Artifact -> Review -> Publish
Data Analysis      -> Dataset -> Analysis Run -> Tables/Charts -> Report Artifact -> Review
Experiment         -> Protocol -> Run -> Raw Evidence -> Analysis -> Scientific Review
Software Change    -> Finding -> Change -> Worktree -> Commits -> PR -> Merge
Operations         -> Incident/Request -> Operation -> Receipts -> Verification
```

The organization runtime must not force non-code work through Git metaphors when they do not fit. It should preserve domain-native workflows while using common identity, responsibility, authority, evidence, review, and lifecycle contracts.

### 30.1 Artifact and deliverable abstraction

Non-code work should use first-class Artifact/Deliverable objects rather than pretending every result is a source-tree mutation:

```text
Artifact
  artifactId
  kind
  producerAgentId
  missionId
  revisions[]
  storageRefs[]
  evidenceRefs[]
  reviewPolicy
  publicationState
```

Artifacts may be papers, notes, datasets, reports, spreadsheets, slide decks, figures, experiment outputs, designs, documents, software packages, or future media.

The platform should support revision, provenance, review, approval, publication, supersession, and reproducibility where meaningful, while allowing each artifact type to retain native tooling and formats.

### 30.2 Layered standardization, not lowest-common-denominator APIs

Standardization must be layered. Charterion should define a small universal operation envelope for organizational concerns, then allow capability-specific typed protocols underneath it.

The universal envelope describes who is acting, under which Mission/Task, against which resources, with which authority, whether the effect is reversible/idempotent/uncertain, what receipt was returned, and where evidence/artifacts live.

The provider-specific contract preserves native power. Git retains branches, commits, worktrees, and PRs. Literature tooling retains citation/source/query semantics. Presentation tooling retains slides/themes/layouts. Experiment tooling retains protocol/run/checkpoint/measurement semantics.

Charterion must not replace rich provider APIs with generic `execute(action: string, payload: object)` boundaries. Generic organization contracts and domain-specific typed capabilities coexist.

Principle: **normalize coordination and effects; preserve domain expressiveness.**

## 31. Departments Do Not Define Capability Ceilings

Departments express durable responsibility and coordination boundaries, not limits on what an Agent may know or do.

An Agent in Research may write code to support a study. An Engineer may perform literature review. A Data Agent may create slides. A Publication Agent may inspect repositories. A Principal Architect may run experiments. Capability is many-to-many and evolves over time.

Department policy may determine ownership, expected review, resource authority, or who is accountable for an outcome. It MUST NOT imply that non-members are cognitively incapable of, or categorically forbidden from, performing the underlying work in an isolated and policy-compliant context.

A real organization may define departments such as Engineering, Research, Science/Experimentation, Data & Analysis, Writing & Publication, Design & Presentation, Operations, Security/Governance, or project-specific alternatives. Charterion must not hard-code this taxonomy.

Agent capability profiles are dynamic evidence-backed descriptions used for discovery and assignment. They are not closed permission lists. Authority over risky effects is a separate concern from capability.

## 32. Capability, Authority, and Standardized Operations Are Orthogonal

The architecture must keep three questions separate:

1. **Capability:** can this Agent/provider perform the class of work?
2. **Authority:** may this Agent perform this particular effect on this protected resource now?
3. **Protocol:** how is the attempted operation represented, observed, recovered, and evidenced?

A capable Agent may lack authority for a specific destructive production operation while retaining the ability to reason about it, simulate it, prepare artifacts, or propose it. Conversely, granting authority must never be interpreted as proof of competence.

The standardization layer should make operations legible to the organization without deciding the Agent's reasoning path. It provides normalized discovery, invocation boundaries, effect classification, receipts, audit records, artifact references, idempotency/fencing metadata, and failure semantics.

This is the platform's core value: **turn powerful but potentially uncoordinated Agent actions into powerful, coordinated, inspectable organizational actions without reducing the underlying capability surface.**

## 33. Optional Execution-Fabric Plugins and Default Distribution

Charterion Core MUST be a complete standalone product. Noetrium is an optional integration plugin, not a required runtime, default dependency, hidden service, or architectural root.

The default public Charterion release MUST install, start, self-host, manage persistent web Agents, coordinate Missions, use the plugin system, perform review/promotion, and operate its built-in web-agent/runtime surfaces with **no Noetrium installation present**.

Noetrium may provide a large first-party optional capability bundle when installed, especially for advanced execution, scientific experiments, environments, resources, recovery, artifacts, and evidence. Its absence must not place Charterion in a degraded or unsupported state.

The product relationship is therefore:

```text
Charterion Core
  + optional capability plugins
      - Remote / filesystem / terminal providers
      - Git / GitHub providers
      - MCP providers
      - document / research / productivity providers
      - Noetrium integration plugin
      - future providers
```

Noetrium has no privileged bypass around ordinary plugin contracts, authority checks, capability discovery, lifecycle management, or observability.

### 33.1 Charterion Core owns the plugin contract, not provider semantics

Core should expose stable generic extension primitives such as:

```text
PluginManifest
CapabilityProvider
CapabilityOffer
CapabilityRequirement
OperationEnvelope
OperationReceipt
ArtifactRef
EvidenceRef
ProviderHealth
ProviderLifecycle
```

These contracts describe organization-level interoperability. They do not require every provider to share one internal implementation model.

A provider remains free to use MCP, CLI, HTTP, SDKs, native code, a local daemon, cloud services, or another execution fabric behind its adapter.

Core MUST NOT contain provider-name conditionals such as `if (provider === "noetrium")` in Mission, Agent, Review, or Promotion logic. Provider-specific behavior belongs inside that provider's adapter or explicitly declared capability metadata.

Plugin availability is additive. Installing or removing one optional plugin changes the available CapabilityOffers, not Organization, Agent identity, Mission semantics, Conversation lineage, review authority, or promotion authority.

### 33.2 Default release profile

The canonical public release profile is `charterion-core` and MUST NOT bundle Noetrium binaries, Python environments, model/runtime stacks, scientific infrastructure, or Noetrium-specific configuration.

A default installation may include Charterion-owned components required for its identity and web-Agent purpose, for example the browser extension, local kernel/daemon, native messaging host, CLI, durable organization state, ChatGPT Web conversation runtime, plugin host, and small built-in adapters needed for core operation.

Heavy or domain-specific capability bundles are separately installable. Illustrative packaging:

```text
charterion-core
charterion-plugin-noetrium
charterion-plugin-github
charterion-plugin-mcp
charterion-plugin-<provider>
```

The names are illustrative; the invariant is the package boundary.

`charterion-plugin-noetrium` may detect and connect to an independently installed Noetrium runtime or gateway. Installing Charterion MUST NOT implicitly install Noetrium.

Release qualification for Charterion Core MUST run with Noetrium absent from PATH, package resolution, services, and configuration, proving there is no accidental dependency.

## 34. Scope Contraction: Organization Runtime, Not Tool Runtime

This section supersedes the tool-mediation implications of Sections 29 and 33. Charterion MUST NOT become a generic computer-tool, filesystem, browser, terminal, Git, MCP-client, document, or execution-fabric platform merely because its Agents can use those things.

A capable ChatGPT Web Agent already has its own native reasoning surface and may have direct access to Remote/computer control, connected tools, browser capabilities, files, terminals, Git, external applications, and future OpenAI capabilities. Charterion should preserve and exploit that direct capability instead of inserting itself between the Agent and every tool call.

The Charterion core responsibility is therefore deliberately narrow:

```text
Organization
  -> persistent Agent
  -> Department / Domain / ownership
  -> Mission / Work / DRI
  -> Finding / coordination
  -> Review / decision
  -> Candidate / promotion when applicable
```

plus a standardized ingress surface through which humans and external AI systems can submit, inspect, update, and receive outcomes from organizational work.

Principle: **standardize organizational work, not every action an intelligent Agent performs.**
### 34.1 Explicit non-responsibilities

Charterion Core SHOULD NOT implement or require generic wrappers for:

- filesystem browsing or file manipulation;
- shell/terminal execution;
- browser navigation as a general capability;
- Git/GitHub as a generic tool abstraction;
- generic MCP-client capability federation;
- document/PDF/slides/spreadsheet execution;
- literature/search tooling;
- model, experiment, environment, GPU, server, or scientific-execution fabrics;
- a universal Capability Registry describing everything an Agent can do.

Those capabilities may be available directly to the Agent through ChatGPT, Remote, connected tools, local software, external services, or optional project-specific integrations.

Charterion may record references produced by Agent work when organizational state needs them, such as a commit SHA, PR, document path, URL, artifact ID, experiment ID, or evidence location. Recording a reference does not make Charterion the execution or storage authority for the referenced system.

The Kernel should intervene only where Charterion itself owns an authoritative organizational transition or where an explicitly protected shared resource requires coordination. It should not demand that every benign Agent action be predeclared as a Charterion Operation.

### 34.2 Direct-Agent capability principle

The preferred execution path is:

```text
Mission / Work assigned by Charterion
          -> Agent reasons autonomously
          -> Agent directly uses available computer/tools inside its dedicated AgentWorkspace boundary
          -> Agent reports durable outcome/references
          -> Charterion updates organizational state
```

not:

```text
Agent -> Charterion generic tool proxy -> filesystem/browser/Git/etc.
```
### 34.3 Human and external-AI work ingress is a core product surface

Charterion MUST expose one normalized organizational ingress model that can be used by a human UI/CLI and by external AI systems without giving either caller direct access to internal durable state.

The canonical ingress object should be work-oriented rather than tool-oriented:

```text
WorkRequest
  requestId
  requesterIdentity
  requesterKind = human | external-ai | internal-agent | system
  organizationId / projectId?
  objective
  contextRefs[]
  constraints[]
  desiredOutputs[]
  priority?
  deadline?
  requestedAuthority?
  idempotencyKey?
```

Ingress translates accepted requests into Organization-owned objects such as Mission, WorkItem, Finding, ReviewRequest, or HumanDecisionRequest. The caller does not choose internal database rows, browser tabs, AgentSlot IDs, or implementation-specific dispatch paths.

Minimum external surfaces SHOULD include submit, inspect status, append context/reference, cancel/request-stop, answer a clarification, and retrieve final outcome/references. Transport may be HTTP/JSON-RPC/CLI/UI and MAY include an MCP server surface specifically for **submitting organizational work to Charterion**, without making Charterion a general MCP tool broker.

The same Mission semantics, authority checks, deduplication, DRI assignment, review policy, and durable status apply regardless of whether the request came from a person or another AI.

### 34.4 Result surface

A completed organizational work item should return a compact typed outcome:

```text
WorkOutcome
  requestId
  missionId / workId
  disposition
  summary
  producedRefs[]
  decisionRefs[]
  blockerRefs[]
  responsibleAgentIds[]
  completedAt
```

`producedRefs` may point to code, PRs, documents, papers, slide decks, Notion pages, datasets, experiment results, external systems, or anything else the Agent created. Charterion need not understand or own every referenced format.
### 34.5 Noetrium and other integrations are optional organizational attachments

Noetrium is optional. The default Charterion release MUST NOT bundle, install, start, or require Noetrium. If present, Noetrium is simply an external system that Agents or organization policy may reference/use for advanced research and execution workflows.

Charterion does not need a privileged `ExecutionFabricPort` solely to accommodate Noetrium. A future Noetrium integration may be implemented as a narrow optional connector when concrete coordination value exists, for example importing run/evidence references, submitting a research run, or observing completion state.

The same rule applies to GitHub, Notion, Linear, external MCP systems, research platforms, CI services, or future applications: integrate only organizational facts/workflows that Charterion needs to coordinate; do not reproduce the application's full capability surface inside Charterion.

Default distribution invariant:

```text
charterion-core = complete organization runtime + web-Agent runtime + work ingress
optional integrations = separately installable / separately configured
```

Removing every optional integration MUST still leave a fully valid Charterion organization capable of receiving work, assigning persistent Agents, coordinating their conversations, tracking Missions, running review/governance, and returning outcomes.

### 34.6 Revised bounded contexts

The target Charterion core should converge toward only these primary bounded contexts:

```text
OrganizationRegistry
AgentRegistry
ConversationRegistry
MissionRegistry
WorkRegistry
FindingRegistry
ReviewRegistry
Decision/PromotionRegistry
WorkIngress
WorkOutcome / organizational projections
WebAgentRuntime
Kernel authority/persistence
```

Software-specific Change/Worktree/PR support may remain as an organizational workflow module because concurrent engineering benefits strongly from it, but it is not the universal Work model.

Generic `CapabilityProvider`, `ArtifactRegistry`, `EvidenceRegistry`, `ResourceRegistry`, and universal tool-proxy subsystems SHOULD NOT be introduced into Core unless later evidence proves a genuinely organization-owned authority that cannot remain external.
### 34.7 Acceptance tests for the contracted scope

The architecture is not correctly scoped unless all of these can be demonstrated:

- a human can submit a broad goal without selecting an Agent or tool;
- an external AI can submit the same class of goal through the public ingress contract;
- Charterion can deduplicate/route the request, create a Mission, select/retain a persistent Agent, and assign one DRI;
- the Agent can use direct computer/tool capabilities that Charterion does not model;
- completion can attach arbitrary external references without adding a new Core provider type;
- an optional integration can be absent with no degraded Core state;
- Noetrium can be entirely absent from installation and tests of the default distribution;
- a new class of work such as paper writing or slide creation requires no Core enum or tool implementation;
- unrelated Agent conversations are not interrupted by ordinary work/review traffic;
- authoritative organizational transitions remain durable and replay-safe.

### 34.8 New anti-patterns

Reject any redesign that:

- creates a generic filesystem/browser/terminal/Git proxy because Agents already have direct tool access;
- requires every Agent action to pass through Charterion before it can occur;
- models the full external tool ecosystem inside the Charterion database;
- treats optional integration availability as Agent capability ceilings;
- makes Noetrium or another external platform a dependency of `charterion-core`;
- adds task-kind enums for every new profession or output format;
- conflates receiving/organizing work with performing the work;
- turns Charterion into an MCP client aggregator instead of an organization runtime;
- lets transport-specific APIs define Mission, Agent, Review, or authority semantics.

The resulting product definition is:

**Charterion receives work, organizes persistent intelligent workers, coordinates responsibility and review, preserves durable organizational truth, and returns outcomes. The Agents themselves perform the work using whatever legitimate capabilities are available to them.**

## 35. Dedicated Agent Workspace Is the Computer-Safety Boundary

Section 35 refines Section 34's direct-Agent capability principle. "Agent directly uses available computer/tools" means **the Agent directly uses tools exposed inside its dedicated workspace boundary**, not unrestricted access to the host computer.

Every persistent Organization Agent SHOULD have one durable `AgentWorkspace` representing its personal company computer. The Agent may use terminal, filesystem, Git, browser automation, Remote, connected tools, local applications, and future capabilities freely inside that workspace. Charterion does not proxy or micro-manage those tool calls.

The workspace exists to contain effects, not to reduce intelligence. The principle becomes: **full capability inside a bounded workplace; explicit authority for effects that cross the boundary.**

`AgentWorkspace` is different from a software `ChangeWorkspace`/Git worktree. The AgentWorkspace is long-lived with the employee identity. A ChangeWorkspace is a narrower, usually disposable engineering workspace created inside or mounted into the AgentWorkspace for one Change.
### 35.1 Workspace model

```text
Persistent Organization Agent
  -> AgentWorkspace generation N
       -> personal home / scratch / caches
       -> authorized project mounts
       -> direct terminal and Remote endpoint
       -> tool/application configuration
       -> scoped credentials
       -> ChangeWorkspace / Git worktrees when needed
```

The canonical workspace contract should remain backend-neutral:

```text
AgentWorkspace
  workspaceId
  organizationId
  agentId
  generation
  isolationTier
  backendKind
  rootRef
  endpointRefs[]
  mountedResourceRefs[]
  state
  createdAt / updatedAt
```

The Workspace Registry owns identity, lifecycle and binding facts. It MUST NOT become a generic filesystem or command-execution API.
### 35.2 Isolation must be enforced, not conventional

A directory naming convention is not an isolation boundary. `E:/agents/A` is insufficient if a shell can simply navigate to `E:/`.

Workspace isolation MUST be enforced by the selected runtime/backend. Supported tiers may include the existing Charterion concepts:

```text
c0-host          explicit unsafe/trusted opt-in only
c1-container     default minimum for ordinary autonomous work when technically suitable
c2-hypervisor    stronger boundary for risky or heterogeneous workloads
c3-ephemeral-vm  strongest disposable boundary for untrusted/high-risk work
```

The implementation may evolve across Windows, Linux, container, VM or remote-host backends, but the organizational contract must stay stable.

The default autonomous-Agent policy MUST NOT expose the raw host as the Agent's normal computer. `c0-host` requires explicit human/admin policy and must never be selected merely because provisioning a sandbox failed.

Failure to provision the requested isolation tier is fail-closed: the Agent remains without an active computer workspace rather than silently falling back to host access.
### 35.3 Host and peer protection invariants

By default an AgentWorkspace MUST NOT expose:

- Charterion Kernel database, admin tokens, promotion keys or Parent authority state;
- another Agent's workspace/home/cache/credentials;
- unrestricted user home or arbitrary host filesystem roots;
- host service-control surfaces or privileged device access;
- production secrets/resources not explicitly granted for the Mission;
- Parent/Candidate promotion control paths.

Authorized project repositories, shared datasets, documents, caches or other company resources are mounted/referenced explicitly and with the narrowest practical write semantics.

Workspace credentials are scoped to the Agent/workspace and rotated or revoked independently. Copying the Kernel's global admin credential into an AgentWorkspace is forbidden.

An Agent may inspect shared organizational reality through approved shared resources while retaining private scratch state. Shared reality does not imply shared writable root filesystems.
### 35.4 Tools are exposed into the workspace, not mediated by Charterion

Charterion does not need `filesystem.read`, `terminal.exec`, `ppt.create`, or similar universal tool APIs. Instead, the workspace provisioning layer makes the Agent's normal tools available **inside the boundary**.

Examples include a Remote/MCP endpoint whose allowed machine is the workspace backend, a shell whose filesystem/process namespace is the workspace, scoped repository mounts, browser/application profiles belonging to the workspace, and credentials/configuration injected only when organizational policy permits them.

The Agent still chooses its own workflow and tools. Charterion only ensures that the environment those tools can affect is the assigned workspace plus explicitly mounted external resources.

A tool channel that bypasses the workspace boundary and reaches the raw host is a protected exception, not an ordinary capability.

### 35.5 Persistent Agent, replaceable workspace generations

Agent identity survives workspace replacement:

```text
Agent A
  -> Workspace generation 1 (retired)
  -> Workspace generation 2 (active)
  -> Workspace generation 3 (future)
```

Rebuild, corruption recovery, backend migration or stronger isolation may create a new workspace generation without changing Agent identity or ChatGPT Conversation identity. Durable organizational state remains outside the workspace.
### 35.6 Relationship to Change worktrees and shared resources

For software work, the preferred nesting is:

```text
AgentWorkspace
  -> Mission context
  -> Change C381
  -> isolated Git worktree / branch
  -> commits / PR
```

A Change worktree remains disposable after integration. The AgentWorkspace remains available for subsequent Missions and preserves local development state that is appropriate for that Agent.

Cross-Agent collaboration happens through shared repositories, PRs, Finding/Review records, artifacts and typed messages—not by letting Agents write freely into one another's workspace.

### 35.7 Workspace safety acceptance evidence

A release is not workspace-safe unless tests demonstrate that an autonomous Agent can freely create/delete files, run processes and use its normal tools inside its workspace while being unable by default to mutate Kernel authority state, another Agent workspace, or arbitrary host files.

Tests MUST cover isolation provisioning failure without host fallback, independent credential revocation, workspace-generation replacement, allowed project mounts, denied peer/Kernel paths, and cleanup that cannot delete shared/authoritative resources.

Constitutional rule: **give every Agent a powerful computer of its own; do not give every Agent the operator's computer.**

### 35.8 Browser and tool-profile isolation

A dedicated filesystem alone is insufficient if the ChatGPT Web session can still select a host-wide Remote/MCP/tool connection. Each live AgentWorkspace therefore SHOULD own a distinct browser profile identity and tool-configuration profile.

The browser profile used by the bound AgentSlot MUST match the active AgentWorkspace. Two live AgentWorkspaces MUST NOT share the same browser/tool profile by default.

The tool profile is expected to expose workspace-scoped endpoints, not host administration endpoints. The host/operator browser profile and its privileged connectors are outside ordinary Agent workspaces.

This creates an enforceable chain:

```text
Persistent Agent
-> AgentWorkspace
-> dedicated browser profile
-> workspace-scoped tool profile/endpoints
-> sandbox/VM/container/remote workspace
```

A mismatched browser profile is a runtime identity violation and must fail closed before the page is accepted as that Organization Agent's active runtime.