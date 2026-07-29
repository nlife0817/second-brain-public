import { Node, mergeAttributes } from "@tiptap/core";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    columnBlock: {
      /** Вставить раскладку из `count` колонок и встать курсором в первую. */
      insertColumns: (count?: number) => ReturnType;
      /** Добавить колонку в текущую раскладку. */
      addColumn: () => ReturnType;
      /** Убрать колонку, в которой стоит курсор; предпоследняя разбирает раскладку. */
      removeColumn: () => ReturnType;
    };
  }
}

const MAX_COLUMNS = 4;

type Located = { node: PMNode; pos: number };

/** Ближайший предок позиции с нужным типом — общая часть команд раскладки. */
function findAncestor($pos: ResolvedPos, typeName: string): Located | null {
  for (let depth = $pos.depth; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === typeName) return { node, pos: $pos.before(depth) };
  }
  return null;
}

/**
 * Колонка раскладки. `isolating` не даёт Backspace в начале колонки утащить в
 * неё содержимое соседней — без этого раскладка разваливается от одного нажатия.
 */
export const Column = Node.create({
  name: "column",
  content: "block+",
  isolating: true,

  parseHTML() {
    return [{ tag: "div[data-column]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-column": "" }), 0];
  },
});

/**
 * Раскладка в несколько колонок: `<div data-columns="N">` с колонками внутри.
 *
 * Число колонок дублируется атрибутом, а не выводится из количества детей:
 * ширины раздаёт CSS grid, и без атрибута он не знал бы, на сколько долей делить
 * строку при обычном рендере описания — вне редактора тот же HTML показывает
 * карточка задачи.
 */
export const ColumnBlock = Node.create({
  name: "columnBlock",
  group: "block",
  content: "column+",

  addAttributes() {
    return {
      count: {
        default: 2,
        parseHTML: (element) => Number(element.getAttribute("data-columns")) || 2,
        renderHTML: (attributes) => ({ "data-columns": String(attributes.count ?? 2) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-columns]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      insertColumns:
        (count = 2) =>
        ({ commands }) => {
          const total = Math.max(2, Math.min(MAX_COLUMNS, count));
          return commands.insertContent({
            type: this.name,
            attrs: { count: total },
            content: Array.from({ length: total }, () => ({
              type: "column",
              content: [{ type: "paragraph" }],
            })),
          });
        },

      addColumn:
        () =>
        ({ state, tr, dispatch }) => {
          const block = findAncestor(state.selection.$from, this.name);
          if (!block || block.node.childCount >= MAX_COLUMNS) return false;
          if (!dispatch) return true;
          const column = state.schema.nodes.column.create(null, state.schema.nodes.paragraph.create());
          // Вставка в конец раскладки: позиция перед её закрывающим токеном.
          tr.insert(block.pos + block.node.nodeSize - 1, column);
          tr.setNodeAttribute(block.pos, "count", block.node.childCount + 1);
          return true;
        },

      removeColumn:
        () =>
        ({ state, tr, dispatch }) => {
          const $from = state.selection.$from;
          const block = findAncestor($from, this.name);
          const column = findAncestor($from, "column");
          if (!block || !column) return false;
          if (!dispatch) return true;

          // Раскладка из одной колонки — уже не раскладка: разбираем её целиком,
          // содержимое остаётся в документе обычными блоками.
          if (block.node.childCount <= 2) {
            const blocks: PMNode[] = [];
            block.node.forEach((col) => col.forEach((child) => blocks.push(child)));
            tr.replaceWith(block.pos, block.pos + block.node.nodeSize, blocks);
            return true;
          }
          tr.delete(column.pos, column.pos + column.node.nodeSize);
          tr.setNodeAttribute(block.pos, "count", block.node.childCount - 1);
          return true;
        },
    };
  },
});
