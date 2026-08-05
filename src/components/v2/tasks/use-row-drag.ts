"use client";

// Перетаскивание строк в вертикальном списке — общее для настроек колонок и
// секции подзадач. Реализация на событиях указателя, а не на dnd-kit: списки
// здесь короткие и живут внутри поповера и карточки, а dnd-kit пересчитывает
// своих draggable на каждое движение мыши.
//
// Ключевые свойства, ради которых это вынесено в одно место:
//  - место вставки — чистая функция от смещения, поэтому оно не «дребезжит» на
//    границе соседей;
//  - новый порядок уходит наружу ровно в момент отпускания: следующий кадр
//    рисует строки уже переставленными и с нулевыми сдвигами, то есть там же,
//    где они были под пальцем;
//  - состояние продублировано в ref — события указателя приходят пачками, и
//    замыкание рендера теряет те, что пришли до перерисовки.

import { useRef, useState } from "react";
import type React from "react";

/** Запас на случай, если высоту строки измерить не удалось. */
const FALLBACK_ROW_HEIGHT = 32;

interface RowDrag {
  id: string;
  from: number;
  to: number;
  dy: number;
  step: number;
}

export interface RowDragHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
}

export interface RowDragApi {
  /** Ничего не перетаскивают — списку можно вернуть обычные наведения. */
  idle: boolean;
  draggingId: string | null;
  /** Сдвиг строки по вертикали во время перетаскивания. */
  shiftOf: (index: number) => number;
  /** Обработчики для ручки перетаскивания. */
  handlers: (index: number, id: string) => RowDragHandlers;
}

/**
 * `count` — сколько строк в списке сейчас, `onReorder` — что делать с
 * перестановкой. Хук не владеет данными: порядок хранят вызывающие (стор
 * колонок, сервер подзадач), а здесь только жест.
 */
export function useRowDrag(count: number, onReorder: (from: number, to: number) => void): RowDragApi {
  const [drag, setDrag] = useState<RowDrag | null>(null);
  const dragRef = useRef<RowDrag | null>(null);
  const grabbedAt = useRef(0);

  function setDragState(next: RowDrag | null) {
    dragRef.current = next;
    setDrag(next);
  }

  function move(from: number, delta: number) {
    const to = from + delta;
    if (from < 0 || to < 0 || to >= count) return;
    onReorder(from, to);
  }

  function handlers(index: number, id: string): RowDragHandlers {
    return {
      onPointerDown: (e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        const row = e.currentTarget.parentElement;
        grabbedAt.current = e.clientY;
        // Захват указателя обязателен: без него палец, ушедший с ручки,
        // перестаёт слать события. Отказ (указатель уже отпущен) не повод
        // ронять обработчик.
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* перетаскивание всё равно отработает, пока курсор над ручкой */
        }
        setDragState({
          id,
          from: index,
          to: index,
          dy: 0,
          step: row?.getBoundingClientRect().height || FALLBACK_ROW_HEIGHT,
        });
      },
      onPointerMove: (e) => {
        const current = dragRef.current;
        if (!current) return;
        const dy = e.clientY - grabbedAt.current;
        const to = Math.max(0, Math.min(count - 1, current.from + Math.round(dy / current.step)));
        setDragState({ ...current, dy, to });
      },
      onPointerUp: () => {
        const current = dragRef.current;
        if (!current) return;
        setDragState(null);
        if (current.from !== current.to) onReorder(current.from, current.to);
      },
      onPointerCancel: () => setDragState(null),
      onKeyDown: (e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        move(index, e.key === "ArrowUp" ? -1 : 1);
      },
    };
  }

  function shiftOf(index: number): number {
    if (!drag) return 0;
    if (index === drag.from) {
      // Не отпускаем строку за пределы списка: иначе она уезжает в никуда и
      // тянет за собой полосу прокрутки контейнера.
      const up = -drag.from * drag.step;
      const down = (count - 1 - drag.from) * drag.step;
      return Math.max(up, Math.min(down, drag.dy));
    }
    if (drag.from < drag.to && index > drag.from && index <= drag.to) return -drag.step;
    if (drag.to < drag.from && index >= drag.to && index < drag.from) return drag.step;
    return 0;
  }

  return { idle: drag === null, draggingId: drag?.id ?? null, shiftOf, handlers };
}
