import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * Якорь комментария к фрагменту описания.
 *
 * В разметке это `<span data-comment="<id треда>">`, где id совпадает с
 * core.doc_comments.thread_id. Разметка — единственная связь текста с панелью
 * комментариев: по ней подсвечивается фрагмент и по ней же клик по тексту
 * находит нужный тред.
 *
 * `inclusive: false` — иначе набор текста сразу за помеченным фрагментом
 * молча расширял бы область комментария.
 */
export const CommentMark = Mark.create({
  name: "docComment",
  inclusive: false,
  // Комментарий может лежать поверх ссылки или жирного текста, и наоборот.
  excludes: "",

  addAttributes() {
    return {
      threadId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-comment"),
        renderHTML: (attributes) =>
          attributes.threadId ? { "data-comment": attributes.threadId as string } : {},
      },
      /**
       * Закрытые треды остаются в тексте без подсветки: убирать их из разметки
       * значило бы терять возможность переоткрыть обсуждение на том же месте.
       */
      resolved: {
        default: false,
        parseHTML: (element) => element.getAttribute("data-comment-resolved") === "true",
        renderHTML: (attributes) =>
          attributes.resolved ? { "data-comment-resolved": "true" } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-comment]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "doc-comment-anchor" }), 0];
  },
});
