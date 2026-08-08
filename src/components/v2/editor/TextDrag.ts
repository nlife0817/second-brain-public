"use client";

// Расширение редактора: выделенный текст нельзя утащить мышью.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/**
 * Жест «нажал внутри уже выделенного фрагмента и потянул» браузер считает не
 * новым выделением, а переносом текста: пока человек думает, что выделяет,
 * фрагмент вырезается и вставляется в другое место. Со стороны это выглядело
 * как мигание текста под курсором — на деле документ молча менялся.
 *
 * Сильнее всего ловушка бьёт по развёрнутому описанию: там над выделением
 * встаёт меню (`SelectionMenu`), после нажатия его кнопок выделение
 * намеренно сохраняется, и следующий заход мышью почти всегда начинается
 * внутри старого выделения.
 *
 * Драг от `[data-drag-handle]` пропускаем: этой ручкой Tiptap тащит узел
 * целиком. Такую ручку рисует картинка (`DocImage`) — ею и служит само
 * изображение, поэтому его перенос по документу этот запрет не задевает.
 *
 * Сброс файлов извне под запрет не попадает: он приходит без `dragstart`,
 * событиями `dragover`/`drop` (см. `handleDrop` в useDocEditor и useFileDrop).
 */
export const NoTextDrag = Extension.create({
  name: "noTextDrag",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("noTextDrag"),
        props: {
          handleDOMEvents: {
            dragstart: (_view, event) => {
              const target = event.target;
              if (target instanceof Element && target.closest("[data-drag-handle]")) return false;
              event.preventDefault();
              return true;
            },
          },
        },
      }),
    ];
  },
});
