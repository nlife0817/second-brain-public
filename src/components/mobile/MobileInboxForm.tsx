"use client";

import { useState } from "react";
import { useBrainStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Loader2 } from "lucide-react";
import type { ItemType } from "@/types";

const TYPES: { value: ItemType; label: string }[] = [
  { value: "task", label: "Задача" },
  { value: "note", label: "Заметка" },
  { value: "meeting", label: "Встреча" },
  { value: "idea", label: "Идея" },
];

export function MobileInboxForm() {
  const categories = useBrainStore((s) => s.categories);
  const createItem = useBrainStore((s) => s.createItem);

  const [type, setType] = useState<ItemType>("task");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [category, setCategory] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    try {
      await createItem({
        title: title.trim(),
        description: description.trim() || undefined,
        type,
        status: "inbox",
        due_date: dueDate || null,
        category: category || "other",
      });
      setTitle("");
      setDescription("");
      setDueDate("");
      setCategory("");
      setType("task");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Type selector */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setType(t.value)}
            className={`flex-shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              type === t.value
                ? "bg-violet-600 text-white"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Title */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          Название <span className="text-red-500">*</span>
        </label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Что нужно сделать?"
          className="text-base"
          autoFocus
          required
        />
      </div>

      {/* Description */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          Описание
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Дополнительные детали..."
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Due date */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-foreground">
          Дедлайн
        </label>
        <Input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="text-base"
        />
      </div>

      {/* Category */}
      {categories.length > 0 && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-foreground">
            Категория
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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

      {/* Submit */}
      <Button
        type="submit"
        disabled={!title.trim() || loading}
        className="w-full bg-violet-600 py-6 text-base font-semibold hover:bg-violet-700"
      >
        {loading ? (
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        ) : success ? (
          <CheckCircle2 className="mr-2 h-5 w-5 text-white" />
        ) : null}
        {success ? "Добавлено!" : "Добавить"}
      </Button>
    </form>
  );
}
