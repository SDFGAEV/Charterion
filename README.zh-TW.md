# GPT Agent Manager

[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Chromium](https://img.shields.io/badge/Chromium-Manifest%20V3-4285F4.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.5.0-2ea44f.svg)](manifest.json)
[![ChatGPT Web](https://img.shields.io/badge/target-ChatGPT%20Web-111111.svg)](https://chatgpt.com/)

<!-- readme-i18n:navigation:start -->
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <strong>繁體中文</strong> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>
<!-- readme-i18n:navigation:end -->

**一個本地優先的工程控制平面，把多個 ChatGPT Web 對話組織成持久、基於角色的 Agent 團隊。**

> GAM 負責協調 ChatGPT Web；它不以 API Provider 取代 ChatGPT、不保存帳戶憑證，也不把模型文字本身視為工程 authority。

---

<!-- readme-section:overview -->
## 專案概覽

GPT Agent Manager（GAM）把多個 ChatGPT Web 對話管理成持久工程 Worker，並由本地 deterministic Kernel 保存 Agent 身分、專案、Git、lease、capability、evidence、review 與 recovery state。瀏覽器 tab 是可替換的 runtime surface，不是 Agent 的 Source of Truth。

GAM 的目標更接近小型軟體公司，而不是 tab 自動化器：Worker 在隔離 scope 內工作，Supervisor 審查 exact evidence，Kernel 強制 authority boundary。

<!-- readme-section:capabilities -->
## 核心能力

- **持久 Agent 身分** — `AgentSlot` 與 tab ID、單一對話解耦。
- **專案隔離** — `ProjectCell`、Git worktree、lease、epoch 與 scoped capability 隔離並行工作。
- **公司治理** — task 自動帶入 versioned Company System Policy 與 deterministic Role Charter。
- **Typed completion authority** — `structured-result`、`verified-claim`、`review-pass`、`human-approval` 將證據與 prose 分離。
- **Machine-verifiable work** — exact commit SHA、branch/worktree、lease identity 與 evidence 都要驗證。
- **獨立 Supervisor** — Implementer 不能 self-approve。
- **並行 + backpressure** — 真正獨立的 task 可同時執行，prompt governor 控制訊息 burst。
- **Elastic browser fleet** — trusted-idle Worker 可 suspend + close，但不刪除 conversation 或 durable Agent state。
- **Crash convergence** — uncertain send、cleanup、lease、capability fencing 以 fail-closed/replay 收斂。
- **Recursive self-hosting** — Parent GAM 可開發隔離 Candidate，並以 exact evidence 決定 promotion。

<!-- readme-section:architecture -->
## 架構

Kernel 是 durable authority；瀏覽器只執行已授權的 effect。

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
## 核心概念

| 概念 | 責任 |
| --- | --- |
| `ProjectCell` | 持久專案/團隊邊界、容量策略與 repository root |
| `AgentSlot` | 持久 Worker 身分與生命週期 |
| `AgentConversationRecord` | Agent 與某一代 ChatGPT conversation 的持久映射 |
| Task | 帶 dependency 與 completion authority 的 typed 工單 |
| Task workspace | 隔離 Git worktree、branch、lease、capability 與 base SHA |
| `WorkClaim` | 綁定 exact evidence 的可驗證完工聲明 |
| Supervisor | 獨立 review/integration authority |
| GAM Kernel | durable state 與 authorization 的 deterministic owner |

<!-- readme-section:organization -->
## 公司化 Agent 管理

每個 task 都以固定優先順序組合公司制度、崗位責任與 task brief；下層文字不能擴張上層 authority。

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

組織制度要求高度解耦、typed contract、durable authority、least privilege、獨立 worktree、crash convergence、客觀測試/evidence、明確 ownership、文件與 Git discipline。典型角色包含 Architect、Implementer、Tester、Supervisor、Researcher、Operator。

[公司治理文件](docs/company-governance.md)

<!-- readme-section:completion -->
## 任務與完成模型

GAM 不把「Assistant 有回覆」直接等同於完成。不同 completion policy 對 terminal evidence 有不同要求。

- `structured-result` 只接受唯一且嚴格的 `<GAM_RESULT>` JSON terminal block。
- `verified-claim` 要求 Kernel-provisioned workspace、exact HEAD SHA、scoped claim 與 Kernel verification。
- `review-pass` 只接受合法且通過的 review protocol；fail/malformed review 不是成功。
- `human-approval` 保留明確的人類批准邊界。

```text
Task → isolated worktree → commit → WorkClaim → machine verification
     → independent review → integration/promotion authority
```

<!-- readme-section:parallelism -->
## 並行與訊息節流

DAG edge 只表示真實 dependency，不拿來做人為限流。不同 AgentSlot/worktree 的獨立工作可以並行。

Prompt Dispatch Governor 在實際送進 ChatGPT composer 前套用全域間隔、rolling-window budget、Project/AgentSlot spacing、concurrent-generation capacity 與平台 rate-limit backoff。`uncertain` delivery 不會自動重送。

Exact Task Dispatch planner 只選指定的 ready task，不順帶選其他 ProjectCell 的工作。

<!-- readme-section:browser-lifecycle -->
## 瀏覽器生命週期與恢復

Browser page 是 execution lease，不是 durable identity。超出需求的 trusted-idle Worker 可以 suspend 並關閉 tab，同時保留 AgentSlot、conversation、checkpoint、evidence 與 Git history。

Generating、unknown/unavailable、quarantined、rollover-active、effect-active 狀態全部 fail closed。Stuck-Generation Convergence 會結合 page/slot facts、attempt、deadline 與近期工程進度來判斷是否需要 authority-checked stop。

<!-- readme-section:self-hosting -->
## 遞迴自託管

GAM 支援 Parent → isolated Candidate → evidence-gated promotion。Parent 與 Candidate 的 repo、`GAM_HOME`、SQLite DB、pipe、browser profile 必須分離。

Candidate 不得 self-approve；promotion 要求 exact parent/candidate SHA、獨立 evidence，並支援 reject-preserve 與 replay/crash convergence。

<!-- readme-section:quick-start -->
## 快速開始

目前 Native Messaging 部署路徑以 Windows 為主。

- Windows 10/11
- Node.js 22+
- Chrome 或 Microsoft Edge（Chromium）
- .NET 9 SDK/runtime（僅從 source build Native Host 時需要）

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

`GAM.cmd` 使用專用 Chromium profile，並以 idempotent 方式啟動 local Kernel。使用者只在官方 `chatgpt.com` 登入；GAM 不保存 password、MFA secret、cookie、account token，也不需要 OpenAI API key。

<!-- readme-section:security -->
## 安全邊界

- Host permission 僅限 `https://chatgpt.com/*`。
- Native Messaging 僅接受 pinned extension origin。
- Native Host 不持有 GAM admin token。
- Worker capability 依 project/task/resource/lease 做 scope，持久層只保存 token hash。
- `gamctl` 沒有 implicit admin fallback；privileged operation 必須明確 `--admin`。
- unknown/stale/ambiguous/conflicting authority 一律 fail closed。
- Candidate self-promotion 會被拒絕。
- GAM 是 coordination/policy layer，不是 OS sandbox；filesystem/terminal 仍需 host/container policy 隔離。

<!-- readme-section:development -->
## 開發與驗證

完整變更至少應通過 type check、architecture、unit/fault 與 smoke gate；release 另加 README i18n release gate。

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
## 倉庫結構

```text
src/            Browser extension runtime and typed policies
control/        Deterministic Kernel, SQLite authority, RPC, leases, evidence
native-host/    Chromium Native Messaging bridge
scripts/        Build, verification, packaging, smoke, and Windows setup tools
tests/          Browser/runtime/unit/fault tests
docs/           Architecture and operational documentation
```

<!-- readme-section:contributing -->
## 貢獻規範

所有修改都應保持明確 ownership、typed boundary、durable facts、least privilege、隔離 Git worktree、客觀測試、文件與獨立 review。不要為了方便擴大 browser/native 權限或繞過 evidence gate。

較大的變更應使用獨立 branch/worktree，補 focused tests，執行相關 wider gates，並以 exact commit SHA 作為 review 對象。

<!-- readme-section:scope -->
## 目前範圍

GAM 目前專注 `chatgpt.com` 上的 ChatGPT Web。Generic LLM API、hosted orchestration、Claude/Gemini integration 與 coding-agent CLI provider 不屬於目前產品範圍。

<!-- readme-section:license -->
## 授權條款

本專案採用 [Apache-2.0](LICENSE)，並提供 [NOTICE](NOTICE) 與 [第三方依賴聲明](THIRD_PARTY_NOTICES.md)。法律效力以 repository root 的英文 `LICENSE` 原文為準。

<!-- readme-section:status -->
## 開發狀態

GPT Agent Manager 仍在持續開發。Release Candidate 必須通過 repository verification、README i18n release gate，以及 evidence-based review/promotion boundary，才可視為 stable。
