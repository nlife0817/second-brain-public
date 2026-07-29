"use client";

// Работа с якорями комментариев в самом документе. Панель обсуждения знает
// только id треда — превратить его в диапазон текста (и обратно) можно лишь
// пройдя по документу, поэтому все такие обходы собраны здесь.

import type { Editor } from "@tiptap/core";

type Range = { from: number; to: number };

/** Диапазоны текста, помеченные этим тредом. Тред может быть разорван правкой. */
export function threadRanges(editor: Editor, threadId: string): Range[] {
  const markType = editor.state.schema.marks.docComment;
  if (!markType) return [];
  const ranges: Range[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const hit = node.marks.some(
      (mark) => mark.type === markType && mark.attrs.threadId === threadId,
    );
    if (!hit) return;
    const last = ranges[ranges.length - 1];
    // Соседние текстовые узлы (разное форматирование внутри одного якоря)
    // склеиваем: иначе подсветка и прокрутка работают по обрывкам.
    if (last && last.to === pos) last.to = pos + node.nodeSize;
    else ranges.push({ from: pos, to: pos + node.nodeSize });
  });
  return ranges;
}

/** Все треды, у которых остался якорь в тексте. */
export function anchoredThreadIds(editor: Editor): Set<string> {
  const markType = editor.state.schema.marks.docComment;
  const ids = new Set<string>();
  if (!markType) return ids;
  editor.state.doc.descendants((node) => {
    for (const mark of node.marks) {
      if (mark.type === markType && mark.attrs.threadId) ids.add(mark.attrs.threadId as string);
    }
  });
  return ids;
}

/** Пометить текущее выделение якорем нового треда. */
export function markSelectionAsThread(editor: Editor, threadId: string, range?: Range): void {
  const chain = editor.chain().focus();
  if (range) chain.setTextSelection(range);
  chain.setMark("docComment", { threadId, resolved: false }).run();
}

/**
 * Перекрасить якорь закрытого треда. Метку не снимаем: обсуждение можно
 * переоткрыть, и без якоря оно вернулось бы «в никуда».
 */
export function setThreadResolvedInDoc(editor: Editor, threadId: string, resolved: boolean): void {
  const ranges = threadRanges(editor, threadId);
  if (!ranges.length) return;
  const chain = editor.chain();
  for (const range of ranges) {
    chain.setTextSelection(range).setMark("docComment", { threadId, resolved });
  }
  chain.run();
}

/** Снять якорь: тред удалён, подсвечивать больше нечего. */
export function removeThreadFromDoc(editor: Editor, threadId: string): void {
  const ranges = threadRanges(editor, threadId);
  if (!ranges.length) return;
  const chain = editor.chain();
  for (const range of ranges) {
    chain.setTextSelection(range).unsetMark("docComment");
  }
  chain.run();
}

/** Поставить курсор на якорь треда и подвести его в область видимости. */
export function scrollToThread(editor: Editor, threadId: string): void {
  const [first] = threadRanges(editor, threadId);
  if (!first) return;
  editor.chain().setTextSelection(first).scrollIntoView().run();
}

/** Многострочный ввод → HTML: иначе переносы строк теряются при рендере. */
export function textToHtml(text: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .split(/\n{2,}/)
    .map((block) => `<p>${block.split("\n").map(escape).join("<br>")}</p>`)
    .join("");
}
