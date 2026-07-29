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
  /**
   * Вернуть `false`, если отправка не удалась — тогда набранное останется в
   * поле. Экраны ловят ошибки своими обёртками (`run`, `guard`) и наружу их не
   * бросают, поэтому «промис резолвнулся» успехом считать нельзя: человек
   * терял бы длинный комментарий на любой сетевой ошибке.
   */
  onSubmit: (html: string) => boolean | void | Promise<boolean | void>;
  onCancel?: () => void;
  className?: string;
}) {
  const [empty, setEmpty] = useState(!value.trim());
  const [sending, setSending] = useState(false);
  const mentionItems = useMentionItems();

  // Обработчики клавиш живут внутри редактора и создаются один раз, а отправка
  // меняется вместе с пропами — держим её в ref, иначе Ctrl+Enter звал бы
  // колбэк первого рендера (та же причина, что у uploadFiles в useDocEditor).
  const submitRef = useRef<() => void>(() => {});
  // Зеркало для повторного входа: между кликом и setSending проходит рендер, а
  // зажатый Ctrl+Enter шлёт десятки keydown подряд.
  const sendingRef = useRef(false);

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
      if (!editor || editor.isEmpty || busy || sendingRef.current) return;
      sendingRef.current = true;
      setSending(true);
      const html = editor.getHTML();
      void Promise.resolve(onSubmit(html))
        .then((ok) => {
          // Поле очищаем только при успехе: иначе отказ сервера стирал бы
          // набранное, и восстановить его было бы нечем.
          if (ok === false) return;
          editor.commands.clearContent(true);
          setEmpty(true);
        })
        .finally(() => {
          sendingRef.current = false;
          setSending(false);
        });
    };
  }, [editor, busy, onSubmit]);

  const disabled = empty || busy || sending;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="rounded-lg border border-input bg-background px-3 py-2 focus-within:border-ring">
        <EditorContent editor={editor} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="xs" disabled={disabled} onClick={() => submitRef.current()}>
          {busy || sending ? "Отправка…" : submitLabel}
        </Button>
        {onCancel && (
          <Button size="xs" variant="ghost" onClick={onCancel} disabled={busy || sending}>
            Отмена
          </Button>
        )}
        <span className="text-[11px] text-muted-foreground">@ — упомянуть · Ctrl+Enter — отправить</span>
      </div>
    </div>
  );
}
