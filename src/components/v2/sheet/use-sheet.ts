"use client";

// Состояние таблицы: книга, выделение, ввод, отмена и автосохранение.
//
// Всё, что меняет книгу, проходит через `update`. Это не стилистика: на нём
// держатся сразу три вещи, которые порознь разъезжаются, — стопка отмены,
// пересчёт формул и отметка «есть несохранённое». Правка книги в обход `update`
// выглядит как «Ctrl+Z пропускает шаг» и «сумма не обновилась», причём в разное
// время.
//
// Автосохранение устроено как у описания задачи (`useDocEditor`): пауза после
// последней правки, отдельная кнопка «Сохранить» на случай отказа, и статус,
// который видно в шапке. Пауза здесь длиннее — книга уезжает целиком, и на
// заполнении строки это был бы запрос на каждую ячейку.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { recalculate } from "@/lib/core/sheet/engine";
import { editText, FORMATS, formatValue, parseInput } from "@/lib/core/sheet/format";
import {
  cellRef,
  countCells,
  emptySheet,
  getCell,
  isBlankCell,
  normalizeRange,
  parseWorkbook,
  serializeWorkbook,
  setCell,
  SHEET_LIMITS,
  usedBounds,
  type CellRange,
  type CellStyle,
  type CellValue,
  type SheetCell,
  type SheetTab,
  type Workbook,
} from "@/lib/core/sheet/model";
import {
  applyBorders,
  applyStyle,
  cloneWorkbook,
  columnValues,
  ensureSize,
  hiddenRows,
  sortRange,
  styleIndex,
  styleOf,
  type BorderPreset,
} from "@/lib/core/sheet/ops";
import { parseClipboard, toClipboard } from "@/lib/core/sheet/csv";
import { fillRange } from "@/lib/core/sheet/fill";
import { offsetFormula } from "@/lib/core/sheet/formula";
import { compareValues } from "@/lib/core/sheet/functions";
import type { DocSaveStatus } from "@/components/v2/editor/useDocEditor";

/** Пауза перед сохранением: книга уезжает целиком, и частить нечем. */
const AUTOSAVE_DELAY_MS = 1500;

/** Глубина отмены. Каждый шаг — копия книги, дальше это уже память впустую. */
const HISTORY_LIMIT = 50;

export interface CellPoint {
  row: number;
  col: number;
}

export interface SheetEditing extends CellPoint {
  text: string;
}

/**
 * Что кладётся в буфер при копировании внутри таблицы.
 *
 * Наружу уходит текст (его и ждут письмо и чужая таблица), а формулы, значения
 * и оформление остаются здесь. Своя копия узнаётся по совпадению текста: если
 * человек скопировал что-то ещё, системный буфер уже не наш, и вставлять надо
 * то, что в нём лежит.
 *
 * Стиль хранится объектом, а не индексом: таблица стилей книги между
 * копированием и вставкой могла быть переиндексирована уборкой неиспользуемых.
 */
interface CopiedCell {
  row: number;
  col: number;
  v?: CellValue;
  f?: string;
  style?: CellStyle;
}

interface SheetClipboard {
  text: string;
  source: CellRange;
  cells: CopiedCell[];
}

/** Что именно вставляем. «Всё» — обычная вставка. */
export type PasteMode = "all" | "values" | "formats" | "transpose";

export interface UseSheetOptions {
  /** Тело документа: JSON книги. */
  value: string;
  /** Вернуть `false`, если сохранить не удалось — статус станет `error`. */
  onSave: (body: string) => boolean | Promise<boolean>;
  editable: boolean;
}

export interface SheetApi {
  workbook: Workbook;
  sheet: SheetTab;
  sheetIndex: number;
  selectSheet: (index: number) => void;

  /** Активная ячейка — та, куда идёт ввод; область — то, что подсвечено. */
  active: CellPoint;
  range: CellRange;
  select: (point: CellPoint, extend?: boolean) => void;
  selectRange: (range: CellRange) => void;
  move: (dRow: number, dCol: number, extend: boolean) => void;

  editing: SheetEditing | null;
  beginEdit: (initial?: string) => void;
  changeEdit: (text: string) => void;
  commitEdit: (move?: { row: number; col: number }) => void;
  cancelEdit: () => void;

  update: (next: Workbook) => void;
  mutate: (fn: (workbook: Workbook) => void) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  clear: () => void;
  setStyle: (patch: Partial<Record<keyof CellStyle, unknown>>) => void;
  setBorders: (preset: BorderPreset, color?: string) => void;
  styleAt: (row: number, col: number) => CellStyle;
  display: (row: number, col: number) => string;
  /** Текст для строки формул и для входа в ячейку — исходный ввод, а не показ. */
  sourceAt: (row: number, col: number) => string;

  copy: () => string;
  paste: (text: string) => void;
  /**
   * Вставка с оговоркой. `text` — то, что лежит в системном буфере, если оно
   * доступно вызывающему; без него берётся собственная копия.
   */
  pasteSpecial: (mode: PasteMode, text?: string) => void;
  /** Есть ли своя копия: без неё «вставить только формат» вставлять нечего. */
  hasCopy: boolean;
  /** Протянуть образец до области: `target` включает в себя `source`. */
  fill: (source: CellRange, target: CellRange) => void;

  addSheet: () => void;
  renameSheet: (name: string) => void;
  removeSheet: () => void;

  sortBy: (col: number, direction: "asc" | "desc") => void;
  setFilter: (col: number, filter: { values?: string[] | null; contains?: string } | null) => void;
  filterValues: (col: number) => string[];
  /** Строки, которых не видно: спрятанные руками и отсеянные фильтром вместе. */
  hidden: Set<number>;
  hiddenCols: Set<number>;
  hideLines: (axis: "row" | "col") => void;
  showLines: (axis: "row" | "col") => void;
  showAllLines: () => void;

  status: DocSaveStatus;
  /**
   * Сохранить немедленно. Возвращает промис: выгрузка в файл идёт с сервера, и
   * скачивать его до того, как правка доехала, значит скачать вчерашнее.
   */
  flush: () => Promise<void>;
  error: string | null;
  clearError: () => void;
}

/** Пересчитать и вернуть ту же книгу: значения формул живут в самих ячейках. */
function computed(workbook: Workbook): Workbook {
  recalculate(workbook);
  return workbook;
}

export function useSheet({ value, onSave, editable }: UseSheetOptions): SheetApi {
  const [workbook, setWorkbook] = useState(() => computed(parseWorkbook(value)));
  const [sheetIndex, setSheetIndex] = useState(0);
  const [active, setActive] = useState<CellPoint>({ row: 0, col: 0 });
  const [anchor, setAnchor] = useState<CellPoint>({ row: 0, col: 0 });
  const [editing, setEditing] = useState<SheetEditing | null>(null);
  const [past, setPast] = useState<Workbook[]>([]);
  const [future, setFuture] = useState<Workbook[]>([]);
  const [status, setStatus] = useState<DocSaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);

  const workbookRef = useRef(workbook);
  workbookRef.current = workbook;
  /** Последнее, что подтвердил сервер. Двигается только по успеху. */
  const savedRef = useRef(serializeWorkbook(workbook));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // Документ приезжает с сервера при переходах, при router.refresh() и ответом
  // на собственное сохранение. Принимаем его, только если это ДРУГАЯ книга и
  // своей несохранённой правки нет.
  //
  // Сравнение идёт по каноническому виду (`serializeWorkbook` приводит к нему
  // обе стороны). Иначе ответ на своё же сохранение считался бы чужой правкой,
  // и книга подменялась бы вместе с обнулением стопки отмены — после каждого
  // автосохранения Ctrl+Z переставал бы отменять набранное.
  const [seed, setSeed] = useState(value);
  if (seed !== value) {
    setSeed(value);
    // Обычный случай — ответ на собственное сохранение: байты те же, что мы
    // отправили, и сравнение стоит одну строковую операцию. Разбор и повторную
    // сериализацию (десятки миллисекунд на большой книге) делаем только когда
    // байты разошлись — например, документ пришёл с router.refresh().
    if (value !== savedRef.current) {
      const incoming = serializeWorkbook(parseWorkbook(value));
      if (incoming === savedRef.current) {
        savedRef.current = incoming;
      } else if (!dirtyRef.current) {
        const next = computed(parseWorkbook(value));
        savedRef.current = serializeWorkbook(next);
        setWorkbook(next);
        setPast([]);
        setFuture([]);
      }
    }
  }

  const index = Math.min(sheetIndex, workbook.sheets.length - 1);
  const sheet = workbook.sheets[index] ?? workbook.sheets[0];

  const range = useMemo(
    () => normalizeRange({ r1: anchor.row, c1: anchor.col, r2: active.row, c2: active.col }),
    [anchor, active],
  );

  // --- Сохранение ----------------------------------------------------------

  // `flush` зовёт `schedule`, а `schedule` — `flush`. Кольцо разрывается ссылкой:
  // объявить их обоими useCallback друг через друга нельзя, а ref всегда указывает
  // на актуальную версию.
  const scheduleRef = useRef<() => void>(() => {});

  const flush = useCallback(async (): Promise<void> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const body = serializeWorkbook(workbookRef.current);
    if (body === savedRef.current) {
      dirtyRef.current = false;
      setStatus("saved");
      return;
    }
    // Два предела, и оба — про потерю данных, а не про аккуратность: и вес, и
    // число ячеек нормализация на сервере обрежет молча, вместе с содержимым.
    // Лучше честно отказаться сохранять и сказать об этом.
    if (body.length > SHEET_LIMITS.bytes) {
      setStatus("error");
      setError("Таблица стала слишком большой — часть данных не сохранить");
      return;
    }
    if (countCells(workbookRef.current) > SHEET_LIMITS.cells) {
      setStatus("error");
      setError(
        `В таблице больше ${SHEET_LIMITS.cells.toLocaleString("ru-RU")} заполненных ячеек — часть данных не сохранить`,
      );
      return;
    }
    setStatus("saving");
    const ok = await onSaveRef.current(body);
    if (!ok) {
      setStatus("error");
      return;
    }
    savedRef.current = body;
    // За время запроса могли набрать ещё — тогда правка снова «грязная».
    dirtyRef.current = serializeWorkbook(workbookRef.current) !== body;
    setStatus(dirtyRef.current ? "dirty" : "saved");
    if (dirtyRef.current) scheduleRef.current();
  }, []);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, AUTOSAVE_DELAY_MS);
  }, [flush]);
  scheduleRef.current = schedule;

  // Уход со страницы не должен уносить последнюю правку.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        if (dirtyRef.current) {
          const body = serializeWorkbook(workbookRef.current);
          if (body !== savedRef.current) void onSaveRef.current(body);
        }
      }
    };
  }, []);

  // --- Правка --------------------------------------------------------------

  /**
   * Общий хвост всех правок: положить книгу, отметить несохранённое, запустить
   * пересчёт и таймер автосохранения.
   *
   * Ни одного побочного действия внутри обновляющей функции состояния — только
   * снаружи. React вправе вызвать такую функцию дважды (в разработке он так и
   * делает), и отмена, спрятанная внутри `setPast`, откатывала бы сразу два
   * шага вместо одного.
   */
  const commit = useCallback(
    (next: Workbook) => {
      const ready = computed(next);
      workbookRef.current = ready;
      setWorkbook(ready);
      dirtyRef.current = true;
      setStatus("dirty");
      schedule();
    },
    [schedule],
  );

  const update = useCallback(
    (next: Workbook) => {
      if (!editable) return;
      const previous = workbookRef.current;
      setPast((prev) => [...prev.slice(-(HISTORY_LIMIT - 1)), previous]);
      setFuture([]);
      commit(next);
    },
    [editable, commit],
  );

  const mutate = useCallback(
    (fn: (workbook: Workbook) => void) => {
      const next = cloneWorkbook(workbookRef.current);
      fn(next);
      update(next);
    },
    [update],
  );

  const undo = useCallback(() => {
    const previous = past[past.length - 1];
    if (!previous) return;
    const current = workbookRef.current;
    setPast((prev) => prev.slice(0, -1));
    setFuture((prev) => [current, ...prev].slice(0, HISTORY_LIMIT));
    commit(previous);
  }, [past, commit]);

  const redo = useCallback(() => {
    const next = future[0];
    if (!next) return;
    const current = workbookRef.current;
    setFuture((prev) => prev.slice(1));
    setPast((prev) => [...prev.slice(-(HISTORY_LIMIT - 1)), current]);
    commit(next);
  }, [future, commit]);

  // --- Выделение -----------------------------------------------------------

  const select = useCallback((point: CellPoint, extend = false) => {
    setActive(point);
    if (!extend) setAnchor(point);
    setEditing(null);
  }, []);

  const selectRange = useCallback((next: CellRange) => {
    setAnchor({ row: next.r1, col: next.c1 });
    setActive({ row: next.r2, col: next.c2 });
    setEditing(null);
  }, []);

  const move = useCallback(
    (dRow: number, dCol: number, extend: boolean) => {
      const row = Math.max(0, Math.min(sheet.rows - 1, active.row + dRow));
      const col = Math.max(0, Math.min(sheet.cols - 1, active.col + dCol));
      setActive({ row, col });
      // Без Shift выделение схлопывается в новую ячейку: якорь обязан уехать
      // туда же, а не остаться там, где начиналось прошлое выделение.
      if (!extend) setAnchor({ row, col });
      setEditing(null);
    },
    [active, sheet.rows, sheet.cols],
  );

  // --- Ввод в ячейку -------------------------------------------------------

  const sourceAt = useCallback(
    (row: number, col: number) => {
      const cell = getCell(sheet, row, col);
      if (!cell) return "";
      return editText(cell.v ?? null, cell.f, styleOf(workbook, cell).fmt);
    },
    [sheet, workbook],
  );

  const beginEdit = useCallback(
    (initial?: string) => {
      if (!editable) return;
      setEditing({
        row: active.row,
        col: active.col,
        text: initial ?? sourceAt(active.row, active.col),
      });
    },
    [editable, active, sourceAt],
  );

  const changeEdit = useCallback((text: string) => {
    setEditing((current) => (current ? { ...current, text } : current));
  }, []);

  const cancelEdit = useCallback(() => setEditing(null), []);

  const commitEdit = useCallback(
    (moveBy?: { row: number; col: number }) => {
      const current = editing;
      setEditing(null);
      if (current) {
        const before = sourceAt(current.row, current.col);
        if (before !== current.text) {
          mutate((next) => {
            const target = next.sheets[index];
            if (!target) return;
            writeInput(next, target, current.row, current.col, current.text);
          });
        }
      }
      if (moveBy) move(moveBy.row, moveBy.col, false);
    },
    [editing, index, mutate, move, sourceAt],
  );

  // --- Операции над выделением ---------------------------------------------

  const clear = useCallback(() => {
    mutate((next) => {
      const target = next.sheets[index];
      if (!target) return;
      for (let row = range.r1; row <= range.r2; row++) {
        for (let col = range.c1; col <= range.c2; col++) {
          const cell = getCell(target, row, col);
          // Оформление переживает очистку содержимого — как в Excel: колонка
          // денег остаётся колонкой денег.
          setCell(target, row, col, cell?.s === undefined ? null : { s: cell.s });
        }
      }
    });
  }, [index, mutate, range]);

  const setStyle = useCallback(
    (patch: Partial<Record<keyof CellStyle, unknown>>) => {
      update(applyStyle(workbookRef.current, index, [range], patch));
    },
    [index, range, update],
  );

  const setBorders = useCallback(
    (preset: BorderPreset, color?: string) => {
      update(applyBorders(workbookRef.current, index, range, preset, color));
    },
    [index, range, update],
  );

  const styleAt = useCallback(
    (row: number, col: number) => styleOf(workbook, getCell(sheet, row, col)),
    [workbook, sheet],
  );

  const display = useCallback(
    (row: number, col: number) => {
      const cell = getCell(sheet, row, col);
      if (!cell) return "";
      return formatValue(cell.v ?? null, styleOf(workbook, cell).fmt);
    },
    [sheet, workbook],
  );

  const clipboardRef = useRef<SheetClipboard | null>(null);
  const [hasCopy, setHasCopy] = useState(false);

  const copy = useCallback(() => {
    const rows: string[][] = [];
    const cells: CopiedCell[] = [];
    for (let row = range.r1; row <= range.r2; row++) {
      const line: string[] = [];
      for (let col = range.c1; col <= range.c2; col++) {
        // В буфер уходит показанное: так вставка в письмо или в чужую таблицу
        // выглядит как на экране. Формулы и оформление остаются здесь.
        line.push(display(row, col));
        const cell = getCell(sheet, row, col);
        if (!cell) continue;
        const copied: CopiedCell = { row, col };
        if (cell.f) copied.f = cell.f;
        if (cell.v !== undefined) copied.v = cell.v;
        const style = styleOf(workbook, cell);
        if (Object.keys(style).length) copied.style = style;
        cells.push(copied);
      }
      rows.push(line);
    }
    const text = toClipboard(rows);
    clipboardRef.current = { text, source: range, cells };
    setHasCopy(true);
    return text;
  }, [range, display, sheet, workbook]);

  /** Вставка чужого текста: всё, что приехало, разбирается как ввод руками. */
  const pasteText = useCallback(
    (text: string, transpose: boolean) => {
      const parsed = parseClipboard(text);
      const rows = transpose ? transposeRows(parsed) : parsed;
      if (!rows.length) return;
      mutate((next) => {
        const target = next.sheets[index];
        if (!target) return;
        ensureSize(target, active.row + rows.length, active.col + rows[0].length);
        rows.forEach((line, dRow) => {
          line.forEach((raw, dCol) => {
            const row = active.row + dRow;
            const col = active.col + dCol;
            if (row >= target.rows || col >= target.cols) return;
            writeInput(next, target, row, col, raw);
          });
        });
      });
      selectRange({
        r1: active.row,
        c1: active.col,
        r2: Math.min(sheet.rows - 1, active.row + rows.length - 1),
        c2: Math.min(sheet.cols - 1, active.col + (rows[0]?.length ?? 1) - 1),
      });
    },
    [active, index, mutate, selectRange, sheet.rows, sheet.cols],
  );

  /**
   * Вставка собственной копии. Обходим ВСЮ область образца, а не только
   * заполненные ячейки: пустая клетка внутри копии — тоже её часть, и вставка
   * обязана стереть то, что лежало под ней.
   */
  const pasteCells = useCallback(
    (clip: SheetClipboard, mode: PasteMode) => {
      const transpose = mode === "transpose";
      const height = clip.source.r2 - clip.source.r1 + 1;
      const width = clip.source.c2 - clip.source.c1 + 1;
      const at = { row: active.row, col: active.col };
      const targetOf = (row: number, col: number) =>
        transpose
          ? { row: at.row + (col - clip.source.c1), col: at.col + (row - clip.source.r1) }
          : { row: at.row + (row - clip.source.r1), col: at.col + (col - clip.source.c1) };

      mutate((next) => {
        const target = next.sheets[index];
        if (!target) return;
        ensureSize(
          target,
          at.row + (transpose ? width : height),
          at.col + (transpose ? height : width),
        );
        const byRef = new Map(clip.cells.map((cell) => [cellRef(cell.row, cell.col), cell]));

        for (let row = clip.source.r1; row <= clip.source.r2; row++) {
          for (let col = clip.source.c1; col <= clip.source.c2; col++) {
            const to = targetOf(row, col);
            if (to.row >= target.rows || to.col >= target.cols) continue;
            const copied = byRef.get(cellRef(row, col));
            const existing = getCell(target, to.row, to.col);
            // «Только значения» не трогает оформление получателя — колонка
            // денег обязана остаться колонкой денег.
            const keepStyle =
              mode === "values" && existing?.s !== undefined ? existing.s : undefined;

            if (mode === "formats") {
              const updated: SheetCell = { ...(existing ?? {}) };
              const style = copied?.style ? styleIndex(next, copied.style) : undefined;
              if (style === undefined) delete updated.s;
              else updated.s = style;
              setCell(target, to.row, to.col, isBlankCell(updated) ? null : updated);
              continue;
            }

            if (!copied) {
              setCell(target, to.row, to.col, keepStyle === undefined ? null : { s: keepStyle });
              continue;
            }

            const cell: SheetCell = {};
            if (copied.f && mode !== "values") {
              cell.f = offsetFormula(copied.f, to.row - row, to.col - col);
              cell.v = copied.v ?? null;
            } else {
              cell.v = copied.v ?? null;
            }
            const style =
              mode === "values"
                ? keepStyle
                : copied.style
                  ? styleIndex(next, copied.style)
                  : undefined;
            if (style !== undefined) cell.s = style;
            setCell(target, to.row, to.col, cell);
          }
        }
      });

      selectRange({
        r1: at.row,
        c1: at.col,
        r2: Math.min(sheet.rows - 1, at.row + (transpose ? width : height) - 1),
        c2: Math.min(sheet.cols - 1, at.col + (transpose ? height : width) - 1),
      });
    },
    [active, index, mutate, selectRange, sheet.rows, sheet.cols],
  );

  const pasteSpecial = useCallback(
    (mode: PasteMode, text?: string) => {
      const clip = clipboardRef.current;
      // Своя копия узнаётся по тексту: если в системном буфере лежит уже не она,
      // вставлять надо то, что там лежит, а не скопированное когда-то давно.
      if (clip && (text === undefined || text === clip.text)) {
        pasteCells(clip, mode);
        return;
      }
      if (!text) {
        setError("Скопируйте ячейки таблицы — своей копии нет");
        return;
      }
      if (mode === "formats") {
        setError("В буфере только текст: оформления в нём нет");
        return;
      }
      pasteText(text, mode === "transpose");
    },
    [pasteCells, pasteText],
  );

  const paste = useCallback((text: string) => pasteSpecial("all", text), [pasteSpecial]);

  const fill = useCallback(
    (source: CellRange, target: CellRange) => {
      update(fillRange(workbookRef.current, index, source, target));
    },
    [index, update],
  );

  // --- Листы ---------------------------------------------------------------

  const addSheet = useCallback(() => {
    if (workbook.sheets.length >= SHEET_LIMITS.sheets) {
      setError(`Листов в книге не больше ${SHEET_LIMITS.sheets}`);
      return;
    }
    const names = new Set(workbook.sheets.map((s) => s.name.toLowerCase()));
    let n = workbook.sheets.length + 1;
    while (names.has(`лист ${n}`)) n++;
    mutate((next) => {
      next.sheets.push(emptySheet(`Лист ${n}`));
    });
    setSheetIndex(workbook.sheets.length);
  }, [workbook.sheets, mutate]);

  const renameSheet = useCallback(
    (name: string) => {
      mutate((next) => {
        const target = next.sheets[index];
        if (target) target.name = name;
      });
    },
    [index, mutate],
  );

  const removeSheet = useCallback(() => {
    if (workbook.sheets.length <= 1) {
      setError("Последний лист удалить нельзя");
      return;
    }
    mutate((next) => {
      next.sheets.splice(index, 1);
    });
    setSheetIndex(Math.max(0, index - 1));
  }, [workbook.sheets.length, index, mutate]);

  // --- Сортировка и фильтры ------------------------------------------------

  const sortBy = useCallback(
    (col: number, direction: "asc" | "desc") => {
      const bounds = usedBounds(sheet);
      if (!bounds) return;
      // Шапку не сортируем: если строка закреплена, она и есть заголовки.
      const headerRows = sheet.frozen?.rows ?? 0;
      const area: CellRange = { r1: headerRows, c1: 0, r2: bounds.row, c2: bounds.col };
      if (area.r2 <= area.r1) return;
      // Сравнение значений общее с формулами: «10» идёт после «9», а пустая
      // ячейка — всегда в конец, независимо от направления.
      update(
        sortRange(workbookRef.current, index, area, col, direction, (a, b) => {
          const left = a?.v ?? null;
          const right = b?.v ?? null;
          if (left === null && right === null) return 0;
          if (left === null) return 1;
          if (right === null) return -1;
          return compareValues(left, right);
        }),
      );
    },
    [sheet, index, update],
  );

  const setFilter = useCallback(
    (col: number, filter: { values?: string[] | null; contains?: string } | null) => {
      mutate((next) => {
        const target = next.sheets[index];
        if (!target) return;
        const rest = (target.filters ?? []).filter((f) => f.col !== col);
        target.filters = filter ? [...rest, { col, ...filter }] : rest;
        if (!target.filters.length) target.filters = undefined;
      });
    },
    [index, mutate],
  );

  const filterValues = useCallback(
    (col: number) =>
      columnValues(sheet, col, (cell) => {
        if (!cell) return "";
        return formatValue(cell.v ?? null, styleOf(workbook, cell).fmt);
      }, sheet.frozen?.rows ? sheet.frozen.rows - 1 : -1),
    [sheet, workbook],
  );

  const hidden = useMemo(() => {
    const rows = hiddenRows(
      sheet,
      (cell) => (cell ? formatValue(cell.v ?? null, styleOf(workbook, cell).fmt) : ""),
      sheet.frozen?.rows ? sheet.frozen.rows - 1 : -1,
    );
    // Скрытые руками и скрытые фильтром рисуются одинаково, а живут раздельно:
    // сброс фильтра не обязан показывать спрятанную служебную строку.
    for (const row of sheet.hiddenR ?? []) rows.add(row);
    return rows;
  }, [sheet, workbook]);

  const hiddenCols = useMemo(() => new Set(sheet.hiddenC ?? []), [sheet.hiddenC]);

  const hideLines = useCallback(
    (axis: "row" | "col") => {
      const list = new Set(axis === "row" ? (sheet.hiddenR ?? []) : (sheet.hiddenC ?? []));
      const from = axis === "row" ? range.r1 : range.c1;
      const to = axis === "row" ? range.r2 : range.c2;
      for (let line = from; line <= to; line++) list.add(line);

      // Лист без единой видимой строки не показать и нечем вернуть обратно.
      const total = axis === "row" ? sheet.rows : sheet.cols;
      if (list.size >= total) {
        setError(axis === "row" ? "Нельзя скрыть все строки" : "Нельзя скрыть все колонки");
        return;
      }

      const sorted = [...list].sort((a, b) => a - b);
      mutate((next) => {
        const target = next.sheets[index];
        if (!target) return;
        if (axis === "row") target.hiddenR = sorted;
        else target.hiddenC = sorted;
      });
    },
    [sheet, range, index, mutate],
  );

  const showLines = useCallback(
    (axis: "row" | "col") => {
      const from = axis === "row" ? range.r1 : range.c1;
      const to = axis === "row" ? range.r2 : range.c2;
      mutate((next) => {
        const target = next.sheets[index];
        if (!target) return;
        const list = (axis === "row" ? target.hiddenR : target.hiddenC) ?? [];
        const rest = list.filter((line) => line < from || line > to);
        const value = rest.length ? rest : undefined;
        if (axis === "row") target.hiddenR = value;
        else target.hiddenC = value;
      });
    },
    [range, index, mutate],
  );

  const showAllLines = useCallback(() => {
    mutate((next) => {
      const target = next.sheets[index];
      if (!target) return;
      target.hiddenR = undefined;
      target.hiddenC = undefined;
    });
  }, [index, mutate]);

  return {
    workbook,
    sheet,
    sheetIndex: index,
    selectSheet: (next) => {
      setSheetIndex(next);
      setActive({ row: 0, col: 0 });
      setAnchor({ row: 0, col: 0 });
      setEditing(null);
    },
    active,
    range,
    select,
    selectRange,
    move,
    editing,
    beginEdit,
    changeEdit,
    commitEdit,
    cancelEdit,
    update,
    mutate,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    clear,
    setStyle,
    setBorders,
    styleAt,
    display,
    sourceAt,
    copy,
    paste,
    pasteSpecial,
    hasCopy,
    fill,
    addSheet,
    renameSheet,
    removeSheet,
    sortBy,
    setFilter,
    filterValues,
    hidden,
    hiddenCols,
    hideLines,
    showLines,
    showAllLines,
    status,
    flush,
    error,
    clearError: () => setError(null),
  };
}

/** Строки → колонки: вставка чужого текста с транспонированием. */
function transposeRows(rows: string[][]): string[][] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const out: string[][] = [];
  for (let col = 0; col < width; col++) out.push(rows.map((row) => row[col] ?? ""));
  return out;
}

/**
 * Записать в ячейку то, что ввёл человек.
 *
 * Формат, выведенный из ввода («15%», «31.08.2026»), ставится только если у
 * ячейки его ещё нет: колонку, которой руками задали «два знака», ввод одного
 * процента переформатировать не должен.
 */
function writeInput(
  workbook: Workbook,
  sheet: SheetTab,
  row: number,
  col: number,
  raw: string,
): void {
  const existing = getCell(sheet, row, col);
  const style = styleOf(workbook, existing);
  const parsed = parseInput(raw, style.fmt === FORMATS.text);

  const cell: SheetCell = {};
  if (parsed.formula) cell.f = parsed.formula;
  else cell.v = parsed.value;

  const nextStyle = parsed.fmt && !style.fmt ? { ...style, fmt: parsed.fmt } : style;
  const index = styleIndex(workbook, nextStyle);
  if (index !== undefined) cell.s = index;

  // Пустой ввод стирает содержимое, но не оформление — как очистка выделения.
  if (cell.v === null && !cell.f && cell.s === undefined) {
    delete sheet.cells[cellRef(row, col)];
    return;
  }
  setCell(sheet, row, col, cell);
}
