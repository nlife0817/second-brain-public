"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { Download, Paperclip, Trash2 } from "lucide-react";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    docFile: {
      /** Вставить не-картинку вложением в позицию курсора. */
      insertDocFile: (attrs: { href: string; name: string; size?: number }) => ReturnType;
    };
  }
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`;
  return `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

/**
 * Вложение, которое нельзя показать картинкой (pdf, архив, документ).
 *
 * Хранится ссылкой на тот же роут отдачи файлов — он сам решит, отдать байты
 * встроенно или как загрузку. Отдельный узел, а не обычная ссылка: иначе
 * вложение не отличить от ссылки на сайт ни глазами, ни при уборке осиротевших
 * файлов.
 */
export const DocFile = Node.create({
  name: "docFile",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      href: { default: null },
      name: { default: "Файл" },
      size: {
        default: 0,
        parseHTML: (element) => Number(element.getAttribute("data-file-size")) || 0,
        renderHTML: (attributes) => ({ "data-file-size": String(attributes.size ?? 0) }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-file]",
        getAttrs: (element) => {
          const link = element.querySelector("a");
          if (!link) return false;
          return {
            href: link.getAttribute("href"),
            name: element.getAttribute("data-file-name") || link.textContent || "Файл",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const { href, name, ...rest } = HTMLAttributes;
    return [
      "div",
      mergeAttributes(rest, { "data-file": "", "data-file-name": String(name ?? "") }),
      ["a", { href: String(href ?? ""), target: "_blank" }, String(name ?? node.attrs.name ?? "Файл")],
    ];
  },

  addCommands() {
    return {
      insertDocFile:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(DocFileView);
  },
});

function DocFileView({ node, editor, deleteNode }: NodeViewProps) {
  const href = (node.attrs.href as string) ?? "";
  const name = (node.attrs.name as string) ?? "Файл";
  const size = formatBytes(Number(node.attrs.size) || 0);

  return (
    <NodeViewWrapper as="div" data-file="" className="doc-file" contentEditable={false}>
      <Paperclip className="size-4 shrink-0 text-muted-foreground" />
      <a href={href} target="_blank" rel="noopener noreferrer" className="doc-file-name">
        {name}
      </a>
      {size && <span className="doc-file-size">{size}</span>}
      <a href={href} download={name} className="doc-file-action" title="Скачать">
        <Download className="size-4" />
      </a>
      {editor.isEditable && (
        <button type="button" onClick={() => deleteNode()} className="doc-file-action" title="Убрать вложение">
          <Trash2 className="size-4" />
        </button>
      )}
    </NodeViewWrapper>
  );
}
