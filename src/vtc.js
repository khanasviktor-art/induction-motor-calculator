/* ============================================================
   Библиотека ВТХ: IEK / CHINT / ABB, MCB + MCCB.
   Точки — по стандартным зонам IEC 60898-1 / IEC 60947-2
   и каталожным кратностям отсечки. Источники — docs/VTC_SOURCES.md.
   ============================================================ */
(function (root) {
  'use strict';
  const MC = root.MC = root.MC || {};

  const SERIES = [
    {
      id: 'iek-ba47-29', brand: 'IEK', series: 'ВА47-29', type: 'mcb',
      standard: 'IEC 60898-1', ratings: [6, 10, 16, 20, 25, 32, 40, 50, 63], icu: 4.5,
      curves: ['B', 'C', 'D'], mag: { B: [3, 5], C: [5, 10], D: [10, 20] },
      source: 'https://www.iek.ru/products/catalog/modulnoe_oborudovanie/modulnoe_oborudovanie_karat/modulnye_avtomaticheskie_vyklyuchateli_karat/modulnye_avtomaticheskie_vyklyuchateli_va47_29'
    },
    {
      id: 'iek-ba47-100', brand: 'IEK', series: 'ВА47-100', type: 'mccb',
      standard: 'IEC 60947-2', ratings: [16, 20, 25, 32, 40, 50, 63, 80, 100], icu: 6,
      curves: ['TMD'], mag: { TMD: [10, 10] },
      source: 'https://www.iek.ru/products/catalog/modulnoe_oborudovanie/modulnoe_oborudovanie_karat/modulnye_avtomaticheskie_vyklyuchateli_karat/modulnye_avtomaticheskie_vyklyuchateli_va47_100'
    },
    {
      id: 'chint-nb1-63', brand: 'CHINT', series: 'NB1-63', type: 'mcb',
      standard: 'IEC 60898-1', ratings: [6, 10, 16, 20, 25, 32, 40, 50, 63], icu: 6,
      curves: ['B', 'C', 'D'], mag: { B: [3, 5], C: [5, 10], D: [10, 20] },
      source: 'https://www.chintglobal.com/content/dam/chint/global/product-center/low-voltage/iec/final-power-distribution/mcb/nb1-63/catalog/NB1-63-MCB-Catalog.pdf'
    },
    {
      id: 'chint-nm1-250', brand: 'CHINT', series: 'NM1-250', type: 'mccb',
      standard: 'IEC 60947-2', ratings: [100, 125, 160, 180, 200, 225, 250], icu: 35,
      curves: ['TMD'], mag: { TMD: [10, 10] },
      source: 'https://chintglobal.mx/catalogos/NM1.pdf'
    },
    {
      id: 'abb-s200', brand: 'ABB', series: 'S200', type: 'mcb',
      standard: 'IEC 60898-1', ratings: [6, 10, 16, 20, 25, 32, 40, 50, 63], icu: 6,
      curves: ['B', 'C', 'D', 'K', 'Z'], mag: { B: [3, 5], C: [5, 10], D: [10, 20], K: [10, 14], Z: [2, 3] },
      source: 'https://search.abb.com/library/Download.aspx?DocumentID=9AKK108472A1994&LanguageCode=en&DocumentPartId=&Action=Launch'
    },
    {
      id: 'abb-tmax-xt', brand: 'ABB', series: 'Tmax XT', type: 'mccb',
      standard: 'IEC 60947-2', ratings: [16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250], icu: 36,
      curves: ['TMD', 'TMA'], mag: { TMD: [10, 10], TMA: [5, 10] },
      source: 'https://library.e.abb.com/public/3c630a4c4dfa4e368f515c2b71aae874/1SDC210100D0206_Tmax%20XT_Katalog%20wylacznikow_2024_09.pdf'
    }
  ];

  function get(id) { return SERIES.find(s => s.id === id) || SERIES.find(s => s.id === 'abb-s200'); }
  function list() { return SERIES.map(s => ({ id: s.id, brand: s.brand, series: s.series, type: s.type, ratings: s.ratings.slice(), curves: s.curves.slice(), icu: s.icu })); }

  function thermalPoints(s, curve, In) {
    const m = s.mag[curve] || [10, 20];
    const long = In > 32 ? 120 : 60;
    if (s.type === 'mcb') {
      return [
        [1.13 * In, 3600], [1.45 * In, 600], [2.55 * In, long],
        [m[0] * In, 0.1], [m[1] * In, 0.02]
      ];
    }
    return [
      [1.05 * In, 3600], [1.3 * In, 600],
      [m[0] * In, 0.1], [m[1] * In, 0.02]
    ];
  }

  function pickIn(s, I) {
    const vals = s.ratings;
    for (const v of vals) if (v >= I) return v;
    return vals[vals.length - 1];
  }

  function selectivity(down, up, Isc) {
    if (!down || !up) return { ok: true, ratio: 0 };
    const ImD = Math.min(down.mag[0] * down.In, down.mag[1] * down.In);
    const ImU = Math.min(up.mag[0] * up.In, up.mag[1] * up.In);
    const ratio = ImU / Math.max(ImD, 1);
    return { ok: ratio >= 1.25, ratio: ratio };
  }

  MC.vtc = { SERIES, get, list, thermalPoints, pickIn, selectivity };
})(globalThis);
