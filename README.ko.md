# Charterion: Open-Source Multi-Agent Engineering Control Plane for ChatGPT Web Agents

[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Chromium](https://img.shields.io/badge/Chromium-Manifest%20V3-4285F4.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.5.0-2ea44f.svg)](manifest.json)
[![ChatGPT Web](https://img.shields.io/badge/target-ChatGPT%20Web-111111.svg)](https://chatgpt.com/)
[![Latest Release](https://img.shields.io/github/v/release/SDFGAEV/Charterion?display_name=tag)](https://github.com/SDFGAEV/Charterion/releases/latest)

<!-- readme-i18n:navigation:start -->
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <strong>한국어</strong> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>
<!-- readme-i18n:navigation:end -->

**여러 ChatGPT Web 대화를 지속적이고 역할 기반인 Agent 조직으로 운영하기 위한 로컬 우선 엔지니어링 control plane.**

> GAM은 ChatGPT Web을 조정합니다. API Provider로 ChatGPT를 대체하지 않고, 계정 자격 증명을 저장하지 않으며, 모델의 prose 자체를 engineering authority로 취급하지 않습니다.

---

<!-- readme-section:overview -->
## 개요

Charterion는 여러 ChatGPT Web 대화를 지속적인 engineering Worker로 관리하고, 로컬 deterministic Kernel이 Agent identity, Project, Git, lease, capability, evidence, review, recovery state를 보존합니다. 브라우저 tab은 교체 가능한 runtime surface이며 Agent의 Source of Truth가 아닙니다.

GAM은 단순한 tab 자동화 도구보다 작은 소프트웨어 회사에 가깝게 동작하도록 설계되었습니다. Worker는 격리된 scope에서 작업하고 Supervisor는 exact evidence를 검토하며 Kernel이 authority boundary를 강제합니다.

<!-- readme-section:capabilities -->
## 핵심 기능

- **지속적인 Agent identity** — `AgentSlot`은 tab ID와 개별 ChatGPT conversation에서 분리됩니다.
- **Project isolation** — `ProjectCell`, Git worktree, lease, epoch, scoped capability로 병렬 작업을 분리합니다.
- **Company governance** — 각 task에 versioned Company System Policy와 deterministic Role Charter가 자동 주입됩니다.
- **Typed completion authority** — `structured-result`, `verified-claim`, `review-pass`, `human-approval`로 evidence와 prose를 분리합니다.
- **Machine-verifiable work** — exact commit SHA, branch/worktree, lease identity, evidence를 검증합니다.
- **독립 Supervisor** — Implementer는 self-approve할 수 없습니다.
- **Parallel work + backpressure** — 독립 task는 병렬 실행되고 prompt governor가 burst를 제어합니다.
- **Elastic browser fleet** — trusted-idle Worker는 conversation/durable state를 삭제하지 않고 suspend + close할 수 있습니다.
- **Crash convergence** — uncertain send, cleanup, lease, capability fencing을 fail-closed/replay로 수렴시킵니다.
- **Recursive self-hosting** — Parent GAM이 격리 Candidate를 개발하고 exact evidence로 promotion을 결정합니다.

<!-- readme-section:architecture -->
## 아키텍처

Kernel이 durable authority를 소유하고 브라우저는 승인된 effect를 실행하는 surface로만 사용됩니다.

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
## 핵심 개념

| 개념 | 책임 |
| --- | --- |
| `ProjectCell` | 지속적인 Project/Team 경계, capacity policy, repository root |
| `AgentSlot` | 지속적인 Worker identity와 lifecycle |
| `AgentConversationRecord` | Agent와 ChatGPT conversation generation 간의 지속 mapping |
| Task | dependency와 completion authority를 가진 typed work item |
| Task workspace | 격리 Git worktree, branch, lease, capability, base SHA |
| `WorkClaim` | exact evidence에 연결된 machine-verifiable completion claim |
| Supervisor | 독립 review/integration authority |
| GAM Kernel | durable state와 authorization의 deterministic owner |

<!-- readme-section:organization -->
## 회사형 Agent 관리

모든 task는 회사 정책, Role Charter, Task Brief의 고정 우선순위로 구성되며 하위 텍스트가 상위 authority를 확장할 수 없습니다.

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

조직 정책은 decoupled architecture, typed contract, durable authority, least privilege, 독립 worktree, crash convergence, 객관적 test/evidence, 명확한 ownership, documentation, Git discipline을 요구합니다. 대표 역할은 Architect, Implementer, Tester, Supervisor, Researcher, Operator입니다.

[Company Governance 문서](docs/company-governance.md)

<!-- readme-section:completion -->
## 작업 및 완료 모델

GAM은 “Assistant가 답변했다”를 작업 완료로 간주하지 않습니다. 각 completion policy는 terminal evidence를 요구합니다.

- `structured-result`는 하나의 엄격한 `<GAM_RESULT>` JSON terminal block만 허용합니다.
- `verified-claim`은 Kernel-provisioned workspace, exact HEAD SHA, scoped claim, Kernel verification을 요구합니다.
- `review-pass`는 유효한 pass review protocol만 성공으로 처리하며 fail/malformed review는 성공이 아닙니다.
- `human-approval`은 명시적인 human authority 경계를 유지합니다.

```text
Task → isolated worktree → commit → WorkClaim → machine verification
     → independent review → integration/promotion authority
```

<!-- readme-section:parallelism -->
## 병렬 실행과 프롬프트 페이싱

DAG edge는 실제 dependency만 표현하며 throttling을 위해 독립 task를 직렬화하지 않습니다. 서로 다른 AgentSlot/worktree의 독립 작업은 병렬 실행할 수 있습니다.

Prompt Dispatch Governor는 composer에 실제 전송하기 직전에 global spacing, rolling-window budget, Project/AgentSlot spacing, concurrent-generation capacity, rate-limit backoff를 적용합니다. `uncertain` delivery는 자동 재전송하지 않습니다.

Exact Task Dispatch planner는 지정된 ready task 하나만 선택하며 다른 ProjectCell의 ready task를 함께 선택하지 않습니다.

<!-- readme-section:browser-lifecycle -->
## 브라우저 수명주기와 복구

Browser page는 execution lease이며 durable identity가 아닙니다. 초과 trusted-idle Worker는 suspend 후 tab을 닫아도 AgentSlot, conversation, checkpoint, evidence, Git history를 유지합니다.

Generating, unknown/unavailable, quarantined, rollover-active, effect-active는 모두 fail closed입니다. Stuck-Generation Convergence는 page/slot facts, attempt, deadline, 최근 engineering progress를 결합해 authority-checked stop 가능 여부를 판단합니다.

<!-- readme-section:self-hosting -->
## 재귀적 self-hosting

GAM은 Parent → isolated Candidate → evidence-gated promotion 구조를 지원합니다. Parent/Candidate의 repo, `GAM_HOME`, SQLite DB, pipe, browser profile은 반드시 분리되어야 합니다.

Candidate는 self-approve할 수 없고 promotion은 exact parent/candidate SHA와 독립 evidence를 요구하며 reject-preserve 및 replay/crash convergence를 유지합니다.

<!-- readme-section:quick-start -->
## 빠른 시작

현재 Native Messaging deployment path는 Windows를 주 대상으로 합니다.

- Windows 10/11
- Node.js 22+
- Chrome 또는 Microsoft Edge(Chromium)
- .NET 9 SDK/runtime(Native Host를 source build할 때만 필요)

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

`GAM.cmd`는 전용 Chromium profile을 사용하고 local Kernel을 idempotent하게 시작합니다. 사용자는 공식 `chatgpt.com`에 직접 로그인하며 GAM은 password, MFA secret, cookie, account token을 저장하지 않고 OpenAI API key도 필요하지 않습니다.

<!-- readme-section:security -->
## 보안 경계

- Host permission은 `https://chatgpt.com/*`로 제한됩니다.
- Native Messaging은 pinned extension origin만 허용합니다.
- Native Host는 GAM admin token을 보유하지 않습니다.
- Worker capability는 project/task/resource/lease 기준으로 scope되며 persistent storage에는 token hash만 저장됩니다.
- `gamctl`에는 implicit admin fallback이 없고 privileged operation은 명시적 `--admin`이 필요합니다.
- unknown/stale/ambiguous/conflicting authority는 fail closed입니다.
- Candidate self-promotion은 거부됩니다.
- GAM은 coordination/policy layer이지 OS sandbox가 아닙니다. filesystem/terminal은 host/container policy로 격리해야 합니다.

<!-- readme-section:development -->
## 개발 및 검증

변경은 type check, architecture, unit/fault, smoke gate를 통과해야 하며 release 시 README i18n release gate가 추가됩니다.

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
## 저장소 구조

```text
src/            Browser extension runtime and typed policies
control/        Deterministic Kernel, SQLite authority, RPC, leases, evidence
native-host/    Chromium Native Messaging bridge
scripts/        Build, verification, packaging, smoke, and Windows setup tools
tests/          Browser/runtime/unit/fault tests
docs/           Architecture and operational documentation
```

<!-- readme-section:contributing -->
## 기여 지침

모든 변경은 explicit ownership, typed boundary, durable facts, least privilege, 격리 Git worktree, 객관적 test, documentation, 독립 review를 유지해야 합니다. 편의를 위해 browser/native 권한을 넓히거나 evidence gate를 우회하지 마십시오.

큰 변경은 독립 branch/worktree를 사용하고 focused tests와 필요한 wider gates를 실행한 뒤 exact commit SHA를 review 대상으로 기록하십시오.

<!-- readme-section:scope -->
## 현재 범위

GAM은 현재 `chatgpt.com`의 ChatGPT Web에 집중합니다. Generic LLM API, hosted orchestration, Claude/Gemini integration, coding-agent CLI provider는 현재 product scope 밖입니다.

<!-- readme-section:license -->
## 라이선스

이 프로젝트는 [Apache-2.0](LICENSE)으로 제공되며 [NOTICE](NOTICE)와 [Third-Party Notices](THIRD_PARTY_NOTICES.md)를 포함합니다. 법적 authority는 repository root의 영문 `LICENSE`에 있습니다.

<!-- readme-section:status -->
## 개발 상태

Charterion는 active development 상태입니다. Release Candidate는 repository verification, README i18n release gate, evidence-based review/promotion boundary를 통과한 뒤에만 stable로 취급됩니다.
