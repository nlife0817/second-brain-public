"use client";

// Полноэкранный режим описания: документ по центру, обсуждение справа.
//
// Зачем отдельный слой, а не поле пошире: описание в карточке — узкая колонка
// рядом с полями задачи, и читать в ней документ на несколько экранов нельзя.
// Здесь та же разметка получает ширину страницы, полную панель инструментов и
// комментарии к фрагментам текста.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditorState } from "@tiptap/react";
import { Loader2, MessageSquare, Minimize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/core/client";
import type { DocCommentThread, UserBrief } from "@/lib/core/types";
import { useBackDismiss } from "@/components/v2/mobile/hooks";
import { cn } from "@/lib/utils";
import { CommentPanel } from "./CommentPanel";
import {
  anchoredThreadIds,
  markSelectionAsThread,
  removeThreadFromDoc,
  scrollToThread,
  setThreadResolvedInDoc,
} from "./comment-marks";
import { SelectionMenu } from "./SelectionMenu";
import { EditorToolbar } from "./Toolbar";
import { useDocEditor } from "./useDocEditor";
import { fileDropHint, useFileDrop } from "./useFileDrop";

export interface DocEditorProps {
  open: boolean;
  onClose: () => void;
  orgId: string | null;
  taskId: string | null;
  taskTitle: string;
  value: string;
  onSave: (html: string) => void;
  editable: boolean;
  canComment: boolean;
  me: UserBrief | null;
  /** Треды приезжают вместе с карточкой — открытие документа не ждёт запроса. */
  initialThreads: DocCommentThread[];
  /** Право закрывать чужие обсуждения (то же, что право править задачу). */
  canResolveAll: boolean;
}

type Draft = { quote: string; from: number; to: number };

export function DocEditor({
  open,
  onClose,
  orgId,
  taskId,
  taskTitle,
  value,
  onSave,
  editable,
  canComment,
  me,
  initialThreads,
  canResolveAll,
}: DocEditorProps) {
  const [threads, setThreads] = useState<DocCommentThread[]>(initialThreads);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [railOpen, setRailOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doc = useDocEditor({
    value,
    onSave,
    orgId,
    taskId,
    editable,
    placeholder: "Описание задачи…",
  });
  const editor = doc.editor;

  const canUpload = editable && !!orgId && !!taskId;
  const drop = useFileDrop({
    enabled: canUpload,
    onFiles: (files) => void doc.uploadFiles(files),
  });
  // Меню по выделению стоит `fixed` и обязано ехать вместе с текстом: без
  // ссылки на прокручиваемую колонку оно зависало бы на месте.
  const [scrollHost, setScrollHost] = useState<HTMLElement | null>(null);

  // Свежие треды при повторном открытии карточки: initialThreads — это снимок
  // на момент загрузки bundle, а обсуждение могло уйти вперёд.
  useEffect(() => {
    setThreads(initialThreads);
  }, [initialThreads]);

  useBackDismiss(open, onClose);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Esc закрывает черновик комментария, а не весь документ: иначе
        // случайное нажатие уносит и набранный текст.
        if (draft) setDraft(null);
        else onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, draft, onClose]);

  /**
   * Тред под курсором и набор тредов, у которых остался якорь в тексте.
   *
   * Подписка даёт только перерисовку — сами значения читаются из редактора
   * прямо здесь. Через селектор их брать нельзя: на первом рендере редактора
   * ещё нет (`immediatelyRender: false`), подписка возвращает пустоту, а
   * следующей транзакции может не случиться вовсе — панель так и осталась бы
   * уверена, что все обсуждения откреплены от текста.
   */
  const signals = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      // Строка, а не Set/объект: результат селектора сравнивается по значению.
      threadId: e ? ((e.getAttributes("docComment").threadId as string | null) ?? null) : null,
      version: e ? e.state.doc.content.size : 0,
    }),
  });
  const activeThreadId = editor
    ? ((editor.getAttributes("docComment").threadId as string | null) ?? null)
    : null;
  // signals здесь — признак того, что документ жив и мог измениться: пока
  // подписка пуста, редактора ещё нет и считать нечего.
  const anchors = useMemo(
    () => (editor && signals ? anchoredThreadIds(editor) : new Set<string>()),
    [editor, signals],
  );

  const startDraft = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    setDraft({ quote: editor.state.doc.textBetween(from, to, " ").slice(0, 2000), from, to });
    setRailOpen(true);
  }, [editor]);

  async function guard<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      const result = await fn();
      setError(null);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выполнить действие");
      return undefined;
    }
  }

  function upsertThread(next: DocCommentThread) {
    setThreads((prev) => {
      const i = prev.findIndex((t) => t.id === next.id);
      if (i === -1) return [...prev, next];
      const copy = [...prev];
      copy[i] = next;
      return copy;
    });
  }

  // Панель отдаёт готовую разметку: комментарии набирают в редакторе, потому что
  // в них живут @-упоминания, и заворачивать текст в <p> вручную больше нечего.
  async function submitDraft(html: string) {
    if (!orgId || !taskId || !draft || !editor) return;
    const created = await guard(() =>
      api.post<DocCommentThread>(`/orgs/${orgId}/tasks/${taskId}/doc-comments`, {
        body: html,
        quote: draft.quote,
      }),
    );
    if (!created) return;
    upsertThread(created);
    // Якорь ставится только после ответа сервера: id треда придумывает он, и
    // пометить текст раньше нечем. Правка документа уйдёт автосохранением.
    markSelectionAsThread(editor, created.id, { from: draft.from, to: draft.to });
    doc.flush();
    setDraft(null);
  }

  async function reply(threadId: string, html: string) {
    if (!orgId || !taskId) return;
    const updated = await guard(() =>
      api.post<DocCommentThread>(
        `/orgs/${orgId}/tasks/${taskId}/doc-comments?thread=${threadId}`,
        { body: html, quote: "" },
      ),
    );
    if (updated) upsertThread(updated);
  }

  async function editMessage(commentId: string, html: string) {
    if (!orgId) return;
    const updated = await guard(() =>
      api.patch<DocCommentThread>(`/orgs/${orgId}/doc-comments/${commentId}`, { body: html }),
    );
    if (updated) upsertThread(updated);
  }

  async function removeMessage(commentId: string) {
    if (!orgId || !taskId) return;
    const ok = await guard(() => api.del(`/orgs/${orgId}/doc-comments/${commentId}`));
    if (ok === undefined) return;
    // Удаление корня уносит весь тред, ответа — только одно сообщение. Что
    // именно случилось, знает сервер: перечитываем список вместо угадывания.
    const fresh = await guard(() =>
      api.get<DocCommentThread[]>(`/orgs/${orgId}/tasks/${taskId}/doc-comments`),
    );
    if (!fresh) return;
    const gone = threads.filter((t) => !fresh.some((f) => f.id === t.id));
    setThreads(fresh);
    if (editor) for (const thread of gone) removeThreadFromDoc(editor, thread.id);
    if (gone.length) doc.flush();
  }

  async function resolve(threadId: string, resolved: boolean) {
    if (!orgId) return;
    const updated = await guard(() =>
      api.post<DocCommentThread>(`/orgs/${orgId}/doc-comments/${threadId}/resolve`, { resolved }),
    );
    if (!updated) return;
    upsertThread(updated);
    if (editor) {
      setThreadResolvedInDoc(editor, threadId, resolved);
      doc.flush();
    }
  }

  if (!open || typeof document === "undefined") return null;

  const openThreadCount = threads.filter((t) => !t.resolved_at).length;

  // Портал в body обязателен: слой открывается поверх карточки задачи, а та
  // едет по экрану через transform — внутри неё `fixed` считался бы от самой
  // карточки, и документ оказался бы в её узкой колонке.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-background pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2 sm:px-4">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold sm:text-base">{taskTitle}</h2>
        {doc.uploading > 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Загрузка ({doc.uploading})
          </span>
        )}
        <Button
          variant={railOpen ? "secondary" : "outline"}
          size="sm"
          className="h-8 lg:hidden"
          onClick={() => setRailOpen((v) => !v)}
        >
          <MessageSquare className="size-4" />
          {openThreadCount > 0 && openThreadCount}
        </Button>
        <Button variant="outline" size="sm" className="h-8" onClick={onClose} title="Свернуть описание">
          <Minimize2 className="size-4" />
          <span className="hidden sm:inline">Свернуть</span>
        </Button>
      </header>

      {editable && editor && (
        <div className="border-b border-border px-3 py-1.5 sm:px-4">
          <EditorToolbar
            editor={editor}
            variant="full"
            onFiles={(files) => void doc.uploadFiles(files)}
            onComment={canComment ? startDraft : undefined}
          />
        </div>
      )}

      {(error || doc.error) && (
        <p className="flex items-center gap-2 border-b border-border bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          {error ?? doc.error}
          <button
            onClick={() => {
              setError(null);
              doc.clearError();
            }}
            className="ml-auto"
          >
            <X className="size-3.5" />
          </button>
        </p>
      )}

      <div className="relative flex min-h-0 flex-1">
        {/* Зона сброса — вся колонка документа, но подсветка не должна ездить
            вместе с текстом: оверлей висит на неподвижной обёртке, прокрутка
            остаётся внутри неё. */}
        <div className="relative flex min-w-0 flex-1 flex-col" {...drop.handlers}>
          <div ref={setScrollHost} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
              <EditorContent editor={editor} className="doc-surface" />
            </div>
          </div>

          {editable && editor && (
            <SelectionMenu
              editor={editor}
              scrollHost={scrollHost}
              onComment={canComment ? startDraft : undefined}
            />
          )}

          {editable && (
            <p className="border-t border-border px-4 py-1.5 text-xs text-muted-foreground sm:px-8">
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

        {/* На широком экране обсуждение стоит рядом с текстом, на узком —
            выезжает поверх: колонка в 320 px не оставила бы места документу. */}
        <aside
          className={cn(
            "border-l border-border bg-muted/20",
            "hidden w-80 shrink-0 lg:block",
            railOpen && "absolute inset-y-0 right-0 z-10 block w-full max-w-sm shadow-xl lg:relative lg:shadow-none",
          )}
        >
          <CommentPanel
            threads={threads}
            me={me}
            activeThreadId={activeThreadId}
            isAnchored={(id) => anchors.has(id)}
            canComment={canComment}
            canResolveAll={canResolveAll}
            onSelect={(id) => editor && scrollToThread(editor, id)}
            onReply={reply}
            onEdit={editMessage}
            onDelete={removeMessage}
            onResolve={resolve}
            draftQuote={draft?.quote ?? null}
            onSubmitDraft={submitDraft}
            onCancelDraft={() => setDraft(null)}
          />
        </aside>
      </div>
    </div>,
    document.body,
  );
}
