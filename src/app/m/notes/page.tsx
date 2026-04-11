"use client";

import { useEffect, useMemo } from "react";
import { useBrainStore } from "@/lib/store";
import { StickyNote } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";

export default function MobileNotesPage() {
  const fetchInit = useBrainStore((s) => s.fetchInit);
  const items = useBrainStore((s) => s.items);

  useEffect(() => {
    fetchInit();
  }, [fetchInit]);

  const notes = useMemo(
    () =>
      items
        .filter((item) => item.type === "note" && item.status !== "archived" && !item.parent_id)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [items]
  );

  return (
    <div className="min-h-full bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100">
            <StickyNote className="h-4 w-4 text-amber-600" />
          </div>
          <h1 className="text-lg font-semibold">Заметки</h1>
          {notes.length > 0 && (
            <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {notes.length}
            </span>
          )}
        </div>
      </div>

      <div className="divide-y divide-border">
        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <StickyNote className="mb-3 h-10 w-10 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">Заметок пока нет</p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Создайте заметку через Inbox
            </p>
          </div>
        ) : (
          notes.map((note) => {
            // Strip HTML tags for plain text preview
            const preview = note.description
              ? note.description.replace(/<[^>]*>/g, "").slice(0, 120)
              : "";

            return (
              <div key={note.id} className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium leading-snug text-foreground">{note.title}</p>
                  <span className="flex-shrink-0 text-xs text-muted-foreground">
                    {format(parseISO(note.updated_at), "d MMM", { locale: ru })}
                  </span>
                </div>
                {preview && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{preview}</p>
                )}
                {note.category && note.category !== "other" && (
                  <span className="mt-1.5 inline-block rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {note.category}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
