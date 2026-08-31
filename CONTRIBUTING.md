# Contributing to Charterion

Thank you for helping improve Charterion. The project favors small, reviewable changes with explicit authority boundaries and reproducible evidence.

## Before you start

- Read the README and understand the local-first ChatGPT Web scope.
- Search existing issues before opening a new one.
- Keep unrelated refactors out of focused fixes.
- Do not widen browser, native-host, or filesystem permissions without a concrete security justification.

## Development setup

```powershell
npm ci
npm run verify
```

The current supported development path is Windows 10/11 with Node.js 22+, Chrome or Edge, and .NET 9 for Native Host work.

## Pull requests

A good pull request should explain the problem, the design choice, the affected authority boundary, and the evidence used to validate the change.

Prefer one coherent change per pull request. Add or update tests for behavior changes, and update documentation when public behavior changes.
