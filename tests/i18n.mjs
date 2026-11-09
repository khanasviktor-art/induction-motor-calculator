/* Проверка переключения языка RU ⇄ EN:
   - в EN-режиме в интерфейсе (все вкладки, подсказки, отчёт, XLSX, canvas)
     не остаётся кириллицы;
   - выбор сохраняется в localStorage и переживает перезагрузку;
   - возврат на RU восстанавливает русский текст. */
import { chromium } from 'playwright-core';
import { APP_URL, chromePath } from './helpers.mjs';

const CYR = /[\u0400-\u04FF]/;
let failed = 0;
function check(cond, msg) {
  if (cond) console.log('ok   ' + msg);
  else { failed++; console.error('FAIL ' + msg); }
}

/* строки, которым кириллица разрешена: данные пользователя */
function allowed(s) {
  return false;
}

async function cyrillic(page) {
  return page.evaluate(({ pat }) => {
    const re = new RegExp(pat);
    const out = [];
    const attrs = ['title', 'placeholder', 'aria-label', 'alt'];
    const walk = node => {
      if (node.nodeType === 3) {
        const v = (node.nodeValue || '').replace(/\s+/g, ' ').trim();
        if (v && re.test(v)) out.push(v);
        return;
      }
      if (node.nodeType !== 1) return;
      if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;
      for (const a of attrs) {
        const v = node.getAttribute(a);
        if (v && re.test(v)) out.push('[' + a + '] ' + v);
      }
      for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
    };
    walk(document.body);
    /* canvas: текст, который ушёл в fillText */
    (window.__canvasText || []).forEach(v => { if (re.test(v)) out.push('[canvas] ' + v); });
    return [...new Set(out)];
  }, { pat: CYR.source });
}

const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1050 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(APP_URL);
await page.waitForTimeout(250);
await page.evaluate(() => {
  localStorage.setItem('motor-tour-v1', '1');
  localStorage.setItem('motor-calc-lang', 'ru');
});
await page.reload();
await page.waitForTimeout(800);

/* ловим текст, уходящий в canvas, и листы XLSX */
await page.evaluate(() => {
  window.__canvasText = [];
  const proto = CanvasRenderingContext2D.prototype;
  ['fillText', 'strokeText'].forEach(fn => {
    const orig = proto[fn];
    proto[fn] = function (text, ...rest) {
      try { if (typeof text === 'string') window.__canvasText.push(text); } catch (e) { }
      return orig.call(this, text, ...rest);
    };
  });
  window.__sheets = [];
  if (window.MC && window.MC.xlsx && window.MC.xlsx.build) {
    const orig = window.MC.xlsx.build.bind(window.MC.xlsx);
    window.MC.xlsx.build = function (sheets, imgs) {
      try {
        sheets.forEach(s => {
          window.__sheets.push(s.name);
          s.rows.forEach(r => r.forEach(v => { if (typeof v === 'string') window.__sheets.push(v); }));
        });
      } catch (e) { }
      return orig(sheets, imgs);
    };
  }
});

/* --- RU: русский текст на месте --- */
const ruText = await page.evaluate(() => document.body.innerText);
check(CYR.test(ruText), 'RU: интерфейс на русском');
check(await page.evaluate(() => document.documentElement.getAttribute('lang')) === 'ru', 'RU: html[lang=ru]');

/* --- переключение в EN --- */
await page.click('#segLang button[data-val="en"]');
await page.waitForTimeout(900);
/* журнал canvas очищаем: до переключения туда попадал русский текст */
await page.evaluate(() => { window.__canvasText = []; window.__sheets = []; });
check(await page.evaluate(() => localStorage.getItem('motor-calc-lang')) === 'en', 'EN: выбор сохранён в localStorage');
check(await page.evaluate(() => document.documentElement.getAttribute('lang')) === 'en', 'EN: html[lang=en]');
check(await page.evaluate(() => document.querySelector('#segLang button[data-val="en"]').classList.contains('active')), 'EN: кнопка активна');

/* все вкладки + подсказки */
const leftovers = [];
const tabs = ['calc', 'charts', 'start', 'cable', 'ref'];
for (const tab of tabs) {
  await page.click(`.tab-btn[data-tab="${tab}"]`);
  await page.waitForTimeout(700);
  (await cyrillic(page)).forEach(s => leftovers.push(tab + ': ' + s));
  /* подсказки */
  const n = (await page.$$('.tip-btn')).length;
  for (let i = 0; i < Math.min(n, 40); i++) {
    try {
      const b = (await page.$$('.tip-btn'))[i];
      await b.click({ force: true, timeout: 1200 });
      await page.waitForTimeout(20);
      const t = await page.$eval('#tipPop', el => el.textContent).catch(() => '');
      if (t && CYR.test(t)) leftovers.push(tab + ' tip: ' + t.slice(0, 120));
      await page.evaluate(() => { const p = document.querySelector('#tipPop'); if (p) p.classList.remove('show'); });
    } catch (e) { }
  }
}

/* модель пуска и однофазный режим */
await page.click('.tab-btn[data-tab="start"]');
await page.waitForTimeout(500);
if (await page.$('#simRun')) { await page.click('#simRun'); await page.waitForTimeout(2000); }
(await cyrillic(page)).forEach(s => leftovers.push('sim: ' + s));

await page.click('.tab-btn[data-tab="calc"]');
await page.waitForTimeout(300);
await page.click('#segPhases button[data-val="1"]');
await page.waitForTimeout(900);
(await cyrillic(page)).forEach(s => leftovers.push('1ph: ' + s));
await page.click('#segPhases button[data-val="3"]');
await page.waitForTimeout(700);

/* XLSX: строки листов */
await page.click('.tab-btn[data-tab="charts"]');
await page.waitForTimeout(400);
try { await page.click('#btnXlsx'); await page.waitForTimeout(1500); } catch (e) { }
const sheetLeft = await page.evaluate(() => (window.__sheets || []).filter(v => /[\u0400-\u04FF]/.test(v)));
sheetLeft.forEach(s => leftovers.push('xlsx: ' + s));

/* отчёт */
let reportLeft = [];
try {
  const [rep] = await Promise.all([
    ctx.waitForEvent('page', { timeout: 10000 }),
    page.click('#btnPrint')
  ]);
  await rep.waitForTimeout(1200);
  reportLeft = await rep.evaluate(() => {
    const re = /[\u0400-\u04FF]/;
    const out = [];
    const walk = node => {
      if (node.nodeType === 3) { const v = (node.nodeValue || '').trim(); if (v && re.test(v)) out.push(v); return; }
      if (node.nodeType !== 1) return;
      if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;
      for (const a of ['title', 'aria-label', 'alt']) { const v = node.getAttribute(a); if (v && re.test(v)) out.push('[' + a + '] ' + v); }
      for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
    };
    walk(document.body);
    if (re.test(document.title)) out.push('[title] ' + document.title);
    return [...new Set(out)];
  });
  await rep.close();
} catch (e) { console.error('отчёт:', e.message); }
reportLeft.forEach(s => leftovers.push('report: ' + s));

const uniq = [...new Set(leftovers)];
check(uniq.length === 0, `EN: кириллицы не осталось (найдено ${uniq.length})`);
if (uniq.length) uniq.slice(0, 60).forEach(s => console.error('   · ' + s.replace(/\s+/g, ' ').slice(0, 160)));

/* --- возврат на RU --- */
await page.click('#segLang button[data-val="ru"]');
await page.waitForTimeout(800);
await page.click('.tab-btn[data-tab="calc"]');
await page.waitForTimeout(600);
const backText = await page.evaluate(() => document.body.innerText);
check(CYR.test(backText), 'RU: русский вернулся');
check(backText.includes('Сечение') || backText.includes('Мощность') || backText.includes('номинальный'), 'RU: знакомые подписи на месте');

/* --- переживает перезагрузку --- */
await page.click('#segLang button[data-val="en"]');
await page.waitForTimeout(500);
await page.reload();
await page.waitForTimeout(900);
check(await page.evaluate(() => document.documentElement.getAttribute('lang')) === 'en', 'EN: язык сохранился после перезагрузки');
const afterReload = await cyrillic(page);
check(afterReload.length === 0, `EN после перезагрузки: без кириллицы (${afterReload.length})`);
if (afterReload.length) afterReload.slice(0, 20).forEach(s => console.error('   · ' + s.slice(0, 140)));

check(errors.length === 0, 'нет ошибок в консоли' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));

await browser.close();
console.log(failed ? `\ni18n: ПРОВАЛЕНО проверок: ${failed}` : '\ni18n: ok');
process.exit(failed ? 1 : 0);
