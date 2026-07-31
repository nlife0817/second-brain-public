# Правило: публичные API endpoints в Next.js 16

Полная версия правила — в корневом [CLAUDE.md](../../../CLAUDE.md), раздел «Публичные API endpoints». Коротко:

`src/proxy.ts` (бывший middleware.ts) перехватывает **все** роуты и редиректит неавторизованных на `/login`. Для endpoint'ов, которые дёргаются извне без сессии (cron от Supabase pg_net, webhooks, health-checks):

1. Добавь свою auth (например, проверка `Bearer <SECRET>` из env)
2. Добавь путь в `config.matcher` exclusion list в [src/proxy.ts](../../proxy.ts)
3. Иначе запрос получит 307 на /login и до твоего кода не дойдёт

Источник правды — `config.matcher` в [src/proxy.ts](../../proxy.ts): сверяйся с ним, а не с этим файлом.

Все роуты живут в `/api/v2/**` и оборачиваются `withOrg`/`withUser` из [lib/core/context.ts](../../lib/core/context.ts) — они и разрешают пользователя, и проверяют членство в организации.

Исключение — [`/api/mcp`](mcp/route.ts): вход внешних агентов, у которых сессии-cookie нет. Свою проверку он делает сам (`Bearer` из `core.api_tokens`) и собирает тот же `AuthContext`, что построила бы сессия владельца токена, — дальше всё решает обычный policy. Устройство — в [lib/core/CLAUDE.md](../../lib/core/CLAUDE.md), раздел «Внешние агенты».
