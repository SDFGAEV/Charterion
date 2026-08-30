param(
  [string]$GamHome = (Join-Path $env:USERPROFILE '.gpt-agent-manager'),
  [string]$ExtensionId = '',
  [switch]$SkipVerify,
  [switch]$CreateDesktopShortcut,
  [switch]$NoStart
)
$ErrorActionPreference = 'Stop'
$Repo = Split-Path $PSScriptRoot -Parent
Set-Location $Repo
$env:GAM_HOME = $GamHome
$nodeVersion = (& node -p "process.versions.node").Trim()
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt 22) { throw "Node.js 22+ is required; found $nodeVersion" }
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { throw '.NET 9 SDK/runtime is required for the Native Host build.' }
if (-not (Test-Path (Join-Path $Repo 'node_modules'))) { npm install; if ($LASTEXITCODE) { exit $LASTEXITCODE } }
if (-not $SkipVerify) { npm run verify; if ($LASTEXITCODE) { exit $LASTEXITCODE } }
else { npm run build:control; if ($LASTEXITCODE) { exit $LASTEXITCODE } }
npm run publish:native
if ($LASTEXITCODE) { exit $LASTEXITCODE }
if (-not $ExtensionId) { $ExtensionId = (& node scripts/extension-id.mjs).Trim() }
if ($ExtensionId -notmatch '^[a-p]{32}$') { throw "Computed extension id is invalid: $ExtensionId" }
New-Item -ItemType Directory -Force -Path $GamHome | Out-Null
$IdentityRaw = & node (Join-Path $Repo 'dist-control\gam.cjs') doctor --json
if ($LASTEXITCODE) { throw 'Failed to derive GAM runtime identity.' }
$Identity = ($IdentityRaw -join "`n") | ConvertFrom-Json
$InstanceId = [string]$Identity.details.instanceId
$PipeName = [string]$Identity.details.pipeName
if ($InstanceId -notmatch '^[0-9a-f]{16}$' -or [string]::IsNullOrWhiteSpace($PipeName)) { throw 'Derived GAM runtime identity is invalid.' }
& (Join-Path $Repo 'native-host\scripts\install.ps1') -ExtensionId $ExtensionId -GamHome $GamHome -PipeName $PipeName -InstanceId $InstanceId
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$runtime = [ordered]@{
  repoPath = $Repo
  gamHome = $GamHome
  extensionId = $ExtensionId
  instanceId = $InstanceId
  pipeName = $PipeName
  installedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}
[IO.File]::WriteAllText((Join-Path $GamHome 'runtime.json'), ($runtime | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
$wrapper = Join-Path $GamHome 'GAM.cmd'
$wrapperText = "@echo off`r`nset `"GAM_HOME=$GamHome`"`r`nset `"GAM_PIPE_NAME=$PipeName`"`r`ncall `"$Repo\GAM.cmd`" %*`r`n"
[IO.File]::WriteAllText($wrapper, $wrapperText, [Text.Encoding]::ASCII)
Write-Host "Stable extension id: $ExtensionId"
Write-Host "GAM instance id: $InstanceId"
Write-Host "GAM pipe: $PipeName"
Write-Host "GAM launcher: $wrapper"
if ($CreateDesktopShortcut) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $shortcutPath = Join-Path $desktop 'GPT Agent Manager.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $wrapper
  $shortcut.WorkingDirectory = $Repo
  $shortcut.Description = 'Start GPT Agent Manager'
  $shortcut.Save()
  Write-Host "Desktop shortcut: $shortcutPath"
}
Write-Host ''
Write-Host 'Setup complete.'
Write-Host 'Human: double-click GAM.cmd or run GAM.cmd'
Write-Host 'Agent: GAM.cmd status --json / GAM.cmd open <project> --json'
if (-not $NoStart) {
  Write-Host 'Starting GAM with its dedicated Chromium profile...'
  & $wrapper start
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
}
