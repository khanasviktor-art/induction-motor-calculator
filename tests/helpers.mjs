import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

export const APP_PATH = fileURLToPath(new URL('../index.html', import.meta.url));
export const APP_URL = pathToFileURL(APP_PATH).href;
export const DEBUG_URL = APP_URL + '?debug=1';

export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
       '/Applications/Chromium.app/Contents/MacOS/Chromium',
       '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary']
    : process.platform === 'win32'
      ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
         'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
         'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const found = candidates.find(p => { try { return fs.existsSync(p); } catch (e) { return false; } });
  if (!found) throw new Error('Chrome/Chromium не найден. Укажите CHROME_PATH=/path/to/chrome');
  return found;
}

export async function launch() {
  return chromium.launch({ executablePath: chromePath(), headless: true });
}

export async function openPage(browser, options = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1050 },
    acceptDownloads: true,
    ...options
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  return { ctx, page, errors };
}

export async function openDebug(browser, options = {}) {
  const h = await openPage(browser, options);
  await h.page.goto(DEBUG_URL);
  await h.page.waitForTimeout(250);
  await h.page.evaluate(() => localStorage.setItem('motor-tour-v1', '1'));
  await h.page.reload();
  await h.page.waitForTimeout(800);
  return h;
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function near(a, b, rel = 0.02) {
  return Math.abs(a - b) <= Math.max(Math.abs(b) * rel, 1e-6);
}

export function reportErrors(errors) {
  if (errors.length) {
    console.error('Ошибки страницы:', errors);
    return false;
  }
  return true;
}
