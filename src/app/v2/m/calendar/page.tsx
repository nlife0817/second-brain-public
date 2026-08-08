// Мобильный календарь считает тот же срез, что десктопный «Все задачи»:
// незавершённые задачи неархивных проектов. Сохранённые в localStorage фильтры
// видит только браузер — если они отличаются, экран один раз догрузит свой
// вариант (см. комментарий в MobileCalendarClient).
//
// Внешние события сюда не попадают намеренно: их раскладка зависит от часового
// пояса браузера (`localPoint`), и посчитанная в контейнере она разошлась бы с
// той, что увидит читатель.

import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { listAllTasks } from "@/lib/core/tasks";
import { MobileCalendarClient } from "./MobileCalendarClient";

export default async function MobileCalendarPage() {
  const auth = await getActiveOrgAuth();
  if (!auth) return null;
  const result = await listAllTasks(auth, { includeDone: false, includeArchivedProjects: false });
  return <MobileCalendarClient initial={result} />;
}
