# Charterion: Open-Source Multi-Agent Engineering Control Plane for ChatGPT Web Agents

[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Chromium](https://img.shields.io/badge/Chromium-Manifest%20V3-4285F4.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.5.0-2ea44f.svg)](manifest.json)
[![ChatGPT Web](https://img.shields.io/badge/target-ChatGPT%20Web-111111.svg)](https://chatgpt.com/)
[![Latest Release](https://img.shields.io/github/v/release/SDFGAEV/Charterion?display_name=tag)](https://github.com/SDFGAEV/Charterion/releases/latest)

<!-- readme-i18n:navigation:start -->
<p align="center"><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>
<!-- readme-i18n:navigation:end -->

**A local-first engineering control plane that turns multiple ChatGPT Web conversations into a durable, role-based Agent organization.**

> GAM coordinates ChatGPT Web. It does not replace ChatGPT with an API provider, does not store account credentials, and does not treat model prose as engineering authority.

---

<!-- readme-section:overview -->
## Overview

Charterion manages multiple ChatGPT Web conversations as persistent engineering workers backed by a local deterministic Kernel. Browser tabs are disposable runtime surfaces; Agent identity, projects, Git work, leases, capabilities, evidence, reviews, and recovery state are durable.

GAM is designed to behave more like a small software company than a tab automator: independent workers operate in isolated scopes, Supervisors review exact evidence, and the Kernel enforces authority boundaries.

<!-- readme-section:capabilities -->
## Highlights

- **Persistent Agent identity** — `AgentSlot` identity is independent from browser tab IDs and individual ChatGPT conversations.
- **Project isolation** — `ProjectCell`, Git worktrees, leases, epochs, and scoped capabilities keep concurrent work separated.
- **Company governance** — every task receives a versioned Company System Policy plus a deterministic Role Charter before the task brief.
- **Typed completion authority** — `structured-result`, `verified-claim`, `review-pass`, and `human-approval` separate evidence from prose.
- **Machine-verifiable software work** — exact commit SHA, assigned branch/worktree, lease identity, and evidence are checked before completion.
- **Supervisor review boundaries** — workers cannot self-approve; review authority is independent from implementation authority.
- **Parallel work with backpressure** — independent tasks may run concurrently while account-level prompt pacing limits burst rate.
- **Elastic browser fleet** — excess trusted-idle worker tabs can suspend and close without deleting conversations or durable Agent state.
- **Crash convergence** — retries, uncertain sends, worktree cleanup, leases, and capability fencing are designed to fail closed and converge after interruption.
- **Recursive self-hosting** — a stable Parent GAM can develop an isolated Candidate GAM and gate promotion on exact evidence.

<!-- readme-section:architecture -->
## Architecture

```text
Human / Remote Operator
          │
          ▼
 Side Panel · GAM.cmd · gamctl
          │
          ▼
        gamd
   Deterministic Kernel
          │
  SQLite · Git · leases
 capabilities · evidence
 reviews · promotion state
          │
          ▼
Native Messaging Bridge
          │
          ▼
ChatGPT Web Agent Fleet
```

<!-- readme-section:core-concepts -->
## Core concepts

| Concept | Responsibility |
| --- | --- |
| `ProjectCell` | Durable project/team boundary, capacity policy, repository root |
| `AgentSlot` | Persistent worker identity and lifecycle |
| `AgentConversationRecord` | Durable mapping between an Agent and a ChatGPT conversation generation |
| Task | Typed unit of work with dependencies and completion authority |
| Task workspace | Isolated Git worktree, branch, lease, capability, and base SHA |
| `WorkClaim` | Machine-verifiable completion claim bound to exact evidence |
| Supervisor | Independent review/integration authority |
| GAM Kernel | Deterministic owner of durable state and authorization |

<!-- readme-section:organization -->
## Company-style Agent management

Every dispatched task is composed in this order:

```text
Company System Policy
        ↓
Role Charter
        ↓
Task Brief
        ↓
Revision / Dependency Evidence
        ↓
Managed Workspace + Completion Protocol
```

The organization policy requires decoupled architecture, typed contracts, durable authority, least privilege, isolated parallel worktrees, crash convergence, objective tests/evidence, explicit ownership, documentation, and Git discipline. Task text or dependency output cannot widen the Agent's authority.

Typical roles include **Architect**, **Implementer**, **Tester**, **Supervisor**, **Researcher**, and **Operator**. See [`docs/company-governance.md`](docs/company-governance.md).

<!-- readme-section:completion -->
## Task and completion model

GAM does not equate “the assistant replied” with “the work is done.”

- `structured-result` requires one strict terminal `<GAM_RESULT>` JSON block; placeholders such as `Read`, `OK`, or `acknowledged` remain attention states.
- `verified-claim` requires a Kernel-provisioned workspace, committed exact HEAD SHA, scoped claim submission, and Kernel verification.
- `review-pass` requires a valid review protocol and does not treat failed or malformed review output as terminal success.
- `human-approval` remains explicitly human-controlled.

For software tasks, the normal authority chain is:

```text
Task → isolated worktree → commit → WorkClaim → machine verification
     → independent review → integration/promotion authority
```

<!-- readme-section:parallelism -->
## Parallelism and prompt pacing

DAG edges represent **real dependencies**, not artificial throttling. Independent work can run in parallel across different AgentSlots and worktrees.

Before a physical prompt reaches the ChatGPT composer, the persistent dispatch governor applies account-level pacing: global spacing, rolling-window budget, Project/AgentSlot spacing, concurrent-generation capacity, and persisted exponential backoff after visible rate-limit signals. Ambiguous delivery never causes an automatic duplicate resend.

The exact-task dispatch module provides a fail-closed typed planner for selecting one requested ready task without selecting unrelated ready tasks. It remains subject to the standard prompt governor and workspace authority.

<!-- readme-section:browser-lifecycle -->
## Browser lifecycle and recovery

Browser pages are execution leases, not durable worker identity. GAM can suspend and close excess trusted-idle worker tabs while preserving AgentSlot identity, canonical conversation history, checkpoints, evidence, and Git history. New demand can resume the durable worker instead of silently creating a duplicate identity.

Generating, unknown/unavailable, quarantined, rollover-active, or effect-active pages fail closed and remain open. The stuck-generation convergence module combines GAM-owned page/slot facts, attempt state, stale deadlines, and recent engineering-progress evidence; it never authorizes an uncertain prompt to be automatically resent. Authority-checked stop and later cleanup require explicit convergence evidence.

<!-- readme-section:self-hosting -->
## Recursive self-hosting

GAM supports the architecture for a **Parent → isolated Candidate → evidence-gated promotion** cycle.

Parent and Candidate runtime identities must remain distinct across repository, `GAM_HOME`, SQLite database, named pipe, and browser profile. Promotion authority is durable and independent: a Candidate cannot approve itself, exact candidate/parent SHA evidence is required, rejected candidates are preserved for inspection, and replay/crash boundaries are tested for convergence.

<!-- readme-section:quick-start -->
## Quick start

#### Requirements

- Windows 10/11 for the current Native Messaging deployment path
- Node.js 22+
- Chrome or Microsoft Edge (Chromium)
- .NET 9 SDK/runtime only when building the Native Host from source

#### Build and verify

```powershell
npm install
npm run verify:full
npm run setup:windows
```

#### Runtime commands

```powershell
GAM.cmd status --json
GAM.cmd start --json
GAM.cmd open "My Project" --json
GAM.cmd doctor --json
```

`GAM.cmd` keeps a dedicated Chromium profile under `GAM_HOME`, starts the local Kernel idempotently, and never needs an OpenAI API key. The user signs in directly on the official `chatgpt.com` page; GAM does not store passwords, MFA secrets, cookies, or account tokens.

For the complete local, source, release, and Remote Desktop Commander deployment procedure, see [Deployment Guide](https://github.com/SDFGAEV/Charterion/blob/main/docs/DEPLOYMENT.md).

<!-- readme-section:security -->
## Security boundaries

- Host permission is limited to `https://chatgpt.com/*`.
- Native Messaging is restricted to the pinned extension origin.
- The Native Host never holds the GAM admin token.
- Worker capabilities are scoped by project/task/resource/lease and persisted only by token hash.
- `gamctl` has no implicit admin fallback; privileged operations require explicit `--admin`.
- Unknown, stale, ambiguous, or conflicting authority fails closed.
- Candidate self-promotion is rejected.
- GAM is a coordination and policy layer, **not an OS sandbox**; filesystem/terminal tools still require appropriate host/container isolation.

<!-- readme-section:development -->
## Development

```powershell
npm run check
npm run check:control
npm run check:architecture
npm test
npm run test:faults
npm run verify
npm run verify:full
```

<!-- readme-section:repository-layout -->
## Repository layout

```text
src/            Browser extension runtime and typed policies
control/        Deterministic Kernel, SQLite authority, RPC, leases, evidence
native-host/    Chromium Native Messaging bridge
scripts/        Build, verification, packaging, smoke, and Windows setup tools
tests/          Browser/runtime/unit/fault tests
docs/           Architecture and operational documentation
```

<!-- readme-section:contributing -->
## Contributing

Changes should preserve the project’s core engineering rules: explicit ownership, typed boundaries, durable facts, least privilege, isolated Git work, objective tests, documentation, and independent review. Do not widen browser/native permissions or bypass evidence gates merely for convenience.

For substantial changes, prefer a focused worktree/branch, add targeted tests, run the relevant wider gates, and record the exact commit used for review.

<!-- readme-section:scope -->
## Scope

GAM currently targets **ChatGPT Web on `chatgpt.com`**. Generic LLM APIs, hosted orchestration, Claude/Gemini integrations, and coding-agent CLI providers are outside the current product scope.

<!-- readme-section:license -->
## License

Licensed under [Apache-2.0](LICENSE). See [NOTICE](NOTICE) and [Third-Party Notices](THIRD_PARTY_NOTICES.md). The English `LICENSE` file is authoritative.

---

<!-- readme-section:status -->
## Development status

Charterion is under active development. Release candidates must pass the repository verification suite, README i18n release gate, and evidence-based review/promotion boundaries before they are treated as stable.
