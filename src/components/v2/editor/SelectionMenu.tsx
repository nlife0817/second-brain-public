"use client";

// Меню действий над выделенным фрагментом. Панель инструментов стоит наверху и
// при чтении длинного документа уезжает с экрана: до неё нужно доскроллить,
// удерживая выделение. Здесь те же команды приходят к тексту сами.
//
// Компонент создаёт свой DOM-узел прямо в рендере (так устроен BubbleMenu),
// поэтому монтировать его можно только когда редактор уже есть: на сервере
// `useEditor({ immediatelyRender: false })` отдаёт null, и этой проверки
// достаточно.

import { useCallback, useMemo } from "react";
import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import { useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  Bold,
  Code,
  Italic,
  Link2,
  MessageSquarePlus,
  Strikethrough,
  Underline as UnderlineIcon,
} from "lucide-react";
import { promptForLink } from "./link";
import { Divider, ToolButton } from "./Toolbar";

/**
 * Ближайший прокручиваемый предок, считая сам элемент.
 *
 * Меню позиционируется `fixed` (см. `options` ниже), то есть в координатах
 * окна: без подписки на прокрутку своего контейнера оно зависло бы на месте,
 * пока текст под ним уезжает.
 */
function scrollParentOf(el: HTMLElement | null | undefined): HTMLElement | undefined {
  for (let node: HTMLElement | null = el ?? null; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return undefined;
}

/**
 * Меню вешается в body, а не в родителя редактора: тот лежит внутри области
 * прокрутки, и её кромка обрезала бы меню у верхней строки выделения.
 *
 * Функция вынесена из рендера намеренно: на смену её ссылки BubbleMenu шлёт в
 * редактор транзакцию, то есть новая стрелка на каждый рендер — это лишняя
 * транзакция на каждый рендер.
 */
const appendToBody = () => document.body;

export interface SelectionMenuProps {
  editor: Editor;
  /**
   * Любой элемент внутри области прокрутки — сам контейнер ищется от него
   * вверх. У карточки задачи прокручивается оболочка, до которой редактору не
   * дотянуться, поэтому передаётся не сам контейнер, а точка отсчёта.
   */
  scrollHost?: HTMLElement | null;
  /** Обсуждение к фрагменту умеет заводить только развёрнутый режим. */
  onComment?: () => void;
}

export function SelectionMenu({ editor, scrollHost, onComment }: SelectionMenuProps) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      link: e.isActive("link"),
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
    }),
  });

  const shouldShow = useCallback(
    ({
      editor: e,
      state: s,
      from,
      to,
    }: {
      editor: Editor;
      state: EditorState;
      from: number;
      to: number;
    }) => {
      if (!e.isEditable || s.selection.empty) return false;
      // Выделение бывает непустым и без единой буквы — например, когда охвачен
      // только блок вложения. Форматировать там нечего.
      if (!s.doc.textBetween(from, to, " ").trim()) return false;
      // У картинки своя панель поверх неё, у блока кода форматирование текста
      // не имеет смысла.
      return !e.isActive("docImage") && !e.isActive("codeBlock");
    },
    [],
  );

  // Ссылка обязана быть стабильной: на смену `options` BubbleMenu шлёт в
  // редактор транзакцию, а транзакция будит всех подписчиков состояния. Новый
  // объект на каждый рендер означал бы транзакцию на каждый рендер.
  const options = useMemo(
    () =>
      ({
        // `fixed` в паре с appendTo=body: меню вешается вне редактора, иначе
        // кромка прокрутки карточки его обрезает.
        strategy: "fixed" as const,
        placement: "top" as const,
        offset: 8,
        scrollTarget: scrollParentOf(scrollHost),
      }),
    [scrollHost],
  );

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="docSelectionMenu"
      shouldShow={shouldShow}
      appendTo={appendToBody}
      options={options}
      // Слои: лист карточки z-50, развёрнутый документ z-[60].
      className="z-[70] flex items-center gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-lg"
    >
      <ToolButton title="Полужирный" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="size-4" />
      </ToolButton>
      <ToolButton title="Курсив" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="size-4" />
      </ToolButton>
      <ToolButton
        title="Подчёркнутый"
        active={state.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="size-4" />
      </ToolButton>
      <ToolButton title="Зачёркнутый" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className="size-4" />
      </ToolButton>
      <ToolButton title="Моноширинный" active={state.code} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code className="size-4" />
      </ToolButton>
      <ToolButton title="Ссылка" active={state.link} onClick={() => promptForLink(editor)}>
        <Link2 className="size-4" />
      </ToolButton>

      <Divider />

      {([1, 2, 3] as const).map((level) => (
        <ToolButton
          key={level}
          title={`Заголовок ${level}`}
          active={level === 1 ? state.h1 : level === 2 ? state.h2 : state.h3}
          onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
        >
          <span className="text-xs font-semibold">H{level}</span>
        </ToolButton>
      ))}

      {onComment && (
        <>
          <Divider />
          <ToolButton title="Комментировать" onClick={onComment}>
            <MessageSquarePlus className="size-4" />
          </ToolButton>
        </>
      )}
    </BubbleMenu>
  );
}
