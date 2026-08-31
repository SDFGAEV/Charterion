import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const docs = resolve(root, 'docs/readme');
const languagesPath = resolve(docs, 'LANGUAGES.json');
const statePath = resolve(docs, 'TRANSLATION_STATE.json');
export const NAV_START = '<!-- readme-i18n:navigation:start -->';
export const NAV_END = '<!-- readme-i18n:navigation:end -->';

export function loadJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
export function languages() { return loadJson(languagesPath).languages; }
export function navigation(locale) {
  const parts = languages().map((item) => item.locale === locale
    ? `<strong>${item.name}</strong>`
    : `<a href="${item.file}">${item.name}</a>`);
  return `${NAV_START}\n<p align="center">${parts.join(' · ')}</p>\n${NAV_END}`;
}
export function replaceNavigation(text, locale) {
  const pattern = new RegExp(`${escapeRegExp(NAV_START)}[\\s\\S]*?${escapeRegExp(NAV_END)}`);
  if (pattern.test(text)) return text.replace(pattern, navigation(locale));
  const lines = text.split(/\r?\n/);
  let at = 1;
  while (at < lines.length && (!lines[at].trim() || lines[at].startsWith('[!'))) at += 1;
  lines.splice(at, 0, '', navigation(locale), '');
  return `${lines.join('\n').trimEnd()}\n`;
}
function escapeRegExp(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
export function semanticSourceText() {
  let text = readFileSync(resolve(root, 'README.md'), 'utf8');
  const navPattern = new RegExp(`${escapeRegExp(NAV_START)}[\\s\\S]*?${escapeRegExp(NAV_END)}`);
  text = text.replace(navPattern, '');
  text = text.replace(/^\[!\[.*?\]\(.*?\)\]\(.*?\)\s*$/gm, '');
  text = text.replace(/<!--\s*readme-section:[^>]+-->/g, '');
  text = text.replace(/<!--\s*readme-source-sha256:[^>]+-->/g, '');
  return text.replace(/\s+/g, ' ').trim();
}
export function sourceDigest() {
  return createHash('sha256').update(semanticSourceText(), 'utf8').digest('hex');
}
export function sourceSectionDigests() {
  const text = readFileSync(resolve(root, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
  const ids = loadJson(resolve(docs, 'README_SCHEMA.json')).section_ids;
  const out = {};
  for (let i = 0; i < ids.length; i += 1) {
    const marker = `<!-- readme-section:${ids[i]} -->`;
    const start = text.indexOf(marker);
    if (start < 0) throw new Error(`Missing source section: ${ids[i]}`);
    const next = i + 1 < ids.length ? text.indexOf(`<!-- readme-section:${ids[i + 1]} -->`, start + marker.length) : text.length;
    const normalized = text.slice(start + marker.length, next < 0 ? text.length : next).replace(/\s+/g, ' ').trim();
    out[ids[i]] = createHash('sha256').update(normalized, 'utf8').digest('hex');
  }
  return out;
}
function loadState() {
  if (!existsSync(statePath)) return { schema: 'gpt-agent-manager.readme-translation-state.v1', source_locale: 'en', source_digest: '', translations: {} };
  return loadJson(statePath);
}
function writeState(state) { writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8'); }
function syncNavigation() {
  for (const item of languages()) {
    const path = resolve(root, item.file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    writeFileSync(path, replaceNavigation(text, item.locale), 'utf8');
  }
  console.log(`README_I18N_NAV_SYNC languages=${languages().length}`);
}
function status() {
  const digest = sourceDigest();
  const sections = sourceSectionDigests();
  const state = loadState();
  console.log(`en\tSOURCE\t${digest.slice(0, 12)}`);
  for (const item of languages()) {
    if (item.locale === 'en') continue;
    const entry = state.translations?.[item.locale] ?? {};
    const staleSections = Object.keys(sections).filter((id) => entry.section_digests?.[id] !== sections[id]);
    const current = entry.status === 'current' && entry.source_digest === digest && staleSections.length === 0;
    const detail = current ? 'CURRENT' : `STALE: ${staleSections.join(',') || 'source'}`;
    console.log(`${item.locale}\t${detail}\ttier=${item.tier}`);
  }
}
function markCurrent(locales) {
  const allowed = new Set(languages().filter((x) => x.locale !== 'en').map((x) => x.locale));
  for (const locale of locales) if (!allowed.has(locale)) throw new Error(`Unknown locale: ${locale}`);
  const digest = sourceDigest();
  const sections = sourceSectionDigests();
  const state = loadState();
  state.source_digest = digest; state.source_sections = sections; state.translations ??= {};
  for (const locale of locales) state.translations[locale] = { source_digest: digest, status: 'current', section_digests: sections };
  writeState(state);
  console.log(`README_I18N_MARK_CURRENT locales=${locales.join(',')} source=${digest.slice(0, 12)}`);
}
function initState() {
  const digest = sourceDigest();
  const sections = sourceSectionDigests();
  const state = { schema: 'gpt-agent-manager.readme-translation-state.v1', source_locale: 'en', source_digest: digest, source_sections: sections, translations: {} };
  for (const item of languages()) if (item.locale !== 'en') state.translations[item.locale] = { source_digest: digest, status: 'current', section_digests: sections };
  writeState(state);
  console.log(`README_I18N_STATE_INIT languages=${languages().length} source=${digest.slice(0, 12)}`);
}
const [command, ...args] = process.argv.slice(2);
if (command === 'sync-navigation') syncNavigation();
else if (command === 'status') status();
else if (command === 'mark-current') markCurrent(args);
else if (command === 'init-state') initState();
else throw new Error('Usage: node scripts/readme-i18n.mjs <sync-navigation|status|mark-current|init-state> [locales...]');
