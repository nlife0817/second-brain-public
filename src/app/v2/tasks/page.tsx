// Сводный список считается на сервере с настройками по умолчанию — сохранённые
// в localStorage фильтры видит только браузер, и если они отличаются, экран
// один раз догрузит свой вариант (см. комментарий в AllTasksClient).

import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { listAllTasks } from "@/lib/core/tasks";
import { AllTasksClient } from "./AllTasksClient";

export default async function AllTasksPage() {
  const auth = await getActiveOrgAuth();
  if (!auth) return null;
  const result = await listAllTasks(auth, { includeDone: false, includeArchivedProjects: false });
  return <AllTasksClient initial={result} />;
}
