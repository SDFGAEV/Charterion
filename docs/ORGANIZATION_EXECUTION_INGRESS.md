# Organization Execution Ingress

Charterion keeps `Organization WorkItem` as the durable organizational authority. The browser execution plane receives only an idempotent `AgentTask` projection.

`org-work.project-execution` accepts exactly one `workItemId`. Browser or admin credentials may request projection, but the caller cannot choose the Agent, role, Project, Mission, prompt, or ownership.

The control plane resolves and validates all execution identity from durable state:

- Mission is active and bound to an active Project.
- Work is ready/active and has one owner.
- Owner is an active persistent Organization Agent with a ready AgentWorkspace.
- Owner is bound to an active runtime Slot in the same Project.
- Dependencies were already materialized.

The resulting task id is deterministic: `org-work-<workItemId>`. Replaying the same request returns the same projection without advancing work-state revision.
