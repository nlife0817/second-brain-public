# Second Brain

Командный трекер задач (v2) и персональный «второй мозг» (v1, заморожен) на Next.js 16.

## Разработка

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint
npm run test
```

Нужен `.env.local` с `DATABASE_URL` и — для входа — `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`SESSION_SECRET`. Локально можно обойтись без OAuth: задайте `DEV_USER_EMAIL`, и проверка
сессии выключится (работает только при `NODE_ENV !== "production"`).

## Продакшн

Собственный VPS, Docker Compose: Next.js + Postgres + Caddy + контейнер расписаний.

- Конфигурация — [deploy/](deploy/), шаблон переменных — [deploy/env.example](deploy/env.example)
- Порядок переезда, выбор сервера, бэкапы — [docs/VPS-MIGRATION.md](docs/VPS-MIGRATION.md)

## Документация

- [CLAUDE.md](CLAUDE.md) — стек, структура, правила работы с репозиторием
- [src/lib/core/CLAUDE.md](src/lib/core/CLAUDE.md) — архитектура ядра v2
