"use client";

// Панель таблицы: оформление, строки и колонки, сортировка и фильтр.
//
// Кнопки работают с выделением, а не с активной ячейкой: «сделать колонку
// денежной» — это выделить колонку и нажать формат, и разделять эти два случая
// незачем. Исключения ровно два и они честные: закрепление и фильтр отвечают на
// вопрос «где именно», и берут активную ячейку.
//
// Кнопки повторяют `ToolButton` из панели редактора описания — той же ширины и
// с тем же поведением по `onMouseDown`: две разные панели в одном приложении
// выглядели бы как две разные программы.

import { useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownAZ,
  ArrowUpAZ,
  Bold,
  Filter,
  Italic,
  Merge,
  PaintBucket,
  Pilcrow,
  Redo2,
  Rows3,
  Columns3,
  Snowflake,
  Strikethrough,
  Trash2,
  Type,
  Underline as UnderlineIcon,
  Undo2,
  WrapText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Divider, ToolButton } from "@/components/v2/editor/Toolbar";
import { FORMAT_LABELS, FORMATS } from "@/lib/core/sheet/format";
import { columnName, SHEET_LIMITS } from "@/lib/core/sheet/model";
import {
  deleteColumns,
  deleteRows,
  insertColumns,
  insertRows,
  mergeRange,
  unmergeRange,
} from "@/lib/core/sheet/ops";
import { cn } from "@/lib/utils";
import type { SheetApi } from "./use-sheet";

/**
 * Палитра. Восемь цветов и «без цвета» — намеренно мало: полноценный подборщик
 * в таблице нужен раз в год, а список из восьми внятных цветов делает документ
 * читаемым, не превращая его в радугу.
 */
const PALETTE = [
  { hex: "#111827", label: "Чёрный" },
  { hex: "#e8734a", label: "Оранжевый" },
  { hex: "#dc2626", label: "Красный" },
  { hex: "#16a34a", label: "Зелёный" },
  { hex: "#2563eb", label: "Синий" },
  { hex: "#7c3aed", label: "Фиолетовый" },
  { hex: "#ca8a04", label: "Жёлтый" },
  { hex: "#6b7280", label: "Серый" },
];

const FILLS = [
  { hex: "#fee2e2", label: "Красная" },
  { hex: "#fef3c7", label: "Жёлтая" },
  { hex: "#dcfce7", label: "Зелёная" },
  { hex: "#dbeafe", label: "Синяя" },
  { hex: "#f3e8ff", label: "Фиолетовая" },
  { hex: "#f3f4f6", label: "Серая" },
];

export function SheetToolbar({ api }: { api: SheetApi }) {
  const { active, range, sheet } = api;
  const style = api.styleAt(active.row, active.col);
  const rowsInRange = range.r2 - range.r1 + 1;
  const colsInRange = range.c2 - range.c1 + 1;

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-3 py-1.5">
      <ToolButton title="Отменить" onClick={api.undo} disabled={!api.canUndo}>
        <Undo2 className="size-4" />
      </ToolButton>
      <ToolButton title="Вернуть" onClick={api.redo} disabled={!api.canRedo}>
        <Redo2 className="size-4" />
      </ToolButton>

      <Divider />

      <ToolButton title="Жирный" active={!!style.b} onClick={() => api.setStyle({ b: style.b ? null : 1 })}>
        <Bold className="size-4" />
      </ToolButton>
      <ToolButton title="Курсив" active={!!style.i} onClick={() => api.setStyle({ i: style.i ? null : 1 })}>
        <Italic className="size-4" />
      </ToolButton>
      <ToolButton
        title="Подчёркнутый"
        active={!!style.u}
        onClick={() => api.setStyle({ u: style.u ? null : 1 })}
      >
        <UnderlineIcon className="size-4" />
      </ToolButton>
      <ToolButton
        title="Зачёркнутый"
        active={!!style.st}
        onClick={() => api.setStyle({ st: style.st ? null : 1 })}
      >
        <Strikethrough className="size-4" />
      </ToolButton>

      <ColorButton
        icon={<Type className="size-4" />}
        title="Цвет текста"
        colors={PALETTE}
        current={style.c}
        onPick={(hex) => api.setStyle({ c: hex })}
      />
      <ColorButton
        icon={<PaintBucket className="size-4" />}
        title="Заливка"
        colors={FILLS}
        current={style.bg}
        onPick={(hex) => api.setStyle({ bg: hex })}
      />

      <Divider />

      <ToolButton
        title="По левому краю"
        active={style.ha === "left"}
        onClick={() => api.setStyle({ ha: style.ha === "left" ? null : "left" })}
      >
        <AlignLeft className="size-4" />
      </ToolButton>
      <ToolButton
        title="По центру"
        active={style.ha === "center"}
        onClick={() => api.setStyle({ ha: style.ha === "center" ? null : "center" })}
      >
        <AlignCenter className="size-4" />
      </ToolButton>
      <ToolButton
        title="По правому краю"
        active={style.ha === "right"}
        onClick={() => api.setStyle({ ha: style.ha === "right" ? null : "right" })}
      >
        <AlignRight className="size-4" />
      </ToolButton>
      <ToolButton
        title="Переносить текст"
        active={!!style.wrap}
        onClick={() => api.setStyle({ wrap: style.wrap ? null : 1 })}
      >
        <WrapText className="size-4" />
      </ToolButton>

      <Divider />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="xs" className="gap-1 px-2 text-xs">
              <Pilcrow className="size-3.5" />
              {FORMAT_LABELS.find((f) => f.code === (style.fmt ?? FORMATS.general))?.label ?? "Формат"}
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          {FORMAT_LABELS.map((format) => (
            <DropdownMenuItem
              key={format.code || "general"}
              onClick={() => api.setStyle({ fmt: format.code || null })}
              className={cn((style.fmt ?? "") === format.code && "bg-muted")}
            >
              <span className="flex-1">{format.label}</span>
              <span className="text-xs text-muted-foreground">{format.sample}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Divider />

      <ToolButton
        title={
          sheet.merges?.some((m) => m === `${columnName(range.c1)}${range.r1 + 1}:${columnName(range.c2)}${range.r2 + 1}`)
            ? "Разъединить ячейки"
            : "Объединить ячейки"
        }
        disabled={rowsInRange === 1 && colsInRange === 1}
        onClick={() => {
          const merged = sheet.merges?.some((item) => {
            const [from] = item.split(":");
            return from === `${columnName(range.c1)}${range.r1 + 1}`;
          });
          api.update(
            merged
              ? unmergeRange(api.workbook, api.sheetIndex, range)
              : mergeRange(api.workbook, api.sheetIndex, range),
          );
        }}
      >
        <Merge className="size-4" />
      </ToolButton>

      <ToolButton
        title={
          sheet.frozen
            ? "Снять закрепление"
            : "Закрепить строки и колонки до активной ячейки"
        }
        active={!!sheet.frozen}
        onClick={() =>
          api.mutate((next) => {
            const target = next.sheets[api.sheetIndex];
            if (!target) return;
            if (target.frozen) {
              target.frozen = undefined;
              return;
            }
            // Закрепляем ВСЁ до активной ячейки: так это и понимают в Excel —
            // «зафиксировать шапку» это встать в A2 и нажать кнопку. Из самой
            // A1 закреплять нечего, а кнопка, которая помечается нажатой и
            // ничего не делает, читается как поломка — поэтому там закрепляем
            // первую строку, чего от неё и ждут.
            target.frozen =
              active.row === 0 && active.col === 0
                ? { rows: 1, cols: 0 }
                : { rows: active.row, cols: active.col };
          })
        }
      >
        <Snowflake className="size-4" />
      </ToolButton>

      <Divider />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="xs" className="gap-1 px-2 text-xs">
              <Rows3 className="size-3.5" />
              Строки
            </Button>
          }
        />
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onClick={() => api.update(insertRows(api.workbook, api.sheetIndex, range.r1, rowsInRange))}
          >
            Вставить {rowsInRange} выше
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              api.update(insertRows(api.workbook, api.sheetIndex, range.r2 + 1, rowsInRange))
            }
          >
            Вставить {rowsInRange} ниже
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => api.update(deleteRows(api.workbook, api.sheetIndex, range.r1, rowsInRange))}
          >
            <Trash2 className="size-4" />
            Удалить {rowsInRange}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="xs" className="gap-1 px-2 text-xs">
              <Columns3 className="size-3.5" />
              Колонки
            </Button>
          }
        />
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            disabled={sheet.cols >= SHEET_LIMITS.cols}
            onClick={() =>
              api.update(insertColumns(api.workbook, api.sheetIndex, range.c1, colsInRange))
            }
          >
            Вставить {colsInRange} слева
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={sheet.cols >= SHEET_LIMITS.cols}
            onClick={() =>
              api.update(insertColumns(api.workbook, api.sheetIndex, range.c2 + 1, colsInRange))
            }
          >
            Вставить {colsInRange} справа
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() =>
              api.update(deleteColumns(api.workbook, api.sheetIndex, range.c1, colsInRange))
            }
          >
            <Trash2 className="size-4" />
            Удалить {colsInRange}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Divider />

      <ToolButton title="Сортировать по возрастанию" onClick={() => api.sortBy(active.col, "asc")}>
        <ArrowUpAZ className="size-4" />
      </ToolButton>
      <ToolButton title="Сортировать по убыванию" onClick={() => api.sortBy(active.col, "desc")}>
        <ArrowDownAZ className="size-4" />
      </ToolButton>
      <FilterButton api={api} />
    </div>
  );
}

function ColorButton({
  icon,
  title,
  colors,
  current,
  onPick,
}: {
  icon: React.ReactNode;
  title: string;
  colors: Array<{ hex: string; label: string }>;
  current: string | undefined;
  onPick: (hex: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            title={title}
            aria-label={title}
            onMouseDown={(event) => event.preventDefault()}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <span className="relative flex flex-col items-center">
              {icon}
              <span
                className="mt-0.5 h-0.5 w-4 rounded-full"
                style={{ backgroundColor: current ?? "transparent" }}
              />
            </span>
          </button>
        }
      />
      <PopoverContent align="start" className="w-auto p-2">
        <div className="flex gap-1">
          {colors.map((color) => (
            <button
              key={color.hex}
              type="button"
              title={color.label}
              onClick={() => {
                onPick(color.hex);
                setOpen(false);
              }}
              className={cn(
                "size-6 rounded-md border border-border",
                current === color.hex && "ring-2 ring-primary ring-offset-1",
              )}
              style={{ backgroundColor: color.hex }}
            />
          ))}
          <button
            type="button"
            title="Без цвета"
            onClick={() => {
              onPick(null);
              setOpen(false);
            }}
            className="size-6 rounded-md border border-border text-xs text-muted-foreground"
          >
            ✕
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Фильтр по активной колонке: список значений и поиск по подстроке. Оба условия
 * независимы — так их и понимают: «показать только этих трёх» и «показать всё,
 * где встречается „ООО“».
 */
function FilterButton({ api }: { api: SheetApi }) {
  const [open, setOpen] = useState(false);
  const col = api.active.col;
  const existing = api.sheet.filters?.find((f) => f.col === col);
  const [contains, setContains] = useState(existing?.contains ?? "");
  const [picked, setPicked] = useState<Set<string> | null>(
    existing?.values?.length ? new Set(existing.values) : null,
  );
  const values = open ? api.filterValues(col) : [];

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          const current = api.sheet.filters?.find((f) => f.col === col);
          setContains(current?.contains ?? "");
          setPicked(current?.values?.length ? new Set(current.values) : null);
        }
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            title="Фильтр по колонке"
            aria-label="Фильтр по колонке"
            className={cn(
              "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              existing && "bg-primary/15 text-foreground",
            )}
          >
            <Filter className="size-4" />
          </button>
        }
      />
      <PopoverContent align="end" className="w-64 p-3">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">
          Колонка {columnName(col)}
        </p>
        <input
          value={contains}
          onChange={(event) => setContains(event.target.value)}
          placeholder="Содержит…"
          className="mb-2 h-8 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-primary"
        />
        <div className="mb-2 max-h-48 overflow-y-auto rounded-md border border-border">
          {values.slice(0, 300).map((value) => {
            const checked = !picked || picked.has(value);
            return (
              <label
                key={value}
                className="flex cursor-pointer items-center gap-2 px-2 py-1 text-sm hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = new Set(picked ?? values);
                    if (next.has(value)) next.delete(value);
                    else next.add(value);
                    setPicked(next.size === values.length ? null : next);
                  }}
                />
                <span className="truncate">{value || "(пусто)"}</span>
              </label>
            );
          })}
          {values.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">Нет значений</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            size="xs"
            className="flex-1"
            onClick={() => {
              api.setFilter(col, {
                values: picked ? [...picked] : null,
                contains: contains.trim(),
              });
              setOpen(false);
            }}
          >
            Применить
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              api.setFilter(col, null);
              setPicked(null);
              setContains("");
              setOpen(false);
            }}
          >
            Сбросить
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
