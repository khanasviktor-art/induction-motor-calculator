/* Собирает итоговый инвентарь для перевода и режет его на куски.

   Источники:
   1) i18n-work/rt.json — строки, реально увиденные в приложении (DOM, подсказки,
      отчёт, листы XLSX/CSV) — их собирает tools/i18n-collect.cjs;
   2) аргументы t('…') / tf('…') / tHtml('…') в src/*.js — строки редких ветвей,
      которые в прогоне могли не появиться.

   Пишет i18n-work/inv-N.json: [{ ru, where }] */
const fs = require('fs');
const path = require('path');

const repo = path.join(__dirname, '..');
const work = path.join(repo, 'i18n-work');
const CYR = /[\u0400-\u04FF]/;

const seen = new Map();
function add(s, where) {
  const v = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  if (v.length < 2 || !CYR.test(v)) return;
  if (!keep(v)) return;
  if (!seen.has(v)) seen.set(v, where);
}

/* отбрасываем данные, а не текст: выгрузки CSV, коды типоразмеров, пути */
function keep(v) {
  if ((v.match(/;/g) || []).length > 3) return false;          // CSV/дамп
  if (v.length > 900) return false;                            // простыня данных
  if (/^[А-ЯЁA-Z]{2,}[\d]/.test(v) && v.indexOf(' ') === -1) return false; // АИР160S4
  if (/^#[^ ]*\s/.test(v)) return false;
  return true;
}

const rtPath = path.join(work, 'rt.json');
if (fs.existsSync(rtPath)) {
  JSON.parse(fs.readFileSync(rtPath, 'utf8')).forEach(r => add(r.ru, r.where));
  console.log('из приложения:', seen.size);
}

const files = ['app.js', 'data.js', 'engine.js', 'charts.js', 'sim.js', 'xlsx.js', 'vtc.js', 'i18n.js'].map(f => path.join(repo, 'src', f));
let codeKeys = 0;
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const src = fs.readFileSync(f, 'utf8');
  const re = /\b(?:t|tf|u|tHtml)\(\s*(?:'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`$\\]*)`)/g;
  let m;
  while ((m = re.exec(src))) {
    const v = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
    if (!v || !CYR.test(v)) continue;
    const before = seen.size;
    add(v, 'code');
    if (seen.size > before) codeKeys++;
  }
}
console.log('добавлено из кода:', codeKeys, 'итого:', seen.size);

/* статическая разметка src/index.html — на случай, если в прогоне не открылась */
{
  const src = fs.readFileSync(path.join(repo, 'src/index.html'), 'utf8').split(/<script[\s\S]*?<\/script>/)[0];
  let m;
  const attrRe = /(title|placeholder|aria-label|alt)\s*=\s*"([^"]*)"/g;
  while ((m = attrRe.exec(src))) add(m[2], 'html-attr');
  src.split(/<[^>]*>/).forEach(p => add(p, 'html'));
  console.log('после разметки:', seen.size);
}

const rows = [...seen.entries()].map(([ru, where]) => ({ ru, where })).sort((a, b) => b.ru.length - a.ru.length);
fs.writeFileSync(path.join(work, 'inv-all.json'), JSON.stringify(rows, null, 1), 'utf8');
console.log('ВСЕГО строк:', rows.length, 'символов:', rows.reduce((s, r) => s + r.ru.length, 0), 'слов:', rows.map(r => r.ru).join(' ').split(/\s+/).length);

/* --- нарезка на куски, баланс по символам --------------------------------- */
const want = Number(process.argv[2] || 6);
for (const f of fs.readdirSync(work)) if (/^inv-\d+\.json$/.test(f)) fs.unlinkSync(path.join(work, f));

const total = rows.reduce((s, r) => s + r.ru.length + 12, 0);
const per = Math.ceil(total / want);
const chunks = [[]];
let acc = 0;
for (const r of rows) {
  const size = r.ru.length + 12;
  if (acc + size > per && chunks[chunks.length - 1].length) { chunks.push([]); acc = 0; }
  chunks[chunks.length - 1].push(r);
  acc += size;
}
chunks.forEach((c, i) => {
  const name = 'inv-' + (i + 1) + '.json';
  fs.writeFileSync(path.join(work, name), JSON.stringify(c, null, 1), 'utf8');
  console.log(name, c.length, 'строк,', c.reduce((s, x) => s + x.ru.length, 0), 'символов');
});
console.log('кусков:', chunks.length);
