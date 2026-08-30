import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const cacheRoot = resolve(process.env.GAM_BUILD_CACHE || join(root, '.build-cache'));
const nugetPackages = join(cacheRoot, 'nuget-packages');
const nugetHttp = join(cacheRoot, 'nuget-http');
const temp = join(cacheRoot, 'tmp');
const out = join(root, 'dist-native-host');
for (const dir of [cacheRoot, nugetPackages, nugetHttp, temp]) mkdirSync(dir, { recursive: true });
rmSync(out, { recursive: true, force: true });
const args = ['publish', 'native-host/GamNativeHost/GamNativeHost.csproj', '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true', '-p:PublishSingleFile=true', '-o', out];
const result = spawnSync('dotnet', args, {
  cwd: root, stdio: 'inherit', windowsHide: true,
  env: { ...process.env, NUGET_PACKAGES: nugetPackages, NUGET_HTTP_CACHE_PATH: nugetHttp, TEMP: temp, TMP: temp },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Published self-contained Native Host to ${out}`);
