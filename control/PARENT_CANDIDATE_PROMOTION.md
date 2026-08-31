# Parent/Candidate Promotion Authority

Self-hosting promotion is a durable Kernel authority, not a Supervisor prose convention. A promotion request binds one verified claim, that claim's exact candidate commit SHA, the exact expected Parent SHA, and one concrete `refs/heads/*` target.

The candidate author cannot approve or apply its own promotion. Promotion approval and application require a task-independent capability owned by an independent promotion authority; a task-bound worker capability is rejected even if it carries a promotion scope.

Approval and rejection are persisted before any promotion attempt. Rejection is terminal and preserves the Candidate commit and verified evidence unchanged. No reject path deletes, rewinds, or cleans the Candidate.

Approved promotion uses Git `update-ref <target> <candidate> <expected-parent>` compare-and-swap. Parent drift therefore fails closed. If Git reaches the exact approved Candidate SHA and the process crashes before SQLite finalization, replay observes that exact ref and converges the durable promotion record to `promoted` without repeating a destructive operation.

Tests cover exact-SHA evidence binding, self-approval rejection, task-bound authority rejection, request/decision/apply replay, crash convergence, parent drift, reject-preserve semantics, and the schema migration that introduces durable promotion records.
