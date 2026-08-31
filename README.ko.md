# Charterion: Open-Source Multi-Agent Engineering Control Plane for ChatGPT Web Agents

[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Chromium](https://img.shields.io/badge/Chromium-Manifest%20V3-4285F4.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.4.1-2ea44f.svg)](manifest.json)
[![ChatGPT Web](https://img.shields.io/badge/target-ChatGPT%20Web-111111.svg)](https://chatgpt.com/)

<!-- readme-i18n:navigation:start -->
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <strong>한국어</strong> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>
<!-- readme-i18n:navigation:end -->

**여러 ChatGPT Web 대화를 지속적이고 역할 기반인 소프트웨어 엔지니어링 Agent로 만드는 로컬 우선 엔지니어링 컨트롤 플레인.**

<!-- readme-section:overview -->
## 개요

Charterion은 여러 **ChatGPT Web 대화**를 지속적인 엔지니어링 Worker로 조정하고 프로젝트, Git 작업, 리뷰, 리소스, 복구를 내구성 있는 로컬 컨트롤 플레인으로 관리합니다.

런타임 호환성을 위해 명령 이름은 `GAM`, `gamd`, `gamctl`을 유지하며 공개 프로젝트 이름은 **Charterion**입니다.

`chatgpt.com`에 집중하며 OpenAI API 튤나 호스팅 Charterion 백엔드가 필요하지 않고 ChatGPT Web을 공급자 API로 대체하지 않습니다.

<!-- readme-section:architecture -->
## 아키텍처

Charterion은 네 개의 런타임 구성 요소로 이루어집니다.

- **Chrome/Edge Extension** — `chatgpt.com` 탭을 발견하고 Role/Project ID를 연결하며 프롬프트를 라우팅하고 응답을 관찰해 Side Panel을 렌더링합니다.

- **`gamd`** — 결정론적 로컬 Kernel로 SQLite 권한 상태, 프로젝트, lease, capability, 증거, Change Request, Supervisor 리뷰, Worker Fleet, merge queue를 소유합니다.

- **Native Messaging Host** — Windows named pipe를 통한 좁은 Chromium ↔ `gamd` 브리지이며 관리자 토큰을 받지 않습니다.

- **`GAM` / `gamctl`** — 사람과 기계를 위한 시작/제어 클라이언트입니다.

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
## 사람 및 Agent 작업

사람은 `GAM.cmd` 전용 Chromium 런타임을 시작할 수 있습니다. 권한 있는 Remote Agent는 UI 스크래핑 없이 결정론적 JSON/CLI 명령으로 같은 Kernel을 사용합니다.

Charterion은 ChatGPT 비밀번호, MFA 비밀, Cookie, 계정 토큰을 저장하지 않습니다. 사용자는 전용 브라우저 프로필의 공식 ChatGPT 페이지에서 직접 로그인합니다.

```powershell
GAM.cmd
GAM.cmd status --json
GAM.cmd start --json
GAM.cmd open "My Project" --json
GAM.cmd doctor --json
```

<!-- readme-section:git-workflow -->
## Git 및 Change Request 워크플로

소프트웨어 프로젝트에서는 모델 응답만으로 완료를 인정하지 않습니다. 작업은 Git과 머신 증거에 묶이고 독립 Supervisor의 리뷰 후 통합됩니다.

정확한 `baseSha`/`headSha` 바인딩, 자기 승인 금지, 새 head 이후 이전 리뷰 무효화, queue 전 머신 증거 확인, 최신 target branch 충돌 확인, Git 기록에서의 독립적 통합 관찰을 강제합니다.

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
## 브라우저 오케스트레이션

지속 Role/Project 바인딩, task DAG, `work`/`review`/`human`, 내구성 있는 Skip/Cancel/Retry, 제한된 review loop, semantic message bus, send-attempt 복구, 불확실한 전달의 fail-closed, browser state 이동, 선택적 Auto Supervisor를 제공합니다.

Supervisor 관리 `AgentSlot` desired state와 브라우저 관찰은 분리됩니다. Worker는 scoped authority로 spawn/suspend/resume/retire되며 draining 중 새 작업을 받지 않습니다.

<!-- readme-section:control-plane -->
## 내구성 있는 로컬 컨트롤 플레인

Kernel은 프로젝트, Agent, 리소스, lease, capability, 요청, WorkClaim, 증거, 리뷰, merge queue, browser runtime 사실을 SQLite에 지속화합니다.

SQLite는 foreign key, WAL, strict tables, 트랜잭션을 사용합니다. lease epoch와 scoped capability가 오래된 Worker를 차단하며 객관적 사실은 결정론적으로 검증되고 아키텍처 품질은 Supervisor가 판단합니다.

<!-- readme-section:quick-start -->
## 빠른 시작

현재 대상은 Windows 10/11, Node.js 22+, Chrome/Edge이며 Native Host를 소스에서 빌드할 때 .NET 9가 필요합니다.

소스 checkout에서:

```powershell
npm install
npm run verify:full
npm run setup:windows
```

패키지된 Windows Runtime은 압축을 풀고 `SETUP.cmd`를 실행합니다.

<!-- readme-section:security -->
## 보안 경계

- Extension host permission은 `https://chatgpt.com/*`로 제한됩니다.

- Native Host는 좁은 allowlist를 사용하며 GAM 관리자 토큰을 받지 않습니다.

- Worker capability는 project/task/resource/lease에 scope되고 token hash만 저장됩니다.

- `gamctl`에는 암묵적 관리자 fallback이 없습니다.

- 알 수 없거나 오래되었거나 모호하거나 충돌하는 권한 상태는 fail closed입니다.

Charterion은 조정/정책 계층이며 **운영체제 샌드박스가 아닙니다**. 파일/터미널 도구에는 별도의 VM/컨테이너/capability 경계가 필요합니다.

<!-- readme-section:verification -->
## 검증 및 릴리스

빠른 gate는 TypeScript, control-plane 타입, 정적 자산, README 다국어 불변조건, 테스트와 빌드를 검사합니다. 전체 gate는 Native Host publish와 프로세스 수준 smoke test를 추가합니다.

Release 산출물에는 SHA-256 sidecar가 생성됩니다.

```powershell
npm run verify
npm run verify:full
npm run release
```

<!-- readme-section:development -->
## 개발 원칙

1. ChatGPT Web 대화는 cognition plane이며 공급자 API로 조용히 대체하지 않습니다.

2. Git과 내구성 있는 머신 관찰은 엔지니어링 사실이며 모델 문장은 주장 또는 설명입니다.

3. 좁고 명시적인 권한 안에서 Worker에 넓은 판단 자유를 줍니다.

4. Supervisor가 엔지니어링 판단을 하고 결정론적 코드가 불변 정책을 강제합니다.

5. 사실을 지속화하고 상태를 유도하며 ID와 epoch로 오래된 시도를 fence합니다.

6. 전달, ID, 소유권, 통합 상태가 불확실하면 fail closed합니다.

<!-- readme-section:scope -->
## 범위

Charterion은 현재 **`chatgpt.com`의 ChatGPT Web**을 대상으로 합니다. 범욨 LLM API, 호스팅 오케스트레이션, Claude/Gemini 통합, coding-agent CLI provider는 현재 범위 밖입니다.

<!-- readme-section:license -->
## 라이선스

[Apache-2.0](LICENSE) 라이선스를 사용합니다. [NOTICE](NOTICE) 및 [Third-Party Notices](THIRD_PARTY_NOTICES.md)도 참고하세요.

<!-- readme-section:status -->
## 개발 상태

Charterion은 개발 중입니다. 기본 브랜치는 현재 v0.4.1 기능 집합을 나타내며 새로운 실험 기능은 정식 통합 후에만 문서화됩니다.
