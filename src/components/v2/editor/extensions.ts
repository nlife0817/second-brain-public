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

export interface DocExtensionsOptions {
  placeholder?: string;
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
  ];
}
