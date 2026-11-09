/* Запуск/сборка настольной оболочки без глобальных зависимостей:
     node tools/run-desktop.cjs            → запустить Electron из desktop/node_modules
     node tools/run-desktop.cjs --dist     → собрать portable exe (electron-builder)
   Библиотеки берутся из desktop/node_modules, поэтому глобальный electron не нужен. */
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const desktop = path.join(root, 'desktop');
const electronDir = path.join(desktop, 'node_modules', 'electron');
const electronExe = (() => {
  try { return path.join(electronDir, 'dist', fs.readFileSync(path.join(electronDir, 'path.txt'), 'utf8').trim()); }
  catch (e) { return null; }
})();
const builderCli = path.join(desktop, 'node_modules', 'electron-builder', 'cli.js');

/* ELECTRON_RUN_AS_NODE=1 (встречается в окружениях IDE/агентов) заставляет
   Electron работать как обычный Node — окно не открывается. Убираем. */
const cleanEnv = Object.assign({}, process.env);
delete cleanEnv.ELECTRON_RUN_AS_NODE;

function fail(msg) {
  console.error('desktop: ' + msg);
  process.exit(1);
}

if (!fs.existsSync(path.join(desktop, 'app', 'index.html'))) {
  fail('нет desktop/app/index.html — сначала npm run build:desktop');
}

const wantMac = process.argv.includes('--mac');
if (process.argv.includes('--dist') || wantMac) {
  if (!fs.existsSync(builderCli)) {
    fail('нет electron-builder. Установите зависимости оболочки:\n' +
      '  cd desktop && npm install   (или pnpm install)');
  }
  const args = wantMac
    ? [builderCli, '--mac', 'dmg', '--x64', '--arm64']
    : [builderCli, '--win', 'portable', '--x64'];
  console.log('desktop: electron-builder ' + args.slice(1).join(' ') + ' (это может занять пару минут)');
  const r = spawnSync(process.execPath, args, { cwd: desktop, stdio: 'inherit', env: cleanEnv });
  process.exit(r.status || 0);
}

if (!electronExe || !fs.existsSync(electronExe)) {
  fail('не найден Electron. Установите зависимости оболочки:\n' +
    '  cd desktop && npm install\n' +
    'если бинарник не скачался: node desktop/node_modules/electron/install.js');
}
const passThrough = process.argv.slice(2).filter(a => a !== '--');
console.log('desktop: запуск ' + electronExe + ' ' + desktop);
const r = spawnSync(electronExe, [desktop].concat(passThrough), { cwd: desktop, stdio: 'inherit', env: cleanEnv });
process.exit(r.status || 0);
