"use client";

// История версий документа.
//
// Версия пишется при сохранении, но правки одного автора подряд склеиваются в
// одну (см. `shouldSquashVersion`): автосохранение идёт раз в полторы секунды,
// и без склейки за один сеанс работы история превратилась бы в сотни
// неотличимых строк.
//
// Тела версий в списке нет — оно тянется по требованию: сотня правок с полным
// HTML весила бы мегабайты.

import { useCallback, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/v2/bits";
import { api } from "@/lib/core/client";
import type { KbDocumentDetail, KbDocumentVersion } from "@/lib/core/types";
import { useLoad } from "@/lib/core/use-load";
import { cn } from "@/lib/utils";

function dayLabel(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay =
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();
  if (sameDay) return "Сегодня";
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function KbVersions({
  orgId,
  documentId,
  canRestore,
  previewId,
  onPreview,
  onRestored,
}: {
  orgId: string | null;
  documentId: string;
  canRestore: boolean;
  previewId: string | null;
  onPreview: (preview: { id: string; label: string; title: string; body: string } | null) => void;
  onRestored: (document: KbDocumentDetail) => void;
}) {
  const [versions, setVersions] = useState<KbDocumentVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      setVersions(await api.get<KbDocumentVersion[]>(`/orgs/${orgId}/kb/${documentId}/versions`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить историю");
    } finally {
      setLoading(false);
    }
  }, [orgId, documentId]);

  // Панель открывают редко — список тянется при первом её показе, а не вместе
  // с документом.
  useLoad(load);

  const preview = useCallback(
    async (version: KbDocumentVersion) => {
      if (!orgId) return;
      setBusy(version.id);
      try {
        const full = await api.get<KbDocumentVersion>(
          `/orgs/${orgId}/kb/${documentId}/versions/${version.id}`,
        );
        onPreview({
          id: version.id,
          label: `${dayLabel(version.created_at).toLowerCase()}, ${timeLabel(version.created_at)}`,
          title: full.title,
          body: full.body ?? "",
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось открыть версию");
      } finally {
        setBusy(null);
      }
    },
    [orgId, documentId, onPreview],
  );

  const restore = useCallback(
    async (version: KbDocumentVersion) => {
      if (!orgId) return;
      setBusy(version.id);
      try {
        const next = await api.post<KbDocumentDetail>(
          `/orgs/${orgId}/kb/${documentId}/versions/${version.id}`,
        );
        onRestored(next);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось восстановить версию");
      } finally {
        setBusy(null);
      }
    },
    [orgId, documentId, onRestored, load],
  );

  let lastDay = "";

  return (
    <div className="flex h-full flex-col overflow-y-auto p-2">
      <p className="rounded-lg bg-muted/60 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
        Версия пишется при сохранении. Правки одного автора подряд{" "}
        <b className="font-semibold text-foreground">склеиваются в одну</b> — иначе автосохранение
        оставляло бы по записи каждые несколько секунд.
      </p>

      {error && <p className="px-2 py-2 text-xs text-destructive">{error}</p>}
      {loading && versions.length === 0 && (
        <p className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Загрузка…
        </p>
      )}
      {!loading && versions.length === 0 && !error && (
        <p className="px-2 py-3 text-xs text-muted-foreground">
          Правок ещё не было — история появится после первого сохранения.
        </p>
      )}

      {versions.map((version, i) => {
        const day = dayLabel(version.created_at);
        const head = day !== lastDay ? day : null;
        lastDay = day;
        // Первая строка списка — текущее состояние документа: у неё нет ни
        // «посмотреть», ни «восстановить», возвращаться к себе же незачем.
        const current = i === 0 && !previewId;
        return (
          <div key={version.id}>
            {head && (
              <div className="px-2 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {head}
              </div>
            )}
            <div
              className={cn(
                "flex gap-2 rounded-lg border border-transparent px-2 py-1.5 text-xs",
                current && "border-primary bg-primary/10",
                previewId === version.id && "border-amber-500 bg-amber-500/10",
              )}
            >
              <span className="w-9 shrink-0 pt-0.5 font-mono text-[11px] text-muted-foreground">
                {timeLabel(version.created_at)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {version.author && <Avatar user={version.author} size="xs" />}
                  <span className="truncate font-semibold">
                    {version.author?.name || "Неизвестный автор"}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-muted-foreground">
                  {current ? "Текущая версия" : version.title || "Без названия"}
                </div>
                {!current && (
                  <div className="mt-1.5 flex gap-1.5">
                    <Button
                      size="xs"
                      variant="secondary"
                      disabled={busy === version.id}
                      onClick={() => void preview(version)}
                    >
                      Посмотреть
                    </Button>
                    {canRestore && (
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busy === version.id}
                        onClick={() => void restore(version)}
                      >
                        <RotateCcw className="size-3" />
                        Восстановить
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
