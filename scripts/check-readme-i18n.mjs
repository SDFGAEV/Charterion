import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const docs = resolve(root, 'docs/readme');
const manifest = JSON.parse(readFileSync(resolve(docs, 'LANGUAGES.json'), 'utf8'));
const schema = JSON.parse(readFileSync(resolve(docs, 'README_SCHEMA.json'), 'utf8'));
const statePath = resolve(docs, 'TRANSLATION_STATE.json');
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { translations: {} };
const NAV_START = '<!-- readme-i18n:navigation:start -->';
const NAV_END = '<!-- readme-i18n:navigation:end -->';
const sectionRe = /<!--\s*readme-section:([a-z0-9-]+)\s*-->/g;
const codeRe = /^```([^\n]*)\n(.*?)^```[ \t]*$/gms;
const mdLinkRe = /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+['"][^'"]*['"])?\)/g;
const htmlLinkRe = /<a\s+[^>]*href=['"]([^'"]+)['"][^>]*>/gi;
function esc(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function navigation(locale) {
  const parts = manifest.languages.map((item) => item.locale === locale ? `<strong>${item.name}</strong>` : `<a href="${item.file}">${item.name}</a>`);
  return `${NAV_START}\n<p align="center">${parts.join(' · ')}</p>\n${NAV_END}`;
}
function strictText(path) {
  const raw = readFileSync(path);
  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) throw new Error(`${path}: UTF-8 BOM is forbidden`);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(raw).replace(/\r\n/g, '\n');
  if (text.includes('\ufffd')) throw new Error(`${path}: contains U+FFFD`);
  return text;
}
function stripNavigation(text) {
  return text.replace(new RegExp(`${esc(NAV_START)}[\\s\\S]*?${esc(NAV_END)}`), '');
}
function sectionIds(text) { return [...text.matchAll(sectionRe)].map((m) => m[1]); }
function codeBlocks(text) { return [...text.matchAll(codeRe)].map((m) => `\`\`\`${m[1]}\n${m[2]}\`\`\``); }
function relativeLinks(text) {
  const clean = stripNavigation(text);
  const links = [...clean.matchAll(mdLinkRe), ...clean.matchAll(htmlLinkRe)].map((m) => m[1]);
  return links.filter((target) => !/^(?:https?:\/\/|mailto:|#)/.test(target));
}
function navBlock(text) {
  return text.match(new RegExp(`${esc(NAV_START)}[\\s\\S]*?${esc(NAV_END)}`))?.[0] ?? null;
}
function semanticSourceDigest() {
  let text = strictText(resolve(root, 'README.md'));
  text = stripNavigation(text);
  text = text.replace(/^\[!\[.*?\]\(.*?\)\]\(.*?\)\s*$/gm, '');
  text = text.replace(/<!--\s*readme-section:[^>]+-->/g, '');
  text = text.replace(/<!--\s*readme-source-sha256:[^>]+-->/g, '');
  text = text.replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
function sourceSectionDigests(text) {
  const matches = [...text.matchAll(sectionRe)];
  const out = {};
  for (let i = 0; i < matches.length; i += 1) {
    const id = matches[i][1];
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const body = text.slice(start, end).replace(/\s+/g, ' ').trim();
    out[id] = createHash('sha256').update(body, 'utf8').digest('hex');
  }
  return out;
}
function checkTarget(file, target, errors) {
  const filePart = decodeURIComponent(target.split('#')[0].split('?')[0]);
  if (!filePart) return;
  const candidate = resolve(root, filePart);
  if (!candidate.startsWith(root)) errors.push(`${file}: relative link escapes repository: ${target}`);
  else if (!existsSync(candidate)) errors.push(`${file}: broken relative link: ${target}`);
}
const release = process.argv.includes('--release');
const jsonMode = process.argv.includes('--json');
const errors = [];
const warnings = [];
const locales = new Set();
const texts = new Map();
for (const item of manifest.languages) {
  if (locales.has(item.locale)) errors.push(`duplicate locale: ${item.locale}`);
  locales.add(item.locale);
  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(item.locale)) errors.push(`invalid locale: ${item.locale}`);
  const path = resolve(root, item.file);
  if (!existsSync(path)) { errors.push(`missing README locale file: ${item.file}`); continue; }
  try { texts.set(item.locale, strictText(path)); } catch (error) { errors.push(String(error.message ?? error)); }
}
if (!locales.has('en')) errors.push('default locale en is missing');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const extensionManifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
if (pkg.version !== extensionManifest.version) errors.push('package.json and manifest.json versions differ');
const english = texts.get('en') ?? '';
const englishCodes = codeBlocks(english);
const englishLinks = relativeLinks(english);
const digest = english ? semanticSourceDigest() : '';
const sectionDigests = sourceSectionDigests(english);
const stale = [];
const staleSections = {};
for (const item of manifest.languages) {
  const text = texts.get(item.locale);
  if (!text) continue;
  const ids = sectionIds(text);
  if (JSON.stringify(ids) !== JSON.stringify(schema.section_ids)) errors.push(`${item.file}: section order drift: ${JSON.stringify(ids)}`);
  if (JSON.stringify(codeBlocks(text)) !== JSON.stringify(englishCodes)) errors.push(`${item.file}: code block drift`);
  const links = relativeLinks(text);
  if (JSON.stringify(links) !== JSON.stringify(englishLinks)) errors.push(`${item.file}: relative link target drift: ${JSON.stringify(links)}`);
  for (const target of links) checkTarget(item.file, target, errors);
  if (navBlock(text) !== navigation(item.locale)) errors.push(`${item.file}: language navigation drift`);
  if (!text.startsWith('# GPT Agent Manager\n')) errors.push(`${item.file}: canonical project name/header changed`);
  if (!text.includes(`version-${pkg.version}-`)) errors.push(`${item.file}: version badge does not match ${pkg.version}`);
  for (const required of ['Apache-2.0', '](LICENSE)', '](NOTICE)', '](THIRD_PARTY_NOTICES.md)']) {
    if (!text.includes(required)) errors.push(`${item.file}: missing required reference ${required}`);
  }
  if ((text.match(/```/g)?.length ?? 0) % 2 !== 0) errors.push(`${item.file}: unpaired Markdown code fence`);
  if (item.locale !== 'en') {
    const entry = state.translations?.[item.locale] ?? {};
    const mismatchedSections = schema.section_ids.filter((id) => entry.section_digests?.[id] !== sectionDigests[id]);
    const current = entry.status === 'current' && entry.source_digest === digest && mismatchedSections.length === 0;
    if (!current) {
      stale.push(item.locale);
      staleSections[item.locale] = mismatchedSections;
      const detail = mismatchedSections.length ? `: ${mismatchedSections.join(',')}` : '';
      warnings.push(`README_TRANSLATION_STALE: ${item.locale}${detail}`);
      if (release && Number(item.tier ?? 2) <= 1) errors.push(`${item.file}: Tier ${item.tier} translation is stale${detail}`);
    }
  }
}
const result = {
  status: errors.length ? 'FAIL' : 'PASS', languages: manifest.languages.length,
  sections: schema.section_ids.length, links: englishLinks.length, code_blocks: englishCodes.length,
  source_digest: digest, tier1_current: !manifest.languages.some((item) => stale.includes(item.locale) && Number(item.tier ?? 2) <= 1),
  stale, stale_sections: staleSections, broken_links: errors.filter((x) => x.includes('broken relative link')).length,
  section_drift: errors.filter((x) => x.includes('section order drift')).length,
  code_block_drift: errors.filter((x) => x.includes('code block drift')).length,
};
if (jsonMode) console.log(JSON.stringify({ ...result, errors, warnings }));
else if (errors.length) {
  console.log('README_I18N_CHECK_FAIL'); for (const error of errors) console.log(`  ${error}`); for (const warning of warnings) console.log(`  ${warning}`);
} else {
  console.log(`README_I18N_CHECK_PASS languages=${result.languages} sections=${result.sections} links=${result.links} code_blocks=${result.code_blocks}`);
  for (const warning of warnings) console.log(warning);
}
process.exitCode = errors.length ? 1 : 0;
