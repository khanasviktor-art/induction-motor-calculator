/* Дополнения к оболочке: сохранение PDF из HTML и «тихое» сохранение
   в каталог (для автотеста и для тех, кому не нужны диалоги). */
'use strict';

const { BrowserWindow, dialog, ipcMain, app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

/* Каталог «тихого» сохранения: если задан — диалоги не показываются,
   файлы пишутся туда (используется tests/desktop.mjs и может пригодиться
   для пакетной работы). */
const SAVE_DIR = process.env.MC_SAVE_DIR || null;

function uniquePath(dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let p = path.join(dir, name);
  let i = 2;
  while (fs.existsSync(p)) { p = path.join(dir, base + '-' + i + ext); i++; }
  return p;
}

/* путь сохранения: MC_SAVE_DIR или системный диалог */
function pickPath(suggestedName, filters) {
  if (SAVE_DIR) return uniquePath(SAVE_DIR, suggestedName);
  const res = dialog.showSaveDialogSync({
    title: 'Сохранить файл',
    defaultPath: path.join(app.getPath('documents'), suggestedName),
    filters: filters || undefined,
    buttonLabel: 'Сохранить'
  });
  return res || null;
}

/* ---------- PDF из готового HTML отчёта ------------------------------- */
async function pdfFromHtml(html, name) {
  const target = pickPath(name || 'report.pdf', [{ name: 'PDF', extensions: ['pdf'] }]);
  if (!target) return { ok: false, canceled: true };

  /* печать в PDF не должна запускать window.print() из самого отчёта */
  const clean = String(html).replace(/<script>[\s\S]*?<\/script>/gi, '');
  const tmp = path.join(os.tmpdir(), 'mc-report-' + Date.now() + '.html');
  fs.writeFileSync(tmp, clean, 'utf8');

  let win = null;
  try {
    win = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true, javascript: false, contextIsolation: true, nodeIntegration: false }
    });
    await win.loadFile(tmp);
    const data = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'custom', top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
    });
    fs.writeFileSync(target, data);
    return { ok: true, path: target, bytes: data.length };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  } finally {
    try { if (win && !win.isDestroyed()) win.destroy(); } catch (e) { }
    try { fs.unlinkSync(tmp); } catch (e) { }
  }
}

ipcMain.handle('shell:save-pdf-html', async (event, payload) => {
  const html = payload && payload.html;
  const name = (payload && payload.name) || 'report.pdf';
  if (!html) return { ok: false, error: 'empty html' };
  return pdfFromHtml(html, name);
});

module.exports = { SAVE_DIR, pickPath, pdfFromHtml };
