import { launch, openDebug, openPage, APP_URL, assert, reportErrors } from './helpers.mjs';

const browser = await launch();
let ok = true;
try {
  const { ctx, page, errors } = await openDebug(browser);
  assert(await page.title() !== '', 'пустой title');
  assert((await page.textContent('.kpi-value')) !== '', 'нет KPI');
  assert(await page.$$eval('.kpi-value', els => els.length) >= 6, 'меньше 6 KPI');
  assert(await page.$$eval('canvas', els => els.length) >= 9, 'меньше 9 canvas');
  assert((await page.textContent('#statusText')).includes('готов'), 'нет статуса готов');
  for (const tab of ['charts', 'start', 'cable', 'ref', 'calc']) {
    await page.click(`.tab-btn[data-tab="${tab}"]`);
    await page.waitForTimeout(180);
    assert(await page.$eval(`.tab-btn[data-tab="${tab}"]`, e => e.classList.contains('active')), 'вкладка ' + tab);
    assert(await page.$eval(`.tab-panel[data-panel="${tab}"]`, e => e.classList.contains('active')), 'панель ' + tab);
  }
  await page.click('#segTheme button[data-val="light"]');
  await page.waitForTimeout(200);
  assert(await page.$eval('html', e => e.dataset.theme === 'light'), 'светлая тема');
  await page.click('#segTheme button[data-val="dark"]');
  await page.waitForTimeout(200);
  assert(await page.$eval('html', e => e.dataset.theme === 'dark'), 'тёмная тема');
  ok = reportErrors(errors) && ok;
  await ctx.close();

  // тур на чистом профиле
  const tourCtx = await openPage(browser);
  await tourCtx.page.goto(APP_URL);
  await tourCtx.page.waitForTimeout(1700);
  assert(await tourCtx.page.$('#tourLayer') !== null, 'тур не появился');
  assert((await tourCtx.page.textContent('#tourCard h4')).includes('Параметры'), 'первый шаг тура');
  await tourCtx.page.click('[data-tour="skip"]');
  await tourCtx.page.waitForTimeout(200);
  assert(await tourCtx.page.$('#tourLayer') === null, 'тур не закрылся');
  assert(await tourCtx.page.evaluate(() => localStorage.getItem('motor-tour-v1')) === '1', 'ключ тура');
  ok = reportErrors(tourCtx.errors) && ok;
  await tourCtx.ctx.close();

  // мобильный drawer
  const m = await openPage(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.page.goto(APP_URL);
  await m.page.waitForTimeout(300);
  await m.page.evaluate(() => localStorage.setItem('motor-tour-v1', '1'));
  await m.page.reload();
  await m.page.waitForTimeout(600);
  await m.page.click('#btnMenu');
  await m.page.waitForTimeout(350);
  assert(await m.page.$eval('body', e => e.classList.contains('drawer-open')), 'drawer не открылся');
  assert(await m.page.$eval('#sidebar', e => getComputedStyle(e).transform === 'none' || getComputedStyle(e).transform === 'matrix(1, 0, 0, 1, 0, 0)'), 'sidebar не выехал');
  await m.page.click('#drawerClose');
  await m.page.waitForTimeout(300);
  assert(!(await m.page.$eval('body', e => e.classList.contains('drawer-open'))), 'drawer не закрылся');
  ok = reportErrors(m.errors) && ok;
  await m.ctx.close();
} catch (e) {
  console.error('SMOKE FAIL:', e.message);
  ok = false;
}
await browser.close();
console.log(ok ? 'smoke: ok' : 'smoke: FAIL');
process.exitCode = ok ? 0 : 1;
