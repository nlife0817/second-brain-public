"use client";

// Расширение редактора: подсветка контейнера, в который упадёт перетаскиваемый
// блок.
//
// Само место вставки показывает Dropcursor (настроен в extensions.ts) — линия
// между блоками. Внутри колонки или ячейки таблицы одной линии мало: она
// короткая, стоит вплотную к соседней колонке, и по ней не понять, в какую из
// них картинка встанет. Поэтому контейнер под курсором ещё и обводится.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

/** Позиция подсвеченного контейнера или `null`, когда подсвечивать нечего. */
const dropTargetKey = new PluginKey<number | null>("dropTarget");

/**
 * Что подсвечиваем. Обычный абзац в общий поток документа не входит: там линия
 * места вставки видна и без обводки, а рамка вокруг каждого абзаца была бы
 * шумом.
 */
const TARGETS = new Set(["column", "tableCell", "tableHeader"]);

/** Ближайший контейнер из `TARGETS` под курсором мыши. */
function targetAt(view: EditorView, event: DragEvent): number | null {
  const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!coords) return null;
  // `inside` — позиция узла под курсором; вне узлов (между блоками) годится сама
  // позиция в тексте, её предки те же.
  const $pos = view.state.doc.resolve(coords.inside >= 0 ? coords.inside : coords.pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (TARGETS.has($pos.node(depth).type.name)) return $pos.before(depth);
  }
  return null;
}

/**
 * Транзакция уходит только на смену цели: `dragover` летит десятками в секунду,
 * и на каждое движение мыши перерисовывать документ незачем.
 */
function highlight(view: EditorView, pos: number | null): void {
  if (dropTargetKey.getState(view.state) === pos) return;
  view.dispatch(view.state.tr.setMeta(dropTargetKey, pos));
}

export const DropTarget = Extension.create({
  name: "dropTarget",

  addProseMirrorPlugins() {
    return [
      new Plugin<number | null>({
        key: dropTargetKey,

        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(dropTargetKey) as number | null | undefined;
            // `null` — законное значение (снять подсветку), поэтому «пришло ли
            // указание» проверяем по `undefined`, а не по правдивости.
            if (meta !== undefined) return meta;
            return value === null ? null : tr.mapping.map(value);
          },
        },

        props: {
          decorations(state) {
            const pos = dropTargetKey.getState(state);
            if (pos == null) return null;
            const node = state.doc.nodeAt(pos);
            if (!node) return null;
            return DecorationSet.create(state.doc, [
              Decoration.node(pos, pos + node.nodeSize, { class: "doc-drop-target" }),
            ]);
          },

          handleDOMEvents: {
            dragover: (view, event) => {
              highlight(view, targetAt(view, event));
              return false;
            },
            // `dragleave` приходит и при переходе между детьми редактора —
            // подсветку снимает только выход за его пределы.
            dragleave: (view, event) => {
              const to = event.relatedTarget;
              if (to instanceof Node && view.dom.contains(to)) return false;
              highlight(view, null);
              return false;
            },
            drop: (view) => {
              highlight(view, null);
              return false;
            },
            dragend: (view) => {
              highlight(view, null);
              return false;
            },
          },
        },
      }),
    ];
  },
});
