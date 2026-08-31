# GPT Agent Manager

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chromium-Manifest%20V3-4285F4)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.5.0-blue.svg)](manifest.json)

GPT Agent Manager (GAM) coordinates multiple **ChatGPT web conversations** as persistent, role-bound agents and adds a local durable control plane for projects, Git work, reviews, resources, and recovery.

It is intentionally focused on `chatgpt.com`: no OpenAI API key, no other model providers, and no hosted GAM backend.

## v0.5 in one sentence

**One GAM Runtime, two operator surfaces:** a visual browser workflow for a human operator and a deterministic JSON/CLI workflow for an authorized agent operating the same projects through Remote tooling.

```text
Human operator                     Remote / mobile GPT operator
      │                                      │
      ▼                                      ▼
Side Panel / GAM.cmd              GAM.cmd ... --json / gamctl
      └──────────────────┬───────────────────┘
                         ▼
                     GAM Kernel
                       gamd
                         │
       SQLite · Git · leases · capabilities
       evidence · Change Requests · merge queue
                         │
                         ▼
             ChatGPT web conversations
```
## Architecture

GAM has four runtime components:

- **Chrome/Edge Extension** — discovers `chatgpt.com` tabs, binds Role/Project identity, routes prompts, observes replies, and renders the Side Panel.
- **`gamd`** — the deterministic local GAM Kernel. It owns SQLite authority, project cells, resource leases, capability fencing, evidence facts, Change Requests, Supervisor reviews, and merge queue state.
- **Native Messaging Host** — a small read-mostly Chromium ↔ `gamd` bridge over a Windows named pipe. It never receives the GAM admin token.
- **`gamctl` / `GAM` launcher** — machine-friendly clients used by local automation and authorized Remote agents.

`gamd` is the only component intended to remain running. Chromium starts the Native Host on demand; `gamctl` and the `GAM` launcher are short-lived clients.

### Authority model

```text
Worker GPT        Supervisor GPT          GAM Kernel
   │                    │                     │
   │ autonomous work    │ engineering review │ deterministic policy
   │ commit / PR         │ approve / revise   │ leases / evidence / merge gate
   └───────────────┬────┴──────────────┬──────┘
                   ▼                   ▼
                  Git              protected state
```

Worker autonomy is intentionally high inside the task and resource scope it owns. Authority remains narrow: a worker cannot approve itself, a Supervisor cannot forge machine evidence, and neither can silently mutate protected integration state.

### Self-hosting safety

GAM can develop GAM as a **Parent GAM -> isolated Candidate GAM** workflow. The Candidate must use distinct repository, `GAM_HOME`, SQLite database, named pipe, and browser profile identities; its `GAM_HOME` must also live outside the Parent `GAM_HOME` so child state cannot overwrite parent authority. Promotion is evidence-gated: Candidate changes are promoted only after committed work and objective Kernel verification bind the exact revision to the required evidence.

## Human and agent operation

### Human mode

Run or double-click:

```text
GAM.cmd
```

GAM idempotently ensures the local Kernel is running, opens a dedicated Chromium profile, loads the extension, opens `chatgpt.com`, and restores durable project state. The dedicated profile is kept separate from the user's ordinary browser profile.

### Agent mode

A Remote-capable GPT can use the same runtime without scraping GUI text:

```powershell
GAM.cmd status --json
GAM.cmd start --json
GAM.cmd open "My Project" --json
GAM.cmd doctor --json
```

Agent mode is non-interactive and produces stable structured output. Missing projects, unavailable runtime components, and authentication requirements are reported as explicit states instead of triggering prompts or guessed recovery actions.

## ChatGPT account login

GAM does **not** store ChatGPT credentials, passwords, MFA secrets, cookies, or account tokens.

On first launch, GAM opens `chatgpt.com` in its dedicated Chromium profile. The user signs in normally on the official ChatGPT page. Chromium persists that session in the GAM profile for later launches.

The extension reports only a coarse runtime observation to `gamd`:

```text
AuthStatus:  authenticated | authentication-required | unknown
PageHealth: ready | generating | blocked | error | unavailable | unknown
```

Authentication identity and page health are deliberately separate. Visible login/signup UI takes precedence over composer readiness, so an anonymous or expired-session composer is reported as `authentication-required`. `blocked` or `error` pages are never treated as authentication evidence, and unhealthy page state blocks fleet expansion until a healthy/fresh observation replaces it. Runtime reports also carry open tab count, extension version, and observation time. If authentication expires, an agent-facing `GAM ... --json` call can report that human login is required, but GAM never attempts to enter credentials or bypass MFA/CAPTCHA.
## Git / Change Request workflow

For software projects, GAM follows a company-style Git workflow instead of treating a model reply as completion:

```text
Task
  ↓
Worker branch / worktree
  ↓
commit
  ↓
machine evidence
  ↓
Change Request
  ↓
Supervisor review
  ├─ request changes → Worker pushes a new revision → review again
  └─ approve
        ↓
     Merge Queue
        ↓
latest target branch + reviewed head
        ↓
integration candidate / conflict check
        ↓
external protected merge
        ↓
GAM observes Git history
        ↓
INTEGRATED
```

Important invariants:

- the Change Request binds exact `baseSha`, `headSha`, source branch, and target branch;
- the author cannot approve its own Change Request;
- a review is valid only for the exact reviewed head SHA;
- pushing a new head invalidates the previous approval;
- entering the merge queue requires both valid machine evidence and current Supervisor approval;
- the merge candidate is recomputed against the latest target branch;
- conflicts move the Change Request back to `changes-requested`;
- GAM marks a change integrated only after independently observing the approved head/candidate in target-branch Git history.
## Browser orchestration

The browser plane still provides the v0.3 coordination features:

- persistent Role / Project bindings for ChatGPT conversations;
- task DAG and dependency routing;
- `work`, `review`, and `human` task kinds;
- human Approve / Reject and durable Skip / Cancel / Retry facts;
- bounded review → revision → re-review loops for browser-only tasks;
- durable semantic message bus with exact-role and project-broadcast routing;
- frozen recipient identities so later-opened conversations never receive stale broadcasts;
- send-attempt ledger and crash recovery;
- prompt delivery is acknowledged only after observable submission evidence (for example composer clear, generation start, URL transition, or assistant progress), not merely after `button.click()`;
- fail-closed handling of ambiguous tabs and `uncertain` delivery;
- portable browser-state export/import;
- opt-in Auto Supervisor.

Physical prompt sends pass through a persistent account-level dispatch governor before touching the ChatGPT composer. The default policy spaces bursts globally, applies per-Project and per-AgentSlot gaps, caps simultaneous GAM-managed generations, and enforces a rolling minute budget. Direct ChatGPT rate-limit/error UI triggers persisted exponential backoff. Deferred sends do not create a fake successful delivery and are retried only when the normal supervisor/reconciliation loop sees capacity again; GAM favors safe throughput over maximum instantaneous concurrency.

The local control plane augments these browser workflows; failure of `gamd` does not cause the extension to invent state or silently resend prompts. Manifest V3 reconciliation is event-driven with a `chrome.alarms` one-minute wakeup as a durability fallback; the service worker does not rely on `setInterval` remaining alive.

### Elastic idle-tab cleanup

GAM treats browser tabs as disposable runtime leases, not Worker identity. The Kernel periodically reconciles durable project, task, lease, browser-effect, and AgentSlot facts. For active projects it may suspend only excess trusted-idle slots above `minSlots`; paused, draining, or archived projects may drain to zero browser tabs. A bounded idle grace prevents flap. Generating, unknown/unavailable, quarantined, rollover-active, effect-active, lease-active, or currently demanded roles fail closed and remain open.

Cleanup means **suspend + close**, never delete. AgentSlot identity, canonical ChatGPT conversation, checkpoints, evidence, Git/workspace history, and chat history remain durable. When ready work later demands a suspended role, the Kernel resumes the existing matching AgentSlot before browser dispatch instead of silently creating duplicate identity. Same-role capacity is retained according to ready demand, so one remaining task does not keep every duplicate Worker page open.

### Supervisor-managed Worker fleet

Worker pages are controlled by durable `AgentSlot` desired state, not by ad-hoc tab operations. A Supervisor capability with `agent:fleet` may spawn, resume, suspend, or retire Workers. Browser code may only report observed page state; it cannot change fleet intent.

Suspension and retirement are graceful by default: once the Supervisor requests a stop, that Worker is excluded from new task routing and cannot acquire new leases or capabilities. Existing authority remains long enough to finish the current ChatGPT generation. When the Browser Plane observes the page idle, it closes the managed tab and reports `absent`; `gamd` then atomically revokes the old capabilities, releases remaining leases, advances the slot epoch, and finalizes `suspended` or `retired`.

A Worker identity is also independent of any single ChatGPT conversation. When a conversation must roll over, the Kernel persists a `WorkerCheckpoint` and `AgentConversationRollover`, closes the old `AgentConversationRecord`, fences the old browser lease, opens a new page for the same `AgentSlot`, canonicalizes the destination conversation, dispatches the handoff checkpoint, and completes only after Kernel-verified `reply-observed` evidence for that bootstrap attempt. Provisional `WEB:*` or `new` conversation identities never become durable authority.

Workers can also submit typed requests such as `suggestion`, `blocker`, `question`, `resource-request`, `scope-change`, `dependency-request`, `cross-system-request`, `review-request`, and `risk-alert`. A Worker request never mutates fleet or project authority by itself; the Supervisor must accept/reject it and perform any resulting action through its own capability.

## Local control plane

Current durable entities include:

```text
ProjectCell
AgentSlot
AgentConversationRecord
WorkerCheckpoint
AgentConversationRollover
Resource
ResourceLease
CapabilityGrant
ControlEvent
WorkerRequest
WorkClaim
EvidenceArtifact
VerificationRecord
ChangeRequest
ChangeRequestRevision
SupervisorReview
MergeQueueEntry
BrowserRuntimeStatus
```

SQLite runs with foreign keys, WAL mode, strict tables, and full synchronous durability. State-changing operations use transactions and append durable events. Lease epochs fence stale agents from mutating current authority.

Machine verification is deliberately limited to objective facts such as lease identity, file existence/digest, Git commit existence, branch ancestry, and mergeability. Engineering quality and architecture decisions remain the Supervisor Agent's review responsibility.
## Installation and startup

### Requirements

- Windows 10/11 for the current Native Messaging deployment path;
- Node.js 22+ for `gamd`, `gamctl`, and the unified launcher;
- Chrome or Microsoft Edge (Chromium);
- .NET 9 SDK/runtime only when building the Native Host from source.

### From the source checkout

```powershell
npm install
npm run verify:full
npm run setup:windows
```

`setup:windows` builds and verifies the project, publishes the Native Host, computes the stable extension ID, registers the host for Chrome and Edge, prepares `GAM_HOME`, and starts GAM unless `-NoStart` is supplied.

### From the Windows Runtime ZIP

Extract the archive and double-click:

```text
SETUP.cmd
```

The prebuilt installer verifies Node 22+, registers the bundled Native Host, creates a persistent launcher in `GAM_HOME`, optionally creates a desktop shortcut, and starts GAM. It does not rebuild the project.

### Runtime instance identity

Every canonical `GAM_HOME` deterministically derives a 16-character `instanceId`. The default Windows pipe is `\\.\pipe\gpt-agent-manager-<instanceId>` rather than a machine-global pipe. `gamd`, `GAM`, `gamctl`, the installed launcher, `runtime.json`, and the Native Messaging Host all bind to that same identity.

`health` exposes the daemon instance identity, and every non-health production RPC carries the expected `instanceId`. A client that reaches a pipe owned by another GAM home fails closed with `INSTANCE_MISMATCH` before authentication or control dispatch. `GAM.cmd doctor --json` reports both `instanceId` and `pipeName` for diagnostics.

The stable extension identity is derived from the public `manifest.key` and is regression-checked during builds. No private signing key is stored in this repository.

### Browser selection

GAM searches standard Chrome and Edge installation paths. Override discovery when needed:

```powershell
set GAM_BROWSER_PATH=C:\path\to\chrome.exe
GAM.cmd start
```

A dedicated profile is stored under `<GAM_HOME>\chrome-profile`.
## Security boundaries

- Extension host permission remains exactly `https://chatgpt.com/*`.
- Browser permissions remain `tabs`, `storage`, `sidePanel`, `nativeMessaging`, and `alarms`. `alarms` is used only as the Manifest V3 reconciliation wakeup fallback.
- Chromium Native Messaging calls are restricted to the pinned extension origin.
- The Native Host holds only a browser token and exposes a small allowlist; it never holds the GAM admin token.
- Worker capabilities are project/task/resource/lease scoped and stored in SQLite only by token hash.
- gamctl has no implicit administrator fallback: agent calls require a capability token/file, while privileged human/bootstrap operations must opt in explicitly with --admin.
- Browser runtime reporting cannot create projects, acquire leases, issue capabilities, approve reviews, or merge changes.
- `gamd` listens on an instance-scoped local named pipe rather than an unauthenticated TCP port; RPC instance fencing prevents another `GAM_HOME` from being mistaken for the current Kernel.
- Unknown, stale, ambiguous, or conflicting authority fails closed.

The extension and GAM Kernel are coordination and policy layers, **not an OS sandbox**. If ChatGPT agents receive filesystem/terminal access through a Remote connector, those execution tools still require an appropriate container/VM/capability boundary.

## Verification and release

Fast development gate:

```powershell
npm run verify
```

Full release gate:

```powershell
npm run verify:full
```

The full gate includes TypeScript, static permission/UI checks, all tests, extension/control builds, Native Host publish, and real process-level smoke tests for the control plane, evidence flow, Git Change Request flow, Native Messaging protocol, and unified launcher.

Release:

```powershell
npm run release
```

Produces both:

```text
release/gpt-agent-manager-v0.5.0.zip
release/gpt-agent-manager-v0.5.0-windows-runtime.zip
```

with SHA256 sidecar files. The first archive is the browser-extension payload; the second contains the prebuilt extension, GAM launcher, `gamd`/`gamctl`, Native Host, and Windows runtime installer.
## Development principles

1. ChatGPT web conversations are the cognition plane; do not replace them with provider APIs.
2. Git and durable machine observations are engineering facts; model prose is a claim or explanation.
3. Worker agents should have broad decision freedom inside narrow, explicit authority.
4. Supervisor agents perform engineering judgment; deterministic code enforces invariant policy.
5. Persist facts and derive status instead of duplicating mutable state.
6. Fence stale attempts with identities and epochs.
7. Keep semantic model context separate from scheduler/control-plane metadata.
8. Do not expand browser or host permissions merely for convenience.
9. Prefer protected branch / Change Request workflows over direct writes to authoritative code.
10. Fail closed when delivery, identity, ownership, or integration state is uncertain.

## Scope

GAM currently targets ChatGPT Web on `chatgpt.com`. Generic LLM APIs, Claude, Gemini, coding-agent CLIs, and hosted multi-provider orchestration are outside the product scope.

## License

Licensed under the [MIT License](LICENSE).

## Supervisor-managed worker fleet

The Project Supervisor owns worker lifecycle decisions. Workers do not clone, suspend, or retire other workers directly. A Supervisor capability with `agent:fleet` may `agent.spawn`, `agent.suspend`, `agent.resume`, or `agent.retire`; the Kernel enforces project `minSlots` / `maxSlots` and rejects unauthorized fleet changes.

Each `AgentSlot` separates desired state from browser observation:

```text
Supervisor desired state     Browser observed state
active                       absent / opening / open / error
suspended                    open while draining -> closing -> absent
retired                      closing -> absent
```

The Extension reconciles these states. Active slots get a ChatGPT page (or their durable conversation is reopened); suspended/retired slots stop receiving new tasks and their page closes only after an in-flight generation finishes.
Worker capabilities can be bound to an exact `agentSlotId`. A suspend/retire request immediately removes the slot from new task dispatch and blocks new leases or capabilities. If the page is still generating, existing authority is retained only for the drain; when Browser Plane reports the tab absent, the Kernel releases the slot leases, revokes bound capabilities, increments the slot epoch, and leaves old tokens revoked even after a later resume.

Workers may instead raise durable requests to the Supervisor with types including `suggestion`, `blocker`, `question`, `resource-request`, `scope-change`, `dependency-request`, `cross-system-request`, `review-request`, and `risk-alert`. A request is advisory: submitting it never changes fleet or project state. The Supervisor explicitly accepts or rejects it, performs any authorized action, and then resolves it. Open requests are visible in the Local Control Plane panel and, when exactly one active AgentSlot uses the reserved `SUPERVISOR` role, are deterministically mirrored into that Supervisor conversation through the existing duplicate-fenced Semantic Message Bus.

This preserves the core rule: **maximize worker autonomy while minimizing worker authority**. Workers can identify problems and propose organizational changes; the Supervisor decides; the Kernel enforces the resulting transition.
