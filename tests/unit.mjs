/* Unit-тесты чистого ядра: без DOM, без app.js, без i18n. */
import '../src/data.js';
import '../src/vtc.js';
import '../src/thermal.js';
import '../src/engine.js';
import '../src/sim.js';

const D = globalThis.MC.data;
const E = globalThis.MC.engine;
const V = globalThis.MC.vtc;
const T = globalThis.MC.thermal;
const S = globalThis.MC.sim;

let checks = 0;
let failed = 0;
const check = (cond, msg) => {
  checks++;
  if (!cond) { console.error('FAIL', msg); failed++; }
};
const near = (a, b, rel = 0.01) => Math.abs(a - b) <= Math.max(Math.abs(b) * rel, 1e-6);
const finite = v => typeof v === 'number' && Number.isFinite(v);

const cat = D.MOTOR_DB.find(x => x.type === 'АИР160S4');
check(!!cat, 'fixture: АИР160S4');
const base = {
  mode: 'catalog', catalog: cat, phases: 3, voltage: 380, freq: 50, conn: 'D', poles: 4,
  effAuto: true, cosAuto: true, kstAuto: true, mstAuto: true, mmaxAuto: true, slipAuto: true,
  jMotor: 0, motorClass: 'F', tauMotor: 0, motorAmbient: 40, connFactor: 1
};
const m = E.buildMotor(base);
check(near(m.i, 29.433, 0.01), 'Iн каталога');
check(near(m.p1, 16.854, 0.01), 'P1 каталога');
check(near(m.mn, 98.116, 0.01), 'Mн каталога');
check(near(m.mstAbs, 215.856, 0.01), 'Mп каталога');
check(near(m.mmaxReal.t, 225.929, 0.01), 'Mmax каталога');
check(m.n === 1460 && m.ns === 1500, 'n/n1 каталога');
check(m.p1 > m.p2 && m.i > 0 && m.cos > 0 && m.cos <= 1, 'инварианты двигателя');
check(Math.max(...Array.from({ length: 200 }, (_, i) => E.torque(m, i / 199, 1))) > E.torque(m, 0.5, 1), 'момент имеет максимум');

/* ΔU и выбор кабеля */
const vd = E.voltageDrop(30, 50, 6, 'cu', 0.87, 380, 3, 'pvc', 1);
check(near(vd.dU, 7.9905, 0.005), 'ΔU: падение');
check(near(vd.pct, 2.1028, 0.005), 'ΔU: проценты');
check(vd.R > 0 && vd.X >= 0, 'ΔU: R/X');

const cableOpt = {
  voltage: 380, phases: 3, Irun: 30, dropLimit: 5, cosphi: 0.87,
  standard: 'pue', material: 'cu', insulation: 'pvc', laying: 'open', length: 50,
  ambient: 25, group: 1, loaded: 3, parallel: 'auto', startDropLimit: 15, considerStartDrop: true
};
const cable = E.selectCable(30, 200, cableOpt);
check(cable.section === 4, 'кабель: сечение 4 мм²');
check(near(cable.allow, 38, 0.01), 'кабель: допустимый ток');
check(near(cable.startDrop, 7.5058, 0.01), 'кабель: просадка при пуске');
check(cable.allow >= 30 && cable.section === 4 && !cable.dropLimited, 'кабель: выбран по нагреву');
check(cable.rows.every((r, i, a) => i === 0 || r.section > a[i - 1].section), 'кабель: ряды по возрастанию');

/* Автомат */
const br = E.selectBreaker(30, 200, { startMethod: 'dol', curve: 'C', type: 'mcb', series: 'abb-s200', magSet: 10, upstream: 0, phases: 3 });
check(br.In === 40, 'автомат: номинал 40 А');
check(br.magTrip === 200, 'автомат: отсечка 200 А');
check(br.okMag === false, 'автомат: отсечка ниже 1,1·Iп');
check(br.icu === 6 && br.series === 'abb-s200', 'автомат: данные серии');

/* Отчёт: контракт между блоками */
const cfg = Object.assign({}, base, {
  cable: cableOpt,
  load: { type: 'quadratic', pct: 75, breakaway: 1.15, unload: 0, release: 20 },
  dropLimit: 5, startMethod: 'dol', curve: 'C', breakerType: 'mcb', series: 'abb-s200',
  mccbMag: 10, upstreamIn: 0, isc: 6
});
const rep = E.buildReport(cfg);
check(!!rep.motor && !!rep.cable && !!rep.breaker && !!rep.op, 'отчёт: состав');
check(rep.iStart > rep.motor.i, 'отчёт: Iп > Iн');
check(rep.checks && typeof rep.checks.cable === 'boolean', 'отчёт: проверки');
check(finite(rep.drop.pct) && finite(rep.dropStart.pct), 'отчёт: ΔU');
check(finite(rep.sc.sMin) && rep.sc.sMin > 0, 'отчёт: Smin');
check(rep.sweep.load.length === 151, 'отчёт: развёртка 0…150 %');

/* Тепловая зона автомата */
const trip100 = V.thermalTripTime(V.get('abb-s200'), 'C', 32, 100);
const trip200 = V.thermalTripTime(V.get('abb-s200'), 'C', 32, 200);
check(near(trip100, 8.69335, 0.005), 'ВТХ: t(100 А)');
check(near(trip200, 0.0595637, 0.005), 'ВТХ: t(200 А)');
check(trip100 > trip200, 'ВТХ: время падает с током');
const pts = V.thermalPoints(V.get('abb-s200'), 'C', 32);
check(pts.every((p, i, a) => i === 0 || p[0] >= a[i - 1][0]), 'ВТХ: точки по возрастанию тока');

const th = T.start({
  breaker: { In: 32, series: 'abb-s200', curve: 'C' }, seriesId: 'abb-s200', Istart: 200,
  cmp: { tStart: 2, ieq: 100, stalled: false, duration: 25, nEnd: 1460 }, startsPerHour: 0
});
check(th.hasStart && !th.pending && !th.incomplete, 'thermal: завершённый пуск');
check(near(th.trip, trip100, 0.005), 'thermal: tср');
check(near(th.ratio, 4.34668, 0.01), 'thermal: отношение');
check(th.level === 'ok' && th.duty === null, 'thermal: уровень');

const thNo = T.start({
  breaker: { In: 32, series: 'abb-s200', curve: 'C' }, seriesId: 'abb-s200', Istart: 200,
  cmp: { tStart: null, ieq: null, stalled: false, duration: 25, nEnd: 1000 }, startsPerHour: 0
});
check(thNo.incomplete && !thNo.hasStart && thNo.Ieq === null && thNo.trip === null && thNo.level === null, 'thermal: незавершённый пуск');

const thPending = T.start({
  breaker: { In: 32, series: 'abb-s200', curve: 'C' }, seriesId: 'abb-s200', Istart: 200,
  cmp: null, startsPerHour: 6
});
check(thPending.pending && !thPending.incomplete && thPending.duty === null, 'thermal: ожидание расчёта');

const thDuty = T.start({
  breaker: { In: 32, series: 'abb-s200', curve: 'C' }, seriesId: 'abb-s200', Istart: 200,
  cmp: { tStart: 2, ieq: 100, stalled: false, duration: 25, nEnd: 1460 }, startsPerHour: 6
});
check(thDuty.duty && thDuty.duty.starts === 6 && finite(thDuty.duty.Ieq), 'thermal: повторные пуски');
check(thDuty.duty.ok === true, 'thermal: тепловой запас при 6 пусках');

/* Переходный процесс */
const sim = S.runScenario(rep.motor, { method: 'dol', duration: 10, cable: rep.cable, load: cfg.load, trace: true }, 10);
check(sim && finite(sim.tStart) && sim.tStart > 0 && sim.tStart < 10, 'sim: время пуска');
check(sim.nEnd > rep.motor.n * 0.9, 'sim: вышел на скорость');
check(sim.samples && sim.samples.length > 10, 'sim: выборка');
check(finite(sim.ieq) && sim.ieq > 0, 'sim: Iэкв');
check(sim.duration === 10, 'sim: горизонт');

console.log(failed ? 'unit: FAIL' : `unit: ok (${checks} проверок)`);
process.exitCode = failed ? 1 : 0;
