# Charterion: Open-Source Multi-Agent Engineering Control Plane for ChatGPT Web Agents

[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Chromium](https://img.shields.io/badge/Chromium-Manifest%20V3-4285F4.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.4.1-2ea44f.svg)](manifest.json)
[![ChatGPT Web](https://img.shields.io/badge/target-ChatGPT%20Web-111111.svg)](https://chatgpt.com/)
[![Latest Release](https://img.shields.io/github/v/release/SDFGAEV/Charterion?display_name=tag)](https://github.com/SDFGAEV/Charterion/releases/latest)

<!-- readme-i18n:navigation:start -->
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.fr.md">Français</a> · <strong>Deutsch</strong> · <a href="README.ru.md">Русский</a></p>
<!-- readme-i18n:navigation:end -->

**Eine local-first Engineering-Control-Plane, die mehrere ChatGPT-Web-Unterhaltungen in persistente, rollengebundene Software-Engineering-Agents verwandelt.**

<!-- readme-section:overview -->
## Überblick

Charterion koordiniert mehrere **ChatGPT-Web-Unterhaltungen** als persistente Engineering-Worker und stützt sie sie auf eine dauerhafte lokale Control Plane für Projekte, Git-Arbeit, Reviews, Ressourcen und Recovery.

Die Runtime behält aus Kompatibilitätsgründen die vorhandenen Befehlsnamen `GAM`, `gamd` und `gamctl`;
 **Charterion** ist der öffentliche Projektname.

Der Fokus liegt bewusst auf `chatgpt.com`: kein OpenAI-API-Key, kein gehostetes Charterion-Backend und kein Versuch, ChatGPT Web durch eine Provider-API uu ersetzen.

<!-- readme-section:architecture -->
## Architektur

Charterion besteht aus vier Runtime-Komponenten:

- **Chrome/Edge Extension** — erkennt `chatgpt.com`-Tabs, bindet Role/Project-Identitäten, routet Prompts, beobachtet Antworten und rendert das Side Panel.

- **`gamd`** — der deterministische lokale Kernel. Er besitzt SQLite-Autorität, Projekte, Leases, Capabilities, Evidence, Change Requests, Supervisor-Reviews, Fleet-State und Merge-Queue-State.

- **Native Messaging Host** — eine schmale Chromium ↔ `gamd`-Bridge über eine Windows named pipe. Er erhält niemals den Administrator-Token.

- **`GAM` / `gamctl`** — Start- und Steuerungsclients für Menschen und Maschinen.

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
## Bedienung durch Menschen und Agents

Menschen können die dedizierte Chromium-Runtime mit `GAM.cmd` starten. Autorisierte Remote Agents können denselben Kernel über deterministische JSON/CLI-Befehle nutzen, ohne die UI uu scrapen.

Charterion speichert keine ChatGPT-Passwörter, MFA-Gebheimnisse, Cookies oder Account-Tokens. Der Nutzer meldet sich direkt auf der offiziellen ChatGPT-Seite im dedizierten Browserprofil an.

```powershell
GAM.cmd
GAM.cmd status --json
GAM.cmd start --json
GAM.cmd open "My Project" --json
GAM.cmd doctor --json
```

<!-- readme-section:git-workflow -->
## Git- und Change-Request-Workflow

Bei Softwareprojekten ist eine Modellantwort kein Engineering-Abschluss. Arbeit wird an Git und maschinelle Evidence gebunden und vor der Integration von einem unabhängigen Supervisor geprüft.

Zu den Invarianten gehören exakte `baseSha`/`headSha`-Bindung, keine Selbstfreigabe, Ungültigkeit alter Reviews nach einem neuen head, Evidence-Prüfung vor dem Queueing, Konflikterkennung gegen den neuesten target branch und unabhängige Beobachtung der Integration in der Git-Historie.

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
## Browser-Orchestrierung

Die Browser-Plane bietet persistente Role/Project-Bindings, task-DAG-Routing, `work`/`review`/`human`-Tasktypen, dauerhafte Skip/Cancel/Retry-Fakten, begrenzte Review-Schleifen, einen semantischen Message Bus, Send-Attempt-Recovery, fail-closed Behandlung mehrdeutiger Zustellung, portablen Browser-State und einen optionalen Auto Supervisor.

Der vom Supervisor verwaltete desired state eines `AgentSlot` ist von der Browser-Beobachtung getrennt. Worker können mit begrenzter Autorität erstellt, suspendiert, fortgesetzt oder retired werden; draining Worker erhalten keine neue Arbeit mehr, bevor ihre Tabs geschlossen werden.

<!-- readme-section:control-plane -->
## Dauerhafte lokale Control Plane

Der Kernel persistiert Projekt-, Agent-, Ressourcen-, Lease-, Capability-, Request-, WorkClaim-, Evidence-, Review-, Merge-Queue- und Browser-Runtime-Fakten in SQLite.

SQLite nutzt foreign keys, WAL mode, strict tables und transaktionale Zustandsänderungen. Lease epochs und scoped capabilities grenzen veraltete Worker ab. Objektive Maschinenfakten werden deterministisch verifiziert; Architektur und Engineering-Qualität bleiben Supervisor-Entscheidungen.

<!-- readme-section:quick-start -->
## Schnellstart

Das aktuelle Deployment zielt auf Windows 10/11 mit Node.js 22+, Chrome oder Edge und .NET 9 beim Bauen des Native Host aus dem Quellcode.

Aus einem Source-Checkout:

```powershell
npm install
npm run verify:full
npm run setup:windows
```

Bei einer paketierten Windows-Runtime das Archiv entpacken und `SETUP.cmd` ausführen.

<!-- readme-section:security -->
## Sicherheitsgrenzen

- Die host permission der Extension ist auf `https://chatgpt.com/*` beschränkt.

- Der Native Host verwendet eine enge allowlist und erhält niemals den GAM-Administrator-Token.

- Worker-Capabilities sind auf project/task/resource/lease begrenzt und werden nur als token hash gespeichert.

- `gamctl` besitzt keinen impliziten Administrator-Fallback.

- Unbekannte, veraltete, mehrdeutige oder widersprüchliche Autorität schlägt fail-closed fehl.

Charterion ist eine Koordinations- und Policy-Schicht, **keine Betriebssystem-Sandbox**. Filesystem- oder Terminal-Tools benötigen weiterhin ihre eigene VM-/Container-/Capability-Grenze.

<!-- readme-section:verification -->
## Verifikation und Release

Das schnelle Gate prüft TypeScript, Control-Plane-Typen, statische Assets, README-Sprachinvarianten, Tests und Builds. Das vollständige Gate ergänzt Native-Host-Publishing und prozessbasierte Smoke Tests.

Release-Artefakte werden mit SHA-256-Sidecars erzeugt.

```powershell
npm run verify
npm run verify:full
npm run release
```

<!-- readme-section:development -->
## Entwicklungsprinzipien

1. ChatGPT-Web-Unterhaltungen sind die cognition plane; Provider-APIs dürfen nicht stillschweigend ersetzt werden.

2. Git und dauerhafte Maschinenbeobachtungen sind Engineering-Fakten; Modelltext ist Behauptung oder Erklärung.

3. Worker erhalten große Entscheidungsfreiheit innerhalb enger, expliziter Autorität.

4. Supervisors treffen Engineering-Entscheidungen; deterministischer Code erzwingt unveränderliche Policies.

5. Fakten persistieren und Status ableiten; veraltete Versuche durch Identitäten und epochs abgrenzen.

6. Bei unsicherer Zustellung, Identität, ownership oder Integration fail-closed reagiëren.

<!-- readme-section:scope -->
## Umfang

Charterion zielt derzeit auf **ChatGPT Web unter `chatgpt.com`**. Generische LLM-APIs, gehostete Orchestrierung, Claude/Gemini-Integrationen und coding-agent CLI provider liegen außerhalb des aktuellen Produktumfangs.

<!-- readme-section:license -->
## Lizenz

Lizunziert unter [Apache-2.0](LICENSE). Siehe [NOTICE](NOTICE) und [Third-Party Notices](THIRD_PARTY_NOTICES.md).

<!-- readme-section:status -->
## Entwicklungssstatus

Charterion wird aktiv entwickelt. Der Default-Branch repräsentiert derzeit den Funktionsumfang v0.4.1; neuere experimentelle Funktionen werden erst nach formaler Integration hier dokumentiert.
