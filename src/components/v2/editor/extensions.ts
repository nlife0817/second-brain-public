"use client";

// Единый набор расширений редактора описания. Инлайновая версия в карточке и
// полноэкранный документ обязаны понимать одну и ту же разметку: описание,
// набранное в развёрнутом режиме, открывается в карточке — и наоборот.
//
// Список должен оставаться согласованным с allowlist в lib/sanitize.ts: тег,
// которого там нет, вычищается сервером при первом же сохранении.

import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TextAlign from "@tiptap/extension-text-align";
import Highlight from "@tiptap/extension-highlight";
import { TableKit } from "@tiptap/extension-table";
import type { Extensions } from "@tiptap/core";
import { Column, ColumnBlock } from "./Columns";
import { CommentMark } from "./CommentMark";
import { DocFile } from "./DocFile";
import { DocImage } from "./DocImage";
import { DropTarget } from "./DropTarget";
import { createMention, type MentionItem } from "./Mention";
import { OpenLinkInNewTab } from "./OpenLink";
import { DocSearch } from "./Search";
import { NoTextDrag } from "./TextDrag";

/**
 * Ссылки открывает `OpenLinkInNewTab`, а не сам `openOnClick`: тот идёт по
 * атрибуту `target` (в унаследованных описаниях там `_self`) и не ставит
 * `noopener`. Сам атрибут в разметке всё равно нужен — по нему уходит в новую
 * вкладку ссылка из тела комментария, которое выводится разметкой без редактора.
 */
const LINK_OPTIONS = {
  openOnClick: false,
  HTMLAttributes: { target: "_blank", rel: "noopener noreferrer nofollow" },
} as const;

/**
 * Линия места вставки при перетаскивании картинки (`DocImage`).
 *
 * Цвет отдан классу, а не опции: `color` расширение вписывает прямо в
 * `style="background-color"`, и такая линия не знала бы ни тёмной темы, ни
 * толщины на границе колонки. Волосок по умолчанию вдобавок теряется на фоне
 * текста — в разметке видно только `.doc-dropcursor` из globals.css.
 */
const DROPCURSOR_OPTIONS = { color: false, width: 3, class: "doc-dropcursor" } as const;

export interface DocExtensionsOptions {
  placeholder?: string;
  /**
   * Участники для @-упоминаний. Функция, а не массив: набор расширений строится
   * внутри useEditor, и зависимость от состава заставляла бы пересоздавать
   * редактор на каждый refreshMembers() — с потерей истории и курсора.
   */
  mentionItems?: () => MentionItem[];
}

/**
 * Набор одинаков для обеих оболочек, включая якоря комментариев — хотя оставить
 * комментарий можно только в развёрнутом режиме.
 *
 * Убрать метку там, где её негде поставить, нельзя: расширение — это ещё и
 * правило разбора. Редактор без `CommentMark` не узнаёт `<span data-comment>` в
 * описании и молча выбрасывает его при первом же сохранении, обрывая привязку
 * всех обсуждений к тексту.
 */
export function docExtensions({
  placeholder = "Добавьте описание…",
  mentionItems,
}: DocExtensionsOptions = {}): Extensions {
  return [
    StarterKit.configure({ link: LINK_OPTIONS, dropcursor: DROPCURSOR_OPTIONS }),
    OpenLinkInNewTab,
    NoTextDrag,
    DropTarget,
    Placeholder.configure({ placeholder }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Highlight,
    // Ширины колонок хранятся в атрибуте colwidth — санитайзер его пропускает.
    TableKit.configure({ table: { resizable: true, allowTableNodeSelection: true } }),
    ColumnBlock,
    Column,
    DocImage,
    DocFile,
    CommentMark,
    // Поиск по тексту. В карточке строку поиска не открывают, но расширение идёт
    // и туда: разметки оно не добавляет и молчит, пока запрос пуст, а держать
    // два разных набора ради одного плагина — лишний повод им разойтись.
    DocSearch,
    // Упоминание тоже правило разбора: редактор без него не узнает
    // <span data-type="mention"> и выбросит чужое упоминание при первом же
    // сохранении — ровно та же ловушка, что с CommentMark выше.
    ...(mentionItems ? [createMention(mentionItems)] : []),
  ];
}

/**
 * Набор для комментария: тот же текст, но без таблиц, колонок, файловых
 * вложений и якорей обсуждения — им в ленте нечего делать, а вес чанка они
 * добавляют.
 *
 * Картинка здесь есть: комментарий со скриншотом объясняет больше абзаца
 * текста. Узел тот же `DocImage`, но в компактном виде — размер и удаление, без
 * подписи и выключки: колонка комментария для них слишком узкая. Санитайзер
 * пропускает `figure`/`img` со `style: width` в любом тексте, поэтому ширина
 * переживает отправку.
 *
 * `DropTarget` сюда не идёт: подсвечивать в комментарии нечего — ни колонок, ни
 * таблиц тут нет, картинка двигается между абзацами, и линии места вставки
 * достаточно.
 */
export function commentExtensions({
  placeholder = "Написать комментарий…",
  mentionItems,
}: DocExtensionsOptions = {}): Extensions {
  return [
    StarterKit.configure({
      heading: false,
      horizontalRule: false,
      codeBlock: false,
      link: LINK_OPTIONS,
      dropcursor: DROPCURSOR_OPTIONS,
    }),
    OpenLinkInNewTab,
    NoTextDrag,
    Placeholder.configure({ placeholder }),
    DocImage.configure({ compact: true }),
    ...(mentionItems ? [createMention(mentionItems)] : []),
  ];
}
