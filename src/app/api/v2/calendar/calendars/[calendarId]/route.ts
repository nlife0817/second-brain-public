// Видимость и цвет отдельного календаря — единственное, что пользователь у него
// правит. Сами события правке не подлежат: наши таблицы это кэш чужого
// источника.

import { NextResponse } from "next/server";
import { z } from "zod";
import { updateCalendar } from "@/lib/core/calendars";
import { withUserParams } from "@/lib/core/context";
import { isUuid, jsonError, parseJson } from "@/lib/core/http";

const patchSchema = z
  .object({
    visible: z.boolean().optional(),
    // Цвет из палитры Google с нашей темой не согласован, поэтому свой можно
    // задать поверх. Пустая строка недопустима: «убрать» — это null.
    color_override: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/, "Ожидается цвет вида #rrggbb")
      .nullable()
      .optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "Empty patch" });

export const PATCH = withUserParams(async (request, user, params) => {
  if (!isUuid(params.calendarId)) return jsonError(404, "Not found");
  const [body, error] = await parseJson(request, patchSchema);
  if (error) return error;
  return NextResponse.json(await updateCalendar(user.id, params.calendarId, body));
});
