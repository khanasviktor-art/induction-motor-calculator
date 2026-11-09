/* Мост HTML ↔ Electron.
   В браузере window.MC_SHELL отсутствует, поэтому все функции сохранения
   работают как раньше (ссылка с download). В настольной версии те же вызовы
   идут в системный диалог через fs — без download-менеджера Chromium,
   который в Electron теряет файлы blob:/data:.
   Расчёт и интерфейс сюда не попадают. */
(function () {
  'use strict';
  const S = (typeof window !== 'undefined' && window.MC_SHELL) || null;

  function stamp(prefix, ext) {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return prefix + '-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.' + ext;
  }

  function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }

  /* запасной путь браузера: ссылка с download */
  function anchor(name, href) {
    const a = document.createElement('a');
    a.download = name;
    a.href = href;
    a.click();
    return { ok: true, fallback: true };
  }

  async function saveBlob(name, blob) {
    if (S && S.saveFile) {
      try {
        const buf = await blob.arrayBuffer();
        return await S.saveFile(name, toBase64(buf), 'base64');
      } catch (e) {
        return { ok: false, error: String(e && e.message || e) };
      }
    }
    const url = URL.createObjectURL(blob);
    const r = anchor(name, url);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    return r;
  }

  function saveText(name, text, mime) {
    return saveBlob(name, new Blob([text], { type: mime || 'text/plain;charset=utf-8' }));
  }

  function saveDataUrl(name, dataUrl) {
    if (S && S.saveFile) {
      try {
        const comma = String(dataUrl).indexOf(',');
        const head = String(dataUrl).slice(0, comma);
        const data = String(dataUrl).slice(comma + 1);
        if (/;base64/i.test(head)) return S.saveFile(name, data, 'base64');
        return saveText(name, decodeURIComponent(data));
      } catch (e) {
        return Promise.resolve({ ok: false, error: String(e && e.message || e) });
      }
    }
    return Promise.resolve(anchor(name, dataUrl));
  }

  window.MC_BRIDGE = {
    get isShell() { return !!S; },
    get platform() { return S ? S.platform : 'web'; },

    /* Отчёт: в оболочке — PDF-файл через системный диалог,
       в браузере — новое окно с печатью (как раньше). */
    async printReport(html) {
      if (S && S.savePdfFromHtml) {
        try {
          return await S.savePdfFromHtml(html, stamp('motor-report', 'pdf'));
        } catch (e) {
          return { ok: false, error: String(e && e.message || e) };
        }
      }
      const w = window.open('', '_blank');
      if (!w) { window.print(); return { ok: false, fallback: true }; }
      w.document.open();
      w.document.write(html);
      w.document.close();
      return { ok: true, fallback: true };
    },

    saveBlob, saveText, saveDataUrl
  };
})();
