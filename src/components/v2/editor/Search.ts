"use client";

// Расширение редактора: поиск по тексту описания.
//
// Зачем свой поиск, когда есть Ctrl+F браузера: описание в развёрнутом режиме —
// документ на несколько экранов, и по нему нужен не только подсвеченный текст, а
// счётчик совпадений и переход между ними, не уводящий каретку из документа.
// Готовое расширение у Tiptap лежит в платном Pro-реестре (та же история, что с
// оглавлением в DocOutline), а нужны отсюда только позиции подстроки.
//
// Совпадения ищутся по текстовым блокам, а не по всему документу разом: строка
// не должна склеиваться через границу абзаца, иначе «конец начало» находилось бы
// там, где в тексте два разных абзаца.

import { Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Editor } from "@tiptap/react";

export interface SearchMatch {
  from: number;
  to: number;
}

interface SearchState {
  query: string;
  caseSensitive: boolean;
  matches: SearchMatch[];
  /** Номер текущего совпадения; `-1` — искать нечего или ничего не нашлось. */
  index: number;
  decorations: DecorationSet;
}

/** Что меняем: строку, регистр или текущее совпадение (шагом по списку). */
interface SearchMeta {
  query?: string;
  caseSensitive?: boolean;
  step?: number;
}

const docSearchKey = new PluginKey<SearchState>("docSearch");

const IDLE: SearchState = {
  query: "",
  caseSensitive: false,
  matches: [],
  index: -1,
  decorations: DecorationSet.empty,
};

/**
 * Позиции подстроки в документе, сверху вниз.
 *
 * Текст блока снимается `textBetween` с заглушкой в один символ на каждый
 * нетекстовый лист (упоминание, перенос строки): лист занимает ровно одну
 * позицию, поэтому смещения в строке совпадают с позициями в документе, и
 * найденное место не съезжает.
 */
export function findMatches(
  doc: ProseMirrorNode,
  query: string,
  caseSensitive: boolean,
): SearchMatch[] {
  const needle = caseSensitive ? query : query.toLowerCase();
  if (!needle) return [];

  const matches: SearchMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textBetween(0, node.content.size, undefined, " ");
    const haystack = caseSensitive ? text : text.toLowerCase();
    let at = haystack.indexOf(needle);
    while (at !== -1) {
      const from = pos + 1 + at;
      matches.push({ from, to: from + needle.length });
      // Следующее совпадение ищем за концом текущего: перекрывающиеся вхождения
      // («аа» в «ааа») подсветить одной разметкой всё равно нечем.
      at = haystack.indexOf(needle, at + needle.length);
    }
    // Внутри текстового блока только текст — спускаться туда незачем.
    return false;
  });
  return matches;
}

function buildDecorations(
  doc: ProseMirrorNode,
  matches: SearchMatch[],
  index: number,
): DecorationSet {
  return DecorationSet.create(
    doc,
    matches.map((match, i) =>
      Decoration.inline(match.from, match.to, {
        class: i === index ? "doc-search-hit doc-search-hit-current" : "doc-search-hit",
      }),
    ),
  );
}

/** Номер в границах списка, по кругу: с последнего совпадения «дальше» ведёт на первое. */
function wrap(index: number, total: number): number {
  if (total === 0) return -1;
  return ((index % total) + total) % total;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    docSearch: {
      /** Задать строку поиска. Пустая строка снимает подсветку. */
      setDocSearch: (query: string, caseSensitive?: boolean) => ReturnType;
      /** Перейти на `step` совпадений вперёд (или назад при отрицательном шаге). */
      stepDocSearch: (step: number) => ReturnType;
      /** Закончить поиск: подсветка снимается, документ не трогается. */
      clearDocSearch: () => ReturnType;
    };
  }
}

export const DocSearch = Extension.create({
  name: "docSearch",

  addCommands() {
    // Транзакция без шагов: поиск ничего не правит, поэтому и в историю правок
    // не попадает, и автосохранение (оно смотрит на `docChanged`) не будит.
    const send =
      (meta: SearchMeta) =>
      ({ tr, dispatch }: { tr: Transaction; dispatch?: (tr: Transaction) => void }) => {
        dispatch?.(tr.setMeta(docSearchKey, meta));
        return true;
      };

    return {
      setDocSearch: (query, caseSensitive) => send({ query, caseSensitive }),
      stepDocSearch: (step) => send({ step }),
      clearDocSearch: () => send({ query: "" }),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: docSearchKey,

        state: {
          init: () => IDLE,

          apply(tr, prev) {
            const meta = tr.getMeta(docSearchKey) as SearchMeta | undefined;
            // Ни указаний, ни правок — считать нечего, позиции прежние.
            if (!meta && !tr.docChanged) return prev;

            const query = meta?.query ?? prev.query;
            const caseSensitive = meta?.caseSensitive ?? prev.caseSensitive;
            if (!query) return { ...IDLE, caseSensitive };

            const sameQuery = query === prev.query && caseSensitive === prev.caseSensitive;
            const matches =
              sameQuery && !tr.docChanged ? prev.matches : findMatches(tr.doc, query, caseSensitive);

            let index: number;
            if (meta?.step !== undefined) index = prev.index + meta.step;
            else if (!sameQuery) index = 0;
            else if (tr.docChanged && prev.matches[prev.index]) {
              // Текст правят прямо во время поиска: держимся того же места, а не
              // номера — вставленный выше абзац сдвинул бы нумерацию, и «текущим»
              // молча стало бы соседнее совпадение.
              const anchor = tr.mapping.map(prev.matches[prev.index].from);
              const at = matches.findIndex((m) => m.from >= anchor);
              index = at === -1 ? matches.length - 1 : at;
            } else index = prev.index;

            index = wrap(index, matches.length);
            return {
              query,
              caseSensitive,
              matches,
              index,
              decorations: buildDecorations(tr.doc, matches, index),
            };
          },
        },

        props: {
          decorations(state) {
            return docSearchKey.getState(state)?.decorations ?? null;
          },
        },
      }),
    ];
  },
});

export interface DocSearchStatus {
  query: string;
  caseSensitive: boolean;
  total: number;
  /** Номер текущего совпадения с единицы (для подписи); `0` — совпадений нет. */
  current: number;
  /** Текущее совпадение или `null`: по нему идёт прокрутка. */
  match: SearchMatch | null;
}

/**
 * Состояние поиска для интерфейса. Читается из живого редактора, а не из
 * подписки: на первом рендере редактора ещё нет (`immediatelyRender: false`) —
 * та же ловушка, что описана у `signals` в DocEditor.
 */
export function readDocSearch(editor: Editor | null): DocSearchStatus {
  const state = editor && !editor.isDestroyed ? docSearchKey.getState(editor.state) : undefined;
  if (!state) return { query: "", caseSensitive: false, total: 0, current: 0, match: null };
  return {
    query: state.query,
    caseSensitive: state.caseSensitive,
    total: state.matches.length,
    current: state.index + 1,
    match: state.matches[state.index] ?? null,
  };
}

/** Признак «поиск изменился» для подписки: строка, чтобы сравнивалось по значению. */
export function docSearchSignal(editor: Editor | null): string {
  const state = editor ? docSearchKey.getState(editor.state) : undefined;
  return state ? `${state.query}|${state.caseSensitive}|${state.index}/${state.matches.length}` : "";
}
