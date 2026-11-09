/* 09-units — шаблоны «число + единица со скобками», которые собираются в коде
   через tf(): кратности Iн/Mн и поправочные коэффициенты. */
window.MC_EN = Object.assign(window.MC_EN || {}, {
  "А  ({k}×Iн)": "A  ({k}×Iₙ)",
  "А ({k}×Iн)": "A ({k}×Iₙ)",
  "Н·м ({k}×Mн)": "N·m ({k}×Mₙ)",
  "мм²  {m}": "mm²  {m}",
  "А  (k = {k})": "A  (k = {k})",
  " / {v}×Iн": " / {v}×Iₙ",
  " ({k}×Iн)": " ({k}×Iₙ)",
  "кривая {c}": "curve {c}",
  "Асинхронный двигатель — расчёт": "Induction motor — calculation",
  "Однофазный двигатель": "Single-phase motor",
  "Двигатель": "Motor",
  " · оценка (типовые данные до 7,5 кВт)": " · estimate (typical data up to 7.5 kW)",
  "Однофазный двигатель {p} кВт — редкий случай: типовые данные до 11 кВт ориентировочные, выше — оценка. Для такой мощности обычно применяют 3 фазы или специальный двигатель.": "A {p} kW single-phase motor is a rare case: typical data up to 11 kW are approximate, above that it is an estimate. For such power, three phases or a special motor are usually used.",
  "Отсечка {m} А может сработать при пуске: расчётный ток для способа «{meth}» — {i} А. ": "Instantaneous trip {m} A may operate on start: the design current for the “{meth}” method is {i} A. "
});
