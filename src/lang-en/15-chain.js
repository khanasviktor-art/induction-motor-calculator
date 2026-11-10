/* 15-chain — селективность 2–3 аппаратов: подписи цепочки. */
window.MC_EN = Object.assign(window.MC_EN || {}, {
  "Вышестоящий 1, А": "Upstream 1, A",
  "Вышестоящий 2, А": "Upstream 2, A",
  "Вышестоящий 1": "Upstream 1",
  "Вышестоящий 2": "Upstream 2",
  "Вышестоящий {n}": "Upstream {n}",
  "Вышестоящий {n}: {i} А": "Upstream {n}: {i} A",
  "аппаратов: {n}": "devices: {n}",
  "Селективность цепочки ({n} ап.)": "Chain selectivity ({n} devices)",
  "Селективность {r}× {ok} ({n} ап.).": "Selectivity {r}× {ok} ({n} devices).",
  "отсечка {a} А": "trip {a} A",
  "на границе": "at the edge",
  "селективность на границе": "selectivity at the edge",
  "Селективность цепочки ({n} ап.) обеспечена: минимальное отношение отсечек {k}× ≥ 1,6 ({a} А → {b} А).":
    "Chain selectivity ({n} devices) is provided: the smallest trip ratio is {k}× ≥ 1.6 ({a} A → {b} A).",
  "Селективность нарушена в паре {a} А → {b} А: отношение отсечек {k}× (нужно ≥ 1,6). Увеличьте номинал вышестоящего аппарата.":
    "Selectivity fails for the pair {a} A → {b} A: trip ratio {k}× (needs ≥ 1.6). Increase the upstream device rating.",
  "Селективность на границе: в паре {a} А → {b} А отношение отсечек {k}× — чуть меньше 1,6. Формально проходит, но при КЗ возможен одновременный сброс; лучше взять вышестоящий на ступень больше.":
    "Selectivity is at the edge: for the pair {a} A → {b} A the trip ratio is {k}× — just below 1.6. It formally passes, but a short circuit may trip both; take the upstream device one step higher."
});
