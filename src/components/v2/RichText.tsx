"use client";

import { EditorContent } from "@tiptap/react";
import { Loader2, Maximize2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditorToolbar } from "./editor/Toolbar";
import { useDocEditor } from "./editor/useDocEditor";

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
}: {
  value: string;
  onSave: (html: string) => void;
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
}) {
  const doc = useDocEditor({ value, onSave, orgId, taskId, editable, placeholder });

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
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={onExpand}
            title="Развернуть описание на весь экран"
          >
            {threadCount > 0 && (
              <>
                <MessageSquare className="size-3.5" />
                {threadCount}
              </>
            )}
            <Maximize2 className="size-3.5" />
            Развернуть
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-background focus-within:border-ring">
        {editable && doc.editor && (
          <div className="border-b border-border bg-muted/30 px-1.5 py-1">
            <EditorToolbar
              editor={doc.editor}
              variant="compact"
              onFiles={
                orgId && taskId ? (files) => void doc.uploadFiles(files) : undefined
              }
            />
          </div>
        )}
        <EditorContent editor={doc.editor} className="doc-surface min-h-24 px-3 py-2 text-sm" />
      </div>

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
