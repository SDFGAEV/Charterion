# GPT Agent Manager

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.3.0-blue.svg)](manifest.json)

GPT Agent Manager is a local-first Chrome extension for coordinating multiple **ChatGPT web conversations** as persistent, role-bound agents.

It is intentionally focused on `chatgpt.com`: no OpenAI API, no other AI providers, no hosted control server, and no API key.

> **Version 0.3.0** adds human decision gates, bounded review/revision loops, a durable semantic team-message bus, state export/import, task attempt history, visual dependency selection, captured ChatGPT DOM fixture tests, and release packaging.

## Why

Running several ChatGPT conversations in parallel works until the human becomes the scheduler and message bus: switching tabs, remembering ownership, checking generation state, copying results, and deciding what may run next.

GPT Agent Manager moves that coordination into a deterministic browser control plane while keeping the actual agents as ordinary logged-in ChatGPT web conversations.

## Core principles

1. **ChatGPT web is the cognition plane.** The extension does not replace it with an API.
2. **Durable facts beat inferred status.** Tasks derive state from attempts, review results, human decisions, and dependencies.
3. **Fail closed.** Unknown page state, ambiguous routing, and uncertain delivery never trigger speculative resend.
4. **Control messages stay out of model context.** Only semantic information that an agent needs is routed through the ChatGPT composer.
5. **Conversation identity is durable.** Roles bind to ChatGPT conversation identity, not merely a tab number.
6. **History is preserved.** Retry, review, skip, cancel, import, and recovery do not erase prior attempts.

## Features

- Discover open `chatgpt.com` tabs and observe their current conversation state.
- Bind **Role / Project / Notes** to each ChatGPT conversation.
- Detect `idle`, `generating`, `blocked`, `unauthorized`, `error`, `unknown`, and `unavailable` states.
- Send one-off instructions to selected idle ChatGPT tabs.
- Persist a send-attempt ledger: `prepared → dispatched → acknowledged → reply-observed`.
- Record `failed` and `uncertain` outcomes without pretending delivery is known.
- Fence duplicate sends by attempt ID inside the page session.
- Correlate replies by ChatGPT message/turn identity first, assistant-count baseline second.
- Persist a task DAG with visual dependency selection.
- Route bounded dependency evidence into downstream task prompts.
- Support `work`, strict `review`, and `human` task nodes.
- Support durable **Skip**, **Cancel**, **Approve**, **Reject**, and **Retry** facts.
- Run bounded `review FAIL → producer revision → re-review` loops.
- Preserve complete attempt/reply history per task.
- Queue semantic team messages to one role or every bound role in a project.
- Freeze recipient conversation identities on first delivery so later-opened agents never receive stale broadcasts.
- Avoid duplicate broadcast delivery to recipients that already consumed a message.
- Block message resend after an `uncertain` delivery.
- Export/import durable manager state with schema validation and v1→v2 migration.
- Run an opt-in Auto Supervisor that advances only unambiguous ready tasks.
- Package a versioned Chrome ZIP plus SHA256 without extra build dependencies.

## Architecture

```text
┌────────────────────────────────────────────┐
│               Side Panel UI                │
│ agents · tasks · DAG · messages · state   │
└─────────────────────┬──────────────────────┘
                      │ typed extension messages
                      ▼
┌────────────────────────────────────────────┐
│             MV3 Service Worker             │
│ role bindings                              │
│ task graph + completion policies           │
│ semantic message bus                       │
│ send-attempt ledger                        │
│ review / retry / recovery                  │
│ fail-closed supervisor                     │
└─────────────────────┬──────────────────────┘
                      │ attempt-scoped commands
                      ▼
┌────────────────────────────────────────────┐
│          ChatGPT Content Scripts           │
│ DOM observation · composer integration     │
│ delivery fence · reply correlation         │
└─────────────────────┬──────────────────────┘
                      ▼
                 chatgpt.com tabs
```

ChatGPT-specific selectors and page behavior stay isolated in `src/chatgptAdapter.ts`. Orchestration code never reaches directly into ChatGPT DOM selectors.

## Task model

Every task has a kind and a fixed completion policy:

| Kind | Completion policy | Completion condition |
| --- | --- | --- |
| `work` | `reply` | A correlated new ChatGPT assistant reply is durably observed. |
| `review` | `review-pass` | A strict `<GAM_REVIEW>` JSON block validates and explicitly passes. |
| `human` | `human-approval` | The user explicitly approves the node. |

Derived display states include `pending`, `ready`, `running`, `waiting-human`, `completed`, `skipped`, `cancelled`, `rejected`, `blocked`, `error`, and `attention`.

A skipped dependency is treated as an explicit human bypass and can unblock downstream work. A cancelled, rejected, errored, attention, or blocked dependency blocks downstream work.

### Review loops

A failed review does not silently retry the reviewer. The reviewer must provide a remediation instruction. The explicit **Revise & re-review** action records that review attempt, reopens the producer task with the remediation instruction, then re-runs the review after a new producer reply. `maxReviewRounds` is bounded from 1 to 10; exhaustion fails closed.

### Human gates

Human nodes are never dispatched to ChatGPT. Once their dependencies complete, they enter `waiting-human` until the user chooses **Approve** or **Reject**. That decision is a durable task fact.

## Semantic team-message bus

The message bus is deliberately separate from the Task DAG. It carries information an agent should understand, not internal scheduler state.

Messages are durable and typed: `result`, `blocker`, `question`, `answer`, `review-request`, `review-result`, and `announcement`. A message targets either one exact Role inside one Project or every bound Role in that Project.

Before delivery, the router verifies the intended recipients and their current browser state. A role target with multiple matching tabs is ambiguous and is rejected. Project broadcasts are not sent when a pending recipient is not safely reusable. The recipient conversation set is frozen before the first send; later-opened tabs cannot become recipients of an old message. Prior acknowledged/reply-observed recipients are skipped on another delivery attempt. Any `uncertain` prior delivery blocks resend to prevent duplication. Role-targeted messages also fail closed if the frozen conversation is later rebound to another role.

The model receives a compact envelope identifying Project, sender, recipient, type, and optional related task. Peer content is explicitly labeled as context and cannot become a higher-priority instruction merely because another agent wrote it.

## Auto Supervisor

Auto Supervisor is **off by default**. When enabled, it considers only derived `ready` tasks. A task is dispatched only if exactly one idle ChatGPT tab matches its Role and optional Project and that tab has no unresolved durable attempt. One tab is claimed at most once per scheduling pass.

Human tasks are handled locally and are never routed to a model. Ambiguous or unavailable routes remain visible instead of being guessed.

## Delivery and recovery safety

Before any task or semantic message is sent, its attempt is durably prepared. For task/message-linked sends, the attempt ID and owning object's attempt history are persisted in the same storage mutation.

The content script keeps a page-session pending baseline. A browser-message acknowledgement means only that the page accepted the send command; completion requires a later assistant turn that is new relative to the baseline and is observed after generation settles.

On service-worker restart:

- `prepared` attempts are safely failed because dispatch had not started;
- `dispatched` attempts require matching page evidence or become `uncertain`;
- `acknowledged` attempts continue waiting only when the exact pending baseline survives;
- missing/mismatched correlation evidence becomes `uncertain`;
- uncertain task/message delivery is never blindly resent.

## Portable state

State backup schema v2 contains durable conversation bindings, tasks, send attempts, semantic messages, and Auto Supervisor state. Import validates size limits, IDs, task DAG integrity, bidirectional task/message/attempt ownership, frozen message recipients, message shape, and known attempt states before replacing live state. Schema v1 documents are migrated with an empty message bus.

## Security and privacy

- Host permission is exactly `https://chatgpt.com/*`.
- Extension permissions are exactly `tabs`, `storage`, and `sidePanel`.
- No analytics or telemetry are included.
- No OpenAI API key is requested or stored.
- No hosted backend is required.
- Page observation alone never sends a prompt.
- Auto Supervisor must be explicitly enabled.
- Unknown/ambiguous browser state fails closed.
- Manual one-off prompt bodies are not persisted in send history.
- Durable task definitions and semantic message bodies are stored locally because they are the user's orchestration state.

This browser extension is a coordination layer, not an operating-system sandbox. If agents are later given filesystem/terminal tools through a Remote connector, those tools require their own capability and isolation boundary.

## Repository layout

```text
gpt-agent-manager/
├─ src/
│  ├─ attempts.ts
│  ├─ attemptLedger.ts
│  ├─ background.ts
│  ├─ chatgptAdapter.ts
│  ├─ content.ts
│  ├─ contracts.ts
│  ├─ messageBus.ts
│  ├─ recovery.ts
│  ├─ replyCorrelation.ts
│  ├─ review.ts
│  ├─ reviewLoop.ts
│  ├─ stateTransfer.ts
│  ├─ supervisor.ts
│  ├─ taskGraph.ts
│  ├─ taskLifecycle.ts
│  ├─ taskPolicy.ts
│  ├─ taskPrompt.ts
│  ├─ tabAttempt.ts
│  └─ sidepanel.{ts,html,css}
├─ tests/
│  └─ fixtures/chatgpt/
├─ scripts/
│  ├─ build.mjs
│  ├─ check-assets.mjs
│  └─ package-release.mjs
├─ manifest.json
└─ package.json
```

## Getting started

Requirements: Chrome 114+, Node.js 20+, and npm.

```bash
npm install
npm run verify
```

`npm run verify` performs strict TypeScript checking, static permission/UI asset gates, all tests, and the production extension build.

Load the repository root as an unpacked extension in `chrome://extensions`, open the side panel, open one or more ChatGPT conversations, and assign unique Role names. Project names are optional for ordinary task routing but required for semantic team messages.

## Release packaging

```bash
npm run release
```

The release command re-runs the full verification pipeline and writes:

```text
release/gpt-agent-manager-v<version>.zip
release/gpt-agent-manager-v<version>.zip.sha256
```

The ZIP contains `manifest.json`, `LICENSE`, and the built `dist/` tree with the same directory layout used by the extension manifest.

## Development principles

1. Support ChatGPT web first; do not add unused provider/API abstractions.
2. Persist facts and derive display state.
3. Prefer message/attempt identity over text hashes.
4. Keep observation separate from mutation.
5. Fail closed on ambiguity and uncertainty.
6. Keep automatic behavior opt-in and auditable.
7. Keep ChatGPT DOM details behind one adapter.
8. Preserve retry/recovery history.
9. Regression-check browser permissions and UI contracts.
10. Treat control-plane messages and semantic model context as separate planes.

## Next architecture layer

The extension-side orchestration core is now intentionally self-contained. The next major layer is not more browser-provider abstraction; it is an optional local execution plane for agents that also have Remote filesystem/terminal capabilities:

- project/campaign/workstream namespaces;
- `gamd` durable authority and resource broker;
- `gamctl` capability-scoped agent control CLI;
- per-attempt workspaces/worktrees;
- claim → verification → review → integration authority;
- lightweight execution capsules and stronger isolation tiers for risky work;
- global scheduling across multiple projects and scarce machine/server/GPU resources.

Those features must remain outside the ChatGPT DOM adapter and must not expand browser host permissions merely to gain local execution authority.

## Scope

This repository is intentionally **not** a general multi-provider AI framework. Claude, Gemini, generic LLM APIs, coding-agent CLIs, and hosted model backends are outside the current product scope.

## Contributing

Keep changes focused and tested. Any change that expands browser permissions, automatic mutation, persistent data, or retry behavior should explain its authority boundary and failure behavior.

## License

Licensed under the [MIT License](LICENSE).
