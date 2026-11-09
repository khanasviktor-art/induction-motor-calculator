/* Собирает src/lang-en/*.js в один src/lang-en.js (в порядке имён файлов).
   Каждый кусок — самостоятельный скрипт вида
     window.MC_EN = Object.assign(window.MC_EN || {}, { 'ключ': 'value', ... });
   Сборка проверяет синтаксис, конфликты ключей и пишет итоговый файл. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.join(__dirname, '..');
const dir = path.join(repo, 'src', 'lang-en');
const out = path.join(repo, 'src', 'lang-en.js');

const files = fs.existsSync(dir)
  ? fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort()
  : [];

const merged = new Map();
const conflicts = [];
let bad = 0;

for (const f of files) {
  const p = path.join(dir, f);
  const code = fs.readFileSync(p, 'utf8');
  const sandbox = { window: {} };
  try {
    vm.runInNewContext(code, sandbox, { filename: p, timeout: 5000 });
  } catch (e) {
    console.error('СИНТАКСИС', f + ':', e.message);
    bad++;
    continue;
  }
  const d = sandbox.window.MC_EN || {};
  Object.keys(d).forEach(k => {
    if (merged.has(k) && merged.get(k) !== d[k]) conflicts.push([k, merged.get(k), d[k], f]);
    merged.set(k, d[k]);
  });
  console.log(f, Object.keys(d).length, 'ключей');
}

if (bad) {
  console.error('сборка остановлена: исправьте синтаксис');
  process.exit(1);
}

const lines = [
  '/* ============================================================',
  '   Английский словарь (RU → EN). Ключ — русская строка ровно в том',
  '   виде, в каком она стоит в src/, значение — перевод.',
  '   Файл СОБИРАЕТСЯ из src/lang-en/*.js:',
  '     node tools/i18n-assemble.cjs',
  '   Правьте куски в src/lang-en/, а не этот файл.',
  '   ============================================================ */',
  'window.MC_EN = window.MC_EN || {};',
  'Object.assign(window.MC_EN, {'
];
const keys = [...merged.keys()].sort((a, b) => a.localeCompare(b, 'ru'));
for (const k of keys) lines.push('  ' + JSON.stringify(k) + ': ' + JSON.stringify(merged.get(k)) + ',');
lines.push('});');
fs.writeFileSync(out, lines.join('\n') + '\n', 'utf8');

console.log('собрано ключей:', keys.length, 'в', out);
if (conflicts.length) {
  console.error('КОНФЛИКТЫ (разные переводы одного ключа):', conflicts.length);
  conflicts.slice(0, 10).forEach(c => console.error('  ', JSON.stringify(c[0]), '|', c[1], 'vs', c[2], '|', c[3]));
  process.exit(1);
}
