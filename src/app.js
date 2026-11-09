/* ============================================================
   Интерфейс и связывание расчёта с графиками
   ============================================================ */
(function () {
  'use strict';

  const D = MC.data;
  const E = MC.engine;
  const S = MC.sim;
  const C = MC.CHART_COLORS;
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  /* i18n: t — точная строка, tf — шаблон с {подстановками}, tHtml — разметка */
  const I18N = window.MC_I18N;
  const t = s => I18N.t(s);
  const tf = (s, v) => I18N.tf(s, v);
  const tHtml = s => I18N.tHtml(s);
  /* nf учитывает язык: 1 469,23 (ru) / 1,469.23 (en) */
  const nf = (v, d) => I18N.nf(v, d);
  /* число + единица: nu(11.47, 2, 'кВт') → «11,47 кВт» / «11.47 kW» */
  const nu = (v, d, unit) => nf(v, d) + (unit ? ' ' + t(unit) : '');

  /* ---------- состояние ---------- */
  const DEFAULTS = {
    phases: 3, voltage: 380, freq: 50, conn: 'Y', connAuto: true,
    mode: 'catalog', catPoles: 4, catType: 'АИР160S4',
    p2: 15, current: 30, torque: 98, speedRpm: 1460, poles: 4,
    autoTypical: true, eff: 89, cos: 0.87,
    slip: 2.7, kst: 7, mst: 2.2, mmax: 2.3, jMotor: 0,
    motorClass: 'F', tauMotor: 0, motorAmbient: 40, motor1phType: 'capacitor',
    motorHotStart: false, motorHotPct: 70, motorCoolTau: 30, motorStartsPerHour: 0, motorOverloadClass: 10,
    projectName: '', projectLogo: '', loadType: 'quadratic', loadPct: 75, jExtra: 0.3, loadCurve: [[0, 0], [25, 25], [50, 55], [75, 80], [100, 100]], loadUnload: 0, loadRelease: 20,
    cable: { standard: 'pue', material: 'cu', insulation: 'pvc', laying: 'open', length: 50, ambient: 25, group: 1, loaded: 3, parallel: 'auto', startDropLimit: 15, considerStartDrop: true },
    dropLimit: 5, startMethod: 'dol', curve: 'D', isc: 6,
    breakerType: 'mcb', breakerSeries: 'abb-s200', mccbMag: 10, upstreamIn: 0,
    sim: { tSwitch: 2, tRamp: 6, uStart: 30, iLimit: 3, duration: 20, speed: 1, overlay: 'none' },
    charts: { torque: true, iu: true, speed: true, eff: true, power: true },
    exportCharts: { torque: true, iu: true, speed: true, eff: true, power: true, simN: true, simI: true, simT: true, simU: true, vtc: true },
    tab: 'calc', theme: 'dark'
  };

  /* какие графики включать в PDF и PNG-экспорт */
  const EXPORT_CHARTS = [
    { key: 'torque', label: 'Механическая характеристика M(n)' },
    { key: 'iu', label: 'Ток и напряжение от нагрузки' },
    { key: 'speed', label: 'Скорость, скольжение, f₂' },
    { key: 'eff', label: 'КПД и cosφ' },
    { key: 'power', label: 'Мощности' },
    { key: 'simN', label: 'Скорость n(t)' },
    { key: 'simI', label: 'Ток I(t)' },
    { key: 'simT', label: 'Момент M(t)' },
    { key: 'simU', label: 'Напряжение и частота' },
    { key: 'vtc', label: 'ВТХ: защита и пуск' }
  ];

  const STORE_KEY = 'motor-calc-v1';
  let state;
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    state = deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), saved || {});
  } catch (e) { state = JSON.parse(JSON.stringify(DEFAULTS)); }

  function deepMerge(a, b) {
    if (!b || typeof b !== 'object') return a;
    Object.keys(b).forEach(k => {
      if (a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) a[k] = deepMerge(a[k], b[k]);
      else if (b[k] !== undefined && b[k] !== null) a[k] = b[k];
    });
    return a;
  }
  // ссылка на расчёт: ?p=<base64url state>
  try {
    const sp = new URLSearchParams(location.search).get('p');
    if (sp) {
      const b64 = sp.replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(b64 + '='.repeat((4 - b64.length % 4) % 4));
      const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
      const shared = JSON.parse(new TextDecoder().decode(bytes));
      state = deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), shared);
      state.tab = shared.tab || 'calc';
      try { localStorage.setItem('motor-tour-v1', '1'); } catch (e) { }
      try {
        const u = new URL(location.href);
        u.searchParams.delete('p');
        history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash);
      } catch (e) { }
    }
  } catch (e) { }

  const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  const setPath = (o, p, v) => { const ks = p.split('.'); let x = o; for (let i = 0; i < ks.length - 1; i++) x = x[ks[i]]; x[ks[ks.length - 1]] = v; };

  let lastRep = null, lastKey = '', compareData = null, compareTimer = 0, lastCompareKey = '';
  let simState = null, ghostState = null, simRunning = false, simMotorKey = '', simMethodKey = '', simFollow = false;

  /* ---------- графики ---------- */
  const charts = {};
  /* подписи осей и aria — по ключам, чтобы пересобрать при смене языка */
  const CHART_LABELS = {
    torque: { x: 'n, об/мин', y: 'M, Н·м' },
    iu: { x: 'нагрузка, %', y: 'I, А', y2: 'U, В' },
    speed: { x: 'нагрузка, %', y: 'n, об/мин', y2: 's, % / f₂, Гц' },
    eff: { x: 'нагрузка, %', y: 'η, %' },
    power: { x: 'нагрузка, %', y: 'P, кВт' },
    simN: { x: 't, с', y: 'n, об/мин', y2: 's, %' },
    simI: { x: 't, с', y: 'I, А', y2: 'I / Iн' },
    simT: { x: 't, с', y: 'M, Н·м' },
    simU: { x: 't, с', y: 'U, %', y2: 'f, Гц' }
  };
  const CHART_ARIA = {
    chartTorque: 'Механическая характеристика: момент двигателя и момент нагрузки от скорости',
    chartIU: 'Ток и напряжение от нагрузки',
    chartSpeed: 'Скорость, скольжение и частота ротора от нагрузки',
    chartEff: 'КПД и коэффициент мощности от нагрузки',
    chartPower: 'Потребляемая, полезная мощность и потери от нагрузки'
  };
  function applyChartLabels() {
    Object.keys(CHART_LABELS).forEach(k => {
      const c = charts[k];
      if (!c) return;
      const L = CHART_LABELS[k];
      const o = { xLabel: t(L.x), yLabel: t(L.y) };
      if (L.y2) o.y2Label = t(L.y2);
      c.setOptions(o);
    });
    Object.keys(CHART_ARIA).forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.setAttribute('role', 'img');
      el.setAttribute('aria-label', t(CHART_ARIA[id]));
    });
  }

  function initCharts() {
    const L = k => ({ xLabel: t(CHART_LABELS[k].x), yLabel: t(CHART_LABELS[k].y), y2Label: CHART_LABELS[k].y2 ? t(CHART_LABELS[k].y2) : undefined });
    charts.torque = new MC.Chart($('#chartTorque'), Object.assign(L('torque'), {
      xFmt: v => nf(v, 0), yFmt: v => nf(v, 0),
      pad: { l: 58, r: 22, t: 34, b: 40 }
    }));
    charts.iu = new MC.Chart($('#chartIU'), Object.assign(L('iu'), {
      xFmt: v => nf(v, 0),
      pad: { l: 56, r: 58, t: 34, b: 40 }
    }));
    charts.speed = new MC.Chart($('#chartSpeed'), Object.assign(L('speed'), {
      xFmt: v => nf(v, 0),
      pad: { l: 58, r: 62, t: 34, b: 40 }
    }));
    charts.eff = new MC.Chart($('#chartEff'), Object.assign(L('eff'), {
      xFmt: v => nf(v, 0), yFmt: v => nf(v, 0),
      pad: { l: 56, r: 22, t: 34, b: 40 }
    }));
    charts.power = new MC.Chart($('#chartPower'), Object.assign(L('power'), {
      xFmt: v => nf(v, 0), yFmt: v => nf(v, 1),
      pad: { l: 56, r: 22, t: 34, b: 40 }
    }));

    charts.simN = new MC.Chart($('#chartSimN'), Object.assign(L('simN'), {
      xFmt: v => nf(v, 1),
      pad: { l: 58, r: 54, t: 34, b: 38 }
    }));
    charts.simI = new MC.Chart($('#chartSimI'), Object.assign(L('simI'), {
      xFmt: v => nf(v, 1),
      pad: { l: 58, r: 54, t: 34, b: 38 }
    }));
    charts.simT = new MC.Chart($('#chartSimT'), Object.assign(L('simT'), {
      xFmt: v => nf(v, 1), yFmt: v => nf(v, 0),
      pad: { l: 58, r: 22, t: 34, b: 38 }
    }));
    charts.simU = new MC.Chart($('#chartSimU'), Object.assign(L('simU'), {
      xFmt: v => nf(v, 1),
      pad: { l: 58, r: 54, t: 34, b: 38 }
    }));
    applyChartLabels();
  }

  function addChartTools() {
    ['chartTorque', 'chartIU', 'chartSpeed', 'chartEff', 'chartPower', 'chartSimN', 'chartSimI', 'chartSimT', 'chartSimU'].forEach(id => {
      const cv = document.getElementById(id);
      if (!cv) return;
      const panel = cv.closest('.chart-panel');
      const head = panel && panel.querySelector('.panel-head');
      if (!head || head.querySelector('.panel-tools')) return;
      const wrap = document.createElement('div');
      wrap.className = 'head-right';
      const tag = head.querySelector('.panel-tag');
      if (tag) wrap.appendChild(tag);
      const tools = document.createElement('div');
      tools.className = 'panel-tools';
      tools.innerHTML = `<button class="icon-btn" data-reset="${id}" title="Сбросить масштаб" aria-label="Сбросить масштаб">⟲</button><button class="icon-btn" data-png="${id}" title="Скачать PNG" aria-label="Скачать PNG">⤓</button>`;
      wrap.appendChild(tools);
      head.appendChild(wrap);
    });
  }

  function chartByCanvas(id) {
    return Object.keys(charts).map(k => charts[k]).find(c => c.canvas && c.canvas.id === id) || null;
  }


  /* ---------- всплывающие подсказки ---------- */
  const TIPS = {
    segPhases: 'Трёхфазный или однофазный двигатель. Для однофазного ток считается по I = P₁/(U·cosφ), без √3.',
    voltage: 'Линейное напряжение сети: для 3 фаз — между фазами (380/400 В), для 1 фазы — фазное (220/230 В). От напряжения зависят ток, момент и выбор аппаратов.',
    segFreq: 'Частота сети. Синхронная скорость n₁ = 120·f/p. При 60 Гц каталожные данные пересчитываются приближённо.',
    segConn: 'Схема обмоток. В звезде фазное напряжение в √3 раз меньше линейного, в треугольнике равно линейному. Для 380/660 при 380 В — треугольник.',
    segMode: 'Способ задания: каталог АИР, мощность P₂, ток I или момент M. От него зависит, какие поля нужно заполнить.',
    catPoles: 'Фильтр каталога по числу полюсов. 2 полюса ≈ 3000 об/мин, 4 ≈ 1500, 6 ≈ 1000, 8 ≈ 750 при 50 Гц.',
    catMotor: 'Типоразмер АИР. Данные до 37 кВт — по каталогу; крупные 45…315 кВт отмечены * как типовые справочные.',
    p2: 'Полезная мощность на валу P₂. Потребляемая мощность P₁ = P₂/η, ток — по P₁ и cosφ.',
    current: 'Линейный ток статора. Мощность восстанавливается итерационно по типовым КПД и cosφ — уточняйте по паспорту двигателя.',
    torque: 'Момент на валу. Мощность P₂ = M·n/9550 (M в Н·м, n в об/мин).',
    speedRpm: 'Частота вращения вала. Должна быть меньше синхронной n₁; скольжение s = (n₁ − n)/n₁.',
    poles: 'Число полюсов, а не количество обмоток. n₁ = 120·f/p: больше полюсов — ниже скорость и выше момент. У однофазных тоже 2/4/6/8 полюсов.',
    motor1phType: 'Тип пусковой/рабочей обмотки, а не количество обмоток. У однофазного есть главная и пусковая (вспомогательная) обмотка; конденсаторный — высокий cosφ и умеренный пусковой ток, с расщеплённой фазой — большой пусковой ток и низкий cosφ, PSC — постоянный конденсатор.',
    eff: 'КПД = P₂/P₁. В типовом режиме подставляется по мощности; можно задать паспортное значение вручную.',
    cos: 'Коэффициент мощности. Влияет на ток: I = P₁/(√3·U·cosφ) и на полную мощность S.',
    slip: 'Номинальное скольжение. Для серии АИР обычно 1…8 %. Определяет наклон рабочего участка характеристики.',
    kst: 'Кратность пускового тока Iп/Iн. Для АИР 5…7,5. Влияет на отсечку автомата, сечение по просадке и нагрев при пуске.',
    mst: 'Кратность пускового момента Mп/Mн. Обычно 1,8…2,3; определяет, стронется ли привод с нагрузкой.',
    mmax: 'Кратность максимального (опрокидывающего) момента Mmax/Mн. Обычно 2,0…2,5; задаёт запас по перегрузке.',
    jMotor: 'Момент инерции ротора, кг·м². 0 — автооценка по мощности (для 15 кВт ≈0,07). Влияет на время разгона.',
    motorClass: 'Класс нагревостойкости изоляции: B — 130 °C, F — 155 °C, H — 180 °C. Задаёт предел температуры и номинальный перегрев.',
    tauMotor: 'Постоянная нагрева двигателя, мин. 0 — автооценка. Чем больше τ, тем медленнее растёт температура.',
    motorAmbient: 'Температура окружающей среды для тепловой модели обмотки. Обычно 40 °C.',
    loadType: 'Характер момента сопротивления: постоянный, вентиляторный (∝ n²), линейный (∝ n) или постоянная мощность. Постоянная мощность: M = P/ω, при нулевой скорости момент стремится к бесконечности; пуск без разгрузки/сцепления или ПЧ с разгрузкой невозможен.',
    jExtra: 'J нагрузки — приведённый к валу момент инерции механизма, кг·м². Это «инертность» нагрузки: чем больше J, тем медленнее разгон и больше нагрев при пуске. Ориентир: вентилятор 0,1…1 от J двигателя, конвейер 1…5, пресс 3…10. Если неизвестно — начните с 0,3…1.',
    loadUnload: 'Разгрузка на пуске: на сколько процентов снижается момент нагрузки, пока двигатель не достигнет скорости снятия. 0 — без разгрузки; для компрессора, дробилки, пресса 50…90 %.',
    loadRelease: 'Скорость, при которой разгрузка снимается, % от номинальной. Обычно 20…40 %; после этого нагрузка восстанавливается.',
    loadCurve: 'Своя кривая M(n): пары «%n:%Mн» через «;». Масштаб задаёт ползунок нагрузки. Например: 0:0; 50:50; 100:100.',
    motorHotStart: 'Горячий пуск: обмотка уже нагрета после предыдущей работы. Время до предела температуры меньше, чем при холодном пуске.',
    motorHotPct: 'Начальный нагрев в % от (предел − температура среды). 70 % — типичный горячий старт; 0 — холодный.',
    motorClassOv: 'Класс перегрузки 10/20/30: допустимое время перегрузки. 20 — вдвое, 30 — втрое больше, чем 10.',
    motorStarts: 'Пусков в час — тепловой запас. 0 — не учитывать; для частых пусков укажите реальное число.',
    motorCoolTau: 'Постоянная охлаждения двигателя, мин. Используется для оценки теплового режима между пусками.',
    brkSeries: 'Серия автомата: IEK, CHINT, ABB; MCB или MCCB. От неё зависят кривые и уставки.',
    brkCurve: 'Кривая MCB (B/C/D/K/Z) или уставка MCCB (TMD/TMA). Для 380/660 и пуска часто нужна D.',
    vtcUpstream: 'Номинал вышестоящего автомата для проверки селективности. 0 — не задан.',
    projectName: 'Название объекта или проекта — попадёт в PDF-отчёт.',
    projectLogo: 'Логотип для PDF: PNG, JPEG или SVG; приводится к 240 px.',
    segStd: 'Норматив таблиц кабелей и поправок: ПУЭ (Россия) или IEC 60364 (международный).',
    segMat: 'Материал жил: медь или алюминий. Алюминий имеет меньше допустимый ток и большее сопротивление.',
    insulation: 'Изоляция: ПВХ/резина (70 °C) или XLPE (90 °C). XLPE допускает больший ток и нагрев.',
    laying: 'Способ прокладки: открыто, лоток, труба/стена, земля. Учитывается коэффициентом допустимого тока.',
    len: 'Длина линии от щита до двигателя. Влияет на падение напряжения, потери и просадку при пуске.',
    ambient: 'Температура среды для кабеля. Поправка выбирается по таблицам ПУЭ или IEC.',
    group: 'Число кабелей в пучке/лотке. Совместный нагрев снижает допустимый ток каждого.',
    dropLimit: 'Допустимое падение напряжения в рабочем режиме. Для двигателей обычно 5 %.',
    parallel: 'Число параллельных кабелей. «Авто» подбирает минимальное 1…4 с учётом токовой нагрузки и просадки при пуске.',
    startDrop: 'Допустимая просадка напряжения на двигателе при пуске. Обычно 10…15 %; влияет на выбор сечения.',
    loaded: 'Число нагруженных жил: 3 — обычный трёхфазный кабель, 2 — при неполной загрузке (поправка +12 %).',
    startMethod: 'Способ пуска. Определяет расчётный пусковой ток для защиты, просадку напряжения и моделирование переходного процесса.',
    segBrk: 'Тип аппарата: модульный MCB (обычно до 125 А) или MCCB с регулируемой отсечкой. Свыше 125 А автоматически применяется MCCB.',
    segCurve: 'Кривая MCB: B — 3…5·Iн, C — 5…10·Iн, D — 10…20·Iн. Для двигателей с прямым пуском обычно D.',
    mccbMag: 'Уставка отсечки MCCB в кратностях Iн. Должна быть выше расчётного пускового тока.',
    upstream: 'Номинал вышестоящего автомата для проверки селективности. 0 — не проверять. Для токовой селективности отношение обычно ≥ 1,6.',
    isc: 'Ожидаемый ток КЗ в точке подключения. Проверяются Icu автомата и термическая стойкость кабеля по I²t.',
    simMethod: 'Способ пуска для моделирования. Синхронизирован с основным способом пуска в параметрах.',
    simOverlay: 'Второй способ пуска для наложения на графики. Его кривые рисуются пунктиром; «нет» отключает сравнение.',
    segSimSpeed: 'Скорость воспроизведения моделирования: 0,25× — медленно и подробно, 2× — быстро.',
    simSwitch: 'Время работы в звезде (или на автотрансформаторе) до переключения на полное напряжение.',
    simRamp: 'Время разгона для софтстартера или частотного привода.',
    simUstart: 'Начальное напряжение софтстартера в % от номинала. Меньше — мягче пуск, но меньше момент.',
    simIlimit: 'Ограничение пускового тока софтстартера в кратностях Iн. Влияет и на проверку отсечки автомата.',
    loadPct: 'Момент нагрузки в % от Mн при номинальной скорости. Для вентиляторной нагрузки фактический момент зависит от n² — смотрите строку ниже.'
  };
  const RESULT_TIPS = {
    'Номинальный ток': 'Iн = P₁/(√3·U·cosφ) — линейный ток статора при номинальной нагрузке.',
    'Момент Mн': 'Mн = 9550·P₂/n — момент на валу при номинальной нагрузке.',
    'Расчётный ток пуска': 'Пусковой ток, который видит защита для выбранного способа пуска (DOL, Y–Δ, софтстартер, ПЧ, автотрансформатор).',
    'Селективность': 'Отношение номиналов вышестоящего и нижестоящего аппаратов; для токовой селективности обычно ≥ 1,6.',
    'Критическое скольжение': 'Скольжение, при котором момент максимален: sкр = sн·(Mmax/Mн + √((Mmax/Mн)² − 1)).',
    'Класс изоляции': 'Предел температуры обмотки: B — 130 °C, F — 155 °C, H — 180 °C.',
    'Постоянная нагрева τ': 'Время, за которое перегрев достигает 63 % установившегося значения.',
    'Просадка при пуске': 'Падение напряжения на двигателе в момент пуска. Пусковой момент пропорционален U².',
    'Число полюсов': 'Однофазные двигатели тоже имеют 2/4/6/8 полюсов; синхронная скорость n₁ = 120·f/p.'
  };

  function tipButton(key) {
    return `<button type="button" class="tip-btn" data-tip="${key}" aria-label="${t('Подсказка')}">i</button>`;
  }
  let activeTip = null;
  function tipText(key) {
    if (!key) return '';
    if (key.indexOf('res:') === 0) return t(RESULT_TIPS[key.slice(4)] || '');
    return t(TIPS[key] || '');
  }
  function showTip(btn) {
    const pop = document.getElementById('tipPop');
    const text = tipText(btn.dataset.tip);
    if (!pop || !text) return;
    if (activeTip && activeTip !== btn) activeTip.classList.remove('active');
    activeTip = btn;
    btn.classList.add('active');
    pop.innerHTML = text;
    pop.classList.add('show');
    pop.setAttribute('aria-hidden', 'false');
    const r = btn.getBoundingClientRect();
    const tw = pop.offsetWidth, th = pop.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    let top = r.top - th - 9;
    if (top < 8) top = r.bottom + 9;
    if (top + th > window.innerHeight - 8) top = Math.max(8, window.innerHeight - th - 8);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }
  function hideTip() {
    const pop = document.getElementById('tipPop');
    if (pop) { pop.classList.remove('show'); pop.setAttribute('aria-hidden', 'true'); pop.innerHTML = ''; }
    if (activeTip) activeTip.classList.remove('active');
    activeTip = null;
  }
  function decorateTips() {
    document.querySelectorAll('.field').forEach(field => {
      const ctrl = field.querySelector('input[id], select[id], textarea[id], .seg[id]');
      if (!ctrl || !TIPS[ctrl.id]) return;
      const label = field.querySelector('label');
      if (label && !label.querySelector('.tip-btn')) label.insertAdjacentHTML('beforeend', tipButton(ctrl.id));
    });
    document.querySelectorAll('.check').forEach(field => {
      const ctrl = field.querySelector('input[id]');
      if (!ctrl || !TIPS[ctrl.id]) return;
      if (!field.querySelector('.tip-btn')) field.insertAdjacentHTML('beforeend', tipButton(ctrl.id));
    });
    const lt = document.querySelector('.loadbar-title');
    if (lt && !lt.querySelector('.tip-btn')) lt.insertAdjacentHTML('beforeend', tipButton('loadPct'));
    document.querySelectorAll('.kv-label, .kpi-label').forEach(el => {
      if (el.querySelector('.tip-btn')) return;
      const text = el.textContent.trim();
      const key = el.dataset.tip || (RESULT_TIPS[text] ? 'res:' + text : '');
      if (key) el.insertAdjacentHTML('beforeend', tipButton(key));
    });
  }

  /* ---------- синхронизация контролов ---------- */
  const inputIds = {
    voltage: 'voltage', p2: 'p2', current: 'current', torque: 'torque', speedRpm: 'speedRpm',
    eff: 'eff', cos: 'cos', slip: 'slip', kst: 'kst', mst: 'mst', mmax: 'mmax',
    jMotor: 'jMotor', jExtra: 'jExtra', tauMotor: 'tauMotor', motorAmbient: 'motorAmbient', len: 'cable.length', ambient: 'cable.ambient',
    group: 'cable.group', dropLimit: 'dropLimit', isc: 'isc', startDrop: 'cable.startDropLimit'
  };

  function setIfIdle(id, v) {
    const el = document.getElementById(id);
    if (el && el !== document.activeElement) el.value = v;
  }

  function syncInputs() {
    Object.keys(inputIds).forEach(id => {
      setIfIdle(id, getPath(state, inputIds[id]));
    });
    setIfIdle('voltage', state.voltage);
    setIfIdle('p2', state.p2);
    $('#poles').value = state.poles;
    $('#catPoles').value = state.catPoles;
    $('#projectName').value = state.projectName || '';
    $('#loadType').value = state.loadType;
    $('#loadCurve').value = (state.loadCurve || []).map(p => p[0] + ':' + p[1]).join('; ');
    $('#loadUnload').value = state.loadUnload;
    $('#loadRelease').value = state.loadRelease;
    updateUnloadUI();
    $('#insulation').value = state.cable.insulation;
    $('#parallel').value = state.cable.parallel;
    $('#loaded').value = state.cable.loaded;
    $('#fieldCurve').classList.toggle('hidden', state.breakerType === 'mccb');
    $('#fieldMccb').classList.toggle('hidden', state.breakerType !== 'mccb');
    $('#laying').value = state.cable.laying;
    $('#startMethod').value = state.startMethod;
    fillBreakerSeries();
    $('#brkSeries').value = state.breakerSeries;
    fillBreakerCurves();
    $('#brkCurve').value = state.curve;
    $('#vtcUpstream').value = state.upstreamIn;
    $('#mccbMag').value = state.mccbMag;
    $('#motorClass').value = state.motorClass;
    $('#motor1phType').value = state.motor1phType;
    $('#motorHotStart').checked = !!state.motorHotStart;
    $('#motorHotPct').value = state.motorHotPct;
    $('#motorClassOv').value = state.motorOverloadClass;
    $('#motorStarts').value = state.motorStartsPerHour;
    $('#motorCoolTau').value = state.motorCoolTau;
    $('#simMethod').value = state.startMethod;
    $('#simSwitch').value = state.sim.tSwitch;
    $('#simRamp').value = state.sim.tRamp;
    $('#simUstart').value = state.sim.uStart;
    $('#simIlimit').value = state.sim.iLimit;
    $('#simDuration').value = state.sim.duration;
    $('#simOverlay').value = state.sim.overlay;
    updateOverlayNote();
    syncSeg('#segPhases', state.phases);
    syncSeg('#segFreq', state.freq);
    syncSeg('#segConn', state.conn);
    syncSeg('#segMode', state.mode);
    syncSeg('#segStd', state.cable.standard);
    syncSeg('#segMat', state.cable.material);
    syncSeg('#segCurve', state.curve);
    syncSeg('#segBrk', state.breakerType);
    syncSeg('#segSimSpeed', state.sim.speed);
    syncSeg('#segTheme', state.theme);
    $('#loadRange').value = state.loadPct;
    updateLoadbar();
    syncPhaseUI();
    updateVisibility();
    updateSimVisibility();
    renderExportCharts();
  }

  function syncPhaseUI() {
    const one = state.phases === 1;
    const catBtn = document.querySelector('#segMode button[data-val="catalog"]');
    if (catBtn) catBtn.disabled = one;
    if (one && state.mode === 'catalog') {
      state.mode = 'power';
      syncSeg('#segMode', 'power');
    }
    const loaded = $('#loaded');
    if (loaded) { loaded.value = state.cable.loaded; loaded.disabled = one; }
    ['#startMethod', '#simMethod', '#simOverlay'].forEach(sel => {
      const el = $(sel);
      if (!el) return;
      Array.from(el.options).forEach(o => {
        if (o.value === 'yd' || o.value === 'autotr') o.disabled = one;
      });
    });
    if (one && (state.startMethod === 'yd' || state.startMethod === 'autotr')) {
      state.startMethod = 'dol';
      $('#startMethod').value = 'dol';
      $('#simMethod').value = 'dol';
    }
    if (one && (state.sim.overlay === 'yd' || state.sim.overlay === 'autotr')) {
      state.sim.overlay = 'none';
      $('#simOverlay').value = 'none';
    }
    document.querySelectorAll('#voltPresets button').forEach(b => {
      b.disabled = one && +b.dataset.v > 250;
    });
    const ft = $('#field1phType');
    if (ft) ft.classList.toggle('hidden', !one);
    const ph = $('#polesHint');
    if (ph) ph.textContent = one ? t('Для однофазных: 2/4/6/8 полюсов; это скорость, а не число обмоток (главная + пусковая).') : '';
  }

  function syncSeg(sel, val) {
    const box = $(sel);
    if (!box) return;
    Array.from(box.querySelectorAll('button')).forEach(b => {
      b.classList.toggle('active', String(b.dataset.val) === String(val));
    });
  }

  function updateLoadbar() {
    $('#loadVal').textContent = nf(state.loadPct, 0);
    const r = $('#loadRange');
    r.style.setProperty('--fill', (state.loadPct / 150 * 100) + '%');
    if (lastRep) {
      const op = lastRep.op;
      $('#loadTorque').textContent = nu(op.Tload, 1, 'Н·м');
      $('#loadPower').textContent = nu(op.p2, 2, 'кВт');
      $('#loadSpeed').textContent = nu(op.n, 0, 'об/мин');
    }
  }

  function updateUnloadUI() {
    const on = +state.loadUnload > 0;
    const el = $('#loadRelease');
    if (el) el.disabled = !on;
    const hint = $('#loadReleaseHint');
    if (hint) hint.textContent = on
      ? t('Скорость, при которой снимается разгрузка, % от nн. Не проценты нагрузки.')
      : t('Задайте разгрузку > 0, чтобы использовать это поле.');
  }

  function fillBreakerSeries() {
    const el = $('#brkSeries');
    if (!el || el.options.length) return;
    MC.vtc.list().forEach(s => {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.brand + ' ' + s.series + ' · ' + (s.type === 'mccb' ? 'MCCB' : 'MCB');
      el.appendChild(o);
    });
  }

  function fillBreakerCurves() {
    const s = MC.vtc.get(state.breakerSeries);
    const el = $('#brkCurve');
    const cur = s.curves.includes(state.curve) ? state.curve : s.curves[0];
    el.innerHTML = s.curves.map(c => `<option value="${c}">${s.type === 'mccb' ? tf('Уставка {c}', { c }) : tf('Кривая {c}', { c })}</option>`).join('');
    el.value = cur;
    state.curve = cur;
    state.breakerType = s.type;
    $('#fieldCurve').classList.toggle('hidden', s.type === 'mccb');
    $('#fieldMccb').classList.toggle('hidden', s.type !== 'mccb');
  }

  function updateVisibility() {
    const isCat = state.mode === 'catalog';
    $('#catBlock').classList.toggle('hidden', !isCat || state.phases === 1);
    $('#powerBlock').classList.toggle('hidden', state.mode !== 'power');
    $('#currentBlock').classList.toggle('hidden', state.mode !== 'current');
    $('#torqueBlock').classList.toggle('hidden', state.mode !== 'torque');
    $('#fieldPoles').classList.toggle('hidden', state.mode === 'catalog');
    $('#fieldConn').classList.toggle('hidden', state.phases === 1);
    const flc = $('#fieldLoadCurve');
    if (flc) flc.classList.toggle('hidden', state.loadType !== 'custom');
    $('#connHint').textContent = state.conn === 'Y'
      ? tf('Фазное напряжение {u} В', { u: nf(state.voltage / Math.sqrt(3), 0) })
      : tf('Фазное напряжение {u} В (равно линейному)', { u: nf(state.voltage, 0) });
    const hints = {
      catalog: 'Выбор типоразмера из каталога АИР',
      power: 'Известна мощность на валу и напряжение',
      current: 'Известен ток и напряжение — мощность восстановится',
      torque: 'Известен момент на валу и частота вращения'
    };
    const mh = $('#modeHint');
    if (mh) mh.textContent = t(hints[state.mode] || '');
    const ro = state.autoTypical || state.mode === 'catalog';
    ['eff', 'cos', 'slip', 'kst', 'mst', 'mmax'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = ro;
    });
    $('#autoTypical').checked = state.autoTypical;
  }

  function updateSimVisibility() {
    const m = state.startMethod;
    $$('.sim-switch').forEach(e => e.classList.toggle('hidden', m !== 'yd' && m !== 'autotr'));
    $$('.sim-ramp').forEach(e => e.classList.toggle('hidden', m !== 'soft' && m !== 'vfd'));
    $$('.sim-ustart').forEach(e => e.classList.toggle('hidden', m !== 'soft'));
    $$('.sim-ilimit').forEach(e => e.classList.toggle('hidden', m !== 'soft'));
  }

  /* ---------- каталожный список ---------- */
  function fillCatalog(preserve) {
    const pol = +state.catPoles;
    const list = D.MOTOR_DB.filter(m => !pol || m.poles === pol);
    const sel = $('#catMotor');
    const cur = preserve ? state.catType : sel.value;
    sel.innerHTML = list.map(m =>
      `<option value="${m.type}">${t(m.type)}${m.typical ? ' *' : ''} · ${nf(m.p2, m.p2 % 1 ? 2 : 0)} ${t('кВт')} · ${nf(m.n, 0)} ${t('об/мин')}</option>`
    ).join('');
    if (list.some(m => m.type === cur)) state.catType = cur;
    else if (list.length) state.catType = list[0].type;
    sel.value = state.catType;
    if (state.mode === 'catalog') applyCatalog(false);
  }

  function applyCatalog(updateConn) {
    const m = D.MOTOR_DB.find(x => x.type === state.catType);
    if (!m) return;
    state.poles = m.poles;
    state.eff = m.eff; state.cos = m.cos;
    state.kst = m.kst; state.mst = m.mst; state.mmax = m.mmax;
    const ns = 120 * state.freq / m.poles;
    state.slip = +(((ns - m.n * state.freq / 50) / ns) * 100).toFixed(2);
    state.p2 = m.p2;
    const rec = recommendConn(m, state.voltage);
    if (updateConn !== false && state.connAuto) state.conn = rec;
    setCatInfo(m);
    $('#poles').value = m.poles;
    $('#connHint').textContent = state.conn === 'Y'
      ? tf('Фазное напряжение {u} В', { u: nf(state.voltage / Math.sqrt(3), 0) })
      : tf('Фазное напряжение {u} В (равно линейному)', { u: nf(state.voltage, 0) });
  }

  /* подпись выбранного типоразмера — нужна и при смене языка, когда
     каталожный режим уже не активен */
  function setCatInfo(m) {
    const el = $('#catInfo');
    if (!el || !m) return;
    el.textContent = tf('{p} кВт · {n} об/мин · КПД {eff}% · cosφ {cos} · Iп/Iн {kst}{typ}', {
      p: m.p2, n: m.n, eff: m.eff, cos: m.cos, kst: m.kst,
      typ: m.typical ? ' ' + t('· типовые данные') : ''
    });
  }

  function connFactorFor(cat, U, conn, phases) {
    if (phases !== 3 || !cat || !cat.un || cat.un.indexOf('/') < 0) return 1;
    const pair = cat.un.split('/').map(Number);
    const nom = Math.min(pair[0], pair[1]);
    const act = conn === 'D' ? U : U / Math.sqrt(3);
    return act / nom;
  }

  function recommendConn(m, U) {
    if (m.un === '220/380') return U <= 250 ? 'D' : 'Y';
    if (m.un === '380/660') return U <= 440 ? 'D' : 'Y';
    return U <= 250 ? 'D' : 'Y';
  }

  /* ---------- сборка конфигурации ---------- */
  function buildCfg() {
    let catalog = null;
    if (state.mode === 'catalog' && state.phases === 3) {
      catalog = D.MOTOR_DB.find(m => m.type === state.catType) || D.MOTOR_DB[0];
    }
    const catForConn = state.mode === 'catalog' ? catalog : null;
    if (catForConn && state.connAuto) state.conn = recommendConn(catForConn, state.voltage);
    return {
      mode: catalog ? 'catalog' : (state.mode === 'catalog' ? 'power' : state.mode),
      catalog: catalog,
      phases: +state.phases,
      voltage: +state.voltage,
      freq: +state.freq,
      conn: state.conn,
      connFactor: connFactorFor(catForConn, state.voltage, state.conn, state.phases),
      poles: catalog ? catalog.poles : +state.poles,
      p2: +state.p2, current: +state.current, torque: +state.torque,
      speedRpm: +state.speedRpm,
      eff: +state.eff, cos: +state.cos,
      effAuto: state.autoTypical, cosAuto: state.autoTypical,
      kstAuto: state.autoTypical, mstAuto: state.autoTypical, mmaxAuto: state.autoTypical,
      slipAuto: state.autoTypical ? true : false,
      kst: +state.kst, mst: +state.mst, mmax: +state.mmax, slip: +state.slip,
      jMotor: +state.jMotor,
      motorClass: state.motorClass, tauMotor: +state.tauMotor, motorAmbient: +state.motorAmbient, motor1phType: state.motor1phType,
      motorHotStart: state.motorHotStart, motorHotPct: +state.motorHotPct, motorCoolTau: +state.motorCoolTau, motorStartsPerHour: +state.motorStartsPerHour, motorOverloadClass: +state.motorOverloadClass,
      load: loadCfg(),
      cable: Object.assign({}, state.cable),
      dropLimit: +state.dropLimit,
      softLimit: +state.sim.iLimit,
      startMethod: state.startMethod,
      curve: state.curve,
      breakerType: state.breakerType,
      series: state.breakerSeries,
      mccbMag: +state.mccbMag,
      upstreamIn: +state.upstreamIn,
      isc: +state.isc
    };
  }

  function simCfg() {
    return {
      method: state.startMethod,
      tSwitch: +state.sim.tSwitch,
      tRamp: +state.sim.tRamp,
      uStart: +state.sim.uStart,
      iLimit: +state.sim.iLimit,
      /* время моделирования: живой прогон останавливается сам */
      duration: Math.max(2, +state.sim.duration || 20),
      load: loadCfg(),
      jExtra: +state.jExtra,
      speed: +state.sim.speed
    };
  }

  /* ---------- пересчёт ---------- */
  let sched = false;
  function schedule() {
    saveState();
    if (sched) return;
    sched = true;
    requestAnimationFrame(function () { sched = false; recalc(); });
  }

  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { }
  }

  function recalc() {
    let rep;
    try {
      rep = E.buildReport(buildCfg());
    } catch (err) {
      console.error(err);
      setStatus(tf('ошибка: {m}', { m: err.message }), 'bad');
      return;
    }
    lastRep = rep;
    if (rep.breaker && rep.breaker.series && rep.breaker.series !== state.breakerSeries) {
      state.breakerSeries = rep.breaker.series;
      state.breakerType = rep.breaker.type;
      state.curve = rep.breaker.curve || state.curve;
      fillBreakerCurves();
      if ($('#brkSeries')) $('#brkSeries').value = state.breakerSeries;
      if ($('#brkCurve')) $('#brkCurve').value = state.curve;
      syncSeg('#segBrk', state.breakerType);
    }
    if (state.autoTypical || state.mode === 'catalog') {
      state.eff = +rep.motor.eff.toFixed(1);
      state.cos = +rep.motor.cos.toFixed(3);
      state.slip = +(rep.motor.sn * 100).toFixed(2);
      state.kst = +rep.motor.kst.toFixed(2);
      state.mst = +rep.motor.mst.toFixed(2);
      state.mmax = +rep.motor.mmax.toFixed(2);
    }
    if (state.mode === 'catalog' && rep.motor.catalog) {
      state.p2 = rep.motor.catalog.p2;
      state.poles = rep.motor.catalog.poles;
      state.catPoles = rep.motor.catalog.poles;
    }
    syncInputs();
    render(rep);
    if (/[?&]debug=1/.test(location.search)) {
      window.__mcDebug = {
        state: state, rep: rep, charts: charts,
        get sim() { return simState; },
        get ghost() { return ghostState; },
        get compare() { return compareData; }
      };
    }
    setStatus(t('готово'), 'ok');

    const key = motorKey(rep);
    if (key !== lastKey) {
      lastKey = key;
      resetSim(false);
    } else if (simState) {
      simState.cfg = simCfg();
    }
    updateCompare();
    if (I18N.isEn()) I18N.translateDom(document.body);
  }

  function motorKey(rep) {
    const m = rep.motor;
    return [m.p2.toFixed(3), m.i.toFixed(3), m.n.toFixed(1), m.j.toFixed(4), m.kst, m.mst, m.mmax, m.U].join('|');
  }

  function setStatus(text, kind) {
    $('#statusText').textContent = text;
    const el = $('#status');
    el.style.color = kind === 'bad' ? 'var(--pink)' : kind === 'warn' ? 'var(--amber)' : '';
  }

  /* ---------- варианты ---------- */
  const VAR_KEY = 'motor-variants-v1';
  let variantsCache = null;
  function getVariants() {
    if (variantsCache) return variantsCache;
    try { variantsCache = JSON.parse(localStorage.getItem(VAR_KEY) || '[]'); } catch (e) { variantsCache = []; }
    return variantsCache;
  }
  function setVariants(v) {
    variantsCache = v.slice();
    try { localStorage.setItem(VAR_KEY, JSON.stringify(v)); } catch (e) { }
    renderVariants();
  }
  function rememberVariant() {
    if (!lastRep) return;
    const m = lastRep.motor, c = lastRep.cable, b = lastRep.breaker;
    const okAll = Object.keys(lastRep.checks).every(k => lastRep.checks[k]);
    const v = {
      id: Date.now(),
      name: m.catalog ? m.catalog.type : 'P₂ ' + nf(m.p2, 1) + ' кВт',
      p2: m.p2, i: m.i,
      brk: nf(b.In, 0) + (b.type === 'mccb' ? ' MCCB' : ' ' + b.curve),
      cable: (c.parallel > 1 ? c.parallel + '×' : '') + nf(c.section, 1),
      dU: lastRep.drop.pct, dUs: lastRep.dropStart.pct,
      method: state.startMethod, ok: okAll
    };
    const arr = getVariants();
    arr.push(v);
    while (arr.length > 4) arr.shift();
    setVariants(arr);
    setStatus(t('вариант сохранён'), 'ok');
    if (I18N.isEn()) I18N.translateDom(document.body);
  }
  function renderVariants() {
    const arr = getVariants();
    const tag = $('#variantsTag');
    if (tag) tag.textContent = arr.length + ' / 4';
    const body = $('#variantsBody');
    if (!body) return;
    if (!arr.length) {
      body.innerHTML = '<div class="hint" style="padding:10px 12px">Пока нет сохранённых вариантов. Нажмите «+ вариант» в строке итога.</div>';
      return;
    }
    body.innerHTML = `<table>
      <thead><tr><th>Вариант</th><th class="num">P₂, кВт</th><th class="num">I, А</th><th>Автомат</th><th>Кабель</th><th class="num">ΔU, %</th><th class="num">ΔUп, %</th><th>Пуск</th><th></th></tr></thead>
      <tbody>${arr.map(v => `<tr>
        <td>${v.name}</td><td class="num">${nf(v.p2, 1)}</td><td class="num">${nf(v.i, 1)}</td>
        <td>${v.brk}</td><td>${v.cable} мм²</td><td class="num">${nf(v.dU, 2)}</td><td class="num">${nf(v.dUs, 1)}</td>
        <td>${methodShort(v.method)}</td>
        <td><button class="icon-btn" data-del="${v.id}" title="Удалить" aria-label="Удалить">×</button></td>
      </tr>`).join('')}</tbody></table>`;
  }

  /* ---------- проект ---------- */
  function saveProject() {
    const data = { app: 'motor-calc', version: 2, saved: new Date().toISOString(), state: state };
    window.MC_BRIDGE.saveText('motor-project.json', JSON.stringify(data, null, 2), 'application/json').then(r => {
      if (r && r.ok && !r.fallback) setStatus(tf('файл сохранён: {p}', { p: r.path }), 'ok');
      else if (r && r.error) setStatus(tf('не удалось сохранить файл: {e}', { e: r.error }), 'bad');
    });
  }
  function loadProject(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const obj = JSON.parse(String(reader.result));
        const st = obj && obj.state ? obj.state : obj;
        if (st && st.motorClassOv != null && st.motorOverloadClass == null) st.motorOverloadClass = st.motorClassOv;
        if (st) delete st.motorClassOv;
        state = deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), st);
        fillCatalog(true);
        if (state.mode === 'catalog') applyCatalog(false);
        syncInputs();
        applyTheme(false);
        resetSim(false);
        lastKey = '';
        recalc();
        switchTab('calc');
        setStatus(t('проект загружен'), 'ok');
      } catch (e) {
        console.error(e);
        setStatus(t('ошибка файла проекта'), 'bad');
      }
    };
    reader.readAsText(file);
  }

  /* ---------- отчёт PDF ---------- */
  /* пуск против тепловой части ВТХ автомата: вердикт по времени, а не только
     по магнитной отсечке. Возвращает {level, trip, tStart, ratio, duty}. */
  function thermalStart(rep) {
    return MC.thermal.start({
      breaker: rep.breaker,
      seriesId: rep.breaker.series || state.breakerSeries,
      Istart: rep.iStart || rep.motor.ist,
      cmp: (compareData || []).find(x => x.method === state.startMethod),
      startsPerHour: +state.motorStartsPerHour || 0
    });
  }

  function checksList(rep) {
    const th = thermalStart(rep);
    const list = [
      ['Сечение по нагреву', rep.checks.cable],
      ['Падение напряжения ≤ ' + nf(state.dropLimit, 1) + ' %', rep.checks.drop],
      ['Просадка при пуске ≤ ' + nf(state.cable.startDropLimit, 0) + ' %', rep.checks.startDrop],
      ['Автомат ≥ рабочего тока', rep.checks.breakerCurrent],
      ['Автомат ≤ тока кабеля', rep.checks.breakerCable],
      ['Отсечка выше Iп', rep.checks.breakerMag]
    ];
    list.push([tf('Температура обмотки {t} °C ≤ предела {lim} °C', { t: nf(rep.op.temp, 0), lim: rep.motor.tempLimit }), rep.op.temp <= rep.motor.tempLimit]);
    if (th.incomplete) list.push([tf('Пуск завершён за {d} с', { d: nf(th.duration, 0) }), false]);
    else if (th.level) list.push(['Пуск не выходит за тепловую характеристику', th.level !== 'bad']);
    if (th.duty) list.push([tf('Тепловой запас при {n} пусках/час', { n: th.duty.starts }), th.duty.ok]);
    list.push(
      ['Icu ≥ тока КЗ', rep.checks.breakerIcu],
      ['Термическая стойкость', rep.checks.sc],
      ['Контактор AC-3', rep.checks.contactor],
      ['Устойчивость при нагрузке', !rep.op.stalled]
    );
    if (rep.breaker.upstream) list.push(['Селективность', rep.checks.breakerSel]);
    return list;
  }

  /* Переходные процессы для отчёта: прогоняем сценарий отдельно, на время
     выборки, и рисуем графики на скрытых canvas — без вкладки «Пуск». */
  function reportTransientImages(rep) {
    if (!MC.Chart || !MC.sim || !rep) return null;
    const cfg = Object.assign(simCfg(), {
      method: state.startMethod,
      duration: Math.max(2, +state.sim.duration || 20),
      cable: rep.cable,
      trace: true
    });
    let res = null;
    try { res = MC.sim.runScenario(rep.motor, cfg, cfg.duration); } catch (e) { return null; }
    const pts = (res && res.samples ? res.samples : []).filter(p => isFinite(p.n) && p.t <= cfg.duration + 0.01);
    if (pts.length < 2) return null;

    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-12000px;top:0;width:900px;height:300px;pointer-events:none';
    document.body.appendChild(host);
    const make = (series, opts) => {
      const cv = document.createElement('canvas');
      cv.style.cssText = 'width:900px;height:280px;display:block';
      host.appendChild(cv);
      try {
        const ch = new MC.Chart(cv, Object.assign({ legend: true, yZero: true, xLabel: t('t, с') }, opts));
        ch.setData(series);
        ch.draw();
        return ch.toPNGData('#ffffff');
      } catch (e) {
        return '';
      } finally {
        cv.remove();
      }
    };
    const dur = Math.max(2, +state.sim.duration || 20);
    const refStart = res.tStart || (pts[pts.length - 1] || {}).t || dur;
    const win = Math.max(2, Math.min(dur, refStart * 2.5));
    const out = {
      n: make([{ name: 'n', color: '#0f9d72', data: pts.map(p => [p.t, p.n]) }], { yLabel: t('n, об/мин'), xRange: [0, win] }),
      i: make([{ name: 'I', color: '#2f7fd1', data: pts.map(p => [p.t, p.I]) }], { yLabel: 'I, А', xRange: [0, win] }),
      m: make([{ name: 'M', color: '#b5730f', data: pts.map(p => [p.t, p.T]) }], { yLabel: 'M, Н·м', xRange: [0, win] }),
      u: make([
        { name: 'U', color: '#7a55c9', data: pts.map(p => [p.t, p.U]) },
        { name: 'f', color: '#b98bff', data: pts.map(p => [p.t, p.f]), axis: 1 }
      ], { yLabel: 'U, %', y2Label: t('f, Гц'), xRange: [0, win] })
    };
    host.remove();
    return out;
  }

  function exportChartSelected(key) {
    return state.exportCharts[key] !== false;
  }

  function updateExportTag() {
    const n = EXPORT_CHARTS.filter(d => exportChartSelected(d.key)).length;
    const tag = $('#exportTag');
    if (!tag) return;
    tag.textContent = tf('выбрано {n} из {total}', { n, total: EXPORT_CHARTS.length });
    tag.className = 'panel-tag' + (n === 0 ? ' bad' : n === EXPORT_CHARTS.length ? ' ok' : '');
  }

  function renderExportCharts() {
    const box = $('#exportCharts');
    if (!box) return;
    box.innerHTML = EXPORT_CHARTS.map(d =>
      `<label class="checkline"><input type="checkbox" data-export="${d.key}"${exportChartSelected(d.key) ? ' checked' : ''}><span>${t(d.label)}</span></label>`
    ).join('');
    updateExportTag();
  }

  function setAllExport(v) {
    EXPORT_CHARTS.forEach(d => { state.exportCharts[d.key] = !!v; });
    renderExportCharts();
    saveState();
  }

  async function exportSelectedPng() {
    if (!lastRep) return;
    const selected = EXPORT_CHARTS.filter(d => exportChartSelected(d.key)).map(d => d.key);
    if (!selected.length) {
      setStatus(t('выберите хотя бы один график'), 'bad');
      return;
    }
    const jobs = [];
    const staticMap = {
      torque: ['motor-torque.png', charts.torque], iu: ['motor-current-voltage.png', charts.iu],
      speed: ['motor-speed-slip.png', charts.speed], eff: ['motor-efficiency-cos.png', charts.eff],
      power: ['motor-power.png', charts.power]
    };
    selected.forEach(k => {
      if (staticMap[k]) jobs.push([staticMap[k][0], staticMap[k][1].toPNGData('#ffffff')]);
    });
    const simKeys = selected.filter(k => k.indexOf('sim') === 0);
    if (simKeys.length) {
      const tr = reportTransientImages(lastRep);
      const map = { simN: ['motor-speed-t.png', tr && tr.n], simI: ['motor-current-t.png', tr && tr.i], simT: ['motor-torque-t.png', tr && tr.m], simU: ['motor-voltage-f.png', tr && tr.u] };
      simKeys.forEach(k => { if (map[k] && map[k][1]) jobs.push([map[k][0], map[k][1]]); });
    }
    if (selected.indexOf('vtc') >= 0) {
      try {
        drawVTC(lastRep);
        const cv = $('#chartVTC');
        if (cv) jobs.push(['motor-vtc.png', cv.toDataURL('image/png')]);
      } catch (e) { }
    }
    let saved = 0;
    for (const [name, data] of jobs) {
      const r = await window.MC_BRIDGE.saveDataUrl(name, data);
      if (r && r.canceled) { setStatus(t('сохранение отменено'), 'ok'); return; }
      if (r && r.ok) saved++;
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    setStatus(tf('PNG сохранено: {n}', { n: saved }), 'ok');
  }

  function openReport() {
    if (!lastRep) return;
    const m = lastRep.motor, c = lastRep.cable, b = lastRep.breaker, op = lastRep.op;
    const prevTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const savedViews = {};
    ['torque', 'iu', 'speed', 'eff', 'power'].forEach(k => { savedViews[k] = charts[k].view; charts[k].view = null; });
    document.documentElement.setAttribute('data-theme', 'light');
    document.documentElement.setAttribute('data-tone', 'light');
    if (MC.setChartTheme) MC.setChartTheme('light');
    Object.assign(MC.CHART_COLORS, MC.PALETTES.light);
    renderCharts(lastRep);
    const img = ch => `<img src="${ch.toPNGData('#ffffff')}" alt="">`;
    const imgs = {
      torque: img(charts.torque), iu: img(charts.iu), speed: img(charts.speed),
      eff: img(charts.eff), power: img(charts.power)
    };
    /* ВТХ и переходные процессы — только если отмечены для экспорта */
    const selChart = k => state.exportCharts[k] !== false;
    const wantVtc = selChart('vtc');
    const wantTrans = EXPORT_CHARTS.some(d => d.key.indexOf('sim') === 0 && selChart(d.key));
    let vtcImg = '';
    if (wantVtc) {
      try {
        drawVTC(lastRep);
        const cv = $('#chartVTC');
        if (cv) vtcImg = cv.toDataURL('image/png');
      } catch (e) { vtcImg = ''; }
    }
    const trImgs = wantTrans ? reportTransientImages(lastRep) : null;
    document.documentElement.setAttribute('data-theme', prevTheme);
    document.documentElement.setAttribute('data-tone', themeTone(prevTheme));
    if (MC.setChartTheme) MC.setChartTheme(prevTheme);
    Object.assign(MC.CHART_COLORS, MC.PALETTES[prevTheme] || MC.PALETTES.dark);
    ['torque', 'iu', 'speed', 'eff', 'power'].forEach(k => { charts[k].view = savedViews[k]; });
    renderCharts(lastRep);

    const staticDefs = [
      { key: 'torque', title: t('Механическая характеристика M(n)'), html: imgs.torque },
      { key: 'iu', title: t('Ток и напряжение от нагрузки'), html: imgs.iu },
      { key: 'speed', title: t('Скорость, скольжение, f₂'), html: imgs.speed },
      { key: 'eff', title: t('КПД и cosφ'), html: imgs.eff },
      { key: 'power', title: t('Мощности'), html: imgs.power, power: true }
    ];
    const staticFigs = staticDefs.filter(d => selChart(d.key));
    const transDefs = [
      { key: 'simN', title: t('Скорость n(t)'), src: trImgs && trImgs.n },
      { key: 'simI', title: t('Ток I(t)'), src: trImgs && trImgs.i },
      { key: 'simT', title: t('Момент M(t)'), src: trImgs && trImgs.m },
      { key: 'simU', title: t('Напряжение и частота'), src: trImgs && trImgs.u }
    ];
    const transFigs = transDefs.filter(d => selChart(d.key) && d.src);
    const hasChars = staticFigs.length > 0;
    const hasTrans = transFigs.length > 0;
    const hasVtc = wantVtc && !!vtcImg;
    const noCharts = !hasChars && !hasTrans && !hasVtc;

    const cmp = (compareData || []).find(x => x.method === state.startMethod);
    const th = thermalStart(lastRep);
    const loadNames = {
      quadratic: 'Вентиляторный (T ∝ n²)', constant: 'Постоянный момент',
      linear: 'Линейный (T ∝ n)', constpower: 'Постоянная мощность', custom: 'Своя кривая M(n)'
    };
    const loadName = t(loadNames[state.loadType] || state.loadType);
    const brkSeries = [b.brand, b.seriesName].filter(Boolean).join(' ');
    const cableLay = t({ open: 'Открыто / по воздуху', tray: 'Лоток', pipe: 'Труба', ground: 'Земля' }[c.laying] || c.laying);
    const cableIns = c.insulation === 'xlpe' ? 'XLPE' : t('ПВХ / резина');
    const cableStd = c.standard === 'pue' ? 'ПУЭ' : 'IEC 60364';
    const selTxt = b.upstream ? (b.okSel ? 'обеспечена' : 'не обеспечена') : 'не задана';
    const thTxt = th.pending ? t('не рассчитана')
      : th.incomplete ? t('не проверена (пуск не завершён)')
      : (th.tStart != null && th.trip != null) ? tf('{tr} с / пуск {ts} с', { tr: nf(Math.max(th.trip, 0.02), 2), ts: nf(th.tStart, 2) })
      : '—';
    const rows = arr => arr.map(x => `<tr><td>${x[0]}</td><td class="r">${x[1]}</td></tr>`).join('');
    const chkRows = checksList(lastRep);
    const chkTable = arr => `<table>${arr.map(x =>
      `<tr><td>${x[0]}</td><td class="r ${x[1] ? 'ok' : 'bad'}">${x[1] ? '✓ да' : '✗ нет'}</td></tr>`).join('')}</table>`;
    const chkHalf = Math.ceil(chkRows.length / 2);
    const csec = (c.parallel > 1 ? c.parallel + ' × ' : '') + nf(c.section, 1) + ' мм²';
    const t1name = { capacitor: 'конденсаторный', split: 'с расщеплённой фазой', psc: 'PSC' }[m.motor1phType] || '';
    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>Отчёт — ${m.catalog ? m.catalog.type : 'асинхронный двигатель'}</title>
<style>
  @page { size: A4; margin: 14mm; }
  body { font: 10.5pt/1.45 -apple-system, "Segoe UI", system-ui, sans-serif; color: #1b2735; margin: 0; padding: 20px 24px; background: #fff; }
  h1 { font-size: 19pt; margin: 0 0 2px; letter-spacing: -.01em; }
  .sub { color: #5b6b7f; font-size: 9.5pt; margin: 0 0 16px; }
  h2 { font-size: 11.5pt; margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #d9e1eb; page-break-after: avoid; }
  h3 { font-size: 9.5pt; margin: 0 0 4px; color: #3c4b5e; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin: 2px 0 6px; }
  tr { page-break-inside: avoid; }
  .checks, .source, .vtc { page-break-inside: avoid; }
  .vtc { page-break-before: always; page-break-inside: avoid; }
  .grid.chars { grid-template-columns: 1fr 1fr; }
  .grid.chars figure.power { grid-column: 1/-1; }
  .grid.transients { grid-template-columns: 1fr 1fr; gap: 12px; }
  .hint { font-size: 9.5pt; color: #5b6a7b; margin: 10px 0 0; }
  td, th { padding: 4px 6px; border-bottom: 1px solid #e7edf5; font-size: 9.3pt; vertical-align: top; }
  th { text-align: left; color: #5b6b7f; font-size: 8pt; text-transform: uppercase; letter-spacing: .06em; }
  .r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ok { color: #0f7a5a; } .bad { color: #b52e4c; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 0 26px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 6px; }
  .grid figure { margin: 0; page-break-inside: avoid; }
  .grid img, .vtc img { width: 100%; border: 1px solid #e1e8f1; border-radius: 6px; }
  .note { margin-top: 16px; font-size: 8.5pt; color: #8593a6; border-top: 1px solid #e7edf5; padding-top: 8px; line-height: 1.5; }
  .note a { color: #0f7a5a; }
  .noprint { position: sticky; top: 0; background: #fff; padding: 8px 0 12px; display: flex; gap: 8px; }
  .noprint button { height: 34px; padding: 0 16px; border-radius: 8px; border: 1px solid #d9e1eb; background: #fff; font: inherit; cursor: pointer; }
  .noprint button:first-child { background: #0f9d72; color: #fff; border-color: #0f9d72; }
  @media print { .noprint { display: none; } .grid { gap: 8px; } }
</style></head><body>
<div class="noprint"><button onclick="window.print()">Печать / PDF</button><button onclick="window.close()">Закрыть</button></div>
<div class="head"><div><h1>${state.projectName ? state.projectName : 'Асинхронный двигатель — расчёт'}</h1>
<p class="sub">${state.projectName ? t('Асинхронный двигатель — расчёт') + ' · ' : ''}${m.catalog ? t(m.catalog.type) : t(m.phases === 1 ? 'Однофазный двигатель' : 'Двигатель') + ' ' + nu(m.p2, 1, 'кВт')}${m.phases === 1 && m.p2 > 7.5 ? t(' · оценка (типовые данные до 7,5 кВт)') : ''} · ${nu(m.U, 0, 'В')} · ${nu(m.p2, 1, 'кВт')} · ${new Date().toLocaleString(I18N.locale())}</p></div>${state.projectLogo ? `<img class="logo" src="${state.projectLogo}" alt="">` : ''}</div>

<div class="two">
<div>
<h2>Основные параметры</h2>
<table>${rows([
  ['Мощность на валу P₂', nf(m.p2, 2) + ' кВт'],
  ['Потребляемая P₁', nf(m.p1, 2) + ' кВт'],
  ['Номинальный ток Iн', nf(m.i, 1) + ' А'],
  ['Пусковой ток (DOL)', nf(m.ist, 0) + ' А'],
  ['Момент Mн', nf(m.mn, 1) + ' Н·м'],
  ['Максимальный момент', nf(m.mmaxReal.t, 0) + ' Н·м'],
  ['Скорость nн', nf(m.n, 0) + ' об/мин'],
  ['Скольжение sн', nf(m.sn * 100, 2) + ' %'],
  ['КПД / cosφ', nf(m.eff, 1) + ' % / ' + nf(m.cos, 3)],
  ['Питание', m.phases === 1 ? '1 фаза, L/N' : '3 фазы'],
  ...(m.phases === 1 ? [['Тип однофазного', t1name]] : [['Схема обмоток', m.conn === 'D' ? 'Δ' : 'Y']]),
  ['Класс изоляции', m.motorClass + ' (' + m.tempLimit + ' °C)'],
  ['Способ пуска', methodLabel(state.startMethod)],
  ['Расчётный ток пуска', nf(lastRep.iStart, 0) + ' А'],
  ['Время разгона', cmp && cmp.tStart != null ? nf(cmp.tStart, 2) + ' с' : '—'],
  ['Температура обмотки', nf(op.temp, 0) + ' °C (' + m.motorClass + ', предел ' + m.tempLimit + ' °C)'],
  ['До предела по нагреву', op.timeToLimit < Infinity ? nf(op.timeToLimit, 0) + ' мин' : 'не достигается']
])}</table>
</div>
<div>
<h2>Защита</h2>
<table>${rows([
  ['Автомат', nu(b.In, 0, 'А') + ' · ' + (m.phases === 1 ? '1P · ' : '3P · ') + (b.type === 'mccb' ? 'MCCB' : 'MCB ' + b.curve) + (brkSeries ? ' · ' + brkSeries : '')],
  ['Отсечка', nu(b.magTrip, 0, 'А') + tf(' ({k}×Iн)', { k: b.mag })],
  ['Icu', nf(b.icu, 0) + ' кА'],
  ['Ток КЗ', nf(state.isc, 1) + ' кА'],
  ['Тепловое реле', nf(lastRep.relay.lo, 1) + '…' + nf(lastRep.relay.hi, 1) + ' ' + t('А') + ' (' + t('уставка') + ' ' + nf(lastRep.relay.set, 1) + ' ' + t('А') + ')'],
  ['Тепловая зона', thTxt],
  ['Контактор', nf(lastRep.contactor.i, 0) + ' А / ' + nf(lastRep.contactor.kw, 0) + ' кВт'],
  ['Предохранитель aM', nf(lastRep.fuse, 0) + ' А'],
  ['Селективность', selTxt]
])}</table>
<h2>Кабель</h2>
<table>${rows([
  ['Сечение', csec + ' ' + (c.material === 'al' ? 'Al' : 'Cu')],
  ['Нагруженных жил', c.loaded === 2 ? '2 (L + N)' : '3'],
  ['PE', (c.parallel > 1 ? c.parallel + ' × ' : '') + nf(c.pe, 1) + ' мм²'],
  ['Длина', nf(c.length, 0) + ' м'],
  ['Изоляция', cableIns],
  ['Способ прокладки', cableLay],
  ['Среда кабеля', nf(c.ambient, 0) + ' °C'],
  ['Группировка', nf(state.cable.group, 0)],
  ['Стандарт', cableStd],
  ['I доп. суммарно', nf(c.allow, 1) + ' А'],
  ['Smin по I²t', nf(lastRep.sc.sMin, 1) + ' мм²'],
  ['ΔU раб.', nf(lastRep.drop.pct, 2) + ' %'],
  ['ΔU пуск', nf(lastRep.dropStart.pct, 1) + ' %']
])}</table>
</div>
</div>

<h2>Исходные данные</h2>
<div class="two source">
<div><table>${rows([
  ['Тип механизма', loadName],
  ['Нагрузка', nf(state.loadPct, 0) + ' %'],
  ['J нагрузки', nf(+state.jExtra || 0, 2) + ' кг·м²'],
  ['Разгрузка на пуске', +state.loadUnload ? nf(state.loadUnload, 0) + ' %' : 'нет'],
  ['Среда двигателя', nf(m.tempAmbient, 0) + ' °C'],
  ['Пуск', m.hotStart ? tf('горячий, {p} %', { p: nf(m.hotPct, 0) }) : 'холодный'],
  ['Пусков в час', nf(m.startsPerHour, 0)],
  ['Класс перегрузки', m.overloadClass + ''],
  ['Охлаждение', nf(m.coolTau, 0) + ' мин'],
  ['Время моделирования', nf(state.sim.duration, 0) + ' с']
])}</table></div>
<div><table>${rows([
  ['Серия автомата', brkSeries || '—'],
  ['Уставка реле', nf(lastRep.relay.set, 1) + ' А'],
  ['Вышестоящий', b.upstream ? nf(b.upstream, 0) + ' А' : 'не задан'],
  ['Стандарт кабеля', cableStd],
  ['Изоляция', cableIns],
  ['Способ прокладки', cableLay],
  ['Среда кабеля', nf(c.ambient, 0) + ' °C'],
  ['Группировка', nf(state.cable.group, 0)],
  ['Smin по I²t', nf(lastRep.sc.sMin, 1) + ' мм²'],
  ['Длина', nf(c.length, 0) + ' м']
])}</table></div>
</div>

<h2>Проверки</h2>
<div class="two checks">
  <div>${chkTable(chkRows.slice(0, chkHalf))}</div>
  <div>${chkTable(chkRows.slice(chkHalf))}</div>
</div>

${hasChars ? `
<h2>Характеристики</h2>
<div class="grid chars">
${staticFigs.map(f => `<figure${f.power ? ' class="power"' : ''}><h3>${f.title}</h3>${f.html}</figure>`).join('')}
</div>` : ''}
${hasTrans ? `
<h2>Переходные процессы (пуск)</h2>
<div class="grid transients">
${transFigs.map(f => `<figure><h3>${f.title}</h3><img src="${f.src}" alt=""></figure>`).join('')}
</div>` : ''}
${hasVtc ? `
<section class="vtc">
<h2>ВТХ: защита и пуск</h2>
<figure><h3>${t('Время-токовая характеристика')}</h3><img src="${vtcImg}" alt=""></figure>
</section>` : ''}
${noCharts ? `<p class="hint">${t('Графики не выбраны для экспорта.')}</p>` : ''}
<div class="note">Расчёт носит справочный характер. Каталожные данные — серия АИР; для ответственных приводов проверьте параметры по паспортам и проектной документации. Сформировано в «Асинхронный двигатель — инженерный расчёт» · v0.12.1.<br>Для PDF без колонтитулов используйте настольную версию или отключите «Верхние и нижние колонтитулы» в диалоге печати.<br>Сделано с помощью <b>DeepSeek</b> · идейный вдохновитель — <b>Виктор Ханас</b> · <a href="mailto:khanas.viktor@gmail.com">khanas.viktor@gmail.com</a></div>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},350);});<\/script>
</body></html>`;
    /* настольная версия: отчёт сразу сохраняется в PDF через системный диалог */
    if (window.MC_BRIDGE && window.MC_BRIDGE.isShell) {
      const name = 'motor-report-' + new Date().toISOString().slice(0, 10) + '.pdf';
      window.MC_BRIDGE.printReport(html, name).then(r => {
        if (r && r.ok) setStatus(tf('PDF сохранён: {p}', { p: r.path || name }), 'ok');
        else if (r && r.canceled) setStatus(t('сохранение отменено'), 'ok');
        else if (r && r.error) setStatus(tf('не удалось сохранить PDF: {e}', { e: r.error }), 'bad');
      });
      return;
    }

    const w = window.open('', '_blank');
    if (!w) { window.print(); return; }
    w.document.open();
    w.document.write(html);
    w.document.close();
    if (I18N.isEn() && w.document.body) {
      w.document.documentElement.setAttribute('lang', 'en');
      w.document.title = tf('Отчёт — {name}', { name: m.catalog ? m.catalog.type : t('асинхронный двигатель') });
      I18N.translateDom(w.document.body);
    }
  }

  /* ---------- рендер ---------- */
  function render(rep) {
    renderKpis(rep);
    renderVerdict(rep);
    renderMotorPanel(rep);
    updateJExtraHint(rep);
    renderStartPanel(rep);
    renderProtectPanel(rep);
    renderCablePanel(rep);
    renderPoint(rep);
    renderThermal(rep);
    renderWarnings(rep);
    renderCharts(rep);
    if (state.tab === 'cable') renderCableTab(rep);
    renderVariants();
    updateLoadbar();
    $('#tagMode').textContent = t(({ catalog: 'база', power: 'P₂', current: 'I', torque: 'M' })[rep.motor.mode] || '—');
    $('#tagStart').textContent = methodShort(state.startMethod);
    decorateTips();
    if (state.tab === 'cable') drawVTC(rep);
    if (I18N.isEn()) I18N.translateDom(document.body);
  }

  function kpi(label, value, unit, sub, color) {
    const tip = RESULT_TIPS[label] ? ` data-tip="res:${label}"` : '';
    return `<div class="kpi" style="--kc:${color || 'var(--mint)'}">
      <div class="kpi-label"${tip}>${label}</div>
      <div class="kpi-value">${value}<span class="u">${unit || ''}</span></div>
      <div class="kpi-sub">${sub || ''}</div>
    </div>`;
  }

  function renderKpis(rep) {
    const m = rep.motor;
    const est = m.phases === 1 && m.p2 > 7.5;
    $('#kpis').innerHTML =
      kpi('Мощность P₂' + (est ? ' <span class="est-badge">оценка</span>' : ''), nf(m.p2, 2), 'кВт', est ? 'типовые данные ограничены 7,5 кВт' : 'P₁ ' + nf(m.p1, 2) + ' кВт', C.mint) +
      kpi('Номинальный ток', nf(m.i, 1), 'А', 'Iп ' + nf(m.ist, 0) + ' А', C.blue) +
      kpi('Момент Mн', nf(m.mn, 1), 'Н·м', 'Mmax ' + nf(m.mmaxAbs, 0) + ' Н·м', C.violet) +
      kpi('Скорость', nf(m.n, 0), 'об/мин', 's ' + nf(m.sn * 100, 2) + '%', C.cyan) +
      kpi('КПД', nf(m.eff, 1), '%', 'потери ' + nf(m.pLoss * 1000, 0) + ' Вт', C.amber) +
      kpi('cosφ', nf(m.cos, 3), '', 'S ' + nf(m.p1 / m.cos, 1) + ' кВ·А', C.pink);
  }

  function renderVerdict(rep) {
    const m = rep.motor, c = rep.cable, b = rep.breaker;
    const name = m.catalog ? m.catalog.type : 'Двигатель ' + nf(m.p2, 1) + ' кВт';
    const motorHot = rep.op.temp > rep.motor.tempLimit;
    const motorWarm = rep.op.temp > rep.motor.tempLimit - 25;
    const th = thermalStart(rep);
    const bad = !rep.checks.cable || !rep.checks.breakerCable || rep.op.stalled || !rep.checks.startDrop || th.level === 'bad' || th.incomplete || motorHot;
    const warn = !rep.checks.drop || !rep.checks.breakerMag || th.level === 'warn' || motorWarm;
    const stateTxt = bad ? '<span class="bad">✕ есть замечания</span>' : warn ? '<span class="warn">! проверьте условия</span>' : '<span class="ok">✓ проверки пройдены</span>';
    $('#verdict').innerHTML = `
      <b>${name}</b><span class="sep"></span>
      <span>P₂ <b>${nf(m.p2, 1)}</b> кВт · ${nf(m.U, 0)} В · Iн <b>${nf(m.i, 1)}</b> А</span><span class="sep"></span>
      <span>${t('автомат')} <b>${nf(b.In, 0)}</b> ${t('А')}${m.phases === 1 ? ' · 1P' : ''}${b.type === 'mccb' ? ' · MCCB ' + b.mag + '×' + t('Iн') : ' (' + b.curve + ')'}</span><span class="sep"></span>
      <span>${t('кабель')} <b>${c.parallel > 1 ? c.parallel + ' × ' : ''}${nf(c.section, 1)}</b> ${t('мм²')} ${c.material === 'al' ? 'Al' : 'Cu'} · PE ${c.parallel > 1 ? c.parallel + ' × ' : ''}${nf(c.pe, 1)}</span><span class="sep"></span>
      <span>ΔU <b>${nf(rep.drop.pct, 2)}</b> %</span>
      <span style="margin-left:auto">${stateTxt}</span>
      <button class="mini" data-act="remember" title="Сохранить вариант для сравнения">+ вариант</button>`;
  }

  function kv(label, value, unit, cls) {
    const tip = RESULT_TIPS[label] ? ` data-tip="res:${label}"` : '';
    return `<div class="kv-row"><span class="kv-label"${tip}>${label}</span><span class="kv-value ${cls || ''}">${value}${unit ? `<span class="u">${unit}</span>` : ''}</span></div>`;
  }

  /* J нагрузки в долях от инерции ротора: так видно, «тяжёлый» ли маховик.
     Раньше 0,3 кг·м² по умолчанию для двигателя 7,5 кВт молча растягивало пуск
     в 7 раз — теперь отношение показано рядом с полем. */
  function jExtraRatio(rep) {
    const jm = rep && rep.motor ? rep.motor.j : 0;
    const jx = +state.jExtra || 0;
    if (!(jm > 0) || !(jx > 0)) return null;
    return jx / jm;
  }

  function updateJExtraHint(rep) {
    const el = $('#jExtraRatio');
    if (!el) return;
    const r = jExtraRatio(rep);
    if (r == null) {
      el.textContent = '';
      el.className = 'hint hint-ratio';
      return;
    }
    el.textContent = tf('= {r} × J ротора', { r: nf(r, r < 10 ? 1 : 0) });
    el.className = 'hint hint-ratio' + (r > 10 ? ' bad' : r > 5 ? ' warn' : '');
  }

  function renderMotorPanel(rep) {
    const m = rep.motor;
    const phaseU = m.phases === 1 ? m.U : (m.conn === 'D' ? m.U : m.U / Math.sqrt(3));
    $('#panelMotor').innerHTML = `<div class="kv">
      ${kv('Потребляемая мощность P₁', nf(m.p1, 2), 'кВт')}
      ${kv('Полная мощность S', nf(m.p1 / m.cos, 2), 'кВ·А')}
      ${kv('Реактивная мощность Q', nf(Math.sqrt(Math.max(Math.pow(m.p1 / m.cos, 2) - m.p1 * m.p1, 0)), 2), 'квар')}
      ${kv(m.phases === 1 ? 'Напряжение сети' : 'Фазное напряжение Uф', nf(phaseU, 0), 'В')}
      ${m.phases === 1 ? kv('Питание', '1 фаза, L/N', '') : kv('Схема обмоток', m.conn === 'D' ? 'Δ треугольник' : 'Y звезда', '')}
      ${kv('Число полюсов', m.poles + ' (p = ' + m.poles / 2 + ')', '')}
      ${kv('Синхронная скорость', nf(m.ns, 0), 'об/мин')}
      ${kv('Скольжение sн', nf(m.sn * 100, 2), '%')}
      ${kv('Частота в роторе f₂', nf(m.sn * m.f, 2), 'Гц')}
      ${kv('Момент инерции J', nf(m.j, 4), 'кг·м²')}
      ${kv('Критическое скольжение', nf(m.sm * 100, 1), '%')}
      ${kv('Класс изоляции', m.motorClass + ' · предел ' + m.tempLimit, '°C')}
      ${kv('Постоянная нагрева τ', nf(m.tauMin, 0), 'мин')}
    </div>`;
    $('#motorNote').textContent = t(m.note || '');
  }

  function methodShort(v) {
    return ({ dol: 'DOL', yd: 'Y→Δ', soft: 'Soft', vfd: 'VFD', autotr: 'AT' })[v] || v;
  }
  function methodLabel(v) {
    return ({ dol: 'Прямой пуск (DOL)', yd: 'Звезда → треугольник', soft: 'Софтстартер', vfd: 'Частотный привод', autotr: 'Автотрансформатор' })[v] || v;
  }

  function renderStartPanel(rep) {
    const m = rep.motor;
    const cmp = (compareData || []).find(x => x.method === state.startMethod);
    const tStart = cmp && cmp.tStart != null ? nf(cmp.tStart, 2) + ' с' : (cmp ? 'не выходит на скорость' : '—');
    const ratio = cmp ? tf(' / {v}×Iн', { v: nf(cmp.peakI / m.i, 1) }) : '';
    $('#panelStart').innerHTML = `<div class="kv">
      ${kv('Пусковой ток Iп', nf(m.ist, 1), tf('А ({k}×Iн)', { k: nf(m.kst, 1) }))}
      ${kv('Пусковой момент Mп', nf(m.mstAbs, 1), tf('Н·м ({k}×Mн)', { k: nf(m.mst, 2) }))}
      ${kv('Максимальный момент', nf(m.mmaxReal.t, 1), tf('Н·м ({k}×Mн)', { k: nf(m.mmaxReal.t / m.mn, 2) }))}
      ${kv('Момент при выбранном пуске', cmp ? nf(cmp.peakT, 0) : '—', cmp ? 'Н·м' : '')}
      ${kv('Пиковый ток пуска (с линией)', cmp ? nf(cmp.peakI, 0) : '—', cmp ? t('А') + ratio : '')}
      ${kv('Разгон', tStart, '')}
      ${kv('Пусковая мощность Sп', nf((m.phases === 3 ? Math.sqrt(3) : 1) * m.U * m.ist / 1000, 1), 'кВ·А')}
      ${kv('Инерция привода J∑', nf(m.j + (+state.jExtra || 0), 4), 'кг·м²')}
      ${kv('Способ пуска', methodLabel(state.startMethod), '')}
      ${kv('Способ задания', t(m.mode === 'catalog' ? 'каталог АИР' : m.mode === 'current' ? 'по току' : m.mode === 'torque' ? 'по моменту' : 'по мощности'), '')}
    </div>
    <div class="note-line">${t(startAdvice(m))}</div>
    ${cmp && cmp.tStart == null ? `<div class="note-line bad" style="color:var(--pink)">${t(startDiagnosis(rep, cmp))}</div>` : ''}`;
    if (I18N.isEn()) I18N.translateDom(document.body);
  }

  function startDiagnosis(rep, cmp) {
    const m = rep.motor;
    if (m.catalog && m.phases === 3 && m.connFactor < 0.99) {
      return 'Причина: схема Y при 380 В для 380/660 снижает момент примерно в 3 раза. Переключите обмотки на Δ и повторите расчёт.';
    }
    if (state.loadType === 'constpower') {
      return 'Причина: постоянная мощность — момент при нулевой скорости стремится к бесконечности. Нужна разгрузка/сцепление или ПЧ с разгрузкой.';
    }
    const load0 = E.loadTorque(m, 0.05 * m.n, buildCfg().load);
    if (cmp && cmp.peakT < load0) {
      return 'Причина: пусковой момент меньше момента нагрузки уже на малой скорости. Уменьшите нагрузку, добавьте разгрузку или выберите другой способ пуска.';
    }
    if (+state.loadPct > 100) {
      return 'Причина: нагрузка выше номинальной; двигатель не дотягивает до рабочей точки. Проверьте запас по моменту.';
    }
    return 'Причина: двигатель не выходит на рабочую скорость. Проверьте момент нагрузки, схему обмоток и способ пуска.';
  }

  function startAdvice(m) {
    if (m.phases === 1) {
      if (m.p2 <= 1.5) return 'Однофазный: прямой пуск с пусковой обмоткой/конденсатором; для регулирования — частотный привод.';
      return 'Однофазный: проверьте пусковой ток и сечение; при частых пусках — частотный привод.';
    }
    if (m.catalog && m.phases === 3 && m.connFactor < 0.99) {
      return 'Схема Y при 380 В для двигателя 380/660 снижает момент примерно в 3 раза. Переключите на Δ; после этого проверьте пуск.';
    }
    if (state.loadType === 'constpower') {
      return 'Постоянная мощность: при нулевой скорости момент стремится к бесконечности. Прямой пуск, Y–Δ и автотрансформатор не подходят; нужна разгрузка/сцепление или ПЧ с разгрузкой и запасом по моменту.';
    }
    if (state.loadType === 'constant' && +state.loadPct > (m.mst / 3) * 100) {
      return 'Нагрузка выше пускового момента в звезде (Mп/3): Y–Δ и автотрансформатор не разгонят. Нужен прямой пуск, софтстартер или ПЧ с проверкой момента.';
    }
    if (m.p2 <= 4) return 'Рекомендация: прямой пуск допустим — пусковой ток невелик, сеть обычно выдерживает.';
    if (m.p2 <= 15) return 'Рекомендация: прямой пуск или «звезда–треугольник»; при частых пусках — софтстартер.';
    if (m.p2 <= 45) return 'Рекомендация: «звезда–треугольник», софтстартер или частотный привод — прямой пуск даёт большой бросок тока.';
    return 'Рекомендация: частотный привод или софтстартер с ограничением тока; прямой пуск требует отдельной проверки сети.';
  }

  function drawVTC(rep) {
    const cv = $('#chartVTC');
    if (!cv || !rep) return;
    const dpr = window.devicePixelRatio || 1;
    // Размер берём у самого canvas: его задаёт CSS (.chart-box.vtc-box), а не
    // атрибуты. Раньше высота считалась от ширины и canvas вылезал за панель,
    // наезжая на «Проверку условий».
    const W = cv.clientWidth || 640;
    const H = cv.clientHeight || 300;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const cs = getComputedStyle(document.documentElement);
    const col = n => cs.getPropertyValue(n).trim();
    const C = {
      line: col('--line') || '#2a3a4a', text: col('--muted') || '#7f8c9a', soft: col('--text-soft') || '#aab6c2',
      mint: col('--mint') || '#3ddc97', red: col('--red') || '#ff6b6b', blue: col('--blue') || '#59a9ff',
      amber: col('--amber') || '#ffb454', violet: col('--violet') || '#a78bfa'
    };
    const b = rep.breaker, s = MC.vtc.get(b.series || state.breakerSeries), In = b.In;
    const curve = b.curve && s.curves.includes(b.curve) ? b.curve : s.curves[0];
    const mag = s.mag[curve] || [10, 10];
    const Istart = rep.iStart || rep.motor.ist;
    const cmp = (compareData || []).find(x => x.method === state.startMethod);
    const pending = !cmp;
    const hasStart = !!(cmp && cmp.tStart != null);
    const tS = hasStart ? cmp.tStart : null;
    /* Без времени пуска нет и действующего тока: пик вместо Ieq даёт ложный вердикт. */
    const Ieq = hasStart && cmp.ieq ? cmp.ieq : null;
    const trip = Ieq != null ? MC.vtc.thermalTripTime(s, curve, In, Ieq) : null;
    const ratio = (trip != null && tS != null && tS > 0) ? trip / tS : null;
    const level = ratio == null ? null : ratio <= 1 ? 'bad' : ratio <= 2 ? 'warn' : 'ok';
    const stalled = !!(cmp && cmp.stalled && !hasStart);
    const incomplete = !pending && !hasStart;
    const duration = (cmp && cmp.duration) || 25;
    const up = +state.upstreamIn;
    const pad = { l: 58, r: 18, t: 96, b: 34 };
    const ymin = 0.01, ymax = 100000;
    /* ось токов — по данным: от декады ниже ~Iн/4 до декады выше отсечки и пуска */
    const xmin = Math.max(0.5, Math.pow(10, Math.floor(Math.log10(Math.max(In / 4, 1)))));
    const topI = Math.max(mag[1] * In, Istart * 1.6, up * 1.2, In * 4);
    const xmax = Math.pow(10, Math.min(5, Math.max(Math.ceil(Math.log10(xmin)) + 1, Math.ceil(Math.log10(topI)))));
    /* Оси логарифмические: обрезаем и ток, и время по краям поля, иначе
       пунктир кабеля уходит за правую/верхнюю границу canvas. */
    const X = I => {
      const v = Math.max(xmin, Math.min(xmax, I));
      return pad.l + (Math.log10(v) - Math.log10(xmin)) / (Math.log10(xmax) - Math.log10(xmin)) * (W - pad.l - pad.r);
    };
    const Y = tv => {
      const v = Math.max(ymin, Math.min(ymax, tv));
      return pad.t + (Math.log10(ymax) - Math.log10(v)) / (Math.log10(ymax) - Math.log10(ymin)) * (H - pad.t - pad.b);
    };
    const line = (pts, color, width, dash) => {
      if (!pts.length) return;
      g.save(); g.strokeStyle = color; g.lineWidth = width || 1.6; g.setLineDash(dash || []); g.beginPath();
      pts.forEach((p, i) => { const x = X(p[0]), y = Y(p[1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke(); g.restore();
    };
    // сетка и подписи
    g.font = '10px ui-monospace, monospace'; g.fillStyle = C.text; g.strokeStyle = C.line; g.lineWidth = 1;
    for (let d = xmin; d <= xmax + 1e-9; d *= 10) {
      const x = X(d); g.globalAlpha = .35; g.beginPath(); g.moveTo(x, pad.t); g.lineTo(x, H - pad.b); g.stroke(); g.globalAlpha = 1;
      g.textAlign = 'center'; g.fillText(d >= 1000 ? (d / 1000) + t('к') : d, x, H - 14);
    }
    for (const tt of [0.01, 0.1, 1, 10, 100, 1000, 10000, 100000]) {
      const y = Y(tt); g.globalAlpha = .35; g.beginPath(); g.moveTo(pad.l, y); g.lineTo(W - pad.r, y); g.stroke(); g.globalAlpha = 1;
      g.textAlign = 'right'; g.fillText(tt >= 1000 ? (tt / 1000) + t('к') : tt, pad.l - 6, y + 3);
    }
    g.textAlign = 'left'; g.fillStyle = C.soft; g.fillText(t('I, А'), W - pad.r - 30, H - 2);
    g.fillText(t('t, с'), pad.l - 44, pad.t - 8);
    // тепловая зона выбранного автомата
    const pts = MC.vtc.thermalPoints(s, curve, In);
    line(pts, C.amber, 2.2);
    g.save(); g.globalAlpha = .10; g.fillStyle = C.amber; g.beginPath();
    pts.forEach((p, i) => { const x = X(p[0]), y = Y(p[1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.lineTo(X(pts[pts.length - 1][0]), H - pad.b); g.lineTo(X(pts[0][0]), H - pad.b); g.closePath(); g.fill(); g.restore();
    // отсечка
    g.save(); g.strokeStyle = C.red; g.lineWidth = 1.4; g.setLineDash([4, 3]);
    [mag[0] * In, mag[1] * In].forEach(I => { g.beginPath(); g.moveTo(X(I), Y(0.02)); g.lineTo(X(I), Y(100000)); g.stroke(); });
    g.restore();
    // вышестоящий
    if (up > 0) {
      const upS = MC.vtc.get(state.breakerSeries);
      const upCurve = upS.curves.includes(state.curve) ? state.curve : upS.curves[0];
      line(MC.vtc.thermalPoints(upS, upCurve, up), C.violet, 1.5, [6, 4]);
    }
    // кабель: адиабатическая стойкость
    const k = state.cable.insulation === 'xlpe' ? 143 : 115;
    const S = rep.cable.section;
    line([[1, k * k * S * S / 1], [100000, k * k * S * S / 100000]], C.blue, 1.4, [2, 4]);
    // пуск: точку ставим только при реально завершённом пуске
    const dot = level === 'bad' || incomplete ? C.red : level === 'warn' ? C.amber : C.mint;
    let startTxt = '';
    if (hasStart) {
      const ty = Y(Math.max(tS, 0.02));
      const eqDiff = Ieq != null && Math.abs(Ieq - Istart) / Math.max(Istart, 1) > 0.03;
      g.save(); g.fillStyle = dot; g.beginPath(); g.arc(X(Istart), ty, 4.5, 0, Math.PI * 2); g.fill();
      if (eqDiff) {
        /* второй маркер: действующий ток пуска — по нему и считается нагрев */
        g.strokeStyle = dot; g.lineWidth = 1.4; g.globalAlpha = .9;
        g.beginPath(); g.arc(X(Ieq), ty, 3.8, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
        g.beginPath(); g.setLineDash([1, 2]); g.moveTo(X(Ieq), ty); g.lineTo(X(Istart), ty); g.stroke(); g.setLineDash([]);
      }
      if (trip != null) { g.globalAlpha = .55; g.strokeStyle = dot; g.lineWidth = 1; g.setLineDash([2, 2]); g.beginPath(); g.moveTo(X(Ieq), ty); g.lineTo(X(Ieq), Y(Math.max(trip, 0.02))); g.stroke(); g.restore(); g.save(); }
      g.font = '10px ui-monospace, monospace'; g.fillStyle = dot; g.textAlign = 'left';
      const peakTxt = tf('Iп {i} А · {t} с', { i: nf(Istart, 0), t: nf(tS, 2) });
      const peakW = g.measureText(peakTxt).width;
      const ptx = X(Istart) + 7 + peakW > W - pad.r ? Math.max(pad.l + 8, X(Istart) - 7 - peakW) : X(Istart) + 7;
      g.fillText(peakTxt, ptx, ty - 10);
      if (eqDiff) {
        const eqTxt = tf('Iэкв {ieq} А', { ieq: nf(Ieq, 0) });
        g.fillText(eqTxt, Math.max(pad.l + 8, X(Ieq) - 9 - g.measureText(eqTxt).width), ty - 10);
      }
      if (trip != null) {
        const trTxt = tf('tср {tr} с', { tr: nf(Math.max(trip, 0.02), 2) });
        const trW = g.measureText(trTxt).width;
        g.fillText(trTxt, Math.min(W - pad.r - trW - 4, X(Ieq) + 7), Y(Math.max(trip, 0.02)) - 6);
      }
      g.restore();
    } else {
      g.save(); g.strokeStyle = C.red; g.lineWidth = 1.3; g.setLineDash([5, 4]);
      g.beginPath(); g.moveTo(X(Istart), pad.t); g.lineTo(X(Istart), H - pad.b); g.stroke();
      g.setLineDash([]); g.font = '10px ui-monospace, monospace'; g.fillStyle = C.red; g.textAlign = 'left';
      startTxt = stalled
        ? tf('пуск {i} А · не разгоняется', { i: nf(Istart, 0) })
        : pending
          ? t('расчёт пуска…')
          : tf('пуск {i} А · за {d} с не вышел на скорость', { i: nf(Istart, 0), d: nf(duration, 0) });
      g.fillText(startTxt, pad.l + 8, pad.t + 42);
      g.restore();
    }

    // легенда — отдельной полосой над полем графика
    const sec = rep.cable.section;
    const leg = [
      { kind: 'line', label: tf('Автомат {b} {s} {i} А', { b: s.brand, s: s.series, i: In }), color: C.amber },
      { kind: 'dash', label: mag[0] !== mag[1]
        ? tf('Отсечка {a}…{b} А', { a: nf(mag[0] * In, 0), b: nf(mag[1] * In, 0) })
        : tf('Отсечка {a} А', { a: nf(mag[0] * In, 0) }), color: C.red },
      { kind: 'dash', label: tf('Кабель {s} мм²', { s: nf(sec, 1) }), color: C.blue }
    ];
    if (up > 0) leg.push({ kind: 'dash', label: t('Вышестоящий'), color: C.violet });
    if (hasStart) {
      leg.push({ kind: 'dot', label: t('Пик пуска Iп'), color: dot });
      if (Ieq != null && Math.abs(Ieq - Istart) / Math.max(Istart, 1) > 0.03) leg.push({ kind: 'circle', label: t('Эквивалентный ток Iэкв'), color: dot });
      if (trip != null) leg.push({ kind: 'vline', label: t('Время срабатывания tср'), color: dot });
    }
    g.font = '10px -apple-system, sans-serif'; let lx = pad.l + 8, ly = 18;
    leg.forEach(item => {
      const tw = g.measureText(item.label).width + 30;
      if (lx + tw > W - pad.r) { lx = pad.l + 8; ly += 17; }
      g.save(); g.strokeStyle = item.color; g.fillStyle = item.color; g.lineWidth = 1.4;
      if (item.kind === 'line') { g.beginPath(); g.moveTo(lx, ly - 3); g.lineTo(lx + 10, ly - 3); g.stroke(); }
      else if (item.kind === 'dash') { g.setLineDash([4, 3]); g.beginPath(); g.moveTo(lx, ly - 3); g.lineTo(lx + 10, ly - 3); g.stroke(); }
      else if (item.kind === 'dot') { g.beginPath(); g.arc(lx + 5, ly - 3, 3.5, 0, Math.PI * 2); g.fill(); }
      else if (item.kind === 'circle') { g.beginPath(); g.arc(lx + 5, ly - 3, 3.5, 0, Math.PI * 2); g.stroke(); }
      else if (item.kind === 'vline') { g.setLineDash([2, 2]); g.beginPath(); g.moveTo(lx + 5, ly - 10); g.lineTo(lx + 5, ly + 2); g.stroke(); }
      g.setLineDash([]); g.fillStyle = C.soft; g.fillText(item.label, lx + 14, ly);
      g.restore();
      lx += tw;
    });
    const selBad = b.upstream && !b.okSel;
    let tagTxt, tagCls;
    if (!rep.checks.breakerMag) { tagTxt = t('отсечка на пуске'); tagCls = 'bad'; }
    else if (pending) { tagTxt = t('расчёт пуска…'); tagCls = 'warn'; }
    else if (stalled) { tagTxt = t('пуск не разгоняется'); tagCls = 'bad'; }
    else if (incomplete) { tagTxt = tf('пуск не завершён за {d} с', { d: nf(duration, 0) }); tagCls = 'bad'; }
    else if (level === 'bad') { tagTxt = t('пуск вне тепловой зоны'); tagCls = 'bad'; }
    else if (selBad) { tagTxt = t('селективность недостаточна'); tagCls = 'warn'; }
    else if (level === 'warn') { tagTxt = t('пуск на границе тепловой зоны'); tagCls = 'warn'; }
    else if (level == null) { tagTxt = t('нет данных пуска'); tagCls = 'warn'; }
    else { tagTxt = t('пуск проходит'); tagCls = 'ok'; }
    $('#tagVTC').textContent = tagTxt;
    $('#tagVTC').className = 'panel-tag ' + tagCls;
    const selTxt = b.upstream ? ' ' + tf('Селективность {r}× {ok}.', { r: nf(b.selRatio, 1), ok: b.okSel ? t('обеспечена') : t('недостаточна') }) : '';
    const bandTxt = mag[0] !== mag[1] ? ' ' + tf('Зона отсечки {a}…{b} А.', { a: nf(mag[0] * In, 0), b: nf(mag[1] * In, 0) }) : '';
    const eqDiffTxt = Ieq != null && Math.abs(Ieq - Istart) / Math.max(Istart, 1) > 0.03;
    const thermTxt = (trip != null && tS != null)
      ? ' ' + (eqDiffTxt
        ? tf('Тепловая зона: действующий ток пуска {ieq} А (пик {i} А), автомат {tr} с против пуска {ts} с.', { ieq: nf(Ieq, 0), i: nf(Istart, 0), tr: nf(Math.max(trip, 0.02), 2), ts: nf(tS, 2) })
        : tf('Тепловая зона при {i} А: {tr} с, пуск {ts} с.', { i: nf(Istart, 0), tr: nf(Math.max(trip, 0.02), 2), ts: nf(tS, 2) }))
      : '';
    const incompTxt = stalled
      ? ' ' + tf('Тепловая зона не проверена: пуск не разгоняется (конечная скорость {n} об/мин).', { n: nf(cmp && cmp.nEnd, 0) })
      : incomplete
        ? ' ' + tf('Тепловая зона не проверена: пуск не завершён за {d} с (конечная скорость {n} об/мин).', { d: nf(duration, 0), n: nf(cmp && cmp.nEnd, 0) })
        : pending ? ' ' + t('Тепловая зона: расчёт пуска…') : '';
    $('#vtcFoot').textContent = tf('Серия {b} {s}, {i} А, {type}. Пик пуска {peak} А; отсечка {mag} А.{sel}', {
      b: s.brand, s: s.series, i: In,
      type: s.type === 'mccb' ? 'MCCB' : tf('кривая {c}', { c: curve }),
      peak: nf(Istart, 0), mag: nf(b.magTrip, 0), sel: selTxt
    }) + bandTxt + thermTxt + incompTxt;
    fillChartTable('dataVTC', [t('I, А'), t('I/Iн'), t('t, с')], pts.map(p => [nf(p[0], 0), nf(p[0] / In, 2), nf(p[1], 3)]));
    if (I18N.isEn()) I18N.translateDom(document.body);
  }

  function renderProtectPanel(rep) {
    const m = rep.motor;
    const b = rep.breaker, r = rep.relay, c = rep.contactor, f = rep.fuse;
    const ok = rep.checks.breakerCurrent && rep.checks.breakerCable && rep.checks.breakerMag;
    $('#tagProtect').textContent = ok ? 'согласовано' : 'проверить';
    $('#tagProtect').className = 'panel-tag ' + (ok ? 'ok' : 'bad');
    $('#panelProtect').innerHTML = `<div class="kv">
      ${kv('Автоматический выключатель', nf(b.In, 0), t('А') + ' · ' + (m.phases === 1 ? '1P · ' : '') + (b.type === 'mccb' ? 'MCCB · ' + b.mag + '×' + t('Iн') : 'MCB · ' + tf('кривая {c}', { c: b.curve })))}
      ${kv('Ток отсечки (мин.)', nf(b.magTrip, 0), tf('А  ({k}×Iн)', { k: b.mag }))}
      ${kv('Расчётный ток пуска', nf(rep.iStart, 0), 'А · ' + methodShort(state.startMethod), !rep.checks.breakerMag ? 'bad' : '')}
      ${kv('Отключающая способность', nf(b.icu, 0), 'кА')}
      ${kv('Селективность', b.upstream ? nf(b.selRatio, 1) + '×' : 'не задана', b.upstream ? (b.okSel ? 'обеспечена' : 'недостаточна') : '', b.upstream && !b.okSel ? 'bad' : '')}
      ${kv('Тепловое реле', nf(r.lo, r.lo % 1 ? 1 : 0) + '…' + nf(r.hi, r.hi % 1 ? 1 : 0), 'А · уставка ' + nf(r.set, 1))}
      ${kv('Контактор ' + (m.phases === 1 ? '1P/2P' : 'AC-3'), nf(c.i, 0), m.phases === 1 ? 'А' : 'А · ' + nf(c.kw, 1) + ' кВт')}
      ${kv('Предохранитель aM', nf(f, 0), 'А')}
      ${kv('УЗО (рекомендация)', (m.phases === 1 ? '2P · ' : '') + (state.startMethod === 'vfd' ? 'тип B' : 'тип A'), b.In <= 63 ? '30 мА' : b.In <= 250 ? '100 мА' : '300 мА')}
      ${kv('Серия', (b.brand || '') + ' ' + (b.seriesName || ''), '')}
    </div>`;
  }

  function renderCablePanel(rep) {
    const c = rep.cable;
    const d = rep.drop;
    const multi = c.parallel > 1;
    const lineLoss = (rep.motor.phases === 3 ? 3 : 2) * rep.op.I * rep.op.I * d.R;
    const ok = rep.checks.cable && rep.checks.drop && rep.checks.startDrop;
    $('#tagCable').textContent = ok ? 'норма' : 'проверить';
    $('#tagCable').className = 'panel-tag ' + (ok ? 'ok' : 'bad');
    $('#panelCable').innerHTML = `<div class="kv">
      ${kv('Сечение фазных жил', (multi ? c.parallel + ' × ' : '') + nf(c.section, 1), tf('мм²  {m}', { m: c.material === 'al' ? 'Al' : 'Cu' }))}
      ${kv('Сечение PE', (multi ? c.parallel + ' × ' : '') + nf(c.pe, 1), 'мм²')}
      ${kv('Ток на один кабель', nf(c.allowPer, 1), 'А')}
      ${kv('Суммарный допустимый', nf(c.allow, 1), tf('А  (k = {k})', { k: nf(c.k, 2) }))}
      ${kv('Нагруженных жил', c.loaded, c.loaded === 2 ? 'L + N' : '3 фазы')}
      ${kv('Падение напряжения', nf(d.pct, 2), '% · ' + nf(d.dU, 1) + ' В', d.pct > +state.dropLimit ? 'bad' : 'accent')}
      ${kv('Просадка при пуске', nf(rep.dropStart.pct, 1), '%', !rep.checks.startDrop ? 'bad' : rep.dropStart.pct > 10 ? 'warn' : '')}
      ${kv('Потери в линии', nf(lineLoss, 0), 'Вт')}
      ${kv('Эквивалентное R', nf(d.R, 4), 'Ом')}
      ${kv('Эквивалентное X', nf(d.X, 4), 'Ом')}
    </div>`;
  }

  function renderThermal(rep) {
    const m = rep.motor, op = rep.op;
    if (!$('#thermalTag')) return;
    const warm = op.tempStart > m.tempAmbient + 0.5;
    $('#thermalTag').textContent = warm ? 'горячий' : 'холодный';
    $('#thermalTag').className = 'panel-tag ' + (warm ? 'warn' : 'ok');
    const lim = isFinite(op.timeToLimit) ? 'до предела ' + nf(op.timeToLimit, 0) + ' мин' : 'предел не достигается';
    $('#thermalFoot').innerHTML = 'Начальная <b>' + nf(op.tempStart || m.tempAmbient, 0) + ' °C</b> · установившаяся <b>' + nf(op.temp, 0) + ' °C</b> · предел ' + m.tempLimit + ' °C · ' + lim +
      '. Класс ' + m.overloadClass + ' · пусков/час ' + m.startsPerHour + ' · охлаждение ' + m.coolTau + ' мин.';
  }

  function renderPoint(rep) {
    const op = rep.op;
    const m = rep.motor;
    const loadClass = op.loadPct > 105 ? 'bad' : op.loadPct > 95 ? 'warn' : 'accent';
    const items = [
      ['Момент', nf(op.T, 1), 'Н·м', ''],
      ['Мощность P₂', nf(op.p2, 2), 'кВт', ''],
      ['Ток', nf(op.I, 1), 'А', op.I > rep.motor.i * 1.05 ? 'warn' : 'accent'],
      ['Скорость', nf(op.n, 0), 'об/мин', ''],
      ['Скольжение', nf(op.slipPct, 2), '%', ''],
      ['cosφ', nf(op.cos, 3), '', ''],
      ['КПД', nf(op.eta, 1), '%', ''],
      ['U двигателя', nf(op.U, 1), 'В', op.dUpt > +state.dropLimit ? 'warn' : '']
    ];
    const pct = Math.min(150, op.loadPct);
    const gcls = pct > 105 ? 'bad' : pct > 95 ? 'warn' : '';
    $('#panelPoint').innerHTML = `
      <div class="point-grid">
        ${items.map(i => `<div class="point-item ${i[3]}"><div class="pl">${i[0]}</div><div class="pv">${i[1]}<span class="u">${i[2]}</span></div></div>`).join('')}
      </div>
      <div class="gauge"><div class="gauge-fill ${gcls}" style="width:${pct / 1.5}%"></div></div>
      <div class="gauge-legend">
        <span>0 %</span><span>нагрузка по моменту: <b style="color:var(--text)">${nf(op.loadPct, 0)} %</b></span><span>150 %</span>
      </div>
      <div class="gauge-legend" style="margin-top:7px">
        <span>нагрев обмотки <b style="color:var(--text)">${nf(op.temp, 0)} °C</b></span>
        <span>предел класса ${m.motorClass}: ${m.tempLimit} °C</span>
        <span>${op.timeToLimit < Infinity ? `<b style="color:var(--pink)">до предела ≈ ${nf(op.timeToLimit, 0)} мин</b>` : `<b style="color:var(--mint)">запас ${nf(m.tempLimit - op.temp, 0)} °C</b>`}</span>
      </div>`;
  }

  function renderWarnings(rep) {
    const m = rep.motor, c = rep.cable, op = rep.op, ch = rep.checks;
    const w = [];
    const add = (kind, text) => w.push({ kind, text });
    if (m.phases === 1) {
      const tn = { capacitor: 'конденсаторный', split: 'с расщеплённой фазой', psc: 'PSC' }[m.motor1phType] || 'конденсаторный';
      add('ok', `Однофазный режим: I = P₁/(U·cosφ), кабель 2-жильный (L + N), автомат 1P. Типовые данные — ${tn}.`);
      if (m.p2 > 7.5) add('warn', tf('Однофазный двигатель {p} кВт — редкий случай: типовые данные до 11 кВт ориентировочные, выше — оценка. Для такой мощности обычно применяют 3 фазы или специальный двигатель.', { p: nf(m.p2, 1) }));
      if (state.voltage < 200 || state.voltage > 260) add('warn', tf('Для однофазного двигателя напряжение {u} В необычно — обычно 220/230 В. Проверьте данные.', { u: nf(state.voltage, 0) }));
    }
    const cat = state.mode === 'catalog' ? D.MOTOR_DB.find(x => x.type === state.catType) : null;
    if (state.loadType === 'constpower') {
      add('warn', 'Постоянная мощность: M = P/ω. При снижении скорости момент растёт к бесконечности; прямой пуск, Y–Δ и автотрансформатор без разгрузки/сцепления не разгонят. Для ПЧ тоже нужна разгрузка и запас по моменту.');
    }
    /* инерция нагрузки: слишком большой маховик затягивает пуск и тепловую проверку */
    const jr = jExtraRatio(rep);
    if (jr != null && jr > 10) {
      add('warn', tf('J нагрузки {j} кг·м² — это {r}× инерции ротора. Такой маховик растягивает пуск и греет обмотку; проверьте значение (для вентилятора это обычно 0,1…1 × J ротора).', {
        j: nf(+state.jExtra || 0, 2), r: nf(jr, 0)
      }));
    }
    if (cat && /380\/660/.test(cat.un) && state.voltage >= 360 && state.voltage <= 415 && m.conn === 'Y') {
      add('warn', `В каталоге выбран ${cat.type} (380/660 В), но схема Y при ${nf(state.voltage, 0)} В: на фазе 220 В. Момент и ток снижены примерно в ${(m.connFactor * m.connFactor).toFixed(2)} раза; для 380 В нужна Δ.`);
    }
    if (cat && cat.poles !== state.poles) {
      add('warn', `В каталоге выбран ${cat.type} (${cat.poles} полюса), а расчёт по току — для ${state.poles} полюсов. Это разные двигатели; проверьте полюса и тип.`);
    }

    const csec = (c.parallel > 1 ? c.parallel + ' × ' : '') + nf(c.section, 1) + ' мм²';
    const t1name = { capacitor: 'конденсаторный', split: 'с расщеплённой фазой', psc: 'PSC' }[m.motor1phType] || '';
    if (+c.length > 200) add('warn', tf('Линия {l} м — длинная. Проверьте падение напряжения и просадку при пуске; при необходимости увеличьте сечение, число кабелей или сократите линию.', { l: nf(c.length, 0) }));
    if (ch.cable) add('ok', `Сечение <b>${csec}</b> обеспечивает суммарный ток ${nf(c.allow, 1)} А ≥ ${nf(m.i, 1)} А с учётом поправок.`);
    else add('bad', `Сечение ${csec} недостаточно: суммарный допустимый ток ${nf(c.allow, 1)} А < ${nf(m.i, 1)} А. Увеличьте сечение, число кабелей или измените условия прокладки.`);
    if (c.dropLimited) add('warn', `Сечение увеличено относительно минимального по нагреву — с учётом ΔU (${nf(rep.drop.pct, 2)} % в работе, ${nf(rep.dropStart.pct, 1)} % при пуске).`);

    if (ch.drop) add('ok', `Падение напряжения ${nf(rep.drop.pct, 2)} % не превышает лимит ${nf(state.dropLimit, 1)} %.`);
    else add('warn', `Падение напряжения ${nf(rep.drop.pct, 2)} % выше лимита ${nf(state.dropLimit, 1)} %. Увеличьте сечение или сократите линию.`);

    if (ch.breakerCurrent && ch.breakerCable) add('ok', `Автомат ${nf(rep.breaker.In, 0)} А защищает кабель (${nf(c.allow, 1)} А) и пропускает рабочий ток.`);
    if (!ch.breakerCable) add('bad', `Номинал автомата ${nf(rep.breaker.In, 0)} А превышает допустимый ток кабеля ${nf(c.allow, 1)} А.`);
    if (!ch.breakerCurrent) add('bad', `Номинал автомата ${nf(rep.breaker.In, 0)} А ниже рабочего тока ${nf(m.i, 1)} А.`);

    if (ch.breakerMag) add('ok', `Отсечка автомата (${nf(rep.breaker.magTrip, 0)} А) выше расчётного пускового тока ${nf(rep.iStart, 0)} А для способа «${methodLabel(state.startMethod)}» — ложных срабатываний не будет.`);
    else add('bad', tf('Отсечка {m} А может сработать при пуске: расчётный ток для способа «{meth}» — {i} А. ', { m: nf(rep.breaker.magTrip, 0), meth: t(methodLabel(state.startMethod)), i: nf(rep.iStart, 0) }) + t(state.curve === 'D' ? 'Даже кривая D не покрывает этот ток — увеличьте номинал или примените MCCB с регулируемой отсечкой.' : 'Выберите кривую D (10–20·Iн), софтстартер/ПЧ или аппарат с регулируемой отсечкой.'));

    /* тепловая часть ВТХ: пуск может уложиться в отсечку, но не в тепловую зону */
    const th = thermalStart(rep);
    const eqNote = (th.Ieq && th.Istart && Math.abs(th.Ieq - th.Istart) / Math.max(th.Istart, 1) > 0.03)
      ? tf(' (действующий ток {ieq} А, пик {i} А)', { ieq: nf(th.Ieq, 0), i: nf(th.Istart, 0) })
      : '';
    if (th.stalled) {
      add('bad', tf('Пуск не разгоняется: за {d} с скорость не достигла номинала. Тепловая зона автомата не проверена; проверьте момент нагрузки, инерцию и способ пуска.', { d: nf(th.duration, 0) }));
    } else if (th.incomplete) {
      add('bad', tf('Пуск не завершён за {d} с: двигатель ещё разгоняется, тепловая зона автомата не проверена. Увеличьте время моделирования или проверьте нагрузку и момент.', { d: nf(th.duration, 0) }));
    }
    if (th.level === 'bad') {
      add('bad', tf('Тепловая зона автомата: при {i} А он отключится за {tr} с, а пуск длится {ts} с — сработает по теплу. Уменьшите пусковой ток (софтстартер, ПЧ, Y–Δ) или возьмите аппарат с регулируемой тепловой защитой.', {
        i: nf(th.Ieq || th.Istart, 0), tr: nf(Math.max(th.trip, 0.02), 2), ts: nf(th.tStart, 2)
      }) + eqNote);
    } else if (th.level === 'warn') {
      add('warn', tf('Пуск на границе тепловой зоны: автомат отключится за {tr} с, пуск — {ts} с (запас {k}×). При повторных пусках и нагретом автомате возможен расход.', {
        tr: nf(Math.max(th.trip, 0.02), 2), ts: nf(th.tStart, 2), k: nf(th.ratio, 2)
      }) + eqNote);
    } else if (th.level === 'ok') {
      add('ok', tf('Пуск укладывается в тепловую зону: автомат отключится за {tr} с, пуск — {ts} с (запас {k}×).', {
        tr: nf(Math.max(th.trip, 0.02), 2), ts: nf(th.tStart, 2), k: nf(th.ratio, 2)
      }) + eqNote);
    }
    if (th.duty && !th.duty.ok) {
      add('warn', tf('{n} пусков/час: эквивалентный ток {ieq} А держится почти постоянно, автомат отключится по теплу за {t} с. Нужен аппарат с тепловой регулировкой или пауза между пусками.', {
        n: th.duty.starts, ieq: nf(th.duty.Ieq, 1), t: nf(th.duty.tripEq, 0)
      }));
    } else if (th.duty && th.duty.ok) {
      add('ok', tf('{n} пусков/час: эквивалентный ток {ieq} А ниже тепловой границы — тепловая память автомата не приведёт к отключению.', {
        n: th.duty.starts, ieq: nf(th.duty.Ieq, 1)
      }));
    }

    if (rep.breaker.upstream) {
      if (rep.breaker.okSel) add('ok', `Селективность с вышестоящим аппаратом ${nf(rep.breaker.upstream, 0)} А обеспечена (отношение ${nf(rep.breaker.selRatio, 1)} ≥ 1,6).`);
      else add('warn', `Селективность не обеспечена: вышестоящий ${nf(rep.breaker.upstream, 0)} А / нижестоящий ${nf(rep.breaker.In, 0)} А = ${nf(rep.breaker.selRatio, 1)} < 1,6. Увеличьте номинал вышестоящего аппарата.`);
    }
    if (ch.breakerIcu) add('ok', `Отключающая способность ${nf(rep.breaker.icu, 0)} кА достаточна для тока КЗ ${nf(state.isc, 1)} кА.`);
    else add('bad', `Ток КЗ ${nf(state.isc, 1)} кА превышает отключающую способность ${nf(rep.breaker.icu, 0)} кА. Нужен аппарат с большей Icu.`);

    if (ch.sc) add('ok', `Кабель термически стоек к I²t при КЗ (Smin ≈ ${nf(rep.sc.sMin, 1)} мм² ≤ ${nf(c.section, 1)} мм²).`);
    else add('warn', `По условию I²t при КЗ требуется ≈ ${nf(rep.sc.sMin, 1)} мм² (принято ${nf(c.section, 1)} мм²). Проверьте токоограничение автомата.`);

    if (ch.contactor) add('ok', `Контактор ${nf(rep.contactor.i, 0)} А / ${nf(rep.contactor.kw, 1)} кВт подходит для категории AC-3.`);
    else add('bad', `Контактор ${nf(rep.contactor.i, 0)} А / ${nf(rep.contactor.kw, 1)} кВт недостаточен для ${nf(m.p2, 0)} кВт — выберите аппарат выше.`);

    if (op.stalled) add('bad', `Двигатель не развивает момент: нагрузка ${nf(op.loadPct, 0)} % превышает опрокидывающий момент. Привод остановится.`);
    else if (!ch.overload) add('warn', `Перегрузка ${nf(op.loadPct, 0)} %: мощность на валу ${nf(op.p2, 2)} кВт выше номинала ${nf(m.p2, 2)} кВт. Длительная работа недопустима.`);
    else add('ok', `Рабочая точка устойчива: запас по моменту ${nf((m.mmaxReal.t - op.T) / m.mn * 100, 0)} % от Mн.`);

    if (m.catalog) {
      const rec = recommendConn(m.catalog, state.voltage);
      if (state.conn !== rec) add('warn', `Для двигателя ${m.catalog.type} при ${nf(state.voltage, 0)} В рекомендуется схема <b>${rec === 'Y' ? 'звезда' : 'треугольник'}</b>.`);
      const winding = m.catalog.un === '220/380' ? 220 : 380;
      const uPhase = state.conn === 'D' ? state.voltage : state.voltage / Math.sqrt(3);
      if (Math.abs(uPhase / winding - 1) > 0.1) {
        add('warn', `Напряжение на фазной обмотке ${nf(uPhase, 0)} В отличается от номинала ${winding} В более чем на 10 %. Проверьте схему соединения.`);
      }
    }
    if (!ch.startDrop) add('bad', `Просадка напряжения при пуске ${nf(rep.dropStart.pct, 1)} % выше лимита ${nf(c.startDropLimit, 0)} % — на двигателе остаётся ${nf(rep.motor.U - rep.dropStart.dU, 0)} В. Увеличьте сечение/число кабелей, сократите линию или примените плавный пуск.`);
    else if (rep.dropStart.pct > 10) add('warn', `Просадка напряжения при пуске ${nf(rep.dropStart.pct, 1)} % — двигатель запустится, но момент снизится примерно на ${nf((1 - Math.pow(1 - rep.dropStart.pct / 100, 2)) * 100, 0)} %.`);
    if (op.temp > m.tempLimit) add('bad', `Расчётная температура обмотки ${nf(op.temp, 0)} °C выше предела класса ${m.motorClass} (${m.tempLimit} °C). До предела ≈ ${nf(op.timeToLimit, 0)} мин; снизьте нагрузку.`);
    else if (op.temp > m.tempLimit - 25) add('warn', `Расчётная температура обмотки ${nf(op.temp, 0)} °C — близко к пределу класса ${m.motorClass} (${m.tempLimit} °C).`);
    if (state.freq !== 50 && m.catalog) add('warn', `Каталожные данные приведены для 50 Гц. Для 60 Гц скорость и скольжение пересчитаны приближённо — уточните паспорт.`);
    if (m.p2 > 315) add('warn', `Мощность ${nf(m.p2, 0)} кВт выше верхней границы базы (315 кВт) — параметры экстраполированы, проверьте по паспорту.`);
    if (rep.breaker.type !== state.breakerType) add('warn', `Для тока ${nf(m.i, 1)} А применён MCCB: модульные MCB ограничены 125 А. В расчёте использован MCCB с уставкой ${rep.breaker.mag}×Iн.`);
    if (m.mode === 'torque' && m.n >= m.ns * 0.999) add('warn', `Заданная скорость ${nf(m.n, 0)} об/мин не ниже синхронной ${nf(m.ns, 0)} об/мин. В двигательном режиме момент на такой скорости не развивается — проверьте исходные данные.`);

    $('#panelWarn').innerHTML = w.map(x =>
      `<div class="warn-item ${x.kind}"><span class="ico">${x.kind === 'ok' ? '✓' : x.kind === 'warn' ? '!' : '×'}</span><span>${x.text}</span></div>`
    ).join('');
  }

  /* ---------- графики расчёта ---------- */
  function fillChartTable(id, head, rows) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<table><thead><tr>' + head.map(h => `<th>${h}</th>`).join('') +
      '</tr></thead><tbody>' + rows.map(r => '<tr>' + r.map(v => `<td>${v}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
  }

  function renderCharts(rep) {
    const m = rep.motor, sw = rep.sweep;

    /* Механическая характеристика: по X — момент, по Y — скорость.
       Точки считаются по (скорость → момент), а на график кладутся как
       [M, n] — так горизонтальной осью становится момент. */
    const tEm = [], tLoad = [];
    const N = 240;
    const uOp = Math.min(1.05, Math.max(0.7, rep.op.U / m.U));
    for (let i = 0; i <= N; i++) {
      const n = m.ns * i / N;
      const s = 1 - n / m.ns;
      tEm.push([E.torque(m, s, uOp), n]);
      tLoad.push([E.loadTorque(m, n, loadCfg()), n]);
    }
    const maxM = Math.max(m.mmaxReal.t, m.mn * 1.15, rep.op.T * 1.1);
    charts.torque.setData([
      { name: t('M двигателя'), color: C.mint, data: tEm, width: 2.2 },
      { name: t('M нагрузки'), color: C.amber, data: tLoad, width: 1.8, dash: [5, 4] }
    ]);
    charts.torque.setOptions({
      markerX: rep.op.T, markerPoint: { x: rep.op.T, y: rep.op.n, color: C.mint },
      xRange: [0, maxM * 1.05], minY: 0, maxY: m.ns,
      xLabel: t('M, Н·м'), yLabel: t('n, об/мин'),
      vLines: [{ x: m.mn, color: 'rgba(255,255,255,0.22)', label: t('Mн') }]
    });
    const tfoot = document.querySelector('[data-chart-panel="torque"] .panel-foot');
    if (tfoot) tfoot.textContent = tf('Кривая M(n) при U = {u} В (с учётом кабеля): по горизонтали момент, по вертикали скорость. Mmax в таблице — при номинальном напряжении.', { u: nf(rep.op.U, 0) });

    charts.iu.setData([
      { name: 'I', color: C.blue, data: sw.load.map((x, i) => [x, sw.I[i]]), width: 2.1 },
      { name: 'U', color: C.amber, data: sw.load.map((x, i) => [x, sw.U[i]]), axis: 1, width: 1.8 }
    ]);
    charts.iu.setOptions({
      markerX: state.loadPct, xRange: [0, 150], yZero2: false,
      hLines: [{ y: m.i, color: 'rgba(90,169,255,0.35)', label: tf('Iн {i} А', { i: nf(m.i, 1) }) }]
    });

    charts.speed.setData([
      { name: 'n', color: C.cyan, data: sw.load.map((x, i) => [x, sw.n[i]]), width: 2.1 },
      { name: t('s, %'), color: C.pink, data: sw.load.map((x, i) => [x, sw.s[i]]), axis: 1, width: 1.6 },
      { name: t('f₂, Гц'), color: C.violet, data: sw.load.map((x, i) => [x, sw.f2[i]]), axis: 1, width: 1.6, dash: [4, 3] }
    ]);
    charts.speed.setOptions({ markerX: state.loadPct, xRange: [0, 150], yZero: false, yZero2: true });

    charts.eff.setData([
      { name: t('η, %'), color: C.mint, data: sw.load.map((x, i) => [x, sw.eta[i]]), width: 2.1 },
      { name: t('cosφ × 100'), color: C.amber, data: sw.load.map((x, i) => [x, sw.cos[i] * 100]), width: 1.8 }
    ]);
    charts.eff.setOptions({ markerX: state.loadPct, xRange: [0, 150], minY: 0, maxY: 100 });

    charts.power.setData([
      { name: 'P₁', color: C.blue, data: sw.load.map((x, i) => [x, sw.p1[i]]), width: 2.1 },
      { name: 'P₂', color: C.mint, data: sw.load.map((x, i) => [x, sw.p2[i]]), width: 1.8 },
      { name: 'ΔP', color: C.pink, data: sw.load.map((x, i) => [x, sw.p1[i] - sw.p2[i]]), width: 1.5, dash: [4, 3] }
    ]);
    charts.power.setOptions({ markerX: state.loadPct, xRange: [0, 150] });

    const idxs = [0, 25, 50, 75, 100, 125, 150];
    fillChartTable('dataIU', ['Нагрузка, %', 'I, А', 'U, В'], idxs.map(i => [sw.load[i], nf(sw.I[i], 1), nf(sw.U[i], 1)]));
    fillChartTable('dataSpeed', ['Нагрузка, %', 'n, об/мин', 's, %', 'f₂, Гц'], idxs.map(i => [sw.load[i], nf(sw.n[i], 0), nf(sw.s[i], 2), nf(sw.f2[i], 2)]));
    fillChartTable('dataEff', ['Нагрузка, %', 'η, %', 'cosφ×100'], idxs.map(i => [sw.load[i], nf(sw.eta[i], 1), nf(sw.cos[i] * 100, 1)]));
    fillChartTable('dataPower', ['Нагрузка, %', 'P₁, кВт', 'P₂, кВт', 'ΔP, кВт'], idxs.map(i => [sw.load[i], nf(sw.p1[i], 2), nf(sw.p2[i], 2), nf(sw.p1[i] - sw.p2[i], 2)]));
    const tRows = [];
    for (let k = 0; k <= 4; k++) {
      const n = m.ns * k / 4;
      const s = 1 - n / m.ns;
      tRows.push([nf(n, 0), nf(E.torque(m, s, Math.min(1.05, Math.max(0.7, rep.op.U / m.U))), 1), nf(E.loadTorque(m, n, loadCfg()), 1)]);
    }
    fillChartTable('dataTorque', ['n, об/мин', 'M двигателя, Н·м', 'M нагрузки, Н·м'], tRows);
  }

  /* ---------- вкладка «Кабель и защита» ---------- */
  function renderCableTab(rep) {
    const c = rep.cable, m = rep.motor;
    const rows = c.rows.map(r => {
      const d = E.voltageDrop(rep.op.I, c.length, r.section, c.material, rep.op.cos, m.U, m.phases, c.insulation, c.parallel);
      const dok = d.pct <= +state.dropLimit;
      return `<tr class="${r.selected ? 'selected' : ''} ${r.ok ? '' : 'dim'}">
        <td>${nf(r.section, 1)}</td>
        <td class="num">${nf(r.allowPer, 1)}</td>
        <td class="num">${nf(r.allow, 1)}</td>
        <td class="num">${nf(d.pct, 2)}</td>
        <td>${r.ok ? '<span class="badge ok">ок</span>' : dok ? '<span class="badge warn">ΔU пуск</span>' : '<span class="badge bad">мало</span>'}</td>
      </tr>`;
    }).join('');
    $('#cableTable').innerHTML = `<table>
      <thead><tr><th>Сечение, мм²</th><th class="num">I на кабель</th><th class="num">I суммарно</th><th class="num">ΔU, %</th><th>Оценка</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
    $('#cableFoot').textContent = `Выбрано ${c.parallel > 1 ? c.parallel + ' × ' : ''}${nf(c.section, 1)} мм² (${c.material === 'al' ? 'алюминий' : 'медь'}), PE ${c.parallel > 1 ? c.parallel + ' × ' : ''}${nf(c.pe, 1)} мм². Поправки: температура ×${nf(c.kTemp, 2)}, группировка ×${nf(c.kGroup, 2)}, способ ×${nf(c.kMethod, 2)}, изоляция ×${nf(c.kIns, 2)}, параллельность ×${nf(c.kPar, 2)}. Просадка при пуске ${nf(rep.dropStart.pct, 1)} %.`;
    const cableOk = rep.checks.cable && rep.checks.drop && rep.checks.startDrop;
    $('#cableTag2').textContent = cableOk ? 'ок' : 'проверить';
    $('#cableTag2').className = 'panel-tag ' + (cableOk ? 'ok' : 'bad');

    const b = rep.breaker, r = rep.relay;
    const th = thermalStart(rep);
    $('#protectTable').innerHTML = `<table>
      <thead><tr><th>Аппарат</th><th>Параметр</th><th>Проверка</th></tr></thead>
      <tbody>
        <tr><td>Автомат</td><td class="num">${nu(b.In, 0, 'А')}, ${b.type === 'mccb' ? 'MCCB ' + b.mag + '×' + t('Iн') : tf('кривая {c}', { c: b.curve })}</td><td>${rep.checks.breakerCurrent && rep.checks.breakerCable ? '<span class="badge ok">ок</span>' : '<span class="badge bad">нет</span>'}</td></tr>
        <tr><td>Селективность</td><td class="num">${b.upstream ? nf(b.upstream, 0) + ' / ' + nf(b.In, 0) + ' А' : 'не задана'}</td><td>${rep.checks.breakerSel ? '<span class="badge ok">ок</span>' : '<span class="badge warn">проверить</span>'}</td></tr>
        <tr><td>Отсечка</td><td class="num">${nf(b.magTrip, 0)} А</td><td>${rep.checks.breakerMag ? '<span class="badge ok">ок</span>' : '<span class="badge bad">ложный пуск</span>'}</td></tr>
        <tr><td>Тепловая зона</td><td class="num">${th.trip != null ? tf('{tr} с / пуск {ts} с', { tr: nf(Math.max(th.trip, 0.02), 2), ts: th.tStart != null ? nf(th.tStart, 2) : '?' }) + (th.Ieq && th.Istart && Math.abs(th.Ieq - th.Istart) / Math.max(th.Istart, 1) > 0.03 ? ' · ' + tf('экв. {ieq} А', { ieq: nf(th.Ieq, 0) }) : '') : '—'}</td><td>${th.level === 'bad' ? '<span class="badge bad">расход</span>' : th.level === 'warn' ? '<span class="badge warn">граница</span>' : th.level === 'ok' ? '<span class="badge ok">ок</span>' : '—'}</td></tr>
        <tr><td>Icu</td><td class="num">${nf(b.icu, 0)} кА</td><td>${rep.checks.breakerIcu ? '<span class="badge ok">ок</span>' : '<span class="badge bad">мало</span>'}</td></tr>
        <tr><td>Тепловое реле</td><td class="num">${nf(r.lo, r.lo % 1 ? 1 : 0)}…${nf(r.hi, r.hi % 1 ? 1 : 0)} А</td><td><span class="badge ok">уставка ${nf(r.set, 1)} А</span></td></tr>
        <tr><td>Контактор</td><td class="num">${nf(rep.contactor.i, 0)} А / ${nf(rep.contactor.kw, 1)} кВт</td><td>${rep.checks.contactor ? '<span class="badge ok">ок</span>' : '<span class="badge bad">мало</span>'}</td></tr>
        <tr><td>Предохранитель</td><td class="num">aM ${nf(rep.fuse, 0)} А</td><td><span class="badge ok">рекоменд.</span></td></tr>
        <tr><td>I²t кабеля</td><td class="num">Smin ${nf(rep.sc.sMin, 1)} мм²</td><td>${rep.sc.ok ? '<span class="badge ok">ок</span>' : '<span class="badge warn">проверить</span>'}</td></tr>
      </tbody></table>`;

    const chk = [
      ['Сечение по нагреву', rep.checks.cable],
      ['Падение напряжения ≤ ' + nf(state.dropLimit, 1) + ' %', rep.checks.drop],
      ['Просадка при пуске ≤ ' + nf(state.cable.startDropLimit, 0) + ' %', rep.checks.startDrop],
      ['Автомат ≥ рабочего тока', rep.checks.breakerCurrent],
      ['Автомат ≤ тока кабеля', rep.checks.breakerCable],
      ['Отсечка выше Iп (с учётом пуска)', rep.checks.breakerMag]
    ];
    chk.push([tf('Температура обмотки {t} °C ≤ предела {lim} °C', { t: nf(rep.op.temp, 0), lim: rep.motor.tempLimit }), rep.op.temp <= rep.motor.tempLimit]);
    if (th.incomplete) chk.push([tf('Пуск завершён за {d} с', { d: nf(th.duration, 0) }), false]);
    else if (th.level) chk.push(['Пуск в тепловой зоне автомата', th.level !== 'bad']);
    if (th.duty) chk.push([tf('Тепловой запас при {n} пусках/час', { n: th.duty.starts }), th.duty.ok]);
    chk.push(
      ['Icu ≥ тока КЗ', rep.checks.breakerIcu],
      ['Термическая стойкость', rep.checks.sc],
      ['Контактор AC-3', rep.checks.contactor],
      ['Устойчивость при нагрузке', !rep.op.stalled]
    );
    if (rep.breaker.upstream) chk.push(['Селективность', rep.checks.breakerSel]);
    $('#checksBody').innerHTML = `<div class="point-grid" style="grid-template-columns:repeat(3,minmax(0,1fr))">
      ${chk.map(x => `<div class="point-item ${x[1] ? 'accent' : 'bad'}"><div class="pl">${x[0]}</div><div class="pv" style="font-size:12px">${x[1] ? '✓ выполняется' : '× не выполняется'}</div></div>`).join('')}
    </div>`;
    $('#checksTag').textContent = chk.every(x => x[1]) ? 'все ок' : 'есть замечания';
    $('#checksTag').className = 'panel-tag ' + (chk.every(x => x[1]) ? 'ok' : 'warn');

    $('#cableNotes').innerHTML = tHtml(`
      <p>Сечение выбрано по длительно допустимому току с поправками на температуру среды, число кабелей в пучке, способ прокладки и тип изоляции. Для двигателя с прямым пуском номинал автомата принимается ${nf(rep.breaker.rise, 2)}·Iн, чтобы исключить ложные срабатывания при пуске.</p>
      <p>Падение напряжения рассчитано для рабочего тока ${nf(rep.op.I, 1)} А при cosφ = ${nf(rep.op.cos, 2)}; активное сопротивление приведено к температуре жилы ${c.insulation === 'xlpe' ? '90' : '70'} °C.</p>
      <p>Проверка I²t выполнена по условному времени отключения ${nf(rep.sc.t, 2)} с и коэффициенту k = ${rep.sc.k} (${c.insulation === 'xlpe' ? 'XLPE' : 'ПВХ'}, ${c.material === 'al' ? 'Al' : 'Cu'}). Для токоограничивающих автоматов фактическое I²t ниже расчётного.</p>`);
    if (I18N.isEn()) I18N.translateDom(document.body);
  }

  /* ---------- сравнение способов пуска ---------- */
  function compareKey(rep) {
    const m = rep.motor;
    return [
      m.p2.toFixed(3), m.i.toFixed(3), m.n.toFixed(1), m.mn.toFixed(2),
      m.mst.toFixed(3), m.mmax.toFixed(3), m.mmaxReal.t.toFixed(2), m.j.toFixed(4),
      m.U.toFixed(1), m.phases, m.conn, (m.connFactor || 1).toFixed(3), m.sn.toFixed(5), m.f,
      state.startMethod, state.loadType, state.loadPct, state.loadUnload, state.loadRelease,
      JSON.stringify(state.loadCurve), state.sim.tSwitch, state.sim.tRamp, state.sim.uStart, state.sim.iLimit,
      +state.jExtra || 0,
      rep.cable.section, rep.cable.parallel, rep.cable.length
    ].join('|');
  }

  function updateCompare() {
    if (!lastRep) return;
    clearTimeout(compareTimer);
    const topKey = compareKey(lastRep);
    if (topKey === lastCompareKey && compareData) {
      renderCompare();
      if (document.querySelector('[data-panel="calc"]').classList.contains('active') || document.querySelector('[data-panel="start"]').classList.contains('active')) renderStartPanel(lastRep);
      return;
    }
    compareTimer = setTimeout(function () {
      if (!lastRep) return;
      try {
        const key = compareKey(lastRep);
        if (key === lastCompareKey && compareData) {
          renderCompare();
          if (document.querySelector('[data-panel="calc"]').classList.contains('active') || document.querySelector('[data-panel="start"]').classList.contains('active')) renderStartPanel(lastRep);
          return;
        }
        compareData = S.compare(lastRep.motor, Object.assign(simCfg(), { cable: lastRep.cable }));
        lastCompareKey = key;
        renderCompare();
        /* вердикт по тепловой зоне зависит от длительности пуска — пересчитать */
        renderVerdict(lastRep);
        renderWarnings(lastRep);
        if (document.querySelector('[data-panel="cable"]').classList.contains('active')) {
          drawVTC(lastRep);
          renderCableTab(lastRep);
        }
        if (document.querySelector('[data-panel="calc"]').classList.contains('active') || document.querySelector('[data-panel="start"]').classList.contains('active')) renderStartPanel(lastRep);
      } catch (e) { console.error(e); }
    }, 120);
  }

  function renderCompare() {
    if (!compareData) return;
    const m = lastRep.motor;
    const rows = compareData.map(x => {
      const active = x.method === state.startMethod;
      const ok = x.tStart != null;
      return `<tr class="${active ? 'selected' : ''}">
        <td>${methodLabel(x.method)}</td>
        <td class="num">${ok ? nf(x.tStart, 2) : '—'}</td>
        <td class="num">${nf(x.peakI, 0)} <span style="color:var(--muted-2)">(${nf(x.peakI / m.i, 1)}×)</span></td>
        <td class="num">${nf(x.peakT, 0)} <span style="color:var(--muted-2)">(${nf(x.peakT / m.mn, 1)}×)</span></td>
        <td>${x.stalled || !ok ? `<span class="badge bad" title="${startDiagnosis(lastRep, x).replace(/"/g, '&quot;')}">не выходит на скорость</span>` : '<span class="badge ok">разгон</span>'}</td>
      </tr>`;
    }).join('');
    $('#compareTable').innerHTML = `<table>
      <thead><tr><th>Способ</th><th class="num">t разгона, с</th><th class="num">Пиковый ток, А</th><th class="num">Пиковый момент, Н·м</th><th>Результат</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
    if (I18N.isEn()) I18N.translateDom(document.body);
  }

  /* ---------- справочные таблицы ---------- */
  function renderRef() {
    const f = [];
    f.push('<div class="formula-title">Ток и мощность</div>');
    f.push('<div class="formula-block">P₁ = P₂ / η<span class="dim">   — потребляемая мощность</span>\nI = P₁ / (√3 · U · cosφ)<span class="dim">   — трёхфазная сеть</span>\nI = P₁ / (U · cosφ)<span class="dim">   — однофазная сеть</span>\nS = √3 · U · I<span class="dim">   — трёхфазная</span>\nS = U · I<span class="dim">   — однофазная</span>\nQ = √(S² − P₁²)</div>');
    f.push('<div class="formula-title">Момент и скорость</div>');
    f.push('<div class="formula-block">n₁ = 120 · f / p<span class="dim">   — синхронная скорость, об/мин</span>\ns = (n₁ − n) / n₁<span class="dim">   — скольжение</span>\nM = 9550 · P₂ / n<span class="dim">   — момент, Н·м (P₂ в кВт)</span>\nf₂ = s · f₁<span class="dim">   — частота в роторе</span></div>');
    f.push('<div class="formula-title">Механическая характеристика</div>');
    f.push('<div class="formula-block">M(s) = 2·Mmax / (s/sкр + sкр/s) + ΔM·s³\nsкр = sн · (Mmax/Mн + √((Mmax/Mн)² − 1))\nΔM = Mп − M(s=1)</div>');
    f.push('<div class="formula-title">Кабель и защита</div>');
    f.push('<div class="formula-block">Iдоп = Iтабл · kтемп · kгруп · kспособ · kизол · kпарал\nΔU = √3 · I · (R·cosφ + X·sinφ)<span class="dim">   — 3 фазы</span>\nΔU = 2 · I · (R·cosφ + X·sinφ)<span class="dim">   — 1 фаза</span>\nR = ρ·L/S,   X ≈ 0,08 Ом/км\nIн.авт ≥ 1,25·Iн;   Iотс > 1,1·Iп\nS ≥ Iкз·√t / k</div>');
    f.push('<div class="formula-title">Однофазный двигатель</div>');
    f.push('<div class="formula-block">I = P₁ / (U · cosφ)\nS = U · I\nΔU = 2 · I · (R·cosφ + X·sinφ)\nM = 9550 · P₂ / n\nP₂ = M · n / 9550</div>');
    f.push('<div class="formula-title">Уравнение движения</div>');
    f.push('<div class="formula-block">J · dω/dt = Mдв(s) − Mс(n)\nω = 2π·n/60,   s = (n₁ − n)/n₁</div>');
    $('#formulas').innerHTML = f.join('');

    // таблица токов
    const std = state.cable.standard;
    const tabCu = D.AMPACITY[std].cu.air;
    const tabAl = D.AMPACITY[std].al.air;
    let rows = '';
    D.SECTIONS.forEach((s, i) => {
      rows += `<tr><td>${s}</td><td class="num">${tabCu[i] == null ? '—' : tabCu[i]}</td><td class="num">${tabAl[i] == null ? '—' : tabAl[i]}</td></tr>`;
    });
    $('#ampTable').innerHTML = `<table><thead><tr><th>S, мм²</th><th class="num">Cu, А</th><th class="num">Al, А</th></tr></thead><tbody>${rows}</tbody></table>`;
    $('#ampTag').textContent = std === 'iec' ? 'IEC' : 'ПУЭ';

    // база двигателей
    let mt = '';
    D.MOTOR_DB.forEach(m => {
      const sel = state.mode === 'catalog' && m.type === state.catType;
      mt += `<tr class="${sel ? 'selected' : ''}" data-type="${m.type}" style="cursor:pointer">
        <td>${m.type}${m.typical ? ' *' : ''}</td><td class="num">${nf(m.p2, 2)}</td><td class="num">${m.n}</td>
        <td class="num">${nf(m.i380, 1)}</td><td class="num">${nf(m.eff, 1)}</td><td class="num">${nf(m.cos, 2)}</td>
        <td class="num">${nf(m.kst, 1)}</td><td class="num">${nf(m.mst, 1)}</td><td class="num">${nf(m.mmax, 1)}</td>
      </tr>`;
    });
    $('#motorTable').innerHTML = `<table><thead><tr><th>Тип</th><th class="num">P₂, кВт</th><th class="num">n, об/мин</th><th class="num">I, А</th><th class="num">КПД, %</th><th class="num">cosφ</th><th class="num">Iп/Iн</th><th class="num">Mп/Mн</th><th class="num">Mmax/Mн</th></tr></thead><tbody>${mt}</tbody></table>`;
    $('#dbCount').textContent = D.MOTOR_DB.length + ' типоразмеров · * типовые';
    if (I18N.isEn()) I18N.translateDom(document.body);
  }

  /* ---------- симуляция ---------- */
  function resetSim(keepRunning) {
    simState = null;
    ghostState = null;
    simRunning = false;
    simMethodKey = state.startMethod;
    if (charts.simN) {
      ['simN', 'simI', 'simT', 'simU'].forEach(k => { charts[k].setData([]); charts[k].resetView(); });
      const d = Math.max(2, +state.sim.duration || 20);
      ['simN', 'simI', 'simT', 'simU'].forEach(k => charts[k].setOptions({ xRange: [0, d] }));
    }
    updateSimUI();
    if (keepRunning) setSimStage(t('ожидание'));
  }

  function startSim() {
    if (!lastRep) return;
    const m = lastRep.motor;
    simState = S.createState(m, simCfg());
    simState.cable = lastRep.cable;
    simState.running = true;
    simRunning = true;
    simFollow = false;
    ghostState = null;
    if (state.sim.overlay !== 'none') {
      const gc = simCfg();
      gc.method = state.sim.overlay;
      ghostState = S.createState(m, gc);
      ghostState.cable = lastRep.cable;
      ghostState.running = true;
    }
    simMethodKey = state.startMethod;
    simMotorKey = motorKey(lastRep);
    updateSimUI();
    drawSimCharts(true);
    setSimStage(t('разгон'));
  }

  function pauseSim() {
    simRunning = false;
    if (simState) simState.running = false;
    if (ghostState) ghostState.running = false;
    setSimStage(t(simState && simState.done ? 'завершено' : 'пауза'));
    const pl = $('#simPauseLabel');
    if (pl) pl.textContent = t('Продолжить');
  }

  function ensureSim() {
    if (!simState) {
      simState = S.createState(lastRep.motor, simCfg());
      simState.cable = lastRep.cable;
      simState.running = false;
      updateSimUI();
    } else {
      simState.cfg = simCfg();
      simState.cfg.speed = +state.sim.speed;
      simState.cable = lastRep.cable;
    }
  }

  function setSimStage(t) {
    const el = $('#simStage');
    if (el) el.textContent = t;
  }

  function updateOverlayNote() {
    const note = $('#simOverlayNote');
    if (!note) return;
    note.innerHTML = state.sim.overlay !== 'none'
      ? 'Пунктир — <b>' + methodLabel(state.sim.overlay) + '</b>. Сравнение идёт при той же нагрузке и инерции.'
      : 'Выберите «Наложить способ», чтобы сравнить два пуска на графиках.';
    if (I18N.isEn()) I18N.translateDom(document.body);
  }

  function updateSimUI() {
    updateOverlayNote();
    if (!simState) {
      ['simT', 'simN', 'simI', 'simTq', 'simU'].forEach(id => { const e = document.getElementById(id); if (e) e.textContent = id === 'simT' ? '0.00' : '0'; });
      const f = $('#simF'); if (f) f.textContent = nf(state.freq, 1);
      setSimStage(t('ожидание'));
      const p0 = $('#simPauseLabel');
      if (p0) p0.textContent = t('Пауза');
      return;
    }
    const st = simState;
    $('#simT').textContent = nf(st.t, 2);
    $('#simN').textContent = nf(st.nNow, 0);
    $('#simI').textContent = nf(st.iNow, 1);
    $('#simTq').textContent = nf(st.tNow, 0);
    $('#simU').textContent = nf(st.uNow * 100, 0);
    $('#simF').textContent = nf(st.fNow, 1);
    let stage = 'ожидание';
    if (st.done) stage = 'завершено';
    else if (st.stalled) stage = 'опрокидывание';
    else if (st.running) {
      if (st.tStart != null) stage = 'работа';
      else {
        const lim = st.cfg.method === 'vfd' ? (st.cfg.tRamp || 10) + 3 : st.cfg.method === 'soft' ? (st.cfg.tRamp || 6) + 2 : 4;
        stage = st.t > lim && st.nNow < 0.9 * st.motor.n ? 'не выходит на скорость' : 'разгон';
      }
    }
    if (simFollow && st.running) stage = tf('{s} · слежение', { s: t(stage) });
    setSimStage(t(stage));
    const pl = $('#simPauseLabel');
    if (pl) pl.textContent = st.running ? t('Пауза') : t('Продолжить');
    if (I18N.isEn()) I18N.translateDom(document.body);
  }

  function drawSimCharts(force) {
    if (!simState) return;
    const st = simState;
    const gStart = ghostState && ghostState.tStart ? ghostState.tStart : 0;
    const refStart = Math.max(st.tStart || 0, gStart);
    /* окно графика: масштаб под время пуска, но не шире времени моделирования
       (данные копятся весь прогон — до 120 с) */
    const dur = Math.max(2, +st.cfg.duration || +state.sim.duration || 20);
    const span0 = Math.max(2, Math.min(dur, (refStart || (st.t * 1.2 + 0.6)) * 2.5));
    const span = span0;
    let t0, tEnd;
    if (simFollow) { t0 = Math.max(0, st.t - Math.max(span, 6)); tEnd = Math.max(span, st.t); }
    else { t0 = 0; tEnd = Math.max(span, Math.min(st.t + 0.4, dur)); }
    const xr = [t0, tEnd];
    const pts = st.samples.filter(s => s.t >= t0);
    const gPts = ghostState ? ghostState.samples.filter(s => s.t >= t0) : [];
    const gName = methodShort(state.sim.overlay);

    const m = st.motor;
    const nSeries = [
      { name: 'n', color: C.cyan, data: pts.map(p => [p.t, p.n]), width: 2 },
      { name: t('s, %'), color: C.pink, data: pts.map(p => [p.t, p.s]), axis: 1, width: 1.5 }
    ];
    if (gPts.length) nSeries.push({ name: gName + ': n', color: C.overlay, dash: [6, 4], width: 1.8, data: gPts.map(p => [p.t, p.n]) });
    charts.simN.setData(nSeries);
    charts.simN.setOptions({ xRange: xr });

    const iSeries = [
      { name: 'I', color: C.blue, data: pts.map(p => [p.t, p.I]), width: 2 },
      { name: t('I / Iн'), color: C.amber, data: pts.map(p => [p.t, p.I / m.i]), axis: 1, width: 1.5, dash: [4, 3] }
    ];
    if (gPts.length) iSeries.push({ name: gName + ': I', color: C.overlay, dash: [6, 4], width: 1.8, data: gPts.map(p => [p.t, p.I]) });
    charts.simI.setData(iSeries);
    charts.simI.setOptions({
      xRange: xr,
      hLines: [{ y: m.i, color: 'rgba(90,169,255,0.35)', label: t('Iн') }]
    });

    const tSeries = [
      { name: t('M двигателя'), color: C.mint, data: pts.map(p => [p.t, p.T]), width: 2 },
      { name: t('M нагрузки'), color: C.amber, data: pts.map(p => [p.t, E.loadTorque(m, p.n, st.cfg.load)]), width: 1.5, dash: [4, 3] }
    ];
    if (gPts.length) tSeries.push({ name: gName + ': M', color: C.overlay, dash: [6, 4], width: 1.8, data: gPts.map(p => [p.t, p.T]) });
    charts.simT.setData(tSeries);
    charts.simT.setOptions({ xRange: xr });

    const uSeries = [
      { name: t('U, %'), color: C.violet, data: pts.map(p => [p.t, p.U]), width: 2 },
      { name: t('f₁, Гц'), color: C.lime || C.mint, data: pts.map(p => [p.t, p.f]), axis: 1, width: 1.5 }
    ];
    if (gPts.length) uSeries.push({ name: gName + ': U', color: C.overlay, dash: [6, 4], width: 1.8, data: gPts.map(p => [p.t, p.U]) });
    charts.simU.setData(uSeries);
    charts.simU.setOptions({ xRange: xr });
  }

  /* ---------- табы ---------- */
  function moveUnderline() {
    const btn = document.querySelector('.tab-btn.active');
    const line = $('#tabUnderline');
    if (!btn || !line) return;
    line.style.left = btn.offsetLeft + 'px';
    line.style.width = btn.offsetWidth + 'px';
  }

  function switchTab(tab) {
    state.tab = tab;
    saveState();
    $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === tab));
    moveUnderline();
    requestAnimationFrame(function () {
      Object.keys(charts).forEach(k => charts[k].refresh());
      if (tab === 'start') {
        ensureSim();
        drawSimCharts();
        updateSimUI();
        updateCompare();
      }
      if (tab === 'ref') renderRef();
      if (tab === 'cable' && lastRep) {
        renderCableTab(lastRep);
        drawVTC(lastRep);
      }
    });
  }

  /* ---------- события ---------- */
  function bind() {
    // сегменты
    bindSeg('#segPhases', 'phases', v => {
      state.cable.loaded = v === 1 ? 2 : 3;
      if (v === 1 && state.mode === 'catalog') { state.mode = 'power'; syncSeg('#segMode', 'power'); }
      syncPhaseUI();
      updateVisibility(); updateSimVisibility();
    });
    bindSeg('#segFreq', 'freq');
    bindSeg('#segConn', 'conn', () => { state.connAuto = false; });
    bindSeg('#segMode', 'mode', () => { updateVisibility(); });
    bindSeg('#segStd', 'cable.standard', () => renderRef());
    bindSeg('#segMat', 'cable.material', () => renderRef());
    bindSeg('#segCurve', 'curve');
    bindSeg('#segBrk', 'breakerType', () => {
      const cur = MC.vtc.get(state.breakerSeries);
      const next = MC.vtc.list().find(x => x.type === state.breakerType && x.brand === cur.brand)
        || MC.vtc.list().find(x => x.type === state.breakerType);
      if (next) {
        state.breakerSeries = next.id;
        fillBreakerCurves();
        if ($('#brkSeries')) $('#brkSeries').value = next.id;
        if ($('#brkCurve')) $('#brkCurve').value = state.curve;
        syncSeg('#segBrk', state.breakerType);
      }
      $('#fieldCurve').classList.toggle('hidden', state.breakerType === 'mccb');
      $('#fieldMccb').classList.toggle('hidden', state.breakerType !== 'mccb');
    });
    bindSeg('#segSimSpeed', 'sim.speed');

    // числа
    bindNum('voltage', 'voltage', 24, 1000);
    bindNum('p2', 'p2', 0.05, 2000);
    bindNum('current', 'current', 0.05, 5000);
    bindNum('torque', 'torque', 0.1, 50000);
    bindNum('speedRpm', 'speedRpm', 10, 12000);
    bindNum('eff', 'eff', 20, 99.5);
    bindNum('cos', 'cos', 0.2, 1);
    bindNum('slip', 'slip', 0.1, 20);
    bindNum('kst', 'kst', 2, 12);
    bindNum('mst', 'mst', 0.5, 4);
    bindNum('mmax', 'mmax', 1.2, 4);
    bindNum('jMotor', 'jMotor', 0, 100);
    bindNum('tauMotor', 'tauMotor', 0, 300);
    bindNum('motorAmbient', 'motorAmbient', -40, 70);
    bindNum('jExtra', 'jExtra', 0, 1000);
    bindNum('len', 'cable.length', 1, 10000);
    bindNum('ambient', 'cable.ambient', -40, 70);
    bindNum('group', 'cable.group', 1, 9);
    bindNum('dropLimit', 'dropLimit', 1, 20);
    bindNum('isc', 'isc', 0.5, 200);
    $('#brkSeries').addEventListener('change', e => {
      state.breakerSeries = e.target.value;
      fillBreakerCurves();
      $('#brkCurve').value = state.curve;
      syncSeg('#segBrk', state.breakerType);
      schedule();
    });
    $('#brkCurve').addEventListener('change', e => { state.curve = e.target.value; schedule(); });
    bindNum('vtcUpstream', 'upstreamIn', 0, 3000);
    $('#motorHotStart').addEventListener('change', e => { state.motorHotStart = e.target.checked; schedule(); });
    bindNum('motorHotPct', 'motorHotPct', 0, 95);
    bindNum('motorCoolTau', 'motorCoolTau', 1, 180);
    bindNum('motorStarts', 'motorStartsPerHour', 0, 60);
    $('#motorClassOv').addEventListener('change', e => { state.motorOverloadClass = +e.target.value; schedule(); });
    bindNum('startDrop', 'cable.startDropLimit', 3, 30);
    bindNum('simSwitch', 'sim.tSwitch', 0.2, 60);
    bindNum('simRamp', 'sim.tRamp', 0.2, 300);
    bindNum('simUstart', 'sim.uStart', 5, 95);
    bindNum('simIlimit', 'sim.iLimit', 1, 8);
    bindNum('simDuration', 'sim.duration', 2, 120);

    // селекты
    $('#poles').addEventListener('change', e => { state.poles = +e.target.value; schedule(); });
    $('#catPoles').addEventListener('change', e => { state.catPoles = +e.target.value; fillCatalog(false); schedule(); });
    $('#catMotor').addEventListener('change', e => { state.catType = e.target.value; applyCatalog(true); schedule(); });
    $('#loadType').addEventListener('change', e => { state.loadType = e.target.value; updateVisibility(); schedule(); });
    $('#insulation').addEventListener('change', e => { state.cable.insulation = e.target.value; schedule(); });
    $('#laying').addEventListener('change', e => { state.cable.laying = e.target.value; schedule(); });
    $('#parallel').addEventListener('change', e => { state.cable.parallel = e.target.value === 'auto' ? 'auto' : +e.target.value; schedule(); });
    $('#mccbMag').addEventListener('change', e => { state.mccbMag = +e.target.value; schedule(); });
    $('#loaded').addEventListener('change', e => { state.cable.loaded = +e.target.value; schedule(); });
    $('#motorClass').addEventListener('change', e => { state.motorClass = e.target.value; schedule(); });
    $('#motor1phType').addEventListener('change', e => { state.motor1phType = e.target.value; schedule(); });

    function methodChange(v) {
      state.startMethod = v;
      $('#startMethod').value = v;
      $('#simMethod').value = v;
      updateSimVisibility();
      simMethodKey = v;
      resetSim(false);
      schedule();
    }
    $('#startMethod').addEventListener('change', e => methodChange(e.target.value));
    $('#simMethod').addEventListener('change', e => methodChange(e.target.value));
    $('#simOverlay').addEventListener('change', e => {
      state.sim.overlay = e.target.value;
      saveState();
      resetSim(false);
      updateOverlayNote();
      if (state.tab === 'start' && lastRep) drawSimCharts();
    });

    // нагрузка
    $('#loadRange').addEventListener('input', e => {
      state.loadPct = +e.target.value;
      if (simState && simState.running) simFollow = true;
      $('#loadVal').textContent = nf(state.loadPct, 0);
      e.target.style.setProperty('--fill', (state.loadPct / 150 * 100) + '%');
      schedule();
    });

    // автопараметры
    $('#autoTypical').addEventListener('change', e => { state.autoTypical = e.target.checked; updateVisibility(); schedule(); });

    // пресеты напряжения
    $('#voltPresets').addEventListener('click', e => {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      state.voltage = +b.dataset.v;
      $('#voltage').value = state.voltage;
      if (state.mode === 'catalog') applyCatalog(true);
      schedule();
    });

    // проект и варианты
    $('#btnSaveProject').addEventListener('click', saveProject);
    $('#btnLoadProject').addEventListener('click', () => $('#fileProject').click());
    $('#fileProject').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (f) loadProject(f);
      e.target.value = '';
    });
    $('#verdict').addEventListener('click', e => {
      if (e.target.closest('[data-act="remember"]')) rememberVariant();
    });
    $('#variantsBody').addEventListener('click', e => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      setVariants(getVariants().filter(v => String(v.id) !== b.dataset.del));
    });

    // инструменты графиков
    document.addEventListener('click', e => {
      const png = e.target.closest('[data-png]');
      if (png) {
        const ch = chartByCanvas(png.dataset.png);
        if (ch) ch.exportPNG(png.dataset.png);
        return;
      }
      const rst = e.target.closest('[data-reset]');
      if (rst) {
        const ch = chartByCanvas(rst.dataset.reset);
        if (ch) ch.resetView();
      }
    });

    // проект: название и логотип
    $('#projectName').addEventListener('input', e => { state.projectName = e.target.value; saveState(); });
    $('#projectLogo').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const w = 240, h = Math.max(1, Math.round(img.height * w / img.width));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          state.projectLogo = c.toDataURL('image/png');
          $('#logoHint').textContent = 'логотип загружен';
          saveState();
          setStatus(t('логотип загружен'), 'ok');
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(f);
      e.target.value = '';
    });

    // поделиться
    $('#btnShare').addEventListener('click', shareState);
    $('#loadCurve').addEventListener('input', e => {
      const pts = parseLoadCurve(e.target.value);
      if (pts) { state.loadCurve = pts; schedule(); }
    });
    bindNum('loadUnload', 'loadUnload', 0, 95);
    $('#loadUnload').addEventListener('input', updateUnloadUI);
    bindNum('loadRelease', 'loadRelease', 1, 100);

    // обучение
    $('#btnTour').addEventListener('click', tourStart);
    $('#btnTour2').addEventListener('click', tourStart);

    // подсказки
    const canHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;
    document.addEventListener('pointerover', e => {
      const b = e.target.closest('.tip-btn');
      if (b && canHover) showTip(b);
    });
    document.addEventListener('pointerout', e => {
      const b = e.target.closest('.tip-btn');
      if (b && canHover) hideTip();
    });
    document.addEventListener('click', e => {
      const b = e.target.closest('.tip-btn');
      if (b) {
        e.preventDefault();
        e.stopPropagation();
        if (activeTip !== b) showTip(b);
        return;
      }
      if (activeTip) hideTip();
    });
    document.addEventListener('focusin', e => {
      const b = e.target.closest('.tip-btn');
      if (b) showTip(b);
    });
    document.addEventListener('focusout', e => {
      if (e.target.closest && e.target.closest('.tip-btn')) setTimeout(hideTip, 100);
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideTip(); });
    document.addEventListener('scroll', () => { if (activeTip) hideTip(); }, true);
    window.addEventListener('resize', () => { if (activeTip) hideTip(); });

    /* меню настольной оболочки (Файл → …) */
    if (window.MC_SHELL && window.MC_SHELL.onMenu) {
      window.MC_SHELL.onMenu(action => {
        if (action === 'saveProject') saveProject();
        else if (action === 'openProject') $('#fileProject').click();
        else if (action === 'print') openReport();
      });
    }

    // язык
    $('#segLang').addEventListener('click', e => {
      const b = e.target.closest('button[data-val]');
      if (!b) return;
      I18N.setLang(b.dataset.val);
      hideTip();
    });

    // тема
    $('#segTheme').addEventListener('click', e => {
      const b = e.target.closest('button[data-val]');
      if (!b) return;
      setTheme(b.dataset.val);
    });
    /* выбор цветовой схемы */
    $('#btnPalette').addEventListener('click', e => {
      e.stopPropagation();
      if (paletteOpen()) closePalette(); else openPalette();
    });
    $('#palettePop').addEventListener('click', e => {
      const b = e.target.closest('[data-theme-id]');
      if (!b) return;
      setTheme(b.dataset.themeId);
      closePalette();
    });
    document.addEventListener('click', e => {
      if (!paletteOpen()) return;
      if (e.target.closest('#palettePop') || e.target.closest('#btnPalette')) return;
      closePalette();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && paletteOpen()) { closePalette(); e.stopPropagation(); }
    }, true);
    if (mqLight && mqLight.addEventListener) {
      mqLight.addEventListener('change', () => { if (state.theme === 'auto') applyTheme(); });
    }

    // мобильная панель
    $('#btnMenu').addEventListener('click', openDrawer);
    $('#drawerClose').addEventListener('click', closeDrawer);
    $('#drawerBackdrop').addEventListener('click', closeDrawer);
    $('#drawerDone').addEventListener('click', closeDrawer);
    $$('.drawer-foot [data-act]').forEach(b => {
      b.addEventListener('click', () => {
        if (b.dataset.act === 'print') $('#btnPrint').click();
        else $('#btnReset').click();
      });
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        const container = tour.active ? tour.card : (document.body.classList.contains('drawer-open') ? $('#sidebar') : null);
        if (container) {
          const f = Array.from(container.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'))
            .filter(el => !el.disabled && el.offsetParent !== null);
          if (f.length) {
            const first = f[0], last = f[f.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          }
        }
      }
      if (e.key === 'Escape') closeDrawer();
    });
    window.addEventListener('resize', () => { if (window.innerWidth > 980) closeDrawer(); });

    // печать: принудительно светлая палитра для графиков
    window.addEventListener('beforeprint', () => {
      document.documentElement.setAttribute('data-theme', 'light');
      if (MC.setChartTheme) MC.setChartTheme('light');
      if (MC.PALETTES && MC.CHART_COLORS) Object.assign(MC.CHART_COLORS, MC.PALETTES.light);
      if (lastRep) render(lastRep);
    });
    window.addEventListener('afterprint', () => applyTheme());

    // табы
    $('#tabs').addEventListener('click', e => {
      const b = e.target.closest('.tab-btn');
      if (b) switchTab(b.dataset.tab);
    });

    // чипы графиков
    $('#chartChips').addEventListener('click', e => {
      const b = e.target.closest('.chip');
      if (!b) return;
      const k = b.dataset.chart;
      state.charts[k] = !state.charts[k];
      b.classList.toggle('active', state.charts[k]);
      const panel = document.querySelector(`[data-chart-panel="${k}"]`);
      if (panel) panel.classList.toggle('hidden', !state.charts[k]);
      saveState();
      requestAnimationFrame(() => {
        const ch = { torque: charts.torque, iu: charts.iu, speed: charts.speed, eff: charts.eff, power: charts.power }[k];
        if (ch && state.charts[k]) ch.refresh();
      });
    });

    // выбор графиков для экспорта
    $('#exportCharts').addEventListener('change', e => {
      const cb = e.target.closest('input[data-export]');
      if (!cb) return;
      state.exportCharts[cb.dataset.export] = cb.checked;
      updateExportTag();
      saveState();
    });
    $('#btnExportAll').addEventListener('click', () => setAllExport(true));
    $('#btnExportNone').addEventListener('click', () => setAllExport(false));
    $('#btnExportPng').addEventListener('click', exportSelectedPng);
    $('#btnExportPdf').addEventListener('click', openReport);

    // печать / сброс
    $('#btnCsv').addEventListener('click', exportCsv);
    $('#btnXlsx').addEventListener('click', exportXlsx);
    $('#btnPrint').addEventListener('click', openReport);
    $('#btnReset').addEventListener('click', () => {
      if (!confirm('Сбросить все параметры к значениям по умолчанию?')) return;
      localStorage.removeItem(STORE_KEY);
      location.reload();
    });
    $('#btnToStart').addEventListener('click', () => switchTab('start'));

    // симуляция
    $('#simPlay').addEventListener('click', () => {
      if (!lastRep) return;
      startSim();
    });
    $('#simPause').addEventListener('click', () => {
      if (!simState) return;
      if (simState.running) { pauseSim(); return; }
      if (simState.done) return;
      simState.running = true; simRunning = true;
      if (ghostState) ghostState.running = true;
      setSimStage('работа');
      const pl = $('#simPauseLabel'); if (pl) pl.textContent = 'Пауза';
    });
    $('#simReset').addEventListener('click', () => { resetSim(false); setSimStage('ожидание'); });

    // таблица двигателей
    $('#motorTable').addEventListener('click', e => {
      const tr = e.target.closest('tr[data-type]');
      if (!tr) return;
      const type = tr.dataset.type;
      const m = D.MOTOR_DB.find(x => x.type === type);
      if (!m) return;
      state.mode = 'catalog';
      state.catPoles = m.poles;
      state.catType = type;
      state.phases = 3;
      syncSeg('#segPhases', 3);
      syncSeg('#segMode', 'catalog');
      $('#catPoles').value = m.poles;
      fillCatalog(true);
      applyCatalog(true);
      updateVisibility();
      switchTab('calc');
      schedule();
    });

    window.addEventListener('resize', moveUnderline);
    // ВТХ рисуется в размер блока, поэтому при изменении окна его нужно перерисовать
    let vtcResizeFrame = 0;
    window.addEventListener('resize', () => {
      if (state.tab !== 'cable' || !lastRep) return;
      cancelAnimationFrame(vtcResizeFrame);
      vtcResizeFrame = requestAnimationFrame(() => drawVTC(lastRep));
    });
    document.addEventListener('keydown', e => {
      if (tour.active) return;
      if (e.code === 'Space' && state.tab === 'start' && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        $('#simPause').click();
      }
    });
  }

  function bindSeg(sel, path, cb) {
    const box = $(sel);
    if (!box) return;
    box.addEventListener('click', e => {
      const b = e.target.closest('button[data-val]');
      if (!b) return;
      let v = b.dataset.val;
      if (v !== '' && !isNaN(+v)) v = +v;
      setPath(state, path, v);
      syncSeg(sel, v);
      if (cb) cb(v);
      schedule();
    });
  }

  function bindNum(id, path, min, max) {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = getPath(state, path);
    el.addEventListener('input', () => {
      const v = parseFloat(el.value.replace(',', '.'));
      if (!isFinite(v)) return;
      setPath(state, path, Math.max(min, Math.min(max, v)));
      schedule();
    });
    el.addEventListener('blur', () => {
      const v = getPath(state, path);
      el.value = v;
    });
  }

  function exportXlsx() {
    if (!lastRep || !MC.xlsx) return;
    const m = lastRep.motor, c = lastRep.cable, b = lastRep.breaker, op = lastRep.op;
    const rnd = (v, d) => (typeof v === 'number' && isFinite(v) ? Math.round(v * Math.pow(10, d)) / Math.pow(10, d) : v);
    const modeName = { catalog: 'каталог', power: 'по мощности', current: 'по току', torque: 'по моменту' }[m.mode] || m.mode;
    const t1name = { capacitor: 'конденсаторный', split: 'с расщеплённой фазой', psc: 'PSC' }[m.motor1phType] || '';
    const sheets = [];
    sheets.push({ name: 'Параметры', rows: [
      ['Параметр', 'Значение', 'Ед.'],
      ['Тип двигателя', m.catalog ? m.catalog.type : (m.phases === 1 ? tf('Однофазный ({t})', { t: t(t1name) }) : '—') + (m.phases === 1 && m.p2 > 7.5 ? t(' ' + t('— оценка >7,5 кВт')) : ''), ''],
      ['Питание', m.phases === 1 ? '1 фаза' : '3 фазы', ''],
      ['Схема', m.phases === 1 ? '1 фаза, L/N' : (m.conn === 'D' ? 'Δ' : 'Y'), ''],
      ['Способ задания', modeName, ''],
      ['Мощность P₂', m.p2, 'кВт'],
      ['Потребляемая P₁', rnd(m.p1, 2), 'кВт'],
      ['Полная S', rnd(m.p1 / m.cos, 2), 'кВ·А'],
      ['Номинальный ток Iн', rnd(m.i, 1), 'А'],
      ['Пусковой ток (DOL)', rnd(m.ist, 1), 'А'],
      ['Расчётный ток пуска', rnd(lastRep.iStart, 1), 'А'],
      ['cosφ', rnd(m.cos, 3), ''],
      ['КПД', rnd(m.eff, 1), '%'],
      ['Скорость nн', rnd(m.n, 0), 'об/мин'],
      ['Синхронная n₁', rnd(m.ns, 0), 'об/мин'],
      ['Скольжение', rnd(m.sn * 100, 2), '%'],
      ['Момент Mн', rnd(m.mn, 1), 'Н·м'],
      ['Момент Mп', rnd(m.mstAbs, 1), 'Н·м'],
      ['Момент Mmax', rnd(m.mmaxReal.t, 1), 'Н·м'],
      ['Частота ротора f₂', rnd(m.sn * m.f, 2), 'Гц'],
      ['Момент инерции J', rnd(m.j, 4), 'кг·м²'],
      ['Класс изоляции', m.motorClass, ''],
      ['Температура обмотки', rnd(op.temp, 0), '°C'],
      ['Предел температуры', m.tempLimit, '°C'],
      ['Способ пуска', t(methodLabel(state.startMethod)), '']
    ]});
    sheets.push({ name: 'Защита и кабель', rows: [
      ['Параметр', 'Значение', 'Ед.'],
      ['Тип автомата', b.type === 'mccb' ? 'MCCB' : 'MCB', ''],
      ['Полюсов автомата', m.phases === 1 ? 1 : 3, ''],
      ['Номинал автомата', b.In, 'А'],
      ['Кривая / уставка', b.type === 'mccb' ? b.mag + '×' + t('Iн') : b.curve, ''],
      ['Ток отсечки', b.magTrip, 'А'],
      ['Icu', b.icu, 'кА'],
      ['Селективность', b.upstream ? (b.okSel ? 'обеспечена' : 'не обеспечена') : 'не задана', ''],
      ['Тепловое реле', lastRep.relay.lo + '…' + lastRep.relay.hi, 'А'],
      ['Контактор', lastRep.contactor.i + ' ' + t('А') + ' / ' + lastRep.contactor.kw, 'кВт'],
      ['Предохранитель aM', lastRep.fuse, 'А'],
      ['Параллельных кабелей', c.parallel, ''],
      ['Нагруженных жил', c.loaded, ''],
      ['Сечение', c.section, 'мм²'],
      ['PE', c.pe, 'мм²'],
      ['Допустимый ток', rnd(c.allow, 1), 'А'],
      ['Длина', c.length, 'м'],
      ['ΔU рабочее', rnd(lastRep.drop.pct, 2), '%'],
      ['ΔU при пуске', rnd(lastRep.dropStart.pct, 1), '%'],
      ['Материал', c.material === 'al' ? 'Al' : 'Cu', ''],
      ['Изоляция', c.insulation === 'xlpe' ? 'XLPE' : 'ПВХ', ''],
      ['Стандарт', c.standard === 'iec' ? 'IEC' : 'ПУЭ', '']
    ]});
    const sw = lastRep.sweep;
    const curveRows = [['Нагрузка, %', 'I, А', 'U, В', 'n, об/мин', 's, %', 'f₂, Гц', 'КПД, %', 'cosφ', 'P₁, кВт', 'P₂, кВт', 'ΔU, %']];
    for (let i = 0; i < sw.load.length; i += 1) {
      curveRows.push([sw.load[i], rnd(sw.I[i], 2), rnd(sw.U[i], 1), rnd(sw.n[i], 1), rnd(sw.s[i], 3), rnd(sw.f2[i], 3), rnd(sw.eta[i], 2), rnd(sw.cos[i], 3), rnd(sw.p1[i], 2), rnd(sw.p2[i], 2), rnd(sw.dU[i], 2)]);
    }
    sheets.push({ name: 'Кривые', rows: curveRows });
    if (compareData) {
      sheets.push({ name: 'Сравнение пусков', rows: [
        ['Способ', 'Время разгона, с', 'Пиковый ток, А', 'Пиковый момент, Н·м', 'Результат'],
        ...compareData.map(x => [t(methodLabel(x.method)), x.tStart == null ? '—' : rnd(x.tStart, 2), rnd(x.peakI, 1), rnd(x.peakT, 1), x.stalled || x.tStart == null ? t('не выходит на скорость') : t('разгон')])
      ]});
    }
    sheets.push({ name: 'Проверки', rows: [
      ['Проверка', 'Результат'],
      ...checksList(lastRep).map(x => [x[0], x[1] ? 'выполняется' : 'не выполняется'])
    ]});
    const vars = getVariants();
    if (vars.length) {
      sheets.push({ name: 'Варианты', rows: [
        ['Вариант', 'P₂, кВт', 'I, А', 'Автомат', 'Кабель, мм²', 'ΔU, %', 'ΔU пуск, %', 'Пуск'],
        ...vars.map(v => [v.name, rnd(v.p2, 1), rnd(v.i, 1), v.brk, v.cable, rnd(v.dU, 2), rnd(v.dUs, 1), methodShort(v.method)])
      ]});
    }
    let chartImgs = [];
    try {
      chartImgs = [
        { name: 'Момент — скорость', data: charts.torque.toPNGData('#ffffff') },
        { name: 'Ток и напряжение', data: charts.iu.toPNGData('#ffffff') },
        { name: 'Скорость и скольжение', data: charts.speed.toPNGData('#ffffff') },
        { name: 'КПД и cosφ', data: charts.eff.toPNGData('#ffffff') },
        { name: 'Мощности', data: charts.power.toPNGData('#ffffff') }
      ];
      sheets.push({ name: 'Графики', rows: [['График', 'Изображение'], ...chartImgs.map(x => [x.name, ''])] });
    } catch (e) { chartImgs = []; }
    if (I18N.isEn()) {
      sheets.forEach(sh => {
        sh.name = t(sh.name);
        sh.rows = sh.rows.map(r => r.map(v => (typeof v === 'string' ? I18N.plain(v) : v)));
      });
      chartImgs.forEach(x => { x.name = I18N.plain(x.name); });
    }
    const blob = MC.xlsx.build(sheets, chartImgs);
    /* через мост: в браузере — скачивание, в оболочке — системный диалог */
    window.MC_BRIDGE.saveBlob('motor-report.xlsx', blob).then(r => {
      if (r && r.ok && !r.fallback) setStatus(tf('файл сохранён: {p}', { p: r.path }), 'ok');
      else if (r && r.error) setStatus(tf('не удалось сохранить файл: {e}', { e: r.error }), 'bad');
    });
  }

  function exportCsv() {
    if (!lastRep) return;
    const sw = lastRep.sweep, m = lastRep.motor;
    const rows = ['load_pct;I_A;U_V;n_rpm;s_pct;f2_Hz;eta_pct;cosphi;P1_kW;P2_kW;dU_pct'];
    for (let i = 0; i < sw.load.length; i++) {
      rows.push([sw.load[i], sw.I[i], sw.U[i], sw.n[i], sw.s[i], sw.f2[i], sw.eta[i], sw.cos[i], sw.p1[i], sw.p2[i], sw.dU[i]]
        .map(v => Math.round(v * 1000) / 1000).join(';'));
    }
    const head = ['# ' + (m.catalog ? m.catalog.type : t('двигатель')), 'P2=' + m.p2 + ' kW', 'U=' + m.U + ' V', 'I=' + m.i.toFixed(2) + ' A'].join(';');
    window.MC_BRIDGE.saveText('motor-curves.csv', '\ufeff' + head + '\n' + rows.join('\n'), 'text/csv;charset=utf-8').then(r => {
      if (r && r.ok && !r.fallback) setStatus(tf('файл сохранён: {p}', { p: r.path }), 'ok');
      else if (r && r.error) setStatus(tf('не удалось сохранить файл: {e}', { e: r.error }), 'bad');
    });
  }

  /* ---------- цикл симуляции ---------- */
  let lastTs = 0;
  function loop(ts) {
    const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.12) : 0;
    lastTs = ts;
    if (simState && simState.running && !simState.done) {
      const stepT = dt * (+state.sim.speed || 1);
      S.advance(simState, stepT);
      if (ghostState && !ghostState.done) S.advance(ghostState, stepT);
      if (simState.done) { simState.running = false; simRunning = false; simFollow = false; }
      updateSimUI();
      if (state.tab === 'start') drawSimCharts();
    }
    requestAnimationFrame(loop);
  }

  /* ---------- тема ---------- */
  const mqLight = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  function effectiveTheme() {
    return state.theme === 'auto' ? (mqLight && mqLight.matches ? 'light' : 'dark') : state.theme;
  }

  /* Схемы оформления: id → название и «тон» (светлый/тёмный).
     Тон задаёт структурные правила CSS (html[data-tone]) и палитру графиков. */
  const THEME_LIST = [
    { id: 'dark', name: 'Тёмная', tone: 'dark' },
    { id: 'light', name: 'Светлая', tone: 'light' },
    { id: 'graphite', name: 'Графит', tone: 'dark' },
    { id: 'ocean', name: 'Океан', tone: 'dark' },
    { id: 'warm', name: 'Тёплая бумага', tone: 'light' },
    { id: 'auto', name: 'Как в системе', tone: 'auto' }
  ];
  const themeTone = id => (id === 'light' || id === 'warm') ? 'light' : 'dark';
  const swatchOf = id => ({
    dark: 'linear-gradient(135deg,#0c1118 50%,#46e0a5 50%)',
    light: 'linear-gradient(135deg,#ffffff 50%,#0f9d72 50%)',
    graphite: 'linear-gradient(135deg,#15181b 50%,#8fd6b4 50%)',
    ocean: 'linear-gradient(135deg,#0a1e30 50%,#4be0d0 50%)',
    warm: 'linear-gradient(135deg,#faf5ec 50%,#b1682f 50%)',
    auto: 'linear-gradient(135deg,#0c1118 50%,#ffffff 50%)'
  })[id] || '#888';

  function buildPalette() {
    const pop = $('#palettePop');
    if (!pop) return;
    pop.innerHTML = THEME_LIST.map(x => `
      <button class="palette-item" data-theme-id="${x.id}" role="menuitem">
        <span class="palette-sw" style="background:${swatchOf(x.id)}"></span>
        <span>${t(x.name)}</span><span class="chk">✓</span>
      </button>`).join('');
    updatePaletteUI();
  }

  function updatePaletteUI() {
    const pop = $('#palettePop');
    if (!pop) return;
    pop.querySelectorAll('.palette-item').forEach(b => b.classList.toggle('active', b.dataset.themeId === state.theme));
  }

  function paletteOpen() {
    const pop = $('#palettePop');
    return !!(pop && pop.classList.contains('show'));
  }

  function openPalette() {
    const pop = $('#palettePop'), btn = $('#btnPalette');
    if (!pop || !btn) return;
    buildPalette();
    pop.classList.add('show');
    const r = btn.getBoundingClientRect();
    const w = pop.offsetWidth || 200, h = pop.offsetHeight || 260;
    pop.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
    pop.style.top = (r.bottom + h + 16 > window.innerHeight ? Math.max(8, r.top - h - 8) : r.bottom + 8) + 'px';
    btn.setAttribute('aria-expanded', 'true');
  }

  function closePalette() {
    const pop = $('#palettePop');
    if (!pop || !pop.classList.contains('show')) return;
    pop.classList.remove('show');
    const btn = $('#btnPalette');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }

  function setTheme(id) {
    if (!THEME_LIST.some(x => x.id === id)) id = 'dark';
    state.theme = id;
    saveState();
    applyTheme();
  }

  function applyTheme(redraw) {
    const th = effectiveTheme();
    const tone = themeTone(th);
    document.documentElement.setAttribute('data-theme', th);
    document.documentElement.setAttribute('data-tone', tone);
    if (MC.setChartTheme) MC.setChartTheme(th);
    if (MC.PALETTES && MC.CHART_COLORS) Object.assign(MC.CHART_COLORS, MC.PALETTES[th] || MC.PALETTES[tone]);
    syncSeg('#segTheme', state.theme);
    updatePaletteUI();
    if (redraw !== false && lastRep) {
      render(lastRep);
      if (simState) drawSimCharts();
    }
  }

  /* ---------- язык ---------- */
  function syncLangUI() {
    syncSeg('#segLang', I18N.lang);
    document.documentElement.setAttribute('lang', I18N.lang);
  }
  /* полная перерисовка после смены языка: статику переводит i18n, динамику — рендер */
  function relang() {
    hideTip();
    syncLangUI();
    applyChartLabels();
    fillCatalog(true);
    fillBreakerSeries();
    fillBreakerCurves();
    syncInputs();
    renderRef();
    decorateTips();
    updateVisibility();
    updateSimVisibility();
    if (state.mode === 'catalog') applyCatalog(false);
    setCatInfo(D.MOTOR_DB.find(x => x.type === state.catType));
    /* полный пересчёт: заметки движка и статус тоже должны быть на новом языке */
    recalc();
    /* и перерисовка скрытых вкладок — иначе в них остаётся прежний язык */
    if (lastRep) {
      renderCableTab(lastRep);
      drawVTC(lastRep);
    }
    renderCompare();
    updateSimUI();
    if (simState) drawSimCharts(true);
    buildPalette();
    $('#footerStamp').textContent = new Date().toLocaleDateString(I18N.locale());
    moveUnderline();
  }

  /* ---------- мобильная панель ---------- */
  let drawerLastFocus = null;
  function openDrawer() {
    drawerLastFocus = document.activeElement;
    document.body.classList.add('drawer-open');
    setTimeout(() => {
      const first = $('#sidebar').querySelector('button, input, select, textarea, a[href]');
      if (first) first.focus();
    }, 40);
  }
  function closeDrawer() {
    document.body.classList.remove('drawer-open');
    if (drawerLastFocus && drawerLastFocus.focus) drawerLastFocus.focus();
  }


  /* ---------- обучение ---------- */
  const TOUR_KEY = 'motor-tour-v1';
  const TOUR_STEPS = [
    {
      desktop: '.sidebar .side-block', mobile: '#btnMenu',
      title: 'Параметры расчёта',
      text: 'Здесь задаются сеть, двигатель, нагрузка, кабель и защита. На телефоне панель открывается кнопкой «Параметры».'
    },
    {
      sel: '.loadbar',
      title: 'Нагрузка на валу',
      text: 'Двигайте ползунок — рабочая точка, ток, напряжение и графики пересчитываются сразу. 100 % — номинальный момент при номинальной скорости.'
    },
    {
      sel: '#kpis',
      title: 'Результаты',
      text: 'Ключевые параметры двигателя и итоговая строка: автомат, кабель, падение напряжения и статус проверок.'
    },
    {
      sel: '#tabs',
      title: 'Разделы',
      text: '«Графики» — характеристики, «Пуск» — переходные процессы, «Кабель и защита» — подробные таблицы, «Справочник» — формулы и база АИР.'
    },
    {
      tab: 'charts', sel: '#chartChips',
      title: 'Графики',
      text: 'Колесо — масштаб, перетаскивание — сдвиг, двойной клик — сброс. У каждого графика есть сброс масштаба и экспорт PNG. CSV и XLSX — выгрузка данных.'
    },
    {
      tab: 'start', sel: '.sim-control',
      title: 'Переходные процессы',
      text: 'Выберите способ пуска и нажмите «Пуск». Ниже — ток, момент, скорость и напряжение. В настройках можно наложить второй способ пунктиром.'
    },
    {
      sel: '.topbar-actions',
      title: 'Тема и отчёт',
      text: 'Переключение светлой и тёмной темы, повторный запуск обучения и кнопка «Печать / PDF» — отчёт с таблицами и графиками.'
    },
    {
      sel: null,
      title: 'Готово',
      text: 'Иконки «i» у полей и результатов открывают подсказки с формулами. Удачного расчёта!'
    }
  ];
  const tour = { active: false, i: 0, prevTab: 'calc', target: null };

  function tourStart() {
    if (tour.active) return;
    hideTip();
    tour.active = true;
    tour.lastFocus = document.activeElement;
    tour.i = 0;
    tour.prevTab = state.tab || 'calc';
    if (tour.prevTab !== 'calc') switchTab('calc');
    const layer = document.createElement('div');
    layer.className = 'tour-layer';
    layer.id = 'tourLayer';
    layer.innerHTML = '<div class="tour-hole" id="tourHole"></div><div class="tour-card" id="tourCard"></div>';
    document.body.appendChild(layer);
    tour.layer = layer;
    tour.hole = layer.querySelector('#tourHole');
    tour.card = layer.querySelector('#tourCard');
    tour.card.setAttribute('role', 'dialog');
    tour.card.setAttribute('aria-modal', 'true');
    tour.card.addEventListener('click', tourClick);
    document.addEventListener('keydown', tourKey);
    window.addEventListener('resize', tourPlace);
    window.addEventListener('scroll', tourPlace, true);
    tourShow();
  }

  function tourShow() {
    if (!tour.active) return;
    const step = TOUR_STEPS[tour.i];
    if (step.tab && state.tab !== step.tab) {
      switchTab(step.tab);
      requestAnimationFrame(function () { requestAnimationFrame(tourShow); });
      return;
    }
    const last = tour.i === TOUR_STEPS.length - 1;
    tour.card.innerHTML = tHtml(`<div class="tour-top"><span class="tour-step">${tour.i + 1} / ${TOUR_STEPS.length}</span><button class="tour-x" data-tour="skip" aria-label="Закрыть">×</button></div>
      <h4>${step.title}</h4><p>${step.text}</p>
      <div class="tour-dots">${TOUR_STEPS.map((_, k) => `<span class="tour-dot${k === tour.i ? ' on' : ''}"></span>`).join('')}</div>
      <div class="tour-actions"><button class="btn ghost" data-tour="skip">Пропустить</button>
      <div class="tour-nav">${tour.i > 0 ? '<button class="btn" data-tour="prev">Назад</button>' : ''}<button class="btn primary" data-tour="next">${last ? 'Готово' : 'Далее'}</button></div></div>`);
    const isMobile = window.innerWidth <= 980;
    const sel = isMobile && step.mobile ? step.mobile : (step.desktop || step.sel);
    const el = sel ? document.querySelector(sel) : null;
    tour.target = el;
    const focusBtn = tour.card.querySelector('button');
    if (focusBtn) setTimeout(() => focusBtn.focus(), 30);
    if (!el) {
      tour.card.classList.add('centered');
      tour.hole.style.display = 'none';
      return;
    }
    tour.card.classList.remove('centered');
    try { el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' }); } catch (e) { }
    requestAnimationFrame(function () { requestAnimationFrame(tourPlace); });
  }

  function tourPlace() {
    if (!tour.active) return;
    const el = tour.target;
    const card = tour.card, hole = tour.hole;
    if (!el || !card) {
      if (card) card.classList.add('centered');
      if (hole) hole.style.display = 'none';
      return;
    }
    const r = el.getBoundingClientRect();
    const pad = 6;
    hole.style.display = 'block';
    hole.style.left = (r.left - pad) + 'px';
    hole.style.top = (r.top - pad) + 'px';
    hole.style.width = (r.width + pad * 2) + 'px';
    hole.style.height = (r.height + pad * 2) + 'px';
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let left, top;
    if (window.innerWidth > 980 && r.right + cw + 26 < window.innerWidth) {
      left = r.right + 18;
      top = r.top;
    } else {
      left = Math.max(12, Math.min(r.left, window.innerWidth - cw - 12));
      top = r.bottom + 16;
      if (top + ch > window.innerHeight - 12) top = r.top - ch - 16;
    }
    left = Math.max(12, Math.min(left, window.innerWidth - cw - 12));
    top = Math.max(12, Math.min(top, window.innerHeight - ch - 12));
    card.style.left = left + 'px';
    card.style.top = top + 'px';
    card.style.transform = 'none';
  }

  function tourNext() {
    if (!tour.active) return;
    if (tour.i >= TOUR_STEPS.length - 1) { tourEnd(); return; }
    tour.i++;
    tourShow();
  }
  function tourPrev() {
    if (!tour.active || tour.i === 0) return;
    tour.i--;
    tourShow();
  }
  function tourEnd() {
    if (!tour.active) return;
    tour.active = false;
    if (tour.layer && tour.layer.parentNode) tour.layer.parentNode.removeChild(tour.layer);
    document.removeEventListener('keydown', tourKey);
    window.removeEventListener('resize', tourPlace);
    window.removeEventListener('scroll', tourPlace, true);
    try { localStorage.setItem(TOUR_KEY, '1'); } catch (e) { }
    if (tour.lastFocus && tour.lastFocus.focus) tour.lastFocus.focus();
    const back = tour.prevTab;
    if (back && back !== state.tab) switchTab(back);
  }
  function tourClick(e) {
    const b = e.target.closest('[data-tour]');
    if (!b) return;
    e.preventDefault();
    if (b.dataset.tour === 'next') tourNext();
    else if (b.dataset.tour === 'prev') tourPrev();
    else tourEnd();
  }
  function tourKey(e) {
    if (!tour.active) return;
    if (e.key === 'Escape') { e.preventDefault(); tourEnd(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); tourNext(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); tourPrev(); }
  }

  /* ---------- запуск ---------- */
  function encodeShare(s) {
    const copy = Object.assign({}, s);
    if (copy.projectLogo && copy.projectLogo.length > 20000) copy.projectLogo = '';
    const bytes = new TextEncoder().encode(JSON.stringify(copy));
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function copyText(text) {
    const done = () => setStatus(t('ссылка на расчёт скопирована'), 'ok');
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) { }
      ta.remove(); done();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else fallback();
  }

  function shareState() {
    try {
      const url = location.href.split(/[?#]/)[0] + '?p=' + encodeShare(state);
      window.__lastShare = url;
      copyText(url);
    } catch (e) {
      setStatus(t('не удалось создать ссылку'), 'bad');
    }
  }

  function parseLoadCurve(str) {
    const pts = String(str).split(/[;\n]+/).map(s => s.trim()).filter(Boolean).map(s => {
      const m = s.split(/[:;,]/).map(Number);
      if (m.length < 2 || !isFinite(m[0]) || !isFinite(m[1])) return null;
      return [Math.max(0, Math.min(150, m[0])), Math.max(0, Math.min(300, m[1]))];
    }).filter(Boolean).sort((a, b) => a[0] - b[0]);
    return pts.length >= 2 ? pts : null;
  }

  function loadCfg(pct) {
    return {
      type: state.loadType,
      pct: pct == null ? +state.loadPct : +pct,
      breakaway: 1.15,
      points: state.loadCurve,
      unload: +state.loadUnload,
      release: +state.loadRelease
    };
  }

  function init() {
    I18N.init();
    syncLangUI();
    initCharts();
    addChartTools();
    fillCatalog(true);
    if (state.mode === 'catalog') applyCatalog(false);
    syncInputs();
    bind();
    decorateTips();
    renderRef();
    moveUnderline();
    $('#footerStamp').textContent = new Date().toLocaleDateString(I18N.locale());
    I18N.onChange(relang);
    applyTheme(false);
    buildPalette();
    recalc();
    switchTab(state.tab || 'calc');
    requestAnimationFrame(loop);
    setTimeout(function () {
      if (tour.active || state.tab !== 'calc') return;
      let seen = false;
      try { seen = !!localStorage.getItem(TOUR_KEY); } catch (e) { }
      if (seen) return;
      const ae = document.activeElement;
      if (ae && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) return;
      tourStart();
    }, 1200);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
