# Charterion CI/CD

Charterion treats CI as an authority boundary: a change is mergeable only when the
same repository gates that define local correctness pass in automation.

## Pull requests

Every pull request runs in parallel:

- `quality` on Ubuntu with locked npm installation, TypeScript, architecture,
  deterministic verification, and production dependency audit.
- `windows-runtime` on Windows with Node 22, .NET 9, Native Host publishing,
  runtime installation, launcher, fleet, evidence, and self-hosting smoke tests.
- `dependency-review` rejects newly introduced high-severity dependency changes.

The workflow uses least-privilege read tokens and cancels obsolete pull-request runs.

## Main and security

Pushes to `main` repeat the quality and Windows runtime gates. CodeQL runs on every
main push and weekly, covering the JavaScript/TypeScript extension and control plane.

Dependabot opens grouped weekly updates for npm dependencies and GitHub Actions.
Updates still have to pass the same repository gates.

## Releases

A release is created only by pushing a tag exactly matching `package.json`, such as
`v0.5.0`. The Windows release job runs `npm run release`, which includes the complete
verification suite, Native Host publication, README release validation, and both
extension and Windows runtime archives. Archives receive SHA-256 evidence, GitHub
artifact provenance, and are attached to the GitHub Release.

## Required repository settings

The `main` branch should require the `quality`, `windows-runtime`, and
`dependency-review` checks for pull requests, disallow force pushes, and require
stale reviews to be dismissed after new commits. Apache-2.0 legal files remain
part of every release archive.
