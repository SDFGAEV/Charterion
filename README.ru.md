# Charterion: Open-Source Multi-Agent Engineering Control Plane for ChatGPT Web Agents

[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Chromium](https://img.shields.io/badge/Chromium-Manifest%20V3-4285F4.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.5.0-2ea44f.svg)](manifest.json)
[![ChatGPT Web](https://img.shields.io/badge/target-ChatGPT%20Web-111111.svg)](https://chatgpt.com/)
[![Latest Release](https://img.shields.io/github/v/release/Xalzeroph/Charterion?display_name=tag)](https://github.com/Xalzeroph/Charterion/releases/latest)

<!-- readme-i18n:navigation:start -->
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <strong>Русский</strong></p>
<!-- readme-i18n:navigation:end -->

**Локальный engineering control plane, который превращает несколько разговоров ChatGPT Web в устойчивую ролевую организацию Agents.**

> GAM координирует ChatGPT Web. Он не заменяет ChatGPT через API Provider, не хранит учетные данные и не считает prose модели engineering authority.

---

<!-- readme-section:overview -->
## Обзор

Charterion управляет несколькими разговорами ChatGPT Web как постоянными engineering Workers. Локальный deterministic Kernel сохраняет Agent identity, проекты, Git, leases, capabilities, evidence, reviews и recovery state. Browser tabs — заменяемые runtime surfaces, а не Source of Truth для Agent.

GAM спроектирован скорее как небольшая софтверная компания: Workers работают в изолированных scopes, Supervisors проверяют exact evidence, а Kernel обеспечивает authority boundaries.

<!-- readme-section:capabilities -->
## Ключевые возможности

- **Постоянная Agent identity** — `AgentSlot` не зависит от tab ID и отдельной ChatGPT conversation.
- **Project isolation** — `ProjectCell`, Git worktrees, leases, epochs и scoped capabilities разделяют параллельную работу.
- **Company governance** — каждый task получает versioned Company System Policy и deterministic Role Charter.
- **Typed completion authority** — `structured-result`, `verified-claim`, `review-pass`, `human-approval` отделяют evidence от prose.
- **Machine-verifiable work** — проверяются exact commit SHA, branch/worktree, lease identity и evidence.
- **Независимый Supervisor** — Implementer не может self-approve.
- **Параллелизм + backpressure** — независимые задачи выполняются одновременно, а prompt governor ограничивает bursts.
- **Elastic browser fleet** — trusted-idle Worker может suspend + close без удаления conversation или durable state.
- **Crash convergence** — uncertain send, cleanup, leases и capability fencing сходятся через fail-closed/replay.
- **Recursive self-hosting** — Parent GAM разрабатывает изолированный Candidate и решает promotion по exact evidence.

<!-- readme-section:architecture -->
## Архитектура

Kernel владеет durable authority; браузер исполняет только авторизованные effects.

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
## Основные концепции

| Концепция | Ответственность |
| --- | --- |
| `ProjectCell` | Постоянная граница проекта/команды, capacity policy и repository root |
| `AgentSlot` | Постоянная Worker identity и lifecycle |
| `AgentConversationRecord` | Постоянное mapping между Agent и генерацией ChatGPT conversation |
| Task | Typed work item с dependencies и completion authority |
| Task workspace | Изолированный Git worktree, branch, lease, capability и base SHA |
| `WorkClaim` | Проверяемый completion claim, привязанный к exact evidence |
| Supervisor | Независимая review/integration authority |
| GAM Kernel | Deterministic owner для durable state и authorization |

<!-- readme-section:organization -->
## Управление Agents как компанией

Каждый task формируется в фиксированном порядке: политика компании, Role Charter, Task Brief. Текст нижнего уровня не может расширять authority верхнего уровня.

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

Политика требует decoupled architecture, typed contracts, durable authority, least privilege, независимых worktrees, crash convergence, объективных tests/evidence, явного ownership, документации и Git discipline. Типичные роли: Architect, Implementer, Tester, Supervisor, Researcher, Operator.

[Документация Company Governance](docs/company-governance.md)

<!-- readme-section:completion -->
## Модель задач и завершения

GAM не считает “Assistant ответил” эквивалентом “работа завершена”. Каждая completion policy требует terminal evidence.

- `structured-result` принимает ровно один строгий JSON terminal block `<GAM_RESULT>`.
- `verified-claim` требует Kernel-provisioned workspace, exact HEAD SHA, scoped claim и Kernel verification.
- `review-pass` принимает только валидный успешный review protocol; fail/malformed review не является успехом.
- `human-approval` сохраняет явную границу human authority.

```text
Task → isolated worktree → commit → WorkClaim → machine verification
     → independent review → integration/promotion authority
```

<!-- readme-section:parallelism -->
## Параллелизм и управление prompts

DAG edges отражают реальные dependencies, а не искусственный throttling. Независимая работа может выполняться параллельно в разных AgentSlots/worktrees.

Prompt Dispatch Governor применяет global spacing, rolling-window budget, Project/AgentSlot spacing, concurrent-generation capacity и rate-limit backoff до физической отправки в composer. Доставка `uncertain` никогда не переотправляется автоматически.

Exact Task Dispatch planner выбирает только запрошенный ready task и не захватывает задачи других ProjectCells. В одной ready wave сначала выбираются задачи с наименьшим числом кандидатов, затем учитываются специализация роли, постоянная conversation и детерминированные tie-breaks, чтобы сохранить редких совместимых Agents для более ограниченной работы.

<!-- readme-section:browser-lifecycle -->
## Жизненный цикл браузера и восстановление

Browser page — это execution lease, а не durable identity. Лишние trusted-idle Workers можно suspend и закрыть их tabs, сохранив AgentSlot, conversation, checkpoint, evidence и Git history.

Generating, unknown/unavailable, quarantined, rollover-active и effect-active работают в режиме fail closed. Stuck-Generation Convergence объединяет page/slot facts, attempt, deadline и недавний engineering progress перед запросом authority-checked stop.

<!-- readme-section:self-hosting -->
## Рекурсивный self-hosting

GAM поддерживает Parent → isolated Candidate → evidence-gated promotion. Repo, `GAM_HOME`, SQLite DB, pipe и browser profile Parent/Candidate должны быть раздельными.

Candidate не может self-approve. Promotion требует exact parent/candidate SHA и независимую evidence, поддерживает reject-preserve и replay/crash convergence.

<!-- readme-section:quick-start -->
## Быстрый старт

Текущий deployment path Native Messaging в первую очередь ориентирован на Windows.

- Windows 10/11
- Node.js 22+
- Chrome или Microsoft Edge (Chromium)
- .NET 9 SDK/runtime только при сборке Native Host из source

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

`GAM.cmd` использует отдельный Chromium profile и идемпотентно запускает local Kernel. Пользователь входит напрямую на `chatgpt.com`; GAM не хранит password, MFA secret, cookie или account token и не требует OpenAI API key.

For the complete local, source, release, and Remote Desktop Commander deployment procedure, see [Deployment Guide](https://github.com/Xalzeroph/Charterion/blob/main/docs/DEPLOYMENT.md).

<!-- readme-section:security -->
## Границы безопасности

- Host permission ограничен `https://chatgpt.com/*`.
- Native Messaging разрешен только для pinned extension origin.
- Native Host никогда не содержит GAM admin token.
- Worker capability scoped по project/task/resource/lease; в persistent storage хранится только token hash.
- `gamctl` не имеет implicit admin fallback; привилегированные операции требуют явного `--admin`.
- unknown/stale/ambiguous/conflicting authority работает fail closed.
- Candidate self-promotion отклоняется.
- GAM — coordination/policy layer, а не OS sandbox; filesystem/terminal требуют host/container isolation.

<!-- readme-section:development -->
## Разработка и проверка

Изменения должны проходить type check, architecture, unit/fault и smoke gates; для release добавляется README i18n release gate.

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
## Структура репозитория

```text
src/            Browser extension runtime and typed policies
control/        Deterministic Kernel, SQLite authority, RPC, leases, evidence
native-host/    Chromium Native Messaging bridge
scripts/        Build, verification, packaging, smoke, and Windows setup tools
tests/          Browser/runtime/unit/fault tests
docs/           Architecture and operational documentation
```

<!-- readme-section:contributing -->
## Участие в разработке

Сохраняйте explicit ownership, typed boundaries, durable facts, least privilege, изолированные Git worktrees, объективные tests, документацию и независимый review. Не расширяйте browser/native permissions и не обходите evidence gates ради удобства.

Для крупных изменений используйте отдельный branch/worktree, добавляйте focused tests, запускайте релевантные wider gates и фиксируйте exact commit SHA как объект review.

<!-- readme-section:scope -->
## Текущая область

Сейчас GAM сфокусирован на ChatGPT Web в `chatgpt.com`. Generic LLM APIs, hosted orchestration, интеграции Claude/Gemini и coding-agent CLI providers находятся вне текущего product scope.

<!-- readme-section:license -->
## Лицензия

Проект распространяется по [Apache-2.0](LICENSE) и включает [NOTICE](NOTICE) и [Third-Party Notices](THIRD_PARTY_NOTICES.md). Юридически authoritative является официальный английский `LICENSE` в корне репозитория.

<!-- readme-section:status -->
## Статус разработки

Charterion находится в active development. Release Candidate считается stable только после repository verification, README i18n release gate и evidence-based review/promotion boundaries.
