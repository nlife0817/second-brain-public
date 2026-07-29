"use client";

// Поле комментария. Раньше это была обычная textarea, а текст заворачивался в
// <p> вручную; с упоминаниями так уже нельзя — @-подсказки живут внутри
// редактора. Набор расширений облегчённый (commentExtensions): таблицам,
// колонкам и вложениям в ленте делать нечего.
//
// useDocEditor не переиспользуем: там автосохранение по таймеру и загрузка
// файлов, а комментарий уходит явным действием.

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { commentExtensions } from "./extensions";
import { useMentionItems } from "./use-mention-items";

export function CommentComposer({
  value = "",
  placeholder,
  autoFocus = false,
  submitLabel = "Отправить",
  busy = false,
  onSubmit,
  onCancel,
  className,
}: {
  /** Разметка правящегося комментария; для нового — пусто. */
  value?: string;
  placeholder?: string;
  autoFocus?: boolean;
  submitLabel?: string;
  busy?: boolean;
  onSubmit: (html: string) => void | Promise<void>;
  onCancel?: () => void;
  className?: string;
}) {
  const [empty, setEmpty] = useState(!value.trim());
  const mentionItems = useMentionItems();

  // Обработчики клавиш живут внутри редактора и создаются один раз, а отправка
  // меняется вместе с пропами — держим её в ref, иначе Ctrl+Enter звал бы
  // колбэк первого рендера (та же причина, что у uploadFiles в useDocEditor).
  const submitRef = useRef<() => void>(() => {});

  const editor = useEditor({
    extensions: commentExtensions({ placeholder, mentionItems }),
    content: value,
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      // Тот же вид текста, что и в ленте комментариев.
      attributes: { class: "doc-content min-h-[1.5rem] text-sm outline-none" },
      // Прямые пропсы EditorView проверяются раньше плагинов, поэтому Ctrl+Enter
      // перехватывается до подсказки упоминаний. Обычный Enter не трогаем — им
      // выбирают человека из списка.
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          submitRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => setEmpty(e.isEmpty),
  });

  useEffect(() => {
    submitRef.current = () => {
      if (!editor || editor.isEmpty || busy) return;
      const html = editor.getHTML();
      void Promise.resolve(onSubmit(html)).then(() => {
        editor.commands.clearContent(true);
        setEmpty(true);
      });
    };
  }, [editor, busy, onSubmit]);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="rounded-lg border border-input bg-background px-3 py-2 focus-within:border-ring">
        <EditorContent editor={editor} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="xs" disabled={empty || busy} onClick={() => submitRef.current()}>
          {busy ? "Отправка…" : submitLabel}
        </Button>
        {onCancel && (
          <Button size="xs" variant="ghost" onClick={onCancel} disabled={busy}>
            Отмена
          </Button>
        )}
        <span className="text-[11px] text-muted-foreground">@ — упомянуть · Ctrl+Enter — отправить</span>
      </div>
    </div>
  );
}
