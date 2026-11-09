/* ============================================================
   Тепловая проверка пуска: чистый модуль без DOM, state и i18n.
   Вход — аппарат, результат сравнения способов пуска и число пусков/час.
   Возвращает те же поля, что раньше собирал app.js.
   ============================================================ */
(function (root) {
  'use strict';
  const MC = root.MC = root.MC || {};

  function start(opts) {
    opts = opts || {};
    const b = opts.breaker || {};
    const s = MC.vtc.get(opts.seriesId || b.series);
    const curve = b.curve && s.curves.includes(b.curve) ? b.curve : s.curves[0];
    const In = b.In;
    const Istart = opts.Istart;
    const cmp = opts.cmp || null;
    const pending = !cmp;
    const hasStart = !!(cmp && cmp.tStart != null);
    const tStart = hasStart ? cmp.tStart : null;
    /* Без времени пуска нельзя считать ни действующий ток, ни отношение
       tср/tпуск: подставлять пик вместо Ieq нельзя — это даёт ложный вердикт. */
    const Ieq = hasStart && cmp.ieq ? cmp.ieq : null;
    const trip = Ieq != null ? MC.vtc.thermalTripTime(s, curve, In, Ieq) : null;
    const ratio = (trip != null && tStart != null && tStart > 0) ? trip / tStart : null;
    const level = ratio == null ? null : ratio <= 1 ? 'bad' : ratio <= 2 ? 'warn' : 'ok';
    const stalled = !!(cmp && cmp.stalled && !hasStart);
    const incomplete = !pending && !hasStart;
    const duration = (cmp && cmp.duration) || 25;
    /* повторные пуски: доля времени под пусковым током → эквивалентный ток */
    const starts = +opts.startsPerHour || 0;
    let duty = null;
    if (hasStart && tStart > 0 && starts > 0 && Ieq != null) {
      const share = Math.min(1, starts * tStart / 3600);
      const IeqDuty = Ieq * Math.sqrt(share);
      const tripEq = MC.vtc.thermalTripTime(s, curve, In, IeqDuty);
      duty = { starts, share, Ieq: IeqDuty, tripEq, ok: tripEq == null || tripEq >= 3600 };
    }
    return { s, curve, In, Istart, Ieq, tStart, trip, ratio, level, duty, pending, hasStart, stalled, incomplete, duration };
  }

  MC.thermal = { start };
})(globalThis);
