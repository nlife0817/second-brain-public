// Привязка телеграм-чата к пользователю: статус, ссылка подключения, отвязка.
// Пользовательский роут, вне организации — привязка одна на все организации,
// как и подписка на push.

import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/core/context";
import { jsonError } from "@/lib/core/http";
import {
  createTelegramLinkUrl,
  disconnectTelegram,
  getTelegramLink,
  telegramConfigured,
} from "@/lib/core/telegram";

export const GET = withUser(async (_request: NextRequest, user) => {
  // configured отдаём всегда: без него «не настроен бот на сервере» выглядит
  // на экране как «кнопка не работает».
  const configured = telegramConfigured();
  const link = configured ? await getTelegramLink(user.id) : null;
  return NextResponse.json({ configured, link });
});

export const POST = withUser(async (_request: NextRequest, user) => {
  if (!telegramConfigured()) {
    return jsonError(503, "Telegram-бот не настроен на сервере (нет TELEGRAM_BOT_TOKEN)");
  }
  try {
    const url = await createTelegramLinkUrl(user.id);
    return NextResponse.json({ url });
  } catch (err) {
    // Сюда попадает нерабочий токен: без явного текста это выглядит как
    // «нажал подключить и ничего не произошло».
    console.error("[v2/telegram] не удалось выдать ссылку привязки:", err);
    return jsonError(502, "Телеграм не ответил — проверьте токен бота на сервере");
  }
});

export const DELETE = withUser(async (_request: NextRequest, user) => {
  const removed = await disconnectTelegram(user.id);
  return NextResponse.json({ removed });
});
