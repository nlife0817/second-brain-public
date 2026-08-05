// Клиент Telegram Bot API: отправка сообщения и разбор ответа.
//
// Симметричен ./push.ts — доменный слой одинаково не знает ни про VAPID, ни
// про Bot API, а получает три исхода отправки: "sent" | "dead" | "failed".
// "dead" означает, что адресат больше не достижим и вызывающий обязан удалить
// привязку из своей таблицы, иначе очередь копит мёртвые чаты.

const API_ROOT = "https://api.telegram.org";

/** Сеть не должна держать тик cron: у Bot API нет собственного потолка ожидания. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Настроен ли бот вовсе. Проверяется до похода в базу за привязками: на
 * установке без бота Telegram-канала просто нет, и лишний SELECT на каждого
 * получателя в каждом тике не нужен.
 */
export function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN?.trim();
}

function botToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN не задан: Telegram-уведомления выключены");
  }
  return token;
}

export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    readonly description: string,
  ) {
    super(`Telegram ${method} → ${code}: ${description}`);
    this.name = "TelegramApiError";
  }
}

type ApiResponse<T> = {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
};

/** Вызов метода Bot API. Ошибку самого API поднимает как TelegramApiError. */
export async function callTelegram<T>(method: string, body: unknown = {}): Promise<T> {
  const response = await fetch(`${API_ROOT}/bot${botToken()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null;
  if (!payload || !payload.ok) {
    throw new TelegramApiError(
      method,
      payload?.error_code ?? response.status,
      payload?.description ?? "нет тела ответа",
    );
  }
  return payload.result as T;
}

/**
 * Разметка Telegram — HTML, и текст задачи попадает в неё как есть. Название
 * вида «Проверить <div> в шапке» без экранирования либо потеряется целиком,
 * либо уронит отправку с «can't parse entities».
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface TelegramMessage {
  /** Первая строка полужирным. У служебных ответов бота её нет. */
  title?: string;
  body: string;
  /** Абсолютный адрес: под сообщением рисуется кнопка «Открыть». */
  url?: string;
  buttonText?: string;
}

/**
 * Потолок sendMessage — 4096 символов. Режем с запасом и по готовому тексту:
 * заголовок закрыт, тело обрезано, разметка цела. Повод не гипотетический —
 * в утренней сводке перечисляются названия задач, а их длину никто не
 * ограничивает, и «message is too long» потеряло бы всю сводку целиком.
 */
const MAX_MESSAGE_CHARS = 4000;

/**
 * Готовый текст сообщения. Отдельно от отправки — чтобы можно было проверить.
 * Экранирование делается здесь и только здесь: вызывающий передаёт обычный
 * текст, иначе часть строк уехала бы экранированной дважды.
 */
export function formatMessage(message: TelegramMessage): string {
  const title = message.title?.trim() ? `<b>${escapeHtml(message.title.trim())}</b>` : "";
  const body = clampBody(escapeHtml(message.body.trim()), MAX_MESSAGE_CHARS - title.length - 1);
  if (!title) return body;
  return body ? `${title}\n${body}` : title;
}

/**
 * Обрезка по границе сущности: `&lt;`, разрубленное посередине, телеграм
 * прочитает как «&lt» и ответит ошибкой разбора — то есть ровно тем, от чего
 * обрезка и защищает.
 */
function clampBody(text: string, limit: number): string {
  if (limit <= 1 || text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const lastAmp = cut.lastIndexOf("&");
  const safe = lastAmp >= 0 && !cut.slice(lastAmp).includes(";") ? cut.slice(0, lastAmp) : cut;
  return `${safe.trimEnd()}…`;
}

/**
 * Чат недостижим окончательно: бот заблокирован, чат удалён, бота исключили.
 * Отличать это от временной сетевой ошибки обязательно — иначе одна блокировка
 * либо навсегда остаётся в таблице, либо чистит живые привязки при первом же
 * таймауте.
 */
function isDead(err: TelegramApiError): boolean {
  if (err.code === 403) return true;
  if (err.code !== 400) return false;
  return /chat not found|user is deactivated|group chat was upgraded/i.test(err.description);
}

export async function sendTelegramMessage(
  chatId: string,
  message: TelegramMessage,
): Promise<"sent" | "dead" | "failed"> {
  try {
    await callTelegram("sendMessage", {
      chat_id: chatId,
      text: formatMessage(message),
      parse_mode: "HTML",
      // Ссылка на задачу разворачивалась бы карточкой входа: /v2/* закрыт
      // сессией, и превью показывало бы форму логина под каждым уведомлением.
      link_preview_options: { is_disabled: true },
      ...(message.url
        ? {
            reply_markup: {
              inline_keyboard: [[{ text: message.buttonText ?? "Открыть", url: message.url }]],
            },
          }
        : {}),
    });
    return "sent";
  } catch (err) {
    if (err instanceof TelegramApiError && isDead(err)) return "dead";
    console.error(`[telegram] отправка в чат ${chatId} не удалась:`, err);
    return "failed";
  }
}
