import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const document = await readFile(resolve(root, 'docs/DEPLOYMENT.md'), 'utf8');

const requiredSections = [
  '## 2. Deployment modes',
  '## 3. Release deployment',
  '## 4. Source deployment',
  '## 5. First launch and ChatGPT login',
  '## 6. Remote deployment with Remote Desktop Commander',
  '### 6.1 Prepare the Windows machine',
  '### 6.2 Deploy remotely',
  '### 6.3 Verify',
  '## 7. Useful commands and configuration',
  '## 8. Troubleshooting',
  '## 9. Uninstall and reset',
  '## 10. Security and release rules',
];
const requiredOperationalFacts = [
  'GAM_HOME',
  'GAM_PIPE_NAME',
  'GAM_EXTENSION_DIR',
  'GAM_BROWSER_PATH',
  'GAM.cmd doctor --json',
  'GAM.cmd status --json',
  'npm ci',
  'npm run verify:full',
  'allowed_origins',
  'HKCU',
  'NativeMessagingHosts',
  'Never paste passwords',
  'smallest practical filesystem root',
];

const missingSections = requiredSections.filter((section) => !document.includes(section));
const missingFacts = requiredOperationalFacts.filter((fact) => !document.includes(fact));
if (missingSections.length || missingFacts.length) {
  const details = [
    missingSections.length ? `sections=${missingSections.join(', ')}` : '',
    missingFacts.length ? `facts=${missingFacts.join(', ')}` : '',
  ].filter(Boolean).join('; ');
  throw new Error(`Deployment documentation contract failed: ${details}`);
}

console.log(`DEPLOYMENT_DOCS_CHECK_PASS sections=${requiredSections.length} operational_facts=${requiredOperationalFacts.length}`);
