"use client";

// Общая обвязка редактора описания: автосохранение, вставка файлов из буфера и
// перетаскиванием. Ею пользуются обе оболочки — компактная в карточке задачи и
// полноэкранный документ, — поэтому поведение сохранения у них одно.

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, type Editor } from "@tiptap/react";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import { docExtensions } from "./extensions";
import { isInlineImageMime, uploadAttachment, UploadError } from "./upload";

/**
 * Пауза перед сохранением. Правка описания — это PATCH задачи, который экран
 * применяет к своему списку; сохранять на каждое нажатие значит слать десятки
 * запросов на абзац.
 */
const AUTOSAVE_DELAY_MS = 1200;

/**
 * Тот же документ или другой — сравнение по структуре, а не по строке.
 *
 * Сервер отдаёт описание не тем же текстом, каким его прислал редактор:
 * санитайзер закрывает пустые теги (`<br>` → `<br />`) и убирает пустые
 * значения атрибутов. Строковое сравнение видит в этом чужую правку и
 * перезаписывает документ ответом на собственное же сохранение — вставленная
 * секунду назад картинка при этом пропадала.
 */
function sameAsDocument(editor: Editor, html: string): boolean {
  const holder = document.createElement("div");
  holder.innerHTML = html || "";
  try {
    return PMDOMParser.fromSchema(editor.schema).parse(holder).eq(editor.state.doc);
  } catch {
    return false;
  }
}

export interface UseDocEditorOptions {
  value: string;
  onSave: (html: string) => void;
  orgId: string | null;
  taskId: string | null;
  editable?: boolean;
  placeholder?: string;
  autofocus?: boolean;
}

export interface DocEditorApi {
  editor: Editor | null;
  uploading: number;
  error: string | null;
  clearError: () => void;
  uploadFiles: (files: File[]) => Promise<void>;
  /** Сохранить немедленно, не дожидаясь паузы (закрытие слоя, уход со страницы). */
  flush: () => void;
}

export function useDocEditor({
  value,
  onSave,
  orgId,
  taskId,
  editable = true,
  placeholder,
  autofocus = false,
}: UseDocEditorOptions): DocEditorApi {
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Последнее, что уже уехало на сервер. Сравнение идёт с ним, а не с пропом:
  // ответ на PATCH приходит с задержкой, и пока он в пути проп ещё старый.
  const savedRef = useRef(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  // Обработчики вставки живут внутри редактора и создаются один раз, а функция
  // загрузки меняется вместе с задачей — держим её в ref, иначе редактор
  // пришлось бы пересоздавать (с потерей истории и курсора).
  const uploadFilesRef = useRef<(files: File[]) => Promise<void>>(async () => {});

  const editor = useEditor({
    extensions: docExtensions({ placeholder }),
    content: value || "",
    editable,
    immediatelyRender: false,
    autofocus: autofocus ? "end" : false,
    editorProps: {
      attributes: { class: "doc-content" },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.length || !editable) return false;
        event.preventDefault();
        void uploadFilesRef.current(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
        if (!files.length || !editable) return false;
        event.preventDefault();
        void uploadFilesRef.current(files);
        return true;
      },
    },
    onUpdate: ({ editor: e }) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const html = e.isEmpty ? "" : e.getHTML();
        if (html === savedRef.current) return;
        savedRef.current = html;
        onSaveRef.current(html);
      }, AUTOSAVE_DELAY_MS);
    },
  });

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!editor || editor.isDestroyed) return;
    const html = editor.isEmpty ? "" : editor.getHTML();
    if (html === savedRef.current) return;
    savedRef.current = html;
    onSaveRef.current(html);
  }, [editor]);

  // Уход со страницы, закрытие карточки, размонтирование — правка не должна
  // теряться из-за того, что пауза автосохранения не успела истечь.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  useEffect(() => () => flushRef.current(), []);

  /**
   * Загрузка файлов по одному: параллельные ответы вставлялись бы в документ в
   * случайном порядке, а выбирают их осмысленной последовательностью.
   */
  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (!orgId || !taskId || !editor || !editable) return;
      setUploading((n) => n + files.length);
      for (const file of files) {
        try {
          const attachment = await uploadAttachment(orgId, taskId, file);
          if (isInlineImageMime(attachment.mime_type)) {
            editor
              .chain()
              .focus()
              .insertDocImage({ src: attachment.url, alt: attachment.filename })
              .run();
          } else {
            editor
              .chain()
              .focus()
              .insertDocFile({
                href: attachment.url,
                name: attachment.filename,
                size: attachment.byte_size,
              })
              .run();
          }
        } catch (e) {
          setError(
            e instanceof UploadError || e instanceof Error
              ? e.message
              : `Не удалось загрузить «${file.name}»`,
          );
        } finally {
          setUploading((n) => Math.max(0, n - 1));
        }
      }
    },
    [orgId, taskId, editor, editable],
  );

  useEffect(() => {
    uploadFilesRef.current = uploadFiles;
  }, [uploadFiles]);

  // Синхронизация при смене задачи и при чужой правке. Своя правка, вернувшаяся
  // с сервера, документ не трогает — иначе редактор перерисовывался бы после
  // каждого автосохранения, теряя курсор.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    // Правка ещё не доехала до сервера: пришедшее значение заведомо старее
    // того, что набрано, и накатывать его нельзя.
    if (timerRef.current) return;
    if (sameAsDocument(editor, value || "")) return;
    savedRef.current = value || "";
    editor.commands.setContent(value || "", { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  return {
    editor,
    uploading,
    error,
    clearError: useCallback(() => setError(null), []),
    uploadFiles,
    flush,
  };
}
