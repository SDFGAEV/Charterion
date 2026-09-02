param(
  [string]$GamHome = (Join-Path $env:USERPROFILE '.charterion'),
  [switch]$KeepInstalledFiles
)
$ErrorActionPreference = 'Stop'
$HostName = 'com.charterion.control'
$registryPaths = @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
)
foreach ($registryPath in $registryPaths) {
  if (Test-Path $registryPath) { Remove-Item -Recurse -Force $registryPath }
}
if (-not $KeepInstalledFiles) {
  $installDir = Join-Path $GamHome 'native-host'
  if (Test-Path $installDir) { Remove-Item -Recurse -Force $installDir }
}
Write-Host "Unregistered $HostName from Chrome and Edge"
Write-Host 'Project databases and control tokens were preserved.'
