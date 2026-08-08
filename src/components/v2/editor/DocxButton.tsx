"use client";

// Кнопка «скачать описание в .docx». Сам сборщик лежит в docx-export и грузится
// динамически: библиотека docx весит сотни килобайт, а нужна она только тому,
// кто действительно нажал кнопку.

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DocCommentThread } from "@/lib/core/types";
import { cn } from "@/lib/utils";

export function DocxDownloadButton({
  title,
  getHtml,
  threads,
  onError,
  className,
  variant = "ghost",
  withLabel = false,
}: {
  title: string;
  /**
   * Разметка описания на момент нажатия. Функция, а не строка: в документ
   * должно уходить то, что человек видит сейчас, включая правку, которую
   * автосохранение ещё не отправило.
   */
  getHtml: () => string;
  threads: readonly DocCommentThread[];
  /** Куда показать отказ. Без обработчика он остаётся подсказкой на кнопке. */
  onError?: (message: string) => void;
  className?: string;
  variant?: "ghost" | "outline";
  withLabel?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { downloadTaskDocx } = await import("./docx-export");
      await downloadTaskDocx({ title, html: getHtml(), threads });
    } catch (cause) {
      const message = "Не удалось собрать документ";
      console.error(message, cause);
      setError(message);
      onError?.(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant={variant}
      size="sm"
      className={cn("text-xs", error && "text-destructive", className)}
      disabled={busy}
      onClick={() => void download()}
      title={error ?? "Скачать описание в .docx — с картинками и примечаниями"}
      aria-label="Скачать описание в .docx"
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
      {withLabel && <span className="hidden sm:inline">.docx</span>}
    </Button>
  );
}
