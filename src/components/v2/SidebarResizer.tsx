"use client";

// Правая граница сайдбара как ручка изменения ширины.
//
// Ручка живёт отдельно от оболочки по той же причине, что и остальные жесты
// (`use-row-drag.ts`): в оболочке и без того полсотни строк разметки, а здесь
// собственная возня с захватом указателя, курсором и клавиатурой.

import { useCallback, useRef, useSyncExternalStore } from "react";
import {
  SIDEBAR_COLLAPSE_AT,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth,
} from "@/lib/core/keys";
import { cn } from "@/lib/utils";

/**
 * Доля окна, за которую панель не заходит ни перетаскиванием, ни сохранённой
 * шириной. Ограничение в пикселях от сузившегося окна не спасает: 420 px на
 * ноутбуке в половину экрана — это уже половина рабочей области.
 */
export const SIDEBAR_MAX_VIEWPORT_SHARE = 0.4;

/** То же ограничение для CSS: применяется и когда окно сузили без перетаскивания. */
export const SIDEBAR_VIEWPORT_CAP = `${SIDEBAR_MAX_VIEWPORT_SHARE * 100}vw`;

function capToViewport(width: number): number {
  const cap = Math.max(
    SIDEBAR_MIN_WIDTH,
    Math.round(window.innerWidth * SIDEBAR_MAX_VIEWPORT_SHARE),
  );
  return Math.min(clampSidebarWidth(width), cap);
}

const NARROW_QUERY = "(max-width: 1023px)";

function subscribeNarrow(cb: () => void): () => void {
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/**
 * Окно стало узким — панель уходит в значки сама, до следующего расширения.
 *
 * Через `useSyncExternalStore`, как остальные признаки окружения в
 * `mobile/hooks.ts`: серверный снимок задан явно (`false` — оболочку эту видит
 * десктопный UA), поэтому гидрация не расходится, а правило
 * `react-hooks/set-state-in-effect` не нарушается.
 */
export function useNarrowViewport(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
}

/** Шаг стрелками — заметный, но не прыжок: подобрать ширину с клавиатуры реально. */
const KEY_STEP = 16;

export interface SidebarSize {
  width: number;
  collapsed: boolean;
}

export function SidebarResizer({
  width,
  collapsed,
  onChange,
  onCommit,
  onDraggingChange,
}: {
  /** Ширина развёрнутой панели — от неё считается жест и в свёрнутом виде тоже. */
  width: number;
  collapsed: boolean;
  /** Идёт жест: значения меняются на экране, но в cookie ещё не уехали. */
  onChange: (next: SidebarSize) => void;
  /** Жест окончен — самое время закрепить результат. */
  onCommit: () => void;
  /** Пока тянут, оболочка снимает переход ширины: иначе панель отстаёт от курсора. */
  onDraggingChange: (active: boolean) => void;
}) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const apply = useCallback(
    (raw: number) => {
      // Ниже порога панель схлопывается, но запомненную ширину не теряет:
      // разворот обратным движением обязан вернуть именно её.
      if (raw < SIDEBAR_COLLAPSE_AT) {
        onChange({ width, collapsed: true });
        return;
      }
      onChange({ width: capToViewport(raw), collapsed: false });
    },
    [onChange, width],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      drag.current = {
        startX: e.clientX,
        startWidth: collapsed ? SIDEBAR_COLLAPSED_WIDTH : width,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      // Курсор и выделение — на всё окно: указатель уходит далеко от ручки, и
      // без этого жест выделяет текст панели, а курсор мигает стрелкой.
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      onDraggingChange(true);
      e.preventDefault();
    },
    [collapsed, onDraggingChange, width],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d) return;
      apply(d.startWidth + (e.clientX - d.startX));
    },
    [apply],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!drag.current) return;
      drag.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      onDraggingChange(false);
      onCommit();
    },
    [onCommit, onDraggingChange],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const current = collapsed ? SIDEBAR_COLLAPSED_WIDTH : width;
      if (e.key === "ArrowLeft") apply(current - KEY_STEP);
      else if (e.key === "ArrowRight") apply(current + KEY_STEP);
      else if (e.key === "Home") apply(SIDEBAR_MIN_WIDTH);
      else if (e.key === "End") apply(SIDEBAR_MAX_WIDTH);
      else return;
      e.preventDefault();
      onCommit();
    },
    [apply, collapsed, onCommit, width],
  );

  return (
    <div
      // Полоса шире видимой линии: попасть в один пиксель мышью невозможно.
      className="group absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={() => {
        onChange({ width: capToViewport(SIDEBAR_DEFAULT_WIDTH), collapsed: false });
        onCommit();
      }}
      role="separator"
      aria-orientation="vertical"
      aria-label="Ширина панели"
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={collapsed ? SIDEBAR_COLLAPSED_WIDTH : width}
      tabIndex={0}
      title="Потяните, чтобы изменить ширину (двойной клик — сбросить)"
    >
      <span
        className={cn(
          "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-primary/60",
          "opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100",
        )}
      />
    </div>
  );
}
