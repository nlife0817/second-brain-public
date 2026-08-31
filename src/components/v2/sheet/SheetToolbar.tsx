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
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  ArrowDownAZ,
  ArrowUpAZ,
  Bold,
  Filter,
  Grid2x2,
  Grid2x2X,
  Italic,
  Merge,
  PaintBucket,
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  Pilcrow,
  Redo2,
  Rows3,
  Columns3,
  Snowflake,
  Square,
  SquareSplitHorizontal,
  Strikethrough,
  TableProperties,
  Trash2,
  Type,
  Underline as UnderlineIcon,
  Undo2,
  WrapText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Divider, ToolButton } from "@/components/v2/editor/Toolbar";
import {
  FORMAT_LABELS,
  FORMATS,
  formatValue,
  isDateFormat,
  withDecimals,
} from "@/lib/core/sheet/format";
import { dateToSerial } from "@/lib/core/sheet/functions";
import { columnName, getCell, SHEET_LIMITS } from "@/lib/core/sheet/model";
import {
  DEFAULT_BORDER_COLOR,
  deleteColumns,
  deleteRows,
  insertColumns,
  insertRows,
  mergeRange,
  unmergeRange,
  type BorderPreset,
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
  const [formatOpen, setFormatOpen] = useState(false);
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
      <BorderButton api={api} />

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

      <ToolButton
        title="По верхнему краю"
        active={style.va === "top"}
        onClick={() => api.setStyle({ va: style.va === "top" ? null : "top" })}
      >
        <AlignVerticalJustifyStart className="size-4" />
      </ToolButton>
      <ToolButton
        title="По середине"
        active={style.va === "middle"}
        onClick={() => api.setStyle({ va: style.va === "middle" ? null : "middle" })}
      >
        <AlignVerticalJustifyCenter className="size-4" />
      </ToolButton>
      <ToolButton
        title="По нижнему краю"
        active={style.va === "bottom"}
        onClick={() => api.setStyle({ va: style.va === "bottom" ? null : "bottom" })}
      >
        <AlignVerticalJustifyEnd className="size-4" />
      </ToolButton>

      <Divider />

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="xs" className="max-w-40 gap-1 px-2 text-xs">
              <Pilcrow className="size-3.5" />
              <span className="truncate">
                {FORMAT_LABELS.find((f) => f.code === (style.fmt ?? FORMATS.general))?.label ??
                  style.fmt ??
                  "Формат"}
              </span>
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
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setFormatOpen(true)}>Свой формат…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Разрядность считается из кода формата, а не выбирается из списка:
          иначе «# ##0.000» было бы нечем получить. */}
      <ToolButton
        title="Меньше знаков после запятой"
        onClick={() => api.setStyle({ fmt: withDecimals(style.fmt, -1) ?? null })}
      >
        <span className="text-[11px] font-semibold tracking-tight">,0</span>
      </ToolButton>
      <ToolButton
        title="Больше знаков после запятой"
        onClick={() => api.setStyle({ fmt: withDecimals(style.fmt, 1) ?? null })}
      >
        <span className="text-[11px] font-semibold tracking-tight">,00</span>
      </ToolButton>

      <CustomFormatDialog api={api} open={formatOpen} onOpenChange={setFormatOpen} />

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

/**
 * Границы выделения. Восемь пресетов — те же, что в Excel: их и ищут глазами,
 * а составлять рамку по одной стороне никто не будет.
 */
const BORDER_PRESETS: Array<{ preset: BorderPreset; label: string; icon: React.ReactNode }> = [
  { preset: "all", label: "Все границы", icon: <Grid2x2 className="size-4" /> },
  { preset: "outer", label: "Внешние", icon: <Square className="size-4" /> },
  { preset: "inner", label: "Внутренние", icon: <SquareSplitHorizontal className="size-4" /> },
  { preset: "none", label: "Без границ", icon: <Grid2x2X className="size-4" /> },
  { preset: "top", label: "Сверху", icon: <PanelTop className="size-4" /> },
  { preset: "bottom", label: "Снизу", icon: <PanelBottom className="size-4" /> },
  { preset: "left", label: "Слева", icon: <PanelLeft className="size-4" /> },
  { preset: "right", label: "Справа", icon: <PanelRight className="size-4" /> },
];

function BorderButton({ api }: { api: SheetApi }) {
  const [open, setOpen] = useState(false);
  // Цвет живёт до конца сеанса: рамку почти всегда рисуют одним цветом, и
  // выбирать его заново на каждую сторону — работа впустую.
  const [color, setColor] = useState<string>(DEFAULT_BORDER_COLOR);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            title="Границы"
            aria-label="Границы"
            onMouseDown={(event) => event.preventDefault()}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <TableProperties className="size-4" />
          </button>
        }
      />
      <PopoverContent align="start" className="w-auto p-2">
        <div className="grid grid-cols-4 gap-1">
          {BORDER_PRESETS.map((item) => (
            <button
              key={item.preset}
              type="button"
              title={item.label}
              aria-label={item.label}
              onClick={() => {
                api.setBorders(item.preset, color);
                setOpen(false);
              }}
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {item.icon}
            </button>
          ))}
        </div>
        <div className="mt-2 flex gap-1 border-t border-border pt-2">
          {PALETTE.map((item) => (
            <button
              key={item.hex}
              type="button"
              title={`Цвет линии: ${item.label.toLowerCase()}`}
              onClick={() => setColor(item.hex)}
              className={cn(
                "size-5 rounded border border-border",
                color === item.hex && "ring-2 ring-primary ring-offset-1",
              )}
              style={{ backgroundColor: item.hex }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Свой код формата. Пример считается по значению активной ячейки — так видно,
 * что получится именно с этими данными, а не с выдуманным «1234,5678».
 */
function CustomFormatDialog({
  api,
  open,
  onOpenChange,
}: {
  api: SheetApi;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const current = api.styleAt(api.active.row, api.active.col).fmt ?? "";
  const [code, setCode] = useState(current);
  const [seen, setSeen] = useState(open);
  // Диалог открывается поверх уже выделенной ячейки: код берём её, а не тот,
  // что остался от прошлого раза.
  if (open !== seen) {
    setSeen(open);
    if (open) setCode(current);
  }

  const raw = getCell(api.sheet, api.active.row, api.active.col)?.v;
  const sample =
    typeof raw === "number"
      ? raw
      : isDateFormat(code)
        ? dateToSerial(new Date())
        : 1234.5678;

  const apply = () => {
    api.setStyle({ fmt: code.trim() || null });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Свой формат</DialogTitle>
        </DialogHeader>

        <Input
          autoFocus
          value={code}
          placeholder="# ##0.00 ₽"
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") apply();
          }}
        />

        <p className="text-sm">
          <span className="text-muted-foreground">Пример: </span>
          <span className="font-medium">{formatValue(sample, code) || "—"}</span>
        </p>

        <div className="space-y-1 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          <p>
            <code className="font-mono">0</code> и <code className="font-mono">#</code> — места
            цифр, точка отделяет дробную часть, пробел в целой части включает разделитель
            разрядов: <code className="font-mono"># ##0.00</code>
          </p>
          <p>
            <code className="font-mono">%</code> умножает на сто, всё остальное вокруг числа
            показывается как есть: <code className="font-mono">0.0 шт.</code>
          </p>
          <p>
            Дата — <code className="font-mono">ДД</code>, <code className="font-mono">ММ</code>,{" "}
            <code className="font-mono">МММ</code>, <code className="font-mono">ГГГГ</code>,{" "}
            <code className="font-mono">чч</code>, <code className="font-mono">мм</code>,{" "}
            <code className="font-mono">сс</code>. Заглавные «ММ» — месяц, строчные — минуты.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={apply}>Применить</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
