"use client";

// Документы базы знаний, привязанные к задаче, и перенос описания в базу.
//
// Связь двусторонняя: тот же список есть и в самом документе. Ничего она не
// открывает — каждая сторона фильтруется своей видимостью при выдаче.

import { useCallback, useState } from "react";
import Link from "next/link";
import { BookOpen, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/core/client";
import type { KbDocumentDetail, KbLinkedDocument } from "@/lib/core/types";
import { useLoad } from "@/lib/core/use-load";
import { cn } from "@/lib/utils";

export function TaskDocuments({
  orgId,
  taskId,
  taskTitle,
  hasDescription,
  canEdit,
  onDescriptionReplaced,
}: {
  orgId: string | null;
  taskId: string | null;
  taskTitle: string;
  /** Пустое описание переносить нечего — кнопки тогда нет. */
  hasDescription: boolean;
  canEdit: boolean;
  /** Описание заменено ссылкой — карточке нужно перечитать задачу. */
  onDescriptionReplaced: () => void;
}) {
  const [documents, setDocuments] = useState<KbLinkedDocument[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState(taskTitle);
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId || !taskId) return;
    try {
      setDocuments(await api.get<KbLinkedDocument[]>(`/orgs/${orgId}/tasks/${taskId}/documents`));
    } catch {
      // Молча: блок вспомогательный, и его отказ не должен закрывать карточку.
    }
  }, [orgId, taskId]);
  useLoad(load);

  const convert = useCallback(async () => {
    if (!orgId || !taskId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.post<KbDocumentDetail>(
        `/orgs/${orgId}/tasks/${taskId}/to-document`,
        { title: title.trim() || taskTitle, replace_description: replace },
      );
      setDocuments((prev) => [...prev, { id: created.id, title: created.title }]);
      setDialogOpen(false);
      if (replace) onDescriptionReplaced();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать документ");
    } finally {
      setBusy(false);
    }
  }, [orgId, taskId, busy, title, taskTitle, replace, onDescriptionReplaced]);

  if (documents.length === 0 && !canEdit) return null;

  return (
    <div className="border-t border-border pt-3">
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Документы
        </h3>
        {canEdit && hasDescription && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              setTitle(taskTitle);
              setDialogOpen(true);
            }}
            title="Перенести описание задачи в базу знаний"
          >
            <BookOpen className="size-3.5" />В базу знаний
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {documents.map((document) => (
          <Link
            key={document.id}
            href={`/v2/kb/${document.id}`}
            className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm hover:border-foreground/20"
          >
            <BookOpen className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{document.title || "Без названия"}</span>
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
          </Link>
        ))}
        {documents.length === 0 && (
          <p className="text-xs text-muted-foreground">Пока ни одного</p>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Описание задачи в базу знаний</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="rounded-lg bg-muted/60 p-2.5 text-xs leading-relaxed text-muted-foreground">
              Текст и вложения переезжают целиком, документ встаёт в{" "}
              <b className="font-semibold text-foreground">проекты задачи</b>. Вложения копируются:
              у документа и задачи доступ разный, и картинка, оставшаяся за задачей, не открылась
              бы у того, кто видит только документ.
            </p>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              Заголовок документа
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                Что сделать с описанием задачи
              </span>
              {[
                {
                  value: true,
                  label: "Заменить ссылкой на документ",
                  hint: "Текст не задвоится — в задаче останется ссылка",
                },
                {
                  value: false,
                  label: "Оставить как есть",
                  hint: "Документ станет копией, дальше они живут независимо",
                },
              ].map((option) => (
                <button
                  key={String(option.value)}
                  onClick={() => setReplace(option.value)}
                  className={cn(
                    "rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted/60",
                    replace === option.value && "bg-primary/10 font-medium text-primary",
                  )}
                >
                  {option.label}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {option.hint}
                  </span>
                </button>
              ))}
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                Отмена
              </Button>
              <Button disabled={busy} onClick={() => void convert()}>
                {busy && <Loader2 className="size-4 animate-spin" />}
                Создать документ
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
