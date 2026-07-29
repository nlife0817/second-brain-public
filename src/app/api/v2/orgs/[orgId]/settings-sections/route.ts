import { NextResponse } from "next/server";
import { withOrg } from "@/lib/core/context";
import { parseJson } from "@/lib/core/http";
import { setSettingsSections } from "@/lib/core/identity";
import { assertOrg } from "@/lib/core/policy";
import { settingsSectionsSchema } from "@/lib/core/schemas";
import { readSectionsConfig, withDefaults } from "@/lib/core/settings-sections";

/**
 * Состав экрана «Настройки» по ролям. Правит только владелец: настройка решает,
 * что видят администраторы, сотрудники и гости, поэтому отдавать её самим
 * администраторам — значит позволить им открыть себе что угодно.
 *
 * Настройка только сужает видимость: данные разделов по-прежнему отдаёт policy,
 * и раздел, открытый роли без права на его данные, до неё не доедет.
 */
export const PUT = withOrg(async (request, { auth }) => {
  assertOrg(auth, "settings.sections.manage");
  const [body, invalid] = await parseJson(request, settingsSectionsSchema);
  if (invalid) return invalid;
  // Форму приводим тем же кодом, что и на чтении: неизвестные разделы и роли
  // в колонку не попадают.
  const config = withDefaults(readSectionsConfig({ settings_sections: body.sections }));
  await setSettingsSections(auth.orgId, config);
  return NextResponse.json(config);
});
