"use client";

// Поле комментария. Раньше это была обычная textarea, а текст заворачивался в
// <p> вручную; с упоминаниями так уже нельзя — @-подсказки живут внутри
// редактора. Набор расширений облегчённый (commentExtensions): таблицам,
// колонкам и файловым вложениям в ленте делать нечего, а картинка есть —
// скриншот в комментарии объясняет больше абзаца текста.
//
// useDocEditor не переиспользуем: там автосохранение по таймеру, а комментарий
// уходит явным действием. Загрузка картинок при этом общая — `useEditorUploads`.

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { commentExtensions } from "./extensions";
import { isImageFile } from "./upload";
import type { DocOwner } from "./owner";
import { useEditorUploads } from "./use-uploads";
import { useFileDrop } from "./useFileDrop";
import { useMentionItems } from "./use-mention-items";

export function CommentComposer({
  value = "",
  placeholder,
  autoFocus = false,
  submitLabel = "Отправить",
  busy = false,
  orgId = null,
  owner = null,
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
   * Кому уходят картинки комментария — задаче или документу базы знаний
   * (вложения там же, где картинки самого текста). Без пары orgId+owner
   * загрузка не предлагается вовсе — так же, как в описании черновика.
   */
  orgId?: string | null;
  owner?: DocOwner | null;
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
  const canUpload = !!orgId && !!owner;

  // Картинка — единственное вложение комментария: карточки файла в облегчённом
  // наборе расширений нет, и показать её было бы нечем.
  const uploads = useEditorUploads({
    orgId,
    owner,
    enabled: canUpload,
    insert: (target, attachment) =>
      target.chain().focus().insertDocImage({ src: attachment.url, alt: attachment.filename }).run(),
    reject: (file) =>
      isImageFile(file) ? null : `«${file.name}»: в комментарий можно вложить только картинку`,
  });

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
      ...uploads.editorProps,
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
    onUpdate: ({ editor: e }) => {
      // Вставка только что легла в документ — метки картинок на месте, можно
      // грузить.
      uploads.onUpdate();
      setEmpty(e.isEmpty);
    },
  });

  const bindUploads = uploads.bind;
  useEffect(() => {
    bindUploads(editor);
  }, [bindUploads, editor]);

  const drop = useFileDrop({
    enabled: canUpload,
    onFiles: (files) => void uploads.uploadFiles(files),
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
      <div
        {...drop.handlers}
        className="relative rounded-lg border border-input bg-background px-3 py-2 focus-within:border-ring"
      >
        {/* Поле прокручивается само, а не растёт до бесконечности: композер в
            карточке задачи — закреплённый футер, панель под ним не
            прокручивается, и длинный комментарий выталкивал «Отправить» за
            нижний край экрана — на телефоне до кнопки было не добраться. */}
        <div className="max-h-40 overflow-y-auto overscroll-contain sm:max-h-72">
          <EditorContent editor={editor} />
        </div>
        {/* pointer-events-none обязателен: перехватив указатель, оверлей съест и
            dragleave (подсветка залипнет), и сам сброс. */}
        {drop.active && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/80 text-xs font-medium text-primary">
            Отпустите, чтобы вложить картинку
          </div>
        )}
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
        {uploads.uploading > 0 && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            загрузка
          </span>
        )}
        <span className="text-[11px] text-muted-foreground">
          @ — упомянуть · Ctrl+Enter — отправить
          {canUpload && " · картинку можно вставить или перетащить"}
        </span>
      </div>
      {uploads.error && (
        <p className="text-[11px] text-destructive">
          {uploads.error}{" "}
          <button onClick={uploads.clearError} className="underline">
            скрыть
          </button>
        </p>
      )}
    </div>
  );
}
