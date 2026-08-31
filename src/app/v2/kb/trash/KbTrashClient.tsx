"use client";

// Корзина базы знаний. Показывает верхние документы удалённых веток, а не
// каждый узел: снесли раздел с десятком страниц — здесь одна строка, и
// вернётся она целиком.

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Folder, RotateCcw, Table2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/core/client";
import type { KbTrashItem } from "@/lib/core/kb";
import { useV2Store } from "@/lib/core/ui-store";

export function KbTrashClient({ initial }: { initial: KbTrashItem[] }) {
  const router = useRouter();
  const orgId = useV2Store((s) => s.orgId);
  const members = useV2Store((s) => s.members);

  const [items, setItems] = useState(initial);
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setItems(initial);
  }
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = useCallback(
    async (id: string, kind: "restore" | "purge") => {
      if (!orgId) return;
      setBusy(id);
      setError(null);
      try {
        if (kind === "restore") await api.post(`/orgs/${orgId}/kb/${id}/restore`);
        else await api.del(`/orgs/${orgId}/kb/${id}/purge`);
        setItems((prev) => prev.filter((item) => item.id !== id));
        // Дерево слева живёт в layout — оно обязано увидеть возврат.
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось выполнить действие");
      } finally {
        setBusy(null);
      }
    },
    [orgId, router],
  );

  const nameOf = (userId: string | null) =>
    members.find((m) => m.user_id === userId)?.name ?? "кто-то";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2">
        <h1 className="flex-1 text-sm font-semibold">Корзина</h1>
        <span className="text-xs text-muted-foreground">
          Восстановление возвращает документ вместе с вложенными
        </span>
      </header>

      {error && (
        <p className="border-b border-border bg-destructive/10 px-4 py-1.5 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm"
            >
              {item.kind === "folder" ? (
                <Folder className="size-4 shrink-0 text-primary/70" />
              ) : item.kind === "sheet" ? (
                <Table2 className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1">
                <span className="font-medium">{item.title || "Без названия"}</span>
                {item.descendants > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {" "}
                    · и {item.descendants} внутри
                  </span>
                )}
              </span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                удалил {nameOf(item.deleted_by)},{" "}
                {new Date(item.deleted_at).toLocaleDateString("ru-RU", {
                  day: "numeric",
                  month: "short",
                })}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy === item.id}
                onClick={() => void act(item.id, "restore")}
              >
                <RotateCcw className="size-3.5" />
                Восстановить
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={busy === item.id}
                onClick={() => void act(item.id, "purge")}
                title="Удалить окончательно вместе с вложениями и историей"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          {items.length === 0 && (
            <p className="py-10 text-center text-sm text-muted-foreground">Корзина пуста</p>
          )}
        </div>
      </div>
    </div>
  );
}
