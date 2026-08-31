# Charterion: Open-Source Multi-Agent Engineering Control Plane for ChatGPT Web Agents

[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Chromium](https://img.shields.io/badge/Chromium-Manifest%20V3-4285F4.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.4.1-2ea44f.svg)](manifest.json)
[![ChatGPT Web](https://img.shields.io/badge/target-ChatGPT%20Web-111111.svg)](https://chatgpt.com/)

<!-- readme-i18n:navigation:start -->
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <strong>日本語</strong> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>
<!-- readme-i18n:navigation:end -->

**複数の ChatGPT Web 会話を、永続的で役割ベースのソフトウェアエンジニアリング Agent に変えるローカルファーストのエンジニアリング制御プレーン。**

<!-- readme-section:overview -->
## 概要

Charterion は複数の **ChatGPT Web 会話**を永続的なエンジニアリング Worker として調整し、プロジェクト、Git 作業、レビュー、リソース、リカバリを耐久性のあるローカル制御プレーンで管理します。

実行時亖換性のためコマンド名は `GAM`、`gamd`、`gamctl` を維持し、公開プロジェクト名は **Charterion** です。

対象は `chatgpt.com` に限定され、OpenAI API キーやホスト型 Charterion バックエンドを必要とせず、ChatGPT Web をプロバイダー API に置き換えません。

<!-- readme-section:architecture -->
## アーキテクチャ

Charterion は 4 つの実行時コンポーネントで構成されます。

- **Chrome/Edge Extension** — `chatgpt.com` タブを検出し、Role/Project ID を関連付け、プロンプトをルーティングし、応答を観測して Side Panel を表示します。

- **`gamd`** — 決定論的なローカル Kernel。SQLite 権限状態、プロジェクト、リース、Capability、証拠、Change Request、Supervisor レビュー、Worker Fleet、マージキューを所有します。

- **Native Messaging Host** — Windows named pipe を介した Chromium ↔ `gamd` の狭いブリッジで、管理者トークンは受け取りません。

- **`GAM` / `gamctl`** — 人間および機械向けの起動・制御クライアントです。

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
## 人間と Agent の操作

人間は `GAM.cmd` で専用 Chromium ランタイムを起動できます。許可された Remote Agent は UI をスクレイピングせず、同じ Kernel を決定論的な JSON/CLI コマンドで操作できます。

Charterion は ChatGPT のパスワード、MFA シークレット、Cookie、アカウントトークンを保存しません。ユーザーは専用ブラウザプロファイル内の公式 ChatGPT ページで直接ログインします。

```powershell
GAM.cmd
GAM.cmd status --json
GAM.cmd start --json
GAM.cmd open "My Project" --json
GAM.cmd doctor --json
```

<!-- readme-section:git-workflow -->
## Git / Change Request ワークフロー

ソフトウェア作業ではモデルの返答だけを完了とは扱いません。作業は Git と機械証拠に結び付け、独立した Supervisor のレビューを経て統合されます。

`baseSha`/`headSha` の厳密な束縛、自己承認禁止、新しい head 後の旧レビュー失効、キュー投入前の機械証拠検証、最新 target branch との競合確認、Git 履歴からの独立した統合確認を強制します。

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
## ブラウザオーケストレーション

永続 Role/Project バインド、タスク DAG、`work`/`review`/`human`、耐久 Skip/Cancel/Retry、有限レビュー、セマンティックメッセージバス、送信試行の復旧、不確実な配信の fail-closed、ブラウザ状態移行、任意の Auto Supervisor を提供します。

Supervisor 管理の `AgentSlot` の desired state とブラウザ観測は分離されています。Worker はスコープ付き権限で spawn/suspend/resume/retire され、draining 中は新規作業を受けません。

<!-- readme-section:control-plane -->
## 耐久ローカル制御プレーン

Kernel はプロジェクト、Agent、リソース、リース、Capability、リクエスト、WorkClaim、証拠、レビュー、マージキュー、ブラウザ実行時の事実を SQLite に永続化します。

SQLite は外部キー、WAL、strict tables、トランザクションを使用します。lease epoch とスコープ付き Capability が古い Worker をフェンスし、客観的事実は決定論的に検証、設計品質は Supervisor が判断します。

<!-- readme-section:quick-start -->
## クイックスタート

現在の対象は Windows 10/11、Node.js 22+、Chrome/Edge で、Native Host をソースからビルドする場合は .NET 9 が必要です。

ソース checkout から：

```powershell
npm install
npm run verify:full
npm run setup:windows
```

パッケージ済み Windows Runtime は展開して `SETUP.cmd` を実行します。

<!-- readme-section:security -->
## セキュリティ境界

- Extension の host permission は `https://chatgpt.com/*` のみに限定されます。

- Native Host は狭い allowlist を使用し、GAM 管理者トークンを受け取りません。

- Worker Capability は project/task/resource/lease にスコープされ、token hash のみ保存されます。

- `gamctl` に暗黙の管理者フォールバックはありません。

- 不明・古い・曖昧・競合する権限状態は fail closed です。

Charterion は調整・ポリシー層であり、**OS サンドボックスではありません**。ファイルや端末ツールには別の VM/コンテナ/Capability 境界が必要です。

<!-- readme-section:verification -->
## 検証とリリース

高速 gate は TypeScript、control-plane 型、静的アセット、README 多言語不変条件、テスト、ビルドを検証します。完全 gate は Native Host publish とプロセスレベル smoke test を追加します。

Release には SHA-256 sidecar が生成されます。

```powershell
npm run verify
npm run verify:full
npm run release
```

<!-- readme-section:development -->
## 開発原則

1. ChatGPT Web 会話を cognition plane とし、プロバイダー API に暗黙置換しない。

2. Git と耐久的な機械観測を工程上の事実とし、モデル文は主張または説明として扱う。

3. 狭く明示的な権限内で Worker に広い判断自由を与える。

4. Supervisor が工程判断を行い、決定論的コードが不変条件を強制する。

5. 事実を永続化して状態を導出し、ID と epoch で古い試行をフェンスする。

6. 配信、ID、所有権、統合状態が不確実なら fail closed にする。

<!-- readme-section:scope -->
## スコープ

Charterion は現在 **`chatgpt.com` 上の ChatGPT Web** を対象とします。汎用 LLM API、ホスト型オーケストレーション、Claude/Gemini 連携、coding-agent CLI provider は対象外です。

<!-- readme-section:license -->
## ライセンス

[Apache-2.0](LICENSE) でライセンスされています。[NOTICE](NOTICE) と [Third-Party Notices](THIRD_PARTY_NOTICES.md) も参照してください。

<!-- readme-section:status -->
## 開発状況

Charterion は開発中です。default branch は現在 v0.4.1 の能力セットを表し、新しい実験機能は正式統合後にのみ記載されます。
