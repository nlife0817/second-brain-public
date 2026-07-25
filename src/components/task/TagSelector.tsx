"use client";

import { useState, useMemo, useCallback } from "react";
import { useBrainStore } from "@/lib/store";
import type { Tag } from "@/types";

import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, X, Tag as TagIcon } from "lucide-react";

const PRESET_COLORS = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#06b6d4",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#6b7280",
];

interface TagSelectorProps {
  selectedTags: Tag[];
  onTagsChange: (tagIds: string[]) => void;
}

export function TagSelector({ selectedTags, onTagsChange }: TagSelectorProps) {
  const allTags = useBrainStore((s) => s.tags);
  const createTag = useBrainStore((s) => s.createTag);

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState(PRESET_COLORS[5]);
  const [isCreating, setIsCreating] = useState(false);

  const selectedIds = useMemo(
    () => new Set(selectedTags.map((t) => t.id)),
    [selectedTags]
  );

  const filteredTags = useMemo(() => {
    if (!search.trim()) return allTags;
    const q = search.toLowerCase().trim();
    return allTags.filter((t) => t.name.toLowerCase().includes(q));
  }, [allTags, search]);

  const handleToggle = useCallback(
    (tagId: string) => {
      const next = selectedIds.has(tagId)
        ? selectedTags.filter((t) => t.id !== tagId).map((t) => t.id)
        : [...selectedTags.map((t) => t.id), tagId];
      onTagsChange(next);
    },
    [selectedIds, selectedTags, onTagsChange]
  );

  const handleRemove = useCallback(
    (tagId: string) => {
      onTagsChange(selectedTags.filter((t) => t.id !== tagId).map((t) => t.id));
    },
    [selectedTags, onTagsChange]
  );

  const handleCreate = useCallback(async () => {
    const name = newTagName.trim();
    if (!name || isCreating) return;
    setIsCreating(true);
    try {
      const tag = await createTag(name, newTagColor);
      onTagsChange([...selectedTags.map((t) => t.id), tag.id]);
      setNewTagName("");
      setNewTagColor(PRESET_COLORS[5]);
    } finally {
      setIsCreating(false);
    }
  }, [newTagName, newTagColor, isCreating, createTag, selectedTags, onTagsChange]);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {selectedTags.map((tag) => (
        <Badge
          key={tag.id}
          variant="secondary"
          className="gap-1 pr-1"
          style={{ backgroundColor: tag.color + "18", color: tag.color }}
        >
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: tag.color }}
          />
          {tag.name}
          <button
            type="button"
            onClick={() => handleRemove(tag.id)}
            className="ml-0.5 rounded-sm p-0.5 opacity-60 transition-opacity hover:opacity-100"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button variant="ghost" size="icon-xs" className="size-5" />
          }
        >
          <Plus className="size-3" />
        </PopoverTrigger>

        <PopoverContent align="start" className="w-64 p-0">
          {/* Search */}
          <div className="p-2 pb-0">
            <Input
              placeholder="Поиск тегов..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 text-xs"
            />
          </div>

          {/* Tag list */}
          <div className="max-h-48 overflow-y-auto p-2">
            {filteredTags.length === 0 && (
              <p className="py-2 text-center text-xs text-muted-foreground">
                Ничего не найдено
              </p>
            )}
            {filteredTags.map((tag) => (
              <label
                key={tag.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
              >
                <Checkbox
                  checked={selectedIds.has(tag.id)}
                  onCheckedChange={() => handleToggle(tag.id)}
                />
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: tag.color }}
                />
                <span className="truncate">{tag.name}</span>
              </label>
            ))}
          </div>

          {/* Create new tag */}
          <div className="border-t p-2">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Новый тег
            </p>
            <div className="flex items-center gap-1.5">
              <Input
                placeholder="Название..."
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleCreate();
                  }
                }}
                className="h-7 flex-1 text-xs"
              />
              <Button
                variant="default"
                size="xs"
                disabled={!newTagName.trim() || isCreating}
                onClick={handleCreate}
              >
                <TagIcon className="size-3" />
              </Button>
            </div>

            {/* Color picker */}
            <div className="mt-1.5 flex items-center gap-1">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setNewTagColor(color)}
                  className="size-4 shrink-0 rounded-full border border-transparent transition-transform hover:scale-110"
                  style={{
                    backgroundColor: color,
                    borderColor:
                      newTagColor === color
                        ? "var(--color-foreground)"
                        : "transparent",
                    outline:
                      newTagColor === color
                        ? "2px solid var(--color-background)"
                        : "none",
                    outlineOffset: "-2px",
                  }}
                />
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
