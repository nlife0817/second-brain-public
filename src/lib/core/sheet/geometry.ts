// Геометрия сетки: где начинается строка, какая колонка под курсором, что
// сейчас видно.
//
// Отдельно от компонента и без React намеренно. Виртуализация — единственное,
// что делает таблицу на тысячи строк живой, и ошибка в её арифметике выглядит
// как «строки съехали на одну» — то есть как невоспроизводимая жалоба. Здесь
// она проверяется тестами.

import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT, type SheetTab } from "./model";

/** Накопленные смещения: `offsets[i]` — начало i-й линии, длина массива n + 1. */
export interface Metrics {
  offsets: number[];
  total: number;
  count: number;
  /** Размер по умолчанию — им меряются линии за пределами `count`. */
  size: number;
}

export function buildMetrics(
  count: number,
  sizes: Record<string, number> | undefined,
  size: number,
): Metrics {
  const offsets = new Array<number>(count + 1);
  let at = 0;
  for (let i = 0; i < count; i++) {
    offsets[i] = at;
    at += sizes?.[String(i)] ?? size;
  }
  offsets[count] = at;
  return { offsets, total: at, count, size };
}

export function sizeOf(metrics: Metrics, index: number): number {
  if (index < 0 || index >= metrics.count) return metrics.size;
  return metrics.offsets[index + 1] - metrics.offsets[index];
}

export function offsetOf(metrics: Metrics, index: number): number {
  if (index <= 0) return 0;
  if (index >= metrics.count) return metrics.total + (index - metrics.count) * metrics.size;
  return metrics.offsets[index];
}

/**
 * Линия под координатой. Двоичный поиск, а не деление: линии разной высоты —
 * обычное дело (шапка выше, строка с переносом ещё выше).
 */
export function indexAt(metrics: Metrics, position: number): number {
  if (position <= 0) return 0;
  if (position >= metrics.total) {
    return Math.min(metrics.count - 1, metrics.count - 1 + Math.floor((position - metrics.total) / metrics.size));
  }
  let low = 0;
  let high = metrics.count - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (metrics.offsets[mid] <= position) low = mid;
    else high = mid - 1;
  }
  return low;
}

/**
 * Какие линии попадают в окно `[from, to)` плюс запас.
 *
 * Запас нужен не ради красоты: без него строка появляется ровно в тот кадр,
 * когда она уже видна, и прокрутка мерцает пустотой на медленных машинах.
 */
export function visibleRange(
  metrics: Metrics,
  from: number,
  to: number,
  overscan = 4,
): { start: number; end: number } {
  const start = Math.max(0, indexAt(metrics, from) - overscan);
  const end = Math.min(metrics.count - 1, indexAt(metrics, to) + overscan);
  return { start, end: Math.max(start, end) };
}

/** Метрики листа целиком — считаются один раз на отрисовку. */
export interface SheetMetrics {
  rows: Metrics;
  cols: Metrics;
  /** Высота и ширина закреплённой области в пикселях. */
  frozenHeight: number;
  frozenWidth: number;
}

export function sheetMetrics(sheet: SheetTab): SheetMetrics {
  const rows = buildMetrics(sheet.rows, sheet.heights, DEFAULT_ROW_HEIGHT);
  const cols = buildMetrics(sheet.cols, sheet.widths, DEFAULT_COL_WIDTH);
  return {
    rows,
    cols,
    frozenHeight: offsetOf(rows, sheet.frozen?.rows ?? 0),
    frozenWidth: offsetOf(cols, sheet.frozen?.cols ?? 0),
  };
}

/**
 * Прокрутка, при которой ячейка видна целиком.
 *
 * Возвращает `null`, когда двигать нечего: лишний `scrollTo` на каждое нажатие
 * стрелки сбивал бы плавную прокрутку колесом.
 */
export function scrollToCell(
  metrics: SheetMetrics,
  cell: { row: number; col: number },
  view: { scrollTop: number; scrollLeft: number; width: number; height: number },
  frozen: { rows: number; cols: number },
): { top: number; left: number } | null {
  let top = view.scrollTop;
  let left = view.scrollLeft;

  // Закреплённые строки и колонки видны всегда — до них прокручивать нечего.
  if (cell.row >= frozen.rows) {
    const start = offsetOf(metrics.rows, cell.row);
    const end = start + sizeOf(metrics.rows, cell.row);
    const windowTop = view.scrollTop + metrics.frozenHeight;
    if (start < windowTop) top = start - metrics.frozenHeight;
    else if (end > view.scrollTop + view.height) top = end - view.height;
  }

  if (cell.col >= frozen.cols) {
    const start = offsetOf(metrics.cols, cell.col);
    const end = start + sizeOf(metrics.cols, cell.col);
    const windowLeft = view.scrollLeft + metrics.frozenWidth;
    if (start < windowLeft) left = start - metrics.frozenWidth;
    else if (end > view.scrollLeft + view.width) left = end - view.width;
  }

  top = Math.max(0, top);
  left = Math.max(0, left);
  if (top === view.scrollTop && left === view.scrollLeft) return null;
  return { top, left };
}
