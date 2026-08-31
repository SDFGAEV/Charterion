# Charterion: Open-Source Multi-Agent Engineering Control Plane for ChatGPT Web Agents

[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Chromium](https://img.shields.io/badge/Chromium-Manifest%20V3-4285F4.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.4.1-2ea44f.svg)](manifest.json)
[![ChatGPT Web](https://img.shields.io/badge/target-ChatGPT%20Web-111111.svg)](https://chatgpt.com/)
[![Latest Release](https://img.shields.io/github/v/release/SDFGAEV/Charterion?display_name=tag)](https://github.com/SDFGAEV/Charterion/releases/latest)

<!-- readme-i18n:navigation:start -->
<p align="center"><a href="README.md">English</a> · <strong>简体中文</strong> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>
<!-- readme-i18n:navigation:end -->

**一个本地优先的工程控制平面：把多个 ChatGPT 网页对话组织成持久、按角色分工的软件工程 Agent。**

<!-- readme-section:overview -->
## 项目简介

Charterion 将多个 **ChatGPT Web 对话**协调为持久化工程 Worker，并通过本地耐久控制平面管理项目、Git 工作、审查、资源与恢复。

为保持运行时兼容，命令仍使用 `GAM`、`gamd` 和 `gamctl`；**Charterion** 是项目对外公开名称。

项目明确聚焦 `chatgpt.com`：不需要 OpenAI API Key，不提供托管式 Charterion 后端，也不会用供应商 API 替代 ChatGPT Web。

<!-- readme-section:architecture -->
## 架构

Charterion 由四个运行时组件组成：

- **Chrome/Edge 扩展** — 发现 `chatgpt.com` 标签页，绑定 Role/Project 身份，路由提示词、观察回复并渲染 Side Panel。

- **`gamd`** — 确定性的本地 Kernel，拥有 SQLite 权威状态、项目、租约、能力令牌、证据、Change Request、Supervisor 审查、Worker Fleet 与合并队列状态。

- **Native Messaging Host** — 通过 Windows named pipe 连接 Chromium 与 `gamd` 的窄接口桥接层，绝不接收管理员令牌。

- **`GAM` / `gamctl`** — 面向人类与机器的启动/控制客户端。

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
## 人类与 Agent 操作

人类可以通过 `GAM.cmd` 启动专用 Chromium 运行时；获得授权的远程 Agent 可以通过确定性的 JSON/CLI 命令访问同一个 Kernel，而不需要抓取 UI 文本。

Charterion 不保存 ChatGPT 密码、MFA 密钥、Cookie 或账户令牌。用户直接在专用浏览器配置文件中的官方 ChatGPT 页面登录。

```powershell
GAM.cmd
GAM.cmd status --json
GAM.cmd start --json
GAM.cmd open "My Project" --json
GAM.cmd doctor --json
```

<!-- readme-section:git-workflow -->
## Git 与 Change Request 工作流

对软件项目而言，模型回复本身不等于工程完成。工作必须绑定 Git 与机器证据，并由独立 Supervisor 审查后才能进入集成。

关键不变量包括：精确绑定 `baseSha`/`headSha`、禁止自审、head 更新后旧审查失效、进入队列前验证机器证据、针对最新目标分支检查冲突，以及从 Git 历史独立确认集成结果。

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
## 浏览器编排

浏览器平面支持持久 Role/Project 绑定、任务 DAG 路由、`work`/`review`/`human` 任务类型、耐久 Skip/Cancel/Retry 事实、有界审查循环、语义消息总线、发送尝试恢复、对歧义投递的 fail-closed 处理、浏览器状态迁移以及可选 Auto Supervisor。

Supervisor 管理的 `AgentSlot` 期望状态与浏览器观察状态相互分离。Worker 只能在受限权限下被创建、挂起、恢复或退役；进入 draining 后停止接收新任务，再关闭标签页。

<!-- readme-section:control-plane -->
## 耐久本地控制平面

Kernel 使用 SQLite 持久化项目、Agent、资源、租约、能力、请求、WorkClaim、证据、审查、合并队列和浏览器运行时事实。

SQLite 启用外键、WAL、strict tables 与事务式状态变更。租约 epoch 和作用域化 capability 用于隔离陈旧 Worker。客观机器事实由确定性逻辑验证，架构与工程质量仍由 Supervisor 判断。

<!-- readme-section:quick-start -->
## 快速开始

当前部署目标为 Windows 10/11、Node.js 22+、Chrome 或 Edge；从源码构建 Native Host 时需要 .NET 9。

从源码 checkout：

```powershell
npm install
npm run verify:full
npm run setup:windows
```

使用打包好的 Windows Runtime 时，解压后运行 `SETUP.cmd`。

<!-- readme-section:security -->
## 安全边界

- 扩展 host permission 仅允许 `https://chatgpt.com/*`。

- Native Host 使用窄 allowlist，永不接收 GAM 管理员令牌。

- Worker capability 绑定到项目/任务/资源/租约身份，并仅以 token hash 形式存储。

- `gamctl` 不存在隐式管理员回退。

- 权威状态未知、陈旧、歧义或冲突时一律 fail closed。

Charterion 是协调与策略层，**不是操作系统沙箱**。文件系统或终端工具仍需要独立的 VM、容器或 capability 边界。

<!-- readme-section:verification -->
## 验证与发布

快速 gate 覆盖 TypeScript、control-plane 类型、静态资源、README 多语言不变量、测试与构建；完整 gate 还包含 Native Host 发布和进程级 smoke tests。

Release 产物同时生成 SHA-256 sidecar。

```powershell
npm run verify
npm run verify:full
npm run release
```

<!-- readme-section:development -->
## 开发原则

1. ChatGPT Web 对话是认知平面，不得静默替换为供应商 API。

2. Git 与耐久机器观察是工程事实；模型文本只是声明或解释。

3. 在狭窄、明确的权限范围内给予 Worker 尽可能大的决策自由。

4. Supervisor 负责工程判断，确定性代码负责执行不变量策略。

5. 持久化事实并推导状态；使用身份和 epoch 隔离陈旧尝试。

6. 投递、身份、所有权或集成状态不确定时必须 fail closed。

<!-- readme-section:scope -->
## 范围

Charterion 当前聚焦 **`chatgpt.com` 上的 ChatGPT Web**。通用 LLM API、托管式编排、Claude/Gemini 集成和 coding-agent CLI provider 不在当前产品范围内。

<!-- readme-section:license -->
## 许可证

采用 [Apache-2.0](LICENSE) 许可证。另见 [NOTICE](NOTICE) 与 [Third-Party Notices](THIRD_PARTY_NOTICES.md)。

<!-- readme-section:status -->
## 开发状态

Charterion 正在持续开发。默认分支当前对应 v0.4.1 能力集；更新的实验能力只有在正式集成后才会写入这里。
