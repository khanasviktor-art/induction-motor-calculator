/* Мост между HTML-приложением и Electron.
   В браузере window.MC_SHELL отсутствует — приложение работает как обычно,
   поэтому одна и та же сборка index.html используется и в вебе, и в оболочке. */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('MC_SHELL', {
  platform: process.platform,
  /** { version, appVersion, platform, electron } */
  info: () => ipcRenderer.invoke('shell:info'),

  /** сохранить файл через диалог: { name, data (ArrayBuffer|Uint8Array|base64), encoding? } */
  saveFile: (name, data, encoding) => ipcRenderer.invoke('shell:save-file', { name, data, encoding }),

  /** открыть проект: null | { path, text } */
  pickFile: () => ipcRenderer.invoke('shell:pick-file'),

  /** сохранить PDF текущего окна: { ok, path } */
  savePdf: () => ipcRenderer.invoke('shell:save-pdf'),

  /** отчёт: готовый HTML → PDF через системный диалог: { ok, path } */
  savePdfFromHtml: (html, name) => ipcRenderer.invoke('shell:save-pdf-html', { html, name }),

  /* события меню (Файл → …) */
  onMenu: (handler) => {
    const map = {
      'shell:open-project': 'openProject',
      'shell:save-project': 'saveProject',
      'shell:print': 'print'
    };
    Object.keys(map).forEach(channel => {
      ipcRenderer.on(channel, () => {
        try { handler(map[channel]); } catch (e) { }
      });
    });
  },

  onDownloadFailed: (handler) => {
    ipcRenderer.on('shell:download-failed', (e, payload) => {
      try { handler(payload); } catch (err) { }
    });
  }
});
