import fs from 'node:fs';
import path from 'node:path';
import { launch, openDebug, openPage, APP_URL, assert, reportErrors } from './helpers.mjs';

const OUT = path.resolve('test-results');
fs.mkdirSync(OUT, { recursive: true });
const browser = await launch();
let failed = 0;
const check = (cond, msg) => { if (!cond) throw new Error(msg); };

try {
  // тур на чистом профиле
  const t = await openPage(browser);
  await t.page.goto(APP_URL);
  await t.page.waitForTimeout(1700);
  check(await t.page.$('#tourLayer') !== null, 'тур не появился');
  check((await t.page.textContent('#tourCard h4')).includes('Параметры'), 'не первый шаг');
  await t.page.click('[data-tour="next"]');
  await t.page.waitForTimeout(400);
  check((await t.page.textContent('#tourCard h4')).includes('Нагрузка'), 'второй шаг');
  await t.page.click('[data-tour="skip"]');
  await t.page.waitForTimeout(200);
  check(await t.page.$('#tourLayer') === null, 'тур не закрылся');
  check(await t.page.evaluate(() => localStorage.getItem('motor-tour-v1')) === '1', 'ключ тура');
  failed += reportErrors(t.errors) ? 0 : 1;
  await t.ctx.close();

  const { ctx, page, errors } = await openDebug(browser);

  // XLSX
  await page.click('.tab-btn[data-tab="charts"]');
  await page.waitForTimeout(500);
  const [xlsxDl] = await Promise.all([page.waitForEvent('download'), page.click('#btnXlsx')]);
  const xlsxPath = path.join(OUT, 'motor-report.xlsx');
  await xlsxDl.saveAs(xlsxPath);
  const xbuf = fs.readFileSync(xlsxPath);
  check(xbuf.length > 2000, 'XLSX слишком мал');
  check(xbuf[0] === 0x50 && xbuf[1] === 0x4b, 'XLSX не ZIP');
  check(xbuf.includes(Buffer.from('<worksheet')), 'нет worksheet');
  check(xbuf.includes(Buffer.from('Параметры')), 'нет листа Параметры');
  check(xbuf.includes(Buffer.from('xl/media/image1.png')), 'XLSX без картинок графиков');
  check(xbuf.includes(Buffer.from('xl/drawings/drawing1.xml')), 'XLSX без drawing');

  // CSV
  const [csvDl] = await Promise.all([page.waitForEvent('download'), page.click('#btnCsv')]);
  const csvPath = path.join(OUT, 'curves.csv');
  await csvDl.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8');
  check(csv.includes('load_pct') && csv.includes('I_A'), 'CSV без заголовка');
  check(csv.split('\n').length > 100, 'CSV слишком короткий');

  // разгрузка: release disabled при 0, включён при >0
  await page.fill('#loadUnload', '0');
  await page.waitForTimeout(350);
  check(await page.$eval('#loadRelease', el => el.disabled), 'release не заблокирован при 0');
  await page.fill('#loadUnload', '60');
  await page.waitForTimeout(350);
  check(!(await page.$eval('#loadRelease', el => el.disabled)), 'release не включился при 60');
  await page.fill('#loadUnload', '0');
  await page.waitForTimeout(250);

  // проект
  const [projDl] = await Promise.all([page.waitForEvent('download'), page.click('#btnSaveProject')]);
  const projPath = path.join(OUT, 'project.json');
  await projDl.saveAs(projPath);
  const proj = JSON.parse(fs.readFileSync(projPath, 'utf8'));
  check(proj.state && proj.state.p2 === 15, 'в проекте нет p2');
  await page.setInputFiles('#fileProject', projPath);
  await page.waitForTimeout(900);
  check((await page.inputValue('#p2')) === '15', 'проект не загрузился');
  await page.setInputFiles('#fileProject', 'tests/fixtures/legacy-motor-class.json');
  await page.waitForTimeout(800);
  check(await page.evaluate(() => window.__mcDebug.state.motorOverloadClass) === 20, 'legacy: класс не мигрировал');

  // share-ссылка
  await page.click('#btnShare');
  await page.waitForTimeout(400);
  const shareUrl = await page.evaluate(() => window.__lastShare);
  check(shareUrl && shareUrl.includes('?p='), 'share: нет ?p=');
  const sharedPage = await ctx.newPage();
  await sharedPage.goto(shareUrl);
  await sharedPage.waitForTimeout(800);
  check((await sharedPage.inputValue('#p2')) === '15', 'share: p2 не восстановился');
  await sharedPage.close();

  // своя кривая + разгрузка
  await page.selectOption('#loadType', 'custom');
  await page.waitForTimeout(200);
  check(!(await page.$eval('#fieldLoadCurve', e => e.classList.contains('hidden'))), 'custom: поле скрыто');
  await page.fill('#loadCurve', '0:0; 50:50; 100:100');
  await page.fill('#loadUnload', '80');
  await page.fill('#loadRelease', '25');
  await page.waitForTimeout(600);
  check(await page.evaluate(() => window.__mcDebug.state.loadType) === 'custom', 'custom: state');
  check(await page.evaluate(() => window.__mcDebug.state.loadUnload) === 80, 'unload: state');
  check((await page.textContent('#dataTorque')).includes('M нагрузки'), 'custom: нет таблицы графика');

  // объект в отчёте
  await page.fill('#projectName', 'Насосная станция №2');
  await page.waitForTimeout(300);

  // P2 не должен ссылаться на каталог
  await page.click('#segMode button[data-val="power"]');
  await page.waitForTimeout(250);
  await page.click('#segConn button[data-val="Y"]');
  await page.waitForTimeout(550);
  const p2w = (await page.$$eval('.warn-item', els => els.map(e => e.innerText.replace(/\s+/g, ' ')))).join(' | ');
  check(!p2w.includes('В каталоге выбран'), 'P2: каталожное предупреждение');
  check(await page.evaluate(() => window.__mcDebug.rep.motor.connFactor) === 1, 'P2: connFactor не 1');

  // каталог: Y/380 должен предупреждать
  await page.click('#segMode button[data-val="catalog"]');
  await page.waitForTimeout(300);
  await page.click('#segConn button[data-val="Y"]');
  await page.waitForTimeout(600);
  const catW = (await page.$$eval('.warn-item', els => els.map(e => e.innerText.replace(/\s+/g, ' ')))).join(' | ');
  check(catW.includes('380/660') || catW.includes('нужна Δ'), 'каталог: нет предупреждения Y/380');
  check(await page.evaluate(() => window.__mcDebug.rep.motor.connFactor) < 0.6, 'каталог: connFactor');

  // ВТХ
  await page.click('.tab-btn[data-tab="cable"]');
  await page.waitForTimeout(600);
  check(await page.$('#chartVTC') !== null, 'нет canvas ВТХ');
  const seriesOpts = await page.$$eval('#brkSeries option', os => os.map(o => o.value));
  check(seriesOpts.length === 6, 'ВТХ: не 6 серий');
  await page.selectOption('#brkSeries', 'iek-ba47-29');
  await page.waitForTimeout(500);
  check(await page.evaluate(() => window.__mcDebug.rep.breaker.brand) === 'IEK', 'ВТХ: серия не применилась');
  check((await page.textContent('#vtcFoot')).includes('IEK'), 'ВТХ: подпись не обновилась');
  await page.selectOption('#brkCurve', 'D');
  await page.waitForTimeout(400);
  await page.fill('#vtcUpstream', '100');
  await page.waitForTimeout(400);
  check(await page.evaluate(() => window.__mcDebug.state.upstreamIn) === 100, 'ВТХ: upstream');
  check((await page.textContent('#dataVTC')).includes('I/Iн'), 'ВТХ: нет таблицы данных');
  await page.fill('#vtcUpstream', '200');
  await page.waitForTimeout(400);
  check((await page.textContent('#vtcFoot')).includes('Селективность'), 'ВТХ: нет селективности');

  // отчёт
  const [pop] = await Promise.all([ctx.waitForEvent('page'), page.click('#btnPrint')]);
  await pop.waitForTimeout(1200);
  check((await pop.$$('img')).length === 5, 'в отчёте не 5 графиков');
  check((await pop.textContent('h1')).includes('Насосная станция'), 'в отчёте нет названия объекта');
  await pop.close();

  // однофазный режим
  await page.click('#segPhases button[data-val="1"]');
  await page.waitForTimeout(500);
  check(await page.$eval('#loaded', e => e.value === '2' && e.disabled), '1 фаза: loaded');
  check((await page.textContent('#panelProtect')).includes('1P'), '1 фаза: автомат');
  check(await page.$eval('#startMethod option[value="yd"]', e => e.disabled), '1 фаза: YD');
  check(!(await page.$eval('#field1phType', e => e.classList.contains('hidden'))), '1 фаза: тип скрыт');
  check((await page.textContent('#panelCable')).includes('2'), '1 фаза: жилы');
  await page.fill('#p2', '15');
  await page.waitForTimeout(700);
  const warnText = (await page.$$eval('.warn-item', els => els.map(e => e.innerText.replace(/\s+/g, ' ')))).join(' | ');
  check(warnText.includes('7,5') || warnText.includes('редкий'), 'нет предупреждения >7,5 кВт');
  check((await page.inputValue('#p2')) === '15', 'p2 15');
  check((await page.textContent('#kpis')).includes('оценка'), 'нет бейджа оценки 1ф');

  // реальный проект: постоянная мощность 95 %, Y/380, 6 полюсов
  await page.setInputFiles('#fileProject', path.resolve('tests/fixtures/constpower-y-6p.json'));
  await page.waitForTimeout(1200);
  const wtext = (await page.$$eval('.warn-item', els => els.map(e => e.innerText.replace(/\s+/g, ' ')))).join(' | ');
  check(wtext.includes('Постоянная мощность'), 'нет предупреждения constpower');
  const advice = (await page.textContent('#panelStart')).replace(/\s+/g, ' ');
  check(advice.includes('Постоянная мощность') || advice.includes('разгруз') || advice.includes('схема Y') || advice.includes('Δ'), 'рекомендация не учитывает constpower/схему');
  check((await page.textContent('#panelStart')).includes('не выходит на скорость'), 'нет формулировки «не выходит на скорость»');
  check((await page.textContent('#panelStart')).includes('схема Y') || (await page.textContent('#panelStart')).includes('Δ'), 'нет причины Y/Δ');
  check((await page.$$('.tip-btn[data-tip="loadUnload"]')).length === 1, 'нет подсказки «Разгрузка на пуске»');
  check((await page.$$('.tip-btn[data-tip="loadRelease"]')).length === 1, 'нет подсказки «Снять при»');
  check((await page.$$('.tip-btn[data-tip="motorHotStart"]')).length === 1, 'нет подсказки «Горячий пуск»');
  check((await page.$$('.tip-btn[data-tip="brkSeries"]')).length === 1, 'нет подсказки «Серия»');
  const rows = await page.$$eval('#compareTable tbody tr', trs => trs.map(tr => tr.textContent.replace(/\s+/g, ' ').trim()));
  check(rows.length === 5 && rows.every(r => r.includes('не выходит на скорость')), 'сравнение должно быть без разгона: ' + rows.join(' || '));

  // тема
  await page.click('#segTheme button[data-val="light"]');
  await page.waitForTimeout(300);
  check(await page.$eval('html', e => e.dataset.theme === 'light'), 'светлая тема');
  await page.click('#segTheme button[data-val="dark"]');
  await page.waitForTimeout(300);
  check(await page.$eval('html', e => e.dataset.theme === 'dark'), 'тёмная тема');

  // подсказка J нагрузки
  const field = page.locator('#jExtra').locator('xpath=ancestor::div[contains(@class,"field")]');
  await field.scrollIntoViewIfNeeded();
  await field.hover();
  await page.waitForTimeout(250);
  await field.locator('.tip-btn').hover();
  await page.waitForTimeout(350);
  check(await page.$eval('#tipPop', e => e.classList.contains('show')), 'подсказка не открылась');
  check((await page.textContent('#tipPop')).includes('J нагрузки'), 'текст подсказки');
  await page.mouse.move(10, 10);
  await page.waitForTimeout(200);

  // зум и PNG
  await page.click('.tab-btn[data-tab="charts"]');
  await page.waitForTimeout(600);
  const box = await page.locator('#chartTorque').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(300);
  const view = await page.evaluate(() => window.__mcDebug.charts.torque.view);
  check(view && view.x1 > view.x0, 'зум не сработал');
  await page.click('[data-reset="chartTorque"]');
  await page.waitForTimeout(250);
  check(await page.evaluate(() => window.__mcDebug.charts.torque.view === null), 'сброс зума');
  const [pngDl] = await Promise.all([page.waitForEvent('download'), page.click('[data-png="chartTorque"]')]);
  const pngPath = path.join(OUT, 'chartTorque.png');
  await pngDl.saveAs(pngPath);
  const pbuf = fs.readFileSync(pngPath);
  check(pbuf[0] === 0x89 && pbuf[1] === 0x50 && pbuf[2] === 0x4e && pbuf[3] === 0x47, 'PNG сигнатура');
  check(pbuf.length > 5000, 'PNG слишком мал');

  // тепловой режим: горячий/холодный, класс 20
  await page.click('.tab-btn[data-tab="start"]');
  await page.waitForTimeout(400);
  await page.$eval('#loadRange', el => { el.value = 150; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(600);
  const coldLim = await page.evaluate(() => window.__mcDebug.rep.op.timeToLimit);
  check(Number.isFinite(coldLim) && coldLim > 0, 'thermal: нет предела при 150%');
  await page.check('#motorHotStart');
  await page.waitForTimeout(500);
  const hotLim = await page.evaluate(() => window.__mcDebug.rep.op.timeToLimit);
  check(hotLim < coldLim, 'thermal: горячий пуск не короче');
  await page.selectOption('#motorClassOv', '20');
  await page.waitForTimeout(500);
  const classLim = await page.evaluate(() => window.__mcDebug.rep.op.timeToLimit);
  check(classLim > hotLim * 1.5, 'thermal: класс 20 не удлиняет');
  const beforeStarts = await page.evaluate(() => window.__mcDebug.rep.op.timeToLimit);
  await page.fill('#motorStarts', '6');
  await page.waitForTimeout(450);
  const afterStarts = await page.evaluate(() => window.__mcDebug.rep.op.timeToLimit);
  check(afterStarts < beforeStarts, 'thermal: пуски в час не влияют');
  await page.fill('#motorCoolTau', '10');
  await page.waitForTimeout(450);
  const afterCool = await page.evaluate(() => window.__mcDebug.rep.op.timeToLimit);
  check(afterCool > afterStarts, 'thermal: охлаждение не влияет');
  check((await page.textContent('#thermalFoot')).includes('Класс 20'), 'thermal: подпись класса');


  failed += reportErrors(errors) ? 0 : 1;
  await ctx.close();

  // мобильный drawer
  const m = await openPage(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await m.page.goto(APP_URL);
  await m.page.waitForTimeout(300);
  await m.page.evaluate(() => localStorage.setItem('motor-tour-v1', '1'));
  await m.page.reload();
  await m.page.waitForTimeout(700);
  await m.page.click('#btnMenu');
  await m.page.waitForTimeout(350);
  check(await m.page.$eval('body', e => e.classList.contains('drawer-open')), 'мобильный drawer');
  await m.page.click('#drawerClose');
  await m.page.waitForTimeout(300);
  check(!(await m.page.$eval('body', e => e.classList.contains('drawer-open'))), 'drawer не закрылся');
  failed += reportErrors(m.errors) ? 0 : 1;
  await m.ctx.close();

  assert(failed === 0, `функциональных ошибок: ${failed}`);
} catch (e) {
  console.error('FEATURES FAIL:', e.message);
  failed = 1;
} finally {
  await browser.close();
}
console.log(failed ? 'features: FAIL' : 'features: ok');
process.exitCode = failed ? 1 : 0;
