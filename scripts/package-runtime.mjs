import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'release');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const readmeManifest = JSON.parse(await readFile(resolve(root, 'docs/readme/LANGUAGES.json'), 'utf8'));
const readmeCheck = spawnSync(process.execPath, [resolve(root, 'scripts/check-readme-i18n.mjs'), '--release', '--json'], { encoding: 'utf8' });
if (readmeCheck.status !== 0) throw new Error(`README i18n release gate failed: ${readmeCheck.stdout || readmeCheck.stderr}`);
const readmeEvidence = JSON.parse(readmeCheck.stdout.trim());
const archiveName = `charterion-v${pkg.version}-windows-runtime.zip`;
const archivePath = resolve(outDir, archiveName);

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value, 0);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function zipName(path) {
  return path.split(sep).join('/');
}

const inputPaths = [
  resolve(root, 'manifest.json'), resolve(root, 'LICENSE'), resolve(root, 'NOTICE'), resolve(root, 'THIRD_PARTY_NOTICES.md'),
  ...readmeManifest.languages.map((item) => resolve(root, item.file)),
  resolve(root, 'docs/readme/LANGUAGES.json'), resolve(root, 'docs/readme/README_SCHEMA.json'),
  resolve(root, 'docs/readme/TRANSLATION_POLICY.md'), resolve(root, 'docs/readme/GLOSSARY.json'), resolve(root, 'docs/readme/TRANSLATION_STATE.json'),
  resolve(root, 'docs/DEPLOYMENT.md'),
  resolve(root, 'GAM.cmd'), resolve(root, 'GAMCTL.cmd'), resolve(root, 'SETUP.cmd'),
  ...await walk(resolve(root, 'dist')), ...await walk(resolve(root, 'dist-control')),
  resolve(root, 'dist-native-host', 'GamNativeHost.exe'),
  ...await walk(resolve(root, 'native-host', 'scripts')),
  resolve(root, 'scripts', 'install-runtime-windows.ps1'), resolve(root, 'scripts', 'extension-id.mjs'),
];
const entries = [];
let offset = 0;
const localParts = [];

for (const absolute of inputPaths) {
  const name = zipName(relative(root, absolute));
  const nameBytes = Buffer.from(name, 'utf8');
  const data = await readFile(absolute);
  const crc = crc32(data);
  const localHeader = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0x21),
    u32(crc), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0), nameBytes,
  ]);
  localParts.push(localHeader, data);
  entries.push({ nameBytes, dataLength: data.length, crc, offset });
  offset += localHeader.length + data.length;
}

const centralParts = [];
for (const entry of entries) {
  centralParts.push(Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0x21),
    u32(entry.crc), u32(entry.dataLength), u32(entry.dataLength),
    u16(entry.nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0),
    u32(entry.offset), entry.nameBytes,
  ]));
}
const central = Buffer.concat(centralParts);
const end = Buffer.concat([
  u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
  u32(central.length), u32(offset), u16(0),
]);
const archive = Buffer.concat([...localParts, central, end]);

await mkdir(outDir, { recursive: true });
await writeFile(archivePath, archive);
await writeFile(resolve(outDir, 'readme-i18n-evidence.json'), `${JSON.stringify(readmeEvidence, null, 2)}\n`, 'utf8');
const digest = createHash('sha256').update(archive).digest('hex');
await writeFile(`${archivePath}.sha256`, `${digest}  ${basename(archivePath)}\n`, 'utf8');
console.log(`${archivePath}\nsha256 ${digest}`);
