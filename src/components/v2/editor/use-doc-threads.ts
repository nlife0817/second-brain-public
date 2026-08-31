"use client";

// Обсуждения на фрагментах текста: список тредов, черновик нового, правки и
// закрытие. Всё, что связывает панель комментариев с самим документом.
//
// Вынесено из `DocEditor`, потому что оболочек стало две: полноэкранный режим
// описания задачи и страница документа базы знаний. Разметка у них разная, а
// правила обсуждения — одни, и вторая их копия разошлась бы с первой на первой
// же правке (ровно то, ради чего policy сделан единственным источником прав).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { api } from "@/lib/core/client";
import type { DocCommentThread } from "@/lib/core/types";
import {
  anchoredThreadIds,
  markSelectionAsThread,
  removeThreadFromDoc,
  scrollToThread,
  setThreadResolvedInDoc,
} from "./comment-marks";
import { ownerPath, type DocOwner } from "./owner";

/** Выделенный фрагмент, на котором заводят тред. */
export interface ThreadDraft {
  quote: string;
  from: number;
  to: number;
}

export interface UseDocThreadsOptions {
  orgId: string | null;
  owner: DocOwner | null;
  editor: Editor | null;
  /** Треды, приехавшие вместе с документом: панель рисуется без запроса. */
  initialThreads: DocCommentThread[];
  /**
   * Сохранить документ немедленно. Якорь обсуждения — это правка текста, и
   * ждать паузы автосохранения нельзя: закрытая вкладка унесла бы метку.
   */
  flush: () => void;
}

export interface DocThreadsApi {
  threads: DocCommentThread[];
  draft: ThreadDraft | null;
  startDraft: () => void;
  cancelDraft: () => void;
  /** Тред, на якоре которого стоит курсор. */
  activeThreadId: string | null;
  /** Треды, у которых якорь в тексте ещё есть: остальные висят «в воздухе». */
  anchors: ReadonlySet<string>;
  error: string | null;
  clearError: () => void;
  submitDraft: (html: string) => Promise<boolean>;
  reply: (threadId: string, html: string) => Promise<boolean>;
  editMessage: (commentId: string, html: string) => Promise<boolean>;
  removeMessage: (commentId: string) => Promise<void>;
  resolve: (threadId: string, resolved: boolean) => Promise<void>;
  select: (threadId: string) => void;
}

export function useDocThreads({
  orgId,
  owner,
  editor,
  initialThreads,
  flush,
}: UseDocThreadsOptions): DocThreadsApi {
  const [threads, setThreads] = useState<DocCommentThread[]>(initialThreads);
  const [draft, setDraft] = useState<ThreadDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Свежие треды при повторном открытии: initialThreads — снимок на момент
  // загрузки, а обсуждение могло уйти вперёд.
  useEffect(() => {
    setThreads(initialThreads);
  }, [initialThreads]);

  /**
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
  const anchors = useMemo(
    () => (editor && signals ? anchoredThreadIds(editor) : new Set<string>()),
    [editor, signals],
  );

  const startDraft = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    setDraft({ quote: editor.state.doc.textBetween(from, to, " ").slice(0, 2000), from, to });
  }, [editor]);

  const guard = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      const result = await fn();
      setError(null);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось выполнить действие");
      return undefined;
    }
  }, []);

  const upsertThread = useCallback((next: DocCommentThread) => {
    setThreads((prev) => {
      const i = prev.findIndex((t) => t.id === next.id);
      if (i === -1) return [...prev, next];
      const copy = [...prev];
      copy[i] = next;
      return copy;
    });
  }, []);

  /**
   * Панель отдаёт готовую разметку: комментарии набирают в редакторе, потому
   * что в них живут @-упоминания.
   *
   * Признак успеха возвращается наружу: `guard` ошибку не бросает, и без него
   * композер считал бы отказ сервера успехом и стирал набранное.
   */
  const submitDraft = useCallback(
    async (html: string): Promise<boolean> => {
      if (!orgId || !owner || !draft || !editor) return false;
      const created = await guard(() =>
        api.post<DocCommentThread>(`${ownerPath(orgId, owner)}/doc-comments`, {
          body: html,
          quote: draft.quote,
        }),
      );
      if (!created) return false;
      upsertThread(created);
      // Якорь ставится только после ответа сервера: id треда придумывает он, и
      // пометить текст раньше нечем.
      markSelectionAsThread(editor, created.id, { from: draft.from, to: draft.to });
      flush();
      setDraft(null);
      return true;
    },
    [orgId, owner, draft, editor, guard, upsertThread, flush],
  );

  const reply = useCallback(
    async (threadId: string, html: string): Promise<boolean> => {
      if (!orgId || !owner) return false;
      const updated = await guard(() =>
        api.post<DocCommentThread>(`${ownerPath(orgId, owner)}/doc-comments?thread=${threadId}`, {
          body: html,
          quote: "",
        }),
      );
      if (!updated) return false;
      upsertThread(updated);
      return true;
    },
    [orgId, owner, guard, upsertThread],
  );

  const editMessage = useCallback(
    async (commentId: string, html: string): Promise<boolean> => {
      if (!orgId) return false;
      const updated = await guard(() =>
        api.patch<DocCommentThread>(`/orgs/${orgId}/doc-comments/${commentId}`, { body: html }),
      );
      if (!updated) return false;
      upsertThread(updated);
      return true;
    },
    [orgId, guard, upsertThread],
  );

  const removeMessage = useCallback(
    async (commentId: string) => {
      if (!orgId || !owner) return;
      const ok = await guard(() => api.del(`/orgs/${orgId}/doc-comments/${commentId}`));
      if (ok === undefined) return;
      // Удаление корня уносит весь тред, ответа — только одно сообщение. Что
      // именно случилось, знает сервер: перечитываем список вместо угадывания.
      const fresh = await guard(() =>
        api.get<DocCommentThread[]>(`${ownerPath(orgId, owner)}/doc-comments`),
      );
      if (!fresh) return;
      const gone = threads.filter((t) => !fresh.some((f) => f.id === t.id));
      setThreads(fresh);
      if (editor) for (const thread of gone) removeThreadFromDoc(editor, thread.id);
      if (gone.length) flush();
    },
    [orgId, owner, guard, threads, editor, flush],
  );

  const resolve = useCallback(
    async (threadId: string, resolved: boolean) => {
      if (!orgId) return;
      const updated = await guard(() =>
        api.post<DocCommentThread>(`/orgs/${orgId}/doc-comments/${threadId}/resolve`, { resolved }),
      );
      if (!updated) return;
      upsertThread(updated);
      if (editor) {
        // Закрытый тред не теряет якорь: метка остаётся с data-comment-resolved,
        // иначе обсуждение нельзя переоткрыть на прежнем месте.
        setThreadResolvedInDoc(editor, threadId, resolved);
        flush();
      }
    },
    [orgId, guard, upsertThread, editor, flush],
  );

  const select = useCallback(
    (threadId: string) => {
      if (editor) scrollToThread(editor, threadId);
    },
    [editor],
  );

  return {
    threads,
    draft,
    startDraft,
    cancelDraft: useCallback(() => setDraft(null), []),
    activeThreadId,
    anchors,
    error,
    clearError: useCallback(() => setError(null), []),
    submitDraft,
    reply,
    editMessage,
    removeMessage,
    resolve,
    select,
  };
}
