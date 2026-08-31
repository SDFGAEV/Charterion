# Charterion: Open-Source Multi-Agent Engineering Control Plane for ChatGPT Web Agents

[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Chromium](https://img.shields.io/badge/Chromium-Manifest%20V3-4285F4.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.4.1-2ea44f.svg)](manifest.json)
[![ChatGPT Web](https://img.shields.io/badge/target-ChatGPT%20Web-111111.svg)](https://chatgpt.com/)
[![Latest Release](https://img.shields.io/github/v/release/SDFGAEV/Charterion?display_name=tag)](https://github.com/SDFGAEV/Charterion/releases/latest)

<!-- readme-i18n:navigation:start -->
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <strong>繁體中文</strong> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>
<!-- readme-i18n:navigation:end -->

**一個本地優先的工程控制平面：把多個 ChatGPT 網頁對話組織成持久、按角色分工的軟體工程 Agent。**

<!-- readme-section:overview -->
## 專案簡介

Charterion 將多個 **ChatGPT Web 對話**協調為持久化工程 Worker，並以本地耐久控制平面管理專案、Git 工作、審查、資源與恢復。

為維持執行期相容，命令仍使用 `GAM`、`gamd` 與 `gamctl`；**Charterion** 是專案公開名稱。

專案明確聚焦 `chatgpt.com`：不需要 OpenAI API Key、不提供託管式 Charterion 後端，也不會以供應商 API 取代 ChatGPT Web。

<!-- readme-section:architecture -->
## 架構

Charterion 由四個執行期元件組成：

- **Chrome/Edge 擴充功能** — 探索 `chatgpt.com` 分頁、綁定 Role/Project 身分、路由提示、觀察回覆並呈現 Side Panel。

- **`gamd`** — 確定性的本地 Kernel，持有 SQLite 權威狀態、專案、租約、能力、證據、Change Request、Supervisor 審查、Worker Fleet 與合併佇列。

- **Native Messaging Host** — 透過 Windows named pipe 連接 Chromium 與 `gamd` 的窄橋接層，絕不接收管理員令牌。

- **`GAM` / `gamctl`** — 面向人類與機器的啟動/控制客戶端。

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
## 人類與 Agent 操作

人類可透過 `GAM.cmd` 啟動專用 Chromium 執行環境；獲授權的遠端 Agent 可透過確定性的 JSON/CLI 命令使用同一個 Kernel，而不用擷取 UI 文字。

Charterion 不儲存 ChatGPT 密碼、MFA 密鑰、Cookie 或帳戶令牌。使用者直接在專用瀏覽器設定檔中的官方 ChatGPT 頁面登入。

```powershell
GAM.cmd
GAM.cmd status --json
GAM.cmd start --json
GAM.cmd open "My Project" --json
GAM.cmd doctor --json
```

<!-- readme-section:git-workflow -->
## Git 與 Change Request 工作流程

對軟體專案而言，模型回覆本身不等於工程完成。工作必須綁定 Git 與機器證據，並由獨立 Supervisor 審查後才能整合。

核心不變量包括精確綁定 `baseSha`/`headSha`、禁止自我核准、head 更新後舊審查失效、排隊前驗證機器證據、針對最新目標分支檢查衝突，以及從 Git 歷史獨立確認整合。

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
## 瀏覽器編排

瀏覽器平面支援持久 Role/Project 綁定、任務 DAG 路由、`work`/`review`/`human` 任務類型、耐久 Skip/Cancel/Retry 事實、有界審查迴圈、語意訊息匯流排、傳送嘗試恢復、歧義投遞的 fail-closed 處理、瀏覽器狀態移轉與可選 Auto Supervisor。

Supervisor 管理的 `AgentSlot` 期望狀態與瀏覽器觀察狀態分離。Worker 僅能在受限權限下被建立、暫停、恢復或退役；draining 後停止接收新工作，再關閉分頁。

<!-- readme-section:control-plane -->
## 耐久本地控制平面

Kernel 以 SQLite 持久化專案、Agent、資源、租約、能力、請求、WorkClaim、證據、審查、合併佇列與瀏覽器執行期事實。

SQLite 啟用外鍵、WAL、strict tables 與交易式狀態變更。租約 epoch 與作用域 capability 隔離陳舊 Worker；客觀機器事實由確定性邏輯驗證，架構與工程品質仍由 Supervisor 判斷。

<!-- readme-section:quick-start -->
## 快速開始

目前部署目標為 Windows 10/11、Node.js 22+、Chrome 或 Edge；從原始碼建置 Native Host 時需要 .NET 9。

從原始碼 checkout：

```powershell
npm install
npm run verify:full
npm run setup:windows
```

使用打包好的 Windows Runtime 時，解壓縮後執行 `SETUP.cmd`。

<!-- readme-section:security -->
## 安全邊界

- 擴充功能 host permission 僅允許 `https://chatgpt.com/*`。

- Native Host 使用窄 allowlist，永不接收 GAM 管理員令牌。

- Worker capability 綁定專案/任務/資源/租約身分，並只以 token hash 儲存。

- `gamctl` 沒有隱式管理員回退。

- 權威狀態未知、陳舊、歧義或衝突時一律 fail closed。

Charterion 是協調與策略層，**不是作業系統沙箱**。檔案系統或終端工具仍需要獨立 VM、容器或 capability 邊界。

<!-- readme-section:verification -->
## 驗證與發佈

快速 gate 涵蓋 TypeScript、control-plane 型別、靜態資源、README 多語言不變量、測試與建置；完整 gate 另外包含 Native Host 發佈和程序級 smoke tests。

Release 產物同時產生 SHA-256 sidecar。

```powershell
npm run verify
npm run verify:full
npm run release
```

<!-- readme-section:development -->
## 開發原則

1. ChatGPT Web 對話是認知繳面，不得靜默替換成供應商 API。

2. Git 與耐久機器觀察是工程事實；模型文字只是聲明或解釋。

3. 在狹窄、明確的權限範圍內給 Worker 最大決策自由。

4. Supervisor 負責工程判斷，確定性程式碼執行不變量策略。

5. 持久化事實並推導狀態；以身分與 epoch 隔離陳舊嘗試。

6. 投遞、身分、所有權或整合狀態不確定時必須 fail closed。

<!-- readme-section:scope -->
## 範圍

Charterion 目前聚焦 **`chatgpt.com` 上的 ChatGPT Web**。通用 LLM API、託管式編排、Claude/Gemini 整合與 coding-agent CLI provider 不在目前產品範圍內。

<!-- readme-section:license -->
## 授權

採用 [Apache-2.0](LICENSE) 授權。另見 [NOTICE](NOTICE) 與 [Third-Party Notices](THIRD_PARTY_NOTICES.md)。

<!-- readme-section:status -->
## 開發狀態

Charterion 持續開發中。預設分支目前對應 v0.4.1 能力集；較新的實驗能力只有正式整合後才會記錄於此。
