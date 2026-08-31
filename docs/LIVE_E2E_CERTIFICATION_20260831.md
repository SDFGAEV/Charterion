# Live E2E Certification — 2026-08-31

This record certifies the authenticated ChatGPT browser path after the v0.5.0 browser-authority hardening pass.

## Scope

- Branch: `fix/runtime-instance-identity`
- Dedicated GAM browser profile only; existing user ChatGPT tabs were treated as protected and were not selected for test dispatch.
- Test work used isolated temporary ProjectCells and AgentSlots.
- Probe instruction: `Reply exactly GAM_E2E_OK and nothing else.`

## Live delivery evidence

Final canonical task: `8f88f1fc-4fcb-4f26-901d-f2dc829de5ec`.

Observed browser attempt lifecycle reached `prepared -> dispatched -> acknowledged -> reply-observed`; the task reached `completed` and the observed reply was exactly `GAM_E2E_OK`.

During the canonicalization probe the page temporarily navigated to `https://chatgpt.com/c/WEB:07395bb8-c58b-4fd9-9e52-509623ab2fc4`. At that point the Kernel AgentSlot still had `conversationKey = null`, proving the provisional `WEB:*` identity was not persisted as durable authority.

The final ChatGPT URL became `https://chatgpt.com/c/6a947802-5cc4-83ec-8aa5-7eac0f1ec927`. After Fleet reconciliation the Kernel stored exactly `conversation:6a947802-5cc4-83ec-8aa5-7eac0f1ec927`.

## Fleet continuity evidence

The canonical worker initially owned tab `1839218540`. Closing only that E2E tab produced `open -> absent -> opening -> open` and exactly one replacement tab, `1839218545`.

The replacement resumed directly at the canonical `/c/6a947802-5cc4-83ec-8aa5-7eac0f1ec927` URL, retained the same Kernel conversation identity, and became `idle`.

ChatGPT page count was `14 -> 13 -> 14`; `maxPages=14`, so recovery was one-for-one with no expansion storm. All 13 non-test ChatGPT tabs present at the start of the resume probe were still present at completion.

## Kernel authority and release gates

The Kernel independently rejects provisional conversation identities such as `conversation:WEB:*` and `conversation:new`; durable conversation authority therefore does not depend on browser-side filtering alone.

Final release verification passed with 37 test files / 166 tests, plus 6 fault-suite files / 28 tests. TypeScript, Control typecheck, static assets, architecture hard-cut, dist fingerprint, Control, Evidence, Change Request, Fleet, Native Host, runtime-install, and launcher smoke gates all passed.

Final extension source fingerprint: `28441a1a8bae5153`.

Final release SHA256:
- `gpt-agent-manager-v0.5.0.zip`: `d26de703ecca56bb39b4790d8ca4ce52c5575044e7536a3509820a6bdb16a333`
- `gpt-agent-manager-v0.5.0-windows-runtime.zip`: `0a4fa0eac6b524b7ccdd7816bd7f74853f25169fe535f62c6e238e7bcf481631`
