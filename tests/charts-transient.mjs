import { launch, openDebug, assert, near, reportErrors } from './helpers.mjs';

const browser = await launch();
const { ctx, page, errors } = await openDebug(browser);
let failed = 0;
const log = (...a) => console.log(...a);

async function base() {
  await page.evaluate(() => localStorage.removeItem('motor-calc-v1'));
  await page.reload();
  await page.waitForTimeout(700);
  await page.click('#segMode button[data-val="power"]');
  await page.waitForTimeout(120);
  await page.fill('#p2', '15');
  await page.fill('#voltage', '380');
  await page.selectOption('#poles', '4');
  await page.selectOption('#loadType', 'constant');
  await page.fill('#len', '50');
  await page.fill('#jExtra', '0.3');
  await page.evaluate(() => {
    const el = document.getElementById('loadRange');
    el.value = '75';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(900);
}

async function prep(method, iLimit) {
  await page.selectOption('#startMethod', method);
  await page.waitForTimeout(250);
  await page.click('.tab-btn[data-tab="start"]');
  await page.waitForTimeout(350);
  await page.selectOption('#simMethod', method);
  await page.waitForTimeout(250);
  if (method === 'soft' && iLimit) {
    await page.fill('#simIlimit', String(iLimit));
    await page.waitForTimeout(150);
  }
  await page.click('#segSimSpeed button[data-val="2"]');
  await page.waitForTimeout(150);
  await page.waitForTimeout(800);
}

async function run() {
  await page.click('#simPlay');
  await page.waitForFunction(() => {
    const s = window.__mcDebug.sim;
    return s && (s.tStart != null || s.t > 14);
  }, { timeout: 25000 });
  await page.waitForTimeout(350);
  return page.evaluate(() => {
    const q = window.__mcDebug;
    const s = q.sim;
    const c = (q.compare || []).find(x => x.method === q.state.startMethod);
    const m = q.rep.motor;
    const series = ch => ch.series.map(x => ({ name: x.name, axis: x.axis || 0, last: x.data[x.data.length - 1] }));
    return {
      method: q.state.startMethod,
      sim: {
        t: s.t, n: s.nNow, I: s.iNow, T: s.tNow, U: s.uNow * 100, f: s.fNow,
        tStart: s.tStart, peakI: s.peakI, peakT: s.peakT, stalled: s.stalled
      },
      first: s.samples.find(x => x.t >= 0.02),
      last: s.samples[s.samples.length - 1],
      cmp: c,
      m: { i: m.i, n: m.n, ns: m.ns, ist: m.ist, kst: m.kst, mn: m.mn },
      charts: {
        n: series(q.charts.simN), i: series(q.charts.simI),
        t: series(q.charts.simT), u: series(q.charts.simU)
      },
      overlay: q.state.sim.overlay,
      ghost: q.ghost ? { t: q.ghost.t, n: q.ghost.nNow, I: q.ghost.iNow, tStart: q.ghost.tStart, samples: q.ghost.samples.length } : null
    };
  });
}

async function statusRow(method) {
  const idx = { dol: 1, yd: 2, soft: 3, vfd: 4, autotr: 5 }[method];
  return (await page.$eval(`#compareTable tbody tr:nth-child(${idx}) td:last-child`, e => e.textContent.trim()));
}

try {
  const methods = [
    { method: 'dol', lim: 0, uMin: 80, uMax: 100, iFrac: 7.0 },
    { method: 'yd', lim: 0, uMin: 50, uMax: 65, iFrac: 4.5 },
    { method: 'soft', lim: 4.5, uMin: 25, uMax: 35, iFrac: 2.6 },
    { method: 'vfd', lim: 0, uMin: 0, uMax: 10, iFrac: 1.3 },
    { method: 'autotr', lim: 0, uMin: 55, uMax: 70, iFrac: 4.8 }
  ];
  for (const item of methods) {
    await base();
    await prep(item.method, item.lim);
    const r = await run();
    const row = await statusRow(item.method);
    const problems = [];
    const chk = (cond, msg) => { if (!cond) problems.push(msg); };
    chk(r.sim.tStart != null, 'нет tStart');
    chk(near(r.sim.tStart, r.cmp.tStart, 0.25), `tStart ${r.sim.tStart} vs ${r.cmp.tStart}`);
    chk(near(r.sim.peakI, r.cmp.peakI, 0.03), `peakI ${r.sim.peakI} vs ${r.cmp.peakI}`);
    chk(near(r.sim.peakT, r.cmp.peakT, 0.03), `peakT ${r.sim.peakT} vs ${r.cmp.peakT}`);
    chk(r.last.n >= r.m.n * 0.97, `nEnd ${r.last.n} vs ${r.m.n}`);
    chk(row.includes('разгон') && !row.includes('не выходит'), 'статус ' + row);
    chk(r.first.U >= item.uMin && r.first.U <= item.uMax, `first U ${r.first.U}`);
    chk(r.first.I <= r.m.i * item.iFrac * 1.15, `first I ${r.first.I} vs ${r.m.i * item.iFrac}`);
    chk(r.charts.n[0].last[1] >= r.sim.n * 0.98, 'chart n last');
    chk(r.charts.i[0].last[1] >= r.sim.I * 0.98, 'chart I last');
    chk(near(r.charts.u[0].last[1], r.sim.U, 0.02), 'chart U last');
    chk(r.charts.t[0].last[1] >= 0, 'chart T last');
    if (problems.length) failed++;
    log(`${problems.length ? 'FAIL' : 'ok  '} ${item.method.padEnd(6)} tStart=${r.sim.tStart?.toFixed(2)} cmp=${r.cmp?.tStart?.toFixed(2)} peakI=${r.sim.peakI.toFixed(0)}/${r.cmp?.peakI?.toFixed(0)} peakT=${r.sim.peakT.toFixed(0)}/${r.cmp?.peakT?.toFixed(0)} first U=${r.first.U.toFixed(0)}% I=${r.first.I.toFixed(0)} status=${row}`);
    if (problems.length) log('     ', problems.join(' | '));
  }

  // 3×Iн + 75 % постоянного момента: честный отказ
  await base();
  await prep('soft', 3);
  const fail3 = await run();
  const row3 = await statusRow('soft');
  const p3 = [];
  if (fail3.sim.tStart != null) p3.push('неожиданный разгон');
  if (!row3.includes('не выходит на скорость')) p3.push('статус ' + row3);
  if (fail3.sim.peakI > fail3.m.i * 3.3) p3.push('ток ' + fail3.sim.peakI);
  if (p3.length) failed++;
  log(`${p3.length ? 'FAIL' : 'ok  '} soft 3x tStart=${fail3.sim.tStart} peakI=${fail3.sim.peakI.toFixed(0)} status=${row3}`);
  if (p3.length) log('     ', p3.join(' | '));

  // Наложение DOL + ПЧ
  await base();
  await prep('dol');
  await page.selectOption('#simOverlay', 'vfd');
  await page.waitForTimeout(400);
  await page.click('#simPlay');
  await page.waitForTimeout(4500);
  const ov = await page.evaluate(() => ({
    p: window.__mcDebug.sim,
    g: window.__mcDebug.ghost,
    series: window.__mcDebug.charts.simN.series.map(x => x.name),
    note: document.getElementById('simOverlayNote').textContent
  }));
  const po = [];
  if (!ov.g) po.push('нет ghost');
  if (ov.g && ov.g.tStart == null) po.push('ghost не разогнался');
  if (ov.g && !(ov.g.nNow < ov.p.nNow)) po.push('ghost не медленнее');
  if (!ov.series.includes('VFD: n')) po.push('нет серии VFD');
  if (!ov.note.includes('Частотный привод')) po.push('нет подписи');
  if (po.length) failed++;
  log(`${po.length ? 'FAIL' : 'ok  '} overlay primary=${ov.p.nNow.toFixed(0)} ghost=${ov.g?.nNow?.toFixed(0)} series=${ov.series.join(',')}`);
  if (po.length) log('     ', po.join(' | '));

  // Однофазный 5,5 кВт, софтстартер 4×
  await page.evaluate(() => localStorage.removeItem('motor-calc-v1'));
  await page.reload();
  await page.waitForTimeout(700);
  await page.click('#segPhases button[data-val="1"]');
  await page.waitForTimeout(250);
  await page.click('#segMode button[data-val="power"]');
  await page.fill('#p2', '5.5');
  await page.fill('#voltage', '230');
  await page.selectOption('#loadType', 'constant');
  await page.fill('#len', '30');
  await page.fill('#jExtra', '0.3');
  await page.evaluate(() => {
    const el = document.getElementById('loadRange');
    el.value = '75';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(900);
  await prep('soft', 4);
  const one = await run();
  const oneRows = await page.$$eval('#compareTable tbody tr', trs => trs.map(tr => tr.textContent.replace(/\s+/g, ' ').trim()));
  const p1 = [];
  if (one.sim.tStart == null) p1.push('нет tStart');
  if (!oneRows[1].includes('разгон')) p1.push('софт: ' + oneRows[1]);
  if (oneRows.length !== 3) p1.push('методов ' + oneRows.length);
  if (one.sim.peakI > one.m.i * 4.2) p1.push('ток ' + one.sim.peakI);
  if (p1.length) failed++;
  log(`${p1.length ? 'FAIL' : 'ok  '} 1ph soft tStart=${one.sim.tStart?.toFixed(2)} peakI=${one.sim.peakI.toFixed(0)} rows=${oneRows.length}`);
  if (p1.length) log('     ', p1.join(' | '));

  if (!reportErrors(errors)) failed++;
  assert(failed === 0, `переходных сценариев с ошибками: ${failed}`);
} catch (e) {
  console.error('TRANSIENT FAIL:', e.message);
  failed = 1;
} finally {
  await browser.close();
}
console.log(failed ? 'charts-transient: FAIL' : 'charts-transient: ok');
process.exitCode = failed ? 1 : 0;
