"use client";

// Упоминание участника через «@».
//
// Разметку задаём сами, а не берём из умолчаний пакета: она уезжает в
// core.tasks.description и core.comments.body, то есть переживёт обновление
// Tiptap. Классов на теге нет намеренно — санитайзер вырезает class у span
// (у него разрешены только data-*), поэтому чип стилизуется по
// [data-type="mention"] в globals.css.
//
// Сервер разбирает ту же разметку в lib/core/mentions.ts — правя одно, правь
// второе, иначе упоминание перестанет доходить до человека.

import Mention from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";
import { MentionList, type MentionItem, type MentionListHandle } from "./MentionList";

/** Сколько человек показываем в списке: длиннее его всё равно не читают. */
const MAX_ITEMS = 8;
/** Ниже этого запаса снизу список раскрывается вверх — композер часто у кромки. */
const FLIP_THRESHOLD = 260;
const PANEL_WIDTH = 256;

function place(element: HTMLElement, rect: DOMRect | null | undefined) {
  if (!rect) return;
  element.style.position = "fixed";
  // Выше слоя развёрнутого документа (z-60) и всплывающего меню (z-70).
  element.style.zIndex = "80";
  // Каретку увезли прокруткой за пределы экрана — прячем список: он `fixed` и
  // иначе висел бы посреди страницы поверх всего, оставаясь кликабельным.
  const offscreen = rect.bottom < 0 || rect.top > window.innerHeight;
  element.style.visibility = offscreen ? "hidden" : "";
  element.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8))}px`;
  if (window.innerHeight - rect.bottom < FLIP_THRESHOLD) {
    element.style.top = "auto";
    element.style.bottom = `${window.innerHeight - rect.top + 6}px`;
  } else {
    element.style.bottom = "auto";
    element.style.top = `${rect.bottom + 6}px`;
  }
}

/**
 * `getItems` — функция, а не готовый массив: набор расширений собирается внутри
 * useEditor, и зависимость от списка участников заставляла бы пересоздавать
 * редактор на каждый refreshMembers(), теряя историю и позицию курсора.
 */
export function createMention(getItems: () => MentionItem[]) {
  return Mention.configure({
    deleteTriggerWithBackspace: true,
    renderHTML: ({ node }) => {
      const id = (node.attrs.id as string | null) ?? "";
      const label = (node.attrs.label as string | null) ?? id;
      return ["span", { "data-type": "mention", "data-id": id, "data-label": label }, `@${label}`];
    },
    renderText: ({ node }) => `@${(node.attrs.label as string | null) ?? node.attrs.id ?? ""}`,
    suggestion: {
      char: "@",
      allowSpaces: false,
      items: ({ query }) => {
        const q = query.trim().toLowerCase();
        const all = getItems();
        const matched = q
          ? all.filter((m) => m.label.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
          : all;
        return matched.slice(0, MAX_ITEMS);
      },
      render: () => {
        let renderer: ReactRenderer<MentionListHandle> | null = null;
        // Escape прячет список, но подсказка остаётся активной: плагин
        // suggestion сам её не выключает. Показываем обратно, как только запрос
        // изменился — то есть человек продолжил набирать.
        let dismissed = false;
        // Откуда брать координаты каретки между транзакциями редактора: сам
        // плагин зовёт нас только на них, а прокрутка транзакции не порождает.
        let rectOf: (() => DOMRect | null) | null = null;

        const show = (visible: boolean) => {
          const el = renderer?.element as HTMLElement | undefined;
          if (el) el.style.display = visible ? "" : "none";
        };

        /**
         * Список приклеен к каретке `position: fixed`, поэтому прокрутка любого
         * предка (карточка задачи, панель обсуждения) уводит каретку, а список
         * остаётся на прежнем месте экрана — поверх чужого содержимого и всё ещё
         * кликабельным. Слушаем в фазе перехвата: события прокрутки внутренних
         * контейнеров до window не всплывают.
         */
        const reposition = () => {
          if (renderer && rectOf) place(renderer.element as HTMLElement, rectOf());
        };

        return {
          onStart: (props) => {
            dismissed = false;
            rectOf = props.clientRect ?? null;
            renderer = new ReactRenderer(MentionList, {
              props: { items: props.items, command: props.command },
              editor: props.editor,
            });
            document.body.appendChild(renderer.element);
            place(renderer.element as HTMLElement, props.clientRect?.());
            window.addEventListener("scroll", reposition, true);
            window.addEventListener("resize", reposition);
          },
          onUpdate: (props) => {
            dismissed = false;
            rectOf = props.clientRect ?? null;
            show(true);
            renderer?.updateProps({ items: props.items, command: props.command });
            if (renderer) place(renderer.element as HTMLElement, props.clientRect?.());
          },
          onKeyDown: (props) => {
            if (props.event.key === "Escape") {
              // Уже спрятан — отдаём Escape дальше: вторым нажатием закрывают
              // сам развёрнутый документ. Раньше клавиша съедалась всегда,
              // список оставался на экране, а документ схлопывался первым же
              // нажатием, потому что обработчик на document её всё равно видел.
              if (dismissed) return false;
              dismissed = true;
              show(false);
              props.event.preventDefault();
              props.event.stopPropagation();
              return true;
            }
            if (dismissed) return false;
            return renderer?.ref?.onKeyDown(props.event) ?? false;
          },
          onExit: () => {
            window.removeEventListener("scroll", reposition, true);
            window.removeEventListener("resize", reposition);
            renderer?.element.remove();
            renderer?.destroy();
            renderer = null;
            rectOf = null;
            dismissed = false;
          },
        };
      },
    },
  });
}

export type { MentionItem };
