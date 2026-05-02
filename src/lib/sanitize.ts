import sanitizeHtml from "sanitize-html";

// Allowlist tuned for Tiptap output: text formatting, headings, lists, links,
// images (uploaded to our own storage bucket), code blocks. No <script>, no
// inline event handlers, no <iframe>/<object>/<embed>, no javascript: URLs.
const TIPTAP_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr",
    "strong", "em", "u", "s", "code", "mark",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "blockquote", "pre",
    "a", "img",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title", "width", "height"],
    code: ["class"],
    pre: ["class"],
    "*": ["data-*"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: {
    img: ["http", "https", "data"],
  },
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        rel: "noopener noreferrer nofollow",
        target: attribs.target === "_blank" ? "_blank" : "_self",
      },
    }),
  },
};

export function sanitizeRichText(input: unknown): string {
  if (typeof input !== "string") return "";
  return sanitizeHtml(input, TIPTAP_OPTIONS);
}
