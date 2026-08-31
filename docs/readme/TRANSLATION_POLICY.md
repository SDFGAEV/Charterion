# README Translation Policy

`README.md` is the semantic Source of Truth for README structure and technical facts. Localized README files are Git-tracked artifacts, not runtime machine translations.

## Invariants

- Keep the canonical project name `GPT Agent Manager` unchanged in every locale.
- Preserve section IDs, section order, commands, code blocks, paths, identifiers, JSON keys, environment variables, protocol names, database tables, SHAs, branches, and API symbols.
- Translate explanatory prose naturally; do not force word-for-word translations of architecture terms.
- Keep `fail-closed`, `Source of Truth`, `AgentSlot`, `ProjectCell`, `WorkClaim`, `GAM_HOME`, and other canonical contract tokens when translation would weaken precision.
- Relative link destinations must remain synchronized with the English source.
- The legal authority for licensing is the root `LICENSE` file containing the official English Apache License 2.0 text.

## Workflow

1. Edit `README.md`.
2. Run `python scripts/readme_i18n.py status`.
3. Update only the affected localized sections.
4. Run `python scripts/readme_i18n.py sync-navigation`.
5. Mark reviewed locales current with `python scripts/readme_i18n.py mark-current <locale> ...`.
6. Run `python scripts/check_readme_i18n.py`.
7. Before release, run `python scripts/check_readme_i18n.py --release`.

Tier 0 is English. Tier 1 locales must be current for release. Tier 2 locales may be temporarily stale, but staleness must remain visible in translation state and release evidence.
