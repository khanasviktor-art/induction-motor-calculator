/* Проверка куска словаря:
     node tools/i18n-check.cjs src/lang-en/01-shell.js i18n-work/inv-1.json
   Разбирает файл (синтаксис JS), считает ключи, сверяет с инвентарём куска,
   предупреждает о пустых переводах и о потере подстановок {x}. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = process.argv[2];
const invPath = process.argv[3];
if (!file) { console.error('укажите файл словаря'); process.exit(2); }

const code = fs.readFileSync(file, 'utf8');
const sandbox = { window: {} };
try {
  vm.runInNewContext(code, sandbox, { filename: file, timeout: 5000 });
} catch (e) {
  console.error('СИНТАКСИС:', e.message);
  process.exit(1);
}
const dict = sandbox.window.MC_EN || {};
const keys = Object.keys(dict);
const bad = keys.filter(k => typeof dict[k] !== 'string' || !dict[k].trim());
const ph = [];
for (const k of keys) {
  const want = (k.match(/\{\w+\}/g) || []).sort().join(',');
  const got = (String(dict[k]).match(/\{\w+\}/g) || []).sort().join(',');
  if (want !== got) ph.push(k);
}
console.log(file, 'ключей:', keys.length);
if (bad.length) console.error('пустые/нестроковые значения:', bad.length);
if (ph.length) console.error('потеряны подстановки:', JSON.stringify(ph.slice(0, 10)));
if (invPath) {
  const inv = JSON.parse(fs.readFileSync(invPath, 'utf8'));
  const missing = inv.map(x => x.ru).filter(k => dict[k] === undefined);
  console.log('из инвентаря:', inv.length, 'не переведено:', missing.length);
  if (missing.length) console.log('НЕ ПЕРЕВЕДЕНО (первые 25):', JSON.stringify(missing.slice(0, 25), null, 1));
  process.exit(missing.length || bad.length ? 1 : 0);
}
process.exit(bad.length || ph.length ? 1 : 0);
