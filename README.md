# GPT Agent Manager

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

GPT Agent Manager is a local-first control surface for coordinating multiple ChatGPT conversations as explicit workers, roles, and projects.

The project is designed for workflows where several ChatGPT tabs are used in parallel and a human operator needs one place to see status, send instructions, collect results, and keep role ownership clear.

> Status: early development. The repository is being built in small, reviewable slices and does not yet claim production readiness.

## Goals

- Discover and organize open `chatgpt.com` conversations.
- Assign stable role names, project groups, and operator notes.
- Show whether each conversation is idle, generating, waiting for input, or unavailable.
- Send an instruction to one or more selected conversations through an explicit user action.
- Provide fast actions such as `Continue` without hiding what will be sent.
- Collect the latest assistant output for supervisor review.
- Keep state local by default and avoid introducing a required backend service.
- Minimize browser permissions and avoid collecting analytics or conversation data.

## Non-goals

- Circumventing ChatGPT limits, rate limits, authentication, or product safeguards.
- Running hidden or autonomous browser actions without user-visible controls.
- Reading unrelated websites, credentials, passwords, or browser data.
- Replacing a durable project control plane when a repository already has one.

## Architecture

The initial architecture targets a Chrome-compatible Manifest V3 extension:

```text
Side Panel UI
    |
    v
Extension Service Worker
    |
    +---- chrome.tabs / chrome.storage
    |
    v
ChatGPT Content Script
    |
    +---- conversation identity
    +---- composer interaction
    +---- generation-state observation
    +---- latest-response extraction
```

The extension is intentionally split into small boundaries so DOM adaptation, orchestration state, and UI rendering can evolve independently.

## Security and privacy

The default design is local-first:

- No hosted control server is required.
- Role mappings and UI state are stored locally in the browser.
- Host access is limited to ChatGPT pages needed for the manager to function.
- Conversation content is not sent to third-party analytics services.
- Batch sends are explicit user actions rather than background automation.

## Planned repository layout

```text
gpt-agent-manager/
├─ src/
│  ├─ background/      # service-worker orchestration
│  ├─ content/         # ChatGPT page adapter
│  ├─ sidepanel/       # operator dashboard
│  ├─ contracts/       # typed shared messages and state
│  └─ storage/         # local persistence boundary
├─ tests/
├─ docs/
├─ manifest.json
├─ README.md
└─ LICENSE
```

## Development principles

1. Prefer typed contracts over ad-hoc message payloads.
2. Keep browser/DOM details behind adapters.
3. Separate observation from mutation: detecting state must not send prompts.
4. Make all multi-tab mutations deliberate and auditable.
5. Treat DOM selectors as unstable integration points and cover them with focused tests.
6. Fail closed when a page cannot be identified safely.
7. Keep third-party reference source outside this repository.

## Getting started

Implementation is not yet published in the initial repository commit. As source lands, this section will contain reproducible build, test, and Chrome `Load unpacked` instructions.

## Contributing

Issues and pull requests are welcome once the first implementation slice is published. Please keep changes focused, tested, and explicit about any new browser permission they require.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
