import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(dir);
const files = ['engine.mjs', 'smoke.mjs', 'charts-static.mjs', 'charts-transient.mjs', 'features.mjs', 'i18n.mjs'];
let failed = 0;

/* статическая проверка словаря: у каждого t()/tf() в src должен быть перевод */
console.log('\n=== i18n-audit ===');
const audit = spawnSync(process.execPath, [path.join(root, 'tools', 'i18n-audit.cjs')], { stdio: 'inherit', env: process.env });
if (audit.status !== 0) failed++;

for (const f of files) {
  console.log('\n=== ' + f + ' ===');
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) failed++;
}
console.log('\n' + (failed ? `ПРОВАЛЕНО файлов: ${failed}` : 'Все тесты прошли.'));
process.exitCode = failed ? 1 : 0;
