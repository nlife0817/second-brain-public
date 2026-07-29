"use client";

// Вставка ссылки. Живёт отдельно от панели инструментов: тот же диалог зовёт
// и меню по выделению, а две копии одного `window.prompt` разошлись бы уже на
// первой правке.

import type { Editor } from "@tiptap/core";

/**
 * Спрашивает адрес и вешает ссылку на выделение.
 *
 * `extendMarkRange` обязателен: курсор внутри уже существующей ссылки без него
 * разрезал бы её на две — правится вся метка целиком, а не выделенный кусок.
 * Пустой ответ снимает ссылку, отмена (`null`) не делает ничего.
 */
export function promptForLink(editor: Editor): void {
  const previous = (editor.getAttributes("link").href as string) ?? "";
  const href = window.prompt("Адрес ссылки", previous);
  if (href === null) return;
  if (!href.trim()) {
    editor.chain().focus().unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim() }).run();
}
