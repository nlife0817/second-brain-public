// Личные настройки внешних календарей.
//
// Отдельная страница, а не блок в настройках организации, по той же причине, что
// и уведомления: настройки организации доступны администраторам, а свой
// календарь подключает себе каждый — включая гостя, которому раздел «Настройки»
// в сайдбаре не показан.
//
// Данные считает сервер и отдаёт в `initial`: экран рисуется сразу, без запроса
// после гидрации.

import { redirect } from "next/navigation";
import { listCalendarAccounts } from "@/lib/core/calendars";
import { getCoreUser } from "@/lib/core/context";
import { secretsConfigured } from "@/lib/core/secret-box";
import { CalendarsClient } from "./CalendarsClient";

export default async function CalendarSettingsPage() {
  const user = await getCoreUser();
  if (!user) redirect("/login");

  return (
    <CalendarsClient
      initialAccounts={await listCalendarAccounts(user.id)}
      // Признак, а не сам ключ: наружу секрету дороги нет, а знать, что
      // подключение сейчас невозможно, экран обязан до нажатия кнопки.
      keyConfigured={secretsConfigured()}
    />
  );
}
