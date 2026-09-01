## 2. Deployment modes

Use a release archive for normal operation. Use source deployment for development
or when rebuilding the Native Host.

Do not use the same GAM_HOME for multiple runtimes. Each runtime needs its own
SQLite database, browser token, named pipe, browser profile, and logs.

Default home:

~~~text
%USERPROFILE%\\.gpt-agent-manager
~~~

Custom home example:

~~~text
E:\\Agent-Research-Workspace\\state\\charterion-runtime
~~~
## 3. Release deployment

1. Download a release archive from GitHub Releases.
2. Extract it to a stable directory.
3. Open PowerShell in that directory.
4. Run:

~~~powershell
.\\SETUP.cmd
~~~

The installer checks Node.js and required files, derives the stable extension ID
from manifest.json, registers the Native Host for Chrome and Edge, creates
runtime wrappers, and starts Charterion.

Custom home:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\install-runtime-windows.ps1 -GamHome "E:\\Agent-Research-Workspace\\state\\charterion-runtime"
~~~

Install without opening a browser:

~~~powershell
.\\SETUP.cmd -NoStart
~~~

Create a desktop shortcut:

~~~powershell
.\\SETUP.cmd -CreateDesktopShortcut
~~~
## 4. Source deployment

From a clean checkout:

~~~powershell
npm ci
npm run setup:windows
~~~

setup:windows checks the toolchain, runs repository verification, builds the
control plane, publishes the self-contained Native Host, registers Native
Messaging manifests for Chrome and Edge, writes runtime.json, and creates
GAM.cmd and GAMCTL.cmd wrappers in GAM_HOME.

Development runtime with a dedicated home:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\setup-windows.ps1 -GamHome "E:\\Agent-Research-Workspace\\state\\charterion-dev"
~~~

Fast iteration after verification:

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\setup-windows.ps1 -SkipVerify -NoStart
npm run build:control
~~~

Do not use -SkipVerify as a release substitute.

## 5. First launch and ChatGPT login

Start through the generated wrapper:

~~~powershell
& "$env:USERPROFILE\\.gpt-agent-manager\\GAM.cmd" start --json
~~~

The launcher starts gamd, creates a dedicated Chromium profile under
GAM_HOME\\chrome-profile, loads the unpacked extension, and opens
https://chatgpt.com/. Sign in manually in the official ChatGPT page when asked.

Never paste passwords, MFA codes, cookies, session tokens, or API keys into
Charterion, Remote Desktop Commander, GitHub issues, or task prompts.
Charterion does not store them. Do not use the daily browser profile for the
managed fleet.
## 6. Remote deployment with Remote Desktop Commander

Remote Desktop Commander is an operator-side remote-control tool. It is not
part of Charterion and does not itself grant GitHub authority.

| Layer | Responsibility |
| --- | --- |
| ChatGPT Work + Remote Desktop Commander | Connect to Windows, terminal and file actions |
| Charterion extension | ChatGPT Web observation and browser protocol |
| Native Host | Browser-to-local-Kernel bridge |
| gamd Kernel | Durable state, SQLite, leases, evidence and governance |
| Dedicated browser profile | Disposable ChatGPT Web execution surface |

### 6.1 Prepare the Windows machine

1. Install or enable the Remote Desktop Commander connector in ChatGPT Work.
2. Connect the target Windows device and confirm it is online.
3. Restrict its allowed filesystem root to the smallest required directory,
   such as:

~~~text
E:\\Agent-Research-Workspace
~~~

4. Do not grant the whole system drive, user profile, browser credential
   directories, or unrelated project folders.
5. Use PowerShell as the command shell.
6. Verify the connection with read-only checks:

~~~powershell
Get-Location
Test-Path "E:\\Agent-Research-Workspace"
node --version
~~~

Configuration labels may vary between ChatGPT Work versions. The invariants do
not vary: the device is online, the allowed root contains the checkout, and
commands execute on the intended Windows machine.

### 6.2 Deploy remotely

Clone or copy Charterion inside the allowed root, then run the release or source
procedure above:

~~~powershell
$repo = "E:\\Agent-Research-Workspace\\projects\\charterion"
Set-Location $repo
npm ci
powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\setup-windows.ps1 -NoStart
& "$env:USERPROFILE\\.gpt-agent-manager\\GAM.cmd" doctor --json
& "$env:USERPROFILE\\.gpt-agent-manager\\GAM.cmd" start --json
~~~

For portable Git, use its explicit executable path:

~~~powershell
$git = "E:\\Agent-Research-Workspace\\shared\\runtimes\\git\\cmd\\git.exe"
& $git status
~~~

Use an isolated worktree for repository changes. Remote Desktop Commander
provides terminal access; it does not replace GitHub authentication or review.

### 6.3 Verify

~~~powershell
GAM.cmd doctor --json
GAM.cmd status --json
~~~

Expected: status ready, supported Node.js, extensionManifest true, gamdBundle
true, Chrome or Edge detected, runtime.json present, and Native Host manifests
under GAM_HOME\\native-host. ChatGPT may report authentication-required until
the human signs in.
## 7. Useful commands and configuration

~~~powershell
GAM.cmd doctor --json
GAM.cmd status --json
GAM.cmd start --json
GAM.cmd start --no-browser --json
GAM.cmd open "Project Name" --json
GAMCTL.cmd --help
~~~

Environment overrides:

| Variable | Purpose |
| --- | --- |
| GAM_HOME | Runtime home for SQLite, tokens, logs and profile |
| GAM_PIPE_NAME | Explicit instance pipe name |
| GAM_EXTENSION_DIR | Extension checkout or unpacked directory |
| GAM_BROWSER_PATH | Explicit Chrome or Edge executable |
| GAM_CHROME_PATH | Browser executable alias |
| GAM_NO_BROWSER=1 | Start or inspect Kernel without launching a browser |

## 8. Troubleshooting

### doctor reports an incomplete runtime

For source deployments run:

~~~powershell
npm run build:control
npm run publish:native
~~~

For release deployments confirm that the archive was completely extracted and
contains manifest.json, dist-control, dist-native-host, and dist/background.js.

### Browser not found

Set an explicit browser path:

~~~powershell
$env:GAM_BROWSER_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
GAM.cmd start --json
~~~

### Native Messaging unavailable

Close the managed browser, rerun setup, and inspect:

~~~text
%USERPROFILE%\\.gpt-agent-manager\\native-host\\gam-native-host.json
%USERPROFILE%\\.gpt-agent-manager\\native-host\\com.gpt_agent_manager.control.json
~~~

allowed_origins must contain the extension origin derived from the current
manifest.json. Do not manually guess or substitute an extension ID.

### Extension missing

Launch through GAM.cmd, not the daily browser profile. Check that
GAM_EXTENSION_DIR points to the directory containing manifest.json, then rerun
GAM.cmd start --json.
### Remote Commander operates the wrong machine

Stop before making changes. Check device name, online status, current location,
and allowed root. Verify the path exists on the intended device.

### Multiple runtimes conflict

Use a different GAM_HOME for every Parent, Candidate, development, or production
runtime. Each runtime must have distinct SQLite, browser profile, browser token,
instance ID, and named pipe identities.

### Previous process is still running

Use GAM.cmd status --json first. Do not kill an unknown process. Confirm the
instance ID and GAM_HOME before stopping the exact managed process.

## 9. Uninstall and reset

First close the managed browser and stop its exact Kernel process. Preserve any
evidence or database files that are still needed.

Native Host registration is stored in the current user's registry:

~~~text
HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.gpt_agent_manager.control
HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.gpt_agent_manager.control
~~~

Remove only those two exact registry values and the exact runtime home after
confirming that no other Charterion instance uses them. Never delete a shared
home, unrelated browser profile, or another agent's worktree.

## 10. Security and release rules

- Use a dedicated browser profile and a dedicated GAM_HOME per runtime.
- Restrict Remote Desktop Commander to the smallest practical filesystem root.
- Never expose passwords, MFA codes, cookies, browser profiles, admin tokens, or
  private keys in prompts, logs, commits, or issue reports.
- Charterion is a coordination and policy layer, not an OS sandbox.
- Use a VM or container when stronger host isolation is required.
- Run npm run verify:full before treating a source build as release-ready.
- For releases, follow [CI/CD](CI_CD.md) and attach only verified archives.
