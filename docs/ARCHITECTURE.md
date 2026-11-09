# Архитектура

## 1. Что это

Одностраничное офлайн-приложение на чистом HTML/CSS/JS. Исходники лежат в `src/`, сборщик `build.mjs` встраивает CSS и JS в единый `index.html`. В рантайме нет зависимостей, CDN, модулей и сетевых запросов.

```
src/index.html   разметка (шаблон)
src/style.css    оформление, темы, адаптив
src/data.js      справочники: АИР, кабели, аппараты
src/vtc.js       библиотека ВТХ и тепловые кривые
src/thermal.js   чистая тепловая проверка пуска
src/engine.js    расчётное ядро (без DOM)
src/sim.js       переходные процессы
src/charts.js    canvas-графики, зум, PNG (hLines/vLines, markerX/markerPoint)
src/xlsx.js      минимальный XLSX-писатель
src/i18n.js      переключение RU/EN: t/tf/tHtml, nf, translateDom
src/lang-en.js   словарь RU→EN (собирается из src/lang-en/*.js)
src/app.js       состояние, интерфейс, отчёт, проекты
build.mjs        инлайнит всё в index.html
index.html       СОБРАННЫЙ файл — не редактировать вручную
```

## 2. Сборка

```bash
npm run build          # → index.html
OUT=dist/app.html npm run build
```

`build.mjs`:

1. Читает `src/index.html`.
2. Заменяет `<link rel="stylesheet" href="style.css">` на `<style>…</style>`.
3. Для каждого скрипта из списка (`data.js`, `vtc.js`, `thermal.js`, `engine.js`, `charts.js`, `sim.js`, `xlsx.js`, `app.js`) заменяет `<script src="…">` на inline `<script>…</script>`.
4. Экранирует `</script>` внутри JS.
5. Пишет `index.html` (или `OUT`).

Важно: замена делается **функцией** `() => …`, а не строкой. Иначе `$$` в JS превращается в `$` и приложение ломается. Это уже ловили.

Собранный `index.html` коммитится, чтобы GitHub Pages и скачивание работали без сборки. CI проверяет, что после `npm run build` файл не изменился.

## 3. Модули и порядок загрузки

Порядок важен: каждый модуль добавляет себя в глобальный `MC`.

```js
window.MC = {}
MC_I18N    // t, tf, tHtml, nf, setLang, translateDom (из i18n.js)
MC_EN      // словарь RU→EN (lang-en.js), загружается до i18n.js
MC.data    // MOTOR_DB, кабели, аппараты
MC.engine  // buildMotor, buildReport, …
MC.thermal // start: пуск против тепловой зоны автомата
MC.sim     // createState, advance, compare
MC.Chart   // класс графика
MC.xlsx    // build(sheets)
// MC.app — не экспортируется; app.js сам инициализируется
```

### `data.js`

- `MOTOR_DB` — 54 записи АИР.
- Таблицы кабелей (медь/алюминий, ПУЭ/IEC).
- MCB/MCCB, контакторы, тепловые реле, предохранители.
- `estimateJ`, `nextUp/nextDown`, `nearestStdPower`.

### `engine.js`

- `buildMotor(cfg)` — модель двигателя.
- `torque`, `currentAt`, `solveSlip`, `peakTorque`.
- `operatingPoint`, `loadSweep`.
- `selectCable`, `voltageDrop`, `selectBreaker`, `selectContactor`, `selectThermal`, `selectFuse`.
- `scCheck`, `buildReport`.
- `startingCurrent`, `nextUp/nextDown`.

### `thermal.js`

- `start({ breaker, seriesId, Istart, cmp, startsPerHour })` — чистая тепловая проверка пуска.
- Возвращает `trip`, `ratio`, `level`, `duty`, `pending`, `incomplete`; без DOM, `state` и i18n.
- `app.js` оставляет тонкую обёртку `thermalStart(rep)`.

### `sim.js`

- `createState(motor, cfg)`.
- `stepOnce` / `advance` — интегрирование.
- `compare(motor, cfg)` — предрасчёт всех способов.
- `inertia`.

### `charts.js`

- Класс `Chart`: canvas, темы, оси, легенда, маркер, hover, зум/пан, PNG.
- `MC.CHART_THEMES`, `MC.PALETTES`.
- Один экземпляр на canvas; данные задаются `setData(series)`.

### `xlsx.js`

- Минимальный ZIP (без сжатия) + OOXML.
- `MC.xlsx.build([{name, rows, drawing?}], images) → Blob`.
- Строки — `inlineStr`, числа — числа, формулы — `{f, v}` с кэшем; `calcPr fullCalcOnLoad`; заголовок — стиль 1.
- Без внешних библиотек.

### `i18n.js` и `lang-en.js`

- Ключ словаря — **русская строка** ровно в том виде, как она стоит в `src/`.
  `t(s)` возвращает исходную строку в RU и перевод в EN, поэтому русский режим
  не меняет ни одного символа.
- `tf(s, vars)` — шаблон с `{подстановками}` (порядок слов в переводе свободный).
- `tHtml(html)` — перевод разметки: текстовые узлы и `title/placeholder/aria-label`.
- `translateDom(node)` — односторонний перевод готового поддерева; применяется в
  конце рендера (динамическая разметка собирается строками и переводится после
  вставки), а также к окну отчёта.
- `nf(v, d)` — числа в локали языка: `1 469,2` (ru) / `1,469.2` (en).
- Статическая разметка обходится один раз в `init()`: исходные строки
  запоминаются, чтобы при возврате на RU восстановить их без перезагрузки.
- Текст на canvas переводится до рисования — подписи осей и легенды берутся из
  `CHART_LABELS` / `CHART_ARIA` в `app.js` и пересобираются в `applyChartLabels()`.
- Словарь собирается из кусков `src/lang-en/*.js`:
  `node tools/i18n-assemble.cjs` (проверяет синтаксис и конфликты ключей).

### `app.js`

- `state` — всё состояние UI.
- `buildCfg()` — state → cfg для engine.
- `recalc()` — engine.buildReport + render.
- `render(rep)` — панели, KPI, графики, проверки.
- `renderCharts`, `drawSimCharts`.
- `bind()` — события.
- `init()` — старт (в т.ч. `I18N.init()` и `I18N.onChange(relang)`).
- `relang()` — полная перерисовка после смены языка.
- `syncLangUI()` — активная кнопка RU/EN и `html[lang]`.
- `openReport`, `exportCsv`, `exportXlsx` (листы «Исходные данные» и «Расчёт» с формулами).
- `saveProject/loadProject`, `rememberVariant`.
- `TIPS`, `decorateTips`, `showTip`.
- `TOUR_STEPS`, `tourStart` и т.д.

## 4. Состояние

`state` — один объект. Ключевые поля:

```js
{
  phases: 3, voltage: 380, freq: 50, conn: 'Y',
  mode: 'catalog'|'power'|'current'|'torque',
  catalogId, p2, current, torque, speedRpm, poles,
  motor1phType: 'capacitor'|'split'|'psc',
  autoTypical, eff, cos, slip, kst, mst, mmax,
  jMotor, motorClass, tauMotor, motorAmbient,
  loadType, loadPct, jExtra,
  cable: { standard, material, insulation, laying, length, ambient, group, loaded, parallel, considerStartDrop, startDropLimit, dropLimit },
  startMethod, breakerType, curve, mccbMag, upstreamIn, isc,
  sim: { tSwitch, tRamp, uStart, iLimit, speed, overlay },
  tab, theme
}
```

`localStorage`:

| Ключ | Что |
|---|---|
| `motor-calc-v1` | состояние (включая тему и вкладку) |
| `motor-variants-v1` | сохранённые варианты для сравнения |
| `motor-tour-v1` | мастер-тур пройден |

При загрузке состояние мержится с `DEFAULTS`; при изменении — `saveState()` (дебаунс).

## 5. Поток данных

```
UI-событие
  → setPath(state, …)
  → schedule() (дебаунс)
  → recalc()
      → buildCfg()
      → MC.engine.buildReport(cfg)
      → syncInputs()       // типовые значения обратно в поля
      → render(rep)
          → renderKpis / panels / verdict / warnings
          → renderCharts(rep)   // 5 статических
          → renderCableTab / compare
      → updateCompare()
```

Переходные процессы:

```
startSim()
  → MC.sim.createState(motor, simCfg())
  → requestAnimationFrame(loop)
      → MC.sim.advance(state, dt·speed)
      → updateSimUI()
      → drawSimCharts()
```

`compareData` считается `MC.sim.compare` отдельно (предрасчёт), чтобы таблица способов была стабильной.

## 6. Графики

Статические:

| График | X | Серии |
|---|---|---|
| M(n) | скорость | момент двигателя, момент нагрузки |
| I/U | нагрузка % | I, U |
| n/s/f₂ | нагрузка % | n, s, f₂ |
| η/cosφ | нагрузка % | η, cosφ×100 |
| P₁/P₂/ΔP | нагрузка % | мощности |

- `Chart` сам считает диапазоны, если не задан `xRange`/`minY`/`maxY`.
- Маркер `markerX` рисует вертикаль и точки на сериях (рабочая точка).
- `hLines` — горизонтальные линии (Mн, Iн).
- Зум/пан — `view` (`x0,x1,y0,y1,y20,y21`); `resetView()`.
- PNG — `toDataURL`, фон темы.
- Скрытая вкладка: `clientWidth = 0`; `resize()` подставляет 640×260 для отчёта.

Переходные:

| График | Серии |
|---|---|
| n(t) | n, s %, (второй способ: n) |
| I(t) | I, I/Iн, (второй: I) |
| M(t) | M двигателя, M нагрузки, (второй: M) |
| U(t) | U %, f, (второй: U) |

Наложение — `state.sim.overlay`; второй `ghostState` интегрируется параллельно; серии рисуются пунктиром `C.overlay`.

## 7. Интерфейс

- Вкладки: `Расчёт`, `Графики`, `Пуск`, `Кабель и защита`, `Справочник`.
- Сайдбар: сеть, двигатель, нагрузка, кабель, защита; на мобильном — drawer.
- Тёмная/светлая/авто тема: `html[data-theme]` + CSS-переменные.
- Подсказки: `TIPS` по id поля/результата; иконка «i»; на десктопе появляется при hover, на тач — по tap.
- Мастер-тур: 8 шагов, `localStorage`, кнопка «?» и кнопка в справочнике.
- Отчёт: новое окно, inline CSS, 5 PNG графиков, авто-печать.
- XLSX/CSV: Blob + `<a download>`.
- Проект: JSON `{version, savedAt, state}`; загрузка через `<input type=file>`.

## 8. Тесты и отладка

- `?debug=1` включает `window.__mcDebug = { state, rep, charts, sim, ghost, compare }`.
- Тесты используют этот объект, чтобы сверять данные графиков с расчётом.
- `tests/` — Playwright; `CHROME_PATH` — путь к Chrome/Chromium.
- `npm test` собирает и запускает все тесты.
- Подробнее — `docs/TESTING.md`.

## 9. Расширение

- Новый двигатель — `src/data.js` + тест + `docs/DATA.md`.
- Новый способ пуска — `src/sim.js` (`methodVoltage`, `compare`), UI, тест.
- Новая таблица — `src/data.js`, `engine.js`, панель, тест.
- Новый график — `charts.js` (экземпляр), `app.js` (renderCharts), HTML-панель, тест.
- Новая подсказка — `TIPS` + `TIP_FIELDS` больше не нужен: достаточно `TIPS[id]`.
- Новая тема — CSS-переменные + `MC.PALETTES`/`CHART_THEMES`.

Подробнее — `docs/DEVELOPMENT.md` и `docs/AGENTS.md`.
