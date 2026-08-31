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
& (Join-Path $Root 'native-host\scripts\install.ps1') -ExtensionId $ExtensionId -GamHome $GamHome
$runtime = [ordered]@{ rootPath = $Root; gamHome = $GamHome; extensionId = $ExtensionId; installedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
[IO.File]::WriteAllText((Join-Path $GamHome 'runtime.json'), ($runtime | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
$wrapper = Join-Path $GamHome 'GAM.cmd'
$wrapperText = "@echo off`r`nset GAM_HOME=$GamHome`r`ncall `"$Root\GAM.cmd`" %*`r`n"
[IO.File]::WriteAllText($wrapper, $wrapperText, [Text.Encoding]::ASCII)
if ($CreateDesktopShortcut) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $shortcutPath = Join-Path $desktop 'Charterion.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $wrapper
  $shortcut.WorkingDirectory = $Root
  $shortcut.Description = 'Start Charterion'
  $shortcut.Save()
  Write-Host "Desktop shortcut: $shortcutPath"
}
Write-Host "GAM installed. Extension id: $ExtensionId"
Write-Host "Launcher: $wrapper"
if (-not $NoStart) { & $wrapper start; if ($LASTEXITCODE) { exit $LASTEXITCODE } }
