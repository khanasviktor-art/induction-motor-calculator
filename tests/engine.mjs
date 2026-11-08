import '../src/data.js';
import '../src/engine.js';

const E = globalThis.MC.engine;
const D = globalThis.MC.data;
let failed = 0;
const check = (cond, msg) => { if (!cond) { console.error('FAIL', msg); failed++; } };
const near = (a, b, rel = 0.02) => Math.abs(a - b) <= Math.max(Math.abs(b) * rel, 1e-6);

const cat = D.MOTOR_DB.find(x => x.type === 'АИР160S4');
const base = {
  mode: 'catalog', catalog: cat, phases: 3, voltage: 380, freq: 50, conn: 'D', poles: 4,
  effAuto: true, cosAuto: true, kstAuto: true, mstAuto: true, mmaxAuto: true, slipAuto: true,
  jMotor: 0, motorClass: 'F', tauMotor: 0, motorAmbient: 40, connFactor: 1
};
const m = E.buildMotor(base);
check(near(m.i, 29.0, 0.05), 'I ' + m.i);
check(m.n === 1460, 'n ' + m.n);
check(near(m.mn, 98.1, 0.02), 'Mn ' + m.mn);
check(near(m.mstAbs, 215.9, 0.03), 'Mst ' + m.mstAbs);
check(near(m.mmaxReal.t, 225.9, 0.03), 'Mmax ' + m.mmaxReal.t);
check(near(E.torque(m, 1, 1), m.mstAbs, 0.02), 'torque start');
check(Math.max(...Array.from({ length: 1000 }, (_, i) => E.torque(m, i / 999, 1))) > 0, 'torque peak');

const cp = E.loadTorque(m, 0, { type: 'constpower', pct: 95, breakaway: 1.15 });
const c1 = E.loadTorque(m, 0.5 * m.n, { type: 'constpower', pct: 95, breakaway: 1.15 });
check(cp > c1, 'constpower monotonic');
check(near(E.loadTorque(m, m.n, { type: 'constant', pct: 100 }), m.mn, 0.01), 'constant load');

const vd = E.voltageDrop(30, 50, 6, 'cu', 0.87, 380, 3, 'pvc', 1);
check(vd.pct > 0 && vd.pct < 5, 'drop ' + vd.pct);
const cab = E.selectCable(40, 207, { voltage: 380, phases: 3, length: 50, material: 'cu', insulation: 'pvc', loaded: 3, dropLimit: 5, startDropLimit: 15, considerStartDrop: true, Irun: 29, cosphi: 0.87 });
check(cab.section >= 6, 'cable ' + cab.section);

const m1 = E.buildMotor({ ...base, mode: 'power', catalog: null, phases: 1, voltage: 230, poles: 4, p2: 11, motor1phType: 'capacitor' });
check(near(m1.p2, 11, 0.001), '1ph p2');
check(m1.eff >= 85 && m1.cos >= 0.9, '1ph data ' + m1.eff + '/' + m1.cos);

const mY = E.buildMotor({ ...base, conn: 'Y', connFactor: 1 / Math.sqrt(3) });
check(near(mY.connFactor, 0.577, 0.01), 'connFactor');
check(mY.mmaxReal.t < m.mmaxReal.t * 0.4, 'derated Mmax ' + mY.mmaxReal.t);
check(mY.mstAbs < m.mstAbs * 0.4, 'derated Mst ' + mY.mstAbs);

console.log(failed ? `engine: FAIL (${failed})` : 'engine: ok');
process.exitCode = failed ? 1 : 0;
