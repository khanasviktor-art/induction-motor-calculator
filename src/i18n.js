/* ============================================================
   i18n: русский (по умолчанию) и английский
   ------------------------------------------------------------
   Ключ словаря — русская строка ровно в том виде, в каком она
   стоит в разметке или в коде. Поэтому русский режим ничего не
   переводит (t() возвращает исходную строку), а английский берёт
   перевод из window.MC_EN (src/lang-en.js).

     t('Параметры')                     точное совпадение
     tf('Пик пуска {i} А', {i: 206})    шаблон с подстановками
     tHtml('<b>Ток</b> 30 А')           перевод текста внутри HTML
     nf(1460, 0)                        число в locale языка
     u('кВт')                           единица измерения

   Динамическую разметку приложение собирает строками, поэтому её
   нужно переводить в момент вставки: tHtml / t / tf. Статическая
   разметка обходится один раз при старте (init) и хранит исходные
   строки, чтобы вернуться к русскому.
   ============================================================ */
(function () {
  'use strict';

  const LS_KEY = 'motor-calc-lang';
  const LOCALES = { ru: 'ru-RU', en: 'en-US' };
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
  const dict = (typeof window !== 'undefined' && window.MC_EN) || {};
  const CYR = /[\u0400-\u04FF]/;

  let lang = 'ru';
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved === 'en' || saved === 'ru') lang = saved;
  } catch (e) { }

  /* Исходные строки переводов: узел -> строка, элемент -> { атрибут: строка }.
     Хранятся для всех переведённых узлов (и статических, и динамических), чтобы
     при возврате на RU вернуть русский текст даже там, где перерисовки нет
     (кнопки инструментов графиков, aria-label подсказок и т.п.). */
  const origText = new WeakMap();
  const origAttr = new WeakMap();
  const listeners = [];

  function isEn() { return lang === 'en'; }

  /* --- строки ------------------------------------------------ */

  /* Числа в ключах записаны в русской локали, а на экране в EN-режиме они уже
     отформатированы nf() по-английски («29,4» → «29.4», «1 460» → «1,460»).
     Поэтому кроме точного совпадения ищем ключ, у которого все числа заменены
     на «#», и подставляем в перевод числа из исходной строки. */
  const NUM_RE = /\d+(?:[ \u00A0]\d{3})*(?:[.,]\d+)?/g;
  const NUM_TEST = /\d/;
  let digitIndex = null;

  function normDigits(s) { return s.replace(NUM_RE, '#'); }

  function buildDigitIndex() {
    digitIndex = new Map();
    Object.keys(dict).forEach(k => {
      if (!NUM_TEST.test(k)) return;
      const nk = normDigits(k);
      if (nk.indexOf('#') === -1) return;
      if (!digitIndex.has(nk)) digitIndex.set(nk, dict[k]);
    });
  }

  function translateByDigits(key) {
    if (!NUM_TEST.test(key)) return null;
    if (!digitIndex) buildDigitIndex();
    const tr = digitIndex.get(normDigits(key));
    if (tr === undefined) return null;
    const srcNums = key.match(NUM_RE) || [];
    const dstNums = tr.match(NUM_RE) || [];
    if (srcNums.length !== dstNums.length) return null;
    let i = 0;
    return tr.replace(NUM_RE, () => srcNums[i++]);
  }

  /* строка целиком: точное совпадение, числа по шаблону, «число + единица» */
  function translatePlain(text) {
    if (!isEn() || !text) return text;
    if (dict[text] !== undefined) return dict[text];
    const key = text.trim();
    if (!key) return text;
    if (dict[key] !== undefined) return text.replace(key, dict[key]);
    const byDigits = translateByDigits(key);
    if (byDigits !== null) return text.replace(key, byDigits);
    /* «400 А», «18.5 кВт» — число уже отформатировано nf(), переводим единицу */
    const m = /^(.*?[\d.,])\s([^\s]+)$/.exec(key);
    if (m) {
      let tail = m[2], punct = '';
      const pm = /^(.*?)([.,;:)]+)$/.exec(tail);
      if (pm && dict[pm[1]] !== undefined) { tail = pm[1]; punct = pm[2]; }
      if (dict[tail] !== undefined) return text.replace(key, m[1] + ' ' + dict[tail] + punct);
    }
    /* короткий токен с разделителем: «кВт ·», «А », «мм²,» */
    const tk = /^([^\s]{1,10})([\s·:;,/]*)$/.exec(key);
    if (tk && dict[tk[1]] !== undefined) return text.replace(tk[1], dict[tk[1]]);
    return text;
  }

  function t(s) {
    if (!isEn() || s == null) return s;
    const v = dict[s];
    return v === undefined ? s : v;
  }

  function tf(s, vars) {
    const src = t(s);
    if (!vars || typeof src !== 'string') return src;
    return src.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
  }

  const u = t;

  /* --- запоминание исходного текста -------------------------- */
  function rememberText(node) {
    const cur = node.nodeValue;
    const prev = origText.get(node);
    /* если приложение записало новый русский текст — обновляем запись */
    if (prev === undefined || (cur !== prev && CYR.test(cur))) origText.set(node, cur);
  }

  function rememberAttr(el, name) {
    const cur = el.getAttribute(name);
    let map = origAttr.get(el);
    if (!map) { map = {}; origAttr.set(el, map); }
    if (map[name] === undefined || (cur !== map[name] && CYR.test(cur))) map[name] = cur;
  }

  /* первый проход: запомнить всё русское в статической разметке */
  function rememberStatic() {
    const root = document.body;
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
    let node = walker.currentNode;
    while (node) {
      if (node.nodeType === 3) {
        const raw = node.nodeValue;
        if (raw && CYR.test(raw) && translatePlain(raw.trim()) !== raw.trim()) rememberText(node);
      } else if (node.nodeType === 1) {
        for (const a of ATTRS) {
          if (!node.hasAttribute(a)) continue;
          const v = node.getAttribute(a);
          if (CYR.test(v) && translatePlain(v) !== v) rememberAttr(node, a);
        }
      }
      node = walker.nextNode();
    }
  }

  /* применить текущий язык ко всему, что уже переводилось */
  function applyStored() {
    const root = document.body;
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
    let node = walker.currentNode;
    while (node) {
      if (node.nodeType === 3) {
        const src = origText.get(node);
        if (src !== undefined) {
          const key = src.trim();
          if (isEn()) {
            node.nodeValue = translateText(src);
          } else if (!CYR.test(node.nodeValue || '')) {
            /* на RU возвращаем исходник только там, где сейчас не русский текст */
            node.nodeValue = src;
          }
        }
      } else if (node.nodeType === 1) {
        const map = origAttr.get(node);
        if (map) for (const a in map) {
          const cur = node.getAttribute(a) || '';
          if (isEn()) node.setAttribute(a, translatePlain(map[a]));
          else if (!CYR.test(cur)) node.setAttribute(a, map[a]);
        }
      }
      node = walker.nextNode();
    }
  }

  function applyAll() {
    applyStored();
    document.title = t('Асинхронный двигатель — инженерный расчёт');
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', t('Расчёт мощности, тока, момента, кабеля и защиты асинхронного двигателя. Графики характеристик и переходные процессы пуска.'));
  }

  /* --- HTML-строки ------------------------------------------- */
  const holder = document.createElement('template');

  /* перевод текста узла: одна строка или многострочный блок (формулы) */
  function translateText(raw) {
    if (!raw) return raw;
    if (raw.indexOf('\n') !== -1) {
      return raw.split('\n').map(part => {
        const k = part.trim();
        if (!k) return part;
        const tr = translatePlain(k);
        return tr === k ? part : part.replace(k, tr);
      }).join('\n');
    }
    const key = raw.trim();
    if (!key) return raw;
    const tr = translatePlain(key);
    return tr === key ? raw : raw.replace(key, tr);
  }

  function translateNode(node) {
    if (node.nodeType === 3) {
      const raw = node.nodeValue;
      if (!raw || !CYR.test(raw)) return;
      rememberText(node);
      node.nodeValue = translateText(raw);
      return;
    }
    if (node.nodeType !== 1) return;
    for (const a of ATTRS) {
      if (!node.hasAttribute(a)) continue;
      const v = node.getAttribute(a);
      const tr = translatePlain(v);
      if (tr !== v) { rememberAttr(node, a); node.setAttribute(a, tr); }
    }
    for (let c = node.firstChild; c; c = c.nextSibling) translateNode(c);
  }

  function tHtml(html) {
    if (!isEn() || typeof html !== 'string' || !html) return html;
    if (html.indexOf('<') === -1) return translatePlain(html);
    holder.innerHTML = html;
    translateNode(holder.content);
    return holder.innerHTML;
  }

  /* --- язык -------------------------------------------------- */
  function setLang(next, opts) {
    const v = next === 'en' ? 'en' : 'ru';
    const force = !!(opts && opts.force);
    if (v === lang && !force) { applyAll(); return lang; }
    lang = v;
    try { localStorage.setItem(LS_KEY, lang); } catch (e) { }
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('data-lang', lang);
    /* сначала возвращаем/переводим уже известные узлы (в обе стороны),
       затем приложение перерисовывает динамику на нужном языке */
    applyAll();
    listeners.forEach(fn => { try { fn(lang); } catch (e) { console.error(e); } });
    applyAll();
    return lang;
  }

  function onChange(fn) { listeners.push(fn); }

  /* --- числа и даты ------------------------------------------ */
  function locale() { return LOCALES[lang] || LOCALES.ru; }

  function nf(v, d) {
    if (!isFinite(v)) return '—';
    if (d !== undefined && Math.abs(v) < Math.pow(10, -(d + 2))) v = 0;
    const opts = d === undefined ? {} : { minimumFractionDigits: d, maximumFractionDigits: d };
    return Number(v).toLocaleString(locale(), opts);
  }

  document.documentElement.setAttribute('lang', lang);
  document.documentElement.setAttribute('data-lang', lang);

  window.MC_I18N = {
    get lang() { return lang; },
    isEn, t, tf, tHtml, u, locale, nf, setLang, onChange,
    /* перевод произвольной строки: точное совпадение + правила чисел/единиц */
    plain: translatePlain,
    /* односторонний перевод готового поддерева (динамика после рендера) */
    translateDom: function (node) { if (isEn() && node) translateNode(node); },
    init: function () { rememberStatic(); applyAll(); }
  };
})();
