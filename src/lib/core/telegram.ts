// Telegram как канал доставки уведомлений v2.
//
// Канал второй, а не отдельный механизм: сообщения собираются из тех же строк
// core.notifications, тем же диспетчером (push.ts) и по тем же правилам —
// тихие часы, окно склейки, сводка на несколько уведомлений подряд. Здесь
// живут только привязка чата к человеку и разговор с ботом.
//
// Привязка подтверждается одноразовым кодом в deep-link t.me/<bot>?start=<code>:
// иначе chat_id пришлось бы вводить руками, а «введите число из сообщения» —
// это и неудобно, и не доказывает, что чат принадлежит именно этому человеку.

import { randomBytes } from "node:crypto";
import { prepare, transaction } from "@/lib/sql";
import {
  callTelegram,
  sendTelegramMessage,
  telegramConfigured,
  type TelegramMessage,
} from "@/lib/notifications/telegram";

export { telegramConfigured };

/**
 * Срок жизни кода привязки. Ссылка уходит в буфер обмена и в историю переходов
 * браузера, поэтому живёт ровно столько, сколько занимает переход в телеграм.
 */
const CODE_TTL_MINUTES = 15;

export interface TelegramLink {
  chat_id: string;
  username: string | null;
  first_name: string | null;
  created_at: string;
}

/** Привязка пользователя или null. */
export async function getTelegramLink(userId: string): Promise<TelegramLink | null> {
  const row = await prepare<TelegramLink>(
    `SELECT chat_id::text AS chat_id, username, first_name, created_at
     FROM core.telegram_chats WHERE user_id = ?`,
  ).get(userId);
  return row ?? null;
}

/** Привязки пачки получателей — одним запросом, для диспетчера рассылки. */
export async function listTelegramChats(userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (userIds.length === 0) return out;
  const placeholders = userIds.map(() => "?").join(",");
  const rows = await prepare<{ user_id: string; chat_id: string }>(
    `SELECT user_id::text AS user_id, chat_id::text AS chat_id
     FROM core.telegram_chats WHERE user_id IN (${placeholders})`,
  ).all(userIds);
  for (const row of rows) out.set(row.user_id, row.chat_id);
  return out;
}

export async function disconnectTelegram(userId: string): Promise<boolean> {
  const rows = await prepare<{ user_id: string }>(
    `DELETE FROM core.telegram_chats WHERE user_id = ? RETURNING user_id::text AS user_id`,
  ).all(userId);
  return rows.length > 0;
}

/** Привязка мертва (бот заблокирован, чат удалён) — снимаем её молча. */
async function dropChat(chatId: string): Promise<void> {
  await prepare(`DELETE FROM core.telegram_chats WHERE chat_id = ?`).run(chatId);
}

// ---- Имя бота ------------------------------------------------------------------------------

/**
 * Имя бота нужно только для ссылки привязки, и спрашивается оно у самого API:
 * вторая переменная окружения рядом с токеном рано или поздно разъедется с
 * ним, а расхождение выглядит как «кнопка ведёт не туда».
 */
let cachedBotUsername: string | null = null;

export async function getBotUsername(): Promise<string> {
  if (cachedBotUsername) return cachedBotUsername;
  const me = await callTelegram<{ username?: string }>("getMe");
  if (!me.username) throw new Error("Telegram getMe не вернул имя бота");
  cachedBotUsername = me.username;
  return me.username;
}

// ---- Коды привязки -------------------------------------------------------------------------

/**
 * Ссылка привязки. Прежние неиспользованные коды этого человека гасятся: уже
 * выданная и куда-то скопированная ссылка после «подключить заново» не должна
 * оставаться рабочей (то же правило, что у ссылок установки пароля).
 */
export async function createTelegramLinkUrl(userId: string): Promise<string> {
  // Имя бота спрашиваем первым: если токен нерабочий, лучше упасть до записи
  // кода в базу, чем выдать ссылку в никуда.
  const bot = await getBotUsername();
  // base64url: параметр start у Telegram ограничен 64 символами и допускает
  // только A-Z a-z 0-9 _ - — ровно алфавит base64url.
  const code = randomBytes(24).toString("base64url");
  await transaction(async (tx) => {
    await tx.prepare(`DELETE FROM core.telegram_link_codes WHERE user_id = ?`).run(userId);
    await tx
      .prepare(
        `INSERT INTO core.telegram_link_codes (code, user_id, expires_at)
         VALUES (?, ?, now() + ?::int * interval '1 minute')`,
      )
      .run(code, userId, CODE_TTL_MINUTES);
  });
  return `https://t.me/${bot}?start=${code}`;
}

/** Отметки старше суток бессмысленны: их код давно просрочен. */
export async function purgeExpiredTelegramCodes(): Promise<number> {
  const result = await prepare(
    `DELETE FROM core.telegram_link_codes WHERE created_at < now() - interval '1 day'`,
  ).run();
  return result.changes;
}

interface TelegramChatInfo {
  chatId: string;
  username: string | null;
  firstName: string | null;
}

/**
 * Гасит код и привязывает чат — в одной транзакции. Порознь это либо сгоревший
 * код без привязки, либо код, который отработает второй раз.
 *
 * Возвращает id пользователя или null, если код неизвестен, просрочен или уже
 * использован.
 */
async function consumeLinkCode(code: string, chat: TelegramChatInfo): Promise<string | null> {
  return transaction(async (tx) => {
    const claimed = await tx
      .prepare<{ user_id: string }>(
        `UPDATE core.telegram_link_codes SET used_at = now()
         WHERE code = ? AND used_at IS NULL AND expires_at > now()
         RETURNING user_id::text AS user_id`,
      )
      .get(code);
    if (!claimed) return null;

    // Чат мог быть привязан к другому человеку — код подтверждает и того, кто
    // привязывает, и владение самим чатом, поэтому перепривязка законна.
    // Уникальный chat_id иначе просто отверг бы вставку.
    await tx
      .prepare(`DELETE FROM core.telegram_chats WHERE chat_id = ? AND user_id <> ?`)
      .run(chat.chatId, claimed.user_id);
    await tx
      .prepare(
        `INSERT INTO core.telegram_chats (user_id, chat_id, username, first_name)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET
           chat_id = EXCLUDED.chat_id,
           username = EXCLUDED.username,
           first_name = EXCLUDED.first_name,
           updated_at = now()`,
      )
      .run(claimed.user_id, chat.chatId, chat.username, chat.firstName);
    return claimed.user_id;
  });
}

// ---- Разговор с ботом ----------------------------------------------------------------------

/** Разбор текста сообщения в команду. Чистая часть — её проверяют тесты. */
export function parseCommand(text: string): { command: string; argument: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const [head, ...rest] = trimmed.split(/\s+/);
  // «/start@second_brainalerts_bot» — так телеграм адресует команду в группе.
  const command = head.slice(1).split("@")[0].toLowerCase();
  return { command, argument: rest.join(" ") };
}

const HELP_TEXT =
  "Я присылаю уведомления Second Brain: назначенные задачи, комментарии, упоминания, смену статуса и напоминания о сроках.\n\n" +
  "Чтобы подключить: откройте в приложении «Уведомления» → «Telegram» и нажмите «Подключить».\n\n" +
  "/stop — отключить уведомления в этот чат.";

async function reply(chatId: string, text: string): Promise<void> {
  await sendTelegramMessage(chatId, { body: text });
}

/** Форма апдейта, которую мы разбираем. Остальные поля Bot API нам не нужны. */
interface TelegramUpdate {
  message?: {
    chat?: { id?: number | string; type?: string };
    from?: { username?: string; first_name?: string; is_bot?: boolean };
    text?: string;
  };
}

/**
 * Обработка входящего апдейта. Отвечает всегда: молчащий бот неотличим от
 * сломанного, а привязка — единственное, ради чего человек сюда пишет.
 */
export async function handleTelegramUpdate(update: unknown): Promise<void> {
  const message = (update as TelegramUpdate)?.message;
  const chatId = message?.chat?.id;
  if (chatId === undefined || chatId === null) return;
  const chat = String(chatId);

  // Групповые чаты не обслуживаем: уведомления личные, и разослать их в общий
  // чат — значит показать команде задачи, к которым у неё нет доступа.
  if (message?.chat?.type && message.chat.type !== "private") {
    await reply(chat, "Уведомления приходят только в личный чат — напишите мне напрямую.");
    return;
  }
  if (message?.from?.is_bot) return;

  const parsed = parseCommand(message?.text ?? "");
  if (!parsed) {
    await reply(chat, HELP_TEXT);
    return;
  }

  if (parsed.command === "stop") {
    const removed = await prepare<{ user_id: string }>(
      `DELETE FROM core.telegram_chats WHERE chat_id = ? RETURNING user_id::text AS user_id`,
    ).all(chat);
    await reply(
      chat,
      removed.length > 0
        ? "Уведомления отключены. Чтобы включить снова — «Подключить» в настройках приложения."
        : "Этот чат и так не подключён.",
    );
    return;
  }

  if (parsed.command !== "start") {
    await reply(chat, HELP_TEXT);
    return;
  }

  if (!parsed.argument) {
    await reply(chat, HELP_TEXT);
    return;
  }

  const userId = await consumeLinkCode(parsed.argument, {
    chatId: chat,
    username: message?.from?.username ?? null,
    firstName: message?.from?.first_name ?? null,
  });
  if (!userId) {
    await reply(
      chat,
      "Ссылка устарела или уже использована. Откройте «Уведомления» → «Telegram» в приложении и получите новую.",
    );
    return;
  }

  const user = await prepare<{ name: string | null; email: string }>(
    `SELECT name, email FROM core.users WHERE id = ?`,
  ).get(userId);
  await reply(
    chat,
    `Готово — уведомления Second Brain будут приходить сюда${
      user ? ` для ${user.name || user.email}` : ""
    }.\n\nЧто именно присылать, настраивается в приложении: «Уведомления» → «Какие события присылать».`,
  );
}

// ---- Отправка ------------------------------------------------------------------------------

/**
 * Одно уведомление в чат пользователя. Возвращает false, если чата нет или он
 * оказался мёртвым — счётчики диспетчера считают доставленных, а не попытки.
 */
export async function sendToUserChat(
  chatId: string,
  message: TelegramMessage,
): Promise<boolean> {
  const result = await sendTelegramMessage(chatId, message);
  if (result === "dead") await dropChat(chatId);
  return result === "sent";
}

/**
 * Проверочное сообщение себе. Ровно та же роль, что у sendTestPushToUser:
 * между привязкой и первым реальным событием могут пройти часы, и «включил, но
 * ничего не приходит» иначе не отличить от «всё работает, просто нечему».
 */
export async function sendTestTelegram(
  userId: string,
): Promise<"sent" | "dead" | "failed" | "none"> {
  const link = await getTelegramLink(userId);
  if (!link) return "none";
  const result = await sendTelegramMessage(link.chat_id, {
    title: "Проверка уведомлений",
    body: "Если вы видите это сообщение — уведомления Second Brain доходят в телеграм.",
  });
  // «Бот заблокирован» — окончательный отказ: привязку снимаем, иначе она
  // останется в списке устройств человека как рабочая.
  if (result === "dead") await dropChat(link.chat_id);
  return result;
}
