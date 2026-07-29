"use client";

// Страница принятия приглашения. Публичный путь (см. PUBLIC_PATHS в proxy.ts):
// неавторизованного отправляем на вход с возвратом сюда.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/core/client";

interface InvitePreview {
  org_name: string;
  email: string;
  org_role: "owner" | "admin" | "member" | "guest";
  signed_in_as: string | null;
  email_matches: boolean | null;
}

const ROLE_LABELS: Record<InvitePreview["org_role"], string> = {
  owner: "владельца",
  admin: "администратора",
  member: "сотрудника",
  guest: "гостя (внешнего участника)",
};

export default function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  const load = useCallback(async () => {
    try {
      setPreview(await api.get<InvitePreview>(`/invitations/${token}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Приглашение недоступно");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function accept() {
    setAccepting(true);
    try {
      await api.post(`/invitations/${token}`);
      router.push("/v2/my");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось принять приглашение");
      setAccepting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
        {error && !preview ? (
          <>
            <h1 className="font-heading text-xl font-semibold tracking-tight">Приглашение недоступно</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <Link href="/login" className="mt-4 inline-block text-sm text-primary underline">
              Перейти ко входу
            </Link>
          </>
        ) : !preview ? (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        ) : (
          <>
            <h1 className="font-heading text-xl font-semibold tracking-tight">Приглашение в «{preview.org_name}»</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Вас приглашают присоединиться в роли {ROLE_LABELS[preview.org_role]}. Приглашение
              выписано на адрес <span className="font-medium text-foreground">{preview.email}</span>.
            </p>

            {!preview.signed_in_as ? (
              <>
                <p className="mt-4 text-sm">Войдите под этим адресом, чтобы принять приглашение.</p>
                <Button
                  className="mt-3 w-full"
                  onClick={() => router.push(`/login?next=/invite/${token}`)}
                >
                  Войти
                </Button>
              </>
            ) : preview.email_matches === false ? (
              <>
                <p className="mt-4 text-sm text-destructive">
                  Вы вошли как {preview.signed_in_as}. Приглашение выписано на другой адрес — войдите
                  под ним.
                </p>
                <Button
                  variant="outline"
                  className="mt-3 w-full"
                  onClick={() => router.push(`/login?next=/invite/${token}`)}
                >
                  Сменить аккаунт
                </Button>
              </>
            ) : (
              <>
                {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
                <Button className="mt-4 w-full" onClick={() => void accept()} disabled={accepting}>
                  {accepting ? "Принимаем…" : "Принять приглашение"}
                </Button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
