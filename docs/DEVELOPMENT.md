# Разработка

## 1. Требования

- Node.js **≥ 18** (проверено на 20/22/26).
- Chrome/Chromium для тестов (Playwright-core управляет системным браузером).
- Никаких runtime-зависимостей: приложение — один HTML.

## 2. Установка и сборка

```bash
cd motor-calc
npm ci                 # только devDependencies (playwright-core)
npm run build          # → index.html
```

Открыть `index.html` двойным щелчком или:

```bash
python3 -m http.server 8080
# http://localhost:8080/
```

`index.html` — **сгенерированный** файл. Правки в него не вносятся: они потеряются при следующей сборке. Меняйте `src/`.

Сборка с другим именем:

```bash
OUT=dist/app.html npm run build
```

## 3. Тесты

```bash
npm test               # сборка + все тесты
npm run test:smoke
npm run test:static
npm run test:transient
npm run test:features
```

Тесты используют Playwright-core и **системный Chrome**. Путь по умолчанию:

- macOS: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- Linux: `/usr/bin/google-chrome`
- Windows: `C:\Program Files\Google\Chrome\Application\chrome.exe`

Если браузер в другом месте:

```bash
CHROME_PATH="/path/to/chrome" npm test
```

В CI используется `browser-actions/setup-chrome`, путь передаётся через `CHROME_PATH`.

Подробнее — `docs/TESTING.md`.

## 4. Отладка

Откройте приложение с параметром:

```
index.html?debug=1
```

В консоли:

```js
__mcDebug.state      // текущее состояние
__mcDebug.rep        // последний отчёт: motor, sweep, op, cable, breaker, checks
__mcDebug.charts     // экземпляры Chart: series, opts, view
__mcDebug.sim        // текущее состояние симуляции (после Пуск)
__mcDebug.ghost      // второй способ (наложение)
__mcDebug.compare    // предрасчёт способов пуска
```

Полезные проверки:

```js
__mcDebug.rep.sweep.cos[100]        // cosφ при 100 %
__mcDebug.charts.eff.series[1].data // cosφ×100 на графике
__mcDebug.rep.op                    // рабочая точка
__mcDebug.charts.torque.opts        // markerX, xRange, hLines
```

Без `?debug=1` глобального объекта нет.

## 5. Типовые задачи

### Добавить двигатель в каталог

1. Откройте `src/data.js`, массив `MOTOR_DB`.
2. Добавьте запись:
   ```js
   { type: 'АИР…', p2: 7.5, poles: 4, n: 1450, eff: 87.5, cos: 0.86, kst: 6.5, mst: 2.0, mmax: 2.2, typical: true }
   ```
3. `typical: true` — если данные типовые, а не паспорт.
4. Проверьте, что группа полюсов имеет достаточное число точек для интерполяции (особенно 2/6/8 полюсов).
5. Добавьте сценарий в `tests/charts-static.mjs` или проверьте вручную.
6. Обновите `docs/DATA.md`.

### Изменить формулу

1. `src/engine.js` / `src/sim.js`.
2. Обновите `docs/MODEL.md` и `docs/LIMITATIONS.md`.
3. Пересчитайте эталоны в `docs/TESTING.md` и тестах.
4. `npm test`.

### Добавить поле/подсказку

1. HTML: `<div class="field">…<input id="newField">…</div>`.
2. `state` + `DEFAULTS` + `syncInputs` + `bind`.
3. `buildCfg`.
4. Подсказка: добавьте `newField: '…'` в `TIPS`; иконка появится автоматически (фильтра `TIP_FIELDS` больше нет).
5. Тест + скриншот.

### Добавить способ пуска

1. `src/sim.js`: `methodVoltage`, `compare`, `startingCurrent` (если нужно).
2. HTML: `<option>`.
3. `src/app.js`: `methodLabel`, ограничения для 1 фазы, `sim` настройки.
4. Тест в `tests/charts-transient.mjs`.
5. `docs/MODEL.md`.

### Изменить график

1. `src/charts.js` — класс/серии.
2. `src/app.js` — `renderCharts`/`drawSimCharts`.
3. Проверьте `data` → `series` (тест сверяет с `rep.sweep`).
4. Скриншот + `docs/ARCHITECTURE.md`.

## 6. Соглашения

- ES2020, без модулей в рантайме: каждый файл — IIFE, добавляет в `MC`.
- Никаких CDN, внешних шрифтов, сетевых запросов.
- Не добавляйте runtime-зависимости. Dev-зависимости — только для тестов.
- Идентификаторы — английские; UI и комментарии — русские.
- Отступы 2 пробела; LF.
- Не редактируйте `index.html`.
- Сохраняйте кредит «Сделано с помощью DeepSeek · Виктор Ханас · khanas.viktor@gmail.com».
- Не ломайте офлайн-режим и работу с `file://`.

## 7. Сборка и релиз

1. Обновите версию:
   - `package.json`;
   - `src/index.html` (`meta version`, footer);
   - `src/app.js` (отчёт);
   - `CHANGELOG.md`.
2. `npm run build`.
3. `npm test`.
4. Обновите скриншоты в `docs/screenshots/` (если UI менялся).
5. `git add -A && git commit -m "release: vX.Y.Z"`.
6. `git tag vX.Y.Z && git push --tags`.

CI проверит, что `index.html` соответствует `src/` и что тесты проходят.

## 8. Частые проблемы

| Симптом | Причина / решение |
|---|---|
| `Identifier '$' has already been declared` | В `build.mjs` замена строкой; используйте функцию `() =>`. |
| График пуст в отчёте | Скрытая вкладка, `clientWidth = 0`; `resize()` подставляет 640×260. |
| График не изменился | `setData` вызван, но `resize`/`draw` не было; проверьте `renderCharts`. |
| Тест не находит Chrome | Укажите `CHROME_PATH`. |
| Тур мешает тесту | `localStorage.setItem('motor-tour-v1','1')` до загрузки. |
| Однофазный каталог | Каталог скрыт; используйте режим P₂ и тип однофазного. |
| Софтстартер «не выходит на скорость» | Ограничение тока мало для нагрузки; увеличьте `Iогр` или выберите ПЧ. |
| `cosφ` на графике выше паспорта | График — на зажимах при фактическом U; это нормально при ΔU. |
| Mmax на графике ниже таблицы | Кривая при U рабочей точки; Mmax в таблице — при номинальном U. |

## 9. Структура репозитория

```
index.html              собранное приложение (коммитится)
src/                    исходники
docs/                   архитектура, модель, ограничения, тесты, данные, агенты
tests/                  Playwright-тесты
.github/                CI и шаблоны
build.mjs               сборщик
package.json            скрипты и devDependencies
```

## 10. Кто за что отвечает

- `engine.js` — инженерия установившегося режима.
- `sim.js` — динамика.
- `charts.js` — отрисовка.
- `app.js` — состояние/UI.
- `data.js` — справочники.
- `xlsx.js` — экспорт.

При сомнениях сначала читайте `docs/MODEL.md` и `docs/LIMITATIONS.md`.
