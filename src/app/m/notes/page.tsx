"use client";

import { useEffect, useMemo } from "react";
import { useBrainStore } from "@/lib/store";
import { StickyNote, FileText } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";

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
        <div className="flex items-center gap-3 px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-950">
            <StickyNote className="h-4 w-4 text-amber-600" />
          </div>
          <div className="flex-1">
            <h1 className="text-base font-bold leading-tight text-foreground">Заметки</h1>
            <p className="text-xs text-muted-foreground">
              {notes.length > 0 ? `${notes.length} заметок` : "Нет заметок"}
            </p>
          </div>
          {notes.length > 0 && (
            <span className="flex h-7 min-w-[28px] items-center justify-center rounded-xl bg-amber-100 px-2 text-sm font-bold text-amber-600 dark:bg-amber-950 dark:text-amber-400">
              {notes.length}
            </span>
          )}
        </div>
      </div>

      {notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-muted">
            <FileText className="h-8 w-8 text-muted-foreground/40" />
          </div>
          <p className="font-semibold text-foreground">Заметок пока нет</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Создайте заметку через Inbox
          </p>
        </div>
      ) : (
        <div className="space-y-3 px-4 py-4">
          {notes.map((note) => {
            // Strip HTML tags for plain text preview
            const preview = note.description
              ? note.description.replace(/<[^>]*>/g, "").slice(0, 140)
              : "";

            const hasCategory = note.category && note.category !== "other";

            return (
              <div
                key={note.id}
                className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-colors active:bg-muted/50"
              >
                {/* Amber accent stripe */}
                <div className="h-1 w-full bg-gradient-to-r from-amber-400 to-amber-300" />

                <div className="p-4">
                  {/* Title + date row */}
                  <div className="flex items-start justify-between gap-3">
                    <p className="flex-1 font-semibold leading-snug text-card-foreground">
                      {note.title}
                    </p>
                    <span className="flex-shrink-0 rounded-lg bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                      {format(parseISO(note.updated_at), "d MMM", { locale: ru })}
                    </span>
                  </div>

                  {/* Preview text */}
                  {preview && (
                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                      {preview}
                    </p>
                  )}

                  {/* Category badge */}
                  {hasCategory && (
                    <div className="mt-3">
                      <span className="inline-flex items-center rounded-xl bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                        {note.category}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
