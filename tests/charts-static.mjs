import { launch, openDebug, assert, near, reportErrors } from './helpers.mjs';

const scenarios = [
  { name: '3ph 15 fan75 50m', ph: 3, p2: 15, poles: 4, u: 380, f: 50, lt: 'quadratic', load: 75, len: 50 },
  { name: '3ph 15 fan100', ph: 3, p2: 15, poles: 4, u: 380, f: 50, lt: 'quadratic', load: 100, len: 50 },
  { name: '3ph 15 const75', ph: 3, p2: 15, poles: 4, u: 380, f: 50, lt: 'constant', load: 75, len: 50 },
  { name: '3ph 15 const150', ph: 3, p2: 15, poles: 4, u: 380, f: 50, lt: 'constant', load: 150, len: 50 },
  { name: '3ph 5.5 fan75', ph: 3, p2: 5.5, poles: 4, u: 380, f: 50, lt: 'quadratic', load: 75, len: 30 },
  { name: '3ph 2.2 2p fan50', ph: 3, p2: 2.2, poles: 2, u: 380, f: 50, lt: 'quadratic', load: 50, len: 20 },
  { name: '3ph 90 6p const100', ph: 3, p2: 90, poles: 6, u: 380, f: 50, lt: 'constant', load: 100, len: 200 },
  { name: '3ph 315 4p fan100', ph: 3, p2: 315, poles: 4, u: 380, f: 50, lt: 'quadratic', load: 100, len: 100 },
  { name: '3ph 15 60Hz', ph: 3, p2: 15, poles: 4, u: 380, f: 60, lt: 'quadratic', load: 75, len: 50 },
  { name: '1ph 2.2 cap fan75', ph: 1, p2: 2.2, poles: 4, u: 230, f: 50, lt: 'quadratic', load: 75, len: 50, type: 'capacitor' },
  { name: '1ph 5.5 split const75', ph: 1, p2: 5.5, poles: 4, u: 230, f: 50, lt: 'constant', load: 75, len: 30, type: 'split' },
  { name: '1ph 0.75 2p psc fan100', ph: 1, p2: 0.75, poles: 2, u: 230, f: 50, lt: 'quadratic', load: 100, len: 10, type: 'psc' },
  { name: '1ph 1.5 8p cap const100', ph: 1, p2: 1.5, poles: 8, u: 230, f: 50, lt: 'constant', load: 100, len: 20, type: 'capacitor' },
  { name: '1ph 11 cap const100', ph: 1, p2: 11, poles: 4, u: 230, f: 50, lt: 'constant', load: 100, len: 30, type: 'capacitor' },
  { name: '1ph 15 cap const100', ph: 1, p2: 15, poles: 4, u: 230, f: 50, lt: 'constant', load: 100, len: 30, type: 'capacitor' }
];

const browser = await launch();
const { ctx, page, errors } = await openDebug(browser);
let failed = 0;
try {
  for (const s of scenarios) {
    await page.evaluate(() => localStorage.removeItem('motor-calc-v1'));
    await page.reload();
    await page.waitForTimeout(700);
    await page.click(`#segPhases button[data-val="${s.ph}"]`);
    await page.waitForTimeout(150);
    await page.click('#segMode button[data-val="power"]');
    await page.waitForTimeout(150);
    await page.fill('#p2', String(s.p2));
    await page.fill('#voltage', String(s.u));
    await page.selectOption('#poles', String(s.poles));
    await page.selectOption('#loadType', s.lt);
    await page.fill('#len', String(s.len));
    if (s.f === 60) await page.click('#segFreq button[data-val="60"]');
    if (s.ph === 1) await page.selectOption('#motor1phType', s.type);
    await page.evaluate(v => {
      const el = document.getElementById('loadRange');
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, s.load);
    await page.waitForTimeout(1000);
    const d = await page.evaluate(() => {
      const q = window.__mcDebug, r = q.rep, m = r.motor, sw = r.sweep, ch = q.charts, st = q.state;
      const at = p => {
        const i = sw.load.indexOf(p);
        return { I: sw.I[i], U: sw.U[i], n: sw.n[i], s: sw.s[i], eta: sw.eta[i], cos: sw.cos[i], p1: sw.p1[i], p2: sw.p2[i], dU: sw.dU[i] };
      };
      const uOp = Math.min(1.05, Math.max(0.7, r.op.U / m.U));
      const tau = ch.torque.series[0].data, tauLoad = ch.torque.series[1].data;
      return {
        m: { p2: m.p2, i: m.i, n: m.n, ns: m.ns, mn: m.mn, eff: m.eff, cos: m.cos, mstAbs: m.mstAbs, mmax: m.mmaxReal.t, u: m.U, f: m.f, ph: m.phases },
        op: { n: r.op.n, I: r.op.I, U: r.op.U, T: r.op.T, Tload: r.op.Tload, eta: r.op.eta, cos: r.op.cos, cosT: r.op.cosT, p1: r.op.p1, p2: r.op.p2, loadPct: r.op.loadPct },
        at: { p0: at(0), p25: at(25), p50: at(50), p75: at(75), p100: at(100), p125: at(125), p150: at(150) },
        sw: { I: sw.I, U: sw.U, n: sw.n, s: sw.s, eta: sw.eta, cos: sw.cos, p1: sw.p1, p2: sw.p2 },
        ch: {
          tau, tauLoad,
          iu: ch.iu.series.map(x => x.data),
          speed: ch.speed.series.map(x => x.data),
          eff: ch.eff.series.map(x => x.data),
          power: ch.power.series.map(x => x.data),
          marker: ch.torque.opts.markerX
        },
        state: { loadPct: st.loadPct, loadType: st.loadType },
        cable: { loaded: r.cable.loaded, section: r.cable.section, parallel: r.cable.parallel },
        breaker: { poles: r.breaker.poles, In: r.breaker.In },
        tauStart: tau[0][0],
        tauMax: Math.max(...tau.map(x => x[0])),
        tauEnd: tau[tau.length - 1][0],
        tauSpeedStart: tau[0][1],
        tauSpeedEnd: tau[tau.length - 1][1],
        opT: MC.engine.torque(m, 1 - r.op.n / m.ns, uOp),
        opLoad: MC.engine.loadTorque(m, r.op.n, { type: st.loadType, pct: st.loadPct, breakaway: 1.15 }),
        uOp
      };
    });
    const { m, op, at, sw, ch, state, cable, breaker } = d;
    const problems = [];
    const chk = (cond, msg) => { if (!cond) problems.push(msg); };
    const atL = p => { const i = Math.round(p); return { I: sw.I[i], n: sw.n[i], U: sw.U[i] }; };
    chk(m.ph === s.ph, `phases ${m.ph}`);
    chk(m.f === s.f, `freq ${m.f}`);
    chk(m.ns === 120 * m.f / s.poles, `ns ${m.ns}`);
    chk(near(at.p100.p2, m.p2, 0.02), `p2@100 ${at.p100.p2.toFixed(2)} vs ${m.p2}`);
    chk(at.p100.I <= m.i * 1.06, `I@100 ${at.p100.I.toFixed(1)} vs ${m.i.toFixed(1)}`);
    chk(at.p100.n >= m.n * 0.99, `n@100 ${at.p100.n.toFixed(0)} vs ${m.n.toFixed(0)}`);
    chk(Math.abs(at.p100.eta - m.eff) <= Math.max(m.eff * 0.02, 0.2), `eta@100 ${at.p100.eta.toFixed(1)} vs ${m.eff}`);
    chk(Math.abs(at.p100.cos - m.cos) <= Math.max(m.cos * 0.02, 0.005), `cos@100 ${at.p100.cos.toFixed(3)} vs ${m.cos.toFixed(3)}`);
    chk(near(op.T, op.Tload, 0.002), `op T ${op.T.toFixed(2)} vs load ${op.Tload.toFixed(2)}`);
    chk(near(op.I, atL(state.loadPct).I, 0.015), `op I ${op.I.toFixed(2)} vs sweep${Math.round(state.loadPct)} ${atL(state.loadPct).I.toFixed(2)}`);
    chk(near(op.n, atL(state.loadPct).n, 0.002), `op n ${op.n.toFixed(1)} vs sweep${Math.round(state.loadPct)} ${atL(state.loadPct).n.toFixed(1)}`);
    chk(near(op.U, atL(state.loadPct).U, 0.002), `op U ${op.U.toFixed(1)} vs sweep${Math.round(state.loadPct)} ${atL(state.loadPct).U.toFixed(1)}`);
    for (let i = 1; i < sw.I.length; i++) {
      if (sw.I[i] < sw.I[i - 1] - 1e-6) problems.push('I not monotonic at ' + i);
      if (sw.U[i] > sw.U[i - 1] + 1e-6) problems.push('U not monotonic at ' + i);
      if (sw.n[i] > sw.n[i - 1] + 1e-6) problems.push('n not monotonic at ' + i);
      if (sw.s[i] < sw.s[i - 1] - 1e-6) problems.push('s not monotonic at ' + i);
    }
    chk(at.p100.eta >= at.p150.eta - 1.0, `eta100 ${at.p100.eta.toFixed(1)} < eta150 ${at.p150.eta.toFixed(1)}`);
    chk(at.p100.cos >= at.p150.cos - 0.015, `cos100 ${at.p100.cos.toFixed(3)} < cos150 ${at.p150.cos.toFixed(3)}`);
    chk(at.p0.eta < 1, `eta0 ${at.p0.eta}`);
    chk(at.p0.I < at.p50.I && at.p50.I < at.p100.I && at.p100.I < at.p150.I, 'I sequence');
    chk(at.p0.U > at.p50.U && at.p50.U > at.p100.U && at.p100.U > at.p150.U, 'U sequence');
    chk(near(d.tauStart, m.mstAbs * d.uOp * d.uOp, 0.02), `tauStart ${d.tauStart.toFixed(1)} vs ${(m.mstAbs * d.uOp * d.uOp).toFixed(1)}`);
    chk(near(d.tauMax, m.mmax * d.uOp * d.uOp, 0.02), `tauMax ${d.tauMax.toFixed(1)} vs ${(m.mmax * d.uOp * d.uOp).toFixed(1)}`);
    chk(d.tauEnd === 0, `tauEnd ${d.tauEnd}`);
    chk(Math.abs(d.tauSpeedStart) < 1e-9 && Math.abs(d.tauSpeedEnd - m.ns) < 1e-6, `tauSpeed ${d.tauSpeedStart}/${d.tauSpeedEnd} vs ${m.ns}`);
    chk(near(d.opT, op.T, 0.02), `opT ${d.opT.toFixed(2)} vs op.T ${op.T.toFixed(2)}`);
    chk(near(d.opLoad, op.Tload, 0.005), `opLoad ${d.opLoad.toFixed(2)} vs op.Tload ${op.Tload.toFixed(2)}`);
    chk(Math.abs(ch.marker - op.T) < 1e-6, 'marker = момент рабочей точки');
    chk(ch.tau.length === 241 && ch.tau[0].length === 2, 'tau length');
    const eq = (arr, key) => {
      for (let i = 0; i < sw[key].length; i++) {
        if (Math.abs(arr[i][1] - sw[key][i]) > 1e-9) return false;
      }
      return true;
    };
    chk(eq(ch.iu[0], 'I'), 'iu I data');
    chk(eq(ch.iu[1], 'U'), 'iu U data');
    chk(eq(ch.speed[0], 'n'), 'speed n data');
    chk(eq(ch.speed[1], 's'), 'speed s data');
    chk(eq(ch.eff[0], 'eta'), 'eff eta data');
    chk(eq(ch.power[0], 'p1'), 'power p1 data');
    chk(eq(ch.power[1], 'p2'), 'power p2 data');
    chk(ch.eff[1].every((p, i) => Math.abs(p[1] - sw.cos[i] * 100) < 1e-9), 'eff cos x100');
    chk(s.ph === 1 ? cable.loaded === 2 : cable.loaded === 3, `cable.loaded ${cable.loaded}`);
    chk(s.ph === 1 ? breaker.poles === 1 : breaker.poles === 3, `breaker.poles ${breaker.poles}`);
    const all = [...sw.I, ...sw.U, ...sw.n, ...sw.eta, ...sw.cos, ...sw.p1, ...sw.p2, ...ch.tau.map(x => x[0]), ...ch.tauLoad.map(x => x[0])];
    chk(all.every(x => isFinite(x)), 'non-finite');
    const status = problems.length ? 'FAIL' : 'ok';
    if (problems.length) failed++;
    console.log(`${status.padEnd(4)} ${s.name.padEnd(26)} I100=${at.p100.I.toFixed(1).padStart(6)} cos=${at.p100.cos.toFixed(3)} eta=${at.p100.eta.toFixed(1)} tauS=${d.tauStart.toFixed(0)} tauM=${d.tauMax.toFixed(0)} u=${d.uOp.toFixed(3)}`);
    if (problems.length) console.log('     ', problems.slice(0, 8).join(' | '));
  }
  assert(failed === 0, `статических сценариев с ошибками: ${failed}`);
  assert(reportErrors(errors), 'ошибки страницы');
} catch (e) {
  console.error('STATIC FAIL:', e.message);
  failed = 1;
} finally {
  await browser.close();
}
console.log(failed ? 'charts-static: FAIL' : 'charts-static: ok');
process.exitCode = failed ? 1 : 0;
