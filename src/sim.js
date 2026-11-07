/* ============================================================
   Переходные процессы: пуск, наброс нагрузки, живая симуляция
   ============================================================ */
(function (root) {
  'use strict';
  const E = root.MC.engine;
  const PI2 = 2 * Math.PI;

  const DEFAULTS = {
    method: 'dol',
    tSwitch: 2.0,
    tRamp: 6.0,
    uStart: 30,
    iLimit: 3.0,
    duration: 60,
    speed: 1,
    load: { type: 'quadratic', pct: 70 },
    jExtra: 0.3
  };

  function inertia(motor, cfg) {
    return Math.max(motor.j + (cfg.jExtra || 0), 1e-5);
  }

  function createState(motor, cfg) {
    return {
      t: 0,
      w: 0,
      temp: motor.tempAmbient || 25,
      i2t: 0,
      running: false,
      done: false,
      stalled: false,
      stallTimer: 0,
      uSoft: 0,
      tStart: null,
      samples: [],
      lastSample: -1,
      cable: cfg.cable || null,
      motor: motor,
      cfg: cfg,
      peakI: 0,
      peakT: 0,
      fNow: 0,
      uNow: 0,
      sNow: 0,
      iNow: 0,
      tNow: 0,
      nNow: 0,
      p2Now: 0
    };
  }

  function methodVoltage(st, cfg, I, dt) {
    const m = cfg.method;
    if (m === 'yd') {
      if (st.t < cfg.tSwitch) return 1 / Math.sqrt(3);
      if (st.t < cfg.tSwitch + 0.06) return 0.05;
      return 1;
    }
    if (m === 'autotr') return st.t < cfg.tSwitch ? 0.65 : 1;
    if (m === 'soft') {
      const k0 = Math.max(0.05, cfg.uStart / 100);
      const ramp = k0 + (1 - k0) * Math.min(st.t / Math.max(cfg.tRamp, 0.1), 1);
      const prev = st.uSoft || k0;
      const rate = (1 - k0) / Math.max(cfg.tRamp, 0.1);
      let k = Math.min(ramp, prev + rate * (dt || 0.0005) * 1.2);
      const target = cfg.iLimit * st.motor.i;
      if (I > target) k = Math.max(k0, Math.min(k, prev * target / Math.max(I, 1e-9)));
      return Math.max(k0, Math.min(1, k));
    }
    return 1;
  }

  function sample(st) {
    const m = st.motor;
    st.samples.push({
      t: st.t, n: st.nNow, I: st.iNow, T: st.tNow, U: st.uNow * 100,
      f: st.fNow, f2: st.sNow * st.fNow, s: st.sNow * 100, temp: st.temp,
      p1: st.p1Now || 0, p2: st.p2Now || 0
    });
    if (st.samples.length > 9000) st.samples.splice(0, 2000);
  }

  function stepOnce(st, dt) {
    const m = st.motor, cfg = st.cfg;
    const J = inertia(m, cfg);
    const U = m.U;
    let w = st.w;

    if (cfg.method === 'vfd') {
      const fNom = m.f;
      const tR = Math.max(cfg.tRamp, 0.2);
      const f = Math.max(0.05, fNom * Math.min(1, st.t / tR));
      const ws = PI2 * f / (m.poles / 2);
      const wRef = ws * (1 - m.sn * 0.9);
      const Tload = E.loadTorque(m, w * 60 / PI2, cfg.load);
      const Kp = 2 * m.mn / (0.05 * PI2 * fNom / (m.poles / 2));
      const alpha = st.t < tR ? (1 - m.sn * 0.9) * PI2 * (fNom / tR) / (m.poles / 2) : 0;
      let Tcmd = Tload + J * alpha + Kp * (wRef - w);
      Tcmd = Math.max(-m.mmaxAbs, Math.min(m.mmaxAbs, Tcmd));
      const dw = (Tcmd - Tload) / J * dt;
      w = Math.max(0, w + dw);
      const s = Math.max(0, Math.min(1, (ws - w) / ws));
      if (st.t < 0.01) w = Math.max(w, wRef);
      const uF = Math.max(0.04, 0.04 + 0.96 * Math.min(1, f / fNom));
      const I = m.i * Math.sqrt(m.i0rel * m.i0rel + (1 - m.i0rel * m.i0rel) * Math.min(9, Math.abs(Tcmd) / m.mn));
      st.fNow = f;
      st.uNow = uF;
      st.sNow = s;
      st.iNow = I;
      st.tNow = Tcmd;
      st.nNow = w * 60 / PI2;
      st.p2Now = Tcmd * w / 1000;
      st.p1Now = st.p2Now + m.pConst + m.pVar * Math.pow(I / m.i, 2);
      st.peakI = Math.max(st.peakI, I);
      st.peakT = Math.max(st.peakT, Tcmd);
    } else {
      const wsNom = PI2 * m.f / (m.poles / 2);
      let s = (wsNom - w) / wsNom;
      s = Math.max(0, Math.min(1, s));
      const uCmd = methodVoltage(st, cfg, st.iNow || 0, dt);
      let uF = uCmd;
      let I = E.currentAt(m, s, uF);
      if (st.cable && st.cable.section) {
        const dPct = E.voltageDrop(I, st.cable.length, st.cable.section, st.cable.material, 0.30, m.U, m.phases, st.cable.insulation, st.cable.parallel).pct / 100;
        uF = uF * Math.max(0.6, 1 - dPct);
        I = E.currentAt(m, s, uF);
      }
      const Tem = E.torque(m, s, uF);
      const Tload = E.loadTorque(m, w * 60 / PI2, cfg.load);
      const dw = (Tem - Tload) / J * dt;
      w = Math.max(0, Math.min(wsNom, w + dw));
      st.fNow = m.f;
      st.uSoft = uCmd;
      st.uNow = uF;
      st.sNow = s;
      st.iNow = I;
      st.tNow = Tem;
      st.nNow = w * 60 / PI2;
      st.p2Now = Tem * w / 1000;
      st.p1Now = st.p2Now + m.pConst + m.pVar * Math.pow(I / m.i, 2);
      st.peakI = Math.max(st.peakI, I);
      st.peakT = Math.max(st.peakT, Tem);
    }

    st.w = w;
    const dTss = m.riseRated * Math.pow(st.iNow / m.i, 2) + (st.nNow < 1 ? 15 : 0);
    st.temp += (m.tempAmbient + dTss - st.temp) / (m.tauMin * 60) * dt;
    st.i2t += st.iNow * st.iNow * dt;

    if (st.tStart == null && st.nNow >= 0.95 * m.n) st.tStart = st.t;
    // «Опрокидывание» — это устойчивое стояние, а не первые секунды плавного пуска.
    if (st.nNow > 0.05 * m.n) {
      st.stalled = false;
      st.stallTimer = 0;
    }
    if (!st.stalled && st.t > 0.5 && st.nNow < 0.02 * m.n && st.tNow < E.loadTorque(m, st.nNow, cfg.load) * 1.02) {
      st.stallTimer += dt;
      if (st.stallTimer > 3.0) st.stalled = true;
    } else if (st.nNow >= 0.02 * m.n) {
      st.stallTimer = 0;
    }
    st.t += dt;
    if (st.t >= cfg.duration) st.done = true;
  }

  function advance(st, seconds) {
    const dt = 0.0005;
    let left = Math.min(seconds, 0.25);
    while (left > 0 && !st.done) {
      stepOnce(st, Math.min(dt, left));
      left -= dt;
      if (st.t - st.lastSample >= 0.02 || st.lastSample < 0) {
        st.lastSample = st.t;
        sample(st);
      }
    }
    return st;
  }

  /* Предрасчёт сценария для сравнения способов пуска */
  function runScenario(motor, cfg, maxT) {
    const st = createState(motor, cfg);
    st.cfg = Object.assign({}, cfg, { duration: maxT || 30 });
    const dt = 0.001;
    let guard = 0;
    while (!st.done && guard++ < 60000) {
      stepOnce(st, dt);
      if (st.t > 0.2 && st.tStart != null && st.t > st.tStart + 1.0) break;
    }
    return {
      method: cfg.method,
      tStart: st.tStart,
      peakI: st.peakI,
      peakT: st.peakT,
      nEnd: st.nNow,
      Iend: st.iNow,
      stalled: st.stalled && st.tStart == null
    };
  }

  function compare(motor, cfg) {
    const methods = motor.phases === 1 ? ['dol', 'soft', 'vfd'] : ['dol', 'yd', 'soft', 'vfd', 'autotr'];
    return methods.map(function (mth) {
      const c = Object.assign({}, cfg, { method: mth, duration: 25 });
      if (mth === 'yd' || mth === 'autotr') c.tSwitch = cfg.tSwitch || 2;
      try { return runScenario(motor, c, 25); }
      catch (e) { return { method: mth, tStart: null, peakI: 0, peakT: 0, nEnd: 0, Iend: 0, stalled: true }; }
    });
  }

  root.MC.sim = {
    DEFAULTS: DEFAULTS,
    createState: createState,
    advance: advance,
    compare: compare,
    inertia: inertia
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
