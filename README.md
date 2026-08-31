# Charterion: Open-Source Multi-Agent Engineering Control Plane for ChatGPT Web Agents

[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Chromium](https://img.shields.io/badge/Chromium-Manifest%20V3-4285F4.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.4.1-2ea44f.svg)](manifest.json)
[![ChatGPT Web](https://img.shields.io/badge/target-ChatGPT%20Web-111111.svg)](https://chatgpt.com/)
[![Latest Release](https://img.shields.io/github/v/release/SDFGAEV/Charterion?display_name=tag)](https://github.com/SDFGAEV/Charterion/releases/latest)

<!-- readme-i18n:navigation:start -->
<p align="center"><strong>English</strong> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>
<!-- readme-i18n:navigation:end -->

**A local-first engineering control plane that turns multiple ChatGPT Web conversations into persistent, role-bound software-engineering agents.**

<!-- readme-section:overview -->
## Overview

Charterion coordinates multiple **ChatGPT Web conversations** as persistent engineering workers and backs them with a durable local control plane for projects, Git work, reviews, resources, and recovery.

The runtime keeps the existing `GAM`, `gamd`, and `gamctl` command names for compatibility, while **Charterion** is the public project name.

It is intentionally focused on `chatgpt.com`: no OpenAI API key, no hosted Charterion backend, and no attempt to replace ChatGPT Web with a provider API.

<!-- readme-section:architecture -->
## Architecture

Charterion has four runtime components:

- **Chrome/Edge Extension** — discovers `chatgpt.com` tabs, binds Role/Project identity, routes prompts, observes replies, and renders the Side Panel.

- **`gamd`** — the deterministic local Kernel. It owns SQLite authority, projects, leases, capabilities, evidence, Change Requests, Supervisor reviews, fleet state, and merge-queue state.

- **Native Messaging Host** — a narrow Chromium ↔ `gamd` bridge over a Windows named pipe. It never receives the administrator token.

- **`GAM` / `gamctl`** — human- and machine-facing launch/control clients.

```text
Human operator / Remote agent
             |
       GAM / gamctl
             |
           gamd
   SQLite · Git · leases
 evidence · reviews · fleet
             |
 Native Messaging Host
             |
      Chromium Extension
             |
     ChatGPT Web tabs
```

<!-- readme-section:operation -->
## Human and agent operation

Human operators can launch the dedicated Chromium runtime with `GAM.cmd`. Authorized remote agents can use the same Kernel through deterministic JSON/CLI commands instead of scraping the UI.

Charterion does not store ChatGPT passwords, MFA secrets, cookies, or account tokens. The user signs in directly on the official ChatGPT page inside the dedicated browser profile.

```powershell
GAM.cmd
GAM.cmd status --json
GAM.cmd start --json
GAM.cmd open "My Project" --json
GAM.cmd doctor --json
```

<!-- readme-section:git-workflow -->
## Git and Change Request workflow

For software projects, a model reply is not engineering completion. Work is tied to Git and machine evidence, then reviewed by an independent Supervisor before integration.

Important invariants include exact `baseSha`/`headSha` binding, no self-approval, review invalidation after a new head, machine-evidence checks before queueing, conflict detection against the latest target branch, and independent observation of integration in Git history.

```text
Task
  -> Worker branch/worktree
  -> commit
  -> machine evidence
  -> Change Request
  -> Supervisor review
  -> merge queue
  -> observed integration
```

<!-- readme-section:browser-orchestration -->
## Browser orchestration

The browser plane provides persistent Role/Project bindings, task DAG routing, `work`/`review`/`human` task kinds, durable Skip/Cancel/Retry facts, bounded review loops, a semantic message bus, send-attempt recovery, fail-closed handling of ambiguous delivery, portable browser state, and an opt-in Auto Supervisor.

Supervisor-managed `AgentSlot` desired state is separate from browser observation. Workers can be spawned, suspended, resumed, or retired through scoped authority; draining workers stop receiving new work before their tabs are closed.

<!-- readme-section:control-plane -->
## Durable local control plane

The Kernel persists project, agent, resource, lease, capability, request, work-claim, evidence, review, merge-queue, and browser-runtime facts in SQLite.

SQLite uses foreign keys, WAL mode, strict tables, and transactional state changes. Lease epochs and scoped capabilities fence stale workers. Objective machine facts are verified deterministically; architecture and engineering quality remain Supervisor judgments.

<!-- readme-section:quick-start -->
## Quick start

Current deployment targets Windows 10/11 with Node.js 22+, Chrome or Edge, and .NET 9 when building the Native Host from source.

From a source checkout:

```powershell
npm install
npm run verify:full
npm run setup:windows
```

From a packaged Windows runtime, extract the archive and run `SETUP.cmd`.

<!-- readme-section:security -->
## Security boundaries

- Extension host permission is restricted to `https://chatgpt.com/*`.

- The Native Host uses a narrow allowlist and never receives the GAM administrator token.

- Worker capabilities are scoped to project/task/resource/lease identities and are stored by token hash.

- `gamctl` has no implicit administrator fallback.

- Unknown, stale, ambiguous, or conflicting authority fails closed.

Charterion is a coordination and policy layer, **not an operating-system sandbox**. Filesystem or terminal tools still need their own VM/container/capability boundary.

<!-- readme-section:verification -->
## Verification and release

The fast gate checks TypeScript, control-plane types, static assets, README-language invariants, tests, and builds. The full gate adds Native Host publishing and process-level smoke tests.

Release artifacts are emitted with SHA-256 sidecars.

```powershell
npm run verify
npm run verify:full
npm run release
```

<!-- readme-section:development -->
## Development principles

1. ChatGPT Web conversations are the cognition plane; do not silently substitute provider APIs.

2. Git and durable machine observations are engineering facts; model prose is a claim or explanation.

3. Give workers broad decision freedom inside narrow, explicit authority.

4. Supervisors perform engineering judgment; deterministic code enforces invariant policy.

5. Persist facts and derive status; fence stale attempts with identities and epochs.

6. Fail closed when delivery, identity, ownership, or integration state is uncertain.

<!-- readme-section:scope -->
## Scope

Charterion currently targets **ChatGPT Web on `chatgpt.com`**. Generic LLM APIs, hosted orchestration, Claude/Gemini integrations, and coding-agent CLI providers are outside the current product scope.

<!-- readme-section:license -->
## License

Licensed under [Apache-2.0](LICENSE). See [NOTICE](NOTICE) and [Third-Party Notices](THIRD_PARTY_NOTICES.md).

<!-- readme-section:status -->
## Development status

Charterion is under active development. The default branch currently represents the v0.4.1 capability set; newer experimental capabilities are not documented here until they are formally integrated.
