"use client";

// Строка поиска по описанию: она открывается над документом в развёрнутом
// режиме (см. DocEditor) и правит только подсветку, которую рисует расширение
// DocSearch.
//
// Состояние строки живёт в DocEditor, а не здесь: панель закрывается и
// открывается заново, а набранный запрос должен пережить это закрытие — иначе
// вернуться к поиску после прокрутки документа значило бы набрать его заново.

import { useEffect, useRef } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import { CaseSensitive, ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { docSearchSignal, readDocSearch } from "./Search";

/** Доля высоты колонки, на которой встаёт найденный фрагмент при переходе к нему. */
const LANDING_RATIO = 0.35;

/** Отступ от кромок колонки, внутри которых совпадение считается уже видимым. */
const VISIBLE_PAD_PX = 24;

export interface DocSearchValue {
  query: string;
  caseSensitive: boolean;
}

export const EMPTY_SEARCH: DocSearchValue = { query: "", caseSensitive: false };

export function DocSearchBar({
  editor,
  scrollHost,
  value,
  onChange,
  onClose,
  focusSignal,
}: {
  editor: Editor | null;
  /** Прокручиваемая колонка документа: по ней идёт переход к совпадению. */
  scrollHost: HTMLElement | null;
  value: DocSearchValue;
  onChange: (next: DocSearchValue) => void;
  onClose: () => void;
  /**
   * Счётчик запросов фокуса. Повторный Ctrl+F при открытой строке должен
   * возвращать курсор в поле и выделять набранное — а состояние при этом не
   * меняется, и обычным пропом такой запрос не передать.
   */
  focusSignal: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Подписка даёт только перерисовку; сами значения читаются из живого
  // редактора — на первом рендере его ещё нет (`immediatelyRender: false`), и
  // значение селектора было бы снято с пустоты. Та же ловушка описана у
  // `signals` в DocEditor.
  const signal = useEditorState({ editor, selector: ({ editor: e }) => docSearchSignal(e) });
  const status = readDocSearch(editor);

  // Запрос уходит в редактор эффектом, а не из обработчика ввода: строку
  // открывают с уже набранным запросом, и подсветка обязана появиться сразу.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setDocSearch(value.query, value.caseSensitive);
  }, [editor, value.query, value.caseSensitive]);

  // Строку закрыли — подсветка уходит вместе с ней. Запрос при этом остаётся у
  // DocEditor: его сотрёт только сам пользователь.
  useEffect(() => {
    return () => {
      if (editor && !editor.isDestroyed) editor.commands.clearDocSearch();
    };
  }, [editor]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSignal]);

  // Переход к текущему совпадению. Прокручиваем колонку, а не ставим каретку:
  // документ бывает нередактируемым, а в редактируемом курсор из текста уводить
  // незачем — после поиска правку продолжают с того же места.
  useEffect(() => {
    if (!editor || editor.isDestroyed || !scrollHost) return;
    const { match } = readDocSearch(editor);
    if (!match) return;
    let coords: { top: number; bottom: number };
    try {
      coords = editor.view.coordsAtPos(match.from);
    } catch {
      // Позиция устарела — документ правят прямо сейчас; следующая транзакция
      // пересчитает совпадения и вернёт нас сюда.
      return;
    }
    const host = scrollHost.getBoundingClientRect();
    // Уже на экране — не дёргаем текст: при наборе запроса совпадения находятся
    // одно за другим, и прокрутка на каждый символ мешала бы читать.
    if (coords.top >= host.top + VISIBLE_PAD_PX && coords.bottom <= host.bottom - VISIBLE_PAD_PX) {
      return;
    }
    const top =
      scrollHost.scrollTop + coords.top - host.top - scrollHost.clientHeight * LANDING_RATIO;
    scrollHost.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    // signal — признак того, что текущее совпадение сменилось (номер, запрос или
    // регистр); сами позиции читаются выше, из живого редактора.
  }, [editor, scrollHost, signal]);

  function step(delta: number) {
    if (!editor || editor.isDestroyed || status.total === 0) return;
    editor.commands.stepDocSearch(delta);
  }

  const label = status.total > 0 ? `${status.current}/${status.total}` : value.query ? "0" : "";

  return (
    <div className="flex items-center gap-1 border-b border-border px-3 py-1.5 sm:px-4">
      <Search className="size-4 shrink-0 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={value.query}
        onChange={(e) => onChange({ ...value, query: e.target.value })}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          // Enter внутри строки поиска — переход к следующему совпадению, а не
          // отправка формы: строка стоит внутри слоя документа.
          e.preventDefault();
          step(e.shiftKey ? -1 : 1);
        }}
        placeholder="Найти в описании…"
        aria-label="Найти в описании"
        className="h-8 w-full max-w-64"
      />
      <span
        // Ненайденный запрос подсвечен как ошибка, пустой не подписывается вовсе.
        className={cn(
          "min-w-8 shrink-0 text-center text-xs tabular-nums",
          status.total === 0 && value.query ? "text-destructive" : "text-muted-foreground",
        )}
        title={status.total > 0 ? `Совпадение ${status.current} из ${status.total}` : undefined}
      >
        {label}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => step(-1)}
        disabled={status.total === 0}
        title="Предыдущее совпадение (Shift+Enter)"
        aria-label="Предыдущее совпадение"
      >
        <ChevronUp />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => step(1)}
        disabled={status.total === 0}
        title="Следующее совпадение (Enter)"
        aria-label="Следующее совпадение"
      >
        <ChevronDown />
      </Button>
      <Button
        variant={value.caseSensitive ? "secondary" : "ghost"}
        size="icon-sm"
        onClick={() => onChange({ ...value, caseSensitive: !value.caseSensitive })}
        title="Учитывать регистр"
        aria-label="Учитывать регистр"
        aria-pressed={value.caseSensitive}
      >
        <CaseSensitive />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClose}
        title="Закрыть поиск (Esc)"
        aria-label="Закрыть поиск"
        className="ms-auto"
      >
        <X />
      </Button>
    </div>
  );
}
