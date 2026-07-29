// Экран времени: список записей и сводка за последнюю неделю считаются на
// сервере. Период берётся по часам сервера и уезжает на клиент вместе с
// данными — браузер сверит его со своим (см. комментарий в TimeClient).

import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { getActiveTimer, listEntries, summary } from "@/lib/core/time";
import { TimeClient } from "./TimeClient";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function TimePage() {
  const auth = await getActiveOrgAuth();
  if (!auth) return null;

  const from = isoDaysAgo(7);
  const to = isoDaysAgo(0);
  const groupBy = "task" as const;

  const [entries, active, rows] = await Promise.all([
    listEntries(auth, { from, to }),
    getActiveTimer(auth),
    summary(auth, { from, to, groupBy }),
  ]);

  return (
    <TimeClient
      initial={{ from, to, groupBy, list: { entries, active }, summary: rows }}
    />
  );
}
