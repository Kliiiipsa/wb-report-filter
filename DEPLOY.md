# Деплой на Vercel

Проект — обычное Next.js-приложение, никаких переменных окружения и секретов не требует.
Артикулы тянутся из публичного CSV-экспорта Google Sheets через serverless-route
`/api/articles/google-sheet`, который на Vercel работает «из коробки».

## Способ 1. Vercel CLI (быстрее всего, GitHub не нужен)

Выполни в терминале VS Code **в папке проекта** (`e:\project2`):

```powershell
npm i -g vercel      # установить CLI (один раз)
vercel login         # вход через браузер (твой аккаунт)
vercel               # первый деплой -> preview-ссылка
vercel --prod        # боевой деплой -> постоянная ссылка
```

При первом запуске `vercel` ответь на вопросы:

- **Set up and deploy “e:\project2”?** → `Y`
- **Which scope?** → выбери свой аккаунт
- **Link to existing project?** → **`N`** ← важно! Создаём НОВЫЙ проект,
  старый сайт не трогаем
- **What’s your project’s name?** → например `wb-report-filter`
- Остальное (framework, build-команды) Vercel определит автоматически (Next.js)

После `vercel --prod` в консоли появится постоянная ссылка вида
`https://wb-report-filter.vercel.app`.

## Способ 2. GitHub + дашборд Vercel (авто-деплой при каждом push)

```powershell
git init
git add .
git commit -m "WB report filter prototype"
# создай пустой репозиторий на github.com, затем:
git remote add origin https://github.com/<логин>/<репозиторий>.git
git branch -M main
git push -u origin main
```

Дальше на https://vercel.com → **Add New… → Project → Import** твой репозиторий →
Vercel сам определит Next.js → **Deploy**. После этого каждый `git push` будет
автоматически деплоить обновления.

## Заметки

- `.xlsx`-файлы и `.env*` уже в `.gitignore` — тестовые отчёты в репозиторий не попадут.
- Если `vercel` ругается на старую сломанную установку — повтори `npm i -g vercel`.
- Доступ к Google Sheets: route читает таблицу через публичный CSV-экспорт.
  Таблица должна быть открыта «Всем, у кого есть ссылка». Если доступ закроют,
  route вернёт понятную ошибку, а сам сайт продолжит работать (ручной ввод / файл).
