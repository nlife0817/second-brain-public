"use client";

// Видимая зона сброса файлов. Сам сброс редактор принимал и раньше
// (`handleDrop` в `useDocEditor`), но узнать об этом было неоткуда: документ
// никак не отзывался на файл под курсором. Здесь только подсветка и подсказка —
// загрузку по-прежнему делает владелец редактора.

import { useRef, useState } from "react";
import type { DragEvent } from "react";
import { MAX_UPLOAD_BYTES } from "./upload";

/** Тянут именно файлы, а не картинку из самого документа (узел `docImage`
 *  объявлен draggable — без этой проверки зона подсвечивалась бы и на нём). */
function draggingFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes("Files");
}

export interface UseFileDropOptions {
  /** У черновика задачи прикреплять некуда — подсветку не включаем вовсе. */
  enabled: boolean;
  onFiles: (files: File[]) => void;
}

export interface FileDropApi {
  /** Файл занесён над зоной — пора показать оверлей. */
  active: boolean;
  /** Раскладывается на обёртку зоны: `{...drop.handlers}`. */
  handlers: {
    onDragEnter: (e: DragEvent) => void;
    onDragOver: (e: DragEvent) => void;
    onDragLeave: (e: DragEvent) => void;
    onDrop: (e: DragEvent) => void;
  };
}

export function useFileDrop({ enabled, onFiles }: UseFileDropOptions): FileDropApi {
  // Счётчик глубины, а не флаг: dragleave прилетает на каждом переходе между
  // дочерними узлами, и подсветка мигала бы на каждой строке текста.
  const depth = useRef(0);
  const [active, setActive] = useState(false);

  return {
    active: active && enabled,
    handlers: {
      onDragEnter: (e) => {
        if (!enabled || !draggingFiles(e)) return;
        depth.current += 1;
        setActive(true);
      },
      onDragOver: (e) => {
        if (!enabled || !draggingFiles(e)) return;
        // Без preventDefault браузер считает зону непринимающей и сброса не
        // будет вовсе — вместо этого он откроет файл в соседней вкладке.
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      },
      onDragLeave: () => {
        if (depth.current === 0) return;
        depth.current -= 1;
        if (depth.current === 0) setActive(false);
      },
      onDrop: (e) => {
        // На сброс dragleave не приходит — гасим подсветку сами.
        depth.current = 0;
        setActive(false);
        if (!enabled) return;
        // `handleDrop` редактора уже забрал файлы себе: он вызвал
        // preventDefault, но всплытие не остановил — без этой проверки тот же
        // файл уехал бы на сервер дважды.
        if (e.defaultPrevented) return;
        const files = Array.from(e.dataTransfer.files);
        if (!files.length) return;
        e.preventDefault();
        onFiles(files);
      },
    },
  };
}

/**
 * Постоянная подсказка под редактором: без неё про сброс и вставку из буфера
 * знает только тот, кто их наугад попробовал. Предел берётся из константы
 * загрузки — расписанный словами, он разошёлся бы с ней на первой же правке.
 */
export function fileDropHint(canUpload: boolean): string {
  return canUpload
    ? `Перетащите файл сюда или вставьте из буфера — до ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} МБ`
    : "Файлы можно прикрепить после сохранения задачи";
}
