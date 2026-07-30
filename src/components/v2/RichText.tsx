"use client";

import { useState } from "react";
import { EditorContent } from "@tiptap/react";
import { ChevronDown, ChevronUp, Loader2, Maximize2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DocSaveButton } from "./editor/SaveButton";
import { SelectionMenu } from "./editor/SelectionMenu";
import { EditorToolbar } from "./editor/Toolbar";
import { useDocEditor, type UseDocEditorOptions } from "./editor/useDocEditor";
import { fileDropHint, useFileDrop } from "./editor/useFileDrop";

/** Высота свёрнутого описания — примерно шесть строк текста. */
const COLLAPSED_MAX_PX = 160;

/**
 * Стоит ли сворачивать это описание.
 *
 * Считается по самому HTML, а не замером DOM. Замерить можно только после того,
 * как Tiptap наполнит редактор, то есть уже после первой отрисовки — описание
 * успевало бы мигнуть целиком и схлопнуться. Вдобавок замер требует
 * ResizeObserver, чьи колбэки привязаны к циклу отрисовки: во вкладке, которая
 * не рисует кадры, они не приходят вовсе.
 *
 * Оценка приблизительная и такой и задумана: ошибка стоит лишней кнопки
 * «Показать всё» у пограничного описания, а не сломанной вёрстки.
 */
function isLongDescription(html: string): boolean {
  if (!html) return false;
  // Картинки, таблицы и вложения растягивают карточку сильнее любого текста.
  if (/<(img|table|figure|hr)\b/i.test(html)) return true;
  const blocks = (html.match(/<(p|h[1-6]|li|blockquote|pre)\b/gi) ?? []).length;
  if (blocks > 4) return true;
  // ~70 символов в строке при ширине карточки: шесть строк — примерно 400.
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length > 400;
}

/**
 * Описание задачи в карточке. Тот же документ, что и в развёрнутом режиме, но
 * в узкой колонке: панель инструментов сокращена, комментариев к тексту нет —
 * для них нужна ширина, которой здесь просто негде взять.
 */
export function RichText({
  value,
  onSave,
  orgId = null,
  taskId = null,
  placeholder = "Добавьте описание…",
  editable = true,
  onExpand,
  threadCount = 0,
  collapsible = false,
  showSaveButton = false,
}: {
  value: string;
  /** `false` — сохранить не удалось; см. `UseDocEditorOptions.onSave`. */
  onSave: UseDocEditorOptions["onSave"];
  /**
   * Задача, к которой крепятся вложения. У черновика (`TaskDraftPanel`) её ещё
   * нет — прикрепить файл не к чему, поэтому кнопки загрузки не рисуются.
   */
  orgId?: string | null;
  taskId?: string | null;
  placeholder?: string;
  editable?: boolean;
  /** Открыть полноэкранный режим. Без обработчика кнопка не рисуется. */
  onExpand?: () => void;
  /** Открытые обсуждения описания — счётчик на кнопке разворачивания. */
  threadCount?: number;
  /**
   * Длинное описание обрезать до {@link COLLAPSED_MAX_PX} с кнопкой «Показать
   * всё». Только для карточки: в черновиках описание набирают с нуля, и прятать
   * там нечего.
   */
  collapsible?: boolean;
  /**
   * Кнопка сохранения — подстраховка автосохранения.
   *
   * Только там, где `onSave` действительно уходит на сервер. У черновиков
   * (`TaskDraftPanel`, новая подзадача) описание копится в состоянии экрана до
   * создания задачи: «Сохранено» там значило бы не то, что человек прочитает.
   */
  showSaveButton?: boolean;
}) {
  const doc = useDocEditor({ value, onSave, orgId, taskId, editable, placeholder });
  const [expanded, setExpanded] = useState(false);

  const canCollapse = collapsible && isLongDescription(value);
  const collapsed = canCollapse && !expanded;

  const canUpload = editable && !!orgId && !!taskId;
  const drop = useFileDrop({
    enabled: canUpload,
    onFiles: (files) => void doc.uploadFiles(files),
  });
  // Область прокрутки — оболочка карточки, до неё редактору не дотянуться:
  // меню по выделению ищет её само, от этого элемента вверх.
  const [frame, setFrame] = useState<HTMLElement | null>(null);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Описание
        </span>
        {doc.uploading > 0 && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            загрузка
          </span>
        )}
        <span className="flex-1" />
        {onExpand && (
          // Не «Развернуть»: рядом теперь живёт раскрытие текста на месте, и две
          // кнопки с одним словом означали бы разное.
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={onExpand}
            title="Открыть описание документом — во весь экран, с комментариями к тексту"
          >
            {threadCount > 0 && (
              <>
                <MessageSquare className="size-3.5" />
                {threadCount}
              </>
            )}
            <Maximize2 className="size-3.5" />В документ
          </Button>
        )}
      </div>

      <div
        ref={setFrame}
        {...drop.handlers}
        className="relative overflow-hidden rounded-lg border border-border bg-background focus-within:border-ring"
      >
        {editable && doc.editor && (
          <div className="border-b border-border bg-muted/30 px-1.5 py-1">
            <EditorToolbar
              editor={doc.editor}
              variant="compact"
              onFiles={canUpload ? (files) => void doc.uploadFiles(files) : undefined}
            />
          </div>
        )}
        {/* Клип строго вокруг текста: на внешней рамке он съел бы и высоту
            панели инструментов. onFocusCapture обязателен — ProseMirror при
            установке каретки скроллит контейнер, и обрезанная область иначе
            залипает прокрученной. */}
        <div
          className={cn("relative", collapsed && "overflow-hidden")}
          style={collapsed ? { maxHeight: COLLAPSED_MAX_PX } : undefined}
          onFocusCapture={() => setExpanded(true)}
        >
          <EditorContent editor={doc.editor} className="doc-surface min-h-24 px-3 py-2 text-sm" />
          {collapsed && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-background to-transparent" />
          )}
        </div>
        {canCollapse && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center justify-center gap-1 border-t border-border bg-muted/20 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            {expanded ? (
              <>
                <ChevronUp className="size-3.5" />
                Свернуть
              </>
            ) : (
              <>
                <ChevronDown className="size-3.5" />
                Показать всё
              </>
            )}
          </button>
        )}

        {/* Обсуждение к фрагменту заводит только развёрнутый режим — он владелец
            doc_comments, поэтому кнопки «Комментировать» здесь нет. */}
        {editable && doc.editor && <SelectionMenu editor={doc.editor} scrollHost={frame} />}

        {/* pointer-events-none обязателен: перехватив указатель, оверлей съест и
            dragleave (подсветка залипнет), и сам сброс. */}
        {drop.active && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/80 text-xs font-medium text-primary">
            Отпустите, чтобы прикрепить
          </div>
        )}
      </div>

      {editable && (
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">{fileDropHint(canUpload)}</p>
          {showSaveButton && <DocSaveButton status={doc.status} onSave={doc.flush} />}
        </div>
      )}

      {doc.error && (
        <p className="text-xs text-destructive">
          {doc.error}{" "}
          <button onClick={doc.clearError} className="underline">
            скрыть
          </button>
        </p>
      )}
    </div>
  );
}
