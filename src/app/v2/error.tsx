"use client";

// Граница ошибок экранов v2.
//
// Данные считаются на сервере, а значит любой сбой выборки (мигнувшая база,
// отозванное право) валит рендер маршрута целиком. Раньше на его месте была
// неудачная фоновая загрузка и надпись в интерфейсе; без этой границы человек
// увидел бы системную страницу ошибки Next.

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function V2Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[v2] экран не отрисовался:", error);
  }, [error]);

  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm text-destructive">Не удалось загрузить экран</p>
      <p className="max-w-md text-xs text-muted-foreground">
        {error.message || "Неизвестная ошибка"}
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={reset}>
          Повторить
        </Button>
        <Link href="/v2/my" className="text-sm text-muted-foreground underline">
          К моим задачам
        </Link>
      </div>
    </div>
  );
}
