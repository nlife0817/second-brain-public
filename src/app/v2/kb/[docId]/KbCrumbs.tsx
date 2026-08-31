"use client";

// Хлебные крошки узла базы знаний. Общие у документа и у папки: путь один и
// тот же, а две копии разъехались бы на первой правке.

import Link from "next/link";
import type { KbNodeKind } from "@/lib/core/types";

export function KbCrumbs({
  path,
}: {
  path: Array<{ id: string; title: string; kind: KbNodeKind }>;
}) {
  return (
    <nav className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-xs text-muted-foreground">
      <Link href="/v2/kb" className="shrink-0 hover:text-foreground">
        База знаний
      </Link>
      {path.map((step, i) => (
        <span key={step.id} className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 opacity-50">/</span>
          {i === path.length - 1 ? (
            <span className="shrink-0 font-medium text-foreground">
              {step.title || "Без названия"}
            </span>
          ) : (
            <Link href={`/v2/kb/${step.id}`} className="truncate hover:text-foreground">
              {step.title || "Без названия"}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
