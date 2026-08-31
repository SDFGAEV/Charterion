# Charterion: Open-Source Multi-Agent Engineering Control Plane for ChatGPT Web Agents

[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Chromium](https://img.shields.io/badge/Chromium-Manifest%20V3-4285F4.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.4.1-2ea44f.svg)](manifest.json)
[![ChatGPT Web](https://img.shields.io/badge/target-ChatGPT%20Web-111111.svg)](https://chatgpt.com/)

<!-- readme-i18n:navigation:start -->
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <strong>Русский</strong></p>
<!-- readme-i18n:navigation:end -->

**Локальная инженерная control plane, которая превращает несколько диалогов ChatGPT Web в постоянных программно-инженерных Agents с закреплёнными ролями.**

<!-- readme-section:overview -->
## Обзор

Charterion координирует несколько **диалогов ChatGPT Web** как постоянных инженерных Workers и дополняет их долговечной локальной control plane для проектов, Git-работы, ревью, ресурсов и восстановления.

Для совместимости runtime сохраняет существующие имена команд `GAM`, `gamd` и `gamctl`, а **Charterion** является публичным названием проекта.

Проект намеренно ориентирован на `chatgpt.com`: не нужен OpenAI API key, нет размещённого backend Charterion и нет попытки заменить ChatGPT Web API-интерфейсом провайдера.

<!-- readme-section:architecture -->
## Архитектура

Charterion состоит из четырёх runtime-компонентов:

- **Chrome/Edge Extension** — обнаруживает вкладки `chatgpt.com`, связывает идентичности Role/Project, маршрутизирует prompts, наблюдает ответы и отображает Side Panel.

- **`gamd`** — детерминированный локальный Kernel. Он владеет SQLite-authority, проектами, leases, capabilities, evidence, Change Requests, Supervisor reviews, состоянием fleet и merge queue.

- **Native Messaging Host** — узкий мост Chromium ↔ `gamd` через Windows named pipe. Он никогда не получает administrator token.

- **`GAM` / `gamctl`** — клиенты запуска и управления для человека и машины.

```text
Human operator / Remote agent
             |
       GAM / gamctl
             |
           gamd
   SQLite · Git · leases
 evidence · reviews · fleet
             |
 Native Messaging Host
             |
      Chromium Extension
             |
     ChatGPT Web tabs
```

<!-- readme-section:operation -->
## Работа человека и Agent

Пользователь может запускать выделенный Chromium runtime через `GAM.cmd`. Авторизованные Remote Agents используют тот же Kernel через детерминированные JSON/CLI-команды без scraping интерфейса.

Charterion не хранит пароли ChatGPT, MFA secrets, cookies или account tokens. Пользователь входит напрямую на официальной странице ChatGPT в выделенном профиле браузера.

```powershell
GAM.cmd
GAM.cmd status --json
GAM.cmd start --json
GAM.cmd open "My Project" --json
GAM.cmd doctor --json
```

<!-- readme-section:git-workflow -->
## Git и Change Request workflow

В программных проектах ответ модели не означает завершение инженерной работы. Работа привязывается к Git и машинным evidence, а перед интеграцией проверяется независимым Supervisor.

Ключевые invariants: точная привязка `baseSha`/`headSha`, запрет self-approval, аннулирование review после нового head, проверка evidence перед queueing, обнаружение конфликтов с последним target branch и независимое наблюдение интеграции в Git history.

```text
Task
  -> Worker branch/worktree
  -> commit
  -> machine evidence
  -> Change Request
  -> Supervisor review
  -> merge queue
  -> observed integration
```

<!-- readme-section:browser-orchestration -->
## Оркестрация браузера

Browser plane предоставляет постоянные Role/Project bindings, маршрутизацию task DAG, типы `work`/`review`/`human`, долговечные факты Skip/Cancel/Retry, ограниченные review loops, semantic message bus, восстановление send-attempt, fail-closed обработку неоднозначной доставки, переносимый browser state и опциональный Auto Supervisor.

Управляемый Supervisor desired state `AgentSlot` отделён от наблюдения браузера. Workers могут создаваться, приостанавливаться, возобновляться или выводиться из работы через ограниченную authority; draining Workers перестают получать новые задачи до закрытия вкладок.

<!-- readme-section:control-plane -->
## Долговечная локальная control plane

Kernel сохраняет в SQLite факты проекта, Agent, ресурсов, leases, capabilities, requests, WorkClaims, evidence, reviews, merge queue и browser runtime.

SQLite использует foreign keys, WAL mode, strict tables и транзакционные изменения состояния. Lease epochs и scoped capabilities блокируют устаревших Workers. Объективные машинные факты проверяются детерминированно; архитектура и инженерное качество остаются предметом решения Supervisor.

<!-- readme-section:quick-start -->
## Быстрый старт

Текущий deployment рассчитан на Windows 10/11, Node.js 22+, Chrome или Edge и .NET 9 при сборке Native Host из исходников.

Из source checkout:

```powershell
npm install
npm run verify:full
npm run setup:windows
```

Для упакованного Windows runtime распакуйте архив и запустите `SETUP.cmd`.

<!-- readme-section:security -->
## Границы безопасности

- host permission расширения ограничен `https://chatgpt.com/*`.

- Native Host использует узкий allowlist и никогда не получает administrator token GAM.

- Worker capabilities ограничены project/task/resource/lease и сохраняются только как token hash.

- `gamctl` не имеет неявного administrator fallback.

- Неизвестная, устаревшая, неоднозначная или конфликтующая authority приводит к fail-closed.

Charterion — это слой координации и политики, **а не sandbox операционной системы**. Filesystem и terminal tools по-прежнему требуют собственных границ VM/container/capability.

<!-- readme-section:verification -->
## Проверка и release

Быстрый gate проверяет TypeScript, типы control plane, статические assets, многоязычные invariants README, тесты и builds. Полный gate добавляет публикацию Native Host и процессные smoke tests.

Release artifacts выпускаются с SHA-256 sidecars.

```powershell
npm run verify
npm run verify:full
npm run release
```

<!-- readme-section:development -->
## Принципы разработки

1. Диалоги ChatGPT Web являются cognition plane; нельзя незаметно заменять их provider APIs.

2. Git и долговечные машинные наблюдения — инженерные факты; текст модели — утверждение или объяснение.

3. Workers получают широкую свободу решений внутри узкой явно заданной authority.

4. Supervisors принимают инженерные решения; детерминированный код обеспечивает invariant policy.

5. Факты сохраняются, а статус выводится из них; устаревшие попытки отсекаются идентичностями и epochs.

6. При неопределённости доставки, identity, ownership или integration система должна fail-closed.

<!-- readme-section:scope -->
## Область

Charterion сейчас ориентирован на **ChatGPT Web на `chatgpt.com`**. Универсальные LLM API, hosted orchestration, интеграции Claude/Gemini и coding-agent CLI providers находятся вне текущей области продукта.

<!-- readme-section:license -->
## Лицензия

Лицензируется по [Apache-2.0](LICENSE). См. [NOTICE](NOTICE) и [Third-Party Notices](THIRD_PARTY_NOTICES.md).

<!-- readme-section:status -->
## Статус разработки

Charterion активно разрабатывается. Ветка по умолчанию сейчас соответствует набору возможностей v0.4.1; более новые экспериментальные возможности документируются здесь только после формальной интеграции.
