"use client";

// Общая обвязка редактора описания: автосохранение, вставка файлов из буфера и
// перетаскиванием. Ею пользуются обе оболочки — компактная в карточке задачи и
// полноэкранный документ, — поэтому поведение сохранения у них одно.

import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, type Editor } from "@tiptap/react";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import { docExtensions } from "./extensions";
import type { DocOwner } from "./owner";
import { isInlineImageMime } from "./upload";
import { useEditorUploads } from "./use-uploads";
import { useMentionItems } from "./use-mention-items";

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
/** Разметка документа для сохранения: пустой редактор — пустое описание. */
function docHtml(editor: Editor): string {
  return editor.isEmpty ? "" : editor.getHTML();
}

function sameAsDocument(editor: Editor, html: string): boolean {
  const holder = document.createElement("div");
  holder.innerHTML = html || "";
  try {
    return PMDOMParser.fromSchema(editor.schema).parse(holder).eq(editor.state.doc);
  } catch {
    return false;
  }
}

/**
 * Что сейчас с описанием:
 * - `saved` — в редакторе то же, что сервер подтвердил;
 * - `dirty` — правка набрана, пауза автосохранения ещё идёт;
 * - `saving` — запрос в пути;
 * - `error` — сохранить не удалось, набранное осталось только здесь.
 */
export type DocSaveStatus = "saved" | "dirty" | "saving" | "error";

export interface UseDocEditorOptions {
  value: string;
  /**
   * Вернуть `false`, если сохранить не удалось — тогда статус станет `error`, а
   * «последнее сохранённое» не сдвинется, и повтор отправит ту же правку. Без
   * этого признака отказ сервера выглядел бы как успех (та же договорённость,
   * что у `CommentComposer.onSubmit`).
   */
  onSave: (html: string) => boolean | void | Promise<boolean | void>;
  orgId: string | null;
  /** Владелец текста: задача или документ базы знаний. */
  owner: DocOwner | null;
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
  /** Сохранить немедленно, не дожидаясь паузы (кнопка, закрытие слоя, уход со страницы). */
  flush: () => void;
  status: DocSaveStatus;
}

export function useDocEditor({
  value,
  onSave,
  orgId,
  owner,
  editable = true,
  placeholder,
  autofocus = false,
}: UseDocEditorOptions): DocEditorApi {
  // Вложение описания — картинка узлом `docImage`, всё остальное — карточкой
  // файла. Тем же хуком пользуется поле комментария, но там вложение бывает
  // только картинкой.
  const uploads = useEditorUploads({
    orgId,
    owner,
    enabled: editable,
    insert: (target, attachment) => {
      if (isInlineImageMime(attachment.mime_type)) {
        target.chain().focus().insertDocImage({ src: attachment.url, alt: attachment.filename }).run();
      } else {
        target
          .chain()
          .focus()
          .insertDocFile({
            href: attachment.url,
            name: attachment.filename,
            size: attachment.byte_size,
          })
          .run();
      }
    },
  });

  // Последнее, что сервер подтвердил. Сравнение идёт с ним, а не с пропом:
  // ответ на PATCH приходит с задержкой, и пока он в пути проп ещё старый.
  //
  // Двигается только по успеху — иначе отказ сервера навсегда выдавал бы
  // набранное за сохранённое, и повторить отправку было бы нечем.
  const savedRef = useRef(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const [status, setStatus] = useState<DocSaveStatus>("saved");
  // Зеркало статуса: его читают обработчики редактора (создаются один раз) и
  // эффект синхронизации, которому нельзя держать статус в зависимостях —
  // иначе накат пришедшего значения повторялся бы на каждую смену статуса.
  const statusRef = useRef<DocSaveStatus>("saved");
  const setSaveStatus = useCallback((next: DocSaveStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  /**
   * Отправка с номером попытки. Пока ответ в пути, можно напечатать ещё, и
   * следующее сохранение уйдёт раньше ответа на прежнее: подтверждение
   * обогнанной попытки нельзя принимать за подтверждение свежего текста.
   */
  const runRef = useRef(0);
  const commitRef = useRef<(html: string) => void>(() => {});

  const mentionItems = useMentionItems();

  const editor = useEditor({
    extensions: docExtensions({ placeholder, mentionItems }),
    content: value || "",
    editable,
    immediatelyRender: false,
    autofocus: autofocus ? "end" : false,
    editorProps: {
      attributes: { class: "doc-content" },
      ...uploads.editorProps,
    },
    onUpdate: ({ editor: e }) => {
      // Вставка только что легла в документ — метки картинок на месте, можно
      // грузить. Раньше этого момента искать их в документе нечем.
      uploads.onUpdate();
      if (timerRef.current) clearTimeout(timerRef.current);
      // Правка, вернувшая текст к сохранённому (отмена через Ctrl+Z), — уже не
      // правка: сохранять нечего, и кнопка не должна звать в никуда.
      if (docHtml(e) === savedRef.current) {
        timerRef.current = null;
        if (statusRef.current !== "saving") setSaveStatus("saved");
        return;
      }
      setSaveStatus("dirty");
      timerRef.current = setTimeout(() => {
        // Обнулить обязательно: пока ссылка на таймер жива, синхронизация ниже
        // считает, что правка ещё не уехала, и не накатывает чужие изменения —
        // после первого же нажатия клавиши описание навсегда переставало их
        // подхватывать.
        timerRef.current = null;
        commitRef.current(docHtml(e));
      }, AUTOSAVE_DELAY_MS);
    },
  });

  const commit = useCallback(
    (html: string) => {
      const run = ++runRef.current;
      setSaveStatus("saving");
      void (async () => {
        let ok: boolean;
        try {
          ok = (await onSaveRef.current(html)) !== false;
        } catch {
          ok = false;
        }
        if (runRef.current !== run) return;
        if (!ok) {
          setSaveStatus("error");
          return;
        }
        savedRef.current = html;
        // Пока ответ шёл, могли напечатать ещё — тогда сохранено не всё.
        const stale = !!editor && !editor.isDestroyed && docHtml(editor) !== html;
        setSaveStatus(stale ? "dirty" : "saved");
      })();
    },
    [editor, setSaveStatus],
  );
  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  /**
   * Первое «сохранённое» — не строка с сервера, а то, как её пишет сам редактор.
   *
   * Санитайзер отдаёт разметку иначе, чем Tiptap: пустое значение атрибута он
   * опускает (`data-image=""` → `data-image`). Документ от этого не меняется, но
   * посимвольное сравнение видит правку — и описание пересохранялось при каждом
   * открытии, хотя его не трогали: лишний запрос и лишняя запись в истории
   * задачи на ровном месте.
   */
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    savedRef.current = docHtml(editor);
  }, [editor]);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!editor || editor.isDestroyed) return;
    const html = docHtml(editor);
    if (html === savedRef.current) {
      if (statusRef.current !== "saving") setSaveStatus("saved");
      return;
    }
    commit(html);
  }, [editor, commit, setSaveStatus]);

  // Уход со страницы, закрытие карточки, размонтирование — правка не должна
  // теряться из-за того, что пауза автосохранения не успела истечь.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);
  useEffect(() => () => flushRef.current(), []);

  // Загрузка работает не с тем редактором, что был при вызове хука: он
  // создаётся ниже. Связываем эффектом — обработчики вставки всё равно
  // срабатывают только после монтирования.
  const bindUploads = uploads.bind;
  useEffect(() => {
    bindUploads(editor);
  }, [bindUploads, editor]);

  // Синхронизация при смене задачи и при чужой правке. Своя правка, вернувшаяся
  // с сервера, документ не трогает — иначе редактор перерисовывался бы после
  // каждого автосохранения, теряя курсор.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    // Есть несохранённое — пауза идёт, запрос в пути или сорвался: пришедшее
    // значение заведомо старее набранного, накатывать его нельзя. Особенно при
    // `error`, где редактор — единственное место, где правка ещё жива.
    if (statusRef.current !== "saved") return;
    if (sameAsDocument(editor, value || "")) return;
    editor.commands.setContent(value || "", { emitUpdate: false });
    // Опять же разметка редактора, а не пришедшая строка — см. эффект выше.
    savedRef.current = docHtml(editor);
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  return {
    editor,
    uploading: uploads.uploading,
    error: uploads.error,
    clearError: uploads.clearError,
    uploadFiles: uploads.uploadFiles,
    flush,
    status,
  };
}
