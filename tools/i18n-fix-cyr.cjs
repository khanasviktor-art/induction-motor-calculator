/* Чистит переводы от кириллицы:
   - мёртвые ключи вида «АИР160М4 · 18,50 кВт · 1 460 об/мин» удаляются
     (эти строки теперь собираются в коде через t()/nu());
   - в остальных значениях кириллические буквы типоразмеров транслитерируются.
   Запуск: node tools/i18n-fix-cyr.cjs */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'src', 'lang-en');
const MAP = {
  А: 'A', Б: 'B', В: 'B', Г: 'G', Д: 'D', Е: 'E', Ё: 'E', Ж: 'Z', З: 'Z', И: 'I',
  Й: 'I', К: 'K', Л: 'L', М: 'M', Н: 'H', О: 'O', П: 'P', Р: 'R', С: 'C', Т: 'T',
  У: 'U', Ф: 'F', Х: 'H', Ц: 'C', Ч: 'C', Ш: 'S', Щ: 'S', Ъ: '', Ы: 'Y', Ь: '', Э: 'E',
  Ю: 'U', Я: 'YA'
};
const latin = s => s.replace(/[А-ЯЁа-яё]/g, ch => (MAP[ch] !== undefined ? MAP[ch] : ch));
const CYR = /[\u0400-\u04FF]/;
const DEAD = /^АИР[^\s]*(\s\*)? · .*кВт.*об\/мин$/;

function load(file) {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(dir, file), 'utf8'), sandbox, { filename: file });
  return sandbox.window.MC_EN || {};
}

let totalDropped = 0, totalLatin = 0;
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.js')).sort()) {
  const dict = load(f);
  const dropped = [], converted = [];
  const kept = {};
  for (const k of Object.keys(dict)) {
    const v = dict[k];
    if (typeof v !== 'string' || !CYR.test(v)) { kept[k] = v; continue; }
    if (DEAD.test(k)) { dropped.push(k); continue; }
    kept[k] = latin(v);
    converted.push([k, v, kept[k]]);
  }
  if (!dropped.length && !converted.length) continue;

  const lines = [
    '/* ' + f.replace(/\.js$/, '') + ' — часть словаря RU→EN (пересобрано tools/i18n-fix-cyr.cjs) */',
    'window.MC_EN = Object.assign(window.MC_EN || {}, {'
  ];
  const keys = Object.keys(kept);
  keys.forEach((k, i) => lines.push('  ' + JSON.stringify(k) + ': ' + JSON.stringify(kept[k]) + (i < keys.length - 1 ? ',' : '')));
  lines.push('});');
  fs.writeFileSync(path.join(dir, f), lines.join('\n') + '\n', 'utf8');
  console.log(f, 'удалено мёртвых:', dropped.length, 'транслитерировано:', converted.length);
  converted.slice(0, 4).forEach(c => console.log('   ', JSON.stringify(c[1]).slice(0, 70), '→', JSON.stringify(c[2]).slice(0, 70)));
  totalDropped += dropped.length;
  totalLatin += converted.length;
}
console.log('итого: удалено', totalDropped, 'транслитерировано', totalLatin);
