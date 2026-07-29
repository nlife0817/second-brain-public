"use client";

// Список участников, всплывающий после «@». Отдельный компонент, потому что
// suggestion-плагин Tiptap рисует его сам через ReactRenderer и общается с ним
// через ref: стрелки и Enter приходят из редактора, а не из DOM попапа.

import { forwardRef, useImperativeHandle, useState } from "react";
import { Avatar } from "@/components/v2/bits";
import { cn } from "@/lib/utils";

export interface MentionItem {
  id: string;
  label: string;
  email: string;
  avatar_url: string | null;
}

export interface MentionListHandle {
  /** true — клавиша съедена списком и до редактора не дойдёт. */
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const MentionList = forwardRef<
  MentionListHandle,
  { items: MentionItem[]; command: (item: { id: string; label: string }) => void }
>(function MentionList({ items, command }, ref) {
  const [active, setActive] = useState(0);

  function pick(index: number) {
    const item = items[index];
    if (item) command({ id: item.id, label: item.label });
  }

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (items.length === 0) return false;
      if (event.key === "ArrowUp") {
        setActive((i) => (i + items.length - 1) % items.length);
        return true;
      }
      if (event.key === "ArrowDown") {
        setActive((i) => (i + 1) % items.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        pick(active);
        return true;
      }
      return false;
    },
  }));

  if (items.length === 0) {
    return (
      <div className="w-64 rounded-lg border border-border bg-popover p-2 text-xs text-muted-foreground shadow-md">
        Никого не нашли
      </div>
    );
  }

  return (
    <div className="flex max-h-64 w-64 flex-col overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md">
      {items.map((m, i) => (
        <button
          key={m.id}
          type="button"
          // mousedown, а не click: клик уводит фокус из редактора раньше, чем
          // отработает команда, и подстановка попадает уже не туда.
          onMouseDown={(e) => {
            e.preventDefault();
            pick(i);
          }}
          onMouseEnter={() => setActive(i)}
          className={cn(
            "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm",
            i === active ? "bg-muted" : "hover:bg-muted/60",
          )}
        >
          <Avatar user={{ id: m.id, email: m.email, name: m.label, avatar_url: m.avatar_url }} size="xs" />
          <span className="min-w-0 flex-1 truncate">{m.label}</span>
        </button>
      ))}
    </div>
  );
});
