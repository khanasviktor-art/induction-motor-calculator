> **Репозиторий:** https://github.com/khanasviktor-art/induction-motor-calculator  
> **Pages:** https://khanasviktor-art.github.io/induction-motor-calculator/

# Публикация на GitHub

Короткая инструкция: как назвать репозиторий, что вписать в описание, какие topics, как включить Pages и сделать релиз.

## 1. Название

Рекомендуется:

```
induction-motor-calculator
```

Почему:

- совпадает с `package.json` и названием проекта;
- понятно по URL и в поиске;
- не привязано к конкретному человеку.

Альтернативы:

| Имя | Когда лучше |
|---|---|
| `async-motor-calculator` | если хотите подчеркнуть «асинхронный» |
| `motor-calc` | короткий URL, но менее описательный |
| `induction-motor-calculator-ru` | если планируете английскую версию отдельно |

URL:

```
https://github.com/<owner>/induction-motor-calculator
https://<owner>.github.io/induction-motor-calculator/
```

`<owner>` — ваш логин или организация.

## 2. Видимость

**Public** — рекомендуется:

- GitHub Pages работает на бесплатном плане;
- проще делиться;
- MIT-лицензия это позволяет;
- в проекте нет секретов и серверной части.

Private имеет смысл, если вы хотите скрыть код. Учтите: Pages из приватного репозитория на GitHub Free недоступен (нужен Pro/Team/Enterprise), а сайт всё равно будет публичным.

## 3. Описание (About → Description)

Вставьте:

```
Офлайн-калькулятор асинхронного двигателя: ток, мощность, кабель, защита, графики и переходные процессы пуска. Один HTML-файл, без зависимостей.
```

Короткий английский вариант для README уже есть; описание GitHub может быть на русском.

## 4. Topics

Вставьте по одному:

```
induction-motor
async-motor
motor-calculator
electrical-engineering
cable-sizing
circuit-breaker
motor-protection
soft-starter
vfd
power-systems
industrial-automation
canvas
offline
single-file
javascript
github-pages
iec
pue
russian
engineering-calculator
```

Можно оставить 10–15 самых важных; главное — `induction-motor`, `motor-calculator`, `electrical-engineering`, `offline`.

## 5. Создание репозитория

Репозиторий уже инициализирован локально (ветка `main`, коммит `chore: prepare v0.5.0 for GitHub`). На GitHub создайте **пустой** репозиторий:

- **без** README;
- **без** .gitignore;
- **без** license.

Иначе при push возникнет конфликт.

### Вариант A — веб-интерфейс

1. https://github.com/new
2. Owner — вы.
3. Repository name — `induction-motor-calculator`.
4. Description — из раздела 3.
5. Public.
6. **Не** ставьте галочки Initialize.
7. Create repository.
8. Выполните:

```bash
cd motor-calc
git remote add origin https://github.com/<owner>/induction-motor-calculator.git
git branch -M main
git push -u origin main
```

### Вариант B — GitHub CLI

```bash
cd motor-calc
gh repo create induction-motor-calculator \
  --public \
  --source=. \
  --remote=origin \
  --push \
  --description "Офлайн-калькулятор асинхронного двигателя: ток, мощность, кабель, защита, графики и переходные процессы пуска. Один HTML-файл, без зависимостей."
```

Затем добавьте topics:

```bash
gh repo edit induction-motor-calculator \
  --add-topic induction-motor \
  --add-topic motor-calculator \
  --add-topic electrical-engineering \
  --add-topic cable-sizing \
  --add-topic circuit-breaker \
  --add-topic offline \
  --add-topic single-file \
  --add-topic javascript
```

## 6. GitHub Pages

1. Settings → Pages.
2. Build and deployment → Source: **Deploy from a branch**.
3. Branch: **main**, folder: **/(root)**.
4. Save.
5. Через 1–2 минуты: `https://<owner>.github.io/induction-motor-calculator/`.

Почему работает:

- `index.html` лежит в корне;
- `.nojekyll` отключает обработку Jekyll;
- приложение не требует сборки на сервере.

Если Pages не появился:

- проверьте, что репозиторий Public (или у вас платный план);
- Actions → Pages build and deployment;
- откройте URL без `?debug=1`.

## 7. Релиз

1. Releases → **Draft a new release**.
2. Tag: `v0.5.0` → Create new tag on publish.
3. Title: `v0.5.0`.
4. Описание — из `CHANGELOG.md`.
5. Прикрепите standalone-файл `induction-motor-calculator.html` (из корня рабочей папки, не из `src/`).
6. Publish release.

Или CLI:

```bash
gh release create v0.5.0 ../induction-motor-calculator.html \
  --title "v0.5.0" \
  --notes-file CHANGELOG.md
```

## 8. CI и бейдж

После первого push откройте вкладку **Actions** — workflow `CI` должен пройти.

Бейдж в README (замените `<owner>`):

```md
[![CI](https://github.com/<owner>/induction-motor-calculator/actions/workflows/ci.yml/badge.svg)](https://github.com/<owner>/induction-motor-calculator/actions/workflows/ci.yml)
```

CI:

- ставит Node 20 и Chrome;
- `npm ci`;
- `npm run build`;
- проверяет, что `index.html` совпадает с коммитом;
- запускает `npm test`.

Если CI упал на `git diff` — соберите локально и закоммитьте `index.html`.

## 9. Настройки репозитория

Рекомендуется:

- **About**: description, website (Pages URL), topics.
- **Releases**: включены.
- **Issues**: включены.
- **Discussions**: по желанию.
- **Wiki**: выключить — документация в `docs/`.
- **Actions**: включены; permissions — Read repository contents (CI ничего не пишет).
- **Branch protection** (опционально): `main` → Require status checks → `test`; запретить force push и удаление.
- **Social preview** (опционально): Settings → General → Social preview, изображение 1280×640 из `docs/screenshots/`.
- **Community standards**: README, LICENSE, CONTRIBUTING, issue templates уже есть.

## 10. Если имя репозитория другое

Ничего в приложении менять не нужно. Обновите:

- URL Pages;
- бейдж CI в README;
- ссылки на клон;
- `repository` в `package.json` (если добавите).

`package.json` может сохранять имя `induction-motor-calculator` независимо от имени репозитория.

## 11. Чек-лист

- [ ] Репозиторий Public.
- [ ] Название `induction-motor-calculator`.
- [ ] Описание и topics заполнены.
- [ ] `git push -u origin main` прошёл.
- [ ] CI зелёный.
- [ ] Pages открывается.
- [ ] Релиз `v0.5.0` с standalone-файлом.
- [ ] Бейдж CI добавлен (по желанию).
- [ ] Лицензия MIT отображается в About.

Если что-то не получается — пришлите вывод `git remote -v`, `git log --oneline -3` и скриншот Actions.
