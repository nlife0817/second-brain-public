// Ссылка на задачу: /v2/tasks/<id>. Своего экрана у неё нет — карточка везде
// открывается поверх списка, поэтому роут решает, поверх какого именно, и
// уводит туда с ?task=<id>.
//
// Выбор экрана — не украшательство: задача, открытая в своём проекте, показана
// в контексте (соседние колонки, тот же фильтр), а личная задача без проекта в
// проектном экране просто не существует.

import { notFound, redirect } from "next/navigation";
import { getActiveOrgAuth } from "@/lib/core/bootstrap";
import { isUuid } from "@/lib/core/http";
import { effectiveProjectRole } from "@/lib/core/policy";
import { loadTaskAccess } from "@/lib/core/tasks";

export default async function TaskLinkPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const auth = await getActiveOrgAuth();
  if (!auth) return null;
  if (!isUuid(taskId)) notFound();

  // Недоступная задача — 404, как и чужой проект: подтверждать существование
  // задачи из закрытого контура нельзя.
  const access = await loadTaskAccess(auth, taskId);
  if (!access) notFound();

  // Проект берём только тот, который человек и правда видит: доступ к задаче
  // бывает и через назначение, и тогда экран её проекта ответил бы 404.
  const project = access.placements.find((p) => effectiveProjectRole(auth, p.project) !== null);
  redirect(
    project
      ? `/v2/projects/${project.project_id}?task=${taskId}`
      : `/v2/my?task=${taskId}`,
  );
}
