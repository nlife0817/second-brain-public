"use client";

// Полноэкранный режим описания: документ по центру, панель справа.
//
// Зачем отдельный слой, а не поле пошире: описание в карточке — узкая колонка
// рядом с полями задачи, и читать в ней документ на несколько экранов нельзя.
// Здесь та же разметка получает ширину страницы, полную панель инструментов и
// комментарии к фрагментам текста.
//
// Правая панель одна на два списка — обсуждение и оглавление, — и они меняются
// местами вкладками: вторая колонка в 320 px отняла бы ширину у самого текста,
// ради которой этот режим и заведён.

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { EditorContent } from "@tiptap/react";
import { List, Loader2, MessageSquare, Minimize2, Search, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DocCommentThread, UserBrief } from "@/lib/core/types";
import { useBackDismiss } from "@/components/v2/mobile/hooks";
import { cn } from "@/lib/utils";
import { CommentPanel } from "./CommentPanel";
import { DocOutline, useDocOutline } from "./DocOutline";
import { DocxDownloadButton } from "./DocxButton";
import { DocSaveButton } from "./SaveButton";
import type { DocOwner } from "./owner";
import { useDocThreads } from "./use-doc-threads";
import { DocSearchBar, EMPTY_SEARCH, type DocSearchValue } from "./SearchBar";
import { SelectionMenu } from "./SelectionMenu";
import { EditorToolbar } from "./Toolbar";
import { useDocEditor, type UseDocEditorOptions } from "./useDocEditor";
import { fileDropHint, useFileDrop } from "./useFileDrop";

/** Вкладка панели. Подпись прячется только при совсем узкой панели — иконки хватает. */
function PanelTabButton({
  icon: Icon,
  label,
  count = 0,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "flex min-w-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
      {count > 0 && <span className="shrink-0 text-muted-foreground">{count}</span>}
    </button>
  );
}

export interface DocEditorProps {
  open: boolean;
  onClose: () => void;
  orgId: string | null;
  /** Владелец текста: задача или документ базы знаний. */
  owner: DocOwner | null;
  /** Заголовок над документом — название задачи или документа. */
  taskTitle: string;
  value: string;
  /** `false` — сохранить не удалось; см. `UseDocEditorOptions.onSave`. */
  onSave: UseDocEditorOptions["onSave"];
  editable: boolean;
  canComment: boolean;
  me: UserBrief | null;
  /** Треды приезжают вместе с карточкой — открытие документа не ждёт запроса. */
  initialThreads: DocCommentThread[];
  /** Право закрывать чужие обсуждения (то же, что право править задачу). */
  canResolveAll: boolean;
}

/** Что показывает правая панель. */
type PanelTab = "comments" | "outline";

export function DocEditor({
  open,
  onClose,
  orgId,
  owner,
  taskTitle,
  value,
  onSave,
  editable,
  canComment,
  me,
  initialThreads,
  canResolveAll,
}: DocEditorProps) {
  const [railOpen, setRailOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("comments");
  /** Ошибка оболочки (выгрузка в .docx); ошибки обсуждений живут в хуке. */
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  // Запрос живёт здесь, а не в самой строке: она размонтируется при закрытии, а
  // набранное должно пережить это — см. комментарий в SearchBar.
  const [search, setSearch] = useState<DocSearchValue>(EMPTY_SEARCH);
  const [searchFocus, setSearchFocus] = useState(0);

  const doc = useDocEditor({
    value,
    onSave,
    orgId,
    owner,
    editable,
    placeholder: "Описание задачи…",
  });
  const editor = doc.editor;

  const canUpload = editable && !!orgId && !!owner;
  const drop = useFileDrop({
    enabled: canUpload,
    onFiles: (files) => void doc.uploadFiles(files),
  });
  // Меню по выделению стоит `fixed` и обязано ехать вместе с текстом: без
  // ссылки на прокручиваемую колонку оно зависало бы на месте.
  const [scrollHost, setScrollHost] = useState<HTMLElement | null>(null);

  const comments = useDocThreads({
    orgId,
    owner,
    editor,
    initialThreads,
    flush: doc.flush,
  });

  useBackDismiss(open, onClose);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    // Повторный Ctrl+F при открытой строке возвращает курсор в поле.
    setSearchFocus((n) => n + 1);
  }, []);

  // Слой закрыли — закрывается и поиск. Сам запрос остаётся: тот же документ
  // часто открывают снова, чтобы продолжить с того же места.
  //
  // Подстройка под изменившийся вход идёт в рендере, а не эффектом: эффект
  // здесь — лишний проход отрисовки со строкой поиска, которую тут же убирают.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) setSearchOpen(false);
  }

  const { draft, cancelDraft, startDraft: beginDraft, activeThreadId } = comments;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Клавиша по `code`, а не по `key`: на русской раскладке Ctrl+F даёт
      // `key === "а"`, и поиск бы не открывался.
      if (e.code === "KeyF" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        // Поиск браузера здесь бесполезен: он не считает совпадения и не умеет
        // переходить по ним внутри прокручиваемой колонки документа.
        e.preventDefault();
        openSearch();
        return;
      }
      if (e.key === "Escape") {
        // Esc снимает по одному слою: сначала черновик комментария, потом
        // поиск, и только потом весь документ — иначе случайное нажатие уносит
        // и набранный текст.
        if (draft) cancelDraft();
        else if (searchOpen) setSearchOpen(false);
        else onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, draft, cancelDraft, searchOpen, openSearch, onClose]);

  const outline = useDocOutline(editor);
  // Вкладка выводится, а не хранится: последний заголовок могли удалить прямо
  // сейчас, и панель, оставшаяся на оглавлении, показывала бы пустоту.
  const tab: PanelTab = outline.length > 0 ? panelTab : "comments";

  // Курсор встал на якорь обсуждения — панель обязана показывать обсуждение,
  // иначе клик по подсвеченному фрагменту ни к чему не приводит. Обратно на
  // оглавление уводит только сам пользователь: смена вкладки этот переход не
  // перезапускает. Сравнение с прошлым значением в рендере — по той же причине,
  // что и у поиска выше.
  const [lastThreadId, setLastThreadId] = useState(activeThreadId);
  if (lastThreadId !== activeThreadId) {
    setLastThreadId(activeThreadId);
    if (activeThreadId) setPanelTab("comments");
  }

  // Черновик набирают в панели — она должна быть и открыта, и на обсуждении.
  const startDraft = useCallback(() => {
    beginDraft();
    setPanelTab("comments");
    setRailOpen(true);
  }, [beginDraft]);

  if (!open || typeof document === "undefined") return null;

  const openThreadCount = comments.threads.filter((t) => !t.resolved_at).length;
  const hasOutline = outline.length > 0;

  /**
   * Кнопка панели на узком экране: панель там выезжает поверх текста, поэтому
   * повторное нажатие по открытой вкладке её закрывает.
   */
  function toggleRail(next: PanelTab) {
    if (railOpen && tab === next) {
      setRailOpen(false);
      return;
    }
    setPanelTab(next);
    setRailOpen(true);
  }

  // Переключатель рисуется только когда есть что переключать: без заголовков
  // панель остаётся обсуждением и подписывает себя сама.
  const tabs = hasOutline ? (
    <div className="flex min-w-0 items-center gap-0.5 rounded-lg bg-muted p-0.5">
      <PanelTabButton
        icon={MessageSquare}
        label="Обсуждение"
        count={openThreadCount}
        active={tab === "comments"}
        onClick={() => setPanelTab("comments")}
      />
      <PanelTabButton
        icon={List}
        label="Оглавление"
        active={tab === "outline"}
        onClick={() => setPanelTab("outline")}
      />
    </div>
  ) : undefined;

  // Портал в body обязателен: слой открывается поверх карточки задачи, а та
  // едет по экрану через transform — внутри неё `fixed` считался бы от самой
  // карточки, и документ оказался бы в её узкой колонке.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-background pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2 sm:px-4">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold sm:text-base">{taskTitle}</h2>
        {doc.uploading > 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Загрузка ({doc.uploading})
          </span>
        )}
        {editable && <DocSaveButton status={doc.status} onSave={doc.flush} className="h-8" />}
        <Button
          variant={searchOpen ? "secondary" : "outline"}
          size="sm"
          className="h-8"
          onClick={() => (searchOpen ? setSearchOpen(false) : openSearch())}
          title="Найти в описании (Ctrl+F)"
          aria-label="Найти в описании"
        >
          <Search className="size-4" />
        </Button>
        <DocxDownloadButton
          variant="outline"
          className="h-8"
          withLabel
          title={taskTitle}
          getHtml={() => editor?.getHTML() ?? value}
          threads={comments.threads}
          onError={setError}
        />
        <Button
          variant={railOpen && tab === "comments" ? "secondary" : "outline"}
          size="sm"
          className="h-8 lg:hidden"
          onClick={() => toggleRail("comments")}
          title="Обсуждение"
        >
          <MessageSquare className="size-4" />
          {openThreadCount > 0 && openThreadCount}
        </Button>
        {hasOutline && (
          <Button
            variant={railOpen && tab === "outline" ? "secondary" : "outline"}
            size="sm"
            className="h-8 lg:hidden"
            onClick={() => toggleRail("outline")}
            title="Оглавление"
          >
            <List className="size-4" />
          </Button>
        )}
        <Button variant="outline" size="sm" className="h-8" onClick={onClose} title="Свернуть описание">
          <Minimize2 className="size-4" />
          <span className="hidden sm:inline">Свернуть</span>
        </Button>
      </header>

      {editable && editor && (
        <div className="border-b border-border px-3 py-1.5 sm:px-4">
          <EditorToolbar
            editor={editor}
            variant="full"
            onFiles={(files) => void doc.uploadFiles(files)}
            onComment={canComment ? startDraft : undefined}
          />
        </div>
      )}

      {searchOpen && (
        <DocSearchBar
          editor={editor}
          scrollHost={scrollHost}
          value={search}
          onChange={setSearch}
          onClose={() => setSearchOpen(false)}
          focusSignal={searchFocus}
        />
      )}

      {(error || doc.error || comments.error) && (
        <p className="flex items-center gap-2 border-b border-border bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          {error ?? doc.error ?? comments.error}
          <button
            onClick={() => {
              setError(null);
              doc.clearError();
              comments.clearError();
            }}
            className="ml-auto"
          >
            <X className="size-3.5" />
          </button>
        </p>
      )}

      <div className="relative flex min-h-0 flex-1">
        {/* Зона сброса — вся колонка документа, но подсветка не должна ездить
            вместе с текстом: оверлей висит на неподвижной обёртке, прокрутка
            остаётся внутри неё. */}
        <div className="relative flex min-w-0 flex-1 flex-col" {...drop.handlers}>
          <div ref={setScrollHost} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
              <EditorContent editor={editor} className="doc-surface" />
            </div>
          </div>

          {editable && editor && (
            <SelectionMenu
              editor={editor}
              scrollHost={scrollHost}
              onComment={canComment ? startDraft : undefined}
            />
          )}

          {editable && (
            <p className="border-t border-border px-4 py-1.5 text-xs text-muted-foreground sm:px-8">
              {fileDropHint(canUpload)}
            </p>
          )}

          {/* pointer-events-none обязателен: перехватив указатель, оверлей съест
              и dragleave (подсветка залипнет), и сам сброс. */}
          {drop.active && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/80">
              <span className="rounded-lg border-2 border-dashed border-primary px-6 py-4 text-sm font-medium text-primary">
                Отпустите, чтобы прикрепить
              </span>
            </div>
          )}
        </div>

        {/* На широком экране панель стоит рядом с текстом, на узком — выезжает
            поверх: колонка в 320 px не оставила бы места документу. */}
        <aside
          className={cn(
            "border-l border-border bg-muted/20",
            "hidden w-80 shrink-0 lg:block",
            railOpen && "absolute inset-y-0 right-0 z-10 block w-full max-w-sm shadow-xl lg:relative lg:shadow-none",
          )}
        >
          {tab === "outline" ? (
            <DocOutline editor={editor} items={outline} scrollHost={scrollHost} tabs={tabs} />
          ) : (
            <CommentPanel
              threads={comments.threads}
              me={me}
              orgId={orgId}
              owner={owner}
              activeThreadId={comments.activeThreadId}
              isAnchored={(id) => comments.anchors.has(id)}
              canComment={canComment}
              canResolveAll={canResolveAll}
              onSelect={comments.select}
              onReply={comments.reply}
              onEdit={comments.editMessage}
              onDelete={comments.removeMessage}
              onResolve={comments.resolve}
              draftQuote={comments.draft?.quote ?? null}
              onSubmitDraft={comments.submitDraft}
              onCancelDraft={comments.cancelDraft}
              tabs={tabs}
            />
          )}
        </aside>
      </div>
    </div>,
    document.body,
  );
}
