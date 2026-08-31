"use client";

// Полотно таблицы: заголовки, ячейки, выделение, ввод и изменение ширины.
//
// Рисуется только то, что видно. Лист на пять тысяч строк — это полмиллиона
// ячеек, и попытка отдать их браузеру разом кладёт вкладку ещё до первого
// кадра. Отсюда устройство: контейнер прокрутки содержит распорку нужного
// размера (её и меряют полосы прокрутки) и слой в координатах окна, куда
// попадают только видимые ячейки.
//
// Слой держится на `position: sticky` с нулевой высотой, поставленном ПЕРЕД
// распоркой. Это единственный способ получить «координаты окна» внутри
// прокручиваемого элемента, не отнимая у него колесо и жесты: слой остаётся
// потомком прокрутки, поэтому прокрутка над ячейками работает сама собой.
//
// Скрытые фильтром строки не рисуются с нулевой высотой, а выпадают из
// нумерации целиком: геометрия считается по «визуальным» индексам, а `rowAt`
// переводит их в настоящие. Иначе прокрутка отфильтрованной таблицы уезжала бы
// в пустоту там, где строки скрыты.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  buildMetrics,
  offsetOf,
  scrollToCell,
  sizeOf,
  visibleRange,
  type Metrics,
} from "@/lib/core/sheet/geometry";
import {
  cellRef,
  columnName,
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  getCell,
  parseRange,
  rangeContains,
  SHEET_LIMITS,
  type CellRange,
  type CellStyle,
} from "@/lib/core/sheet/model";
import { offsetFormula } from "@/lib/core/sheet/formula";
import { cn } from "@/lib/utils";
import type { SheetApi } from "./use-sheet";

/** Ширина колонки с номерами строк и высота строки с буквами колонок. */
const ROW_HEADER_W = 52;
const COL_HEADER_H = 26;
/** Зона захвата у правого края заголовка колонки. */
const RESIZE_GRAB = 5;

export function SheetGrid({ api, editable }: { api: SheetApi; editable: boolean }) {
  const { sheet, active, range, editing } = api;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState<{ col: number; startX: number; startW: number } | null>(
    null,
  );
  const [liveWidth, setLiveWidth] = useState<{ col: number; width: number } | null>(null);

  // --- Геометрия -----------------------------------------------------------

  // Скрытые фильтром строки выпадают из нумерации: дальше всё считается в
  // «визуальных» индексах, а `rowAt` переводит их в настоящие.
  const visibleRows = useMemo(() => {
    if (!api.hidden.size) return null;
    const out: number[] = [];
    for (let row = 0; row < sheet.rows; row++) if (!api.hidden.has(row)) out.push(row);
    return out;
  }, [api.hidden, sheet.rows]);

  const rowAt = useCallback(
    (visual: number) => (visibleRows ? (visibleRows[visual] ?? sheet.rows - 1) : visual),
    [visibleRows, sheet.rows],
  );
  const visualOf = useMemo(() => {
    if (!visibleRows) return null;
    const map = new Map<number, number>();
    visibleRows.forEach((row, visual) => map.set(row, visual));
    return map;
  }, [visibleRows]);

  const rowCount = visibleRows ? visibleRows.length : sheet.rows;
  const rowSizes = useMemo(() => {
    if (!visibleRows || !sheet.heights) return sheet.heights;
    const out: Record<string, number> = {};
    visibleRows.forEach((row, visual) => {
      const height = sheet.heights?.[String(row)];
      if (height) out[String(visual)] = height;
    });
    return out;
  }, [visibleRows, sheet.heights]);

  const widths = useMemo(() => {
    if (!liveWidth) return sheet.widths;
    return { ...(sheet.widths ?? {}), [String(liveWidth.col)]: liveWidth.width };
  }, [sheet.widths, liveWidth]);

  const rows: Metrics = useMemo(
    () => buildMetrics(rowCount, rowSizes, DEFAULT_ROW_HEIGHT),
    [rowCount, rowSizes],
  );
  const cols: Metrics = useMemo(
    () => buildMetrics(sheet.cols, widths, DEFAULT_COL_WIDTH),
    [sheet.cols, widths],
  );

  const frozenRows = Math.min(sheet.frozen?.rows ?? 0, rowCount);
  const frozenCols = Math.min(sheet.frozen?.cols ?? 0, sheet.cols);
  const frozenHeight = offsetOf(rows, frozenRows);
  const frozenWidth = offsetOf(cols, frozenCols);

  const bodyWidth = Math.max(0, viewport.width - ROW_HEADER_W);
  const bodyHeight = Math.max(0, viewport.height - COL_HEADER_H);

  const rowWindow = visibleRange(
    rows,
    scroll.top + frozenHeight,
    scroll.top + bodyHeight,
  );
  const colWindow = visibleRange(cols, scroll.left + frozenWidth, scroll.left + bodyWidth);

  /** Экранная координата линии: закреплённая стоит, остальные едут с прокруткой. */
  const rowTop = useCallback(
    (visual: number) =>
      visual < frozenRows
        ? COL_HEADER_H + offsetOf(rows, visual)
        : COL_HEADER_H + offsetOf(rows, visual) - scroll.top,
    [rows, frozenRows, scroll.top],
  );
  const colLeft = useCallback(
    (col: number) =>
      col < frozenCols
        ? ROW_HEADER_W + offsetOf(cols, col)
        : ROW_HEADER_W + offsetOf(cols, col) - scroll.left,
    [cols, frozenCols, scroll.left],
  );

  // --- Размер окна ---------------------------------------------------------

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => setViewport({ width: host.clientWidth, height: host.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // Активная ячейка обязана оставаться на экране при движении стрелками.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !viewport.height) return;
    const visual = visualOf ? (visualOf.get(active.row) ?? -1) : active.row;
    if (visual < 0) return;
    const next = scrollToCell(
      { rows, cols, frozenHeight, frozenWidth },
      { row: visual, col: active.col },
      { scrollTop: scroll.top, scrollLeft: scroll.left, width: bodyWidth, height: bodyHeight },
      { rows: frozenRows, cols: frozenCols },
    );
    if (next) host.scrollTo({ top: next.top, left: next.left });
    // Зависимости намеренно только от активной ячейки: прокрутка колесом не
    // должна возвращать экран к ней.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.row, active.col]);

  // --- Объединения ---------------------------------------------------------

  /** Ячейка → область, которая её накрывает. Строится один раз на лист. */
  const merges = useMemo(() => {
    const map = new Map<string, CellRange>();
    for (const item of sheet.merges ?? []) {
      const area = parseRange(item);
      if (!area) continue;
      for (let row = area.r1; row <= area.r2; row++) {
        for (let col = area.c1; col <= area.c2; col++) map.set(`${row}:${col}`, area);
      }
    }
    return map;
  }, [sheet.merges]);

  // --- Ввод с клавиатуры ---------------------------------------------------

  const fillDown = useCallback(() => {
    if (!editable || range.r1 === range.r2) return;
    api.mutate((next) => {
      const target = next.sheets[api.sheetIndex];
      if (!target) return;
      for (let col = range.c1; col <= range.c2; col++) {
        const source = getCell(target, range.r1, col);
        for (let row = range.r1 + 1; row <= range.r2; row++) {
          if (!source) {
            delete target.cells[cellRef(row, col)];
            continue;
          }
          const copy = { ...source };
          if (copy.f) copy.f = offsetFormula(copy.f, row - range.r1, 0);
          target.cells[cellRef(row, col)] = copy;
        }
      }
    });
  }, [api, editable, range]);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent) => {
      if (editing) return;
      const meta = event.ctrlKey || event.metaKey;
      const shift = event.shiftKey;

      if (meta) {
        const key = event.key.toLowerCase();
        if (key === "z" && !shift) {
          event.preventDefault();
          api.undo();
          return;
        }
        if (key === "y" || (key === "z" && shift)) {
          event.preventDefault();
          api.redo();
          return;
        }
        if (key === "b" || key === "i" || key === "u") {
          if (!editable) return;
          event.preventDefault();
          const field = key === "b" ? "b" : key === "i" ? "i" : "u";
          const current = api.styleAt(active.row, active.col);
          api.setStyle({ [field]: current[field] ? null : 1 });
          return;
        }
        if (key === "d") {
          event.preventDefault();
          fillDown();
          return;
        }
        if (event.key === "Home") {
          event.preventDefault();
          api.select({ row: 0, col: 0 });
          return;
        }
        if (key === "a") {
          event.preventDefault();
          api.selectRange({ r1: 0, c1: 0, r2: sheet.rows - 1, c2: sheet.cols - 1 });
          return;
        }
        return;
      }

      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          api.move(-1, 0, shift);
          return;
        case "ArrowDown":
          event.preventDefault();
          api.move(1, 0, shift);
          return;
        case "ArrowLeft":
          event.preventDefault();
          api.move(0, -1, shift);
          return;
        case "ArrowRight":
          event.preventDefault();
          api.move(0, 1, shift);
          return;
        case "PageDown":
          event.preventDefault();
          api.move(Math.max(1, Math.floor(bodyHeight / DEFAULT_ROW_HEIGHT) - 1), 0, shift);
          return;
        case "PageUp":
          event.preventDefault();
          api.move(-Math.max(1, Math.floor(bodyHeight / DEFAULT_ROW_HEIGHT) - 1), 0, shift);
          return;
        case "Home":
          event.preventDefault();
          api.select({ row: active.row, col: 0 }, shift);
          return;
        case "Tab":
          event.preventDefault();
          api.move(0, shift ? -1 : 1, false);
          return;
        case "Enter":
          event.preventDefault();
          if (editable) api.beginEdit();
          return;
        case "F2":
          event.preventDefault();
          if (editable) api.beginEdit();
          return;
        case "Delete":
        case "Backspace":
          event.preventDefault();
          if (editable) api.clear();
          return;
        case "Escape":
          api.select(active);
          return;
        default:
          break;
      }

      // Печатный символ начинает ввод — как в любой таблице. Служебные
      // сочетания сюда не доходят: их разобрал `meta` выше.
      if (editable && event.key.length === 1 && !event.altKey) {
        event.preventDefault();
        api.beginEdit(event.key);
      }
    },
    [api, active, editable, editing, bodyHeight, fillDown, sheet.rows, sheet.cols],
  );

  // --- Мышь ----------------------------------------------------------------

  const pointFromEvent = useCallback(
    (event: { clientX: number; clientY: number }): { row: number; col: number } | null => {
      const host = hostRef.current;
      if (!host) return null;
      const box = host.getBoundingClientRect();
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      if (x < ROW_HEADER_W || y < COL_HEADER_H) return null;

      const bodyX = x - ROW_HEADER_W;
      const bodyY = y - COL_HEADER_H;
      const col =
        bodyX < frozenWidth
          ? lineAt(cols, bodyX, sheet.cols)
          : lineAt(cols, bodyX + scroll.left, sheet.cols);
      const visual =
        bodyY < frozenHeight
          ? lineAt(rows, bodyY, rowCount)
          : lineAt(rows, bodyY + scroll.top, rowCount);
      return { row: rowAt(visual), col };
    },
    [cols, rows, frozenWidth, frozenHeight, scroll, sheet.cols, rowCount, rowAt],
  );

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      const point = pointFromEvent(event);
      if (point) api.select(point, true);
    };
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, api, pointFromEvent]);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (event: PointerEvent) => {
      const width = Math.max(24, Math.min(640, resizing.startW + event.clientX - resizing.startX));
      setLiveWidth({ col: resizing.col, width: Math.round(width) });
    };
    const onUp = () => {
      const width = liveWidth?.width;
      const col = resizing.col;
      setResizing(null);
      setLiveWidth(null);
      if (width !== undefined && editable) {
        api.mutate((next) => {
          const target = next.sheets[api.sheetIndex];
          if (!target) return;
          target.widths = { ...(target.widths ?? {}), [String(col)]: width };
        });
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [resizing, liveWidth, api, editable]);

  // --- Буфер обмена --------------------------------------------------------

  const onCopy = useCallback(
    (event: ReactClipboardEvent) => {
      if (editing) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", api.copy());
    },
    [api, editing],
  );

  const onCut = useCallback(
    (event: ReactClipboardEvent) => {
      if (editing) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", api.copy());
      if (editable) api.clear();
    },
    [api, editable, editing],
  );

  const onPaste = useCallback(
    (event: ReactClipboardEvent) => {
      if (editing || !editable) return;
      const text = event.clipboardData.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      api.paste(text);
    },
    [api, editable, editing],
  );

  // --- Отрисовка -----------------------------------------------------------

  const cells: ReactNode[] = [];
  const drawn = new Set<string>();

  const pushCell = (visual: number, col: number) => {
    const row = rowAt(visual);
    const merge = merges.get(`${row}:${col}`);
    // Из объединения рисуем только левую верхнюю: остальные закрыты ею.
    if (merge && (merge.r1 !== row || merge.c1 !== col)) return;
    const key = `${row}:${col}`;
    if (drawn.has(key)) return;
    drawn.add(key);

    const left = colLeft(col);
    const top = rowTop(visual);
    let width = sizeOf(cols, col);
    let height = sizeOf(rows, visual);
    if (merge) {
      width = offsetOf(cols, merge.c2 + 1) - offsetOf(cols, merge.c1);
      const lastVisual = visualOf ? (visualOf.get(merge.r2) ?? visual) : merge.r2;
      height = offsetOf(rows, lastVisual + 1) - offsetOf(rows, visual);
    }

    const cell = getCell(sheet, row, col);
    const style = api.styleAt(row, col);
    const text = api.display(row, col);
    // Линия между двумя ячейками рисуется РОВНО ОДИН РАЗ — нижней стороной
    // верхней ячейки (правой стороной левой). Если у соседа снизу задана
    // верхняя граница, а у нас нижней нет, рисуем её мы: иначе «линия сверху»,
    // поставленная на середину листа, не появилась бы вовсе.
    const edges = {
      bottom: style.bb ?? api.styleAt((merge ? merge.r2 : row) + 1, col).bt,
      right: style.br ?? api.styleAt(row, (merge ? merge.c2 : col) + 1).bl,
      // Верх и лево — только у самого края листа: дальше ту же линию уже
      // нарисовал сосед, и вторая поверх неё выглядела бы двойной.
      top: row === 0 ? style.bt : undefined,
      left: col === 0 ? style.bl : undefined,
    };
    const selected = rangeContains(range, row, col);
    const isActive = active.row === row && active.col === col;
    // Закреплённая ячейка рисуется поверх уезжающих и обязана быть непрозрачной:
    // иначе под ней просвечивает прокрученное содержимое.
    const pinned = visual < frozenRows || col < frozenCols;

    cells.push(
      <div
        key={key}
        style={{
          left,
          top,
          width,
          height,
          ...cellStyle(style, cell?.v ?? null, edges),
        }}
        className={cn(
          "pointer-events-none absolute flex items-center overflow-hidden border-b border-r border-border/70 px-1.5 text-[13px] leading-none",
          pinned && "z-[1] bg-background",
          selected && !isActive && "bg-primary/10",
          isActive && "z-[2] outline outline-2 -outline-offset-2 outline-primary",
        )}
      >
        <span className={cn("min-w-0", style.wrap ? "whitespace-pre-wrap break-words" : "truncate")}>
          {text}
        </span>
      </div>,
    );
  };

  // Закреплённые строки и колонки рисуются всегда, поэтому обходим два окна:
  // видимое и закреплённое, а `drawn` разводит их пересечение.
  const rowLines = [
    ...range0(0, frozenRows - 1),
    ...range0(Math.max(rowWindow.start, frozenRows), rowWindow.end),
  ];
  const colLines = [
    ...range0(0, frozenCols - 1),
    ...range0(Math.max(colWindow.start, frozenCols), colWindow.end),
  ];
  for (const visual of rowLines) {
    for (const col of colLines) pushCell(visual, col);
  }

  const editingBox = editing
    ? (() => {
        const visual = visualOf ? (visualOf.get(editing.row) ?? -1) : editing.row;
        if (visual < 0) return null;
        return {
          left: colLeft(editing.col),
          top: rowTop(visual),
          width: sizeOf(cols, editing.col),
          height: sizeOf(rows, visual),
        };
      })()
    : null;

  return (
    <div
      ref={hostRef}
      tabIndex={0}
      role="grid"
      aria-label="Таблица"
      onScroll={(event) =>
        setScroll({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })
      }
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onCut={onCut}
      onPaste={onPaste}
      className="relative min-h-0 flex-1 overflow-auto bg-background outline-none"
    >
      {/* Слой в координатах окна. Нулевая высота и `sticky` перед распоркой —
          то, что удерживает его на месте, не отнимая у контейнера прокрутку. */}
      <div className="sticky left-0 top-0 z-10 h-0 w-0">
        <div
          style={{ width: viewport.width, height: viewport.height }}
          className="absolute left-0 top-0 overflow-hidden"
        >
          {/* Ловец мыши лежит под всем и ловит всё: сами ячейки событий не
              принимают (`pointer-events-none`), поэтому попадание считается
              арифметикой, а не деревом DOM — иначе закреплённая область и
              выделение перехватывали бы клики друг у друга. */}
          <div
            className="absolute inset-0"
            onPointerDown={(event) => {
              const point = pointFromEvent(event);
              if (!point) return;
              hostRef.current?.focus();
              api.select(point, event.shiftKey);
              setDragging(true);
            }}
            onDoubleClick={(event) => {
              const point = pointFromEvent(event);
              if (!point || !editable) return;
              api.select(point);
              api.beginEdit();
            }}
          />

          {cells}

          {/* Заголовки колонок */}
          {colLines.map((col) => {
            const left = colLeft(col);
            const width = sizeOf(cols, col);
            const selected = col >= range.c1 && col <= range.c2;
            return (
              <div
                key={`c${col}`}
                style={{ left, top: 0, width, height: COL_HEADER_H }}
                onPointerDown={(event) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  if (editable && box.right - event.clientX <= RESIZE_GRAB) {
                    setResizing({ col, startX: event.clientX, startW: width });
                    return;
                  }
                  api.selectRange({ r1: 0, c1: col, r2: sheet.rows - 1, c2: col });
                  hostRef.current?.focus();
                }}
                className={cn(
                  "absolute z-[4] flex select-none items-center justify-center border-b border-r border-border bg-muted text-[11px] font-semibold text-muted-foreground",
                  selected && "bg-primary/20 text-foreground",
                  editable && "cursor-col-resize",
                )}
                title={editable ? "Потяните за правый край, чтобы изменить ширину" : undefined}
              >
                {columnName(col)}
                {sheet.filters?.some((f) => f.col === col) && (
                  <span className="ml-1 text-primary" aria-label="Фильтр включён">
                    ▼
                  </span>
                )}
                {sheet.sort?.col === col && (
                  <span className="ml-0.5">{sheet.sort.dir === "asc" ? "↑" : "↓"}</span>
                )}
              </div>
            );
          })}

          {/* Номера строк */}
          {rowLines.map((visual) => {
            const row = rowAt(visual);
            const top = rowTop(visual);
            const height = sizeOf(rows, visual);
            const selected = row >= range.r1 && row <= range.r2;
            return (
              <div
                key={`r${row}`}
                style={{ left: 0, top, width: ROW_HEADER_W, height }}
                onPointerDown={() => {
                  api.selectRange({ r1: row, c1: 0, r2: row, c2: sheet.cols - 1 });
                  hostRef.current?.focus();
                }}
                className={cn(
                  "absolute z-[4] flex select-none items-center justify-center border-b border-r border-border bg-muted text-[11px] text-muted-foreground",
                  selected && "bg-primary/20 text-foreground",
                )}
              >
                {row + 1}
              </div>
            );
          })}

          {/* Угол: выделяет весь лист */}
          <div
            style={{ left: 0, top: 0, width: ROW_HEADER_W, height: COL_HEADER_H }}
            onPointerDown={() => {
              api.selectRange({ r1: 0, c1: 0, r2: sheet.rows - 1, c2: sheet.cols - 1 });
              hostRef.current?.focus();
            }}
            className="absolute z-[5] cursor-pointer border-b border-r border-border bg-muted"
            aria-label="Выделить всё"
          />

          {/* Поле ввода поверх активной ячейки */}
          {editing && editingBox && (
            <input
              autoFocus
              value={editing.text}
              onChange={(event) => api.changeEdit(event.target.value)}
              onBlur={() => api.commitEdit()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  api.commitEdit({ row: event.shiftKey ? -1 : 1, col: 0 });
                  hostRef.current?.focus();
                } else if (event.key === "Tab") {
                  event.preventDefault();
                  api.commitEdit({ row: 0, col: event.shiftKey ? -1 : 1 });
                  hostRef.current?.focus();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  api.cancelEdit();
                  hostRef.current?.focus();
                }
              }}
              style={{ ...editingBox }}
              className="absolute z-[6] border-2 border-primary bg-background px-1.5 text-[13px] outline-none"
            />
          )}
        </div>
      </div>

      <div
        aria-hidden
        style={{
          width: ROW_HEADER_W + cols.total + 40,
          height: COL_HEADER_H + rows.total + 40,
        }}
      />
    </div>
  );
}

/** Цвета линий, уже разведённые между соседями: пусто — линии нет. */
interface CellEdges {
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
}

/** Индекс линии по координате внутри тела таблицы. */
function lineAt(metrics: Metrics, position: number, count: number): number {
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (offsetOf(metrics, mid) <= position) low = mid;
    else high = mid - 1;
  }
  return Math.max(0, Math.min(count - 1, low));
}

function range0(from: number, to: number): number[] {
  if (to < from) return [];
  const out: number[] = [];
  for (let i = from; i <= Math.min(to, SHEET_LIMITS.rows); i++) out.push(i);
  return out;
}

/**
 * Оформление ячейки в виде инлайновых стилей.
 *
 * Выключка по умолчанию зависит от значения: числа вправо, текст влево,
 * логическое по центру. Это не украшательство — по краю столбца чисел человек
 * читает порядок величин, и выровненный влево столбец выглядит как текст.
 */
function cellStyle(style: CellStyle, value: unknown, edges: CellEdges): CSSProperties {
  const align =
    style.ha ??
    (typeof value === "number" ? "right" : typeof value === "boolean" ? "center" : "left");
  // Верх и лево — тенью внутрь, а не рамкой: рамка съела бы пиксель ширины и
  // сдвинула содержимое соседних ячеек друг относительно друга.
  const shadow = [
    edges.top && `inset 0 1px 0 0 ${edges.top}`,
    edges.left && `inset 1px 0 0 0 ${edges.left}`,
  ]
    .filter(Boolean)
    .join(", ");
  return {
    borderBottomColor: edges.bottom,
    borderRightColor: edges.right,
    boxShadow: shadow || undefined,
    fontWeight: style.b ? 600 : undefined,
    fontStyle: style.i ? "italic" : undefined,
    textDecoration:
      style.u && style.st
        ? "underline line-through"
        : style.u
          ? "underline"
          : style.st
            ? "line-through"
            : undefined,
    color: style.c,
    backgroundColor: style.bg,
    justifyContent: align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start",
    alignItems: style.va === "top" ? "flex-start" : style.va === "bottom" ? "flex-end" : "center",
    textAlign: align,
  };
}
