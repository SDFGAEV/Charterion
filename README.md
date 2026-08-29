# GPT Agent Manager

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4)](manifest.json)

GPT Agent Manager is a local-first Chrome side panel for coordinating multiple open ChatGPT conversations as explicit agents, roles, and projects.

It is designed for workflows where several `chatgpt.com` tabs run in parallel and an operator needs one place to inspect status, label workers, send the same instruction to selected conversations, collect recent outputs, and jump directly to a worker tab.

> **Status:** early development. The first usable extension slice is implemented and tested, but the project does not yet claim production readiness.

## Current features

- Discover all open `chatgpt.com` tabs.
- Detect `idle`, `generating`, and `unavailable` page states.
- Persist Role / Project / Notes bindings for stable ChatGPT conversation IDs.
- Keep temporary bindings session-scoped until a new chat receives a durable conversation ID.
- Select one or many agents and send an explicit operator-entered instruction.
- Select all currently idle agents with one action.
- Display the latest assistant response from every managed conversation.
- Focus any managed ChatGPT tab from the side panel.
- Refresh automatically when a managed ChatGPT page changes.
- Run entirely locally with no required backend and no API key.
## Architecture

```text
Side Panel UI
    |
    v
Extension Service Worker
    |
    +---- tab discovery / role bindings / explicit fan-out
    |
    v
ChatGPT Content Script
    |
    +---- conversation identity
    +---- DOM observation
    +---- composer adapter
    +---- latest-response extraction
```

The extension deliberately separates observation, persistence, mutation, and presentation. DOM selectors stay inside the ChatGPT adapter instead of leaking into orchestration state.

## Security and privacy

- No hosted control server is required.
- No analytics or telemetry are included.
- Host permission is limited to `https://chatgpt.com/*`.
- The extension requests only `tabs`, `storage`, and `sidePanel` permissions.
- Detecting page changes never sends a prompt.
- Multi-tab sends happen only after an explicit operator action.
- If the known ChatGPT composer cannot be identified safely, the adapter fails closed.
## Repository layout

```text
gpt-agent-manager/
├─ src/
│  ├─ background.ts       # service worker and multi-tab control plane
│  ├─ chatgptAdapter.ts   # ChatGPT-specific DOM integration
│  ├─ content.ts          # page observation and explicit send execution
│  ├─ contracts.ts        # shared typed message/state contracts
│  ├─ sidepanel.ts        # operator UI behavior
│  ├─ sidepanel.html
│  └─ sidepanel.css
├─ tests/                 # focused adapter regression tests
├─ scripts/build.mjs      # extension build
├─ manifest.json
├─ package.json
├─ README.md
└─ LICENSE
```

Third-party reference repositories are intentionally kept outside this repository.

## Getting started

### Requirements

- Chrome 114 or newer with Side Panel support.
- Node.js 20 or newer.
- npm.
### Install dependencies

```bash
npm install
```

### Verify and build

```bash
npm run verify
```

`npm run verify` runs the strict TypeScript check, the unit test suite, and the extension build. Generated assets are written to `dist/`.

### Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this repository root, the directory containing `manifest.json`.
5. Open one or more `chatgpt.com` conversations.
6. Click the extension action to open the GPT Agent Manager side panel.

No remote service or OpenAI API key is required.
## Development principles

1. Prefer typed contracts over ad-hoc browser messages.
2. Keep provider/DOM details behind adapters.
3. Separate observation from mutation.
4. Persist durable facts; derive display state from current observations.
5. Treat browser selectors as unstable integration points and regression-test them.
6. Fail closed on ambiguous execution state.
7. Reuse mature upstream components where they fit instead of duplicating them.

## Roadmap

- Durable task and dependency graph independent of any one project.
- Structured agent-to-agent messages routed through a supervisor.
- Optional Git/worktree/PR/CI adapters.
- Auditable send history and idempotent command IDs.
- Pluggable browser adapters beyond ChatGPT.
- Recovery-aware orchestration and explicit human decision queues.
- Optional local supervisor daemon while keeping the browser extension usable standalone.

## Contributing

Issues and pull requests are welcome. Keep changes focused and tested, and explain any new browser permission or external service dependency.

## License

Licensed under the [MIT License](LICENSE).
