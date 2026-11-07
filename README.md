# Асинхронный двигатель — инженерный калькулятор

Офлайн-приложение для расчёта асинхронного двигателя: ток, мощность, момент, кабель, защита, графики характеристик и переходные процессы пуска. Один HTML-файл, без сервера, CDN и интернета.

**Версия:** 0.5.1 · **Лицензия:** MIT · **Сборка:** `index.html` (~280 КБ) · [![CI](https://github.com/khanasviktor-art/induction-motor-calculator/actions/workflows/ci.yml/badge.svg)](https://github.com/khanasviktor-art/induction-motor-calculator/actions/workflows/ci.yml)

![Графики](docs/screenshots/charts-default.png)

## Быстрый старт

1. Скачайте `index.html` и откройте двойным щелчком — всё работает офлайн.
2. Или откройте [GitHub Pages](https://khanasviktor-art.github.io/induction-motor-calculator/) (после включения Pages: **Settings → Pages → Deploy from branch → main / (root)**).
3. Для разработки:

```bash
npm ci
npm run build          # src/ → index.html
npm test               # сборка + Playwright
```

Если Chrome не в стандартном месте:

```bash
CHROME_PATH="/path/to/chrome" npm test
```

Подробнее — [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Публикация (имя репозитория, описание, topics, Pages, релиз) — [docs/PUBLISHING.md](docs/PUBLISHING.md).

## Возможности

**Расчёт**
- 54 типоразмера АИР (0,18…315 кВт, 2/4/6/8 полюсов; крупные — типовые, `*`).
- Четыре способа задания: каталог, мощность P₂, ток I, момент M и скорость.
- P₁, S, Q, Iн, Iп, Mн/Mп/Mmax, скольжение, f₂, КПД, cosφ, J, потери, температура.
- Рабочая точка 0…150 % нагрузки в реальном времени.
- Однофазные двигатели: конденсаторный, split, PSC — отдельные типовые кривые до 7,5 кВт (выше — предупреждение), 2 жилы, 1P, DOL/софтстартер/ПЧ.

**Кабель**
- Медь/алюминий, ПВХ/XLPE, 2/3 нагруженные жилы, открыто/лоток/труба/земля, температура, группировка.
- ПУЭ или IEC, 1…4 параллельных кабеля, PE.
- Выбор по нагреву, ΔU в работе и просадке при пуске.
- Проверка I²t при КЗ.

**Защита**
- MCB (B/C/D) или MCCB с отсечкой, Icu, тепловое реле, контактор, aM, УЗО.
- Проверка отсечки с учётом способа пуска и грубая селективность.

**Графики**
- M(n), I/U, n/s/f₂, η/cosφ, мощности.
- Зум/пан, PNG, CSV, XLSX всех таблиц.
- Наложение второго способа пуска на графики переходных процессов.

**Переходные процессы**
- DOL, Y–Δ, софтстартер, ПЧ, автотрансформатор.
- Живой режим, сравнение способов, осциллограммы n/I/M/U/f.

**Интерфейс**
- Светлая/тёмная/авто тема, мобильная версия.
- Мастер-тур при первом запуске (повтор — «?»).
- Подсказки ко всем полям, включая J нагрузки.
- Проект JSON, PDF-отчёт с графиками, варианты для сравнения.

## Документация

| Документ | Что внутри |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | модули, поток данных, состояние, графики, сборка |
| [docs/MODEL.md](docs/MODEL.md) | формулы, допущения, эталоны |
| [docs/LIMITATIONS.md](docs/LIMITATIONS.md) | **важные ограничения** и что делать |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | сборка, тесты, отладка, добавление данных |
| [docs/TESTING.md](docs/TESTING.md) | матрица тестов, эталонные значения, CI |
| [docs/DATA.md](docs/DATA.md) | схема справочников, добавление двигателей |
| [docs/AGENTS.md](docs/AGENTS.md) | контракт для AI-агентов, ловушки |
| [docs/PUBLISHING.md](docs/PUBLISHING.md) | имя репозитория, description, topics, Pages, релиз |
| [CONTRIBUTING.md](CONTRIBUTING.md) | как отправить PR |
| [CHANGELOG.md](CHANGELOG.md) | история версий |

## Структура

```
index.html              собранное приложение (коммитится)
src/
  index.html            разметка
  style.css             оформление, темы, адаптив
  data.js               АИР, кабели, аппараты
  engine.js             установившийся режим
  sim.js                переходные процессы
  charts.js             canvas, зум, PNG
  xlsx.js               XLSX без зависимостей
  app.js                состояние, UI, отчёт, проекты
build.mjs               инлайнит src/ → index.html
tests/                  Playwright: smoke, static, transient, features
docs/                   документация и скриншоты
.github/                CI и шаблоны issue/PR
```

## Тесты

```bash
npm test
```

- 14 статических сценариев (3ф/1ф, 2/6/8 полюсов, 60 Гц, 315 кВт, 150 %, 1ф 15 кВт).
- 5 способов пуска + наложение + 1 фаза.
- Тур, подсказки, темы, XLSX/CSV, проект, отчёт, зум/PNG, мобильный drawer.
- Проверяется совпадение данных графиков с расчётом, рабочая точка, `tStart`/пики, монотонность.

Текущий статус: **все тесты проходят**. Подробности — [docs/TESTING.md](docs/TESTING.md).

## Важные ограничения

Кратко; полный список — [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

- Это **инженерная оценка**, а не проектное заключение. Для ответственных приводов нужен расчёт специалиста.
- Модель двигателя — Клосс + добавка на пусковой момент; ток — по балансу мощности; тепловая модель однотельная.
- Крупные АИР и однофазные — **типовые** данные, не паспорт. Для точности вводите паспортные значения.
- Кабель/аппараты — справочные таблицы; селективность — грубая, не по время-токовым кривым.
- Ток при 100 % может быть на 1–2 % выше Iн из-за падения в кабеле; cosφ на графике — на зажимах.
- Кривая M(n) — при фактическом U рабочей точки; Mmax в таблице — при номинальном.
- Софтстартер с малым ограничением тока может честно не разгонять тяжёлую нагрузку; Y–Δ/AT могут дать бросок при переключении.
- Конденсатор для однофазного не подбирается; КЗ по схеме сети не считается.

## Разработка

- Исходники — `src/`; `index.html` генерируется и коммитится.
- Не редактируйте `index.html` вручную.
- Отладка: `index.html?debug=1` → `__mcDebug`.
- Стиль: ES2020, IIFE, без runtime-зависимостей, 2 пробела, LF.
- CI проверяет сборку, `git diff -- index.html` и тесты.

Подробнее — [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) и [docs/AGENTS.md](docs/AGENTS.md).

## Скриншоты

| Однофазный расчёт | Софтстартер 1ф |
|---|---|
| ![1 фаза](docs/screenshots/charts-onephase.png) | ![Софтстартер](docs/screenshots/soft-table-1ph.png) |

| 315 кВт | Светлая тема |
|---|---|
| ![315 кВт](docs/screenshots/charts-315.png) | ![Светлая тема](docs/screenshots/charts-light.png) |

Наложение DOL + ПЧ:

![Наложение](docs/screenshots/transient-overlay.png)

## Лицензия и авторы

MIT — см. [LICENSE](LICENSE). Copyright (c) 2026 Виктор Ханас.

Сделано с помощью **DeepSeek**. Идейный вдохновитель — **Виктор Ханас**, [khanas.viktor@gmail.com](mailto:khanas.viktor@gmail.com).

Если нужна другая лицензия — замените `LICENSE` и раздел в README.

## English summary

An offline single-file calculator for induction motors: current, power, torque, cable sizing, protection, performance charts, and starting transients. No runtime dependencies, no CDN, works from `file://` or GitHub Pages.

Build: `npm ci && npm run build` → `index.html`. Tests: `npm test` (Playwright, `CHROME_PATH` required if Chrome is not in the default location). See `docs/` for architecture, model, limitations, data, testing, and agent instructions. MIT license.

> Engineering estimate only. Verify against nameplate data, manufacturer catalogs, and applicable standards (IEC/ПУЭ). Not a substitute for a professional design.
