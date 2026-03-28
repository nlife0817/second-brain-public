"use client";

import { useBrainStore } from "@/lib/store";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

const CARD_FIELDS = [
  { key: "priority", label: "Приоритет" },
  { key: "category", label: "Категория" },
  { key: "due_date", label: "Дедлайн" },
  { key: "subtasks", label: "Подзадачи" },
  { key: "type", label: "Тип" },
] as const;

export function CardSettingsPopover() {
  const cardVisibleFields = useBrainStore((s) => s.cardVisibleFields);
  const setCardVisibleFields = useBrainStore((s) => s.setCardVisibleFields);

  const toggleField = (field: string) => {
    if (cardVisibleFields.includes(field)) {
      setCardVisibleFields(cardVisibleFields.filter((f) => f !== field));
    } else {
      setCardVisibleFields([...cardVisibleFields, field]);
    }
  };

  return (
    <Popover>
      <Tooltip>
        <PopoverTrigger
          render={
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="rounded-md text-slate-400 hover:text-slate-600"
                />
              }
            />
          }
        >
          <Eye className="size-3.5" />
        </PopoverTrigger>
        <TooltipContent side="bottom">Отображение карточки</TooltipContent>
      </Tooltip>

      <PopoverContent align="end" sideOffset={8} className="w-56">
        <PopoverHeader>
          <PopoverTitle className="text-[13px] font-semibold text-slate-800">
            Отображение карточки
          </PopoverTitle>
        </PopoverHeader>

        <div className="flex flex-col gap-1">
          {CARD_FIELDS.map(({ key, label }) => {
            const checked = cardVisibleFields.includes(key);
            return (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-slate-700 transition-colors hover:bg-slate-50"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={() => toggleField(key)}
                />
                <span>{label}</span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
