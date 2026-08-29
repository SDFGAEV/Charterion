# GPT Agent Manager

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](manifest.json)

GPT Agent Manager is a local-first Chrome extension for coordinating multiple **ChatGPT web conversations** as persistent, role-bound agents.

It is intentionally focused on `chatgpt.com`. It does not require the OpenAI API, does not call other AI providers, and does not require a local backend service.

> **Status:** active early development. Version 0.2.0 includes durable send attempts, reply correlation, a task DAG, and an opt-in automatic supervisor. It is not yet claimed to be production-ready.

## Why

Running several ChatGPT conversations in parallel works surprisingly well until the human becomes the message bus: switching tabs, remembering which chat owns which role, checking who is still generating, copying results, and deciding which worker can proceed next.

GPT Agent Manager moves that coordination into a small local control plane while keeping the actual agents as normal logged-in ChatGPT web conversations.

## Features

- Discover all open `chatgpt.com` tabs.
- Bind a stable **Role / Project / Notes** identity to each ChatGPT conversation.
- Detect `idle`, `generating`, `blocked`, `unauthorized`, `error`, `unknown`, and `unavailable` page states.
- Fail closed when the extension cannot prove that a page is safe to receive a prompt.
- Send an explicit one-off instruction to one or many selected ChatGPT tabs.
- Persist a send-attempt ledger with `prepared → dispatched → acknowledged → reply-observed` transitions.
- Mark transport failures as `uncertain` when the page may already have received the prompt.
- Fence duplicate delivery with per-attempt IDs inside the ChatGPT page session.
- Correlate replies using ChatGPT message/turn identity first and assistant-count baselines as fallback.
- Persist a project-independent task DAG with explicit role targets and dependencies.
- Derive task display state from task facts + send-attempt facts instead of persisting duplicate status fields.
- Dispatch only when exactly one idle ChatGPT tab matches the requested role/project.
- Enable an **opt-in Auto Supervisor** that automatically advances ready DAG tasks.
- Retry failed or uncertain tasks without deleting their prior attempt history.
- Run entirely locally with no API key and no hosted control server.

## Architecture

```text
┌──────────────────────────────┐
│        Side Panel UI         │
│ agents · tasks · supervisor  │
└──────────────┬───────────────┘
               │ typed messages
               ▼
┌──────────────────────────────┐
│   MV3 Extension Worker       │
│                              │
│ role bindings                │
│ task DAG                     │
│ send-attempt ledger          │
│ reply/task state derivation  │
│ fail-closed dispatcher       │
│ optional supervisor          │
└──────────────┬───────────────┘
               │ attempt-scoped commands
               ▼
┌──────────────────────────────┐
│ ChatGPT Content Script       │
│                              │
│ DOM observation              │
│ composer integration         │
│ delivery fence               │
│ reply baseline/correlation   │
└──────────────┬───────────────┘
               ▼
        chatgpt.com tabs
```

DOM selectors and ChatGPT-specific behavior remain isolated in `src/chatgptAdapter.ts`. Task orchestration never depends directly on page selectors.

## Task execution model

A task is a durable definition containing a title, target role, optional project, instruction, dependency IDs, and immutable send-attempt history.

Display states are derived:

| State | Meaning |
| --- | --- |
| `pending` | At least one dependency is still running or pending. |
| `ready` | Dependencies are complete and the task has no active attempt. |
| `running` | The latest attempt is prepared, dispatched, or acknowledged. |
| `completed` | A new assistant reply has been observed for the latest attempt. |
| `error` | The latest attempt failed with a known pre/post-delivery failure. |
| `attention` | Delivery outcome is uncertain and requires explicit handling. |
| `blocked` | A dependency ended in error/attention/blocked state. |

The dispatcher never chooses randomly between matching tabs. Zero matches and multiple matches are both non-dispatchable conditions.

## Auto Supervisor

Auto Supervisor is **off by default**.

When enabled, extension events can trigger another scheduling pass. A task is sent only when:

1. its derived status is `ready`;
2. every dependency is complete;
3. exactly one open ChatGPT tab matches its Role and optional Project;
4. that tab is directly observed as `idle`;
5. the tab has no unresolved `prepared`, `dispatched`, or `acknowledged` attempt;
6. the tab is not already claimed by another task in the same scheduling pass.

Reply observation completes the task and can make dependent tasks eligible on the next pass.

## Delivery and reply safety

Before a task prompt is sent, the service worker persists an attempt record. Task-linked attempts and the task's attempt history are written together in one `chrome.storage.local.set` operation.

Each attempt carries a unique ID. The content script keeps a page-session delivery fence so a repeated command with the same ID does not click **Send** twice.

A successful browser-message round trip is only an acknowledgement of delivery. Task completion requires a later assistant reply that is new relative to the pre-send baseline and is observed after ChatGPT returns to idle.

If the extension loses the browser-message channel after dispatch, it records `uncertain` instead of pretending the prompt definitely failed.

## Restart and recovery safety

The content script keeps a per-tab prompt baseline in `sessionStorage`, while the service worker keeps the durable attempt ledger in `chrome.storage.local`. A reply baseline is cleared only after the service worker confirms that `reply-observed` was durably persisted.

On service-worker restart:

- `prepared` attempts are failed safely because browser dispatch had not started;
- `dispatched` attempts require matching page evidence, otherwise they become `uncertain` and are never automatically resent;
- `acknowledged` attempts keep waiting only while the exact pending baseline survives on the same tab and conversation;
- lost or mismatched reply-correlation evidence becomes `uncertain`;
- an `uncertain` tab can be retried automatically only after the user records an explicit retry for that same task, and the content script still rejects the retry if an older pending prompt survives.

## Security and privacy

- Host permission is limited to `https://chatgpt.com/*`.
- Permissions are limited to `tabs`, `storage`, and `sidePanel`.
- No analytics or telemetry are included.
- No OpenAI API key is requested or stored.
- No hosted backend is required.
- Page observation alone never sends a prompt.
- Auto Supervisor must be explicitly enabled by the user.
- Unknown or ambiguous page/routing state fails closed.
- Manual send history stores metadata such as length and identity, not the manual prompt body.
- DAG task instructions are stored locally because they are durable task definitions.

## Repository layout

```text
gpt-agent-manager/
├─ src/
│  ├─ attempts.ts           # monotonic send-attempt state machine
│  ├─ background.ts         # persistence, dispatch and supervisor control plane
│  ├─ chatgptAdapter.ts     # ChatGPT DOM adapter
│  ├─ content.ts            # page observation, delivery fence and reply reporting
│  ├─ contracts.ts          # typed shared contracts
│  ├─ replyCorrelation.ts   # reply-baseline logic
│  ├─ recovery.ts           # restart reconciliation decisions
│  ├─ supervisor.ts         # pure dispatch planning
│  ├─ taskGraph.ts          # DAG validation and derived task state
│  ├─ sidepanel.ts          # UI behavior
│  ├─ sidepanel.html
│  └─ sidepanel.css
├─ tests/
├─ scripts/
│  ├─ build.mjs
│  └─ check-assets.mjs
├─ manifest.json
├─ package.json
├─ README.md
└─ LICENSE
```

Third-party research/reference repositories are kept outside this repository and are not vendored into the extension.

## Getting started

### Requirements

- Chrome 114 or newer with Side Panel support.
- Node.js 20 or newer.
- npm.

### Install

```bash
npm install
```

### Verify and build

```bash
npm run verify
```

`npm run verify` runs:

- strict TypeScript type checking;
- static extension-asset and permission checks;
- unit tests;
- the production extension build.

Generated assets are written to `dist/`.

### Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this repository root (the directory containing `manifest.json`).
5. Open one or more `chatgpt.com` conversations.
6. Click the extension action to open the side panel.
7. Assign unique Role names to the conversations you want to orchestrate.

## Development principles

1. Support ChatGPT web first; do not grow provider/API abstractions that the product does not need.
2. Persist facts and derive display state.
3. Prefer stable message/attempt identity over text hashes.
4. Separate observation from mutation.
5. Fail closed on unknown state and ambiguous routing.
6. Make automatic behavior opt-in and auditable.
7. Keep ChatGPT DOM details behind a narrow adapter.
8. Preserve failed/uncertain history instead of erasing it during retry.
9. Keep browser permissions minimal and regression-check them.
10. Reuse mature ideas/components where they fit instead of rebuilding entire external systems.

## Roadmap

- Visual DAG editing instead of entering dependency IDs manually.
- Task output snapshots/history in the control panel.
- Explicit cancel/skip and human-decision nodes.
- Review-node pass/fail contracts and bounded review loops.
- Export/import of roles, tasks, and supervisor state.
- Browser-level end-to-end tests against captured ChatGPT DOM fixtures.
- Recovery reconciliation for extension reloads and long-suspended tabs.
- Optional release packaging and Chrome Web Store publishing workflow.

## Scope

This repository is intentionally **not** a general multi-provider AI framework. Supporting Claude, Gemini, API agents, coding-agent CLIs, or hosted LLM backends is outside the current product scope.

## Contributing

Issues and pull requests are welcome. Keep changes focused and tested. Any change that expands browser permissions, automatic mutation, or persistent data should explain why it is necessary and how it fails safely.

## License

Licensed under the [MIT License](LICENSE).