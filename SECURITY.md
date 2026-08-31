# Security Policy

## Supported versions

Security fixes target the current default branch and the latest published release. Older snapshots may not receive backports.

## Reporting a vulnerability

Please do not open a public issue for an unpatched vulnerability.

Use GitHub's private vulnerability reporting / Security Advisory flow for this repository. Include the affected version or commit, reproduction steps, impact, and any known mitigations.

## Security model

Charterion is a coordination and policy layer, not an operating-system sandbox. Its security boundaries include scoped capabilities, deterministic authority checks, a restricted Native Messaging bridge, and fail-closed handling of ambiguous state.

Reports involving privilege escalation, capability bypass, cross-project authority leakage, unsafe browser-origin handling, secret exposure, or unintended prompt delivery are especially valuable.

Please avoid accessing data that is not yours, disrupting other users, or testing against systems without authorization.