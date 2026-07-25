"use client";

// «Потянуть вниз, чтобы обновить» — основной жест обновления на телефоне:
// кнопки перезагрузки в установленном приложении нет, а данные приезжают
// только по запросу экрана.
//
// Компонент сам является прокручиваемой областью: жест начинается только на
// самом верху списка, иначе он мешал бы обычной прокрутке. overscroll-contain
// гасит собственный pull-to-refresh браузера, поэтому перехватывать событие
// (и ломать пассивные слушатели React) не требуется.

import { useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

/** Порог срабатывания и предел, дальше которого список не тянется. */
const TRIGGER_PX = 64;
const MAX_PULL_PX = 96;
/** Сопротивление: палец проходит вдвое больше, чем уезжает список. */
const RESISTANCE = 0.45;

export function PullToRefresh({
  onRefresh,
  className,
  children,
}: {
  onRefresh: () => void | Promise<void>;
  className?: string;
  children: React.ReactNode;
}) {
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const startY = useRef<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  function onTouchStart(e: React.TouchEvent) {
    if (busy) return;
    const el = scroller.current;
    if (!el || el.scrollTop > 0) return;
    startY.current = e.touches[0].clientY;
  }

  function onTouchMove(e: React.TouchEvent) {
    if (startY.current === null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy <= 0) {
      // Палец пошёл вверх — это обычная прокрутка, жест отменяем.
      setPull(0);
      setDragging(false);
      return;
    }
    setDragging(true);
    setPull(Math.min(MAX_PULL_PX, dy * RESISTANCE));
  }

  async function finishGesture() {
    const distance = pull;
    startY.current = null;
    setDragging(false);
    if (busy) return;
    if (distance < TRIGGER_PX) {
      setPull(0);
      return;
    }
    // Индикатор остаётся на месте порога, пока идёт запрос.
    setBusy(true);
    setPull(TRIGGER_PX);
    try {
      await onRefresh();
    } finally {
      setBusy(false);
      setPull(0);
    }
  }

  const visible = pull > 4 || busy;

  return (
    <div
      ref={scroller}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={() => void finishGesture()}
      onTouchCancel={() => void finishGesture()}
      className={cn("relative min-h-0 flex-1 overflow-y-auto overscroll-contain", className)}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 flex justify-center overflow-hidden"
        style={{ height: pull, opacity: visible ? 1 : 0 }}
      >
        <RefreshCw
          className={cn(
            "mt-3 size-5",
            busy && "animate-spin",
            pull >= TRIGGER_PX ? "text-foreground" : "text-muted-foreground",
          )}
          style={busy ? undefined : { transform: `rotate(${Math.round(pull * 3)}deg)` }}
        />
      </div>
      <div
        style={{
          transform: pull ? `translateY(${pull}px)` : undefined,
          transition: dragging ? undefined : "transform 200ms ease-out",
        }}
      >
        {children}
      </div>
    </div>
  );
}
