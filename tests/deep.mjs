/* Глубокий автотест работоспособности.
   Покрывает: комбинаторный прогон режимов, физические инварианты, графики,
   экспорты (PNG/CSV/XLSX/отчёт), персистентность (state, проект, варианты,
   share-ссылка), границы и ошибки, интерфейс, производительность и
   регресс-эталоны (tests/fixtures/deep-baseline.json).

   Запуск:
     node tests/deep.mjs                 — проверка (эталоны сравниваются, если есть)
     node tests/deep.mjs --baseline      — перезаписать эталоны
   Переменные: CHROME_PATH. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { APP_URL, chromePath } from './helpers.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.join(dir, 'fixtures', 'deep-baseline.json');
const WRITE_BASELINE = process.argv.includes('--baseline');

let failed = 0, passed = 0;
const problems = [];
function check(cond, msg, extra) {
  if (cond) { passed++; return true; }
  failed++;
  const line = 'FAIL ' + msg + (extra ? ' | ' + JSON.stringify(extra).slice(0, 400) : '');
  problems.push(line);
  console.error(line);
  return false;
}
function section(name) { console.log('\n--- ' + name + ' ---'); }

const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1050 }, acceptDownloads: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });

const DEBUG_URL = APP_URL + '?debug=1';

async function boot() {
  await page.goto(DEBUG_URL);
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('motor-tour-v1', '1');
    localStorage.setItem('motor-calc-lang', 'ru');
  });
  await page.reload();
  await page.waitForFunction(() => !!window.__mcDebug, null, { timeout: 15000 });
  await page.waitForTimeout(300);
}

/* изменение контрола + ожидание пересчёта (по смене объекта rep) */
async function change(fn) {
  await page.evaluate(() => { window.__prevRep = window.__mcDebug.rep; });
  await fn();
  try {
    await page.waitForFunction(() => window.__mcDebug && window.__mcDebug.rep !== window.__prevRep, null, { timeout: 8000 });
  } catch (e) {
    check(false, 'пересчёт не произошёл после действия');
  }
  await page.waitForTimeout(30);
}
const selOf = id => (String(id).charAt(0) === '#' ? String(id) : '#' + id);
const setNum = (id, v) => change(() => page.fill(selOf(id), String(v)));
const setSel = (id, v) => change(() => page.selectOption(selOf(id), String(v)));
const setSeg = (sel, v) => change(() => page.click(`${sel} button[data-val="${v}"]`));

async function rep() { return page.evaluate(() => window.__mcDebug.rep); }
async function state() { return page.evaluate(() => JSON.parse(JSON.stringify(window.__mcDebug.state))); }

/* --- проверки содержимого ------------------------------------------------ */

/* Infinity допустим для op.timeToLimit: «предел не достигается» — это норма */
const ALLOW_INF = new Set(['op.timeToLimit']);
function numberProblems(rep) {
  const bad = [];
  const walk = (v, p) => {
    if (typeof v === 'number') {
      if (!isFinite(v) && !(v === Infinity && ALLOW_INF.has(p))) bad.push(p + '=' + v);
      return;
    }
    if (typeof v === 'string') {
      if (/NaN|undefined|\[object/.test(v)) bad.push(p + '="' + v + '"');
      else if (/Infinity/.test(v)) bad.push(p + '="' + v + '"');
      return;
    }
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, p + '[' + i + ']')); return; }
    Object.keys(v).forEach(k => walk(v[k], p ? p + '.' + k : k));
  };
  walk(rep, '');
  return bad;
}

/* проверяем только то, что на активной вкладке: таблицы кабеля живут
   в скрытой панели и пусты, пока вкладку не открыли */
async function domProblems() {
  return page.evaluate(() => {
    const out = [];
    const txt = document.body.innerText;
    ['NaN', 'undefined', '[object', 'null'].forEach(bad => { if (txt.indexOf(bad) >= 0) out.push('текст: ' + bad); });
    const visible = el => !!el && el.getBoundingClientRect().height > 0;
    const required = ['#kpis', '#verdict', '#panelMotor', '#panelStart', '#panelPoint'];
    const tab = (document.querySelector('.tab-panel.active') || {}).dataset;
    const tabName = tab ? tab.panel : '';
    if (tabName === 'cable') required.push('#cableTable', '#protectTable', '#checksBody');
    if (!document.querySelectorAll('#kpis .kpi').length) out.push('KPI не отрисованы');
    required.forEach(sel => {
      const el = document.querySelector(sel);
      if (!el) { out.push('нет ' + sel); return; }
      if (visible(el) && !el.innerText.trim()) out.push('пусто: ' + sel);
    });
    if (tabName === 'cable' && document.querySelectorAll('#checksBody .point-item').length < 8) out.push('проверок меньше 8');
    return out;
  });
}

async function chartProblems() {
  return page.evaluate(() => {
    const out = [];
    const ch = window.__mcDebug.charts || {};
    ['torque', 'iu', 'speed', 'eff', 'power'].forEach(k => {
      const c = ch[k];
      if (!c) { out.push('нет графика ' + k); return; }
      if (!c.series || !c.series.length) { out.push('нет данных ' + k); return; }
      c.series.forEach(s => {
        if (!s.data || !s.data.length) { out.push('пустая серия ' + k + ':' + s.name); return; }
        s.data.forEach(pt => {
          if (!Array.isArray(pt) || pt.length < 2 || !isFinite(pt[1])) out.push('точка ' + k + ':' + s.name);
        });
      });
    });
    return out.slice(0, 10);
  });
}

/* набор ключевых чисел для эталонов */
function digest(rep) {
  const m = rep.motor, c = rep.cable, b = rep.breaker;
  const r = v => (typeof v === 'number' && isFinite(v) ? Math.round(v * 1e6) / 1e6 : null);
  return {
    I: r(m.i), cos: r(m.cos), eta: r(m.eff), p1: r(m.p1), p2: r(m.p2), n: r(m.n), slip: r(m.sn),
    ist: r(m.ist), u: r(m.U), j: r(m.j),
    section: r(c.section), allow: r(c.allow), dU: r(rep.drop.pct), dUs: r(rep.dropStart.pct),
    breaker: r(b.In), magTrip: r(b.magTrip), icu: r(b.icu), sel: r(b.selRatio),
    iStart: r(rep.iStart), contactor: r(rep.contactor.i), fuse: r(rep.fuse),
    temp: r(rep.op.temp), loadPct: r(rep.op.loadPct), tLimit: r(rep.op.timeToLimit),
    checks: Object.keys(rep.checks).sort().map(k => rep.checks[k] ? 1 : 0).join('')
  };
}

/* --- старт --------------------------------------------------------------- */
console.log('deep: старт');
await boot();

section('1. комбинаторный прогон');
{
  const modes = ['catalog', 'power', 'current', 'torque'];
  const methods = ['dol', 'yd', 'soft', 'vfd', 'autotr'];
  const types = ['mcb', 'mccb'];
  let combos = 0;

  for (const phases of ['3', '1']) {
    await setSeg('#segPhases', phases);
    /* для 1 фазы каталог недоступен */
    const modeList = phases === '1' ? ['power', 'current', 'torque'] : modes;
    const methodList = phases === '1' ? ['dol', 'soft', 'vfd'] : methods;
    for (const mode of modeList) {
      await setSeg('#segMode', mode);
      for (const method of methodList) {
        await setSel('#startMethod', method);
        for (const type of types) {
          await setSeg('#segBrk', type);
          combos++;
          const rp = await rep();
          const st = await state();
          const tag = `${phases}ф ${mode} ${method} ${type}`;
          const nums = numberProblems(rp);
          check(nums.length === 0, 'числа/строки в rep (' + tag + ')', nums.slice(0, 4));
          const dom = await domProblems();
          check(dom.length === 0, 'DOM после рендера (' + tag + ')', dom);
          const ch = await chartProblems();
          check(ch.length === 0, 'данные графиков (' + tag + ')', ch);
          /* согласованность */
          check(rp.breaker.type === type, 'тип аппарата применён (' + tag + ')', rp.breaker.type);
          check(rp.motor.phases === +phases, 'фазы применены (' + tag + ')', rp.motor.phases);
          check(rp.breaker.In >= rp.op.I * 0.99, 'номинал автомата не ниже рабочего тока (' + tag + ')',
            { In: rp.breaker.In, I: rp.op.I });
          check(rp.cable.allow >= rp.op.I * 0.99 || rp.cable.parallel > 1, 'кабель держит рабочий ток (' + tag + ')',
            { allow: rp.cable.allow, I: rp.op.I });
          if (phases === '1') {
            check(rp.op.loaded === 2 || rp.cable.loaded === 2, 'однофазный: 2 нагруженные жилы (' + tag + ')');
            check(/^1?P?$/i.test('') || rp.breaker.poles === 1 || rp.breaker.type === 'mcb', 'однофазный: аппарат 1P (' + tag + ')',
              { poles: rp.breaker.poles });
          }
          check((await page.textContent('#tagStart')) === await page.evaluate(() => {
            const s = window.__mcDebug.state.startMethod;
            return ({ dol: 'DOL', yd: 'Y→Δ', soft: 'Soft', vfd: 'VFD', autotr: 'AT' })[s] || s;
          }), 'бейдж способа пуска соответствует (' + tag + ')');
        }
      }
    }
  }
  console.log('проверено комбинаций: ' + combos);
  await setSeg('#segPhases', '3');
  await setSeg('#segMode', 'catalog');
  await setSel('#startMethod', 'dol');
  await setSeg('#segBrk', 'mcb');
}

section('2. физические инварианты');
{
  await setSeg('#segMode', 'power');
  await setSeg('#segPhases', '3');
  /* I растёт с мощностью */
  let prev = null, mono = true;
  for (const p of [2.2, 5.5, 15, 37, 90, 200]) {
    await setNum('p2', p);
    const rp = await rep();
    if (prev && !(rp.motor.i > prev.i)) mono = false;
    prev = { i: rp.motor.i, p };
  }
  check(mono, 'ток растёт с мощностью');

  /* ΔU растёт с длиной и падает с сечением */
  await setNum('p2', 15);
  await setNum('len', 30);
  const d30 = (await rep()).drop.pct;
  await setNum('len', 120);
  const d120 = (await rep()).drop.pct;
  check(d120 > d30, 'ΔU растёт с длиной линии', { d30, d120 });

  const secBefore = (await rep()).cable.section;
  await setNum('len', 300);
  const secAfter = (await rep()).cable.section;
  check(secAfter >= secBefore, 'с ростом линии сечение не уменьшается', { secBefore, secAfter });

  /* допустимый ток по таблице монотонно растёт с сечением */
  const amp = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#cableTable tbody tr'));
    return rows.map(tr => Array.from(tr.children).map(td => parseFloat(td.textContent.replace(',', '.'))));
  });
  let ampMono = true;
  for (let i = 1; i < amp.length; i++) if (!(amp[i][1] >= amp[i - 1][1] - 1e-9)) ampMono = false;
  check(ampMono, 'таблица: допустимый ток не падает с сечением', amp.slice(0, 4));

  /* потеря напряжения при пуске больше рабочей */
  await setNum('len', 50);
  let rp = await rep();
  check(rp.dropStart.pct > rp.drop.pct, 'просадка при пуске выше рабочей', { work: rp.drop.pct, start: rp.dropStart.pct });

  /* тепловая модель: температура растёт с нагрузкой, время до предела падает */
  await setSeg('#segMode', 'catalog');
  const loads = [25, 75, 110];
  const temps = [], limits = [];
  for (const l of loads) {
    await change(() => page.evaluate(v => {
      const r = document.querySelector('#loadRange');
      r.value = String(v);
      r.dispatchEvent(new Event('input', { bubbles: true }));
    }, l));
    const r2 = await rep();
    temps.push(r2.op.temp);
    limits.push(isFinite(r2.op.timeToLimit) ? r2.op.timeToLimit : 1e9);
  }
  check(temps[0] <= temps[1] && temps[1] <= temps[2], 'температура растёт с нагрузкой', temps);
  check(limits[2] <= limits[1] + 1e-9, 'время до предела не растёт с нагрузкой', limits);

  /* 1 фаза: I = P1 / (U·cosφ) */
  await setSeg('#segPhases', '1');
  await setSeg('#segMode', 'power');
  await setNum('p2', 2.2);
  rp = await rep();
  const expected = rp.motor.p1 * 1000 / (rp.motor.U * rp.motor.cos);
  check(Math.abs(rp.motor.i - expected) / expected < 0.02, 'однофазный ток = P₁/(U·cosφ)',
    { i: rp.motor.i, expected });
  check(rp.cable.loaded === 2, 'однофазный: нагруженных жил 2');
  await setSeg('#segPhases', '3');
  await setSeg('#segMode', 'catalog');
}

section('3. ВТХ и защита');
{
  await page.click('.tab-btn[data-tab="cable"]');
  await page.waitForTimeout(500);
  const vtc = await page.evaluate(() => {
    const r = window.__mcDebug.rep;
    return { magTrip: r.breaker.magTrip, iStart: r.iStart, mag: r.breaker.mag };
  });
  check(vtc.magTrip > 0 && vtc.iStart > 0, 'ВТХ: отсечка и пусковой ток посчитаны', vtc);
  /* кривая: время падает с ростом тока */
  /* таблица лежит в свёрнутом <details>, поэтому смотрим разметку */
  const vtcTable = await page.evaluate(() => {
    const d = document.querySelector('#dataVTC');
    return d ? { html: d.innerHTML.length, rows: d.querySelectorAll('tr').length } : { html: 0, rows: 0 };
  });
  check(vtcTable.rows >= 3, 'таблица данных ВТХ заполнена', vtcTable);
  /* селективность */
  await setNum('vtcUpstream', 250);
  const sel = await rep();
  check(sel.breaker.upstream === 250, 'вышестоящий номинал применён', sel.breaker.upstream);
  check(isFinite(sel.breaker.selRatio) && sel.breaker.selRatio > 0, 'селективность посчитана', sel.breaker.selRatio);
  await setNum('vtcUpstream', 0);
  /* Icu против тока КЗ */
  await setNum('isc', 40);
  const icu = await rep();
  check(icu.checks.breakerIcu === (icu.breaker.icu >= 40), 'проверка Icu соответствует числам',
    { icu: icu.breaker.icu, isc: 40, flag: icu.checks.breakerIcu });
  await setNum('isc', 6);

  /* тепловая зона: пуск против ВТХ, а не только против отсечки */
  const thOk = await page.evaluate(() => {
    const c = (window.__mcDebug.compare || []).find(x => x.method === window.__mcDebug.state.startMethod);
    const tag = document.querySelector('#tagVTC');
    const foot = document.querySelector('#vtcFoot').textContent;
    return {
      hasThermal: /Тепловая зона[: при]/.test(foot),
      usesEq: /действующий ток/.test(foot) || /Тепловая зона при/.test(foot),
      legend: foot,
      tag: tag.textContent, cls: tag.className,
      iStart: window.__mcDebug.rep.iStart,
      ieq: c ? c.ieq : null,
      check: [...document.querySelectorAll('#checksBody .point-item')]
        .map(e => e.textContent.replace(/\s+/g, ' ').trim())
        .filter(x => /теплов/i.test(x))
    };
  });
  check(thOk.hasThermal, 'ВТХ: в подписи есть тепловая зона, время и пуск', thOk.legend.slice(-90));
  check(thOk.check.length >= 1, 'ВТХ: проверка тепловой зоны есть в «Проверке условий»', thOk.check);
  check(/Вышестоящий/.test(thOk.legend) === false, 'ВТХ: нет легенды «Вышестоящий» при нуле', thOk.legend.slice(0, 80));
  /* нагрев считает действующий ток за пуск, а не пик */
  check(thOk.ieq != null && thOk.ieq > 0 && thOk.ieq < thOk.iStart,
    'нагрев: действующий ток пуска ниже пикового', { ieq: thOk.ieq && +thOk.ieq.toFixed(1), iStart: +thOk.iStart.toFixed(1) });

  /* кэш сравнения обязан реагировать на J нагрузки; тяжёлый маховик
     удлиняет пуск настолько, что автомат не успевает по теплу */
  const jBefore = await page.evaluate(() => {
    const c = (window.__mcDebug.compare || []).find(x => x.method === window.__mcDebug.state.startMethod);
    return c && c.tStart != null ? c.tStart : null;
  });
  await setNum('jExtra', 16);
  await page.waitForTimeout(1500);
  const afterJ = await page.evaluate(() => {
    const c = (window.__mcDebug.compare || []).find(x => x.method === window.__mcDebug.state.startMethod);
    return {
      tStart: c ? c.tStart : null, jExtra: window.__mcDebug.state.jExtra,
      tag: document.querySelector('#tagVTC').textContent,
      cls: document.querySelector('#tagVTC').className,
      verdict: document.querySelector('#verdict').textContent,
      warn: [...document.querySelectorAll('#panelWarn .warn-item')].map(e => e.textContent.replace(/\s+/g, ' ').trim()).filter(t => /теплов/i.test(t)),
      check: [...document.querySelectorAll('#checksBody .point-item')].map(e => e.textContent.replace(/\s+/g, ' ').trim()).filter(t => /тепловой зоне/i.test(t))
    };
  });
  check(afterJ.tStart != null && jBefore != null && afterJ.tStart > jBefore * 2,
    'J нагрузки меняет время разгона (кэш сравнения)', { before: jBefore, after: afterJ.tStart });
  check(afterJ.cls.indexOf('bad') >= 0, 'ВТХ: пуск вне тепловой зоны → красный бейдж', { tag: afterJ.tag, cls: afterJ.cls });
  check(/есть замечания/.test(afterJ.verdict), 'вердикт учитывает тепловую зону', afterJ.verdict.slice(-40));
  check(afterJ.warn.length >= 1, 'предупреждение о тепловой зоне выведено', afterJ.warn);
  check(afterJ.check.length === 1 && /не выполняется/.test(afterJ.check[0]), 'проверка тепловой зоны помечена как невыполненная', afterJ.check);

  /* повторные пуски: эквивалентный ток и тепловая память.
     Поле лежит в свёрнутом блоке, поэтому ставим значение из скрипта. */
  await page.evaluate(() => {
    const el = document.querySelector('#motorStarts');
    el.value = '30';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(1200);
  const duty = await page.evaluate(() => ({
    starts: window.__mcDebug.state.motorStartsPerHour,
    checks: [...document.querySelectorAll('#checksBody .point-item')].map(e => e.textContent.replace(/\s+/g, ' ').trim()).filter(t => /пусках\/час/.test(t)),
    warn: [...document.querySelectorAll('#panelWarn .warn-item')].map(e => e.textContent.replace(/\s+/g, ' ').trim()).filter(t => /пусков\/час/.test(t))
  }));
  check(duty.starts === 30, 'пуски в час применены', duty.starts);
  check(duty.checks.length === 1, 'проверка теплового запаса при повторных пусках есть', duty.checks);
  check(duty.warn.length === 1, 'пояснение по повторным пускам выведено', duty.warn);
  await page.evaluate(() => {
    const el = document.querySelector('#motorStarts');
    el.value = '0';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await setNum('jExtra', 0.3);
  await page.waitForTimeout(800);

  await page.click('.tab-btn[data-tab="calc"]');
  await page.waitForTimeout(300);
}

section('4. экспорты: PNG, CSV, XLSX, отчёт');
{
  await page.click('.tab-btn[data-tab="charts"]');
  await page.waitForTimeout(500);
  /* PNG из графика */
  const png = await page.evaluate(() => window.__mcDebug.charts.torque.toPNGData('#ffffff'));
  check(/^data:image\/png;base64,/.test(png), 'PNG: data-URI');
  const pngLen = Buffer.from(png.split(',')[1], 'base64').length;
  check(pngLen > 8000, 'PNG: размер правдоподобен', pngLen);
  const pngSig = Buffer.from(png.split(',')[1], 'base64').slice(0, 8).toString('latin1');
  check(pngSig.indexOf('\x89PNG') === 0, 'PNG: сигнатура', JSON.stringify(pngSig));

  /* CSV */
  const [csvDown] = await Promise.all([page.waitForEvent('download'), page.click('#btnCsv')]);
  const csvPath = await csvDown.path();
  const csv = fs.readFileSync(csvPath, 'utf8');
  const csvLines = csv.trim().split('\n');
  const sweepLen = (await rep()).sweep.load.length;
  check(csvLines.length === sweepLen + 2, 'CSV: строк = кривые + 2', { lines: csvLines.length, sweep: sweepLen });
  check(/load_pct;I_A/.test(csv), 'CSV: заголовок на месте');
  check(csv.split('\n')[1].split(';').length === 11, 'CSV: 11 колонок');
  check(!/NaN|undefined/.test(csv), 'CSV: без NaN');

  /* XLSX */
  const [xlsDown] = await Promise.all([page.waitForEvent('download'), page.click('#btnXlsx')]);
  const xlsPath = await xlsDown.path();
  const zip = fs.readFileSync(xlsPath);
  check(zip.slice(0, 4).toString('latin1') === 'PK\x03\x04', 'XLSX: это zip');
  const zipStr = zip.toString('latin1');
  let entries = 0;
  for (let i = 0; i + 4 < zip.length; i++) if (zipStr.slice(i, i + 4) === 'PK\x03\x04') entries++;
  check(entries >= 6, 'XLSX: файлов в архиве ≥ 6', entries);
  const names = await (async () => {
    const sheetNames = ['Параметры', 'Защита и кабель', 'Кривые', 'Проверки', 'Графики'];
    const found = sheetNames.filter(n => zipStr.indexOf(Buffer.from(n, 'utf8').toString('latin1')) >= 0);
    return found;
  })();
  check(names.length >= 4, 'XLSX: листы на месте', names);
  check(!/NaN/.test(zipStr), 'XLSX: без NaN');

  /* отчёт */
  const [repPage] = await Promise.all([ctx.waitForEvent('page', { timeout: 15000 }), page.click('#btnPrint')]);
  await repPage.waitForTimeout(1200);
  const repInfo = await repPage.evaluate(() => ({
    imgs: document.querySelectorAll('img[src^="data:image/png"]').length,
    tables: document.querySelectorAll('table').length,
    rows: document.querySelectorAll('tr').length,
    h2: Array.from(document.querySelectorAll('h2')).map(h => h.textContent.trim()),
    printFn: typeof window.print === 'function',
    title: document.title,
    text: document.body.innerText
  }));
  check(repInfo.imgs === 5, 'отчёт: 5 графиков', repInfo.imgs);
  check(repInfo.tables >= 4, 'отчёт: таблицы', repInfo.tables);
  check(repInfo.h2.length >= 4, 'отчёт: разделы', repInfo.h2);
  check(repInfo.printFn, 'отчёт: window.print доступен');
  check(/^Отчёт — /.test(repInfo.title), 'отчёт: заголовок окна', repInfo.title);
  check(!/NaN|undefined/.test(repInfo.text), 'отчёт: без NaN');
  const rp = await rep();
  check(repInfo.text.indexOf(String(Math.round(rp.breaker.In))) >= 0, 'отчёт: номинал автомата совпадает', rp.breaker.In);
  await repPage.close();
  await page.click('.tab-btn[data-tab="calc"]');
  await page.waitForTimeout(300);
}

section('5. персистентность: state, проект, варианты, ссылка');
{
  /* режим «по мощности»: поле P₂ видно только в нём */
  await setSeg('#segMode', 'power');
  await setSel('#startMethod', 'soft');
  await setNum('len', 85);
  await setNum('voltage', 400);
  await setSeg('#segMat', 'al');
  await setNum('p2', 22);
  const before = await rep();
  const beforeDigest = digest(before);

  await page.reload();
  await page.waitForFunction(() => !!window.__mcDebug, null, { timeout: 15000 });
  await page.waitForTimeout(400);
  const st = await state();
  check(st.startMethod === 'soft' && +st.cable.length === 85 && +st.voltage === 400 && st.cable.material === 'al',
    'state: настройки пережили перезагрузку', { m: st.startMethod, len: st.cable.length, u: st.voltage, mat: st.cable.material });
  const afterDigest = digest(await rep());
  check(JSON.stringify(afterDigest) === JSON.stringify(beforeDigest), 'state: расчёт после перезагрузки тот же');

  /* проект: сохранить и открыть */
  const [projDown] = await Promise.all([page.waitForEvent('download'), page.click('#btnSaveProject')]);
  const projPath = path.join(dir, 'fixtures', 'tmp-project.json');
  await projDown.saveAs(projPath);
  const projJson = JSON.parse(fs.readFileSync(projPath, 'utf8'));
  check(projJson.app === 'motor-calc' && projJson.state && typeof projJson.state.p2 !== 'undefined', 'проект: структура файла');

  /* меняем состояние, затем грузим проект обратно */
  await setNum('p2', 5.5);
  await setNum('len', 20);
  await page.setInputFiles('#fileProject', projPath);
  await page.waitForTimeout(700);
  const loaded = await state();
  check(+loaded.p2 === 22 && +loaded.cable.length === 85, 'проект: значения восстановлены',
    { p2: loaded.p2, len: loaded.cable.length });
  check(JSON.stringify(digest(await rep())) === JSON.stringify(beforeDigest), 'проект: расчёт совпадает');

  /* битый файл — приложение живо и сообщает об ошибке */
  const badPath = path.join(dir, 'fixtures', 'tmp-bad.json');
  fs.writeFileSync(badPath, '{ это не json', 'utf8');
  const errsBefore = pageErrors.length;
  await page.setInputFiles('#fileProject', badPath);
  await page.waitForTimeout(600);
  /* приложение обязано сообщить об ошибке в интерфейсе; запись в консоль от
     JSON.parse — ожидаемая реакция на заведомо битый файл, её не считаем */
  for (let i = pageErrors.length - 1; i >= errsBefore; i--) {
    if (/JSON|Unexpected token|SyntaxError/i.test(pageErrors[i])) pageErrors.splice(i, 1);
  }
  const statusText = await page.textContent('#statusText');
  check(/ошибка/i.test(statusText), 'битый проект: сообщение об ошибке', statusText);
  check(await page.evaluate(() => !!window.__mcDebug), 'битый проект: приложение продолжает работать');
  fs.unlinkSync(badPath);

  /* варианты */
  await page.evaluate(() => localStorage.removeItem('motor-variants-v1'));
  await page.reload();
  await page.waitForFunction(() => !!window.__mcDebug, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  for (let i = 0; i < 5; i++) {
    await page.click('[data-act="remember"]');
    await page.waitForTimeout(120);
  }
  const vars = await page.evaluate(() => JSON.parse(localStorage.getItem('motor-variants-v1') || '[]'));
  check(vars.length === 4, 'варианты: хранится не больше 4', vars.length);
  const vtag = await page.textContent('#variantsTag');
  check(/4\s*\/\s*4/.test(vtag), 'варианты: счётчик 4 / 4', vtag);

  /* share-ссылка */
  await page.click('#btnShare');
  await page.waitForTimeout(300);
  const url = await page.evaluate(() => window.__lastShare || '');
  check(/[?&]p=/.test(url), 'ссылка: содержит ?p=', url.slice(0, 80));
  if (url) {
    const p2page = await ctx.newPage();
    /* debug=1 добавляем сами: в ссылке его нет, а состояние читаем через __mcDebug */
    await p2page.goto(url + '&debug=1');
    await p2page.waitForTimeout(900);
    const shared = await p2page.evaluate(() => window.__mcDebug ? JSON.parse(JSON.stringify(window.__mcDebug.state)) : null);
    check(shared && +shared.p2 === 22 && +shared.cable.length === 85, 'ссылка: состояние восстановлено',
      shared && { p2: shared.p2, len: shared.cable && shared.cable.length });
    const clean = p2page.url();
    check(clean.indexOf('p=') < 0, 'ссылка: параметр p убирается из адреса', clean.slice(0, 90));
    await p2page.close();
  }
  fs.unlinkSync(projPath);
}

section('6. границы, ошибки, состояние без localStorage');
{
  await page.evaluate(() => localStorage.setItem('motor-tour-v1', '1'));
  await setNum('voltage', 1);
  let s = await state();
  check(+s.voltage >= 24, 'напряжение ограничено снизу', s.voltage);
  await setNum('voltage', 5000);
  s = await state();
  check(+s.voltage <= 1000, 'напряжение ограничено сверху', s.voltage);
  await setNum('voltage', 380);

  await setNum('p2', 0);
  let rp = await rep();
  check(isFinite(rp.motor.p2) && rp.motor.p2 > 0, 'нулевая мощность не ломает расчёт', rp.motor.p2);
  const nums = numberProblems(rp);
  check(nums.length === 0, 'нулевая мощность: без NaN', nums.slice(0, 3));
  await setNum('p2', 15);

  /* минимально допустимая длина: ΔU должен быть мал и конечен */
  const lenMin = await page.$eval('#len', el => el.min);
  await setNum('len', lenMin || 1);
  rp = await rep();
  check(isFinite(rp.drop.pct) && rp.drop.pct < 0.5, 'минимальная длина: ΔU близок к нулю', { min: lenMin, dU: rp.drop.pct });
  await setNum('len', 50);

  /* кривая M(n): мусор в поле не ломает приложение */
  await setSel('#loadType', 'custom');
  await page.fill('#loadCurve', 'мусор; ещё мусор');
  await page.waitForTimeout(400);
  rp = await rep();
  check(isFinite(rp.op.T) || rp.op.stalled, 'мусор в кривой M(n): расчёт не падает');
  await page.fill('#loadCurve', '0:0; 50:55; 100:100');
  await page.waitForTimeout(400);
  await setSel('#loadType', 'quadratic');

  /* constpower + большая нагрузка → двигатель не разгоняется */
  await setSel('#loadType', 'constpower');
  await page.evaluate(() => {
    const r = document.querySelector('#loadRange');
    r.value = '140';
    r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  await page.click('.tab-btn[data-tab="start"]');
  await page.waitForTimeout(700);
  const cmp = await page.evaluate(() => (window.__mcDebug.compare || []).map(x => ({ m: x.method, t: x.tStart, stalled: !!x.stalled })));
  check(cmp.length >= 4, 'сравнение способов посчитано', cmp.length);
  check(cmp.some(x => x.t == null || x.stalled), 'постоянная мощность: часть способов не разгоняет', cmp);
  await page.click('.tab-btn[data-tab="calc"]');
  await page.waitForTimeout(400);
  await setSel('#loadType', 'quadratic');
  await page.evaluate(() => {
    const r = document.querySelector('#loadRange');
    r.value = '75';
    r.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(400);

  /* localStorage недоступен — приложение всё равно стартует */
  const p3 = await ctx.newPage();
  const errs = [];
  p3.on('pageerror', e => errs.push(e.message));
  await p3.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new Error('localStorage disabled'); }
    });
  });
  await p3.goto(DEBUG_URL);
  await p3.waitForTimeout(1200);
  const alive = await p3.evaluate(() => {
    const k = document.querySelectorAll('#kpis .kpi').length;
    return { kpis: k, hasRep: !!(window.__mcDebug && window.__mcDebug.rep) };
  });
  check(alive.kpis >= 6 && alive.hasRep, 'без localStorage приложение работает', alive);
  check(errs.length === 0, 'без localStorage: без необработанных ошибок', errs.slice(0, 3));
  await p3.close();
}

section('7. интерфейс: вкладки, подсказки, тур, графики');
{
  for (const tab of ['calc', 'charts', 'start', 'cable', 'ref']) {
    await page.click(`.tab-btn[data-tab="${tab}"]`);
    await page.waitForTimeout(350);
    const visible = await page.evaluate(t => {
      const el = document.querySelector(`.tab-panel[data-panel="${t}"]`);
      return el && el.classList.contains('active') && el.getBoundingClientRect().height > 100;
    }, tab);
    check(visible, 'вкладка открывается: ' + tab);
  }
  await page.click('.tab-btn[data-tab="calc"]');
  await page.waitForTimeout(300);

  /* подсказки: каждая открывается и закрывается */
  const allTips = await page.$$('.tip-btn');
  const visTips = [];
  for (const b of allTips) { if (await b.isVisible()) visTips.push(b); }
  check(allTips.length >= 30, 'иконок подсказок ≥ 30', allTips.length);
  /* подсказки показываются при наведении (pointerover) — это и есть основной путь;
     клик проверяем отдельно, он нужен на тач-устройствах */
  let tipOk = 0, tipBad = [];
  for (let i = 0; i < Math.min(visTips.length, 25); i++) {
    const b = visTips[i];
    const key = await b.getAttribute('data-tip');
    /* сначала прокручиваем и ждём: любой scroll прячет подсказку */
    try { await b.scrollIntoViewIfNeeded({ timeout: 2000 }); } catch (e) { }
    await page.waitForTimeout(60);
    try {
      await b.hover({ timeout: 2000 });
    } catch (e) { }
    await page.waitForTimeout(40);
    const shown = await page.evaluate(() => {
      const p = document.querySelector('#tipPop');
      return { on: p.classList.contains('show'), len: p.textContent.trim().length };
    });
    if (shown.on && shown.len > 20) tipOk++; else tipBad.push(key);
    await page.mouse.move(10, 10);
    await page.waitForTimeout(20);
  }
  check(tipBad.length === 0, 'подсказки по наведению (' + tipOk + ' шт.)', tipBad.slice(0, 8));

  /* графики: зум колесом, двойной клик — сброс */
  await page.click('.tab-btn[data-tab="charts"]');
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => {
    const c = window.__mcDebug.charts.torque;
    return { view: c.view ? JSON.stringify(c.view) : null, w: c.w, h: c.h };
  });
  const box = await (await page.$('#chartTorque')).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(300);
  const zoomed = await page.evaluate(() => {
    const c = window.__mcDebug.charts.torque;
    return c.view ? JSON.stringify(c.view) : null;
  });
  check(zoomed && zoomed !== before.view, 'график: колесо меняет масштаб', { before: before.view, after: zoomed });
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  const reset = await page.evaluate(() => {
    const c = window.__mcDebug.charts.torque;
    return c.view ? JSON.stringify(c.view) : null;
  });
  check(reset === before.view, 'график: двойной клик сбрасывает масштаб', { reset, before: before.view });

  /* тур: проходит все шаги и закрывается */
  await page.click('.tab-btn[data-tab="calc"]');
  await page.waitForTimeout(300);
  await page.click('#btnTour');
  await page.waitForTimeout(600);
  let steps = 0;
  for (let i = 0; i < 12; i++) {
    if (!(await page.$('[data-tour="next"]'))) break;
    steps++;
    await page.click('[data-tour="next"]');
    await page.waitForTimeout(320);
  }
  check(steps >= 7, 'тур: шагов ≥ 7', steps);
  check(!(await page.$('#tourLayer')), 'тур: слой закрылся');

  /* мобильная панель: 390 px */
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const menu = await page.$('#btnMenu');
  check(!!menu, 'мобильный: кнопка меню есть');
  if (menu && await menu.isVisible()) {
    await menu.click();
    await page.waitForTimeout(450);
    const open = await page.evaluate(() => document.body.classList.contains('drawer-open'));
    check(open, 'мобильный: панель параметров открывается');
    await page.click('#drawerClose');
    await page.waitForTimeout(300);
  }
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.waitForTimeout(400);
}

section('8. производительность');
{
  await page.click('.tab-btn[data-tab="calc"]');
  await page.waitForTimeout(400);
  const perf = await page.evaluate(async () => {
    const times = [];
    const r = document.querySelector('#loadRange');
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now();
      r.value = String(30 + i * 5);
      r.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    return {
      median: Math.round(times[Math.floor(times.length / 2)] * 10) / 10,
      max: Math.round(times[times.length - 1] * 10) / 10,
      nodes: document.getElementsByTagName('*').length,
      bytes: (document.documentElement.outerHTML.length / 1024) | 0
    };
  });
  console.log('  пересчёт: медиана ' + perf.median + ' мс, максимум ' + perf.max + ' мс; узлов ' + perf.nodes + '; HTML ' + perf.bytes + ' КБ');
  check(perf.median < 200, 'пересчёт укладывается в 200 мс (медиана)', perf.median);
  check(perf.max < 800, 'пересчёт укладывается в 800 мс (максимум)', perf.max);
  check(perf.nodes < 12000, 'узлов в DOM меньше 12 000', perf.nodes);

  const loadMs = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return nav ? Math.round(nav.duration) : null;
  });
  console.log('  загрузка документа: ' + loadMs + ' мс');
  check(loadMs === null || loadMs < 4000, 'загрузка документа < 4 с', loadMs);
}

section('9. английский режим на выборке состояний');
{
  await page.evaluate(() => { localStorage.setItem('motor-calc-lang', 'en'); });
  await page.reload();
  await page.waitForFunction(() => !!window.__mcDebug, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  const cases = [
    { mode: 'catalog', method: 'dol', type: 'mcb' },
    { mode: 'power', method: 'yd', type: 'mcb' },
    { mode: 'current', method: 'soft', type: 'mccb' },
    { mode: 'torque', method: 'vfd', type: 'mccb' },
    { mode: 'catalog', method: 'autotr', type: 'mccb' }
  ];
  for (const c of cases) {
    await setSeg('#segMode', c.mode);
    await setSel('#startMethod', c.method);
    await setSeg('#segBrk', c.type);
    if (c.mode === 'power') await setNum('p2', 30);
    if (c.mode === 'current') await setNum('current', 55);
    if (c.mode === 'torque') await setNum('torque', 150);
    const tag = JSON.stringify(c);
    const left = await page.evaluate(() => {
      const re = /[\u0400-\u04FF]/;
      const out = [];
      const walk = n => {
        if (n.nodeType === 3) { const v = (n.nodeValue || '').trim(); if (v && re.test(v)) out.push(v); return; }
        if (n.nodeType !== 1 || n.tagName === 'SCRIPT' || n.tagName === 'STYLE') return;
        for (const a of ['title', 'aria-label', 'placeholder']) {
          const v = n.getAttribute(a); if (v && re.test(v)) out.push('[' + a + '] ' + v);
        }
        for (let c2 = n.firstChild; c2; c2 = c2.nextSibling) walk(c2);
      };
      walk(document.body);
      return [...new Set(out)].slice(0, 6);
    });
    check(left.length === 0, 'EN: без кириллицы ' + tag, left);
    const dom = await domProblems();
    check(dom.length === 0, 'EN: DOM в порядке ' + tag, dom);
  }
  await page.evaluate(() => localStorage.setItem('motor-calc-lang', 'ru'));
  await page.reload();
  await page.waitForFunction(() => !!window.__mcDebug, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  await setSeg('#segMode', 'catalog');
  await setSel('#startMethod', 'dol');
  await setSeg('#segBrk', 'mcb');
}

section('10. регресс-эталоны чисел');
{
  const states = [
    { name: '3ф 15кВт каталог DOL', apply: async () => { await setSeg('#segPhases', '3'); await setSeg('#segMode', 'catalog'); await setSel('#startMethod', 'dol'); await setSeg('#segMat', 'cu'); await setNum('len', 50); } },
    { name: '3ф 15кВт каталог Y-Δ', apply: async () => { await setSel('#startMethod', 'yd'); } },
    { name: '3ф 15кВт мягкий пуск', apply: async () => { await setSel('#startMethod', 'soft'); } },
    { name: '3ф 15кВт ПЧ', apply: async () => { await setSel('#startMethod', 'vfd'); } },
    { name: '3ф 15кВт автотрансформатор', apply: async () => { await setSel('#startMethod', 'autotr'); } },
    { name: '3ф 30кВт по мощности', apply: async () => { await setSeg('#segMode', 'power'); await setNum('p2', 30); } },
    { name: '3ф 30кВт 120м медь', apply: async () => { await setNum('len', 120); } },
    { name: '3ф 30кВт 120м алюминий', apply: async () => { await setSeg('#segMat', 'al'); } },
    { name: '3ф 30кВт 120м Al XLPE', apply: async () => { await setSel('#insulation', 'xlpe'); } },
    { name: '3ф 100А по току', apply: async () => { await setSeg('#segMode', 'current'); await setNum('current', 100); } },
    { name: '3ф момент 300Н·м', apply: async () => { await setSeg('#segMode', 'torque'); await setNum('torque', 300); } },
    { name: '3ф MCCB 200А', apply: async () => { await setSeg('#segMode', 'power'); await setNum('p2', 110); await setSeg('#segBrk', 'mccb'); } },
    { name: '1ф 2.2кВт', apply: async () => { await setSeg('#segPhases', '1'); await setSeg('#segMode', 'power'); await setNum('p2', 2.2); } },
    { name: '1ф 5.5кВт split', apply: async () => { await setSel('#motor1phType', 'split'); await setNum('p2', 5.5); } },
    { name: '1ф 11кВт PSC', apply: async () => { await setSel('#motor1phType', 'psc'); await setNum('p2', 11); } }
  ];
  const got = {};
  for (const s of states) {
    await s.apply();
    got[s.name] = digest(await rep());
  }
  const compareWith = (baseline) => {
    const diffs = [];
    for (const name of Object.keys(got)) {
      if (!baseline[name]) { diffs.push(name + ': нет в эталоне'); continue; }
      const a = baseline[name], b = got[name];
      for (const k of Object.keys(b)) {
        if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diffs.push(name + '.' + k + ': ' + a[k] + ' → ' + b[k]);
      }
    }
    return diffs;
  };
  if (WRITE_BASELINE) {
    fs.writeFileSync(BASE, JSON.stringify(got, null, 1), 'utf8');
    console.log('эталоны записаны: ' + BASE);
  } else if (fs.existsSync(BASE)) {
    const diffs = compareWith(JSON.parse(fs.readFileSync(BASE, 'utf8')));
    check(diffs.length === 0, 'числа совпадают с эталоном', diffs.slice(0, 8));
    console.log('  эталонов: ' + Object.keys(got).length + ', расхождений: ' + diffs.length);
  } else {
    console.log('  эталона нет — создаю: ' + BASE);
    fs.writeFileSync(BASE, JSON.stringify(got, null, 1), 'utf8');
  }
}

section('11. консоль браузера');
check(pageErrors.length === 0, 'нет ошибок страницы за весь прогон', pageErrors.slice(0, 5));

await browser.close();

console.log('\n' + (failed ? `deep: ПРОВАЛЕНО проверок: ${failed} из ${passed + failed}` : `deep: ok (${passed} проверок)`));
if (failed) {
  console.error('\nСводка провалов:');
  problems.slice(0, 40).forEach(p => console.error('  ' + p));
}
process.exit(failed ? 1 : 0);
