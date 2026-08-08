"use client";

// Расширение редактора: клик по ссылке уводит в новую вкладку. Само правило
// клика и открытие живут в open-link.ts — их же зовёт готовая разметка
// комментария, которая рисуется без редактора.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { anchorFromEvent, openLinkInNewTab, shouldOpenLink } from "./open-link";

/**
 * Работает вместо `openOnClick` расширения ссылок — то открывает адрес по
 * атрибуту `target` (значит, унаследованное `_self` открылось бы поверх
 * приложения) и без `noopener`.
 *
 * `handleDOMEvents`, а не `handleClick`: нужен сам DOM-клик, чтобы отменить
 * переход браузера. `handleClick` вызывается на mouseup, и `preventDefault`
 * там до перехода по ссылке не доходит — в режиме чтения вкладка открывалась бы
 * дважды: и нами, и браузером.
 */
export const OpenLinkInNewTab = Extension.create({
  name: "openLinkInNewTab",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("openLinkInNewTab"),
        props: {
          handleDOMEvents: {
            click: (view, event) => {
              const anchor = anchorFromEvent(event);
              if (!anchor) return false;
              // Ссылка вложения живёт в своём узле с contenteditable="false":
              // текст там не набирают, и курсор внутрь ставить незачем — такая
              // ссылка открывается обычным кликом даже в режиме правки.
              const editable = view.editable && !anchor.closest('[contenteditable="false"]');
              if (!shouldOpenLink(event, editable)) return false;
              event.preventDefault();
              // `anchor.href` вместо атрибута: вложение приезжает относительной
              // ссылкой на роут отдачи файла.
              openLinkInNewTab(anchor.href);
              return true;
            },
          },
        },
      }),
    ];
  },
});
