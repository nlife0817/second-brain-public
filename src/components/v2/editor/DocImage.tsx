"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { useCallback, useRef, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    docImage: {
      /** Вставить картинку-вложение в позицию курсора. */
      insertDocImage: (attrs: {
        src: string;
        alt?: string;
        caption?: string;
        width?: string | null;
      }) => ReturnType;
    };
  }
}

const ALIGNMENTS = ["left", "center", "right"] as const;
type Align = (typeof ALIGNMENTS)[number];

/** Ширина хранится строкой CSS: пресеты задают доли, перетаскивание — пиксели. */
const WIDTH_RE = /^\d+(?:\.\d+)?(?:px|%)$/;

function normalizeWidth(raw: unknown): string | null {
  return typeof raw === "string" && WIDTH_RE.test(raw) ? raw : null;
}

/**
 * Картинка с подписью и изменяемым размером.
 *
 * В разметке — `<figure data-image>` с `<img>` и `<figcaption>`. Подпись живёт
 * атрибутом, а не содержимым узла: иначе внутри атомарной картинки появляется
 * второй редактируемый контур, курсор проваливается в него стрелками и
 * выделение всего документа начинает вести себя непредсказуемо.
 */
export const DocImage = Node.create({
  name: "docImage",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: "" },
      caption: { default: "" },
      width: {
        default: null,
        parseHTML: (element) => normalizeWidth(element.style.width),
        renderHTML: (attributes) => {
          const width = normalizeWidth(attributes.width);
          return width ? { style: `width: ${width}` } : {};
        },
      },
      align: {
        default: "left",
        parseHTML: (element) => {
          const value = element.getAttribute("data-align");
          return ALIGNMENTS.includes(value as Align) ? value : "left";
        },
        renderHTML: (attributes) => ({ "data-align": (attributes.align as string) ?? "left" }),
      },
      /**
       * Метка картинки, которая ещё грузится во вложения (см. paste-images.ts).
       * Пока метка стоит, на месте картинки рисуется заглушка, а `src` пуст:
       * исходный base64 в документ не попадает вовсе, иначе описание раздувается
       * до мегабайтов и перестаёт помещаться в предел сохранения.
       */
      uploadId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-upload"),
        renderHTML: (attributes) =>
          attributes.uploadId ? { "data-upload": String(attributes.uploadId) } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "figure[data-image]",
        getAttrs: (element) => {
          const img = element.querySelector("img");
          if (!img) return false;
          return {
            src: img.getAttribute("src"),
            alt: img.getAttribute("alt") ?? "",
            caption: element.querySelector("figcaption")?.textContent ?? "",
          };
        },
      },
      // Одиночная картинка из буфера обмена или старого описания.
      { tag: "img[src]", getAttrs: (element) => ({ src: element.getAttribute("src") }) },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const { src, alt, caption, ...rest } = HTMLAttributes;
    const figure = mergeAttributes(rest, { "data-image": "" });
    const image = ["img", { src, alt: alt || node.attrs.caption || "" }];
    return caption || node.attrs.caption
      ? ["figure", figure, image, ["figcaption", {}, String(caption ?? node.attrs.caption)]]
      : ["figure", figure, image];
  },

  addCommands() {
    return {
      insertDocImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(DocImageView);
  },
});

function DocImageView({ node, updateAttributes, selected, editor, deleteNode }: NodeViewProps) {
  const figureRef = useRef<HTMLElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const editable = editor.isEditable;
  const align = (node.attrs.align as Align) ?? "left";
  const width = normalizeWidth(node.attrs.width);
  const uploading = !!node.attrs.uploadId && !node.attrs.src;

  /**
   * Перетаскивание правого края. Слушатели вешаются на документ, а не на ручку:
   * курсор при быстром движении уходит с элемента, и события мыши до него
   * перестают доходить прямо посреди изменения размера.
   */
  const startResize = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      const figure = figureRef.current;
      if (!figure) return;
      const startX = event.clientX;
      const startWidth = figure.getBoundingClientRect().width;
      const maxWidth = figure.parentElement?.getBoundingClientRect().width ?? startWidth;
      setDragging(true);

      const onMove = (e: PointerEvent) => {
        const next = Math.round(
          Math.max(80, Math.min(maxWidth, startWidth + (e.clientX - startX))),
        );
        updateAttributes({ width: `${next}px` });
      };
      const onUp = () => {
        setDragging(false);
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [updateAttributes],
  );

  return (
    <NodeViewWrapper
      as="figure"
      ref={figureRef}
      data-image=""
      data-align={align}
      style={width ? { width } : undefined}
      className={cn("doc-image", selected && editable && "doc-image-selected")}
    >
      <div className="doc-image-frame">
        {/* Картинка из вставки ещё едет во вложения — показываем место, которое
            она займёт. Пустой <img> вместо этого выглядел бы как битая ссылка. */}
        {uploading ? (
          <span className="doc-image-loading">
            <Loader2 className="size-4 animate-spin" />
            Загрузка картинки…
          </span>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element -- вложение отдаёт наш роут, оптимизатор next/image к нему неприменим */
          <img
            src={(node.attrs.src as string) ?? ""}
            alt={(node.attrs.alt as string) || (node.attrs.caption as string) || ""}
            draggable={false}
          />
        )}
        {editable && !uploading && (
          <span
            className={cn("doc-image-handle", dragging && "doc-image-handle-active")}
            onPointerDown={startResize}
            role="separator"
            aria-label="Изменить размер"
          />
        )}
        {editable && selected && (
          <div className="doc-image-toolbar" contentEditable={false}>
            {(["25%", "50%", "100%"] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => updateAttributes({ width: preset })}
                className={cn("doc-image-btn", width === preset && "doc-image-btn-active")}
              >
                {preset}
              </button>
            ))}
            <span className="doc-image-sep" />
            {ALIGNMENTS.map((value) => {
              const Icon = value === "left" ? AlignLeft : value === "center" ? AlignCenter : AlignRight;
              return (
                <button
                  key={value}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => updateAttributes({ align: value })}
                  className={cn("doc-image-btn", align === value && "doc-image-btn-active")}
                  title={`Выровнять: ${value}`}
                >
                  <Icon className="size-3.5" />
                </button>
              );
            })}
            <span className="doc-image-sep" />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => deleteNode()}
              className="doc-image-btn"
              title="Удалить картинку"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        )}
      </div>
      {editable ? (
        <figcaption>
          <input
            value={(node.attrs.caption as string) ?? ""}
            onChange={(e) => updateAttributes({ caption: e.target.value })}
            placeholder="Подпись к изображению…"
            className="doc-image-caption-input"
          />
        </figcaption>
      ) : (
        node.attrs.caption ? <figcaption>{node.attrs.caption as string}</figcaption> : null
      )}
    </NodeViewWrapper>
  );
}
