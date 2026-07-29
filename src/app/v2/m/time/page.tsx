// Мобильный экран времени открывается на периоде «сегодня» — его и считаем.

import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { getActiveTimer, listEntries } from "@/lib/core/time";
import { MobileTimeClient } from "./MobileTimeClient";

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function MobileTimePage() {
  const auth = await getActiveOrgAuth();
  if (!auth) return null;
  const today = todayIso();
  const [entries, active] = await Promise.all([
    listEntries(auth, { from: today, to: today }),
    getActiveTimer(auth),
  ]);
  return <MobileTimeClient initial={{ from: today, to: today, list: { entries, active } }} />;
}
