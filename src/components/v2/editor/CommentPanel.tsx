"use client";

// Панель обсуждения документа: треды на фрагментах описания. Ведёт себя как
// комментарии в Google Docs — ответ, правка, закрытие, переоткрытие.

import { useState } from "react";
import { Check, CornerDownRight, MessageSquare, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { DocCommentThread, UserBrief } from "@/lib/core/types";
import { cn } from "@/lib/utils";
import { Avatar } from "../bits";

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
  /** Тред под курсором в документе — он же раскрыт в панели. */
  activeThreadId: string | null;
  /** Есть ли у треда якорь в тексте: без него обсуждение висит «в воздухе». */
  isAnchored: (threadId: string) => boolean;
  canComment: boolean;
  canResolveAll: boolean;
  onSelect: (threadId: string) => void;
  onReply: (threadId: string, text: string) => Promise<void>;
  onEdit: (commentId: string, text: string) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
  onResolve: (threadId: string, resolved: boolean) => Promise<void>;
  /** Черновик нового треда: выделение уже сделано, текста ещё нет. */
  draftQuote: string | null;
  onSubmitDraft: (text: string) => Promise<void>;
  onCancelDraft: () => void;
}

export function CommentPanel(props: CommentPanelProps) {
  const { threads, draftQuote } = props;
  const [showResolved, setShowResolved] = useState(false);

  const open = threads.filter((t) => !t.resolved_at);
  const resolved = threads.filter((t) => t.resolved_at);
  const visible = showResolved ? [...open, ...resolved] : open;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <MessageSquare className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Обсуждение</span>
        <span className="text-xs text-muted-foreground">{open.length}</span>
        <span className="flex-1" />
        {resolved.length > 0 && (
          <button
            onClick={() => setShowResolved((v) => !v)}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {showResolved ? "Скрыть закрытые" : `Закрытые (${resolved.length})`}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {draftQuote !== null && (
          <DraftCard quote={draftQuote} onSubmit={props.onSubmitDraft} onCancel={props.onCancelDraft} />
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
  onSubmit,
  onCancel,
}: {
  quote: string;
  onSubmit: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(text.trim());
      setText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-2 rounded-lg border border-primary/40 bg-background p-2.5 shadow-sm">
      {quote && <Quote text={quote} />}
      <Textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Комментарий…"
        className="min-h-16 text-sm"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="mt-1.5 flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Отмена
        </Button>
        <Button size="sm" onClick={() => void submit()} disabled={!text.trim() || busy}>
          Оставить
        </Button>
      </div>
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
  "threads" | "draftQuote" | "onSubmitDraft" | "onCancelDraft"
>) {
  const [replyText, setReplyText] = useState("");
  const [busy, setBusy] = useState(false);
  const active = activeThreadId === thread.id;
  const resolved = !!thread.resolved_at;
  const root = thread.messages[0];
  const mine = !!me && root?.author_id === me.id;
  const orphan = !isAnchored(thread.id);

  async function guard(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
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
            onEdit={(text) => guard(() => onEdit(message.id, text))}
            onDelete={() => guard(() => onDelete(message.id))}
          />
        ))}
      </div>

      {!resolved && canComment && (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <Textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Ответить…"
            className="min-h-9 py-1.5 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && replyText.trim()) {
                void guard(async () => {
                  await onReply(thread.id, replyText.trim());
                  setReplyText("");
                });
              }
            }}
          />
          {replyText.trim() && (
            <div className="mt-1.5 flex justify-end">
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void guard(async () => {
                    await onReply(thread.id, replyText.trim());
                    setReplyText("");
                  })
                }
              >
                <CornerDownRight className="size-3.5" />
                Ответить
              </Button>
            </div>
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
  onEdit,
  onDelete,
}: {
  message: DocCommentThread["messages"][number];
  isRoot: boolean;
  mine: boolean;
  onEdit: (text: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Правится обычный текст, а хранится HTML: разметку в теле комментария
  // никто не набирает, а тегами в поле ввода тыкать неудобно.
  const [draft, setDraft] = useState("");

  function startEdit() {
    const plain = message.body
      .replace(/<\/p>\s*<p>/gi, "\n\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">");
    setDraft(plain.trim());
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
          <div onClick={(e) => e.stopPropagation()}>
            <Textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="mt-1 min-h-14 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(false);
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draft.trim()) {
                  onEdit(draft.trim());
                  setEditing(false);
                }
              }}
            />
            <div className="mt-1.5 flex justify-end gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Отмена
              </Button>
              <Button
                size="sm"
                disabled={!draft.trim()}
                onClick={() => {
                  onEdit(draft.trim());
                  setEditing(false);
                }}
              >
                Сохранить
              </Button>
            </div>
          </div>
        ) : (
          <div
            className="prose prose-sm dark:prose-invert max-w-none text-sm"
            dangerouslySetInnerHTML={{ __html: message.body }}
          />
        )}
      </div>
    </div>
  );
}
