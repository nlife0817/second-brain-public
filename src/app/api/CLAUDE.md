# Правило: публичные API endpoints в Next.js 16

`src/proxy.ts` (бывший middleware.ts) перехватывает **все** роуты и редиректит неавторизованных на `/login`. Для endpoint'ов, которые дёргаются извне без сессии (cron от Supabase pg_net, webhooks, health-checks):

1. Добавь свою auth (например, проверка `Bearer <SECRET>` из env)
2. Добавь путь в `config.matcher` exclusion list в [src/proxy.ts](../../proxy.ts)
3. Иначе запрос получит 307 на /login и до твоего кода не дойдёт

Источник правды — `config.matcher` в [src/proxy.ts](../../proxy.ts). На текущий момент из middleware исключены `api/cron` и `api/notifications/dispatch` (плюс статика: `_next`, `icons`, `favicon`, `manifest`, `sw.js`). Все остальные `/api/*` проходят проверку сессии в proxy — отдельный `withAuth` в роуте не обязателен, но допустим (см. [src/lib/api-auth.ts](../../lib/api-auth.ts) для ролевых ограничений).

Дополнительно proxy делает редирект `/` → `/m/tasks` для мобильных UA (можно обойти `?desktop`).
