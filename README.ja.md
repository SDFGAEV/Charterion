# GPT Agent Manager

[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Chromium](https://img.shields.io/badge/Chromium-Manifest%20V3-4285F4.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.5.0-2ea44f.svg)](manifest.json)
[![ChatGPT Web](https://img.shields.io/badge/target-ChatGPT%20Web-111111.svg)](https://chatgpt.com/)

<!-- readme-i18n:navigation:start -->
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <strong>日本語</strong> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>
<!-- readme-i18n:navigation:end -->

**複数の ChatGPT Web 会話を、永続的でロールベースの Agent 組織として運用するためのローカルファーストなエンジニアリング control plane。**

> GAM は ChatGPT Web を調整します。API Provider で ChatGPT を置き換えず、アカウント資格情報を保存せず、モデルの prose 自体を engineering authority とみなしません。

---

<!-- readme-section:overview -->
## 概要

GPT Agent Manager（GAM）は、複数の ChatGPT Web 会話を永続的な engineering Worker として管理し、ローカルの deterministic Kernel が Agent identity、Project、Git、lease、capability、evidence、review、recovery state を保持します。ブラウザ tab は交換可能な runtime surface であり、Agent の Source of Truth ではありません。

GAM は tab automation ではなく小規模なソフトウェア会社のように動作することを目標にしています。Worker は隔離された scope で作業し、Supervisor は exact evidence をレビューし、Kernel が authority boundary を強制します。

<!-- readme-section:capabilities -->
## 主要機能

- **永続 Agent identity** — `AgentSlot` は tab ID や単一 ChatGPT 会話から独立します。
- **Project isolation** — `ProjectCell`、Git worktree、lease、epoch、scoped capability で並列作業を分離します。
- **Company governance** — 各 task に versioned Company System Policy と deterministic Role Charter を自動注入します。
- **Typed completion authority** — `structured-result`、`verified-claim`、`review-pass`、`human-approval` で evidence と prose を分離します。
- **Machine-verifiable work** — exact commit SHA、branch/worktree、lease identity、evidence を検証します。
- **独立 Supervisor** — Implementer は self-approve できません。
- **Parallel work + backpressure** — 独立 task は並列実行でき、prompt governor が burst を制御します。
- **Elastic browser fleet** — trusted-idle Worker は conversation/durable state を削除せず suspend + close できます。
- **Crash convergence** — uncertain send、cleanup、lease、capability fencing を fail-closed/replay で収束させます。
- **Recursive self-hosting** — Parent GAM が隔離 Candidate を開発し、exact evidence で promotion を判断します。

<!-- readme-section:architecture -->
## アーキテクチャ

Kernel が durable authority を保持し、ブラウザは許可済み effect の実行面として扱われます。

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
## コア概念

| 概念 | 責務 |
| --- | --- |
| `ProjectCell` | 永続 Project/Team 境界、capacity policy、repository root |
| `AgentSlot` | 永続 Worker identity と lifecycle |
| `AgentConversationRecord` | Agent と ChatGPT conversation generation の永続 mapping |
| Task | dependency と completion authority を持つ typed work item |
| Task workspace | 隔離 Git worktree、branch、lease、capability、base SHA |
| `WorkClaim` | exact evidence に結び付いた machine-verifiable completion claim |
| Supervisor | 独立した review/integration authority |
| GAM Kernel | durable state と authorization の deterministic owner |

<!-- readme-section:organization -->
## 会社型 Agent 管理

すべての task は会社ポリシー、Role Charter、Task Brief の固定優先順位で構成され、下位のテキストは上位の authority を拡張できません。

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

組織ポリシーは decoupled architecture、typed contract、durable authority、least privilege、独立 worktree、crash convergence、客観的 test/evidence、明確な ownership、documentation、Git discipline を要求します。代表ロールは Architect、Implementer、Tester、Supervisor、Researcher、Operator です。

[Company Governance ドキュメント](docs/company-governance.md)

<!-- readme-section:completion -->
## タスクと完了モデル

GAM は「Assistant が返信した」ことを作業完了とはみなしません。completion policy ごとに terminal evidence が必要です。

- `structured-result` は唯一の厳密な `<GAM_RESULT>` JSON terminal block のみ受理します。
- `verified-claim` は Kernel-provisioned workspace、exact HEAD SHA、scoped claim、Kernel verification を要求します。
- `review-pass` は有効な pass review protocol のみ成功とし、fail/malformed review を terminal success にしません。
- `human-approval` は明示的な human authority を維持します。

```text
Task → isolated worktree → commit → WorkClaim → machine verification
     → independent review → integration/promotion authority
```

<!-- readme-section:parallelism -->
## 並列実行とプロンプト制御

DAG edge は実際の dependency だけを表し、throttling のために無関係 task を直列化しません。異なる AgentSlot/worktree の独立作業は並列に実行できます。

Prompt Dispatch Governor は composer へ送信する直前に global spacing、rolling-window budget、Project/AgentSlot spacing、concurrent-generation capacity、rate-limit backoff を適用します。`uncertain` delivery は自動再送しません。

Exact Task Dispatch planner は指定した ready task だけを選び、別 ProjectCell の ready task を巻き込みません。

<!-- readme-section:browser-lifecycle -->
## ブラウザのライフサイクルと復旧

Browser page は execution lease であり durable identity ではありません。余剰 trusted-idle Worker は suspend して tab を閉じても、AgentSlot、conversation、checkpoint、evidence、Git history を保持できます。

Generating、unknown/unavailable、quarantined、rollover-active、effect-active は fail closed です。Stuck-Generation Convergence は page/slot facts、attempt、deadline、最近の engineering progress を組み合わせて authority-checked stop の可否を判断します。

<!-- readme-section:self-hosting -->
## 再帰的 self-hosting

GAM は Parent → isolated Candidate → evidence-gated promotion をサポートします。Parent/Candidate の repo、`GAM_HOME`、SQLite DB、pipe、browser profile は分離必須です。

Candidate は self-approve できず、promotion は exact parent/candidate SHA と独立 evidence を要求し、reject-preserve と replay/crash convergence を維持します。

<!-- readme-section:quick-start -->
## クイックスタート

現在の Native Messaging deployment path は Windows を主対象としています。

- Windows 10/11
- Node.js 22+
- Chrome または Microsoft Edge（Chromium）
- .NET 9 SDK/runtime（Native Host を source build する場合のみ）

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

`GAM.cmd` は専用 Chromium profile を使い、local Kernel を idempotent に起動します。ユーザーは公式 `chatgpt.com` に直接ログインし、GAM は password、MFA secret、cookie、account token を保存せず、OpenAI API key も不要です。

<!-- readme-section:security -->
## セキュリティ境界

- Host permission は `https://chatgpt.com/*` のみに限定します。
- Native Messaging は pinned extension origin のみ許可します。
- Native Host は GAM admin token を保持しません。
- Worker capability は project/task/resource/lease で scope され、永続化は token hash のみです。
- `gamctl` に implicit admin fallback はなく、privileged operation は明示的な `--admin` が必要です。
- unknown/stale/ambiguous/conflicting authority は fail closed です。
- Candidate self-promotion は拒否されます。
- GAM は coordination/policy layer であり OS sandbox ではありません。filesystem/terminal は host/container policy で隔離してください。

<!-- readme-section:development -->
## 開発と検証

変更は type check、architecture、unit/fault、smoke gate を通す必要があり、release では README i18n release gate も要求されます。

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
## リポジトリ構成

```text
src/            Browser extension runtime and typed policies
control/        Deterministic Kernel, SQLite authority, RPC, leases, evidence
native-host/    Chromium Native Messaging bridge
scripts/        Build, verification, packaging, smoke, and Windows setup tools
tests/          Browser/runtime/unit/fault tests
docs/           Architecture and operational documentation
```

<!-- readme-section:contributing -->
## コントリビューション

変更は explicit ownership、typed boundary、durable facts、least privilege、隔離 Git worktree、客観 test、documentation、独立 review を維持してください。利便性のために browser/native 権限を広げたり evidence gate を迂回しないでください。

大きな変更は独立 branch/worktree を使い、focused tests と必要な wider gates を実行し、exact commit SHA を review 対象として記録してください。

<!-- readme-section:scope -->
## 現在のスコープ

GAM は現在 `chatgpt.com` 上の ChatGPT Web に集中しています。Generic LLM API、hosted orchestration、Claude/Gemini integration、coding-agent CLI provider は現在の product scope 外です。

<!-- readme-section:license -->
## ライセンス

このプロジェクトは [Apache-2.0](LICENSE) で提供され、[NOTICE](NOTICE) と [Third-Party Notices](THIRD_PARTY_NOTICES.md) を含みます。法的に authoritative なのは repository root の英語 `LICENSE` です。

<!-- readme-section:status -->
## 開発状況

GPT Agent Manager は active development 中です。Release Candidate は repository verification、README i18n release gate、evidence-based review/promotion boundary を通過して初めて stable と扱われます。
