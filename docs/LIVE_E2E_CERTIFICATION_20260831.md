# Live E2E Certification — 2026-08-31

This record certifies the authenticated ChatGPT browser path after the v0.5.0 browser-authority and persistent-conversation rollover hardening passes.

## Scope

- Branch: `fix/runtime-instance-identity`
- Dedicated GAM browser profile only; existing user ChatGPT tabs were treated as protected and were not selected for test dispatch.
- Test work used isolated temporary ProjectCells and AgentSlots.
- No cookie, token, password, MFA, or ChatGPT account secret was read or copied.

## Canonical delivery and Fleet continuity evidence

Canonical task `8f88f1fc-4fcb-4f26-901d-f2dc829de5ec` reached `prepared -> dispatched -> acknowledged -> reply-observed`; the task reached `completed` and the observed reply was exactly `GAM_E2E_OK`.

During that probe ChatGPT temporarily used `/c/WEB:07395bb8-c58b-4fd9-9e52-509623ab2fc4`; the Kernel retained no durable conversation key until the final canonical URL `https://chatgpt.com/c/6a947802-5cc4-83ec-8aa5-7eac0f1ec927` existed. Fleet then stored exactly `conversation:6a947802-5cc4-83ec-8aa5-7eac0f1ec927`.

The worker initially owned tab `1839218540`. Closing only that E2E tab produced `open -> absent -> opening -> open` and exactly one replacement tab, `1839218545`, which resumed directly at the canonical conversation and became idle. Page count was `14 -> 13 -> 14`, with no expansion storm and no non-test page removal.

## Persistent Worker conversation rollover E2E

Final rollover ProjectCell: `c6b82dbc-6c1d-4ea5-a03d-3e13ef885c90` (`GAM Rollover Final E2E 20260831`).
Final persistent AgentSlot: `a43a8c81-5ae1-435b-8256-895c913a5597` (`ROLE_E2E_ROLLOVER_FINAL_20260831`).
Generation 1 task `55f1e533-a475-46b9-a3e9-dfd212ed1bfb` used attempt `3cc4f256-4d13-4dd9-820e-478862e421e9` on tab `1839218563`. It reached durable `reply-observed` with the exact real ChatGPT reply `ROLLOVER_FINAL_GEN1_OK`. The canonical generation-1 conversation was `conversation:6a94dd7c-0f90-83ec-805b-1350f3f559fb`.

A formal rollover request was then submitted through Extension -> Native Host -> Kernel, not by directly mutating the database. Rollover ID: `1b64d0d5-1678-4d15-ade2-213af1fae8a3`; checkpoint ID: `613a6ecd-1146-48cb-ac88-7bddda4b3776`; requested transition: generation 1 -> 2.

Fleet automatically consumed the request, closed/replaced the old worker page, opened tab `1839218565`, canonicalized generation 2 to `conversation:6a94de56-ffa8-83ec-b317-59bc2b660ada`, and preserved the same AgentSlot identity. No manual rollover begin/bootstrap/complete operation was issued.

Bootstrap attempt `b0f069e9-2133-44ca-b70f-59633747bbc3` produced the exact real reply `GAM_ROLLOVER_READY`, reached durable `reply-observed`, and the Kernel automatically returned the AgentSlot to `rolloverState=idle` at generation 2.

Generation 2 then accepted ordinary work. Task `c1ce8cd7-0ed0-4cdd-b381-2d8a29382eeb`, attempt `e401ac16-57ea-4654-9c14-5b554ef89206`, reached durable `reply-observed` with exact real reply `ROLLOVER_FINAL_GEN2_OK` on the same generation-2 canonical conversation.

An earlier diagnostic rollover was deliberately recorded as failed rather than promoted to certification when ChatGPT retained a stop/streaming UI after returning the marker. That run exposed two real integration gaps which were fixed before the final E2E: the Native Host rollover RPC allowlist and restart recovery across root-URL -> canonical-conversation navigation.

## Rollover authority and recovery hardening

- Kernel schema persists conversation lineage, checkpoints, rollover state, generation, and active rollover identity.
- Kernel rejects provisional identities including `conversation:WEB:*` and `conversation:new`.
- Fleet performs ownership-before-navigation and fail-closed replacement/reconciliation.
- Native Host exposes only the exact rollover RPC methods required by the browser path; the architecture gate now fails if that allowlist drifts.
- Restart recovery accepts root-URL -> canonical-conversation identity evolution only when the same tab/content epoch is backed by Kernel authoritative conversation ownership.
- The dedicated bootstrap marker `GAM_ROLLOVER_READY` is valid only with a new assistant count/message identity and the expected rollover handshake; ordinary tasks still require normal idle/reply correlation.

## Final release gates

`npm run release` completed with exit code 0.

- TypeScript: pass.
- Control typecheck: pass.
- Static extension assets/permissions: pass.
- Architecture hard-cut: pass (`30` src files; `background.ts` = `950` lines).
- Main tests: `38` files / `176` tests passed.
- Fault suite: `6` files / `29` tests passed.
- Extension source/dist fingerprint: `1d8f24852d62e8a9` (`5` dist files).
- Control smoke: pass, protocol version `2`.
- Evidence smoke: verified evidence `passed`; tampered evidence `failed`.
- Change Request, Fleet, Native Host, runtime-install, and launcher smoke gates: pass.
- Native Host security smoke retained `mutationBlocked=true` and `originBlocked=true`.
- Runtime-install smoke: `doctorStatus=ready`, `chromeAvailable=true`, self-contained Native Host size `70923701` bytes.

Final release SHA256 generated by the release pipeline:
- `charterion-v0.5.0.zip`: `1e3c31063e174a8205029e56bd028e3ee8c9242ee7c93cf0b54a1d8034f75381`
- `charterion-v0.5.0-windows-runtime.zip`: `830a8d629b748efc8f9f65da5d22910aceb6735dbef45d8534e4283eca99a727`
