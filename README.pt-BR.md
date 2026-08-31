# Charterion: Open-Source Multi-Agent Engineering Control Plane for ChatGPT Web Agents

[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Chromium](https://img.shields.io/badge/Chromium-Manifest%20V3-4285F4.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.5.0-2ea44f.svg)](manifest.json)
[![ChatGPT Web](https://img.shields.io/badge/target-ChatGPT%20Web-111111.svg)](https://chatgpt.com/)
[![Latest Release](https://img.shields.io/github/v/release/SDFGAEV/Charterion?display_name=tag)](https://github.com/SDFGAEV/Charterion/releases/latest)

<!-- readme-i18n:navigation:start -->
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <strong>Português (Brasil)</strong> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>
<!-- readme-i18n:navigation:end -->

**Um control plane de engenharia local-first que transforma várias conversas do ChatGPT Web em uma organização de Agents persistente e orientada por papéis.**

> O GAM coordena o ChatGPT Web. Ele não substitui o ChatGPT por um API Provider, não armazena credenciais de conta e não trata o prose do modelo como engineering authority.

---

<!-- readme-section:overview -->
## Visão geral

Charterion gerencia várias conversas do ChatGPT Web como engineering Workers persistentes. Um deterministic Kernel local mantém Agent identity, projetos, Git, leases, capabilities, evidence, reviews e recovery state. Tabs do navegador são runtime surfaces substituíveis, não a Source of Truth do Agent.

O GAM foi projetado para funcionar como uma pequena empresa de software: Workers operam em scopes isolados, Supervisors revisam exact evidence e o Kernel impõe os authority boundaries.

<!-- readme-section:capabilities -->
## Principais capacidades

- **Agent identity persistente** — `AgentSlot` é independente do tab ID e de uma conversa específica.
- **Project isolation** — `ProjectCell`, Git worktrees, leases, epochs e scoped capabilities separam o trabalho concorrente.
- **Company governance** — cada task recebe um Company System Policy versionado e um Role Charter determinístico.
- **Typed completion authority** — `structured-result`, `verified-claim`, `review-pass` e `human-approval` separam evidence de prose.
- **Machine-verifiable work** — exact commit SHA, branch/worktree, lease identity e evidence são validados.
- **Supervisor independente** — Implementer não pode self-approve.
- **Paralelismo + backpressure** — tarefas independentes executam em paralelo e o prompt governor limita bursts.
- **Elastic browser fleet** — Workers trusted-idle podem fazer suspend + close sem apagar conversation ou durable state.
- **Crash convergence** — uncertain send, cleanup, leases e capability fencing convergem com fail-closed/replay.
- **Recursive self-hosting** — Parent GAM desenvolve Candidate isolado e decide promotion com exact evidence.

<!-- readme-section:architecture -->
## Arquitetura

O Kernel mantém a durable authority; o navegador é apenas a superfície que executa effects autorizados.

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
## Conceitos centrais

| Conceito | Responsabilidade |
| --- | --- |
| `ProjectCell` | Limite persistente de projeto/equipe, capacity policy e repository root |
| `AgentSlot` | Worker identity persistente e lifecycle |
| `AgentConversationRecord` | Mapping persistente entre Agent e uma geração de ChatGPT conversation |
| Task | Unidade typed de trabalho com dependencies e completion authority |
| Task workspace | Git worktree isolado, branch, lease, capability e base SHA |
| `WorkClaim` | Completion claim verificável ligado a exact evidence |
| Supervisor | Authority independente de review/integration |
| GAM Kernel | Owner determinístico de durable state e authorization |

<!-- readme-section:organization -->
## Gestão de Agents como empresa

Cada task é composto em uma ordem fixa: política da empresa, Role Charter e Task Brief. Texto de nível inferior não pode ampliar a authority superior.

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

A política exige arquitetura desacoplada, typed contracts, durable authority, least privilege, worktrees independentes, crash convergence, tests/evidence objetivos, ownership explícito, documentação e disciplina Git. Papéis típicos incluem Architect, Implementer, Tester, Supervisor, Researcher e Operator.

[Documentação de Company Governance](docs/company-governance.md)

<!-- readme-section:completion -->
## Modelo de tarefas e conclusão

O GAM não considera “o Assistant respondeu” como “o trabalho terminou”. Cada completion policy exige terminal evidence.

- `structured-result` aceita somente um bloco terminal JSON `<GAM_RESULT>` estrito.
- `verified-claim` exige Kernel-provisioned workspace, exact HEAD SHA, scoped claim e Kernel verification.
- `review-pass` só aceita um review protocol válido e aprovado; fail/malformed review não é sucesso.
- `human-approval` mantém uma fronteira explícita de human authority.

```text
Task → isolated worktree → commit → WorkClaim → machine verification
     → independent review → integration/promotion authority
```

<!-- readme-section:parallelism -->
## Paralelismo e controle de prompts

DAG edges representam dependencies reais, não throttling artificial. Trabalho independente pode executar em paralelo em AgentSlots/worktrees diferentes.

Prompt Dispatch Governor aplica global spacing, rolling-window budget, Project/AgentSlot spacing, concurrent-generation capacity e rate-limit backoff antes do envio físico ao composer. Uma entrega `uncertain` nunca é reenviada automaticamente.

Exact Task Dispatch planner seleciona somente o ready task solicitado e não inclui tarefas de outros ProjectCells.

<!-- readme-section:browser-lifecycle -->
## Ciclo de vida do navegador e recuperação

Uma browser page é um execution lease, não uma durable identity. Workers trusted-idle excedentes podem ser suspensos e ter a tab fechada preservando AgentSlot, conversation, checkpoint, evidence e Git history.

Generating, unknown/unavailable, quarantined, rollover-active e effect-active são fail closed. Stuck-Generation Convergence combina page/slot facts, attempt, deadline e engineering progress recente antes de solicitar authority-checked stop.

<!-- readme-section:self-hosting -->
## Self-hosting recursivo

O GAM suporta Parent → isolated Candidate → evidence-gated promotion. Repo, `GAM_HOME`, SQLite DB, pipe e browser profile devem ser diferentes entre Parent e Candidate.

Candidate não pode self-approve. Promotion exige exact parent/candidate SHA e evidence independente, mantendo reject-preserve e replay/crash convergence.

<!-- readme-section:quick-start -->
## Início rápido

O deployment path atual de Native Messaging é voltado principalmente ao Windows.

- Windows 10/11
- Node.js 22+
- Chrome ou Microsoft Edge (Chromium)
- .NET 9 SDK/runtime somente ao compilar Native Host a partir do source

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

`GAM.cmd` usa um Chromium profile dedicado e inicia o local Kernel de forma idempotente. O usuário entra diretamente em `chatgpt.com`; GAM não armazena password, MFA secret, cookie nem account token e não precisa de OpenAI API key.

<!-- readme-section:security -->
## Limites de segurança

- Host permission limitado a `https://chatgpt.com/*`.
- Native Messaging restrito ao pinned extension origin.
- Native Host nunca possui o GAM admin token.
- Worker capability scoped por project/task/resource/lease; apenas token hash é persistido.
- `gamctl` não possui implicit admin fallback; operações privilegiadas exigem `--admin` explícito.
- unknown/stale/ambiguous/conflicting authority usa fail closed.
- Candidate self-promotion é rejeitado.
- GAM é uma coordination/policy layer, não um OS sandbox; filesystem/terminal precisam de isolamento host/container.

<!-- readme-section:development -->
## Desenvolvimento e verificação

Mudanças devem passar type check, architecture, unit/fault e smoke gates; releases também exigem README i18n release gate.

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
## Estrutura do repositório

```text
src/            Browser extension runtime and typed policies
control/        Deterministic Kernel, SQLite authority, RPC, leases, evidence
native-host/    Chromium Native Messaging bridge
scripts/        Build, verification, packaging, smoke, and Windows setup tools
tests/          Browser/runtime/unit/fault tests
docs/           Architecture and operational documentation
```

<!-- readme-section:contributing -->
## Como contribuir

Preserve explicit ownership, typed boundaries, durable facts, least privilege, Git worktrees isolados, tests objetivos, documentação e review independente. Não amplie permissões browser/native nem contorne evidence gates por conveniência.

Para mudanças grandes, use branch/worktree dedicado, adicione focused tests, execute wider gates relevantes e registre o exact commit SHA revisado.

<!-- readme-section:scope -->
## Escopo atual

O GAM foca atualmente o ChatGPT Web em `chatgpt.com`. Generic LLM APIs, hosted orchestration, integrações Claude/Gemini e coding-agent CLI providers estão fora do product scope atual.

<!-- readme-section:license -->
## Licença

Este projeto usa [Apache-2.0](LICENSE) e inclui [NOTICE](NOTICE) e [Third-Party Notices](THIRD_PARTY_NOTICES.md). O `LICENSE` oficial em inglês na raiz do repositório é a referência jurídica authoritative.

<!-- readme-section:status -->
## Status de desenvolvimento

Charterion está em active development. Um Release Candidate só é considerado stable após passar repository verification, README i18n release gate e evidence-based review/promotion boundaries.
