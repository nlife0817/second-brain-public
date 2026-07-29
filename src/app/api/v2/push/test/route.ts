// Проверочный push себе. Отдаёт число устройств, до которых дошло, — иначе
// «нажал и ничего» не отличить от «пришло, но на другое устройство».

import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/core/context";
import { jsonError } from "@/lib/core/http";
import { sendTestPushToUser } from "@/lib/core/push";

export const POST = withUser(async (_request: NextRequest, user) => {
  try {
    const { sent, removed } = await sendTestPushToUser(user.id);
    if (sent === 0) {
      return jsonError(
        409,
        removed > 0
          ? "Подписка устарела и была удалена — включите уведомления заново"
          : "Нет подписанных устройств: включите уведомления на этом устройстве",
      );
    }
    return NextResponse.json({ sent, removed });
  } catch (err) {
    // Чаще всего сюда попадает незаполненный VAPID: без явного текста это
    // выглядит как «пуши молча не ходят».
    console.error("[v2/push] тестовая отправка не удалась:", err);
    return jsonError(500, "Отправка не удалась — проверьте настройки VAPID на сервере");
  }
});
