param(
  [string]$GamHome = (Join-Path $env:USERPROFILE '.gpt-agent-manager'),
  [string]$ExtensionId = '',
  [switch]$CreateDesktopShortcut,
  [switch]$NoStart
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
Set-Location $Root
$env:GAM_HOME = $GamHome
$nodeVersion = (& node -p "process.versions.node").Trim()
if ([int]($nodeVersion.Split('.')[0]) -lt 22) { throw "Node.js 22+ is required; found $nodeVersion" }
$required = @('manifest.json','dist\background.js','dist-control\gam.cjs','dist-control\gamd.cjs','dist-native-host\GamNativeHost.exe')
foreach ($relative in $required) {
  if (-not (Test-Path (Join-Path $Root $relative))) { throw "Runtime package is incomplete: $relative is missing" }
}
if (-not $ExtensionId) { $ExtensionId = (& node scripts/extension-id.mjs).Trim() }
if ($ExtensionId -notmatch '^[a-p]{32}$') { throw "Computed extension id is invalid: $ExtensionId" }
New-Item -ItemType Directory -Force -Path $GamHome | Out-Null
$IdentityRaw = & node (Join-Path $Root 'dist-control\gam.cjs') doctor --json
if ($LASTEXITCODE) { throw 'Failed to derive GAM runtime identity.' }
$Identity = ($IdentityRaw -join "`n") | ConvertFrom-Json
$InstanceId = [string]$Identity.details.instanceId
$PipeName = [string]$Identity.details.pipeName
if ($InstanceId -notmatch '^[0-9a-f]{16}$' -or [string]::IsNullOrWhiteSpace($PipeName)) { throw 'Derived GAM runtime identity is invalid.' }
& (Join-Path $Root 'native-host\scripts\install.ps1') -ExtensionId $ExtensionId -GamHome $GamHome -PipeName $PipeName -InstanceId $InstanceId
if ($LASTEXITCODE) { exit $LASTEXITCODE }
$runtime = [ordered]@{
  rootPath = $Root
  gamHome = $GamHome
  extensionId = $ExtensionId
  instanceId = $InstanceId
  pipeName = $PipeName
  installedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}
[IO.File]::WriteAllText((Join-Path $GamHome 'runtime.json'), ($runtime | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
$wrapper = Join-Path $GamHome 'GAM.cmd'
$wrapperText = "@echo off`r`nset `"GAM_HOME=$GamHome`"`r`nset `"GAM_PIPE_NAME=$PipeName`"`r`ncall `"$Root\GAM.cmd`" %*`r`n"
[IO.File]::WriteAllText($wrapper, $wrapperText, [Text.Encoding]::ASCII)
if ($CreateDesktopShortcut) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $shortcutPath = Join-Path $desktop 'GPT Agent Manager.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $wrapper
  $shortcut.WorkingDirectory = $Root
  $shortcut.Description = 'Start GPT Agent Manager'
  $shortcut.Save()
  Write-Host "Desktop shortcut: $shortcutPath"
}
Write-Host "GAM installed. Extension id: $ExtensionId"
Write-Host "Instance id: $InstanceId"
Write-Host "Pipe: $PipeName"
Write-Host "Launcher: $wrapper"
if (-not $NoStart) { & $wrapper start; if ($LASTEXITCODE) { exit $LASTEXITCODE } }
