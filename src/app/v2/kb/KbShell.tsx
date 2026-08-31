"use client";

// Оболочка раздела «База знаний»: дерево слева, документ справа.
//
// Дерево живёт в layout, а не на странице документа: при переходе между
// документами оно не перемонтируется — раскрытые ветки и позиция прокрутки
// остаются на месте.

import { useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/core/client";
import type { KbDocumentDetail, KbTreeGroup, ProjectWithMeta } from "@/lib/core/types";
import { useV2Store, useV2StoreApi } from "@/lib/core/ui-store";
import { KbTree, type KbMoveRequest } from "./KbTree";

export function KbShell({
  initialTree,
  trashCount,
  canCreateCommon,
  canOrderProjects,
  children,
}: {
  initialTree: KbTreeGroup[];
  trashCount: number;
  canCreateCommon: boolean;
  canOrderProjects: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const storeApi = useV2StoreApi();
  const orgId = useV2Store((s) => s.orgId);
  const projects = useV2Store((s) => s.projects);

  const [tree, setTree] = useState(initialTree);
  const [error, setError] = useState<string | null>(null);
  // Дерево приезжает с сервера при каждом router.refresh(); сравнение по ссылке
  // в рендере, а не эффектом — иначе лишний проход отрисовки со старым деревом.
  const [seed, setSeed] = useState(initialTree);
  if (seed !== initialTree) {
    setSeed(initialTree);
    setTree(initialTree);
  }

  /**
   * Ссылка из шапки проекта: раздел открывается сузенным до его документов.
   * Отдельного экрана «база знаний проекта» нет намеренно — это тот же раздел,
   * и второй его копии со своим деревом быть не должно.
   */
  const projectFilter = searchParams.get("project");
  const filteredProject = projectFilter
    ? (projects.find((p) => p.id === projectFilter) ?? null)
    : null;
  const shownTree = filteredProject
    ? tree.filter((group) => group.project_id === filteredProject.id)
    : tree;

  const activeDocumentId = pathname.startsWith("/v2/kb/")
    ? (pathname.split("/")[3] ?? null)
    : null;

  const move = useCallback(
    (request: KbMoveRequest) => {
      if (!orgId) return;
      const snapshot = tree;
      setError(null);
      void (async () => {
        try {
          // Перестановка среди тех же соседей — отдельная ручка: она не трогает
          // ни родителя, ни привязку к проектам, и права ей нужны попроще.
          const next = request.reorderOnly
            ? await api.put<KbTreeGroup[]>(`/orgs/${orgId}/kb/order`, {
                parent_id: request.parentId,
                project_id: request.projectId,
                order: request.order,
              })
            : await api.put<KbTreeGroup[]>(`/orgs/${orgId}/kb/${request.documentId}/move`, {
                parent_id: request.parentId,
                project_id: request.projectId,
                from_project_id: request.fromProjectId,
                order: request.order.length ? request.order : undefined,
              });
          setTree(next);
        } catch (e) {
          setTree(snapshot);
          setError(e instanceof Error ? e.message : "Не удалось переместить документ");
        }
      })();
    },
    [orgId, tree],
  );

  /**
   * Порядок разделов — это порядок проектов организации, тот же, что в боковой
   * панели. Второй порядок тех же проектов читался бы как ошибка, поэтому здесь
   * дёргается та же ручка, что и у панели, и обновляется тот же стор.
   */
  const reorderProjects = useCallback(
    (order: string[]) => {
      if (!orgId) return;
      setError(null);
      void (async () => {
        try {
          const rows = await api.put<ProjectWithMeta[]>(`/orgs/${orgId}/projects/order`, { order });
          storeApi.getState().setProjects(rows);
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Не удалось сохранить порядок");
        }
      })();
    },
    [orgId, storeApi, router],
  );

  const create = useCallback(
    (target: { parentId: string | null; projectId: string | null }) => {
      if (!orgId) return;
      setError(null);
      void (async () => {
        try {
          const created = await api.post<KbDocumentDetail>(`/orgs/${orgId}/kb`, {
            title: "Без названия",
            parent_id: target.parentId,
            project_ids: target.parentId ? undefined : target.projectId ? [target.projectId] : [],
          });
          router.push(`/v2/kb/${created.id}`);
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Не удалось создать документ");
        }
      })();
    },
    [orgId, router],
  );

  return (
    <div className="flex h-full min-h-0 flex-1">
      <KbTree
        groups={shownTree}
        filterLabel={filteredProject?.name ?? null}
        projects={projects}
        activeDocumentId={activeDocumentId}
        canOrderProjects={canOrderProjects}
        canCreateCommon={canCreateCommon}
        onMove={move}
        onReorderProjects={reorderProjects}
        onCreate={create}
        trashCount={trashCount}
        hideOnNarrow={!!activeDocumentId || pathname === "/v2/kb/trash"}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {error && (
          <p className="border-b border-border bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
            {error}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
