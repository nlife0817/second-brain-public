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

/**
 * Правка меток идёт одной транзакцией напрямую, без `chain()`.
 *
 * Команды Tiptap работают от текущего выделения, и цепочка из пар
 * «переставить курсор → сменить метку» на разорванном якоре срабатывает не
 * целиком: у закрытого треда подсветка так и оставалась прежней. Позиции здесь
 * посчитаны по тому же документу, который правим, и документ не меняется —
 * пересчитывать их между шагами не нужно.
 */
function editThreadMarks(
  editor: Editor,
  ranges: Range[],
  attrs: { threadId: string; resolved: boolean } | null,
): void {
  const markType = editor.state.schema.marks.docComment;
  if (!markType || !ranges.length) return;
  const { tr } = editor.state;
  for (const range of ranges) {
    tr.removeMark(range.from, range.to, markType);
    if (attrs) tr.addMark(range.from, range.to, markType.create(attrs));
  }
  editor.view.dispatch(tr);
}

/** Пометить выделение якорем нового треда. */
export function markSelectionAsThread(editor: Editor, threadId: string, range?: Range): void {
  const target = range ?? { from: editor.state.selection.from, to: editor.state.selection.to };
  if (target.from === target.to) return;
  editThreadMarks(editor, [target], { threadId, resolved: false });
}

/**
 * Перекрасить якорь закрытого треда. Метку не снимаем: обсуждение можно
 * переоткрыть, и без якоря оно вернулось бы «в никуда».
 */
export function setThreadResolvedInDoc(editor: Editor, threadId: string, resolved: boolean): void {
  editThreadMarks(editor, threadRanges(editor, threadId), { threadId, resolved });
}

/** Снять якорь: тред удалён, подсвечивать больше нечего. */
export function removeThreadFromDoc(editor: Editor, threadId: string): void {
  editThreadMarks(editor, threadRanges(editor, threadId), null);
}

/** Поставить курсор на якорь треда и подвести его в область видимости. */
export function scrollToThread(editor: Editor, threadId: string): void {
  const [first] = threadRanges(editor, threadId);
  if (!first) return;
  editor.chain().setTextSelection(first).scrollIntoView().run();
}

// Преобразование «многострочный текст → HTML» здесь больше не нужно:
// комментарии набирают в редакторе (CommentComposer), и он сразу отдаёт
// разметку. Ручная свёртка съедала бы @-упоминания.
