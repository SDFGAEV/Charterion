# Charterion: Open-Source Multi-Agent Engineering Control Plane for ChatGPT Web Agents

[![License](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![Chromium](https://img.shields.io/badge/Chromium-Manifest%20V3-4285F4.svg)](manifest.json)
[![Version](https://img.shields.io/badge/version-0.4.1-2ea44f.svg)](manifest.json)
[![ChatGPT Web](https://img.shields.io/badge/target-ChatGPT%20Web-111111.svg)](https://chatgpt.com/)
[![Latest Release](https://img.shields.io/github/v/release/SDFGAEV/Charterion?display_name=tag)](https://github.com/SDFGAEV/Charterion/releases/latest)

<!-- readme-i18n:navigation:start -->
<p align="center"><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.zh-TW.md">繁體中文</a> · <a href="README.ja.md">日本語</a> · <a href="README.ko.md">한국어</a> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português (Brasil)</a> · <strong>Français</strong> · <a href="README.de.md">Deutsch</a> · <a href="README.ru.md">Русский</a></p>
<!-- readme-i18n:navigation:end -->

**Un plan de contrôle d’ingénierie local-first qui transforme plusieurs conversations ChatGPT Web en agents persistants d’ingénierie logicielle liés à des rôles.**

<!-- readme-section:overview -->
## Vue d’ensemble

Charterion coordonne plusieurs **conversations ChatGPT Web** comme Workers d’ingénierie persistants et les appuie sur un plan de contrôle local durable pour les projets, le travail Git, les revues, les ressources et la récupération.

Le runtime conserve les noms de commandes `GAM`, `gamd` et `gamctl` pour compatibilité, tandis que **Charterion** est le nom public du projet.

Le projet se concentre volontairement sur `chatgpt.com` : aucune clé API OpenAI, aucun backend Charterion hébergé et aucune tentative de remplacer ChatGPT Web par une API fournisseur.

<!-- readme-section:architecture -->
## Architecture

Charterion comporte quatre composants runtime :

- **Extension Chrome/Edge** — découvre les onglets `chatgpt.com`, lie les identités Role/Project, route les prompts, observe les réponses et affiche le Side Panel.

- **`gamd`** — le Kernel local déterministe. Il possède l’autorité SQLite, les projets, leases, capabilities, preuves, Change Requests, revues Supervisor, l’état de la fleet et de la merge queue.

- **Native Messaging Host** — un pont étroit Chromium ↔ `gamd` via un Windows named pipe. Il ne reçoit jamais le token administrateur.

- **`GAM` / `gamctl`** — clients de lancement et de contrôle pour humains et machines.

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
## Utilisation humaine et par Agent

Les opérateurs humains peuvent lancer le runtime Chromium dédié avec `GAM.cmd`. Les Remote Agents autorisés utilisent le même Kernel avec des commandes JSON/CLI déterministes, sans scraper l’interface.

Charterion ne stocke ni mots de passe ChatGPT, ni secrets MFA, ni cookies, ni tokens de compte. L’utilisateur se connecte directement sur la page officielle ChatGPT dans le profil navigateur dédié.

```powershell
GAM.cmd
GAM.cmd status --json
GAM.cmd start --json
GAM.cmd open "My Project" --json
GAM.cmd doctor --json
```

<!-- readme-section:git-workflow -->
## Workflow Git et Change Request

Pour un projet logiciel, une réponse du modèle n’est pas une preuve d’achèvement d’ingénierie. Le travail est lié à Git et à des preuves machine, puis revu par un Supervisor indépendant avant intégration.

Les invariants incluent la liaison exacte `baseSha`/`headSha`, l’interdiction de l’auto-approbation, l’invalidation d’une revue après un nouveau head, la vérification des preuves avant mise en file, la détection des conflits contre le target branch le plus récent et l’observation indépendante de l’intégration dans l’historique Git.

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
## Orchestration du navigateur

Le plan navigateur fournit des liaisons Role/Project persistantes, le routage par task DAG, les types `work`/`review`/`human`, des faits durables Skip/Cancel/Retry, des boucles de revue bornées, un bus de messages sémantique, la récupération des tentatives d’envoi, un traitement fail-closed des livraisons ambiguës, un état navigateur portable et un Auto Supervisor optionnel.

Le desired state d’un `AgentSlot`, géré par le Supervisor, est séparé de l’observation du navigateur. Les Workers peuvent être créés, suspendus, repris ou retirés via une autorité limitée ; les Workers en draining cessent de recevoir du nouveau travail avant la fermeture de leurs onglets.

<!-- readme-section:control-plane -->
## Plan de contrôle local durable

Le Kernel persiste dans SQLite les faits de projet, Agent, ressource, lease, capability, request, WorkClaim, preuve, revue, merge queue et runtime navigateur.

SQLite utilise foreign keys, WAL mode, strict tables et changements transactionnels. Les lease epochs et capabilities avec scope bloquent les Workers obsolètes. Les faits machine objectifs sont vérifiés de façon déterministe ; l’architecture et la qualité d’ingénierie restent du ressort du Supervisor.

<!-- readme-section:quick-start -->
## Démarrage rapide

Le déploiement actuel cible Windows 10/11 avec Node.js 22+, Chrome ou Edge, et .NET 9 lors de la compilation du Native Host depuis les sources.

Depuis un checkout source :

```powershell
npm install
npm run verify:full
npm run setup:windows
```

Depuis un Windows runtime empaqueté, extrayez l’archive puis exécutez `SETUP.cmd`.

<!-- readme-section:security -->
## Limites de sécurité

- La host permission de l’extension est limitée à `https://chatgpt.com/*`.

- Le Native Host utilise une allowlist étroite et ne reçoit jamais le token administrateur GAM.

- Les capabilities Worker sont limitées à project/task/resource/lease et stockées uniquement par token hash.

- `gamctl` ne possède aucun fallback administrateur implicite.

- Une autorité inconnue, obsolète, ambiguë ou conflictuelle échoue en mode fermé.

Charterion est une couche de coordination et de politique, **pas un sandbox de système d’exploitation**. Les outils filesystem ou terminal doivent conserver leur propre frontière VM/conteneur/capability.

<!-- readme-section:verification -->
## Vérification et release

Le gate rapide vérifie TypeScript, les types du control plane, les assets statiques, les invariants multilingues du README, les tests et les builds. Le gate complet ajoute la publication du Native Host et les smoke tests au niveau processus.

Les artefacts de release sont produits avec des sidecars SHA-256.

```powershell
npm run verify
npm run verify:full
npm run release
```

<!-- readme-section:development -->
## Principes de développement

1. Les conversations ChatGPT Web constituent le cognition plane ; ne pas les remplacer silencieusement par des API fournisseur.

2. Git et les observations machine durables sont des faits d’ingénierie ; le texte du modèle est une affirmation ou une explication.

3. Donner aux Workers une large liberté de décision dans une autorité étroite et explicite.

4. Les Supervisors exercent le jugement d’ingénierie ; le code déterministe applique les politiques invariantes.

5. Persister les faits et dériver l’état ; bloquer les tentatives obsolètes avec identités et epochs.

6. Échouer en mode fermé lorsque livraison, identité, ownership ou intégration sont incertains.

<!-- readme-section:scope -->
## Périmètre

Charterion cible actuellement **ChatGPT Web sur `chatgpt.com`**. Les API LLM génériques, l’orchestration hébergée, les intégrations Claude/Gemini et les providers CLI de coding agents sont hors du périmètre actuel.

<!-- readme-section:license -->
## Licence

Sous licence [Apache-2.0](LICENSE). Voir [NOTICE](NOTICE) et [Third-Party Notices](THIRD_PARTY_NOTICES.md).

<!-- readme-section:status -->
## État du développement

Charterion est en développement actif. La branche par défaut représente actuellement l’ensemble de capacités v0.4.1 ; les capacités expérimentales plus récentes ne sont documentées ici qu’après intégration formelle.
