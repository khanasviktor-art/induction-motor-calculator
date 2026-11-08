import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = ['engine.mjs', 'smoke.mjs', 'charts-static.mjs', 'charts-transient.mjs', 'features.mjs'];
let failed = 0;
for (const f of files) {
  console.log('\n=== ' + f + ' ===');
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) failed++;
}
console.log('\n' + (failed ? `ПРОВАЛЕНО файлов: ${failed}` : 'Все тесты прошли.'));
process.exitCode = failed ? 1 : 0;
