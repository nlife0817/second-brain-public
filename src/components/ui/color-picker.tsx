"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export const PRESET_COLORS = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#8b5cf6", "#ec4899", "#6b7280", "#14b8a6",
];

export function ColorPickerButton({
  value,
  onChange,
  size = "md",
  className,
}: {
  value: string;
  onChange: (color: string) => void;
  size?: "sm" | "md";
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "shrink-0 rounded-full border-2 border-white ring-1 ring-slate-200 shadow-sm transition-all hover:ring-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400",
          size === "sm" ? "size-4" : "size-5",
          className,
        )}
        style={{ backgroundColor: value }}
        aria-label="Выбрать цвет"
      />
      <PopoverContent align="start" sideOffset={6} className="w-auto p-2.5">
        <div className="grid grid-cols-5 gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { onChange(c); setOpen(false); }}
              className={cn(
                "size-6 rounded-full border-2 transition-all hover:scale-110",
                value === c ? "border-slate-800 scale-110" : "border-transparent hover:border-slate-300",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-2">
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="size-5 cursor-pointer rounded border-0 p-0"
          />
          <span className="text-xs text-slate-400">Свой цвет</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
