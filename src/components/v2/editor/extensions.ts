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
import { createMention, type MentionItem } from "./Mention";

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
    StarterKit.configure({
      link: {
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer nofollow" },
      },
    }),
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
    // Упоминание тоже правило разбора: редактор без него не узнает
    // <span data-type="mention"> и выбросит чужое упоминание при первом же
    // сохранении — ровно та же ловушка, что с CommentMark выше.
    ...(mentionItems ? [createMention(mentionItems)] : []),
  ];
}

/**
 * Набор для комментария: тот же текст, но без таблиц, колонок, вложений и
 * якорей обсуждения — им в ленте нечего делать, а вес чанка они добавляют.
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
      link: {
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer nofollow" },
      },
    }),
    Placeholder.configure({ placeholder }),
    ...(mentionItems ? [createMention(mentionItems)] : []),
  ];
}
