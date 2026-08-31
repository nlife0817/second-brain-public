"use client";

// Содержимое меню по правой кнопке.
//
// Набор пунктов зависит от того, по чему щёлкнули: по ячейке, по номеру строки,
// по букве колонки или по углу. Это не украшательство — рука тянется к правой
// кнопке именно на заголовке, когда нужно вставить строку, и меню обязано
// предлагать там строки, а не абзацы.
//
// Работа с системным буфером идёт через `navigator.clipboard`: браузер может
// отказать в чтении, и тогда вставка честно берёт собственную копию, а не
// молчит. Копирование ту же копию заводит — из меню она нужна не меньше, чем по
// Ctrl+C.

import {
  ClipboardPaste,
  Columns3,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  Rows3,
  Scissors,
  Trash2,
} from "lucide-react";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  deleteColumns,
  deleteRows,
  insertColumns,
  insertRows,
} from "@/lib/core/sheet/ops";
import { SHEET_LIMITS } from "@/lib/core/sheet/model";
import type { PasteMode, SheetApi } from "./use-sheet";

/** По чему щёлкнули правой кнопкой. */
export type MenuTarget = "cell" | "row" | "col" | "corner";

/** Прочитать системный буфер. `undefined` — браузер не дал. */
async function readClipboard(): Promise<string | undefined> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return undefined;
  }
}

export function SheetMenu({
  api,
  target,
  editable,
}: {
  api: SheetApi;
  target: MenuTarget;
  editable: boolean;
}) {
  const { range, sheet } = api;
  const rows = range.r2 - range.r1 + 1;
  const cols = range.c2 - range.c1 + 1;
  const hasHidden = Boolean(sheet.hiddenR?.length || sheet.hiddenC?.length);

  const hiddenInside = (axis: "row" | "col") => {
    const list = axis === "row" ? sheet.hiddenR : sheet.hiddenC;
    const from = axis === "row" ? range.r1 : range.c1;
    const to = axis === "row" ? range.r2 : range.c2;
    return Boolean(list?.some((line) => line >= from && line <= to));
  };

  const copy = () => {
    const text = api.copy();
    void navigator.clipboard?.writeText(text).catch(() => {});
  };

  const paste = (mode: PasteMode) => {
    void readClipboard().then((text) => api.pasteSpecial(mode, text));
  };

  if (target === "corner") {
    return (
      <ContextMenuContent className="w-auto min-w-52">
        <ContextMenuItem onClick={copy}>
          <Copy />
          Копировать лист
        </ContextMenuItem>
        <ContextMenuItem onClick={() => api.showAllLines()} disabled={!editable || !hasHidden}>
          <Eye />
          Показать все строки и колонки
        </ContextMenuItem>
      </ContextMenuContent>
    );
  }

  return (
    <ContextMenuContent className="w-auto min-w-56">
      <ContextMenuItem
        disabled={!editable}
        onClick={() => {
          copy();
          api.clear();
        }}
      >
        <Scissors />
        Вырезать
        <ContextMenuShortcut>Ctrl+X</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onClick={copy}>
        <Copy />
        Копировать
        <ContextMenuShortcut>Ctrl+C</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem disabled={!editable} onClick={() => paste("all")}>
        <ClipboardPaste />
        Вставить
        <ContextMenuShortcut>Ctrl+V</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={!editable}>Специальная вставка</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem onClick={() => paste("values")}>
            Только значения
            <ContextMenuShortcut>Ctrl+Shift+V</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onClick={() => paste("formats")}>Только формат</ContextMenuItem>
          <ContextMenuItem onClick={() => paste("transpose")}>С транспонированием</ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>

      <ContextMenuSeparator />

      {target !== "col" && (
        <>
          <ContextMenuItem
            disabled={!editable}
            onClick={() => api.update(insertRows(api.workbook, api.sheetIndex, range.r1, rows))}
          >
            <Rows3 />
            {rows === 1 ? "Вставить строку выше" : `Вставить ${rows} строк выше`}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!editable}
            onClick={() => api.update(insertRows(api.workbook, api.sheetIndex, range.r2 + 1, rows))}
          >
            <Rows3 />
            {rows === 1 ? "Вставить строку ниже" : `Вставить ${rows} строк ниже`}
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            disabled={!editable}
            onClick={() => api.update(deleteRows(api.workbook, api.sheetIndex, range.r1, rows))}
          >
            <Trash2 />
            {rows === 1 ? "Удалить строку" : `Удалить ${rows} строк`}
          </ContextMenuItem>
        </>
      )}

      {target !== "row" && (
        <>
          <ContextMenuItem
            disabled={!editable || sheet.cols >= SHEET_LIMITS.cols}
            onClick={() => api.update(insertColumns(api.workbook, api.sheetIndex, range.c1, cols))}
          >
            <Columns3 />
            {cols === 1 ? "Вставить колонку слева" : `Вставить ${cols} колонок слева`}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!editable || sheet.cols >= SHEET_LIMITS.cols}
            onClick={() =>
              api.update(insertColumns(api.workbook, api.sheetIndex, range.c2 + 1, cols))
            }
          >
            <Columns3 />
            {cols === 1 ? "Вставить колонку справа" : `Вставить ${cols} колонок справа`}
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            disabled={!editable}
            onClick={() => api.update(deleteColumns(api.workbook, api.sheetIndex, range.c1, cols))}
          >
            <Trash2 />
            {cols === 1 ? "Удалить колонку" : `Удалить ${cols} колонок`}
          </ContextMenuItem>
        </>
      )}

      <ContextMenuSeparator />

      <ContextMenuItem disabled={!editable} onClick={() => api.clear()}>
        <Eraser />
        Очистить содержимое
        <ContextMenuShortcut>Delete</ContextMenuShortcut>
      </ContextMenuItem>

      {target !== "cell" && (
        <ContextMenuItem
          disabled={!editable}
          onClick={() => api.hideLines(target === "col" ? "col" : "row")}
        >
          <EyeOff />
          {target === "col"
            ? cols === 1
              ? "Скрыть колонку"
              : `Скрыть ${cols} колонок`
            : rows === 1
              ? "Скрыть строку"
              : `Скрыть ${rows} строк`}
        </ContextMenuItem>
      )}
      {target !== "cell" && hiddenInside(target === "col" ? "col" : "row") && (
        <ContextMenuItem
          disabled={!editable}
          onClick={() => api.showLines(target === "col" ? "col" : "row")}
        >
          <Eye />
          {target === "col" ? "Показать скрытые колонки" : "Показать скрытые строки"}
        </ContextMenuItem>
      )}
      {hasHidden && (
        <ContextMenuItem disabled={!editable} onClick={() => api.showAllLines()}>
          <Eye />
          Показать всё
        </ContextMenuItem>
      )}
    </ContextMenuContent>
  );
}
