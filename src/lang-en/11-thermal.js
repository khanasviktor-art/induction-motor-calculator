/* 11-thermal — проверка пуска по тепловой части ВТХ автомата:
   вердикт, предупреждения, легенда и подпись графика. */
window.MC_EN = Object.assign(window.MC_EN || {}, {
  "пуск вне тепловой зоны": "start above the thermal zone",
  "пуск на границе тепловой зоны": "start at the thermal zone edge",
  "пуск {i} А / {t} с · автомат {tr} с": "start {i} A / {t} s · breaker {tr} s",
  "Отсечка {a}…{b} А": "Trip {a}…{b} A",
  "Отсечка {a} А": "Trip {a} A",
  "Кабель {s} мм²": "Cable {s} mm²",
  "Зона отсечки {a}…{b} А.": "Trip band {a}…{b} A.",
  "Тепловая зона при {i} А: {tr} с, пуск {ts} с.": "Thermal zone at {i} A: {tr} s, start {ts} s.",
  "Пуск не выходит за тепловую характеристику": "Start stays within the thermal curve",
  "Тепловой запас при {n} пусках/час": "Thermal margin at {n} starts/h",

  "Тепловая зона автомата: при {i} А он отключится за {tr} с, а пуск длится {ts} с — сработает по теплу. Уменьшите пусковой ток (софтстартер, ПЧ, Y–Δ) или возьмите аппарат с регулируемой тепловой защитой.":
    "Breaker thermal zone: at {i} A it trips in {tr} s, while the start takes {ts} s — it will trip on heat. Reduce the starting current (soft starter, VFD, Y–Δ) or use a device with an adjustable thermal trip.",
  "Пуск на границе тепловой зоны: автомат отключится за {tr} с, пуск — {ts} с (запас {k}×). При повторных пусках и нагретом автомате возможен расход.":
    "Start at the thermal zone edge: the breaker trips in {tr} s, the start takes {ts} s (margin {k}×). Repeated starts and a warm breaker may cause nuisance tripping.",
  "Пуск укладывается в тепловую зону: автомат отключится за {tr} с, пуск — {ts} с (запас {k}×).":
    "Start fits the thermal zone: the breaker trips in {tr} s, the start takes {ts} s (margin {k}×).",
  "{n} пусков/час: эквивалентный ток {ieq} А держится почти постоянно, автомат отключится по теплу за {t} с. Нужен аппарат с тепловой регулировкой или пауза между пусками.":
    "{n} starts/h: the equivalent current {ieq} A is nearly continuous, so the breaker trips on heat in {t} s. Use a device with a thermal adjustment or allow pauses between starts.",
  "{n} пусков/час: эквивалентный ток {ieq} А ниже тепловой границы — тепловая память автомата не приведёт к отключению.":
    "{n} starts/h: the equivalent current {ieq} A is below the thermal boundary — the breaker's thermal memory will not trip it."
});
