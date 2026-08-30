import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
if (typeof manifest.key !== 'string' || !manifest.key) throw new Error('manifest.key is required for a stable extension id');
const der = Buffer.from(manifest.key, 'base64');
const bytes = createHash('sha256').update(der).digest().subarray(0, 16);
const id = [...bytes].flatMap((byte) => [byte >> 4, byte & 15]).map((nibble) => String.fromCharCode(97 + nibble)).join('');
if (!/^[a-p]{32}$/.test(id)) throw new Error('Computed extension id is invalid');
console.log(id);
