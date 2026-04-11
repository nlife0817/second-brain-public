"use client";

import { useState } from "react";
import { useBrainStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { ItemType } from "@/types";

const TYPES: { value: ItemType; label: string; emoji: string }[] = [
  { value: "task", label: "Задача", emoji: "✓" },
  { value: "note", label: "Заметка", emoji: "📝" },
  { value: "meeting", label: "Встреча", emoji: "📅" },
  { value: "idea", label: "Идея", emoji: "💡" },
];

function todayStr() {
  return format(new Date(), "yyyy-MM-dd");
}

export function MobileInboxForm() {
  const categories = useBrainStore((s) => s.categories);
  const createItem = useBrainStore((s) => s.createItem);

  const [type, setType] = useState<ItemType>("task");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(todayStr);
  const [category, setCategory] = useState("other");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await createItem({
        title: title.trim(),
        description: description.trim() || undefined,
        type,
        status: "inbox",
        priority: "none",
        due_date: dueDate || null,
        category: category || "other",
      });
      setTitle("");
      setDescription("");
      setDueDate(todayStr());
      setCategory("other");
      setType("task");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка при создании. Попробуйте ещё раз.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Type toggle chips */}
      <div>
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Тип
        </p>
        <div className="grid grid-cols-4 gap-2">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setType(t.value)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-2xl border px-2 py-3 text-xs font-medium transition-all duration-150 active:scale-95",
                type === t.value
                  ? "border-violet-500 bg-violet-600 text-white shadow-sm shadow-violet-200 dark:shadow-violet-950"
                  : "border-border bg-muted/50 text-muted-foreground hover:border-violet-300 hover:bg-muted"
              )}
            >
              <span className="text-base leading-none">{t.emoji}</span>
              <span className="leading-none">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main content card */}
      <div className="space-y-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {/* Title field */}
        <div className="px-4 pt-4 pb-3">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Название <span className="text-red-500">*</span>
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Что нужно сделать?"
            className="w-full bg-transparent text-base font-medium text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            autoFocus
            required
          />
        </div>

        <div className="mx-4 border-t border-border/60" />

        {/* Description field */}
        <div className="px-4 pt-3 pb-4">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Описание
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Дополнительные детали..."
            rows={3}
            className="w-full resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
        </div>
      </div>

      {/* Secondary fields */}
      <div className="grid grid-cols-2 gap-3">
        {/* Due date */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Дедлайн
          </label>
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="h-auto border-0 bg-transparent p-0 text-sm font-medium shadow-none focus-visible:ring-0"
          />
        </div>

        {/* Category */}
        {categories.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Категория
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full bg-transparent text-sm font-medium text-foreground focus:outline-none"
            >
              <option value="">Без категории</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/50 dark:text-red-400">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Submit */}
      <Button
        type="submit"
        disabled={!title.trim() || loading}
        className={cn(
          "h-14 w-full rounded-2xl text-base font-semibold transition-all duration-150 active:scale-[0.98]",
          success
            ? "bg-emerald-600 hover:bg-emerald-600"
            : "bg-violet-600 hover:bg-violet-700"
        )}
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Сохранение...
          </>
        ) : success ? (
          <>
            <CheckCircle2 className="mr-2 h-5 w-5" />
            Добавлено!
          </>
        ) : (
          "Добавить"
        )}
      </Button>
    </form>
  );
}
