"use client";

// Прикрепление файлов из редактора: вставка из буфера, сброс на поле и разбор
// картинок, приехавших внутри вставленной разметки.
//
// Хук общий у описания (`useDocEditor`) и у поля комментария
// (`CommentComposer`): правила «текст важнее приложенной к нему картинки» и
// «base64 в документ не попадает» одни и те же, а разошедшиеся копии этих
// правил — ровно тот класс ошибок, который здесь уже чинили дважды.
//
// Отличия оболочек вынесены в параметры: куда класть загруженное (`insert`) и
// что вообще принимать (`reject`) — описание берёт любые файлы, комментарий
// только картинки.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { EditorProps } from "@tiptap/pm/view";
import type { Attachment } from "@/lib/core/types";
import type { DocOwner } from "./owner";
import {
  extractPastedImages,
  fileFromImageSrc,
  revertPastedImage,
  settlePastedImage,
  type PendingImage,
} from "./paste-images";
import { uploadAttachment, UploadError } from "./upload";

/**
 * Есть ли в переносимых данных осмысленный текст.
 *
 * Word, Excel, Google Docs, Outlook и обычная веб-страница кладут в буфер рядом
 * с разметкой ещё и картинку — рендер фрагмента. Забирать такую вставку под
 * загрузку файла нельзя: человек вставляет несколько страниц текста, а в
 * документе не появляется ничего, кроме картинки, — сохранять нечего.
 *
 * Картинка, скопированная со страницы, сюда не попадает: её разметка — один
 * `<img>` без текста, и она по-прежнему уезжает во вложения.
 */
function hasTextPayload(data: DataTransfer | null | undefined): boolean {
  if (!data) return false;
  if (data.getData("text/plain").trim()) return true;
  const html = data.getData("text/html");
  if (!html) return false;
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return !!holder.textContent?.trim();
}

export interface UseEditorUploadsOptions {
  orgId: string | null;
  /** Кому крепятся файлы: задача или документ. У черновика владельца ещё нет. */
  owner: DocOwner | null;
  /** Принимать ли файлы прямо сейчас: нередактируемое поле их не берёт. */
  enabled: boolean;
  /** Куда положить загруженное. */
  insert: (editor: Editor, attachment: Attachment) => void;
  /** Отсев до отправки: текст отказа или `null`, если файл подходит. */
  reject?: (file: File) => string | null;
}

export interface EditorUploadsApi {
  /** Сколько файлов сейчас в пути — для надписи «загрузка». */
  uploading: number;
  error: string | null;
  clearError: () => void;
  /** Загрузить выбранные или сброшенные файлы. Ссылка стабильна. */
  uploadFiles: (files: File[]) => Promise<void>;
  /** Раскладывается в `editorProps` при создании редактора. */
  editorProps: Pick<EditorProps, "handlePaste" | "handleDrop" | "transformPastedHTML">;
  /** Зовётся из `onUpdate`: метки вставленных картинок уже стоят в документе. */
  onUpdate: () => void;
  /** Связать с редактором. Из эффекта: редактор создаётся после хука. */
  bind: (editor: Editor | null) => void;
}

export function useEditorUploads(options: UseEditorUploadsOptions): EditorUploadsApi {
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Обработчики редактора создаются один раз, а задача и способ вставки меняются
  // вместе с пропами — держим их в ref, иначе редактор пришлось бы пересоздавать
  // (с потерей истории и курсора).
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const editorRef = useRef<Editor | null>(null);
  const bind = useCallback((editor: Editor | null) => {
    editorRef.current = editor;
  }, []);

  // Картинки, вынутые из вставленной разметки. Копятся в разборе вставки, а
  // загрузка начинается сразу после неё (см. onUpdate): к этому моменту узлы с
  // метками уже стоят в документе, и их есть чем находить.
  const pendingRef = useRef<PendingImage[]>([]);

  /**
   * Загрузка файлов по одному: параллельные ответы вставлялись бы в документ в
   * случайном порядке, а выбирают их осмысленной последовательностью.
   */
  const uploadFiles = useCallback(async (files: File[]) => {
    const { orgId, owner, enabled, reject } = optionsRef.current;
    const editor = editorRef.current;
    if (!orgId || !owner || !editor || !enabled) return;

    // Отсев до отправки: незачем гонять на сервер то, что оболочка всё равно не
    // умеет показать.
    const accepted: File[] = [];
    for (const file of files) {
      const refusal = reject?.(file) ?? null;
      if (refusal) setError(refusal);
      else accepted.push(file);
    }
    if (!accepted.length) return;

    setUploading((n) => n + accepted.length);
    for (const file of accepted) {
      try {
        const attachment = await uploadAttachment(orgId, owner, file);
        if (!editor.isDestroyed) optionsRef.current.insert(editor, attachment);
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
  }, []);

  /**
   * Загрузка картинок, вынутых из вставки. Идёт по одной, как и загрузка
   * выбранных файлов: два десятка картинок из документа — это два десятка
   * запросов, и слать их разом незачем. Текст всё это время уже в документе,
   * ждать человеку нечего.
   */
  const uploadPastedImages = useCallback(async (images: PendingImage[]) => {
    const { orgId, owner, enabled } = optionsRef.current;
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return;
    // Прикрепить некуда (черновик задачи) — возвращаем как было: внешние
    // ссылки останутся ссылками, base64 уйдёт вместе с местом картинки.
    if (!orgId || !owner || !enabled) {
      for (const image of images) revertPastedImage(editor, image);
      return;
    }
    setUploading((n) => n + images.length);
    let failed = 0;
    for (const [index, image] of images.entries()) {
      try {
        const attachment = await uploadAttachment(
          orgId,
          owner,
          await fileFromImageSrc(image.src, index + 1),
        );
        if (editor.isDestroyed) return;
        settlePastedImage(editor, image.id, attachment.url);
      } catch {
        if (editor.isDestroyed) return;
        revertPastedImage(editor, image);
        failed += 1;
      } finally {
        setUploading((n) => Math.max(0, n - 1));
      }
    }
    // Одним сообщением на всю вставку: два десятка отдельных ошибок читать
    // никто не станет, а сути они добавят не больше одной.
    if (failed) {
      setError(
        failed === images.length
          ? "Не удалось загрузить картинки из вставленного текста"
          : `Не удалось загрузить картинок: ${failed} из ${images.length}`,
      );
    }
  }, []);

  const onUpdate = useCallback(() => {
    if (!pendingRef.current.length) return;
    const images = pendingRef.current;
    pendingRef.current = [];
    void uploadPastedImages(images);
  }, [uploadPastedImages]);

  const editorProps = useMemo<EditorUploadsApi["editorProps"]>(
    () => ({
      // Текст важнее приложенной к нему картинки: см. `hasTextPayload`.
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.length || !optionsRef.current.enabled) return false;
        if (hasTextPayload(event.clipboardData)) return false;
        event.preventDefault();
        void uploadFiles(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const data = (event as DragEvent).dataTransfer;
        const files = Array.from(data?.files ?? []);
        if (!files.length || !optionsRef.current.enabled) return false;
        if (hasTextPayload(data)) return false;
        event.preventDefault();
        void uploadFiles(files);
        return true;
      },
      // Картинки внутри вставленной разметки — во вложения; в документ вместо
      // них едут метки. Иначе base64 из Word и Google Docs раздувает текст до
      // мегабайтов, и сохранение отваливается по пределу длины.
      transformPastedHTML: (html) => {
        if (!optionsRef.current.enabled) return html;
        const { html: next, pending } = extractPastedImages(html);
        if (pending.length) pendingRef.current.push(...pending);
        return next;
      },
    }),
    [uploadFiles],
  );

  return {
    uploading,
    error,
    clearError: useCallback(() => setError(null), []),
    uploadFiles,
    editorProps,
    onUpdate,
    bind,
  };
}
