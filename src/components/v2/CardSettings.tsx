"use client";

// Что показывать на карточке задачи. Настройка общая для доски и «Моих
// задач»: карточка везде одна и та же.

import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CARD_FIELDS, useCardStore } from "@/lib/core/view-store";

export function CardSettingsPopover() {
  const cardFields = useCardStore((s) => s.cardFields);
  const toggleCardField = useCardStore((s) => s.toggleCardField);

  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="sm" className="gap-1.5 text-xs" />}>
        <Eye className="size-3.5" />
        <span className="hidden sm:inline">Карточка</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 gap-1 p-2">
        <span className="px-1 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Показывать на карточке
        </span>
        {CARD_FIELDS.map((field) => (
          <label
            key={field.id}
            className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-sm hover:bg-muted"
          >
            <Checkbox
              checked={cardFields.includes(field.id)}
              onCheckedChange={() => toggleCardField(field.id)}
            />
            <span>{field.label}</span>
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}
