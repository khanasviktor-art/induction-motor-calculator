import fs from 'node:fs';
import path from 'node:path';
const root = path.dirname(new URL(import.meta.url).pathname);
let html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/style.css'), 'utf8');
html = html.replace('<link rel="stylesheet" href="style.css">', () => '<style>\n' + css + '\n</style>');
for (const f of ['data.js', 'vtc.js', 'engine.js', 'charts.js', 'sim.js', 'xlsx.js', 'app.js']) {
  const js = fs.readFileSync(path.join(root, 'src', f), 'utf8').replace(/<\/script>/gi, '<\\/script>');
  const tag = `<script src="${f}"></script>`;
  if (!html.includes(tag)) throw new Error('tag not found: ' + tag);
  html = html.replace(tag, () => '<script>\n' + js + '\n</script>');
}
const out = process.env.OUT ? path.resolve(process.env.OUT) : path.join(root, 'index.html');
fs.writeFileSync(out, html);
console.log('built', out, (html.length / 1024).toFixed(1) + ' KB');
