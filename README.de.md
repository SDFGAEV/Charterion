# Charterion: Open-Source Multi-Agent Engineering Control Plane for ChatGPT Web Agents

[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Chromium](https://img.shields.io/badge/Chromium-Manifest%20V3-4285F4.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.5.0-2ea44f.svg)](manifest.json)
[![ChatGPT Web](https://img.shields.io/badge/target-ChatGPT%20Web-111111.svg)](https://chatgpt.com/)

<!-- readme-i18n:navigation:start -->
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.fr.md">Français</a> · <strong>Deutsch</strong> · <a href="README.ru.md">Русский</a></p>
<!-- readme-i18n:navigation:end -->

**Eine local-first Engineering-Control-Plane, die mehrere ChatGPT-Web-Konversationen als dauerhafte, rollenbasierte Agent-Organisation verwaltet.**

> GAM koordiniert ChatGPT Web. Es ersetzt ChatGPT nicht durch einen API Provider, speichert keine Kontozugangsdaten und behandelt Modell-prose nicht als engineering authority.

---

<!-- readme-section:overview -->
## Überblick

Charterion verwaltet mehrere ChatGPT-Web-Konversationen als persistente engineering Workers. Ein lokaler deterministic Kernel hält Agent identity, Projekte, Git, leases, capabilities, evidence, reviews und recovery state dauerhaft. Browser-tabs sind austauschbare runtime surfaces und nicht die Source of Truth eines Agents.

GAM ist eher wie ein kleines Softwareunternehmen als wie ein Tab-Automator aufgebaut: Workers arbeiten in isolierten scopes, Supervisors prüfen exact evidence und der Kernel erzwingt authority boundaries.

<!-- readme-section:capabilities -->
## Kernfunktionen

- **Persistente Agent identity** — `AgentSlot` ist unabhängig von tab ID und einzelner ChatGPT conversation.
- **Project isolation** — `ProjectCell`, Git worktrees, leases, epochs und scoped capabilities trennen parallele Arbeit.
- **Company governance** — jeder task erhält versioned Company System Policy und deterministic Role Charter.
- **Typed completion authority** — `structured-result`, `verified-claim`, `review-pass`, `human-approval` trennen evidence von prose.
- **Machine-verifiable work** — exact commit SHA, branch/worktree, lease identity und evidence werden geprüft.
- **Unabhängiger Supervisor** — Implementer können nicht self-approve.
- **Parallelität + backpressure** — unabhängige Tasks laufen parallel, der prompt governor begrenzt bursts.
- **Elastic browser fleet** — trusted-idle Workers können suspend + close ausführen, ohne conversation oder durable state zu löschen.
- **Crash convergence** — uncertain send, cleanup, leases und capability fencing konvergieren per fail-closed/replay.
- **Recursive self-hosting** — Parent GAM entwickelt einen isolierten Candidate und entscheidet promotion anhand exact evidence.

<!-- readme-section:architecture -->
## Architektur

Der Kernel besitzt die durable authority; der Browser führt ausschließlich autorisierte effects aus.

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
## Kernkonzepte

| Konzept | Verantwortung |
| --- | --- |
| `ProjectCell` | Persistente Projekt-/Teamgrenze, capacity policy und repository root |
| `AgentSlot` | Persistente Worker identity und lifecycle |
| `AgentConversationRecord` | Persistentes Mapping zwischen Agent und ChatGPT conversation generation |
| Task | Typed work item mit dependencies und completion authority |
| Task workspace | Isoliertes Git worktree, branch, lease, capability und base SHA |
| `WorkClaim` | Verifizierbarer completion claim gebunden an exact evidence |
| Supervisor | Unabhängige review/integration authority |
| GAM Kernel | Deterministic owner von durable state und authorization |

<!-- readme-section:organization -->
## Agent-Management wie in einem Unternehmen

Jeder task wird in fester Priorität aus Company Policy, Role Charter und Task Brief zusammengesetzt. Untergeordneter Text darf übergeordnete authority nicht erweitern.

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

Die Policy verlangt entkoppelte Architektur, typed contracts, durable authority, least privilege, unabhängige worktrees, crash convergence, objektive tests/evidence, explizites ownership, Dokumentation und Git discipline. Typische Rollen sind Architect, Implementer, Tester, Supervisor, Researcher und Operator.

[Company-Governance-Dokumentation](docs/company-governance.md)

<!-- readme-section:completion -->
## Task- und Completion-Modell

GAM setzt „Assistant hat geantwortet“ nicht mit „Arbeit ist abgeschlossen“ gleich. Jede completion policy verlangt terminal evidence.

- `structured-result` akzeptiert genau einen strikten `<GAM_RESULT>` JSON terminal block.
- `verified-claim` verlangt Kernel-provisioned workspace, exact HEAD SHA, scoped claim und Kernel verification.
- `review-pass` akzeptiert nur ein gültiges bestandenes review protocol; fail/malformed review ist kein Erfolg.
- `human-approval` bewahrt eine explizite human-authority-Grenze.

```text
Task → isolated worktree → commit → WorkClaim → machine verification
     → independent review → integration/promotion authority
```

<!-- readme-section:parallelism -->
## Parallelität und Prompt-Steuerung

DAG edges repräsentieren echte dependencies und nicht künstliches throttling. Unabhängige Arbeit kann parallel auf unterschiedlichen AgentSlots/worktrees laufen.

Prompt Dispatch Governor erzwingt global spacing, rolling-window budget, Project/AgentSlot spacing, concurrent-generation capacity und rate-limit backoff vor dem physischen Versand an den composer. `uncertain` delivery wird nie automatisch erneut gesendet.

Exact Task Dispatch planner wählt nur den angeforderten ready task und keine Tasks anderer ProjectCells.

<!-- readme-section:browser-lifecycle -->
## Browser-Lifecycle und Recovery

Eine browser page ist ein execution lease und keine durable identity. Überschüssige trusted-idle Workers können suspendiert und deren tab geschlossen werden, während AgentSlot, conversation, checkpoint, evidence und Git history erhalten bleiben.

Generating, unknown/unavailable, quarantined, rollover-active und effect-active sind fail closed. Stuck-Generation Convergence kombiniert page/slot facts, attempt, deadline und jüngsten engineering progress, bevor ein authority-checked stop angefordert wird.

<!-- readme-section:self-hosting -->
## Rekursives Self-Hosting

GAM unterstützt Parent → isolated Candidate → evidence-gated promotion. Repo, `GAM_HOME`, SQLite DB, pipe und browser profile müssen zwischen Parent und Candidate getrennt bleiben.

Der Candidate darf nicht self-approve. Promotion verlangt exact parent/candidate SHA und unabhängige evidence sowie reject-preserve und replay/crash convergence.

<!-- readme-section:quick-start -->
## Schnellstart

Der aktuelle Native-Messaging-Deployment-Pfad richtet sich primär an Windows.

- Windows 10/11
- Node.js 22+
- Chrome oder Microsoft Edge (Chromium)
- .NET 9 SDK/runtime nur beim Build des Native Host aus source

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

`GAM.cmd` verwendet ein dediziertes Chromium profile und startet den local Kernel idempotent. Der Benutzer meldet sich direkt auf `chatgpt.com` an; GAM speichert weder password, MFA secret, cookie noch account token und benötigt keinen OpenAI API key.

<!-- readme-section:security -->
## Sicherheitsgrenzen

- Host permission ist auf `https://chatgpt.com/*` begrenzt.
- Native Messaging ist auf den pinned extension origin beschränkt.
- Native Host hält niemals den GAM admin token.
- Worker capability ist nach project/task/resource/lease scoped; persistent gespeichert wird nur der token hash.
- `gamctl` besitzt keinen implicit admin fallback; privilegierte Operationen benötigen explizites `--admin`.
- unknown/stale/ambiguous/conflicting authority ist fail closed.
- Candidate self-promotion wird abgelehnt.
- GAM ist coordination/policy layer, kein OS sandbox; filesystem/terminal benötigen host/container isolation.

<!-- readme-section:development -->
## Entwicklung und Verifikation

Änderungen müssen type check, architecture, unit/fault und smoke gates bestehen; Releases verlangen zusätzlich den README i18n release gate.

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
## Repository-Struktur

```text
src/            Browser extension runtime and typed policies
control/        Deterministic Kernel, SQLite authority, RPC, leases, evidence
native-host/    Chromium Native Messaging bridge
scripts/        Build, verification, packaging, smoke, and Windows setup tools
tests/          Browser/runtime/unit/fault tests
docs/           Architecture and operational documentation
```

<!-- readme-section:contributing -->
## Mitwirken

Bewahre explicit ownership, typed boundaries, durable facts, least privilege, isolierte Git worktrees, objektive tests, Dokumentation und unabhängige reviews. Erweitere browser/native permissions nicht aus Bequemlichkeit und umgehe keine evidence gates.

Für größere Änderungen: eigener branch/worktree, focused tests, relevante wider gates und exact commit SHA als Review-Objekt.

<!-- readme-section:scope -->
## Aktueller Scope

GAM fokussiert derzeit ChatGPT Web auf `chatgpt.com`. Generic LLM APIs, hosted orchestration, Claude/Gemini integrations und coding-agent CLI providers liegen außerhalb des aktuellen product scope.

<!-- readme-section:license -->
## Lizenz

Dieses Projekt steht unter [Apache-2.0](LICENSE) und enthält [NOTICE](NOTICE) sowie [Third-Party Notices](THIRD_PARTY_NOTICES.md). Rechtlich authoritative ist die offizielle englische `LICENSE` im Repository-Root.

<!-- readme-section:status -->
## Entwicklungsstatus

Charterion befindet sich in active development. Ein Release Candidate gilt erst nach repository verification, README i18n release gate und evidence-based review/promotion boundaries als stable.
