"use client";

// Страница документа базы знаний.
//
// Редактор, автосохранение, вложения и обсуждения к фрагментам — те же, что у
// описания задачи (`useDocEditor`, `useDocThreads`): документ и описание это
// один и тот же документ, и вторая копия их правил разошлась бы с первой.
// Своё здесь — хлебные крошки, заголовок отдельным полем, история версий,
// доступ и связь с задачами.

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EditorContent } from "@tiptap/react";
import {
  ArrowUpFromLine,
  History,
  Link2,
  List,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Trash2,
  Users,
  X,
  type LucideIcon,
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
import { CommentPanel } from "@/components/v2/editor/CommentPanel";
import { DocOutline, useDocOutline } from "@/components/v2/editor/DocOutline";
import { DocxDownloadButton } from "@/components/v2/editor/DocxButton";
import { DocSaveButton } from "@/components/v2/editor/SaveButton";
import { SelectionMenu } from "@/components/v2/editor/SelectionMenu";
import { EditorToolbar } from "@/components/v2/editor/Toolbar";
import { documentOwner } from "@/components/v2/editor/owner";
import { useDocEditor } from "@/components/v2/editor/useDocEditor";
import { useDocThreads } from "@/components/v2/editor/use-doc-threads";
import { fileDropHint, useFileDrop } from "@/components/v2/editor/useFileDrop";
import { TaskSearchField } from "@/components/v2/TaskPicker";
import { api } from "@/lib/core/client";
import type { KbDocumentDetail, KbLinkedTask } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";
import { KbAccessDialog } from "../KbAccessDialog";
import { KbVersions } from "./KbVersions";

type PanelTab = "comments" | "outline" | "history";

function PanelTabButton({
  icon: Icon,
  label,
  count = 0,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
      {count > 0 && <span className="shrink-0 text-muted-foreground">{count}</span>}
    </button>
  );
}

export function KbDocumentClient({ initial }: { initial: KbDocumentDetail }) {
  const router = useRouter();
  const orgId = useV2Store((s) => s.orgId);
  const me = useV2Store((s) => s.me);
  const projects = useV2Store((s) => s.projects);

  const [doc, setDoc] = useState(initial);
  // Документ приезжает с сервера при каждом переходе и router.refresh();
  // сравнение по ссылке в рендере, а не эффектом.
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

  const [panelTab, setPanelTab] = useState<PanelTab>("comments");
  const [accessOpen, setAccessOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Просмотр старой версии: правка на ней запрещена, пока её не восстановят. */
  const [preview, setPreview] = useState<{
    id: string;
    label: string;
    title: string;
    body: string;
  } | null>(null);

  const canEdit = doc.my_role === "editor" || doc.my_role === "admin";
  const canComment = doc.my_role !== "viewer";
  const canManage = doc.my_role === "admin";
  const owner = useMemo(() => documentOwner(doc.id), [doc.id]);

  const save = useCallback(
    async (html: string) => {
      if (!orgId) return false;
      try {
        const next = await api.patch<KbDocumentDetail>(`/orgs/${orgId}/kb/${doc.id}`, { body: html });
        setDoc(next);
        setError(null);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить документ");
        return false;
      }
    },
    [orgId, doc.id],
  );

  const editorApi = useDocEditor({
    value: preview ? preview.body : doc.body,
    onSave: save,
    orgId,
    owner,
    editable: canEdit && !preview,
    placeholder: "Начните писать…",
  });
  const editor = editorApi.editor;

  const comments = useDocThreads({
    orgId,
    owner,
    editor,
    initialThreads: doc.threads,
    flush: editorApi.flush,
  });

  const outline = useDocOutline(editor);
  const [scrollHost, setScrollHost] = useState<HTMLElement | null>(null);
  const canUpload = canEdit && !preview && !!orgId;
  const drop = useFileDrop({
    enabled: canUpload,
    onFiles: (files) => void editorApi.uploadFiles(files),
  });

  // Курсор встал на якорь обсуждения — панель обязана показать обсуждение.
  const [lastThreadId, setLastThreadId] = useState(comments.activeThreadId);
  if (lastThreadId !== comments.activeThreadId) {
    setLastThreadId(comments.activeThreadId);
    if (comments.activeThreadId) setPanelTab("comments");
  }

  /** Заголовок — отдельное поле, и сохраняется он по уходу фокуса, а не по букве. */
  const commitTitle = useCallback(async () => {
    const next = title.trim();
    if (!orgId || next === doc.title) return;
    try {
      const updated = await api.patch<KbDocumentDetail>(`/orgs/${orgId}/kb/${doc.id}`, {
        title: next,
      });
      setDoc(updated);
      // Дерево слева держит layout — без обновления оно осталось бы со старым
      // названием до следующей полной загрузки.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось переименовать документ");
    }
  }, [orgId, doc.id, doc.title, title, router]);

  const remove = useCallback(async () => {
    if (!orgId) return;
    try {
      await api.del(`/orgs/${orgId}/kb/${doc.id}`);
      router.push("/v2/kb");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить документ");
    }
  }, [orgId, doc.id, router]);

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
        const tasks = await api.del<KbLinkedTask[]>(`/orgs/${orgId}/kb/${doc.id}/tasks?task=${taskId}`);
        setDoc((prev) => ({ ...prev, tasks }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось отвязать задачу");
      }
    },
    [orgId, doc.id],
  );

  const linkedProjects = projects.filter((p) => doc.project_ids.includes(p.id));
  const inherited = doc.root_id !== doc.id;
  const openThreads = comments.threads.filter((t) => !t.resolved_at).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2">
        <nav className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-xs text-muted-foreground">
          <Link href="/v2/kb" className="shrink-0 hover:text-foreground">
            База знаний
          </Link>
          {doc.path.map((step, i) => (
            <span key={step.id} className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 opacity-50">/</span>
              {i === doc.path.length - 1 ? (
                <span className="shrink-0 font-medium text-foreground">{step.title || "Без названия"}</span>
              ) : (
                <Link href={`/v2/kb/${step.id}`} className="truncate hover:text-foreground">
                  {step.title || "Без названия"}
                </Link>
              )}
            </span>
          ))}
        </nav>

        {editorApi.uploading > 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Загрузка ({editorApi.uploading})
          </span>
        )}
        {canEdit && !preview && <DocSaveButton status={editorApi.status} onSave={editorApi.flush} className="h-8" />}
        <DocxDownloadButton
          variant="outline"
          className="h-8"
          title={doc.title || "Документ"}
          getHtml={() => editor?.getHTML() ?? doc.body}
          threads={comments.threads}
          onError={setError}
        />
        {canManage && !inherited && (
          <Button variant="outline" size="sm" className="h-8" onClick={() => setAccessOpen(true)}>
            <Users className="size-4" />
            Доступ
          </Button>
        )}
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
              <DropdownMenuItem onClick={() => setLinking(true)}>
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
        // Правка старой версии невозможна, пока её не восстановят: иначе правку
        // прошлого легко принять за правку актуального документа.
        <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
          <History className="size-4" />
          Версия от {preview.label} — только чтение
          <span className="flex-1" />
          <Button size="xs" variant="secondary" onClick={() => setPreview(null)}>
            К актуальной
          </Button>
        </div>
      )}

      {canEdit && !preview && editor && (
        <div className="border-b border-border px-4 py-1.5">
          <EditorToolbar
            editor={editor}
            variant="full"
            onFiles={(files) => void editorApi.uploadFiles(files)}
            onComment={canComment ? comments.startDraft : undefined}
          />
        </div>
      )}

      {(error || editorApi.error || comments.error) && (
        <p className="flex items-center gap-2 border-b border-border bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          {error ?? editorApi.error ?? comments.error}
          <button
            onClick={() => {
              setError(null);
              editorApi.clearError();
              comments.clearError();
            }}
            className="ml-auto"
            aria-label="Скрыть ошибку"
          >
            <X className="size-3.5" />
          </button>
        </p>
      )}

      <div className="relative flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col" {...drop.handlers}>
          <div ref={setScrollHost} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-6 py-8">
              <input
                value={preview ? preview.title : title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => void commitTitle()}
                disabled={!canEdit || !!preview}
                placeholder="Без названия"
                aria-label="Название документа"
                className="w-full bg-transparent text-3xl font-bold tracking-tight outline-none placeholder:text-muted-foreground/60 disabled:cursor-default"
              />

              <div className="mt-3 flex flex-wrap items-center gap-2 border-b border-border pb-3 text-xs text-muted-foreground">
                <span>обновлён {new Date(doc.updated_at).toLocaleString("ru-RU", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}</span>
                <span className="flex-1" />
                {linkedProjects.map((p) => (
                  <Link
                    key={p.id}
                    href={`/v2/projects/${p.id}`}
                    className="flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 hover:text-foreground"
                  >
                    <ProjectIcon name={p.icon} color={p.color} className="size-3" />
                    {p.name}
                  </Link>
                ))}
                {!inherited && doc.project_ids.length === 0 && (
                  <span className="rounded-md border border-border px-2 py-0.5">Общий документ</span>
                )}
                {inherited && (
                  <Link
                    href={`/v2/kb/${doc.root_id}`}
                    className="flex items-center gap-1.5 rounded-md bg-amber-500/15 px-2 py-0.5 font-semibold text-amber-700 hover:underline dark:text-amber-300"
                    title="Доступ задан на верхнем документе ветки"
                  >
                    <ArrowUpFromLine className="size-3" />
                    Доступ как у «{doc.root_title}»
                  </Link>
                )}
              </div>

              <EditorContent editor={editor} className="doc-surface mt-4" />

              <section className="mt-10 border-t border-border pt-4">
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Связанные задачи
                  </h2>
                  {canEdit && (
                    <Button size="xs" variant="ghost" onClick={() => setLinking((v) => !v)}>
                      <Link2 className="size-3.5" />
                      Привязать
                    </Button>
                  )}
                </div>
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
                      className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm"
                    >
                      <button
                        onClick={() => setOpenTaskId(task.id)}
                        className={cn("min-w-0 flex-1 truncate text-left hover:underline", task.completed_at && "text-muted-foreground line-through")}
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
              </section>
            </div>
          </div>

          {canEdit && !preview && editor && (
            <SelectionMenu
              editor={editor}
              scrollHost={scrollHost}
              onComment={canComment ? comments.startDraft : undefined}
            />
          )}

          {canUpload && (
            <p className="border-t border-border px-6 py-1.5 text-xs text-muted-foreground">
              {fileDropHint(canUpload)}
            </p>
          )}

          {/* pointer-events-none обязателен: перехватив указатель, оверлей съест
              и dragleave (подсветка залипнет), и сам сброс. */}
          {drop.active && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/80">
              <span className="rounded-lg border-2 border-dashed border-primary px-6 py-4 text-sm font-medium text-primary">
                Отпустите, чтобы прикрепить
              </span>
            </div>
          )}
        </div>

        <aside className="hidden w-80 shrink-0 flex-col border-l border-border bg-muted/20 lg:flex">
          <div className="flex gap-1 border-b border-border p-2">
            <PanelTabButton
              icon={MessageSquare}
              label="Обсуждение"
              count={openThreads}
              active={panelTab === "comments"}
              onClick={() => setPanelTab("comments")}
            />
            <PanelTabButton
              icon={List}
              label="Оглавление"
              active={panelTab === "outline"}
              onClick={() => setPanelTab("outline")}
            />
            <PanelTabButton
              icon={History}
              label="История"
              active={panelTab === "history"}
              onClick={() => setPanelTab("history")}
            />
          </div>
          <div className="min-h-0 flex-1">
            {panelTab === "outline" && (
              <DocOutline editor={editor} items={outline} scrollHost={scrollHost} />
            )}
            {panelTab === "history" && (
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
            )}
            {panelTab === "comments" && (
              <CommentPanel
                threads={comments.threads}
                me={me}
                orgId={orgId}
                owner={owner}
                activeThreadId={comments.activeThreadId}
                isAnchored={(id) => comments.anchors.has(id)}
                canComment={canComment && !preview}
                canResolveAll={canEdit}
                onSelect={comments.select}
                onReply={comments.reply}
                onEdit={comments.editMessage}
                onDelete={comments.removeMessage}
                onResolve={comments.resolve}
                draftQuote={comments.draft?.quote ?? null}
                onSubmitDraft={comments.submitDraft}
                onCancelDraft={comments.cancelDraft}
              />
            )}
          </div>
        </aside>
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
