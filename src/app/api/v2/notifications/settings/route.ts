// Личные настройки доставки: часовой пояс, тихие часы, час утренней сводки,
// напоминания и заглушённые проекты. Пользовательские, вне организации.

import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/core/context";
import { jsonError, isUuid, parseJson } from "@/lib/core/http";
import { listMutedProjects, setProjectMute } from "@/lib/core/notification-prefs";
import {
  getDeliverySettings,
  isValidHhMm,
  isValidTimezone,
  saveDeliverySettings,
} from "@/lib/core/notification-settings";
import { notificationSettingsSchema, projectMuteSchema } from "@/lib/core/schemas";

export const GET = withUser(async (_request: NextRequest, user) => {
  const [settings, mutedProjects] = await Promise.all([
    getDeliverySettings(user.id),
    listMutedProjects(user.id),
  ]);
  return NextResponse.json({ settings, muted_projects: mutedProjects });
});

export const PATCH = withUser(async (request: NextRequest, user) => {
  const [body, invalid] = await parseJson(request, notificationSettingsSchema);
  if (invalid) return invalid;

  // Зона уезжает в SQL (`AT TIME ZONE`), где неизвестное имя — ошибка
  // выполнения: непроверенное значение здесь остановило бы всю рассылку.
  if (body.timezone !== undefined && !isValidTimezone(body.timezone)) {
    return jsonError(400, "Неизвестный часовой пояс");
  }
  for (const value of [body.quiet_start, body.quiet_end]) {
    if (value !== undefined && !isValidHhMm(value)) return jsonError(400, "Время в формате ЧЧ:ММ");
  }

  const settings = await saveDeliverySettings(user.id, body);
  return NextResponse.json({ settings });
});

/** Заглушение отдельного проекта: { project_id, muted }. */
export const PUT = withUser(async (request: NextRequest, user) => {
  const [body, invalid] = await parseJson(request, projectMuteSchema);
  if (invalid) return invalid;
  if (!isUuid(body.project_id)) return jsonError(404, "Not found");
  // Право на проект не проверяем: строка в core.project_mutes ничего не
  // открывает и ни на кого, кроме автора, не влияет — это личная тишина.
  await setProjectMute(user.id, body.project_id, body.muted);
  const mutedProjects = await listMutedProjects(user.id);
  return NextResponse.json({ muted_projects: mutedProjects });
});
