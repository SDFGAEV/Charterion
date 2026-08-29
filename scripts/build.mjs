import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const entry of ['background', 'content', 'sidepanel']) {
  await build({
    entryPoints: [resolve(root, 'src', `${entry}.ts`)],
    outfile: resolve(dist, `${entry}.js`),
    bundle: true,
    platform: 'browser',
    target: 'chrome114',
    format: 'iife',
    sourcemap: true,
  });
}

await copyFile(resolve(root, 'src', 'sidepanel.html'), resolve(dist, 'sidepanel.html'));
await copyFile(resolve(root, 'src', 'sidepanel.css'), resolve(dist, 'sidepanel.css'));
console.log('Built extension assets in dist/.');
