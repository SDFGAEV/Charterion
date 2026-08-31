# Charterion: Open-Source Multi-Agent Engineering Control Plane for ChatGPT Web Agents

[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Chromium](https://img.shields.io/badge/Chromium-Manifest%20V3-4285F4.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.4.1-2ea44f.svg)](manifest.json)
[![ChatGPT Web](https://img.shields.io/badge/target-ChatGPT%20Web-111111.svg)](https://chatgpt.com/)
[![Latest Release](https://img.shields.io/github/v/release/SDFGAEV/Charterion?display_name=tag)](https://github.com/SDFGAEV/Charterion/releases/latest)

<!-- readme-i18n:navigation:start -->
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <strong>Português (Brasil)</strong> · <a href="README.fr.md">Français</a> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>
<!-- readme-i18n:navigation:end -->

**Um plano de controle de engenharia local-first que transforma várias conversas do ChatGPT Web em agentes persistentes de engenharia de software, vinculados a funções.**

<!-- readme-section:overview -->
## Visão geral

O Charterion coordena várias **conversas do ChatGPT Web** como Workers de engenharia persistentes e as apoia com um plano de controle local e durável para projetos, trabalho Git, revisões, recursos e recuperação.

O runtime mantém os nomes de comando existentes `GAM`, `gamd` e `gamctl` por compatibilidade, enquanto **Charterion** é o nome público do projeto.

O foco é deliberadamente `chatgpt.com`: não exige chave da API da OpenAI, não oferece backend Charterion hospedado e não tenta substituir o ChatGPT Web por uma API de provedor.

<!-- readme-section:architecture -->
## Arquitetura

O Charterion possui quatro componentes de runtime:

- **Extensão Chrome/Edge** — descobre abas de `chatgpt.com`, vincula identidades Role/Project, encaminha prompts, observa respostas e renderiza o Side Panel.

- **`gamd`** — o Kernel local determinístico. Ele detém a autoridade SQLite, projetos, leases, capabilities, evidências, Change Requests, revisões de Supervisor, estado da fleet e estado da merge queue.

- **Native Messaging Host** — uma ponte estreita Chromium ↔ `gamd` sobre um Windows named pipe. Nunca recebe o token de administrador.

- **`GAM` / `gamctl`** — clientes de inicialização e controle voltados a humanos e máquinas.

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
## Operação humana e por Agent

Operadores humanos podem iniciar o runtime Chromium dedicado com `GAM.cmd`. Remote Agents autorizados podem usar o mesmo Kernel por comandos JSON/CLI determinísticos, sem fazer scraping da UI.

O Charterion não armazena senhas do ChatGPT, segredos de MFA, cookies nem tokens de conta. O usuário faz login diretamente na página oficial do ChatGPT dentro do perfil dedicado do navegador.

```powershell
GAM.cmd
GAM.cmd status --json
GAM.cmd start --json
GAM.cmd open "My Project" --json
GAM.cmd doctor --json
```

<!-- readme-section:git-workflow -->
## Fluxo Git e Change Request

Em projetos de software, uma resposta do modelo não significa conclusão de engenharia. O trabalho é vinculado ao Git e a evidências de máquina, e depois revisado por um Supervisor independente antes da integração.

As invariantes incluem vínculo exato de `baseSha`/`headSha`, proibição de autoaprovação, invalidação da revisão após um novo head, checagem de evidência antes da fila, detecção de conflitos contra o target branch mais recente e observação independente da integração no histórico Git.

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
## Orquestração do navegador

O plano do navegador fornece vínculos persistentes Role/Project, roteamento por task DAG, tipos `work`/`review`/`human`, fatos duráveis Skip/Cancel/Retry, ciclos de revisão limitados, barramento semântico de mensagens, recuperação de tentativas de envio, tratamento fail-closed de entrega ambígua, estado portátil do navegador e Auto Supervisor opcional.

O desired state de `AgentSlot`, gerenciado pelo Supervisor, é separado da observação do navegador. Workers podem ser criados, suspensos, retomados ou aposentados por autoridade limitada; Workers em draining deixam de receber novo trabalho antes do fechamento das abas.

<!-- readme-section:control-plane -->
## Plano de controle local durável

O Kernel persiste em SQLite fatos de projeto, Agent, recurso, lease, capability, request, WorkClaim, evidência, revisão, merge queue e runtime do navegador.

O SQLite usa foreign keys, WAL mode, strict tables e alterações transacionais. Lease epochs e capabilities com scope isolam Workers obsoletos. Fatos objetivos de máquina são verificados deterministicamente; arquitetura e qualidade de engenharia permanecem julgamento do Supervisor.

<!-- readme-section:quick-start -->
## Início rápido

O deployment atual mira Windows 10/11 com Node.js 22+, Chrome ou Edge e .NET 9 ao compilar o Native Host a partir do código-fonte.

A partir de um checkout do código:

```powershell
npm install
npm run verify:full
npm run setup:windows
```

Em um Windows runtime empacotado, extraia o arquivo e execute `SETUP.cmd`.

<!-- readme-section:security -->
## Limites de segurança

- A host permission da extensão é restrita a `https://chatgpt.com/*`.

- O Native Host usa uma allowlist estreita e nunca recebe o token de administrador do GAM.

- As capabilities dos Workers têm scope de project/task/resource/lease e são armazenadas apenas por token hash.

- `gamctl` não possui fallback implícito de administrador.

- Autoridade desconhecida, obsoleta, ambígua ou conflitante falha de forma fechada.

O Charterion é uma camada de coordenação e política, **não um sandbox de sistema operacional**. Ferramentas de filesystem ou terminal ainda precisam de seu próprio limite de VM/container/capability.

<!-- readme-section:verification -->
## Verificação e release

O gate rápido verifica TypeScript, tipos do control plane, assets estáticos, invariantes multilíngues do README, testes e builds. O gate completo adiciona publicação do Native Host e smoke tests em nível de processo.

Os artefatos de release são emitidos com sidecars SHA-256.

```powershell
npm run verify
npm run verify:full
npm run release
```

<!-- readme-section:development -->
## Princípios de desenvolvimento

1. Conversas do ChatGPT Web são o cognition plane; não substitua silenciosamente por APIs de provedor.

2. Git e observações duráveis da máquina são fatos de engenharia; texto do modelo é uma afirmação ou explicação.

3. Dê ampla liberdade de decisão aos Workers dentro de uma autoridade estreita e explícita.

4. Supervisors exercem julgamento de engenharia; código determinístico aplica políticas invariantes.

5. Persista fatos e derive estado; isole tentativas obsoletas por identidades e epochs.

6. Falhe de forma fechada quando entrega, identidade, ownership ou integração forem incertas.

<!-- readme-section:scope -->
## Escopo

O Charterion atualmente mira **ChatGPT Web em `chatgpt.com`**. APIs LLM genéricas, orquestração hospedada, integrações Claude/Gemini e providers CLI de coding agents estão fora do escopo atual.

<!-- readme-section:license -->
## Licença

Licenciado sob [Apache-2.0](LICENSE). Veja [NOTICE](NOTICE) e [Third-Party Notices](THIRD_PARTY_NOTICES.md).

<!-- readme-section:status -->
## Estado de desenvolvimento

O Charterion está em desenvolvimento ativo. O branch padrão atualmente representa o conjunto de capacidades v0.4.1; capacidades experimentais mais recentes só são documentadas aqui após integração formal.
