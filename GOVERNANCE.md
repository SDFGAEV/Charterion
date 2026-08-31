# Governance

Charterion is maintained as an open-source engineering project with evidence-gated changes and narrow authority boundaries.

## Decision model

Maintainers are responsible for repository policy, releases, security response, and final integration decisions. Contributors may propose changes through issues and pull requests; merge authority remains separate from authorship and review whenever practical.

Technical decisions should prefer reproducible evidence over status or seniority. Security boundaries, durable state contracts, and failure semantics require explicit review.

## Change classes

- **Routine:** documentation, tests, isolated fixes, and low-risk maintenance.
- **Architectural:** authority boundaries, persistence, orchestration, recovery, or cross-component contracts.
- **Security-sensitive:** permissions, capabilities, tokens, native messaging, browser origin handling, or protected Git operations.

Architectural and security-sensitive changes should document invariants, failure modes, migration impact, and verification evidence.

## Releases

A release is cut from an exact commit after repository verification succeeds. Release artifacts should carry checksums and match the documented version.

Project governance may evolve as the maintainer and contributor community grows.