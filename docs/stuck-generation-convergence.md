# Stuck-generation convergence policy

`src/stuckGenerationConvergence.ts` is a pure, side-effect-free policy boundary. It does not send prompts, stop generation, close tabs, release slots, or mutate Kernel state.

The policy combines four exact inputs before it can request intervention:

- GAM ownership of both the page assignment and the Kernel slot/resource lease;
- the exact task/slot identity plus an acknowledged prompt attempt;
- a direct page observation that remains `generating` at or after the stale deadline;
- absence of recent engineering-progress evidence for that same task and slot.

Anything unknown, inferred, non-GAM, mismatched, idle without cleanup proof, under-deadline, or based on an uncertain/non-acknowledged attempt fails closed as `hold`.

## Stop and cleanup are separate phases

A stale no-progress generation can only produce `request-authority-checked-stop`. The caller must validate current Kernel authority before performing any browser stop effect. The policy never emits a resend action, and every decision explicitly carries `allowPromptResend: false`.

After authority approves a stop, the authorization fact is fed back into a later policy evaluation. While the page still directly reports `generating`, the policy holds and waits. Cleanup is eligible only when a later direct `idle` observation is newer than the authorization and still matches the exact task, slot, resource, and lease epoch.

This sequencing prevents a stale stop/cleanup decision from crossing a lease handoff or treating uncertain prompt delivery as permission to retry.
