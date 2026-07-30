"use client";

// Оглавление документа: заголовки описания списком, клик — прокрутка к разделу.
// Живёт в той же панели, что и обсуждение (см. DocEditor), и переключается с ним
// вкладками: колонка одна, и делить её между двумя списками нечем.
//
// Заголовки читаются обходом самого документа, а не отдельным расширением:
// официальное TableOfContents у Tiptap лежит в платном Pro-реестре, а всё, что
// от него нужно здесь, — уровень, текст и позиция узла.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { List } from "lucide-react";
import { cn } from "@/lib/utils";

export interface OutlineItem {
  /** Позиция узла в документе: она же ключ строки и цель прокрутки. */
  pos: number;
  level: number;
  text: string;
}

/** Отступ от верхней кромки, на который встаёт заголовок при переходе к разделу. */
const HEADING_OFFSET_PX = 16;

/**
 * Черта, за которой раздел считается текущим. Заведомо ниже места приземления
 * заголовка: совпади они — после перехода подсвечивался бы предыдущий раздел,
 * потому что исход сравнения решала бы субпиксельная доля.
 */
const ACTIVE_EDGE_PX = 32;

/** Пауза между замерами текущего раздела при прокрутке. */
const MEASURE_DELAY_MS = 100;

/**
 * Заголовки документа сверху вниз. Пустые пропускаются: подписать такую строку
 * нечем, а появится она сама, как только в заголовок наберут текст.
 */
function readOutline(editor: Editor): OutlineItem[] {
  const items: OutlineItem[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return true;
    const text = node.textContent.trim();
    if (text) items.push({ pos, level: (node.attrs.level as number) || 1, text });
    // Внутри заголовка только текст — спускаться туда незачем.
    return false;
  });
  return items;
}

function signature(items: OutlineItem[]): string {
  return items.map((i) => `${i.pos}:${i.level}:${i.text}`).join("\n");
}

/** DOM-элемент заголовка. `null`, если позиция уже устарела — документ правят. */
function headingElement(editor: Editor, pos: number): HTMLElement | null {
  try {
    const dom = editor.view.nodeDOM(pos);
    return dom instanceof HTMLElement ? dom : null;
  } catch {
    return null;
  }
}

/**
 * Оглавление документа, живое.
 *
 * Подписка на редактор даёт только признак «документ изменился»: значение
 * селектора снимается с ещё не созданного редактора (`immediatelyRender: false`)
 * и обновится лишь следующей транзакцией, которой может не случиться вовсе —
 * поэтому сам список всегда пересчитывается здесь, из живого состояния. Та же
 * ловушка описана у `signals` в DocEditor.
 *
 * Подпись включает позиции: по ним идёт прокрутка, и сдвиг заголовка вниз —
 * такое же изменение оглавления, как переименование раздела.
 */
export function useDocOutline(editor: Editor | null): OutlineItem[] {
  const version = useEditorState({
    editor,
    // Строка, а не массив: результат селектора сравнивается по значению.
    selector: ({ editor: e }) => (e ? signature(readOutline(e)) : ""),
  });
  return useMemo(() => {
    // Подпись только сцепляет пересчёт с изменением документа — само значение
    // читать нельзя, оно может быть снято с ещё не созданного редактора.
    void version;
    return editor ? readOutline(editor) : [];
  }, [editor, version]);
}

/**
 * Раздел, на котором стоит чтение: последний заголовок, ушедший за верхнюю
 * кромку колонки. Считается по живым прямоугольникам, а не по накопленным
 * высотам — иначе картинки и таблицы, меняющие высоту после загрузки, сбивали бы
 * счёт.
 */
function useActiveHeading(
  editor: Editor | null,
  items: OutlineItem[],
  scrollHost: HTMLElement | null,
): number | null {
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    if (!editor || !scrollHost || items.length === 0) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const measure = () => {
      timer = null;
      const edge = scrollHost.getBoundingClientRect().top + ACTIVE_EDGE_PX;
      // До первого заголовка активным считаем его же: подсветка не должна
      // пропадать, пока читают вступление.
      let current = items[0].pos;
      for (const item of items) {
        const el = headingElement(editor, item.pos);
        if (!el) continue;
        if (el.getBoundingClientRect().top > edge) break;
        current = item.pos;
      }
      setActive(current);
    };

    // Хвостовой таймер, а не requestAnimationFrame: прокрутка сыплет событиями
    // чаще, чем нужен замер, но привязывать его к кадру незачем — подсветка
    // отстаёт от текста на долю секунды и никого не догоняет. Первый замер тоже
    // таймером: состояние прямо из тела эффекта — лишний каскад рендеров.
    const schedule = () => {
      if (!timer) timer = setTimeout(measure, MEASURE_DELAY_MS);
    };

    schedule();
    scrollHost.addEventListener("scroll", schedule, { passive: true });
    return () => {
      scrollHost.removeEventListener("scroll", schedule);
      if (timer) clearTimeout(timer);
    };
    // Список заголовков пересобирается только вместе с документом — подписка
    // переезжает ровно тогда же.
  }, [editor, scrollHost, items]);

  return active;
}

export function DocOutline({
  editor,
  items,
  scrollHost,
  tabs,
}: {
  editor: Editor | null;
  items: OutlineItem[];
  /** Прокручиваемая колонка документа: по ней и текущий раздел, и переход к нему. */
  scrollHost: HTMLElement | null;
  /** Переключатель панелей. Без него панель подписывает себя сама. */
  tabs?: ReactNode;
}) {
  const active = useActiveHeading(editor, items, scrollHost);
  // Вложенность считается от самого крупного заголовка в документе: описание,
  // начатое с h2, не должно выглядеть сдвинутым целиком.
  const topLevel = items.length ? Math.min(...items.map((i) => i.level)) : 1;

  function goTo(item: OutlineItem) {
    if (!editor) return;
    const el = headingElement(editor, item.pos);
    // Прокрутка, а не установка каретки: оглавление — навигация по чтению, и
    // курсор из текста здесь уводить незачем.
    if (el && scrollHost) {
      const top =
        scrollHost.scrollTop +
        el.getBoundingClientRect().top -
        scrollHost.getBoundingClientRect().top -
        HEADING_OFFSET_PX;
      scrollHost.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      return;
    }
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    // Позиция устарела (документ правили прямо сейчас) — доверяем редактору.
    editor.chain().setTextSelection(item.pos + 1).scrollIntoView().run();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        {tabs ?? (
          <>
            <List className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Оглавление</span>
            <span className="text-xs text-muted-foreground">{items.length}</span>
          </>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {items.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            Разметьте текст заголовками — здесь появится оглавление.
          </p>
        ) : (
          items.map((item) => (
            <button
              key={item.pos}
              onClick={() => goTo(item)}
              // Отступ инлайном: уровней шесть, и класс на каждый Tailwind в
              // сборку не положит — он видит только литералы в разметке.
              style={{ paddingInlineStart: 8 + (item.level - topLevel) * 12 }}
              className={cn(
                "rounded-md py-1 pe-2 text-left text-xs leading-snug transition-colors",
                item.level === topLevel && "font-medium",
                active === item.pos
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {item.text}
            </button>
          ))
        )}
      </nav>
    </div>
  );
}
