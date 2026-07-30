import sanitizeHtml from "sanitize-html";

// Allowlist tuned for Tiptap output: text formatting, headings, lists, links,
// images (served from our own /api/v2/.../attachments route), code blocks,
// tables, two-column layouts and inline comment anchors. No <script>, no inline
// event handlers, no <iframe>/<object>/<embed>, no javascript: URLs.
//
// Structural tags below mirror the editor extensions in components/v2/editor:
// dropping one of them here silently strips that block from every description
// the moment it is saved.
const TIPTAP_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr", "span", "div",
    "strong", "em", "u", "s", "code", "mark",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "blockquote", "pre",
    "a", "img", "figure", "figcaption",
    "table", "colgroup", "col", "thead", "tbody", "tr", "td", "th",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height", "style"],
    figure: ["style"],
    // colwidth — как его пишет расширение таблиц Tiptap (список ширин колонок).
    td: ["colspan", "rowspan", "colwidth", "style"],
    th: ["colspan", "rowspan", "colwidth", "style"],
    col: ["style", "span"],
    table: ["style"],
    p: ["style"],
    h1: ["style"], h2: ["style"], h3: ["style"],
    h4: ["style"], h5: ["style"], h6: ["style"],
    code: ["class"],
    pre: ["class"],
    "*": ["data-*"],
  },
  // Только геометрия и выключка: без этого не переживут ширина картинки,
  // ширина колонки таблицы и выравнивание абзаца.
  allowedStyles: {
    "*": {
      width: [/^\d+(?:\.\d+)?(?:px|%)$/],
      height: [/^\d+(?:\.\d+)?(?:px|%)$/],
      "min-width": [/^\d+(?:\.\d+)?(?:px|%)$/],
      "max-width": [/^\d+(?:\.\d+)?(?:px|%)$/],
      "text-align": [/^(?:left|right|center|justify)$/],
      "background-color": [/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i],
    },
  },
  allowedSchemes: ["http", "https", "mailto"],
  // Свои вложения приезжают относительной ссылкой на роут отдачи файла, и
  // редактор картинок в base64 не делает. `data:` оставлен ради унаследованных
  // описаний: одно из них несёт вставленный когда-то PNG прямо в разметке, и
  // без этой строки картинка исчезла бы при первом же сохранении задачи.
  // Скрипты внутри такого источника браузер не исполняет — `<img>` рисует
  // картинку, а не документ.
  allowedSchemesByTag: {
    img: ["http", "https", "data"],
  },
  transformTags: {
    // Ссылка из описания или комментария всегда уходит в новую вкладку: переход
    // в текущей уносил бы из приложения вместе с несохранёнными правками. Своё
    // значение `target` не сохраняем — прежний `_self` в чужой разметке как раз
    // и означал переход поверх приложения.
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        rel: "noopener noreferrer nofollow",
        target: "_blank",
      },
    }),
  },
};

export function sanitizeRichText(input: unknown): string {
  if (typeof input !== "string") return "";
  return sanitizeHtml(input, TIPTAP_OPTIONS);
}
