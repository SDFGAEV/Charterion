# GPT Agent Manager

[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Chromium](https://img.shields.io/badge/Chromium-Manifest%20V3-4285F4.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.5.0-2ea44f.svg)](manifest.json)
[![ChatGPT Web](https://img.shields.io/badge/target-ChatGPT%20Web-111111.svg)](https://chatgpt.com/)

<!-- readme-i18n:navigation:start -->
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <strong>Français</strong> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>
<!-- readme-i18n:navigation:end -->

**Un control plane d’ingénierie local-first qui transforme plusieurs conversations ChatGPT Web en une organisation d’Agents persistante et structurée par rôles.**

> GAM coordonne ChatGPT Web. Il ne remplace pas ChatGPT par un API Provider, ne stocke pas les identifiants de compte et ne considère pas le prose du modèle comme engineering authority.

---

<!-- readme-section:overview -->
## Vue d’ensemble

GPT Agent Manager (GAM) gère plusieurs conversations ChatGPT Web comme des engineering Workers persistants. Un deterministic Kernel local conserve Agent identity, projets, Git, leases, capabilities, evidence, reviews et recovery state. Les tabs du navigateur sont des runtime surfaces remplaçables, pas la Source of Truth de l’Agent.

GAM vise le fonctionnement d’une petite entreprise logicielle : Workers dans des scopes isolés, Supervisors sur des exact evidence, Kernel responsable des authority boundaries.

<!-- readme-section:capabilities -->
## Fonctionnalités principales

- **Agent identity persistante** — `AgentSlot` reste indépendant du tab ID et d’une conversation donnée.
- **Project isolation** — `ProjectCell`, Git worktrees, leases, epochs et scoped capabilities séparent le travail concurrent.
- **Company governance** — chaque task reçoit un Company System Policy versionné et un Role Charter déterministe.
- **Typed completion authority** — `structured-result`, `verified-claim`, `review-pass`, `human-approval` séparent evidence et prose.
- **Machine-verifiable work** — exact commit SHA, branch/worktree, lease identity et evidence sont vérifiés.
- **Supervisor indépendant** — un Implementer ne peut pas self-approve.
- **Parallélisme + backpressure** — les tâches indépendantes tournent en parallèle et le prompt governor limite les bursts.
- **Elastic browser fleet** — un Worker trusted-idle peut faire suspend + close sans effacer conversation ou durable state.
- **Crash convergence** — uncertain send, cleanup, leases et capability fencing convergent via fail-closed/replay.
- **Recursive self-hosting** — Parent GAM développe un Candidate isolé et décide la promotion sur exact evidence.

<!-- readme-section:architecture -->
## Architecture

Le Kernel détient la durable authority ; le navigateur n’exécute que les effects autorisés.

```text
Human / Remote Operator
          │
          ▼
 Side Panel · GAM.cmd · gamctl
          │
          ▼
        gamd
   Deterministic Kernel
          │
  SQLite · Git · leases
 capabilities · evidence
 reviews · promotion state
          │
          ▼
Native Messaging Bridge
          │
          ▼
ChatGPT Web Agent Fleet
```

<!-- readme-section:core-concepts -->
## Concepts fondamentaux

| Concept | Responsabilité |
| --- | --- |
| `ProjectCell` | Frontière persistante projet/équipe, capacity policy et repository root |
| `AgentSlot` | Worker identity persistante et lifecycle |
| `AgentConversationRecord` | Mapping persistant entre Agent et génération de ChatGPT conversation |
| Task | Unité typed de travail avec dependencies et completion authority |
| Task workspace | Git worktree isolé, branch, lease, capability et base SHA |
| `WorkClaim` | Completion claim vérifiable lié à exact evidence |
| Supervisor | Authority indépendante de review/integration |
| GAM Kernel | Owner déterministe de durable state et authorization |

<!-- readme-section:organization -->
## Gestion des Agents comme une entreprise

Chaque task est composé selon une priorité fixe : politique d’entreprise, Role Charter, Task Brief. Le texte de niveau inférieur ne peut pas élargir la authority de niveau supérieur.

```text
Company System Policy
        ↓
Role Charter
        ↓
Task Brief
        ↓
Revision / Dependency Evidence
        ↓
Managed Workspace + Completion Protocol
```

La politique exige architecture découplée, typed contracts, durable authority, least privilege, worktrees indépendants, crash convergence, tests/evidence objectifs, ownership explicite, documentation et discipline Git. Rôles typiques : Architect, Implementer, Tester, Supervisor, Researcher, Operator.

[Documentation Company Governance](docs/company-governance.md)

<!-- readme-section:completion -->
## Modèle des tâches et de complétion

GAM ne considère pas “l’Assistant a répondu” comme “le travail est terminé”. Chaque completion policy exige un terminal evidence.

- `structured-result` accepte un seul bloc terminal JSON `<GAM_RESULT>` strict.
- `verified-claim` exige Kernel-provisioned workspace, exact HEAD SHA, scoped claim et Kernel verification.
- `review-pass` n’accepte qu’un review protocol valide et approuvé ; fail/malformed review n’est pas un succès.
- `human-approval` conserve une frontière explicite de human authority.

```text
Task → isolated worktree → commit → WorkClaim → machine verification
     → independent review → integration/promotion authority
```

<!-- readme-section:parallelism -->
## Parallélisme et contrôle des prompts

Les DAG edges représentent des dependencies réelles, pas un throttling artificiel. Les travaux indépendants peuvent s’exécuter en parallèle sur différents AgentSlots/worktrees.

Prompt Dispatch Governor applique global spacing, rolling-window budget, Project/AgentSlot spacing, concurrent-generation capacity et rate-limit backoff avant l’envoi au composer. Une livraison `uncertain` n’est jamais renvoyée automatiquement.

Exact Task Dispatch planner sélectionne uniquement le ready task demandé et n’embarque pas les tâches d’autres ProjectCells.

<!-- readme-section:browser-lifecycle -->
## Cycle de vie du navigateur et récupération

Une browser page est un execution lease, pas une durable identity. Les Workers trusted-idle excédentaires peuvent être suspendus et fermer leur tab tout en conservant AgentSlot, conversation, checkpoint, evidence et Git history.

Generating, unknown/unavailable, quarantined, rollover-active et effect-active sont fail closed. Stuck-Generation Convergence combine page/slot facts, attempt, deadline et engineering progress récent avant tout authority-checked stop.

<!-- readme-section:self-hosting -->
## Self-hosting récursif

GAM prend en charge Parent → isolated Candidate → evidence-gated promotion. Repo, `GAM_HOME`, SQLite DB, pipe et browser profile doivent rester distincts entre Parent et Candidate.

Le Candidate ne peut pas self-approve. La promotion exige exact parent/candidate SHA et evidence indépendante, avec reject-preserve et replay/crash convergence.

<!-- readme-section:quick-start -->
## Démarrage rapide

Le deployment path Native Messaging actuel cible principalement Windows.

- Windows 10/11
- Node.js 22+
- Chrome ou Microsoft Edge (Chromium)
- .NET 9 SDK/runtime uniquement pour compiler Native Host depuis le source

```powershell
npm install
npm run verify:full
npm run setup:windows
```

```powershell
GAM.cmd status --json
GAM.cmd start --json
GAM.cmd open "My Project" --json
GAM.cmd doctor --json
```

`GAM.cmd` utilise un Chromium profile dédié et démarre le local Kernel de façon idempotente. L’utilisateur se connecte directement sur `chatgpt.com` ; GAM ne stocke ni password, MFA secret, cookie, account token et ne nécessite pas de clé OpenAI API.

<!-- readme-section:security -->
## Limites de sécurité

- Host permission limité à `https://chatgpt.com/*`.
- Native Messaging limité au pinned extension origin.
- Native Host ne détient jamais le GAM admin token.
- Worker capability scoped par project/task/resource/lease ; seul le token hash est persisté.
- `gamctl` n’a pas d’implicit admin fallback ; les opérations privilégiées exigent `--admin` explicite.
- unknown/stale/ambiguous/conflicting authority utilise fail closed.
- Candidate self-promotion est refusé.
- GAM est une coordination/policy layer, pas un OS sandbox ; filesystem/terminal doivent être isolés par host/container policy.

<!-- readme-section:development -->
## Développement et vérification

Les changements doivent passer type check, architecture, unit/fault et smoke gates ; les releases ajoutent le README i18n release gate.

```powershell
npm run check
npm run check:control
npm run check:architecture
npm test
npm run test:faults
npm run verify
npm run verify:full
```

<!-- readme-section:repository-layout -->
## Structure du dépôt

```text
src/            Browser extension runtime and typed policies
control/        Deterministic Kernel, SQLite authority, RPC, leases, evidence
native-host/    Chromium Native Messaging bridge
scripts/        Build, verification, packaging, smoke, and Windows setup tools
tests/          Browser/runtime/unit/fault tests
docs/           Architecture and operational documentation
```

<!-- readme-section:contributing -->
## Contribuer

Préservez explicit ownership, typed boundaries, durable facts, least privilege, Git worktrees isolés, tests objectifs, documentation et review indépendant. N’élargissez pas les permissions browser/native et ne contournez pas les evidence gates par commodité.

Pour les changements importants, utilisez un branch/worktree dédié, ajoutez des focused tests, exécutez les wider gates pertinents et enregistrez l’exact commit SHA revu.

<!-- readme-section:scope -->
## Périmètre actuel

GAM cible actuellement ChatGPT Web sur `chatgpt.com`. Generic LLM APIs, hosted orchestration, intégrations Claude/Gemini et coding-agent CLI providers sont hors du product scope actuel.

<!-- readme-section:license -->
## Licence

Ce projet utilise [Apache-2.0](LICENSE) et inclut [NOTICE](NOTICE) ainsi que [Third-Party Notices](THIRD_PARTY_NOTICES.md). Le `LICENSE` officiel en anglais à la racine du dépôt est juridiquement authoritative.

<!-- readme-section:status -->
## État du développement

GPT Agent Manager est en active development. Un Release Candidate n’est considéré stable qu’après repository verification, README i18n release gate et evidence-based review/promotion boundaries.
