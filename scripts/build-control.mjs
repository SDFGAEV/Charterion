import { mkdir, rm } from 'node:fs/promises';
import { build } from 'esbuild';

const outdir = 'dist-control';
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'warning',
};

await Promise.all([
  build({ ...common, entryPoints: ['control/src/gamd.ts'], outfile: `${outdir}/gamd.cjs` }),
  build({ ...common, entryPoints: ['control/src/gamctl.ts'], outfile: `${outdir}/gamctl.cjs` }),
  build({ ...common, entryPoints: ['control/src/gam.ts'], outfile: `${outdir}/gam.cjs` }),
]);

console.log('Built gamd, gamctl, and GAM launcher in dist-control/.');
