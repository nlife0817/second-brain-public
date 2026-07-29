"use client";

import { useRef } from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Columns2,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  MessageSquarePlus,
  Minus,
  Paperclip,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { promptForLink } from "./link";

/**
 * Кнопка панели. `onMouseDown` с preventDefault обязателен: без него нажатие
 * снимает выделение в редакторе ещё до того, как команда успеет отработать, и
 * форматирование применяется к пустому диапазону.
 *
 * Экспортируется ради меню по выделению (`SelectionMenu`): там та же ловушка с
 * выделением, и решать её вторым способом незачем.
 */
export function ToolButton({
  active,
  disabled,
  title,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
        active && "bg-muted text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function Divider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}

export interface EditorToolbarProps {
  editor: Editor;
  /** `full` добавляет историю, выключку, таблицы и колонки. */
  variant?: "compact" | "full";
  /** Вызывается с выбранными файлами; загрузку делает владелец редактора. */
  onFiles?: (files: File[]) => void;
  /** Комментарий к выделенному фрагменту — только в развёрнутом режиме. */
  onComment?: () => void;
}

export function EditorToolbar({
  editor,
  variant = "compact",
  onFiles,
  onComment,
}: EditorToolbarProps) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const full = variant === "full";

  // Подписка на состояние редактора: без неё подсветка активных кнопок
  // обновлялась бы только на перерисовку владельца, то есть почти никогда.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      highlight: e.isActive("highlight"),
      link: e.isActive("link"),
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bulletList: e.isActive("bulletList"),
      orderedList: e.isActive("orderedList"),
      blockquote: e.isActive("blockquote"),
      codeBlock: e.isActive("codeBlock"),
      alignLeft: e.isActive({ textAlign: "left" }),
      alignCenter: e.isActive({ textAlign: "center" }),
      alignRight: e.isActive({ textAlign: "right" }),
      inTable: e.isActive("table"),
      inColumns: e.isActive("columnBlock"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      hasSelection: !e.state.selection.empty,
    }),
  });

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-0.5">
        {full && (
          <>
            <ToolButton title="Отменить" disabled={!state.canUndo} onClick={() => editor.chain().focus().undo().run()}>
              <Undo2 className="size-4" />
            </ToolButton>
            <ToolButton title="Вернуть" disabled={!state.canRedo} onClick={() => editor.chain().focus().redo().run()}>
              <Redo2 className="size-4" />
            </ToolButton>
            <Divider />
          </>
        )}

        {([1, 2, 3] as const).map((level) => (
          <ToolButton
            key={level}
            title={`Заголовок ${level}`}
            active={level === 1 ? state.h1 : level === 2 ? state.h2 : state.h3}
            onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
          >
            <span className="text-xs font-semibold">H{level}</span>
          </ToolButton>
        ))}
        <Divider />

        <ToolButton title="Полужирный" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="size-4" />
        </ToolButton>
        <ToolButton title="Курсив" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="size-4" />
        </ToolButton>
        <ToolButton title="Подчёркнутый" active={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="size-4" />
        </ToolButton>
        <ToolButton title="Зачёркнутый" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough className="size-4" />
        </ToolButton>
        <ToolButton title="Выделение цветом" active={state.highlight} onClick={() => editor.chain().focus().toggleHighlight().run()}>
          <Highlighter className="size-4" />
        </ToolButton>
        <ToolButton title="Моноширинный" active={state.code} onClick={() => editor.chain().focus().toggleCode().run()}>
          <Code className="size-4" />
        </ToolButton>
        <ToolButton title="Ссылка" active={state.link} onClick={() => promptForLink(editor)}>
          <Link2 className="size-4" />
        </ToolButton>
        <Divider />

        <ToolButton title="Маркированный список" active={state.bulletList} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="size-4" />
        </ToolButton>
        <ToolButton title="Нумерованный список" active={state.orderedList} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="size-4" />
        </ToolButton>
        <ToolButton title="Цитата" active={state.blockquote} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote className="size-4" />
        </ToolButton>
        <ToolButton title="Разделитель" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          <Minus className="size-4" />
        </ToolButton>

        {full && (
          <>
            <Divider />
            <ToolButton title="По левому краю" active={state.alignLeft} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
              <AlignLeft className="size-4" />
            </ToolButton>
            <ToolButton title="По центру" active={state.alignCenter} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
              <AlignCenter className="size-4" />
            </ToolButton>
            <ToolButton title="По правому краю" active={state.alignRight} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
              <AlignRight className="size-4" />
            </ToolButton>
            <Divider />
            <ToolButton
              title="Таблица"
              active={state.inTable}
              onClick={() =>
                editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
              }
            >
              <TableIcon className="size-4" />
            </ToolButton>
            <ToolButton
              title="Две колонки"
              active={state.inColumns}
              onClick={() => editor.chain().focus().insertColumns(2).run()}
            >
              <Columns2 className="size-4" />
            </ToolButton>
          </>
        )}

        {onFiles && (
          <>
            <Divider />
            <ToolButton title="Изображение" onClick={() => fileInput.current?.click()}>
              <ImageIcon className="size-4" />
            </ToolButton>
            <ToolButton title="Файл" onClick={() => fileInput.current?.click()}>
              <Paperclip className="size-4" />
            </ToolButton>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                // Сброс значения: тот же файл, выбранный второй раз подряд, иначе
                // не даёт события change.
                e.target.value = "";
                if (files.length) onFiles(files);
              }}
            />
          </>
        )}

        {onComment && (
          <>
            <Divider />
            <ToolButton
              title="Комментарий к выделенному"
              disabled={!state.hasSelection}
              onClick={onComment}
            >
              <MessageSquarePlus className="size-4" />
            </ToolButton>
          </>
        )}
      </div>

      {/* Правка таблицы — отдельной строкой и только внутри таблицы: восемь
          кнопок в общем ряду занимали бы место постоянно, а нужны редко. */}
      {full && state.inTable && (
        <div className="mt-1 flex flex-wrap items-center gap-0.5 border-t border-border pt-1">
          <span className="mr-1 text-[11px] uppercase tracking-wide text-muted-foreground">Таблица</span>
          <TableAction label="Столбец слева" onClick={() => editor.chain().focus().addColumnBefore().run()} />
          <TableAction label="Столбец справа" onClick={() => editor.chain().focus().addColumnAfter().run()} />
          <TableAction label="Строка выше" onClick={() => editor.chain().focus().addRowBefore().run()} />
          <TableAction label="Строка ниже" onClick={() => editor.chain().focus().addRowAfter().run()} />
          <TableAction label="Объединить" onClick={() => editor.chain().focus().mergeOrSplit().run()} />
          <TableAction label="Шапка" onClick={() => editor.chain().focus().toggleHeaderRow().run()} />
          <ToolButton title="Удалить столбец" onClick={() => editor.chain().focus().deleteColumn().run()}>
            <span className="text-xs">−стлб</span>
          </ToolButton>
          <ToolButton title="Удалить строку" onClick={() => editor.chain().focus().deleteRow().run()}>
            <span className="text-xs">−стрк</span>
          </ToolButton>
          <ToolButton title="Удалить таблицу" onClick={() => editor.chain().focus().deleteTable().run()}>
            <Trash2 className="size-4" />
          </ToolButton>
        </div>
      )}

      {full && state.inColumns && (
        <div className="mt-1 flex flex-wrap items-center gap-1 border-t border-border pt-1">
          <span className="mr-1 text-[11px] uppercase tracking-wide text-muted-foreground">Колонки</span>
          <TableAction label="Добавить" onClick={() => editor.chain().focus().addColumn().run()} />
          <TableAction label="Убрать" onClick={() => editor.chain().focus().removeColumn().run()} />
        </div>
      )}
    </div>
  );
}

function TableAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="rounded-md px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {label}
    </button>
  );
}
