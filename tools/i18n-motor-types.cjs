/* Генерирует src/lang-en/07-motor-types.js: типоразмеры серии АИР
   в английском написании (AIR160S4). Значения в данных не меняются —
   переводится только отображение (translateDom / t()).
     node tools/i18n-motor-types.cjs */
const fs = require('fs');
const path = require('path');

const repo = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(repo, 'src', 'data.js'), 'utf8');
const types = [...new Set([...src.matchAll(/'АИР[\wА-ЯЁ]*'/g)].map(m => m[0].slice(1, -1)))].sort();

/* Латиница для кодов: АИР112М4 → AIR112M4, АИР63В4 → AIR63B4 */
const MAP = {
  А: 'A', Б: 'B', В: 'B', Г: 'G', Д: 'D', Е: 'E', Ё: 'E', Ж: 'Z', З: 'Z', И: 'I',
  Й: 'I', К: 'K', Л: 'L', М: 'M', Н: 'H', О: 'O', П: 'P', Р: 'R', С: 'C', Т: 'T',
  У: 'U', Ф: 'F', Х: 'H', Ц: 'C', Ч: 'C', Ш: 'S', Щ: 'S', Ъ: '', Ы: 'Y', Ь: '', Э: 'E',
  Ю: 'U', Я: 'YA'
};
const latin = s => s.replace(/[А-ЯЁа-яё]/g, ch => (MAP[ch] !== undefined ? MAP[ch] : ch));

const lines = [
  '/* 07-motor-types — типоразмеры АИР → AIR (генерируется tools/i18n-motor-types.cjs) */',
  'window.MC_EN = Object.assign(window.MC_EN || {}, {'
];
for (const tp of types) lines.push('  ' + JSON.stringify(tp) + ': ' + JSON.stringify(latin(tp)) + ',');
lines.push('});');
fs.writeFileSync(path.join(repo, 'src', 'lang-en', '07-motor-types.js'), lines.join('\n') + '\n', 'utf8');
console.log('типоразмеров:', types.length);
