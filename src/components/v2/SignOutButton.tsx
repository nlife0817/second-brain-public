"use client";

// Выход из аккаунта. Кнопка нужна и там, где интерфейса нет вовсе: экран
// «Нет доступа» и онбординг без организации — тупики, из которых иначе не
// выбраться, если вошли не тем аккаунтом.

import { useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/core/session";

export function SignOutButton({
  label = "Выйти",
  variant = "outline",
  size = "sm",
  className,
}: {
  label?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      disabled={busy}
      onClick={() => {
        setBusy(true);
        // Состояние не снимаем: страница уходит на /login, а до этого повторный
        // клик успел бы отправить второй запрос на отписку.
        void signOut();
      }}
    >
      <LogOut className="size-4" />
      {busy ? "Выходим…" : label}
    </Button>
  );
}
