"use client";

// Строка формул: адрес активной ячейки и её ИСХОДНЫЙ текст.
//
// Именно исходный: в ячейке видно «1 234,50 ₽», а здесь — «1234,5», в ячейке
// «12», а здесь «=A1+A2». Без этого формулу нельзя ни прочитать, ни поправить,
// а число с форматом при правке возвращалось бы в таблицу текстом с пробелами.
//
// Ввод отсюда — тот же ввод, что в ячейке: поле не хранит своего состояния, а
// правит `editing` в общем состоянии таблицы. Иначе набранное в строке формул
// и набранное в ячейке разъезжались бы между собой.

import { cellRef } from "@/lib/core/sheet/model";
import { cn } from "@/lib/utils";
import type { SheetApi } from "./use-sheet";

export function FormulaBar({ api, editable }: { api: SheetApi; editable: boolean }) {
  const { active, editing } = api;
  const editingHere = editing && editing.row === active.row && editing.col === active.col;
  const text = editingHere ? editing.text : api.sourceAt(active.row, active.col);

  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-1">
      <span className="w-16 shrink-0 rounded border border-border px-1.5 py-0.5 text-center font-mono text-xs text-muted-foreground">
        {cellRef(active.row, active.col)}
      </span>
      <span className="shrink-0 font-mono text-sm text-muted-foreground" aria-hidden>
        fx
      </span>
      <input
        value={text}
        readOnly={!editable}
        onChange={(event) => {
          if (!editingHere) api.beginEdit(event.target.value);
          else api.changeEdit(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            api.commitEdit({ row: 1, col: 0 });
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            api.cancelEdit();
            event.currentTarget.blur();
          }
        }}
        onBlur={() => {
          if (editingHere) api.commitEdit();
        }}
        placeholder={editable ? "Значение или =формула" : ""}
        aria-label="Содержимое ячейки"
        className={cn(
          "min-w-0 flex-1 bg-transparent font-mono text-sm outline-none placeholder:text-muted-foreground/60",
          !editable && "text-muted-foreground",
        )}
      />
    </div>
  );
}
