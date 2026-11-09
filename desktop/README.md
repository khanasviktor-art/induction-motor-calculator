# Настольная версия (Electron)

Обёртка вокруг того же `index.html`, что и веб-версия. Здесь только системная
часть: окно, меню, печать в PDF, сохранение файлов, запоминание размера окна.
Расчёт, интерфейс и тесты живут в корне проекта — правки делаются там, оболочка
пересобирается.

## Сборка и запуск

```bash
# один раз: зависимости оболочки (скачивает Electron ~90 МБ)
cd desktop && npm install && cd ..

npm run desktop          # собрать index.html в desktop/app и запустить окно
npm run desktop:dist     # собрать Windows portable exe в desktop/dist
npm run desktop:dist:mac # собрать macOS DMG (x64 + arm64), нужен macOS
```

Если `npm install` в `desktop/` запускался через pnpm и Electron не скачался:

```bash
node desktop/node_modules/electron/install.js
```

## Что делает оболочка

| Действие | Как реализовано |
|---|---|
| Окно | 1360×900 по умолчанию, минимум 900×600; размер, позиция и «развёрнуто» запоминаются в `%APPDATA%/MotorCalculator/window-state.json` |
| Меню | Файл (открыть/сохранить проект, печать, PDF, выход), Правка, Вид (масштаб, полный экран), Справка (версии приложения и оболочки) |
| «Печать / PDF» | файл PDF собирается через `printToPDF` (A4, фон, поля 12,7 мм) и сохраняется системным диалогом — без диалога печати Chromium |
| CSV / XLSX / PNG | `window.MC_SHELL.saveFile` → `fs.writeFileSync`, диалог «Сохранить как» |
| Проект | сохраняется так же; открытие — системный диалог выбора файла |
| Скачивания | на случай прочих ссылок перехватываются `will-download` |
| Ссылки | `http(s)` открываются в системном браузере, не в приложении |
| Второй запуск | single-instance: поднимает уже открытое окно |
| Тёмное оформление | фон окна до загрузки берётся из системной темы |

## Мост в HTML

`src/shell.js` отдаёт `window.MC_BRIDGE` с браузерным запасным путём:

```js
MC_BRIDGE.saveText(name, text, mime)   // CSV, проект
MC_BRIDGE.saveBlob(name, blob)         // XLSX
MC_BRIDGE.saveDataUrl(name, dataUrl)   // PNG графика
MC_BRIDGE.printReport(html)            // PDF отчёта
```

В браузере эти же вызовы скачивают файл ссылкой с `download`. Поэтому один и
тот же `index.html` используется и на Pages, и внутри exe/dmg, а мост не ветвит
логику: в оболочке он есть (`window.MC_SHELL` из `preload.js`), в браузере нет.

## Автотест

```bash
# окно, пересчёт, темы, язык, подсказки
APP_EXE="desktop/dist/MotorCalculator-0.11.2-win-x64.exe" npm run test:desktop

# macOS: путь к бинарнику внутри .app
APP_EXE="desktop/dist/mac-arm64/MotorCalculator.app/Contents/MacOS/MotorCalculator" npm run test:desktop

# плюс проверка файлов: CSV, XLSX, PNG, PDF реально появляются на диске
APP_EXE="..." APP_SAVE_DIR="C:\temp\mc" npm run test:desktop
```

`MC_SAVE_DIR` отключает диалоги и складывает файлы в указанную папку — это и
режим для автотеста, и возможность пакетной работы без диалогов.

## Ограничения сегодняшней версии

- Собраны Windows portable exe и macOS DMG (x64/arm64). Windows-exe в git не
  хранится; macOS DMG — в релизе.
- Нет подписи кода: SmartScreen на Windows и Gatekeeper на macOS покажут
  предупреждение при первом запуске.
- Нет автообновления: новая версия = новый exe/dmg.
