/* Аудит: каждый литерал, который проходит через t()/tf()/tHtml() в src/*.js,
   должен быть ключом собранного словаря src/lang-en.js.
   Ключ сравнивается как есть, с пробелами по краям (в словаре есть ключи
   вида « · оценка …» и « ({k}×Iн)»).
   Выход 1, если есть пропуски — так проверка попадает в tests/run.mjs и CI. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.join(__dirname, '..');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(repo, 'src', 'lang-en.js'), 'utf8'), sandbox, { filename: 'lang-en.js' });
const dict = sandbox.window.MC_EN || {};

const files = ['app.js', 'engine.js', 'charts.js', 'data.js', 'xlsx.js', 'vtc.js', 'sim.js']
  .map(f => path.join(repo, 'src', f))
  .filter(f => fs.existsSync(f));

const missing = new Map();
let total = 0;

for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /\b(?:t|tf|u|tHtml)\(\s*(?:'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`$\\]*)`)/g;
  let m;
  while ((m = re.exec(src))) {
    const v = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : (m[3] || '');
    if (!v || !/[\u0400-\u04FF]/.test(v)) continue;
    total++;
    if (dict[v] === undefined) {
      const line = src.slice(0, m.index).split('\n').length;
      if (!missing.has(v)) missing.set(v, path.basename(f) + ':' + line);
    }
  }
}

console.log('вызовов t()/tf()/tHtml() с русским текстом:', total, '| ключей без перевода:', missing.size);
for (const [k, where] of [...missing.entries()].sort((a, b) => b[0].length - a[0].length)) {
  console.log('  ·', JSON.stringify(k).slice(0, 140), '|', where);
}
process.exit(missing.size ? 1 : 0);
