# Charterion: Open-Source Multi-Agent Engineering Control Plane for ChatGPT Web Agents

[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Chromium](https://img.shields.io/badge/Chromium-Manifest%20V3-4285F4.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.5.0-2ea44f.svg)](manifest.json)
[![ChatGPT Web](https://img.shields.io/badge/target-ChatGPT%20Web-111111.svg)](https://chatgpt.com/)
[![Latest Release](https://img.shields.io/github/v/release/Xalzeroph/Charterion?display_name=tag)](https://github.com/Xalzeroph/Charterion/releases/latest)

<!-- readme-i18n:navigation:start -->
<p align="center"><a href="README.md">English</a> · <strong>简体中文</strong> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>
<!-- readme-i18n:navigation:end -->

**一个本地优先的工程控制平面，把多个 ChatGPT Web 对话组织成持久、基于角色的 Agent 团队。**

> GAM 负责协调 ChatGPT Web。它不使用 API Provider 取代 ChatGPT，不保存账户凭据，也不把模型回复本身当成工程 authority。

---

<!-- readme-section:overview -->
## 项目简介

Charterion把多个 **ChatGPT Web 对话**组织成具有持久身份、岗位分工和工程权限边界的 Agent 团队，并由本地确定性的 GAM Kernel 管理项目、Git、租约、能力令牌、证据、审查和恢复状态。

浏览器标签页只是可替换的运行载体，不是 Agent 的真实身份。GAM 的目标不是“批量操控网页”，而是把多个 GPT Worker 管理成一个小型软件工程组织。

<!-- readme-section:capabilities -->
## 核心能力

- **持久 Agent 身份**：`AgentSlot` 与浏览器 tab ID、单个 ChatGPT 对话解耦。
- **项目隔离**：`ProjectCell`、Git worktree、lease、epoch 与 scoped capability 隔离并发工作。
- **公司级治理**：每个任务自动注入版本化 Company System Policy 和岗位 Role Charter，再进入具体任务说明。
- **Typed 完成协议**：`structured-result`、`verified-claim`、`review-pass`、`human-approval` 把“模型回复”与“工程完成”分开。
- **机器可验证的软件开发**：Kernel 校验 exact commit SHA、分支/worktree、lease 与 evidence 后才允许完成。
- **独立 Supervisor 审查**：Worker 不能自批，审查权限和实现权限分离。
- **并行开发 + 发送背压**：真正独立的工程任务可以并行，消息发送由账号级 Governor 控速。
- **弹性浏览器集群**：多余的可信 idle Worker 页面可以 suspend + close，但不会删除会话和持久 Agent 状态。
- **崩溃收敛**：uncertain send、workspace cleanup、lease、capability fencing 都按照 fail-closed / replay / convergence 设计。
- **递归自托管**：稳定 Parent GAM 可以开发隔离 Candidate GAM，并通过客观证据决定是否晋级。

<!-- readme-section:architecture -->
## 架构

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

| 概念 | 含义 |
| --- | --- |
| `ProjectCell` | 项目团队/事业部边界、容量策略、代码根目录 |
| `AgentSlot` | 持久员工/Worker 身份与生命周期 |
| `AgentConversationRecord` | Agent 与某一代 ChatGPT 对话之间的持久关联 |
| Task | 带依赖关系与完成权限的 typed 工单 |
| Task workspace | 独立 Git worktree、branch、lease、capability、base SHA |
| `WorkClaim` | 绑定 exact evidence 的机器可验证完工包 |
| Supervisor | 独立 Tech Lead / 审查与集成权限 |
| GAM Kernel | 公司制度、事实账本和授权边界的确定性 authority |

<!-- readme-section:organization -->
## 公司化 Agent 管理

所有任务提示词按固定优先级组成：

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

公司制度强制要求：**高度解耦、系统化、typed contract、持久 authority、最小权限、独立 worktree、崩溃收敛、客观测试/证据、明确 ownership、文档与 Git 规范**。任务文本、依赖输出或模型 prose 都不能扩大 Agent 权限。

典型岗位包括 **Architect、Implementer、Tester、Supervisor、Researcher、Operator**。详见 [`docs/company-governance.md`](docs/company-governance.md)。

<!-- readme-section:completion -->
## 任务完成与审查

GAM 不会把“Assistant 有回复”直接等同于“任务完成”。

- `structured-result` 要求唯一且严格的 `<GAM_RESULT>` 终止块；`Read`、`OK`、`acknowledged` 等占位回复只会进入 attention。
- `verified-claim` 要求 Kernel 分配的 workspace、提交后的 exact HEAD SHA、scoped claim 和 Kernel verification。
- `review-pass` 只有严格合法的通过审查结果才是完成；失败或 malformed review 不能释放 Reviewer demand。
- `human-approval` 保持明确的人类批准边界。

软件任务的标准链路是：

```text
Task → isolated worktree → commit → WorkClaim → machine verification
     → independent review → integration/promotion authority
```

<!-- readme-section:parallelism -->
## 并行与消息限流

DAG 只表示**真实依赖关系**，不再为了限流把无关任务强行串行。不同 AgentSlot / worktree 的独立任务可以同时执行。

真正的消息压力由 Prompt Dispatch Governor 控制：全局发送间隔、滚动时间窗预算、Project/AgentSlot 间隔、并发 generation 容量，以及检测到 ChatGPT rate-limit UI 后的持久指数退避。`uncertain` 投递不会自动重发，必须先消除不确定性。

Exact Task Dispatch 模块提供 fail-closed 的单任务选择核心：指定 taskId 时只允许选中该 ready task，不会顺带选择其他 ProjectCell 的 ready task。在同一 ready wave 中，分配采用最少候选优先、角色专长匹配、持久会话优先与确定性 tie-break，优先为约束更强的任务保留稀缺兼容 Agent；后续物理发送仍必须经过原有 workspace authority 与 prompt governor。

<!-- readme-section:browser-lifecycle -->
## 浏览器生命周期与恢复

浏览器页面只是运行 lease，不是持久 Worker 身份。GAM 可以把超过项目需求的可信 idle Worker suspend 并关闭 tab，同时保留 AgentSlot、ChatGPT 会话、checkpoint、evidence 与 Git 历史；未来出现新任务时恢复原有 Worker，而不是默认制造重复身份。

Generating、unknown/unavailable、quarantined、rollover-active 或 effect-active 页面全部 fail closed。Stuck-Generation Convergence 模块会结合 GAM-owned page/slot 事实、attempt 状态、stale deadline 和近期工程进展证据判断是否继续等待或请求 authority-checked stop，并且绝不会因为 uncertain send 自动重发。

<!-- readme-section:self-hosting -->
## 递归自托管

GAM 支持 **Parent → 隔离 Candidate → Evidence-Gated Promotion** 架构。

Parent 与 Candidate 的 repo、`GAM_HOME`、SQLite database、named pipe、browser profile 必须互相独立。Candidate 不能自我批准；Promotion Authority 要求 exact candidate/parent SHA 与独立 evidence，支持 replay/crash convergence，并在拒绝后保留 Candidate 源码和证据用于检查。

<!-- readme-section:quick-start -->
## 快速开始

#### 环境要求

- Windows 10/11（当前 Native Messaging 部署路径）
- Node.js 22+
- Chrome 或 Microsoft Edge（Chromium）
- 仅从源码构建 Native Host 时需要 .NET 9 SDK/runtime

```powershell
npm install
npm run verify:full
npm run setup:windows
```

#### 常用命令

```powershell
GAM.cmd status --json
GAM.cmd start --json
GAM.cmd open "My Project" --json
GAM.cmd doctor --json
```

GAM 使用独立 Chromium profile。用户只在官方 `chatgpt.com` 页面正常登录；GAM 不保存密码、MFA secret、cookie 或账号 token，也不需要 OpenAI API key。

For the complete local, source, release, and Remote Desktop Commander deployment procedure, see [Deployment Guide](https://github.com/Xalzeroph/Charterion/blob/main/docs/DEPLOYMENT.md).

<!-- readme-section:security -->
## 安全边界

- Host permission 仅限 `https://chatgpt.com/*`。
- Native Messaging 只接受固定 extension origin。
- Native Host 永远不持有 GAM admin token。
- Worker capability 按 project/task/resource/lease 做 scoped authority，并只持久化 token hash。
- `gamctl` 没有隐式 admin fallback；高权限操作必须显式 `--admin`。
- unknown / stale / ambiguous / conflicting authority 一律 fail closed。
- Candidate self-promotion 会被拒绝。
- GAM 是协调与策略层，**不是操作系统 sandbox**；filesystem/terminal 权限仍应由 VM/container/host policy 隔离。

<!-- readme-section:development -->
## 开发与验证

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
## 目录结构

```text
src/            Browser extension runtime and typed policies
control/        Deterministic Kernel, SQLite authority, RPC, leases, evidence
native-host/    Chromium Native Messaging bridge
scripts/        Build, verification, packaging, smoke, and Windows setup tools
tests/          Browser/runtime/unit/fault tests
docs/           Architecture and operational documentation
```

<!-- readme-section:contributing -->
## 贡献规范

所有修改都应继续遵守 GAM 的工程制度：明确 ownership、typed boundary、durable facts、least privilege、隔离 Git worktree、客观测试、文档和独立 review。不要为了方便扩大浏览器/native 权限，也不要绕过 evidence gate。

较大的修改建议使用独立 branch/worktree，补 focused tests，再运行相关 wider gates，并以 exact commit SHA 作为审查对象。

<!-- readme-section:scope -->
## 当前范围

GAM 当前专注于 **`chatgpt.com` 上的 ChatGPT Web**。通用 LLM API、托管式多模型编排、Claude/Gemini 集成与 coding-agent CLI provider 暂不属于当前产品范围。

<!-- readme-section:license -->
## 协议

本项目使用 [Apache-2.0](LICENSE)，并提供 [NOTICE](NOTICE) 与 [第三方依赖声明](THIRD_PARTY_NOTICES.md)。许可证法律效力以仓库根目录英文 `LICENSE` 原文为准。

<!-- readme-section:status -->
## 开发状态

Charterion 仍在持续开发。任何 Release Candidate 都必须通过仓库验证套件、README i18n release gate，以及基于证据的独立审查/晋级边界，才能被视为稳定版本。
