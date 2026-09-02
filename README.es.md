# Charterion: Open-Source Multi-Agent Engineering Control Plane for ChatGPT Web Agents

[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Chromium](https://img.shields.io/badge/Chromium-Manifest%20V3-4285F4.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.5.0-2ea44f.svg)](manifest.json)
[![ChatGPT Web](https://img.shields.io/badge/target-ChatGPT%20Web-111111.svg)](https://chatgpt.com/)
[![Latest Release](https://img.shields.io/github/v/release/Xalzeroph/Charterion?display_name=tag)](https://github.com/Xalzeroph/Charterion/releases/latest)

<!-- readme-i18n:navigation:start -->
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <strong>Español</strong> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>
<!-- readme-i18n:navigation:end -->

**Un control plane de ingeniería local-first que convierte múltiples conversaciones de ChatGPT Web en una organización de Agents persistente y basada en roles.**

> GAM coordina ChatGPT Web. No sustituye ChatGPT por un API Provider, no almacena credenciales de cuenta y no trata el prose del modelo como engineering authority.

---

<!-- readme-section:overview -->
## Descripción general

Charterion administra varias conversaciones de ChatGPT Web como engineering Workers persistentes. Un deterministic Kernel local conserva Agent identity, proyectos, Git, leases, capabilities, evidence, reviews y recovery state. Las tabs del navegador son runtime surfaces reemplazables, no la Source of Truth del Agent.

GAM está diseñado para operar como una pequeña empresa de software: los Workers trabajan en scopes aislados, los Supervisors revisan exact evidence y el Kernel impone los authority boundaries.

<!-- readme-section:capabilities -->
## Capacidades principales

- **Agent identity persistente** — `AgentSlot` es independiente del tab ID y de una conversación concreta.
- **Project isolation** — `ProjectCell`, Git worktrees, leases, epochs y scoped capabilities separan el trabajo concurrente.
- **Company governance** — cada task recibe un Company System Policy versionado y un Role Charter determinista.
- **Typed completion authority** — `structured-result`, `verified-claim`, `review-pass` y `human-approval` separan evidence de prose.
- **Machine-verifiable work** — se validan exact commit SHA, branch/worktree, lease identity y evidence.
- **Supervisor independiente** — un Implementer no puede self-approve.
- **Paralelismo + backpressure** — las tareas independientes pueden ejecutarse a la vez y el prompt governor limita bursts.
- **Elastic browser fleet** — un Worker trusted-idle puede hacer suspend + close sin borrar conversation ni durable state.
- **Crash convergence** — uncertain send, cleanup, leases y capability fencing convergen con fail-closed/replay.
- **Recursive self-hosting** — Parent GAM desarrolla un Candidate aislado y decide promotion con exact evidence.

<!-- readme-section:architecture -->
## Arquitectura

El Kernel posee la durable authority; el navegador ejecuta únicamente effects autorizados.

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
## Conceptos principales

| Concepto | Responsabilidad |
| --- | --- |
| `ProjectCell` | Límite persistente de proyecto/equipo, capacity policy y repository root |
| `AgentSlot` | Worker identity persistente y lifecycle |
| `AgentConversationRecord` | Mapping persistente entre Agent y una generación de ChatGPT conversation |
| Task | Unidad typed de trabajo con dependencies y completion authority |
| Task workspace | Git worktree aislado, branch, lease, capability y base SHA |
| `WorkClaim` | Completion claim verificable enlazado a exact evidence |
| Supervisor | Authority independiente para review/integration |
| GAM Kernel | Owner determinista de durable state y authorization |

<!-- readme-section:organization -->
## Gestión de Agents como empresa

Cada task se compone con prioridad fija: política de empresa, Role Charter y Task Brief. El texto de nivel inferior no puede ampliar la authority superior.

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

La política exige arquitectura desacoplada, typed contracts, durable authority, least privilege, worktrees independientes, crash convergence, tests/evidence objetivos, ownership explícito, documentación y disciplina Git. Roles típicos: Architect, Implementer, Tester, Supervisor, Researcher y Operator.

[Documentación de Company Governance](docs/company-governance.md)

<!-- readme-section:completion -->
## Modelo de tareas y finalización

GAM no interpreta “el Assistant respondió” como “el trabajo terminó”. Cada completion policy exige terminal evidence.

- `structured-result` acepta un único bloque terminal JSON `<GAM_RESULT>` estricto.
- `verified-claim` exige Kernel-provisioned workspace, exact HEAD SHA, scoped claim y Kernel verification.
- `review-pass` solo acepta un review protocol válido y aprobado; fail/malformed review no es éxito.
- `human-approval` conserva una frontera explícita de human authority.

```text
Task → isolated worktree → commit → WorkClaim → machine verification
     → independent review → integration/promotion authority
```

<!-- readme-section:parallelism -->
## Paralelismo y control de prompts

Los DAG edges representan dependencies reales, no throttling artificial. El trabajo independiente puede ejecutarse en paralelo en distintos AgentSlots/worktrees.

Prompt Dispatch Governor aplica global spacing, rolling-window budget, Project/AgentSlot spacing, concurrent-generation capacity y rate-limit backoff antes de enviar al composer. Una entrega `uncertain` nunca se reenvía automáticamente.

Exact Task Dispatch planner selecciona únicamente el ready task solicitado y no arrastra tareas de otros ProjectCells. En la misma ready wave prioriza las tareas con menos candidatos, la afinidad de especialidad, la conversación persistente y desempates deterministas, reservando los Agents compatibles escasos para el trabajo más restringido.

<!-- readme-section:browser-lifecycle -->
## Ciclo de vida del navegador y recuperación

Una browser page es un execution lease, no una durable identity. Los Workers trusted-idle sobrantes pueden hacer suspend y cerrar su tab conservando AgentSlot, conversation, checkpoint, evidence y Git history.

Generating, unknown/unavailable, quarantined, rollover-active y effect-active son estados fail closed. Stuck-Generation Convergence combina page/slot facts, attempt, deadline y engineering progress reciente antes de pedir un authority-checked stop.

<!-- readme-section:self-hosting -->
## Self-hosting recursivo

GAM admite Parent → isolated Candidate → evidence-gated promotion. Repo, `GAM_HOME`, SQLite DB, pipe y browser profile deben ser distintos entre Parent y Candidate.

El Candidate no puede self-approve. Promotion requiere exact parent/candidate SHA y evidence independiente, con reject-preserve y replay/crash convergence.

<!-- readme-section:quick-start -->
## Inicio rápido

La ruta actual de Native Messaging está orientada principalmente a Windows.

- Windows 10/11
- Node.js 22+
- Chrome o Microsoft Edge (Chromium)
- .NET 9 SDK/runtime solo para compilar Native Host desde source

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

`GAM.cmd` usa un Chromium profile dedicado y arranca el local Kernel de forma idempotente. El usuario inicia sesión directamente en `chatgpt.com`; GAM no guarda password, MFA secret, cookie ni account token y no requiere OpenAI API key.

For the complete local, source, release, and Remote Desktop Commander deployment procedure, see [Deployment Guide](https://github.com/Xalzeroph/Charterion/blob/main/docs/DEPLOYMENT.md).

<!-- readme-section:security -->
## Límites de seguridad

- Host permission limitado a `https://chatgpt.com/*`.
- Native Messaging restringido al pinned extension origin.
- Native Host nunca contiene el GAM admin token.
- Worker capability scoped por project/task/resource/lease; solo se persiste el token hash.
- `gamctl` no tiene implicit admin fallback; las operaciones privilegiadas requieren `--admin` explícito.
- unknown/stale/ambiguous/conflicting authority falla en modo fail closed.
- Candidate self-promotion se rechaza.
- GAM es una coordination/policy layer, no un OS sandbox; filesystem/terminal requieren aislamiento host/container.

<!-- readme-section:development -->
## Desarrollo y verificación

Los cambios deben pasar type check, architecture, unit/fault y smoke gates; los releases añaden el README i18n release gate.

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
## Estructura del repositorio

```text
src/            Browser extension runtime and typed policies
control/        Deterministic Kernel, SQLite authority, RPC, leases, evidence
native-host/    Chromium Native Messaging bridge
scripts/        Build, verification, packaging, smoke, and Windows setup tools
tests/          Browser/runtime/unit/fault tests
docs/           Architecture and operational documentation
```

<!-- readme-section:contributing -->
## Contribuir

Conserva explicit ownership, typed boundaries, durable facts, least privilege, Git worktrees aislados, tests objetivos, documentación y review independiente. No amplíes permisos browser/native ni evites evidence gates por comodidad.

Para cambios grandes, usa branch/worktree dedicado, añade focused tests, ejecuta wider gates relevantes y registra el exact commit SHA revisado.

<!-- readme-section:scope -->
## Alcance actual

GAM se centra actualmente en ChatGPT Web sobre `chatgpt.com`. Generic LLM APIs, hosted orchestration, Claude/Gemini integrations y coding-agent CLI providers están fuera del product scope actual.

<!-- readme-section:license -->
## Licencia

Este proyecto usa [Apache-2.0](LICENSE) e incluye [NOTICE](NOTICE) y [Third-Party Notices](THIRD_PARTY_NOTICES.md). El `LICENSE` oficial en inglés de la raíz del repositorio es legalmente authoritative.

<!-- readme-section:status -->
## Estado de desarrollo

Charterion está en active development. Un Release Candidate solo se considera stable tras superar repository verification, README i18n release gate y evidence-based review/promotion boundaries.
