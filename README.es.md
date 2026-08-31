# Charterion: Open-Source Multi-Agent Engineering Control Plane for ChatGPT Web Agents

[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Chromium](https://img.shields.io/badge/Chromium-Manifest%20V3-4285F4.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.4.1-2ea44f.svg)](manifest.json)
[![ChatGPT Web](https://img.shields.io/badge/target-ChatGPT%20Web-111111.svg)](https://chatgpt.com/)
[![Latest Release](https://img.shields.io/github/v/release/SDFGAEV/Charterion?display_name=tag)](https://github.com/SDFGAEV/Charterion/releases/latest)

<!-- readme-i18n:navigation:start -->
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <strong>Español</strong> · <a href="README.pt-BR.md">Português (Brasil)</a> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>
<!-- readme-i18n:navigation:end -->

**Un plano de control de ingeniería local-first que convierte múltiples conversaciones de ChatGPT Web en agentes de ingeniería de software persistentes y basados en roles.**

<!-- readme-section:overview -->
## Descripción general

Charterion coordina múltiples **conversaciones de ChatGPT Web** como Workers de ingeniería persistentes y las respalda con un plano de control local y duradero para proyectos, trabajo Git, revisiones, recursos y recuperación.

Por compatibilidad del runtime se conservan los comandos `GAM`, `gamd` y `gamctl`; **Charterion** es el nombre público del proyecto.

Está enfocado deliberadamente en `chatgpt.com`: no requiere una API key de OpenAI, no ofrece un backend Charterion alojado y no sustituye ChatGPT Web por una API de proveedor.

<!-- readme-section:architecture -->
## Arquitectura

Charterion tiene cuatro componentes de runtime:

- **Extensión Chrome/Edge** — descubre pestañas de `chatgpt.com`, vincula identidades Role/Project, enruta prompts, observa respuestas y renderiza el Side Panel.

- **`gamd`** — Kernel local determinista que posee la autoridad SQLite, proyectos, leases, capabilities, evidencia, Change Requests, revisiones Supervisor, Worker Fleet y merge queue.

- **Native Messaging Host** — puente estrecho Chromium ↔ `gamd` sobre un Windows named pipe; nunca recibe el token de administrador.

- **`GAM` / `gamctl`** — clientes de inicio y control para personas y máquinas.

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
## Operación humana y por Agent

Los operadores pueden iniciar el runtime Chromium dedicado con `GAM.cmd`. Los Remote Agents autorizados pueden usar el mismo Kernel mediante comandos JSON/CLI deterministas sin hacer scraping de la UI.

Charterion no almacena contraseñas, secretos MFA, cookies ni tokens de cuenta de ChatGPT. El usuario inicia sesión directamente en la página oficial de ChatGPT dentro del perfil dedicado.

```powershell
GAM.cmd
GAM.cmd status --json
GAM.cmd start --json
GAM.cmd open "My Project" --json
GAM.cmd doctor --json
```

<!-- readme-section:git-workflow -->
## Flujo Git y Change Request

En proyectos de software, una respuesta del modelo no equivale a finalización de ingeniería. El trabajo se vincula a Git y evidencia de máquina, y un Supervisor independiente lo revisa antes de integrar.

Se imponen `baseSha`/`headSha` exactos, prohibición de autoaprobación, invalidación de revisiones tras un nuevo head, evidencia válida antes de encolar, detección de conflictos contra el target branch actual y observación independiente de la integración en Git.

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
## Orquestación del navegador

El plano de navegador ofrece vínculos persistentes Role/Project, DAG de tareas, tipos `work`/`review`/`human`, hechos duraderos Skip/Cancel/Retry, ciclos de revisión acotados, bus semántico, recuperación de intentos de envío, fail-closed ante entrega ambigua, transferencia de estado y Auto Supervisor opcional.

El desired state de `AgentSlot` gestionado por Supervisor está separado de la observación del navegador. Los Workers pueden spawn/suspend/resume/retire con autoridad limitada y dejan de recibir trabajo nuevo durante draining.

<!-- readme-section:control-plane -->
## Plano de control local duradero

El Kernel persiste en SQLite hechos de proyectos, Agents, recursos, leases, capabilities, requests, WorkClaims, evidencia, revisiones, merge queue y runtime del navegador.

SQLite usa foreign keys, WAL, strict tables y transacciones. Los lease epochs y capabilities con scope bloquean Workers obsoletos; los hechos objetivos se verifican de forma determinista y la calidad de ingeniería corresponde al Supervisor.

<!-- readme-section:quick-start -->
## Inicio rápido

El despliegue actual apunta a Windows 10/11, Node.js 22+, Chrome/Edge y .NET 9 al compilar Native Host desde código.

Desde un checkout del código:

```powershell
npm install
npm run verify:full
npm run setup:windows
```

Para el Windows Runtime empaquetado, extraiga el archivo y ejecute `SETUP.cmd`.

<!-- readme-section:security -->
## Límites de seguridad

- El host permission de la extensión se limita a `https://chatgpt.com/*`.

- Native Host usa una allowlist estrecha y nunca recibe el token administrador de GAM.

- Las capabilities de Worker están acotadas a project/task/resource/lease y solo se almacenan por token hash.

- `gamctl` no tiene fallback implícito de administrador.

- Autoridad desconocida, obsoleta, ambigua o conflictiva falla de forma cerrada.

Charterion es una capa de coordinación y política, **no un sandbox del sistema operativo**. Las herramientas de archivos o terminal necesitan su propio límite VM/contenedor/capability.

<!-- readme-section:verification -->
## Verificación y release

El gate rápido cubre TypeScript, tipos del control plane, assets, invariantes multilingües del README, tests y builds. El gate completo añade publicación de Native Host y smoke tests de procesos.

Los artefactos de release incluyen sidecars SHA-256.

```powershell
npm run verify
npm run verify:full
npm run release
```

<!-- readme-section:development -->
## Principios de desarrollo

1. Las conversaciones ChatGPT Web son el cognition plane; no sustituirlas silenciosamente por APIs.

2. Git y las observaciones duraderas de máquina son hechos de ingeniería; el texto del modelo es una afirmación o explicación.

3. Dar amplia libertad de decisión al Worker dentro de una autoridad estrecha y explícita.

4. El Supervisor ejerce juicio de ingeniería; el código determinista aplica invariantes.

5. Persistir hechos y derivar estado; bloquear intentos obsoletos con identidades y epochs.

6. Fallar de forma cerrada cuando entrega, identidad, propiedad o integración sean inciertas.

<!-- readme-section:scope -->
## Alcance

Charterion apunta actualmente a **ChatGPT Web en `chatgpt.com`**. APIs LLM genéricas, orquestación alojada, integraciones Claude/Gemini y proveedores CLI de coding agents están fuera del alcance actual.

<!-- readme-section:license -->
## Licencia

Licenciado bajo [Apache-2.0](LICENSE). Consulte también [NOTICE](NOTICE) y [Third-Party Notices](THIRD_PARTY_NOTICES.md).

<!-- readme-section:status -->
## Estado de desarrollo

Charterion está en desarrollo activo. La rama predeterminada representa actualmente el conjunto de capacidades v0.4.1; las capacidades experimentales nuevas solo se documentan tras su integración formal.
