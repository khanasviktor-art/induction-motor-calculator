/* Собирает реальные русские строки из работающего приложения (RU-режим):
   текстовые узлы, атрибуты, подсказки, отчёт, листы XLSX и CSV.
   Результат — i18n-work/rt.json, массив { ru, where }. */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const repo = path.join(__dirname, '..');
const APP_URL = 'file:///' + path.join(repo, 'index.html').replace(/\\/g, '/');
const chrome = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CYR = /[\u0400-\u04FF]/;
const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];

const seen = new Map();
function add(s, where) {
  const v = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  if (v.length < 2 || !CYR.test(v)) return;
  if (!seen.has(v)) seen.set(v, where);
}

async function collect(page, where) {
  const list = await page.evaluate(({ attrs }) => {
    const out = [];
    const walk = node => {
      if (node.nodeType === 3) { out.push(node.nodeValue); return; }
      if (node.nodeType !== 1) return;
      if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;
      for (const a of attrs) {
        const v = node.getAttribute(a);
        if (v) out.push(v);
      }
      for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
    };
    walk(document.body);
    return out;
  }, { attrs: ATTRS });
  list.forEach(v => add(v, where));
}

async function tips(page, where) {
  const n = (await page.$$('.tip-btn')).length;
  for (let i = 0; i < n; i++) {
    try {
      const b = (await page.$$('.tip-btn'))[i];
      if (!b) continue;
      await b.click({ force: true, timeout: 1500 });
      await page.waitForTimeout(25);
      add(await page.$eval('#tipPop', el => el.textContent).catch(() => ''), where);
      await page.evaluate(() => { const p = document.querySelector('#tipPop'); if (p) p.classList.remove('show'); });
    } catch (e) { }
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1050 }, acceptDownloads: true });
  const page = await ctx.newPage();
  await page.goto(APP_URL);
  await page.waitForTimeout(300);
  await page.evaluate(() => { localStorage.setItem('motor-tour-v1', '1'); localStorage.setItem('motor-calc-lang', 'ru'); });
  await page.reload();
  await page.waitForTimeout(900);

  /* перехват XLSX и CSV: читаем то, что уходит в файл */
  await page.evaluate(() => {
    window.__captured = [];
    const x = window.MC && window.MC.xlsx;
    if (x && x.build) {
      const orig = x.build.bind(x);
      x.build = function (sheets, imgs) {
        try {
          sheets.forEach(s => {
            window.__captured.push(s.name);
            s.rows.forEach(r => r.forEach(v => { if (typeof v === 'string') window.__captured.push(v); }));
          });
          (imgs || []).forEach(i => window.__captured.push(i.name));
        } catch (e) { }
        return orig(sheets, imgs);
      };
    }
    const OrigBlob = window.Blob;
    window.Blob = function (parts, opts) {
      try {
        (parts || []).forEach(p => { if (typeof p === 'string') window.__captured.push(p); });
      } catch (e) { }
      return new OrigBlob(parts, opts);
    };
    window.Blob.prototype = OrigBlob.prototype;
  });

  await collect(page, 'calc');
  await tips(page, 'tip-calc');

  for (const tab of ['calc', 'charts', 'start', 'cable', 'ref']) {
    await page.click(`.tab-btn[data-tab="${tab}"]`);
    await page.waitForTimeout(600);
    await collect(page, 'tab:' + tab);
    await tips(page, 'tip-' + tab);
  }

  /* модель пуска */
  await page.click('.tab-btn[data-tab="start"]');
  await page.waitForTimeout(400);
  if (await page.$('#simRun')) { await page.click('#simRun'); await page.waitForTimeout(2500); }
  await collect(page, 'sim');
  try {
    await page.selectOption('#simOverlay', 'vfd');
    await page.waitForTimeout(700);
    await collect(page, 'sim-overlay');
    await page.selectOption('#simOverlay', 'none');
  } catch (e) { }

  /* экспорт XLSX и CSV */
  await page.click('.tab-btn[data-tab="charts"]');
  await page.waitForTimeout(500);
  try { await page.click('#btnXlsx'); await page.waitForTimeout(1500); } catch (e) { console.error('xlsx', e.message); }
  try { await page.click('#btnCsv'); await page.waitForTimeout(600); } catch (e) { console.error('csv', e.message); }
  const cap = await page.evaluate(() => window.__captured || []);
  cap.forEach(v => add(v, 'export'));

  /* разные состояния: предупреждения и тексты проверок */
  await page.click('.tab-btn[data-tab="calc"]');
  await page.waitForTimeout(300);
  const setVal = async (id, v) => { try { await page.fill('#' + id, String(v)); await page.waitForTimeout(550); } catch (e) { } };

  await setVal('p2', 100); await collect(page, 'state-big');
  await setVal('len', 500); await collect(page, 'state-long');
  await setVal('isc', 3); await collect(page, 'state-isc');
  try { await page.selectOption('#startMethod', 'yd'); await page.waitForTimeout(700); await collect(page, 'state-yd'); } catch (e) { }
  try { await page.selectOption('#startMethod', 'vfd'); await page.waitForTimeout(700); await collect(page, 'state-vfd'); } catch (e) { }
  try { await page.selectOption('#startMethod', 'soft'); await page.waitForTimeout(700); await collect(page, 'state-soft'); } catch (e) { }
  try { await page.selectOption('#startMethod', 'autotr'); await page.waitForTimeout(700); await collect(page, 'state-at'); } catch (e) { }
  try { await page.selectOption('#startMethod', 'dol'); await page.waitForTimeout(500); } catch (e) { }
  try { await page.click('#segBrk button[data-val="mccb"]'); await page.waitForTimeout(700); await collect(page, 'state-mccb'); } catch (e) { }
  try { await page.click('#segBrk button[data-val="mcb"]'); await page.waitForTimeout(500); } catch (e) { }
  try { await page.selectOption('#loadType', 'constpower'); await page.waitForTimeout(700); await collect(page, 'state-constpower'); } catch (e) { }
  try { await page.selectOption('#loadType', 'custom'); await page.waitForTimeout(500); await collect(page, 'state-custom'); } catch (e) { }
  try { await page.selectOption('#loadType', 'quadratic'); await page.waitForTimeout(400); } catch (e) { }
  try { await page.check('#motorHotStart'); await page.waitForTimeout(700); await collect(page, 'state-hot'); } catch (e) { }
  try { await page.fill('#vtcUpstream', '250'); await page.waitForTimeout(700); await collect(page, 'state-upstream'); } catch (e) { }
  try { await page.selectOption('#insulation', 'xlpe'); await page.waitForTimeout(600); await collect(page, 'state-xlpe'); } catch (e) { }
  try { await page.selectOption('#laying', 'ground'); await page.waitForTimeout(600); await collect(page, 'state-ground'); } catch (e) { }
  try { await page.selectOption('#cableStandard', 'iec'); await page.waitForTimeout(600); await collect(page, 'state-iec'); } catch (e) { }

  /* однофазный */
  try {
    await page.click('#segPhases button[data-val="1"]');
    await page.waitForTimeout(900);
    await collect(page, 'single-phase');
    await tips(page, 'tip-1ph');
    await page.click('.tab-btn[data-tab="cable"]'); await page.waitForTimeout(700);
    await collect(page, 'single-phase-cable');
    await page.click('#segPhases button[data-val="3"]');
    await page.waitForTimeout(700);
  } catch (e) { }

  /* обучение */
  try {
    await page.click('#btnTour');
    await page.waitForTimeout(450);
    for (let i = 0; i < 9; i++) {
      await collect(page, 'tour');
      const next = await page.$('[data-tour="next"]');
      if (!next) break;
      await next.click();
      await page.waitForTimeout(300);
    }
  } catch (e) { }
  await page.evaluate(() => { const l = document.querySelector('#tourLayer'); if (l) l.remove(); });

  /* отчёт */
  try {
    const [rep] = await Promise.all([
      ctx.waitForEvent('page', { timeout: 10000 }),
      page.click('#btnPrint')
    ]);
    await rep.waitForTimeout(1500);
    await collect(rep, 'report');
    await rep.close();
  } catch (e) { console.error('отчёт:', e.message); }

  const rows = [...seen.entries()].map(([ru, where]) => ({ ru, where })).sort((a, b) => b.ru.length - a.ru.length);
  const outDir = path.join(repo, 'i18n-work');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  fs.writeFileSync(path.join(outDir, 'rt.json'), JSON.stringify(rows, null, 1), 'utf8');
  const byWhere = {};
  rows.forEach(r => { byWhere[r.where] = (byWhere[r.where] || 0) + 1; });
  console.log('строк:', rows.length, 'символов:', rows.reduce((s, r) => s + r.ru.length, 0), 'слов:', rows.map(r => r.ru).join(' ').split(/\s+/).length);
  console.log(JSON.stringify(byWhere, null, 1));
  await browser.close();
})();
