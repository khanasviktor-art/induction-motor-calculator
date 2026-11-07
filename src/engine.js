/* ============================================================
   Расчётное ядро: асинхронный двигатель, кабель, защита
   ============================================================ */
(function (root) {
  'use strict';
  const D = root.MC.data;
  const SQRT3 = Math.sqrt(3);
  const PI2 = 2 * Math.PI;
  const TEMP_CLASS = {
    B: { limit: 130, rise: 60 },
    F: { limit: 155, rise: 70 },
    H: { limit: 180, rise: 80 }
  };

  /* ---------- утилиты ---------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function nextUp(list, v) { for (let i = 0; i < list.length; i++) if (list[i] >= v - 1e-9) return list[i]; return list[list.length - 1]; }
  function nextDown(list, v) { for (let i = list.length - 1; i >= 0; i--) if (list[i] <= v + 1e-9) return list[i]; return list[0]; }
  function nearestStdPower(p) { return nextUp(D.POWERS_STD, p); }
  function logInterp(pts, x, key) {
    // pts: [{p2, key}], sorted; линейная интерполяция по lg(P), экстраполяция по краям
    if (!pts.length) return 0;
    if (pts.length === 1) return pts[0][key];
    const lx = Math.log10(Math.max(x, 1e-4));
    let i = 0;
    while (i < pts.length - 1 && Math.log10(pts[i + 1].p2) < lx) i++;
    if (i >= pts.length - 1) i = pts.length - 2;
    const a = pts[i], b = pts[i + 1];
    const la = Math.log10(a.p2), lb = Math.log10(b.p2);
    const t = (lx - la) / (lb - la);
    return lerp(a[key], b[key], t);
  }

  /* ---------- типовые параметры по мощности ---------- */
  let _groups = null;
  function groups() {
    if (_groups) return _groups;
    const g = { 2: [], 4: [], 6: [], 8: [] };
    const all = D.MOTOR_DB.slice();
    all.forEach(function (e) { if (g[e.poles]) g[e.poles].push(e); });
    // крупные 4-полюсные машины используем как опорные для 2/6/8 полюсов
    const big = all.filter(function (e) { return e.p2 >= 45 && e.poles === 4; });
    const adj = {
      2: { eff: 0.5, cos: 0.015, kst: 0.5, mst: 0.10, mmax: 0.10, slip: 0.012 },
      6: { eff: -1.0, cos: -0.035, kst: -0.5, mst: -0.10, mmax: -0.10, slip: 0.015 },
      8: { eff: -1.8, cos: -0.060, kst: -1.0, mst: -0.20, mmax: -0.20, slip: 0.018 }
    };
    [2, 6, 8].forEach(function (pl) {
      const a = adj[pl];
      const ns = 120 * 50 / pl;
      big.forEach(function (m) {
        g[pl].push({
          p2: m.p2, poles: pl, n: ns * (1 - a.slip),
          eff: clamp(m.eff + a.eff, 60, 97), cos: clamp(m.cos + a.cos, 0.4, 0.95),
          kst: Math.max(3.5, m.kst + a.kst), mst: Math.max(1.3, m.mst + a.mst),
          mmax: Math.max(1.6, m.mmax + a.mmax), typical: true
        });
      });
    });
    Object.keys(g).forEach(function (k) { g[k].sort(function (a, b) { return a.p2 - b.p2; }); });
    _groups = g;
    return g;
  }

  function typical(p2, poles, freq) {
    const g = groups();
    let list = g[poles] || g[4];
    if (!list || list.length < 2) list = g[4];
    const p = clamp(p2, 0.05, 500);
    const eff = clamp(logInterp(list, p, 'eff'), 35, 97.5);
    const cos = clamp(logInterp(list, p, 'cos'), 0.35, 0.95);
    const kst = clamp(logInterp(list, p, 'kst'), 3.5, 9);
    const mst = clamp(logInterp(list, p, 'mst'), 1.3, 2.8);
    const mmax = clamp(logInterp(list, p, 'mmax'), 1.6, 3.4);
    const f = freq || 50;
    const ns = 120 * f / Math.max(poles, 2);
    let n = logInterp(list, p, 'n');
    if (Math.abs(f - 50) > 0.1) n = n * f / 50;
    n = clamp(n, ns * 0.86, ns * 0.995);
    return { eff: eff, cos: cos, kst: kst, mst: mst, mmax: mmax, n: n };
  }


  /* ---------- типовые данные однофазных двигателей ---------- */
  const TYPICAL_1PH = {
    capacitor: {
      p2:   [0.12, 0.18, 0.25, 0.37, 0.55, 0.75, 1.1, 1.5, 2.2, 3.0, 4.0, 5.5, 7.5],
      eff:  [52, 56, 60, 64, 67, 70, 73, 75, 78, 80, 82, 84, 85],
      cos:  [0.80, 0.82, 0.84, 0.85, 0.86, 0.87, 0.88, 0.89, 0.90, 0.91, 0.92, 0.92, 0.93],
      kst:  [4.5, 4.6, 4.8, 5.0, 5.2, 5.2, 5.5, 5.5, 5.5, 5.2, 5.0, 5.0, 4.8],
      mst:  [1.6, 1.7, 1.8, 1.8, 1.9, 1.9, 2.0, 2.0, 2.1, 2.1, 2.1, 2.1, 2.0],
      mmax: [1.8, 1.9, 2.0, 2.0, 2.1, 2.1, 2.2, 2.2, 2.3, 2.3, 2.3, 2.3, 2.2],
      slip: [6.5, 6.0, 5.5, 5.0, 5.0, 4.5, 4.5, 4.0, 4.0, 3.5, 3.5, 3.0, 2.5]
    },
    split: {
      p2:   [0.12, 0.18, 0.25, 0.37, 0.55, 0.75, 1.1, 1.5, 2.2, 3.0, 4.0, 5.5],
      eff:  [48, 52, 56, 60, 63, 66, 69, 71, 74, 76, 78, 80],
      cos:  [0.60, 0.62, 0.64, 0.66, 0.68, 0.69, 0.70, 0.71, 0.72, 0.72, 0.73, 0.74],
      kst:  [7.0, 7.2, 7.5, 7.8, 8.0, 8.0, 7.5, 7.5, 7.0, 6.5, 6.0, 5.5],
      mst:  [1.4, 1.5, 1.5, 1.6, 1.6, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7],
      mmax: [1.6, 1.7, 1.8, 1.8, 1.9, 1.9, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0],
      slip: [7.0, 6.5, 6.0, 5.5, 5.5, 5.0, 5.0, 4.5, 4.5, 4.0, 4.0, 3.5]
    },
    psc: {
      p2:   [0.12, 0.18, 0.25, 0.37, 0.55, 0.75, 1.1, 1.5, 2.2, 3.0, 4.0, 5.5, 7.5],
      eff:  [55, 58, 61, 64, 67, 69, 72, 74, 77, 79, 81, 83, 84],
      cos:  [0.90, 0.91, 0.91, 0.92, 0.92, 0.93, 0.93, 0.94, 0.94, 0.95, 0.95, 0.95, 0.95],
      kst:  [3.5, 3.6, 3.8, 4.0, 4.0, 4.2, 4.2, 4.0, 4.0, 3.8, 3.8, 3.8, 3.6],
      mst:  [1.2, 1.3, 1.3, 1.4, 1.4, 1.4, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5],
      mmax: [1.6, 1.7, 1.7, 1.8, 1.8, 1.8, 1.9, 1.9, 1.9, 1.9, 1.9, 1.9, 1.9],
      slip: [4.5, 4.0, 4.0, 3.5, 3.5, 3.0, 3.0, 3.0, 2.5, 2.5, 2.5, 2.5, 2.5]
    }
  };

  function interpArr(xs, ys, x) {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
    let i = 0;
    while (i < xs.length - 1 && xs[i + 1] < x) i++;
    const t = (Math.log10(x) - Math.log10(xs[i])) / (Math.log10(xs[i + 1]) - Math.log10(xs[i]));
    return lerp(ys[i], ys[i + 1], t);
  }

  function typical1ph(p2, poles, type, freq) {
    const t = TYPICAL_1PH[type] || TYPICAL_1PH.capacitor;
    const p = clamp(p2, 0.05, 8);
    const ns = 120 * (freq || 50) / Math.max(poles, 2);
    const slip = interpArr(t.p2, t.slip, p);
    return {
      eff: interpArr(t.p2, t.eff, p),
      cos: interpArr(t.p2, t.cos, p),
      kst: interpArr(t.p2, t.kst, p),
      mst: interpArr(t.p2, t.mst, p),
      mmax: interpArr(t.p2, t.mmax, p),
      n: ns * (1 - slip / 100)
    };
  }

  /* ---------- построение модели двигателя ---------- */
  function buildMotor(cfg) {
    const phases = +cfg.phases || 3;
    const U = +cfg.voltage;
    const f = +cfg.freq || 50;
    const poles = +cfg.poles || 4;
    const ns = 120 * f / poles;
    let p2, n, eff, cos, kst, mst, mmax, jm;
    let note = '';
    const typAt = function (p) {
      return phases === 1 ? typical1ph(p, poles, cfg.motor1phType, f) : typical(p, poles, f);
    };

    if (cfg.mode === 'catalog' && cfg.catalog) {
      const c = cfg.catalog;
      p2 = c.p2; eff = c.eff; cos = c.cos;
      n = c.n * f / 50;
      kst = c.kst; mst = c.mst; mmax = c.mmax;
      jm = D.estimateJ(p2, c.poles);
      note = 'Паспортные данные: ' + c.type;
    } else if (cfg.mode === 'current') {
      const I = +cfg.current;
      let p = clamp(phases === 3 ? SQRT3 * U * I * 0.82 / 1000 : U * I * 0.82 / 1000, 0.05, 500);
      let typ = typAt(p);
      for (let k = 0; k < 60; k++) {
        const e = cfg.effAuto ? typ.eff / 100 : +cfg.eff / 100;
        const c = cfg.cosAuto ? typ.cos : +cfg.cos;
        const p1 = (phases === 3 ? SQRT3 * U * I : U * I) * c / 1000;
        const pn = Math.max(p1 * e, 0.001);
        const np = lerp(p, pn, 0.45);
        if (Math.abs(np - p) < 1e-6) { p = np; break; }
        p = np;
        typ = typAt(p);
      }
      p2 = p;
      eff = cfg.effAuto ? typ.eff : +cfg.eff;
      cos = cfg.cosAuto ? typ.cos : +cfg.cos;
      kst = cfg.kstAuto ? typ.kst : +cfg.kst;
      mst = cfg.mstAuto ? typ.mst : +cfg.mst;
      mmax = cfg.mmaxAuto ? typ.mmax : +cfg.mmax;
      const snT = (ns - typ.n) / ns;
      n = cfg.slipAuto === false ? ns * (1 - (+cfg.slip) / 100) : ns * (1 - clamp(snT, 0.004, 0.2));
      jm = D.estimateJ(p2, poles);
      note = 'Мощность восстановлена по току; КПД и cosφ — типовые' + (cfg.effAuto || cfg.cosAuto ? '' : ' (заданы вручную)');
    } else if (cfg.mode === 'torque') {
      const M = +cfg.torque, nr = +cfg.speedRpm || ns;
      p2 = Math.max(M * nr / 9550, 0.001);
      const typ = typAt(p2);
      eff = cfg.effAuto ? typ.eff : +cfg.eff;
      cos = cfg.cosAuto ? typ.cos : +cfg.cos;
      kst = cfg.kstAuto ? typ.kst : +cfg.kst;
      mst = cfg.mstAuto ? typ.mst : +cfg.mst;
      mmax = cfg.mmaxAuto ? typ.mmax : +cfg.mmax;
      n = nr;
      jm = D.estimateJ(p2, poles);
      note = 'Мощность определена по моменту и скорости';
    } else {
      p2 = Math.max(+cfg.p2, 0.01);
      const typ = typAt(p2);
      eff = cfg.effAuto ? typ.eff : +cfg.eff;
      cos = cfg.cosAuto ? typ.cos : +cfg.cos;
      kst = cfg.kstAuto ? typ.kst : +cfg.kst;
      mst = cfg.mstAuto ? typ.mst : +cfg.mst;
      mmax = cfg.mmaxAuto ? typ.mmax : +cfg.mmax;
      const snT = cfg.slipAuto === false ? (+cfg.slip) / 100 : clamp((ns - typ.n) / ns, 0.004, 0.2);
      n = ns * (1 - snT);
      jm = D.estimateJ(p2, poles);
      note = 'Расчёт по мощности';
    }

    if (!(p2 > 0)) throw new Error('Некорректная мощность');
    if (!(eff > 0 && eff <= 100)) throw new Error('Некорректный КПД');
    if (!(cos > 0 && cos <= 1)) throw new Error('Некорректный cosφ');

    const sn = clamp((ns - n) / ns, 0.0005, 0.6);
    const p1 = p2 / (eff / 100);
    const I = phases === 3 ? p1 * 1000 / (SQRT3 * U * cos) : p1 * 1000 / (U * cos);
    const mn = 9550 * p2 / n;
    const i0rel = phases === 1
      ? clamp((cfg.motor1phType === 'split' ? 0.52 : cfg.motor1phType === 'psc' ? 0.44 : 0.48) - 0.025 * Math.log(Math.max(p2, 0.1)), 0.36, 0.58)
      : clamp(0.40 - 0.045 * Math.log(Math.max(p2, 0.1)) + (poles === 2 ? 0.03 : poles >= 6 ? 0.02 : 0), 0.18, 0.48);
    const cls = TEMP_CLASS[cfg.motorClass] || TEMP_CLASS.F;
    const sm = sn * (mmax + Math.sqrt(Math.max(mmax * mmax - 1, 0.0001)));
    const tmax = mmax * mn;
    const tk1 = 2 * tmax / (1 / sm + sm);
    const boost = Math.max(mst * mn - tk1, 0);
    const rr1 = clamp(mst * (1 - i0rel * i0rel) / (kst * kst * sn), 1.05, 6);

    const motor = {
      mode: cfg.mode, phases: phases, U: U, f: f, poles: poles, ns: ns,
      conn: phases === 1 ? '1' : (cfg.conn || 'Y'),
      uPhase: phases === 1 ? U : ((cfg.conn === 'D') ? U : U / SQRT3),
      motor1phType: cfg.motor1phType || 'capacitor',
      p2: p2, p1: p1, eff: eff, cos: cos, i: I, n: n, sn: sn, mn: mn,
      kst: kst, mst: mst, mmax: mmax, j: +cfg.jMotor > 0 ? +cfg.jMotor : jm, jAuto: jm,
      i0rel: i0rel, i0: i0rel * I, i2n: I * Math.sqrt(1 - i0rel * i0rel),
      sm: sm, boost: boost, rr1: rr1,
      ist: kst * I, mstAbs: mst * mn, mmaxAbs: mmax * mn,
      pLoss: p1 - p2, pConst: (p1 - p2) * 0.52, pVar: (p1 - p2) * 0.48,
      note: phases === 1 ? note + ' · однофазный, ' + ({ capacitor: 'конденсаторный', split: 'с расщеплённой фазой', psc: 'PSC' }[cfg.motor1phType] || 'конденсаторный') + ' (типовые данные)' : note,
      catalog: cfg.catalog || null,
      tempLimit: cls.limit, riseRated: cls.rise,
      tempAmbient: +cfg.motorAmbient || 40,
      tauMin: +cfg.tauMotor > 0 ? +cfg.tauMotor : clamp(10 * Math.pow(p2, 0.35), 12, 90),
      motorClass: cfg.motorClass || 'F'
    };
    motor.mmaxReal = peakTorque(motor);
    return motor;
  }

  /* ---------- механическая характеристика ---------- */
  function torque(motor, s, uF) {
    uF = uF === undefined ? 1 : uF;
    if (s <= 1e-7) return 0;
    s = clamp(s, 0, 1);
    const tmax = motor.mmax * motor.mn;
    const tk = 2 * tmax / (s / motor.sm + motor.sm / s);
    return (tk + motor.boost * Math.pow(s, 3)) * uF * uF;
  }

  function peakTorque(motor) {
    let best = 0, bs = 0;
    for (let s = 0.001; s <= 1; s += 0.001) {
      const t = torque(motor, s, 1);
      if (t > best) { best = t; bs = s; }
    }
    return { t: best, s: bs };
  }

  function currentAt(motor, s, uF) {
    uF = uF === undefined ? 1 : uF;
    if (s <= 1e-7) return motor.i0 * uF;
    const T = torque(motor, s, uF);
    const rr = 1 + (motor.rr1 - 1) * s * s;
    const i2 = motor.i2n * Math.sqrt(Math.max(T / motor.mn, 0) * (s / motor.sn) / rr);
    return Math.sqrt(Math.pow(motor.i0 * uF, 2) + i2 * i2);
  }

  /* ---------- момент нагрузки ---------- */
  function loadTorque(motor, n, load) {
    const pct = clamp(+load.pct || 0, 0, 200) / 100;
    const base = motor.mn * pct;
    const x = clamp(n / motor.n, 0, 2.5);
    let t;
    switch (load.type) {
      case 'quadratic': t = base * x * x; break;
      case 'linear': t = base * x; break;
      case 'constpower': t = base * (x > 0.12 ? 1 / x : 8); break;
      default: t = base;
    }
    if (load.type !== 'quadratic' && n < 0.02 * motor.ns) {
      const ba = (load.breakaway || 1.0) * base;
      t = Math.max(t, ba);
    }
    return t;
  }

  /* ---------- рабочая точка ---------- */
  function solveSlip(motor, load, uF) {
    const N = 700;
    let prevS = 1e-5, prevD = torque(motor, prevS, uF) - loadTorque(motor, motor.ns * (1 - prevS), load);
    if (prevD >= 0) return { s: 1e-5, ok: true, stalled: false };
    for (let i = 1; i <= N; i++) {
      const s = Math.pow(10, Math.log10(1e-5) + (Math.log10(1) - Math.log10(1e-5)) * i / N);
      const d = torque(motor, s, uF) - loadTorque(motor, motor.ns * (1 - s), load);
      if (d >= 0) {
        let lo = prevS, hi = s;
        for (let k = 0; k < 40; k++) {
          const mid = (lo + hi) / 2;
          if (torque(motor, mid, uF) - loadTorque(motor, motor.ns * (1 - mid), load) < 0) lo = mid; else hi = mid;
        }
        return { s: (lo + hi) / 2, ok: true, stalled: false };
      }
      prevS = s; prevD = d;
    }
    return { s: 1, ok: false, stalled: true };
  }

  function operatingPoint(motor, load, cable, U) {
    const Uline = U || motor.U;
    let uF = 1, s = 0.02, stalled = false;
    for (let it = 0; it < 4; it++) {
      const r = solveSlip(motor, load, uF);
      s = r.s; stalled = r.stalled;
      const I = currentAt(motor, s, uF);
      if (!cable || !cable.section) break;
      const dU = voltageDrop(I, cable.length, cable.section, cable.material, null, Uline, motor.phases, cable.insulation, cable.parallel).dU;
      uF = clamp((Uline - dU) / Uline, 0.7, 1.05);
    }
    const I = currentAt(motor, s, uF);
    const T = torque(motor, s, uF);
    const n = motor.ns * (1 - s);
    const w = PI2 * n / 60;
    const p2 = T * w / 1000;
    const loss = motor.pConst + motor.pVar * Math.pow(I / motor.i, 2);
    const p1 = p2 + loss;
    let S = (motor.phases === 3 ? SQRT3 * Uline * I : Uline * I) / 1000;
    let cos = S > 1e-9 ? clamp(p1 / S, 0, 1) : 0;
    const tss = motor.tempAmbient + motor.riseRated * Math.pow(I / motor.i, 2);
    let tLim = Infinity;
    if (tss > motor.tempLimit) {
      const den = tss - motor.tempAmbient;
      if (den > 0 && tss > motor.tempLimit) tLim = -motor.tauMin * Math.log((tss - motor.tempLimit) / den);
    }
    let dUinfo = cable && cable.section
      ? voltageDrop(I, cable.length, cable.section, cable.material, cos, Uline, motor.phases, cable.insulation, cable.parallel)
      : { dU: 0, pct: 0, R: 0, X: 0 };
    let Um = Uline - dUinfo.dU;
    let cosT = I > 1e-9 ? clamp(p1 / ((motor.phases === 3 ? SQRT3 : 1) * Um * I / 1000), 0, 1) : 0;
    if (cable && cable.section) {
      dUinfo = voltageDrop(I, cable.length, cable.section, cable.material, cosT, Uline, motor.phases, cable.insulation, cable.parallel);
      Um = Uline - dUinfo.dU;
      cosT = I > 1e-9 ? clamp(p1 / ((motor.phases === 3 ? SQRT3 : 1) * Um * I / 1000), 0, 1) : 0;
    }
    S = (motor.phases === 3 ? SQRT3 * Um * I : Um * I) / 1000;
    cos = S > 1e-9 ? clamp(p1 / S, 0, 1) : 0;
    return {
      s: s, n: n, I: I, T: T, Tload: loadTorque(motor, n, load), p1: p1, p2: p2,
      eta: p2 > 0 ? p2 / p1 * 100 : 0, cos: cos, cosT: cosT, S: S,
      Q: Math.sqrt(Math.max(S * S - p1 * p1, 0)), f2: s * motor.f,
      U: Um, dU: dUinfo.dU, dUpt: dUinfo.pct, stalled: stalled,
      loadPct: (T / motor.mn) * 100, temp: tss, tempLimit: motor.tempLimit, timeToLimit: tLim,
      slipPct: s * 100
    };
  }

  /* ---------- кабель ---------- */
  function tempFactor(std, t) {
    const tab = D.TEMP_FACTOR[std];
    if (t <= tab[0][0]) return tab[0][1];
    for (let i = 1; i < tab.length; i++) {
      if (t <= tab[i][0]) {
        const a = tab[i - 1], b = tab[i];
        return lerp(a[1], b[1], (t - a[0]) / (b[0] - a[0]));
      }
    }
    return tab[tab.length - 1][1];
  }

  function selectCable(Iwork, iStart, opt) {
    const std = opt.standard === 'iec' ? 'iec' : 'pue';
    const mat = opt.material === 'al' ? 'al' : 'cu';
    const laying = opt.laying || 'open';
    const ground = laying === 'ground';
    const table = D.AMPACITY[std][mat][ground ? 'ground' : 'air'];
    const kTemp = tempFactor(std, +opt.ambient || 25);
    const kGroup = D.GROUP_FACTOR[clamp((+opt.group || 1) - 1, 0, D.GROUP_FACTOR.length - 1)];
    const kMethod = (D.LAYING[std][laying] || D.LAYING[std].open).k;
    const kIns = D.INSULATION[opt.insulation === 'xlpe' ? 'xlpe' : 'pvc'].k;
    const kLoaded = +opt.loaded === 2 ? 1.12 : 1;
    const k = kTemp * kGroup * kMethod * kIns * kLoaded;
    const kParMap = { 1: 1, 2: 0.9, 3: 0.85, 4: 0.8 };
    const considerDrop = opt.considerStartDrop !== false;
    const startDropLimit = +opt.startDropLimit || 15;
    const dropLimit = +opt.dropLimit || 5;
    const Irun = +opt.Irun || Iwork;
    const cosphi = +opt.cosphi || 0.85;
    const U = +opt.voltage || 380;
    const phases = +opt.phases || 3;
    const nList = (opt.parallel === 'auto' || opt.parallel == null)
      ? [1, 2, 3, 4] : [clamp(+opt.parallel || 1, 1, 4)];

    let chosen = null;
    for (let ni = 0; ni < nList.length; ni++) {
      const n = nList[ni];
      const kPar = kParMap[n] || 1;
      const rows = [];
      let pick = null;
      let thermalPick = null;
      for (let i = 0; i < D.SECTIONS.length; i++) {
        const base = table[i];
        if (base == null) continue;
        const allowPer = base * k * kPar;
        const allowTotal = allowPer * n;
        const dS = considerDrop
          ? voltageDrop(iStart, +opt.length || 1, D.SECTIONS[i], mat, 0.3, U, phases, opt.insulation, n)
          : { pct: 0 };
        const dR = voltageDrop(Irun, +opt.length || 1, D.SECTIONS[i], mat, cosphi, U, phases, opt.insulation, n).pct;
        const row = {
          section: D.SECTIONS[i], base: base, allowPer: allowPer, allow: allowTotal,
          dropStart: dS.pct, dropRun: dR,
          ok: allowTotal >= Iwork && (!considerDrop || dS.pct <= startDropLimit) && dR <= dropLimit,
          selected: false
        };
        rows.push(row);
        if (!thermalPick && allowTotal >= Iwork) thermalPick = row;
        if (!pick && row.ok) pick = row;
      }
      if (pick || ni === nList.length - 1) {
        if (!pick) pick = rows[rows.length - 1];
        pick.selected = true;
        chosen = {
          n: n, kPar: kPar, rows: rows, pick: pick,
          dropLimited: !!(thermalPick && pick.section > thermalPick.section),
          ok: !!pick.ok
        };
        break;
      }
    }

    const st = chosen || { n: 1, kPar: 1, rows: [], pick: null, dropLimited: false, ok: false };
    const pick = st.pick;
    let pe;
    if (!pick) pe = 0;
    else if (pick.section <= 16) pe = pick.section;
    else if (pick.section <= 35) pe = 16;
    else pe = nextUp(D.SECTIONS, pick.section / 2);
    return {
      section: pick ? pick.section : 0,
      parallel: st.n,
      pe: pe,
      peTotal: pe * st.n,
      rows: st.rows,
      kTemp: kTemp, kGroup: kGroup, kMethod: kMethod, kIns: kIns, kLoaded: kLoaded,
      kPar: st.kPar, k: k * st.kPar,
      allow: pick ? pick.allow : 0,
      allowPer: pick ? pick.allowPer : 0,
      base: pick ? pick.base : 0,
      startDrop: pick ? pick.dropStart : 0,
      dropLimited: st.dropLimited,
      startDropLimit: startDropLimit,
      considerStartDrop: considerDrop,
      material: mat, insulation: opt.insulation, laying: laying, standard: std,
      length: +opt.length || 1, ambient: +opt.ambient || 25, loaded: +opt.loaded || 3
    };
  }

  function voltageDrop(I, L, S, mat, cosv, U, phases, insulation, parallel) {
    const n = Math.max(1, parallel || 1);
    if (!S || !L) return { dU: 0, pct: 0, R: 0, X: 0 };
    const tHot = insulation === 'xlpe' ? 90 : 70;
    const rho20 = D.RHO[mat === 'al' ? 'al' : 'cu'];
    const alpha = mat === 'al' ? 0.00403 : 0.00393;
    const R = rho20 * (1 + alpha * (tHot - 20)) * L / (S * n);
    const X = D.X_CABLE * L / n;
    const c = cosv == null ? 0.85 : cosv;
    const sin = Math.sqrt(Math.max(0, 1 - c * c));
    const dU = phases === 3 ? SQRT3 * I * (R * c + X * sin) : 2 * I * (R * c + X * sin);
    return { dU: dU, pct: dU / U * 100, R: R, X: X };
  }

  /* ---------- защита ---------- */
  function startingCurrent(motor, cfg) {
    const m = motor;
    if (m.phases === 1 && (cfg.startMethod === 'yd' || cfg.startMethod === 'autotr')) return m.ist;
    switch (cfg.startMethod) {
      case 'yd': return m.ist / 3;                       // ток в звезде
      case 'soft': return Math.min(m.ist, (cfg.softLimit || 3) * m.i);
      case 'vfd': return 1.15 * m.i;                      // входной ток привода
      case 'autotr': return 0.42 * m.ist;                 // 65 % — по первичной стороне
      default: return m.ist;                              // DOL
    }
  }

  function selectBreaker(Iwork, Ist, opt) {
    const sm = opt.startMethod;
    let type = opt.type === 'mccb' ? 'mccb' : 'mcb';
    const rise = sm === 'vfd' ? 1.10 : (sm === 'yd' || sm === 'soft' || sm === 'autotr') ? 1.15 : 1.25;
    let In, curve, mag;
    if (type === 'mccb') {
      In = nextUp(D.BREAKERS, Iwork * 1.2);
    } else {
      In = nextUp(D.BREAKERS, Iwork * rise);
      if (In > 125) { type = 'mccb'; In = nextUp(D.BREAKERS, Iwork * 1.2); }
    }
    if (type === 'mccb') {
      curve = null;
      mag = +opt.magSet || 10;
    } else {
      curve = opt.curve || 'D';
      mag = D.CURVE_MAG[curve] ? D.CURVE_MAG[curve][0] : 10;
    }
    const magTrip = mag * In;
    const okMag = magTrip > Ist * 1.1;
    const icu = type === 'mccb' ? (In <= 250 ? 36 : 50) : (In <= 63 ? 6 : In <= 125 ? 10 : 36);
    const upstream = +opt.upstream || 0;
    const selRatio = upstream ? upstream / In : 0;
    return {
      In: In, type: type, curve: curve, mag: mag, magTrip: magTrip, okMag: okMag,
      rise: rise, icu: icu, upstream: upstream, selRatio: selRatio, okSel: !upstream || selRatio >= 1.6,
      poles: +opt.phases === 1 ? 1 : 3
    };
  }

  function selectContactor(p2, I) {
    let pick = D.CONTACTORS[D.CONTACTORS.length - 1];
    for (let i = 0; i < D.CONTACTORS.length; i++) {
      if (D.CONTACTORS[i].kw >= p2 && D.CONTACTORS[i].i >= I) { pick = D.CONTACTORS[i]; break; }
    }
    return pick;
  }

  function selectThermal(I) {
    for (let i = 0; i < D.THERMAL_RELAYS.length; i++) {
      const r = D.THERMAL_RELAYS[i];
      if (I >= r[0] && I <= r[1]) return { lo: r[0], hi: r[1], set: I };
    }
    for (let i = 0; i < D.THERMAL_RELAYS.length; i++) {
      if (D.THERMAL_RELAYS[i][0] > I) return { lo: D.THERMAL_RELAYS[i][0], hi: D.THERMAL_RELAYS[i][1], set: I };
    }
    const last = D.THERMAL_RELAYS[D.THERMAL_RELAYS.length - 1];
    return { lo: last[0], hi: last[1], set: I };
  }

  function selectFuse(I) {
    return nextUp(D.FUSES_AM, I * 1.25);
  }

  function scCheck(S, isc, mat, insulation, In) {
    const k = insulation === 'xlpe'
      ? (mat === 'al' ? 94 : 143)
      : (mat === 'al' ? 76 : 115);
    const t = 0.01;
    // для модульных автоматов учитываем токоограничение (типовое I²t)
    const full = Math.pow(isc * 1000, 2) * t;
    const i2t = (In && In <= 125) ? Math.min(full, 20000) : full;
    const sMin = Math.sqrt(i2t) / k;
    return { k: k, t: t, i2t: i2t, sMin: sMin, ok: S >= sMin - 1e-9 };
  }

  /* ---------- подбор двигателя ---------- */
  function selectMotor(reqP2, poles) {
    const list = D.MOTOR_DB.filter(function (m) { return !poles || m.poles === poles; });
    list.sort(function (a, b) { return a.p2 - b.p2; });
    const out = [];
    for (let i = 0; i < list.length; i++) {
      if (list[i].p2 >= reqP2) {
        out.push(list[i]);
        if (out.length >= 3) break;
      }
    }
    if (!out.length && list.length) out.push(list[list.length - 1]);
    return out;
  }

  /* ---------- развёртка по нагрузке ---------- */
  function loadSweep(motor, cable, loadType, Uline) {
    const res = { load: [], I: [], T: [], n: [], s: [], f2: [], eta: [], cos: [], p1: [], p2: [], U: [], dU: [], temp: [] };
    for (let pct = 0; pct <= 150; pct += 1) {
      const load = { type: loadType, pct: pct };
      let uF = 1, s = 0.01;
      for (let it = 0; it < 2; it++) {
        const r = solveSlip(motor, load, uF);
        s = r.s;
        const I = currentAt(motor, s, uF);
        if (!cable || !cable.section) break;
        const dU = voltageDrop(I, cable.length, cable.section, cable.material, null, Uline, motor.phases, cable.insulation, cable.parallel).dU;
        uF = clamp((Uline - dU) / Uline, 0.7, 1.05);
      }
      const I = currentAt(motor, s, uF);
      const T = torque(motor, s, uF);
      const n = motor.ns * (1 - s);
      let p2 = T * PI2 * n / 60 / 1000;
      if (pct === 0) p2 = 0;
      const loss = motor.pConst + motor.pVar * Math.pow(I / motor.i, 2);
      const p1 = p2 + loss;
      let dd = cable && cable.section ? voltageDrop(I, cable.length, cable.section, cable.material, null, Uline, motor.phases, cable.insulation, cable.parallel) : { dU: 0, pct: 0 };
      let Um = Uline - dd.dU;
      let cosT = I > 1e-9 ? clamp(p1 / ((motor.phases === 3 ? SQRT3 : 1) * Um * I / 1000), 0, 1) : 0;
      if (cable && cable.section) {
        dd = voltageDrop(I, cable.length, cable.section, cable.material, cosT, Uline, motor.phases, cable.insulation, cable.parallel);
        Um = Uline - dd.dU;
        cosT = I > 1e-9 ? clamp(p1 / ((motor.phases === 3 ? SQRT3 : 1) * Um * I / 1000), 0, 1) : 0;
      }
      res.load.push(pct);
      res.I.push(I); res.T.push(T); res.n.push(n); res.s.push(s * 100); res.f2.push(s * motor.f);
      res.eta.push(p2 > 0 ? p2 / p1 * 100 : 0); res.cos.push(cosT);
      res.p1.push(p1); res.p2.push(p2); res.U.push(Um); res.dU.push(dd.pct);
      res.temp.push(motor.tempAmbient + motor.riseRated * Math.pow(I / motor.i, 2));
    }
    return res;
  }

  /* ---------- проверки ---------- */
  function buildReport(cfg) {
    const motor = buildMotor(cfg);
    const Is = motor.i;
    const iStart = startingCurrent(motor, cfg);
    const breaker0 = selectBreaker(Is, iStart, { startMethod: cfg.startMethod, curve: cfg.curve, type: cfg.breakerType, magSet: cfg.mccbMag, upstream: cfg.upstreamIn, phases: motor.phases });
    const Uline = motor.U;
    // Кабель выбирается и по рабочему току, и по номиналу аппарата защиты
    const cable = selectCable(Math.max(Is, breaker0.In), iStart, Object.assign({}, cfg.cable, { voltage: Uline, phases: motor.phases, Irun: Is, dropLimit: cfg.dropLimit, cosphi: motor.cos }));
    const op = operatingPoint(motor, cfg.load, cable, Uline);
    const breaker = breaker0;
    const contactor = selectContactor(motor.p2, Is);
    const relay = selectThermal(Is);
    const fuse = selectFuse(Is);
    const drop = voltageDrop(op.I, cable.length, cable.section, cable.material, op.cos, Uline, motor.phases, cable.insulation, cable.parallel);
    const dropStart = voltageDrop(iStart, cable.length, cable.section, cable.material, 0.30, Uline, motor.phases, cable.insulation, cable.parallel);
    const sc = scCheck(cable.section, +cfg.isc || 6, cable.material, cable.insulation, breaker.In);
    const checks = {
      cable: cable.allow >= Is,
      drop: drop.pct <= (+cfg.dropLimit || 5),
      startDrop: dropStart.pct <= (+cfg.cable.startDropLimit || 15),
      breakerCurrent: breaker.In >= Is,
      breakerCable: breaker.In <= cable.allow + 1e-9,
      breakerMag: breaker.okMag,
      breakerIcu: (+cfg.isc || 6) <= breaker.icu,
      breakerSel: breaker.okSel,
      sc: sc.ok,
      contactor: contactor.i >= Is,
      overload: op.p2 <= motor.p2 * 1.05,
      stability: !op.stalled && op.T >= op.Tload * 0.999
    };
    return {
      motor: motor, iStart: iStart, cable: cable, op: op, breaker: breaker, contactor: contactor,
      relay: relay, fuse: fuse, drop: drop, dropStart: dropStart, sc: sc, checks: checks,
      sweep: loadSweep(motor, cable, cfg.load.type, Uline)
    };
  }

  root.MC.engine = {
    buildMotor: buildMotor,
    typical: typical,
    torque: torque,
    currentAt: currentAt,
    loadTorque: loadTorque,
    solveSlip: solveSlip,
    operatingPoint: operatingPoint,
    selectCable: selectCable,
    voltageDrop: voltageDrop,
    selectBreaker: selectBreaker,
    selectContactor: selectContactor,
    selectThermal: selectThermal,
    selectFuse: selectFuse,
    scCheck: scCheck,
    selectMotor: selectMotor,
    loadSweep: loadSweep,
    buildReport: buildReport,
    startingCurrent: startingCurrent,
    nextUp: nextUp,
    nextDown: nextDown,
    nearestStdPower: nearestStdPower,
    clamp: clamp
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
