/* Сборка index.html для настольной оболочки: тот же build.mjs,
   но результат кладётся в desktop/app/index.html (папка в .gitignore). */
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'desktop', 'app');
fs.mkdirSync(outDir, { recursive: true });

const out = path.join(outDir, 'index.html');
const r = spawnSync(process.execPath, [path.join(root, 'build.mjs')], {
  stdio: 'inherit',
  env: Object.assign({}, process.env, { OUT: out })
});
if (r.status !== 0) process.exit(r.status || 1);

/* Electron грузит приложение из файла; папка должна существовать всегда */
console.log('desktop: приложение собрано в ' + out);
