"use client";

// Страница таблицы базы знаний.
//
// Каркас тот же, что у документа (`KbDocumentClient`), и это сознательно: шапка,
// заголовок, доступ, история версий, связь с задачами и уборка брошенных
// пустышек — свойства узла дерева, а не текста. Отличается середина: вместо
// редактора Tiptap — строка формул, панель и полотно с листами.
//
// Чего у таблицы нет: обсуждений к фрагментам (якорь комментария живёт в
// разметке, а ячейка — не разметка) и оглавления. Панель справа поэтому из двух
// вкладок, а не из трёх.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpFromLine,
  Download,
  History,
  Link2,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TaskSheet } from "@/components/v2/lazy";
import { ProjectIcon } from "@/components/v2/project-icons";
import { DocSaveButton } from "@/components/v2/editor/SaveButton";
import { FormulaBar } from "@/components/v2/sheet/FormulaBar";
import { SheetGrid } from "@/components/v2/sheet/SheetGrid";
import { SheetTabs } from "@/components/v2/sheet/SheetTabs";
import { SheetToolbar } from "@/components/v2/sheet/SheetToolbar";
import { useSheet } from "@/components/v2/sheet/use-sheet";
import { TaskSearchField } from "@/components/v2/TaskPicker";
import { api } from "@/lib/core/client";
import { isEmptyWorkbook } from "@/lib/core/sheet/model";
import type { KbDocumentDetail, KbLinkedTask } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";
import { KbAccessDialog } from "../KbAccessDialog";
import { useMarkDisposable } from "../KbShell";
import { KbCrumbs } from "./KbCrumbs";
import { KbVersions } from "./KbVersions";

type PanelTab = "tasks" | "history";

export function KbSheetClient({ initial }: { initial: KbDocumentDetail }) {
  const router = useRouter();
  const orgId = useV2Store((s) => s.orgId);
  const projects = useV2Store((s) => s.projects);
  const markDisposable = useMarkDisposable();

  const [doc, setDoc] = useState(initial);
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setDoc(initial);
  }

  const [title, setTitle] = useState(initial.title);
  const [titleSeed, setTitleSeed] = useState(initial.title);
  if (titleSeed !== initial.title) {
    setTitleSeed(initial.title);
    setTitle(initial.title);
  }

  const [panelTab, setPanelTab] = useState<PanelTab>("tasks");
  const [panelOpen, setPanelOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  /** Просмотр старой версии: правка на ней запрещена, пока её не восстановят. */
  const [preview, setPreview] = useState<{
    id: string;
    label: string;
    title: string;
    body: string;
  } | null>(null);

  const canEdit = doc.my_role === "editor" || doc.my_role === "admin";
  const canManage = doc.my_role === "admin";
  const editable = canEdit && !preview;

  const save = useCallback(
    async (body: string) => {
      if (!orgId) return false;
      try {
        const next = await api.patch<KbDocumentDetail>(`/orgs/${orgId}/kb/${doc.id}`, { body });
        setDoc(next);
        setError(null);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить таблицу");
        return false;
      }
    },
    [orgId, doc.id],
  );

  const sheetApi = useSheet({
    value: preview ? preview.body : doc.body,
    onSave: save,
    editable,
  });

  // Брошенную пустую таблицу убирает оболочка при уходе со страницы — тем же
  // способом, что и брошенный документ. Условие строгое: пока правка в пути,
  // статус не `saved`, и запрос не уйдёт.
  useEffect(() => {
    markDisposable(
      doc.id,
      editable &&
        sheetApi.status === "saved" &&
        doc.tasks.length === 0 &&
        doc.attachments.length === 0 &&
        (title.trim() === "" || title.trim() === "Без названия") &&
        isEmptyWorkbook(sheetApi.workbook),
    );
  });

  const commitTitle = useCallback(async () => {
    const next = title.trim();
    if (!orgId || next === doc.title) return;
    try {
      const updated = await api.patch<KbDocumentDetail>(`/orgs/${orgId}/kb/${doc.id}`, {
        title: next,
      });
      setDoc(updated);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось переименовать таблицу");
    }
  }, [orgId, doc.id, doc.title, title, router]);

  const remove = useCallback(async () => {
    if (!orgId) return;
    try {
      await api.del(`/orgs/${orgId}/kb/${doc.id}`);
      router.push("/v2/kb");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить таблицу");
    }
  }, [orgId, doc.id, router]);

  /**
   * Выгрузка. Файл собирает сервер, поэтому несохранённая правка обязана уехать
   * ДО перехода по ссылке — иначе скачается предыдущее состояние.
   */
  const download = useCallback(
    async (format: "xlsx" | "csv") => {
      if (!orgId || downloading) return;
      setDownloading(true);
      try {
        await sheetApi.flush();
        const sheet = format === "csv" ? `&sheet=${sheetApi.sheetIndex}` : "";
        window.location.assign(
          `/api/v2/orgs/${orgId}/kb/${doc.id}/export?format=${format}${sheet}`,
        );
      } finally {
        setDownloading(false);
      }
    },
    [orgId, doc.id, downloading, sheetApi],
  );

  const linkTask = useCallback(
    async (taskId: string) => {
      if (!orgId) return;
      try {
        const tasks = await api.post<KbLinkedTask[]>(`/orgs/${orgId}/kb/${doc.id}/tasks`, {
          task_id: taskId,
        });
        setDoc((prev) => ({ ...prev, tasks }));
        setLinking(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось привязать задачу");
      }
    },
    [orgId, doc.id],
  );

  const unlinkTask = useCallback(
    async (taskId: string) => {
      if (!orgId) return;
      try {
        const tasks = await api.del<KbLinkedTask[]>(
          `/orgs/${orgId}/kb/${doc.id}/tasks?task=${taskId}`,
        );
        setDoc((prev) => ({ ...prev, tasks }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось отвязать задачу");
      }
    },
    [orgId, doc.id],
  );

  const linkedProjects = useMemo(
    () => projects.filter((p) => doc.project_ids.includes(p.id)),
    [projects, doc.project_ids],
  );
  const inherited = doc.root_id !== doc.id;
  const problem = error ?? sheetApi.error;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2">
        <KbCrumbs path={doc.path} />

        {editable && <DocSaveButton status={sheetApi.status} onSave={() => void sheetApi.flush()} className="h-8" />}

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="h-8 gap-1 text-xs" disabled={downloading}>
                {downloading ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Download className="size-3.5" />
                )}
                Скачать
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => void download("xlsx")}>
              Excel (.xlsx) — вся книга
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void download("csv")}>
              CSV — текущий лист
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {canManage && !inherited && (
          <Button variant="outline" size="sm" className="h-8" onClick={() => setAccessOpen(true)}>
            <Users className="size-4" />
            Доступ
          </Button>
        )}

        <Button
          variant={panelOpen ? "secondary" : "ghost"}
          size="sm"
          className="h-8"
          onClick={() => setPanelOpen((v) => !v)}
          title="Задачи и история версий"
        >
          <History className="size-4" />
        </Button>

        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="sm" className="h-8 px-2" aria-label="Ещё">
                  <MoreHorizontal className="size-4" />
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setPanelOpen(true);
                  setPanelTab("tasks");
                  setLinking(true);
                }}
              >
                <Link2 className="size-4" />
                Привязать задачу
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => void remove()}>
                <Trash2 className="size-4" />
                В корзину
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      {preview && (
        <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
          <History className="size-4" />
          Версия от {preview.label} — только чтение
          <span className="flex-1" />
          <Button size="xs" variant="secondary" onClick={() => setPreview(null)}>
            К актуальной
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <input
          value={preview ? preview.title : title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => void commitTitle()}
          disabled={!editable}
          placeholder="Без названия"
          aria-label="Название таблицы"
          className="min-w-0 flex-1 bg-transparent text-xl font-bold tracking-tight outline-none placeholder:text-muted-foreground/60 disabled:cursor-default"
        />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {linkedProjects.map((project) => (
            <Link
              key={project.id}
              href={`/v2/projects/${project.id}`}
              className="flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 hover:text-foreground"
            >
              <ProjectIcon name={project.icon} color={project.color} className="size-3" />
              {project.name}
            </Link>
          ))}
          {!inherited && doc.project_ids.length === 0 && (
            <span className="rounded-md border border-border px-2 py-0.5">Общая таблица</span>
          )}
          {inherited && (
            <Link
              href={`/v2/kb/${doc.root_id}`}
              className="flex items-center gap-1.5 rounded-md bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-700 hover:underline dark:text-amber-300"
              title="Доступ задан на верхнем узле ветки"
            >
              <ArrowUpFromLine className="size-3" />
              Доступ как у «{doc.root_title}»
            </Link>
          )}
        </div>
      </div>

      {editable && <SheetToolbar api={sheetApi} />}
      <FormulaBar api={sheetApi} editable={editable} />

      {problem && (
        <p className="flex items-center gap-2 border-b border-border bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          {problem}
          <button
            onClick={() => {
              setError(null);
              sheetApi.clearError();
            }}
            className="ml-auto"
            aria-label="Скрыть ошибку"
          >
            <X className="size-3.5" />
          </button>
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <SheetGrid api={sheetApi} editable={editable} />
          <SheetTabs api={sheetApi} editable={editable} />
        </div>

        {panelOpen && (
          <aside className="hidden w-80 shrink-0 flex-col border-l border-border bg-muted/20 lg:flex">
            <div className="flex gap-1 border-b border-border p-2">
              <PanelTabButton
                label="Задачи"
                count={doc.tasks.length}
                active={panelTab === "tasks"}
                onClick={() => setPanelTab("tasks")}
              />
              <PanelTabButton
                label="История"
                active={panelTab === "history"}
                onClick={() => setPanelTab("history")}
              />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {panelTab === "history" ? (
                <KbVersions
                  orgId={orgId}
                  documentId={doc.id}
                  canRestore={canEdit}
                  previewId={preview?.id ?? null}
                  onPreview={setPreview}
                  onRestored={(next) => {
                    setPreview(null);
                    setDoc(next);
                    router.refresh();
                  }}
                />
              ) : (
                <>
                  {canEdit && (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="mb-2"
                      onClick={() => setLinking((v) => !v)}
                    >
                      <Link2 className="size-3.5" />
                      Привязать задачу
                    </Button>
                  )}
                  {linking && canEdit && (
                    <div className="mb-2">
                      <TaskSearchField
                        placeholder="Найти задачу…"
                        onPick={(task) => void linkTask(task.id)}
                      />
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5">
                    {doc.tasks.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm"
                      >
                        <button
                          onClick={() => setOpenTaskId(task.id)}
                          className={cn(
                            "min-w-0 flex-1 truncate text-left hover:underline",
                            task.completed_at && "text-muted-foreground line-through",
                          )}
                        >
                          {task.title}
                        </button>
                        {canEdit && (
                          <button
                            onClick={() => void unlinkTask(task.id)}
                            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                            aria-label="Отвязать задачу"
                          >
                            <X className="size-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    {doc.tasks.length === 0 && !linking && (
                      <p className="text-xs text-muted-foreground">Пока ни одной</p>
                    )}
                  </div>

                  {/* Исходник импорта помечен `pinned`: ссылок на него в теле
                      быть не может, и по этой же отметке его не трогает уборка
                      осиротевших вложений. */}
                  {doc.attachments.some((file) => file.pinned) && (
                    <section className="mt-4 border-t border-border pt-3">
                      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        Исходный файл
                      </h3>
                      {doc.attachments.filter((file) => file.pinned).map((file) => (
                        <a
                          key={file.id}
                          href={file.url}
                          className="flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm hover:border-primary"
                        >
                          <Download className="size-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate">{file.filename}</span>
                        </a>
                      ))}
                    </section>
                  )}
                </>
              )}
            </div>
          </aside>
        )}
      </div>

      <KbAccessDialog
        open={accessOpen}
        onOpenChange={setAccessOpen}
        document={doc}
        onChanged={(next) => {
          setDoc(next);
          router.refresh();
        }}
      />
      <TaskSheet taskId={openTaskId} onClose={() => setOpenTaskId(null)} />
    </div>
  );
}

function PanelTabButton({
  label,
  count = 0,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label === "Задачи" ? <ListChecks className="size-3.5 shrink-0" /> : <History className="size-3.5 shrink-0" />}
      <span className="truncate">{label}</span>
      {count > 0 && <span className="shrink-0 text-muted-foreground">{count}</span>}
    </button>
  );
}
