import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
const rows = [];
for (const [name] of Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))) {
  const meta = lock.packages?.[`node_modules/${name}`] ?? {};
  rows.push({ name, version: meta.version ?? dependencies[name], license: meta.license ?? 'See package metadata' });
}
let out = '# Third-Party Notices\n\n';
out += 'This file summarizes direct npm dependencies used by GPT Agent Manager. ';
out += 'Transitive dependency metadata remains authoritative in `package-lock.json` and each dependency package.\n\n';
out += '| Package | Version | License |\n| --- | --- | --- |\n';
for (const row of rows) out += `| \`${row.name}\` | \`${row.version}\` | ${row.license} |\n`;
out += '\nGPT Agent Manager itself is licensed under Apache-2.0; see `LICENSE`.\n';
await writeFile(resolve(root, 'THIRD_PARTY_NOTICES.md'), out, 'utf8');
console.log(`THIRD_PARTY_NOTICES_WRITTEN direct_dependencies=${rows.length}`);
