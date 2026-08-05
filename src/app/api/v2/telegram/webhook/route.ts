// Приём апдейтов от Telegram Bot API.
//
// Сессии здесь нет по построению — запрос делает сам телеграм, — поэтому путь
// исключён из config.matcher в src/proxy.ts (иначе прилетел бы редирект на
// /login) и проверяет себя сам.
//
// Аутентификация — секрет, который телеграм присылает в заголовке
// X-Telegram-Bot-Api-Secret-Token; тот же секрет задаётся при регистрации
// вебхука (deploy/telegram-webhook.sh). Без него адрес открыт всему интернету,
// а «привяжи мой чат» — это команда от имени чужого человека.

import { NextRequest, NextResponse } from "next/server";
import { handleTelegramUpdate, telegramConfigured } from "@/lib/core/telegram";

/** Секрет обязателен: пустая переменная не должна означать «пускать всех». */
function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    console.error("[v2/telegram] TELEGRAM_WEBHOOK_SECRET не задан — запрос отклонён");
    return false;
  }
  return request.headers.get("x-telegram-bot-api-secret-token") === expected;
}

export async function POST(request: NextRequest) {
  if (!telegramConfigured() || !isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: true });
  }
  try {
    await handleTelegramUpdate(update);
  } catch (err) {
    // Отвечаем 200 и на своей ошибке: на любой другой ответ телеграм повторяет
    // апдейт по нарастающей и в итоге останавливает доставку вебхука целиком.
    // Разбираться нужно по логу, а не по молчащему боту.
    console.error("[v2/telegram] обработка апдейта не удалась:", err);
  }
  return NextResponse.json({ ok: true });
}
