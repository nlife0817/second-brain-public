"use client";

// Нижняя полоса: листы книги и итоги по выделению.
//
// Итоги (сумма, среднее, количество) — не украшение: это самый частый вопрос к
// таблице, и в Excel с Google Sheets на него отвечает ровно эта строка. Считаем
// по выделению и только по числам — текст и пустые в сумму не входят, как везде.

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatValue } from "@/lib/core/sheet/format";
import { getCell, SHEET_LIMITS } from "@/lib/core/sheet/model";
import { cn } from "@/lib/utils";
import type { SheetApi } from "./use-sheet";

export function SheetTabs({ api, editable }: { api: SheetApi; editable: boolean }) {
  const [renaming, setRenaming] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  const summary = useMemo(() => {
    const { sheet, range } = api;
    let count = 0;
    let numbers = 0;
    let sum = 0;
    for (let row = range.r1; row <= range.r2; row++) {
      for (let col = range.c1; col <= range.c2; col++) {
        const cell = getCell(sheet, row, col);
        if (!cell || cell.v === undefined || cell.v === null || cell.v === "") continue;
        count++;
        if (typeof cell.v === "number") {
          numbers++;
          sum += cell.v;
        }
      }
    }
    return { count, numbers, sum };
  }, [api]);

  return (
    <div className="flex items-center gap-1 border-t border-border bg-muted/30 px-2 py-1">
      {api.workbook.sheets.map((sheet, index) => {
        const activeTab = index === api.sheetIndex;
        if (renaming === index) {
          return (
            <input
              key={sheet.id}
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => {
                if (draft.trim()) api.renameSheet(draft.trim());
                setRenaming(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") setRenaming(null);
              }}
              className="h-6 w-28 rounded border border-primary bg-background px-1.5 text-xs outline-none"
            />
          );
        }
        // Неактивная вкладка — обычная кнопка перехода, активная — ещё и меню
        // листа. Одним триггером это не сделать: `disabled` с него уезжает на
        // саму кнопку, и по неактивной вкладке нельзя было бы даже кликнуть.
        if (!activeTab || !editable) {
          return (
            <button
              key={sheet.id}
              type="button"
              onClick={() => api.selectSheet(index)}
              className={cn(
                "h-6 max-w-40 truncate rounded px-2 text-xs transition-colors",
                activeTab
                  ? "bg-background font-semibold text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {sheet.name}
            </button>
          );
        }
        return (
          <DropdownMenu key={sheet.id}>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  title="Переименовать или удалить лист"
                  className="h-6 max-w-40 truncate rounded bg-background px-2 text-xs font-semibold text-foreground shadow-sm"
                >
                  {sheet.name}
                </button>
              }
            />
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuItem
                onClick={() => {
                  setDraft(sheet.name);
                  setRenaming(index);
                }}
              >
                Переименовать
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={api.workbook.sheets.length <= 1}
                onClick={api.removeSheet}
              >
                <X className="size-4" />
                Удалить лист
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}

      {editable && api.workbook.sheets.length < SHEET_LIMITS.sheets && (
        <button
          type="button"
          onClick={api.addSheet}
          title="Добавить лист"
          aria-label="Добавить лист"
          className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      )}

      <span className="flex-1" />

      {summary.count > 1 && (
        <span className="flex items-center gap-3 pr-2 text-xs text-muted-foreground">
          <span>Ячеек: {summary.count}</span>
          {summary.numbers > 0 && (
            <>
              <span>Сумма: {formatValue(summary.sum)}</span>
              <span>Среднее: {formatValue(summary.sum / summary.numbers)}</span>
            </>
          )}
        </span>
      )}
    </div>
  );
}
