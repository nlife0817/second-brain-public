import { NextResponse } from "next/server";
import { loadOrgMeta } from "@/lib/core/bootstrap";
import { withOrg } from "@/lib/core/context";

/**
 * Справочники организации одним ответом: проекты, статусы, теги, участники,
 * кастомные поля и счётчик непрочитанного.
 *
 * Оболочка тянула их шестью запросами, и каждый заново поднимал сессию,
 * членство и роли проектов — три запроса к БД на авторизацию, помноженные на
 * шесть. Здесь авторизация одна, а сами выборки идут параллельно.
 */
export const GET = withOrg(async (_request, { auth }) => {
  return NextResponse.json(await loadOrgMeta(auth));
});
