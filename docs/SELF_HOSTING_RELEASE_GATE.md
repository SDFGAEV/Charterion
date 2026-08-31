# Self-Hosting Release Gate

`npm run smoke:self-hosting` is the process-level release gate for recursive Parent/Candidate engineering.

The smoke launches two real `gamd` processes with distinct `GAM_HOME`, database, browser-token, instance, and pipe identities. Candidate control state must remain absent from the Parent runtime.

It then drives the Candidate daemon through the real RPC boundary to create a project and AgentSlot, seed a verified-claim work task through browser authority, provision a durable TaskWorkspace, commit work from the exact assigned base, submit a scoped claim, and verify that claim with the workspace capability.

Promotion is tested as Kernel authority rather than prose convention:

- the promotion request must bind the verified claim's exact candidate SHA and exact expected Parent SHA;
- a mismatched candidate SHA is rejected;
- the candidate author cannot approve its own promotion;
- a task-bound capability cannot act as promotion authority;
- an independent, task-free authority may approve and apply the exact candidate with Git compare-and-swap;
- Parent drift fails closed while preserving the approved Candidate;
- rejection preserves the Candidate commit and verified evidence and cannot later be applied.

The gate emits only non-secret evidence identifiers and SHAs. Temporary homes, tokens, repositories, and worktrees are deleted after the run.

`verify:full` includes this smoke so release certification cannot omit the recursive self-hosting authority path.
