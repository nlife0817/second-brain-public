"use client";

// Оболочка раздела «База знаний»: дерево слева, документ справа.
//
// Дерево живёт в layout, а не на странице документа: при переходе между
// документами оно не перемонтируется — раскрытые ветки и позиция прокрутки
// остаются на месте.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/core/client";
import type { KbDocumentDetail, KbNodeKind, KbTreeGroup, ProjectWithMeta } from "@/lib/core/types";
import { useV2Store, useV2StoreApi } from "@/lib/core/ui-store";
import { KbTree, type KbMoveRequest } from "./KbTree";

/**
 * «Этот документ пока пуст» — снимок, который страница документа обновляет на
 * каждом рендере, а оболочка читает при уходе с него.
 *
 * Уборка живёт здесь, а не в размонтировании самой страницы, по двум причинам.
 * Переход между документами компонент не размонтирует вовсе — меняется только
 * параметр маршрута. А в разработке React проверяет эффекты повторным
 * монтированием, и уборка на размонтировании сносила бы документ сразу после
 * создания. Смена адреса — настоящий уход, и она бывает ровно один раз.
 */
const KbDisposableContext = createContext<(id: string, disposable: boolean) => void>(() => {});

export function useMarkDisposable(): (id: string, disposable: boolean) => void {
  return useContext(KbDisposableContext);
}

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
  /** Что не поместилось при импорте — предупреждение, а не отказ. */
  const [notice, setNotice] = useState<string | null>(null);
  /** Имя файла, который сейчас разбирает сервер. */
  const [importing, setImporting] = useState<string | null>(null);
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

  // Снимки страниц документов: id → «в него так ничего и не добавили».
  const disposableRef = useRef(new Map<string, boolean>());
  const markDisposable = useCallback((id: string, disposable: boolean) => {
    disposableRef.current.set(id, disposable);
  }, []);

  const previousDocumentRef = useRef(activeDocumentId);
  useEffect(() => {
    const previous = previousDocumentRef.current;
    previousDocumentRef.current = activeDocumentId;
    if (!previous || previous === activeDocumentId || !orgId) return;
    if (!disposableRef.current.get(previous)) return;
    disposableRef.current.delete(previous);
    void api
      .post<{ removed: boolean }>(`/orgs/${orgId}/kb/${previous}/discard-empty`)
      // Дерево живёт в этом же layout и при переходе не перемонтируется — без
      // обновления брошенная строка осталась бы в нём.
      .then((result) => result.removed && router.refresh())
      // Документ мог быть уже удалён из меню — молчим: уход со страницы не
      // повод показывать ошибку на следующей.
      .catch(() => {});
  }, [activeDocumentId, orgId, router]);

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
    (target: { parentId: string | null; projectId: string | null; kind: KbNodeKind }) => {
      if (!orgId) return;
      setError(null);
      void (async () => {
        try {
          const created = await api.post<KbDocumentDetail>(`/orgs/${orgId}/kb`, {
            title: "Без названия",
            kind: target.kind,
            parent_id: target.parentId,
            project_ids: target.parentId ? undefined : target.projectId ? [target.projectId] : [],
          });
          router.push(`/v2/kb/${created.id}`);
          router.refresh();
        } catch (e) {
          setError(
            e instanceof Error
              ? e.message
              : target.kind === "folder"
                ? "Не удалось создать папку"
                : "Не удалось создать документ",
          );
        }
      })();
    },
    [orgId, router],
  );

  /**
   * Загрузка готового файла. Разбор идёт на сервере (mammoth и exceljs весят
   * вместе больше мегабайта), поэтому сюда приезжает уже готовый узел дерева.
   *
   * Замечания импорта показываем отдельной строкой, а не ошибкой: «перенесена
   * часть данных» — это предупреждение о том, чего в узле не будет, и молчать
   * о нём нельзя, но и загрузку оно не отменяет.
   */
  const upload = useCallback(
    (target: { parentId: string | null; projectId: string | null }, file: File) => {
      if (!orgId) return;
      setError(null);
      setNotice(null);
      setImporting(file.name);
      void (async () => {
        try {
          const form = new FormData();
          form.append("file", file);
          if (target.parentId) form.append("parent_id", target.parentId);
          if (!target.parentId && target.projectId) {
            form.append("project_ids", target.projectId);
          }
          const result = await api.upload<{
            document: KbDocumentDetail;
            notes: string[];
          }>(`/orgs/${orgId}/kb/import`, form);
          if (result.notes.length) setNotice(result.notes.join(" · "));
          router.push(`/v2/kb/${result.document.id}`);
          router.refresh();
        } catch (e) {
          setError(e instanceof Error ? e.message : "Не удалось загрузить файл");
        } finally {
          setImporting(null);
        }
      })();
    },
    [orgId, router],
  );

  return (
    <KbDisposableContext.Provider value={markDisposable}>
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
        onUpload={upload}
        trashCount={trashCount}
        hideOnNarrow={!!activeDocumentId || pathname === "/v2/kb/trash"}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {error && (
          <p className="border-b border-border bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
            {error}
          </p>
        )}
        {importing && (
          <p className="border-b border-border bg-muted px-4 py-1.5 text-xs text-muted-foreground">
            Разбираем «{importing}»…
          </p>
        )}
        {notice && (
          <p className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-700 dark:text-amber-300">
            <span className="flex-1">{notice}</span>
            <button onClick={() => setNotice(null)} aria-label="Скрыть">
              ✕
            </button>
          </p>
        )}
        {children}
      </div>
    </div>
    </KbDisposableContext.Provider>
  );
}
