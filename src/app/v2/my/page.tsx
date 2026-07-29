// Список «Мои задачи» считается на сервере и уезжает в первый HTML. Контекст
// организации уже разрешён для оболочки (`cache` в context.ts), так что второй
// авторизации здесь нет — только сама выборка.

import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { listMyTasks } from "@/lib/core/tasks";
import { MyTasksClient } from "./MyTasksClient";

export default async function MyTasksPage() {
  const auth = await getActiveOrgAuth();
  // Доступа нет — сообщение об этом рисует оболочка, странице показывать нечего.
  if (!auth) return null;
  const tasks = await listMyTasks(auth, { includeDone: false });
  return <MyTasksClient initial={tasks} />;
}
