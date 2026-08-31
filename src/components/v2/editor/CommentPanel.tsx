"use client";

// Панель обсуждения документа: треды на фрагментах описания. Ведёт себя как
// комментарии в Google Docs — ответ, правка, закрытие, переоткрытие.

import { useState, type ReactNode } from "react";
import { Check, CornerDownRight, MessageSquare, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DocCommentThread, UserBrief } from "@/lib/core/types";
import { cn } from "@/lib/utils";
import { Avatar } from "../bits";
import { CommentComposer } from "./CommentComposer";
import type { DocOwner } from "./owner";
import { handleRichTextClick } from "./open-link";

function when(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface CommentPanelProps {
  threads: DocCommentThread[];
  me: UserBrief | null;
  /** Куда уходят картинки из комментариев — вложения того же владельца. */
  orgId: string | null;
  owner: DocOwner | null;
  /** Тред под курсором в документе — он же раскрыт в панели. */
  activeThreadId: string | null;
  /** Есть ли у треда якорь в тексте: без него обсуждение висит «в воздухе». */
  isAnchored: (threadId: string) => boolean;
  canComment: boolean;
  canResolveAll: boolean;
  onSelect: (threadId: string) => void;
  /**
   * Отправители возвращают признак успеха: композер по нему решает, стирать ли
   * набранное. Ошибку они не бросают — её ловит `guard` в DocEditor.
   */
  onReply: (threadId: string, html: string) => Promise<boolean>;
  onEdit: (commentId: string, html: string) => Promise<boolean>;
  onDelete: (commentId: string) => Promise<void>;
  onResolve: (threadId: string, resolved: boolean) => Promise<void>;
  /** Черновик нового треда: выделение уже сделано, текста ещё нет. */
  draftQuote: string | null;
  onSubmitDraft: (html: string) => Promise<boolean>;
  onCancelDraft: () => void;
  /**
   * Переключатель панелей (обсуждение ↔ оглавление) — он и подписывает панель.
   * Без него, когда в описании нет заголовков и переключать не на что, панель
   * подписывает себя сама.
   */
  tabs?: ReactNode;
}

export function CommentPanel(props: CommentPanelProps) {
  const { threads, draftQuote, tabs, orgId, owner } = props;
  const [showResolved, setShowResolved] = useState(false);

  const open = threads.filter((t) => !t.resolved_at);
  const resolved = threads.filter((t) => t.resolved_at);
  const visible = showResolved ? [...open, ...resolved] : open;

  return (
    <div className="flex h-full flex-col">
      {/* flex-wrap на случай, когда в шапке сходятся всё сразу: переключатель
          панелей, счётчик открытых и кнопка закрытых. В колонку 320 px они
          влезают вплотную, и «Закрытые» лучше перенести на вторую строку, чем
          обрезать подписи вкладок. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-3 py-2">
        {tabs ?? (
          <>
            <MessageSquare className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Обсуждение</span>
            <span className="text-xs text-muted-foreground">{open.length}</span>
          </>
        )}
        <span className="flex-1" />
        {resolved.length > 0 && (
          <button
            onClick={() => setShowResolved((v) => !v)}
            className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {showResolved ? "Скрыть закрытые" : `Закрытые (${resolved.length})`}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {draftQuote !== null && (
          <DraftCard
            quote={draftQuote}
            orgId={orgId}
            owner={owner}
            onSubmit={props.onSubmitDraft}
            onCancel={props.onCancelDraft}
          />
        )}

        {visible.length === 0 && draftQuote === null && (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            Выделите фрагмент текста и нажмите «Комментарий», чтобы начать обсуждение.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {visible.map((thread) => (
            <ThreadCard key={thread.id} thread={thread} {...props} />
          ))}
        </div>
      </div>
    </div>
  );
}

function DraftCard({
  quote,
  orgId,
  owner,
  onSubmit,
  onCancel,
}: {
  quote: string;
  orgId: string | null;
  owner: DocOwner | null;
  onSubmit: (html: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <div className="mb-2 rounded-lg border border-primary/40 bg-background p-2.5 shadow-sm">
      {quote && <Quote text={quote} />}
      {/* Escape здесь не перехватываем: он нужен списку @-упоминаний. Черновик
          закрывает Escape, дошедший до DocEditor, когда список не открыт. */}
      <CommentComposer
        autoFocus
        placeholder="Комментарий…"
        submitLabel="Оставить"
        orgId={orgId}
        owner={owner}
        busy={busy}
        onCancel={onCancel}
        onSubmit={async (html) => {
          setBusy(true);
          try {
            return await onSubmit(html);
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

function Quote({ text }: { text: string }) {
  return (
    <p className="mb-2 line-clamp-2 border-l-2 border-amber-400 pl-2 text-xs italic text-muted-foreground">
      {text}
    </p>
  );
}

function ThreadCard({
  thread,
  me,
  orgId,
  owner,
  activeThreadId,
  isAnchored,
  canComment,
  canResolveAll,
  onSelect,
  onReply,
  onEdit,
  onDelete,
  onResolve,
}: { thread: DocCommentThread } & Omit<
  CommentPanelProps,
  "threads" | "draftQuote" | "onSubmitDraft" | "onCancelDraft" | "tabs"
>) {
  // Поле ответа монтируется по клику, а не живёт в каждом треде: редактор
  // Tiptap на тред — это десятки экземпляров ProseMirror в одной панели.
  const [replying, setReplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = activeThreadId === thread.id;
  const resolved = !!thread.resolved_at;
  const root = thread.messages[0];
  const mine = !!me && root?.author_id === me.id;
  const orphan = !isAnchored(thread.id);

  /** Признак успеха пробрасывается наружу: по нему композер решает, стирать ли текст. */
  async function guard(fn: () => Promise<boolean | void>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    try {
      return (await fn()) !== false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={() => onSelect(thread.id)}
      className={cn(
        "cursor-pointer rounded-lg border bg-background p-2.5 text-sm shadow-sm transition-colors",
        active ? "border-amber-400 ring-1 ring-amber-400/40" : "border-border hover:border-muted-foreground/40",
        resolved && "opacity-60",
      )}
    >
      {thread.quote && <Quote text={thread.quote} />}
      {orphan && (
        // Текст переписали, и якорь исчез. Молча прятать такой тред нельзя:
        // обсуждение осталось, а его причина — уже нет.
        <p className="mb-2 text-[11px] text-amber-600 dark:text-amber-500">
          Фрагмент изменён — комментарий откреплён от текста
        </p>
      )}

      <div className="flex flex-col gap-2.5">
        {thread.messages.map((message, index) => (
          <Message
            key={message.id}
            message={message}
            isRoot={index === 0}
            mine={!!me && message.author_id === me.id}
            orgId={orgId}
            owner={owner}
            onEdit={(text) => guard(() => onEdit(message.id, text))}
            onDelete={() => guard(() => onDelete(message.id))}
          />
        ))}
      </div>

      {!resolved && canComment && (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          {replying ? (
            <CommentComposer
              autoFocus
              placeholder="Ответить…"
              submitLabel="Ответить"
              orgId={orgId}
              owner={owner}
              busy={busy}
              onCancel={() => setReplying(false)}
              onSubmit={(html) =>
                guard(async () => {
                  // Поле ответа закрываем только при успехе — иначе набранный
                  // текст исчезнет вместе с ним.
                  const ok = await onReply(thread.id, html);
                  if (ok) setReplying(false);
                  return ok;
                })
              }
            />
          ) : (
            // Заглушка того же вида, что и поле: панель не должна дёргаться,
            // когда в тред заходят отвечать.
            <button
              onClick={() => setReplying(true)}
              className="flex w-full items-center gap-1.5 rounded-lg border border-input bg-background px-3 py-1.5 text-left text-sm text-muted-foreground hover:border-ring"
            >
              <CornerDownRight className="size-3.5 shrink-0" />
              Ответить…
            </button>
          )}
        </div>
      )}

      {(mine || canResolveAll) && (
        <div className="mt-2 flex justify-end" onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void guard(() => onResolve(thread.id, !resolved))}
          >
            {resolved ? (
              <>
                <RotateCcw className="size-3.5" />
                Открыть снова
              </>
            ) : (
              <>
                <Check className="size-3.5" />
                Закрыть
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function Message({
  message,
  isRoot,
  mine,
  orgId,
  owner,
  onEdit,
  onDelete,
}: {
  message: DocCommentThread["messages"][number];
  isRoot: boolean;
  mine: boolean;
  orgId: string | null;
  owner: DocOwner | null;
  /** Признак успеха: по нему решаем, закрывать ли поле правки. */
  onEdit: (html: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  function startEdit() {
    // Разметка отдаётся редактору как есть: снятие тегов регуляркой съедало бы
    // упоминания, превращая @Ивана в обычный текст.
    setEditing(true);
    setMenuOpen(false);
  }

  return (
    <div className="flex gap-2">
      {message.author ? <Avatar user={message.author} size="sm" /> : <span className="size-6" />}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {message.author?.name || message.author?.email || "Неизвестный"}
          </span>
          · {when(message.created_at)}
          {message.edited_at && " · изменён"}
          <span className="flex-1" />
          {mine && !editing && (
            <span className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="rounded p-0.5 hover:bg-muted hover:text-foreground"
                title="Действия"
              >
                <MoreHorizontal className="size-3.5" />
              </button>
              {menuOpen && (
                <span className="absolute right-0 top-5 z-10 flex flex-col rounded-md border border-border bg-popover p-1 shadow-md">
                  <button onClick={startEdit} className="rounded px-2 py-1 text-left text-xs hover:bg-muted">
                    Изменить
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                    className="flex items-center gap-1 rounded px-2 py-1 text-left text-xs text-destructive hover:bg-muted"
                  >
                    <Trash2 className="size-3" />
                    {isRoot ? "Удалить тред" : "Удалить"}
                  </button>
                </span>
              )}
            </span>
          )}
        </p>

        {editing ? (
          <div className="mt-1" onClick={(e) => e.stopPropagation()}>
            <CommentComposer
              autoFocus
              value={message.body}
              submitLabel="Сохранить"
              orgId={orgId}
              owner={owner}
              onCancel={() => setEditing(false)}
              // Поле закрываем только при успехе и обязательно дожидаемся
              // ответа: без await правка «сохранялась» на экране и при отказе
              // сервера, а набранный текст исчезал вместе с полем.
              onSubmit={async (html) => {
                const ok = await onEdit(html);
                if (ok) setEditing(false);
                return ok;
              }}
            />
          </div>
        ) : (
          <div
            // comment-body — правила для картинки в готовом тексте: ширину
            // задал автор, а высоту ограничиваем мы (см. globals.css).
            className="comment-body prose prose-sm dark:prose-invert max-w-none text-sm"
            onClick={handleRichTextClick}
            dangerouslySetInnerHTML={{ __html: message.body }}
          />
        )}
      </div>
    </div>
  );
}
