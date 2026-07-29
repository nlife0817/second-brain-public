"use client";

// Оболочка карточки задачи: боковая панель справа или модальное окно по центру.
// Выбор — настройка пользователя (`useTaskOpenStore`), но на узком экране
// всегда панель: модалка по центру телефона — это та же панель, только с
// полями по краям и без безопасных зон.

import { useSyncExternalStore } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useTaskOpenStore, type TaskOpenMode } from "@/lib/core/view-store";

const WIDE_QUERY = "(min-width: 640px)";

function subscribeWide(cb: () => void): () => void {
  const mq = window.matchMedia(WIDE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** Признак читаем через useSyncExternalStore — setState в эффекте здесь запрещён. */
export function useWideViewport(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

export function SidePanel({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Заголовок для скринридеров — визуально его несёт содержимое. */
  title: string;
  children: React.ReactNode;
}) {
  const mode: TaskOpenMode = useTaskOpenStore((s) => s.mode);
  const wide = useWideViewport();

  if (mode === "modal" && wide) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[min(88vh,900px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          {children}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        // На телефоне панель занимает весь экран и рисуется поверх оболочки:
        // без отступов безопасной зоны шапка уезжает под чёлку, а нижние
        // кнопки — под домашний индикатор.
        className="flex flex-col gap-0 overflow-hidden p-0 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] data-[side=right]:w-full data-[side=right]:sm:max-w-xl sm:pb-0 sm:pt-0"
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
