/* Настольная оболочка (Electron) вокруг собранного index.html.
   Здесь только системная часть: окно, меню, печать в PDF, сохранение
   скачиваемых файлов, запоминание размера окна. Расчёт и интерфейс —
   в app/index.html (собирается из ../src командой npm run build:desktop). */
'use strict';

const { app, BrowserWindow, Menu, dialog, shell, ipcMain, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const save = require('./save');

/* порт отладки: нужен автотесту (tests/desktop.mjs). Ставим switch до app.ready,
   иначе Chromium его не увидит — и работаем и по аргументу, и по переменной */
const DEBUG_PORT = (() => {
  const fromArg = process.argv.find(a => a.indexOf('--remote-debugging-port=') === 0);
  if (fromArg) return fromArg.split('=')[1];
  if (process.env.MC_DEBUG_PORT) return process.env.MC_DEBUG_PORT;
  return null;
})();
if (DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', String(DEBUG_PORT));

const APP_FILE = path.join(__dirname, 'app', 'index.html');
const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');
const isDev = !app.isPackaged;

/* ---------- запоминание окна ------------------------------------------- */
const DEFAULT_BOUNDS = { width: 1360, height: 900 };

function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'));
    if (s && typeof s === 'object') return s;
  } catch (e) { }
  return {};
}

function writeState(s) {
  try { fs.writeFileSync(STATE_FILE(), JSON.stringify(s, null, 2), 'utf8'); } catch (e) { }
}

/* окно не должно открыться за пределами экрана после смены монитора */
function visibleBounds(saved) {
  const { screen } = require('electron');
  const bounds = Object.assign({}, DEFAULT_BOUNDS, saved);
  const displays = screen.getAllDisplays();
  const inside = displays.some(d => {
    const a = d.workArea;
    return bounds.x !== undefined && bounds.y !== undefined &&
      bounds.x < a.x + a.width - 80 && bounds.x + bounds.width > a.x + 80 &&
      bounds.y < a.y + a.height - 80 && bounds.y + bounds.height > a.y + 40;
  });
  if (!inside) { delete bounds.x; delete bounds.y; }
  bounds.width = Math.max(900, Math.min(bounds.width || DEFAULT_BOUNDS.width, 4000));
  bounds.height = Math.max(600, Math.min(bounds.height || DEFAULT_BOUNDS.height, 3000));
  return bounds;
}

let mainWindow = null;
const reportWindows = new Set();
let lastSaveDir = null;

/* ---------- окно приложения -------------------------------------------- */
function createWindow() {
  const saved = visibleBounds(readState());
  mainWindow = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    x: saved.x,
    y: saved.y,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d1319' : '#eef2f7',
    title: 'Асинхронный двигатель — инженерный расчёт',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  if (saved.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => mainWindow.show());

  /* отчёт открывается через window.open('', '_blank') + document.write */
  mainWindow.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: {
      width: 980,
      height: 1000,
      minWidth: 720,
      minHeight: 600,
      autoHideMenuBar: true,
      backgroundColor: '#ffffff',
      webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false }
    }
  }));

  mainWindow.webContents.on('did-create-window', (win) => {
    reportWindows.add(win);
    win.on('closed', () => reportWindows.delete(win));
    updateMenu();
  });

  /* внешние ссылки — в системном браузере, не в приложении */
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 980, height: 1000, autoHideMenuBar: true, backgroundColor: '#ffffff',
        webPreferences: { contextIsolation: true, nodeIntegration: false }
      }
    };
  });

  mainWindow.on('close', () => {
    const b = mainWindow.getNormalBounds ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    writeState({
      width: b.width, height: b.height, x: b.x, y: b.y,
      maximized: mainWindow.isMaximized()
    });
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  if (!fs.existsSync(APP_FILE)) {
    dialog.showErrorBox('Нет файла приложения',
      'Не найден app/index.html.\nСоберите его: npm run build:desktop (в корне проекта).');
    app.quit();
    return;
  }
  mainWindow.loadFile(APP_FILE);
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

/* ---------- скачивания: спрашиваем, куда сохранить --------------------- */
function installDownloads() {
  const { session } = require('electron');
  session.defaultSession.on('will-download', (event, item, webContents) => {
    const suggested = item.getFilename() || 'file';
    console.log('[download] start:', suggested, item.getURL().slice(0, 60));
    /* MC_SAVE_DIR: без диалогов (автотест, пакетная работа) */
    const target = save.SAVE_DIR ? save.pickPath(suggested) : (() => {
      const dir = lastSaveDir || app.getPath('downloads');
      const chosen = dialog.showSaveDialogSync({
        title: 'Сохранить файл',
        defaultPath: path.join(dir, suggested),
        buttonLabel: 'Сохранить'
      });
      if (chosen) lastSaveDir = path.dirname(chosen);
      return chosen;
    })();
    if (!target) { item.cancel(); return; }
    item.setSavePath(target);
    console.log('[download] save to:', target, 'dir=', save.SAVE_DIR);
    item.once('done', (e, state) => {
      console.log('[download] done:', state, 'bytes=', item.getReceivedBytes(), 'path=', item.getSavePath());
      if (state !== 'completed' && webContents && !webContents.isDestroyed()) {
        webContents.send('shell:download-failed', { state, target });
      }
    });
  });
}

/* ---------- печать отчёта в PDF ---------------------------------------- */
async function savePdf(win) {
  const target = dialog.showSaveDialogSync(win || mainWindow, {
    title: 'Сохранить отчёт в PDF',
    defaultPath: path.join(lastSaveDir || app.getPath('documents'),
      'motor-report-' + new Date().toISOString().slice(0, 10) + '.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    buttonLabel: 'Сохранить'
  });
  if (!target) return { ok: false, canceled: true };
  const source = win || mainWindow;
  try {
    const data = await source.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'custom', top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
    });
    fs.writeFileSync(target, data);
    lastSaveDir = path.dirname(target);
    return { ok: true, path: target };
  } catch (e) {
    dialog.showErrorBox('Не удалось сохранить PDF', String(e && e.message || e));
    return { ok: false, error: String(e && e.message || e) };
  }
}

/* ---------- меню -------------------------------------------------------- */
function updateMenu() {
  const hasReport = reportWindows.size > 0;
  const template = [
    {
      label: 'Файл',
      submenu: [
        {
          label: 'Открыть проект…',
          accelerator: 'CmdOrCtrl+O',
          click: (item, win) => { if (win) win.webContents.send('shell:open-project'); }
        },
        {
          label: 'Сохранить проект…',
          accelerator: 'CmdOrCtrl+S',
          click: (item, win) => { if (win) win.webContents.send('shell:save-project'); }
        },
        { type: 'separator' },
        {
          label: 'Печать / PDF…',
          accelerator: 'CmdOrCtrl+P',
          click: (item, win) => { if (win) win.webContents.send('shell:print'); }
        },
        {
          label: 'Сохранить отчёт в PDF…',
          accelerator: 'CmdOrCtrl+Shift+P',
          enabled: hasReport,
          click: () => {
            const w = [...reportWindows].filter(x => !x.isDestroyed()).pop();
            if (w) savePdf(w);
          }
        },
        { type: 'separator' },
        { label: 'Выход', role: 'quit' }
      ]
    },
    {
      label: 'Правка',
      submenu: [
        { role: 'undo', label: 'Отменить' },
        { role: 'redo', label: 'Повторить' },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Копировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'selectAll', label: 'Выделить всё' }
      ]
    },
    {
      label: 'Вид',
      submenu: [
        { role: 'reload', label: 'Обновить' },
        { role: 'toggleDevTools', label: 'Инструменты разработчика', visible: isDev },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Масштаб 100 %' },
        { role: 'zoomIn', label: 'Крупнее' },
        { role: 'zoomOut', label: 'Мельче' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Во весь экран' }
      ]
    },
    {
      label: 'Справка',
      submenu: [
        {
          label: 'О программе',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'О программе',
              message: 'Асинхронный двигатель — инженерный расчёт',
              detail: [
                'Версия приложения: ' + appInfoVersion(),
                'Версия оболочки: ' + app.getVersion(),
                'Electron: ' + process.versions.electron + ' · Chromium: ' + process.versions.chrome,
                '',
                'Расчёт носит справочный характер: для ответственных приводов',
                'нужен расчёт специалиста и проверка по проектной документации.',
                '',
                'Сделано с помощью DeepSeek · идея: Виктор Ханас · khanas.viktor@gmail.com'
              ].join('\n'),
              buttons: ['Закрыть']
            });
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* версия веб-приложения берётся из разметки (meta version) */
function appInfoVersion() {
  try {
    const html = fs.readFileSync(APP_FILE, 'utf8');
    const m = /<meta\s+name="version"\s+content="([^"]+)"/i.exec(html);
    return m ? m[1] : '—';
  } catch (e) { return '—'; }
}

/* ---------- IPC: мост для HTML (window.MC_SHELL) ----------------------- */
ipcMain.handle('shell:info', () => ({
  version: app.getVersion(),
  appVersion: appInfoVersion(),
  platform: process.platform,
  electron: process.versions.electron
}));

ipcMain.handle('shell:save-file', async (event, { name, data, encoding }) => {
  const target = save.SAVE_DIR
    ? save.pickPath(name || 'file')
    : dialog.showSaveDialogSync(mainWindow, {
        title: 'Сохранить файл',
        defaultPath: path.join(lastSaveDir || app.getPath('documents'), name || 'file'),
        buttonLabel: 'Сохранить'
      });
  if (!target) return { ok: false, canceled: true };
  try {
    const buf = typeof data === 'string' && encoding === 'base64'
      ? Buffer.from(data, 'base64')
      : Buffer.from(data);
    fs.writeFileSync(target, buf);
    lastSaveDir = path.dirname(target);
    return { ok: true, path: target };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});

ipcMain.handle('shell:pick-file', async () => {
  const res = dialog.showOpenDialogSync(mainWindow, {
    title: 'Открыть проект',
    properties: ['openFile'],
    filters: [{ name: 'Проект', extensions: ['json'] }, { name: 'Все файлы', extensions: ['*'] }]
  });
  if (!res || !res.length) return null;
  try {
    return { path: res[0], text: fs.readFileSync(res[0], 'utf8') };
  } catch (e) {
    return { path: res[0], error: String(e && e.message || e) };
  }
});

ipcMain.handle('shell:save-pdf', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  return savePdf(win);
});

/* ---------- жизненный цикл --------------------------------------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    installDownloads();
    updateMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
