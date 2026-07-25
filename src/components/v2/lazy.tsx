"use client";

// Глобальные слои v2, загружаемые по первому использованию.
//
// Оболочка держит их смонтированными на каждом экране: поиск (⌘K), диалог
// создания проекта и карточка задачи из поиска. Статические импорты тянули их
// код в бандл всех страниц v2, хотя до открытия он не нужен ни разу.
//
// `next/dynamic` сам по себе тут не помогает: чанк подгружается в момент
// рендера компонента, а закрытый слой всё равно рендерится. Поэтому до первого
// открытия на его месте null, а дальше он остаётся смонтированным — иначе
// сломается анимация закрытия.

import dynamic from "next/dynamic";
import { useState } from "react";
import type { ComponentType } from "react";

const TaskSheetImpl = dynamic(() => import("./TaskSheet").then((m) => m.TaskSheet), { ssr: false });
const GlobalSearchImpl = dynamic(() => import("./GlobalSearch").then((m) => m.GlobalSearch), { ssr: false });
const CreateProjectDialogImpl = dynamic(
  () => import("./CreateProjectDialog").then((m) => m.CreateProjectDialog),
  { ssr: false },
);
const CreateTaskDialogImpl = dynamic(
  () => import("./CreateTaskDialog").then((m) => m.CreateTaskDialog),
  { ssr: false },
);
const ProjectMembersDialogImpl = dynamic(
  () => import("./ProjectMembersDialog").then((m) => m.ProjectMembersDialog),
  { ssr: false },
);

export { OrgOnboarding } from "./OrgOnboarding";

/**
 * Монтирует слой начиная с первого открытия и больше не размонтирует.
 * `active` — признак «слой нужен» (открыт или анимирует открытие).
 *
 * Правка состояния прямо в рендере — тот самый случай, для которого React её и
 * допускает: значение выводится из пропа и обновляется до коммита, а не эффектом
 * после него. Через `useEffect` слой монтировался бы на кадр позже открытия.
 */
function useMountOnDemand(active: boolean): boolean {
  const [opened, setOpened] = useState(false);
  if (active && !opened) setOpened(true);
  return opened;
}

type PropsOf<T> = T extends ComponentType<infer P> ? P : never;

export function TaskSheet(props: PropsOf<typeof TaskSheetImpl>) {
  const mounted = useMountOnDemand(props.taskId != null);
  if (!mounted) return null;
  return <TaskSheetImpl {...props} />;
}

export function GlobalSearch(props: PropsOf<typeof GlobalSearchImpl>) {
  const mounted = useMountOnDemand(props.open);
  if (!mounted) return null;
  return <GlobalSearchImpl {...props} />;
}

export function CreateProjectDialog(props: PropsOf<typeof CreateProjectDialogImpl>) {
  const mounted = useMountOnDemand(props.open);
  if (!mounted) return null;
  return <CreateProjectDialogImpl {...props} />;
}

export function CreateTaskDialog(props: PropsOf<typeof CreateTaskDialogImpl>) {
  const mounted = useMountOnDemand(props.open);
  if (!mounted) return null;
  return <CreateTaskDialogImpl {...props} />;
}

export function ProjectMembersDialog(props: PropsOf<typeof ProjectMembersDialogImpl>) {
  const mounted = useMountOnDemand(props.open);
  if (!mounted) return null;
  return <ProjectMembersDialogImpl {...props} />;
}
