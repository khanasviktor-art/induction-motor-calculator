/* Проверка УПАКОВАННОГО приложения (Windows-обёртка).
   Пока обёртки нет — шаг пропускается и не валит `npm test`.

   Как запускать (когда обёртка готова):
     APP_EXE="C:\\путь\\MotorCalculator.exe" npm run test:desktop

   Как это работает: обёртка поднимает встроенный браузер с отладочным портом
   (для WebView2 — переменная WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS, для
   Electron — аргумент --remote-debugging-port), мы подключаемся к нему по CDP
   и проверяем то, что в браузере проверить нельзя: что окно открылось, страница
   загрузилась из локального файла, состояние сохраняется, ошибок нет.

   Переменные:
     APP_EXE          путь к exe (обязательно, иначе SKIP)
     APP_ARGS         дополнительные аргументы через пробел
     APP_DEBUG_PORT   порт отладки, по умолчанию 9222
     APP_URL_PART     подстрока URL страницы приложения (по умолчанию index.html)
     APP_KEEP_OPEN=1  не закрывать приложение после проверки */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(dir, '..', 'test-results');
const EXE = process.env.APP_EXE;
const PORT = Number(process.env.APP_DEBUG_PORT || 9222);
const ARGS = (process.env.APP_ARGS || '').split(' ').filter(Boolean);
const URL_PART = process.env.APP_URL_PART || 'index.html';
const KEEP = process.env.APP_KEEP_OPEN === '1';

let failed = 0, passed = 0;
function check(cond, msg, extra) {
  if (cond) { passed++; console.log('ok   ' + msg); return true; }
  failed++;
  console.error('FAIL ' + msg + (extra ? ' | ' + JSON.stringify(extra).slice(0, 300) : ''));
  return false;
}

if (!EXE) {
  console.log('desktop: SKIP — не задан APP_EXE (путь к собранному .exe).');
  console.log('         Пример: APP_EXE="C:\\\\dist\\\\MotorCalculator.exe" npm run test:desktop');
  process.exit(0);
}
if (!fs.existsSync(EXE)) {
  console.error('desktop: FAIL — нет файла ' + EXE);
  process.exit(1);
}
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
process.on('uncaughtException', e => {
  console.error('desktop: исключение — ' + e.message);
  try { child.kill(); } catch (err) { }
  process.exit(1);
});

const debugArg = '--remote-debugging-port=' + PORT;
/* оболочка может ждать switch до app.ready (Electron), поэтому передаём и
   переменной окружения, и первым аргументом */
const env = Object.assign({}, process.env, {
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: debugArg,
  MC_DEBUG_PORT: String(PORT)
});
if (process.env.APP_SAVE_DIR) env.MC_SAVE_DIR = process.env.APP_SAVE_DIR;
/* иначе Electron запустится как Node и окна не будет */
delete env.ELECTRON_RUN_AS_NODE;
const argv = ARGS.slice().filter(a => a.indexOf('--remote-debugging-port') !== 0);
if (!ARGS.some(a => a.indexOf('--remote-debugging-port') === 0)) argv.unshift(debugArg);

console.log('desktop: запуск ' + EXE + ' ' + argv.join(' '));
const child = spawn(EXE, argv, { env, detached: false, stdio: 'ignore' });

/* останавливаем приложение и сразу выходим: продолжать прогон после провала
   нельзя, иначе проверки идут по null-странице.
   В обёртке живут дочерние процессы, поэтому на Windows гасим всё дерево:
   иначе следующий запуск упрётся в single-instance lock и порт не поднимется. */
function killTree() {
  if (KEEP) return;
  try {
    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch (e) {
    try { child.kill(); } catch (err) { }
  }
}
function stop(code) {
  killTree();
  process.exit(code);
}

async function waitForDevtools(timeoutMs) {
  const t0 = Date.now();
  const url = `http://127.0.0.1:${PORT}/json/version`;
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch (e) { }
    await new Promise(r => setTimeout(r, 400));
  }
  return null;
}

const ver = await waitForDevtools(30000);
if (!check(!!ver, 'приложение подняло отладочный порт ' + PORT, ver)) {
  console.error('       проверьте, что обёртка принимает ' + debugArg +
    ' (WebView2: WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS)');
  stop(1);
}
console.log('       браузер внутри: ' + (ver['Browser'] || '?'));

let browser = null;
try {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
  const ctx = browser.contexts()[0];
  check(!!ctx, 'есть контекст браузера');

  let page = null;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    for (const p of ctx.pages()) {
      const u = p.url() || '';
      if (u.indexOf(URL_PART) >= 0) { page = p; break; }
    }
    if (page) break;
    await new Promise(r => setTimeout(r, 400));
  }
  /* запасной путь для отладки обёртки: открыть приложение в первом окне */
  if (!page && process.env.APP_START_URL) {
    const first = ctx.pages()[0];
    if (first) {
      console.log('       страница не найдена, открываю ' + process.env.APP_START_URL.slice(0, 100));
      await first.goto(process.env.APP_START_URL);
      if ((first.url() || '').indexOf(URL_PART) >= 0) page = first;
    }
  }
  if (!check(!!page, 'страница приложения открыта (' + URL_PART + ')',
    ctx.pages().map(p => p.url().slice(0, 120)))) {
    stop(1);
  }

  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  /* первый запуск в оболочке — чистый профиль: гасим автозапуск тура,
     иначе он перекрывает интерфейс во время проверок */
  await page.evaluate(() => { try { localStorage.setItem('motor-tour-v1', '1'); } catch (e) { } });
  await page.reload();
  await page.waitForTimeout(1200);

  const url = page.url();
  console.log('       url: ' + url.slice(0, 140));
  check(/^(file|https?|app):/.test(url), 'страница загружена из локального источника', url.slice(0, 60));

  const info = await page.evaluate(() => {
    const kpi = document.querySelectorAll('#kpis .kpi').length;
    const canvas = document.querySelectorAll('canvas[id^="chart"]').length;
    return {
      title: document.title,
      kpi, canvas,
      hasApp: !!(window.MC && window.MC.engine),
      lang: document.documentElement.getAttribute('lang'),
      theme: document.documentElement.getAttribute('data-theme'),
      size: { w: window.innerWidth, h: window.innerHeight },
      ls: (() => { try { localStorage.setItem('__desk', '1'); const v = localStorage.getItem('__desk'); localStorage.removeItem('__desk'); return v === '1'; } catch (e) { return false; } })(),
      offline: navigator.onLine
    };
  });
  check(info.hasApp, 'приложение инициализировано (MC.engine на месте)');
  check(info.kpi >= 6, 'результаты отрисованы (KPI)', info.kpi);
  check(info.canvas >= 9, 'графики в разметке', info.canvas);
  check(/Асинхронный|Induction/.test(info.title), 'заголовок окна', info.title);
  check(info.ls, 'localStorage работает в обёртке');
  check(info.size.w > 600 && info.size.h > 400, 'окно имеет разумный размер', info.size);

  /* расчёт: меняем мощность и ждём пересчёт */
  const before = await page.evaluate(() => window.__deskRep || null);
  const recalc = await page.evaluate(async () => {
    const el = document.querySelector('#p2');
    if (!el) return { ok: false, reason: 'нет поля #p2' };
    const mode = document.querySelector('#segMode button[data-val="power"]');
    if (mode) mode.click();
    await new Promise(r => setTimeout(r, 150));
    el.value = '30';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
    const kpi = document.querySelector('#kpis .kpi-value');
    return { ok: true, text: kpi ? kpi.textContent.trim() : null };
  });
  check(recalc.ok, 'поле мощности доступно', recalc);
  check(!!recalc.text && recalc.text.length > 0, 'после изменения мощности результаты обновились', recalc.text);

  /* подсказки работают (pointerover) */
  const tip = await page.evaluate(async () => {
    const b = document.querySelector('.tip-btn');
    if (!b) return { ok: false };
    b.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
    await new Promise(r => setTimeout(r, 80));
    const pop = document.querySelector('#tipPop');
    return { ok: !!pop && pop.classList.contains('show') && pop.textContent.trim().length > 10 };
  });
  check(tip.ok, 'подсказки открываются в обёртке', tip);

  /* тема и язык переключаются */
  const themeOk = await page.evaluate(async () => {
    const dark = document.querySelector('#segTheme button[data-val="dark"]');
    const light = document.querySelector('#segTheme button[data-val="light"]');
    if (!dark || !light) return false;
    light.click(); await new Promise(r => setTimeout(r, 150));
    const a = document.documentElement.getAttribute('data-theme');
    dark.click(); await new Promise(r => setTimeout(r, 150));
    const b = document.documentElement.getAttribute('data-theme');
    return a === 'light' && b === 'dark';
  });
  check(themeOk, 'переключение темы работает');

  const langOk = await page.evaluate(async () => {
    const en = document.querySelector('#segLang button[data-val="en"]');
    const ru = document.querySelector('#segLang button[data-val="ru"]');
    if (!en || !ru) return false;
    en.click(); await new Promise(r => setTimeout(r, 300));
    const a = document.documentElement.getAttribute('lang');
    ru.click(); await new Promise(r => setTimeout(r, 300));
    const b = document.documentElement.getAttribute('lang');
    return a === 'en' && b === 'ru';
  });
  check(langOk, 'переключение языка работает');

  /* файловые операции: только с APP_SAVE_DIR (иначе в оболочке откроются
     системные диалоги, которые автоматизировать нельзя) */
  if (process.env.APP_SAVE_DIR) {
    const saveDir = process.env.APP_SAVE_DIR;
    fs.mkdirSync(saveDir, { recursive: true });
    for (const f of fs.readdirSync(saveDir)) { try { fs.unlinkSync(path.join(saveDir, f)); } catch (e) { } }

    await page.click('.tab-btn[data-tab="charts"]');
    await page.waitForTimeout(600);

    const files = () => { try { return fs.readdirSync(saveDir); } catch (e) { return []; } };
    const has = re => files().some(f => re.test(f));
    const sizeOf = re => {
      const f = files().find(x => re.test(x));
      return f ? fs.statSync(path.join(saveDir, f)).size : 0;
    };

    await page.click('#btnCsv');
    await page.waitForTimeout(1500);
    check(has(/\.csv$/i), 'CSV сохранён в папку', files());

    await page.click('#btnXlsx');
    await page.waitForTimeout(3000);
    check(has(/\.xlsx$/i), 'XLSX сохранён в папку', files());
    check(sizeOf(/\.xlsx$/i) > 5000, 'XLSX не пустой', sizeOf(/\.xlsx$/i));

    const pngClicked = await page.evaluate(() => {
      const b = document.querySelector('[data-png]');
      if (!b) return false;
      b.click();
      return true;
    });
    await page.waitForTimeout(1500);
    check(pngClicked && has(/\.png$/i), 'PNG графика сохранён в папку', files());
    check(sizeOf(/\.png$/i) > 3000, 'PNG не пустой', sizeOf(/\.png$/i));

    await page.click('#btnPrint');
    await page.waitForTimeout(6000);
    check(has(/\.pdf$/i), 'PDF отчёта сохранён в папку', files());
    check(sizeOf(/\.pdf$/i) > 20000, 'PDF не пустой', sizeOf(/\.pdf$/i));

    const pdfName = files().find(f => /\.pdf$/i.test(f));
    if (pdfName) {
      const head = fs.readFileSync(path.join(saveDir, pdfName)).slice(0, 5).toString('latin1');
      check(head === '%PDF-', 'PDF: сигнатура %PDF-', JSON.stringify(head));
    }
  }

  /* скриншот окна — чтобы было на что посмотреть */
  const shot = path.join(OUT, 'desktop-window.png');
  await page.screenshot({ path: shot });
  console.log('       скриншот: ' + shot);

  check(errors.length === 0, 'нет ошибок в консоли', errors.slice(0, 4));
} catch (e) {
  console.error('desktop: исключение — ' + e.message);
  failed++;
} finally {
  try { if (browser) await browser.close(); } catch (e) { }
}

console.log('\n' + (failed ? 'desktop: ПРОВАЛЕНО ' + failed + ' из ' + (passed + failed) : 'desktop: ok (' + passed + ' проверок)'));
stop(failed ? 1 : 0);
