"use client";

// Кнопка сохранения описания — подстраховка на случай, когда автосохранение не
// довело правку до сервера.
//
// Одна и та же в обеих оболочках: в карточке и в развёрнутом документе. Держать
// её в оболочках по отдельности незачем — состояния и подписи должны совпадать,
// иначе в одном месте «Сохранено» будет значить не то же, что в другом.

import { Check, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DocSaveStatus } from "./useDocEditor";

/**
 * Кнопка стоит на месте всегда, а не появляется по нужде: подпись «Сохранено»
 * при неактивной кнопке — это ответ на вопрос «а точно ушло?», и появляющаяся
 * кнопка сдвигала бы соседние элементы на каждой правке.
 */
export function DocSaveButton({
  status,
  onSave,
  className,
}: {
  status: DocSaveStatus;
  onSave: () => void;
  className?: string;
}) {
  const saving = status === "saving";
  const failed = status === "error";
  const clean = status === "saved";

  return (
    <Button
      type="button"
      size="xs"
      variant={failed ? "destructive" : clean ? "ghost" : "secondary"}
      disabled={clean || saving}
      // Выделение в редакторе снимать нельзя: сохранение сюда приходит и из
      // развёрнутого режима, где над текстом висит меню по выделению.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSave}
      title={
        failed
          ? "Сохранить не удалось — нажмите, чтобы отправить снова"
          : clean
            ? "Описание сохранено на сервере"
            : "Сохранить описание, не дожидаясь автосохранения"
      }
      className={cn("gap-1", clean && "text-emerald-600 disabled:opacity-100", className)}
    >
      {saving ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : failed ? (
        <TriangleAlert className="size-3.5" />
      ) : clean ? (
        <Check className="size-3.5" />
      ) : null}
      {saving ? "Сохранение…" : failed ? "Повторить" : clean ? "Сохранено" : "Сохранить"}
    </Button>
  );
}
