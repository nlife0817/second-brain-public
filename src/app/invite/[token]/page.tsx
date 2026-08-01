"use client";

// Страница принятия приглашения. Публичный путь (см. PUBLIC_PATHS в proxy.ts):
// неавторизованного отправляем на вход с возвратом сюда.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-rules";
import { api } from "@/lib/core/client";
import { useLoad } from "@/lib/core/use-load";

interface InvitePreview {
  org_name: string;
  email: string;
  org_role: "owner" | "admin" | "member" | "guest";
  signed_in_as: string | null;
  email_matches: boolean | null;
  /** Можно ли завести пароль прямо здесь: у адреса его ещё нет. */
  can_sign_up: boolean;
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
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");

  const load = useCallback(async () => {
    try {
      setPreview(await api.get<InvitePreview>(`/invitations/${token}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Приглашение недоступно");
    }
  }, [token]);

  useLoad(load);

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

  /**
   * Регистрация по приглашению: учётка, пароль и принятие — одним запросом.
   * Мимо `api`, потому что роут лежит вне `/api/v2` и работает без сессии.
   */
  async function signUp(event: React.FormEvent) {
    event.preventDefault();
    if (password !== repeat) {
      setError("Пароли не совпадают");
      return;
    }
    setAccepting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/invite-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: name.trim(), password }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Не удалось завершить регистрацию");
        setAccepting(false);
        return;
      }
      // Полная навигация: cookie сессии поставлена ответом, и первый экран
      // должен рендериться сервером уже с ней.
      window.location.href = "/v2/my";
    } catch {
      setError("Сеть недоступна. Попробуйте ещё раз");
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

            {!preview.signed_in_as && preview.can_sign_up ? (
              // Пароля у адреса ещё нет — заводим учётку прямо здесь, чтобы
              // приглашение не превращалось в три экрана подряд.
              <form onSubmit={signUp} className="mt-4">
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="name">
                  Как вас зовут
                </label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  autoFocus
                  className="mb-4"
                />

                <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="password">
                  Придумайте пароль
                </label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={PASSWORD_MIN_LENGTH}
                  required
                  className="mb-1.5"
                />
                <p className="mb-4 text-xs text-muted-foreground">
                  Не короче {PASSWORD_MIN_LENGTH} символов
                </p>

                <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="repeat">
                  Повторите пароль
                </label>
                <Input
                  id="repeat"
                  type="password"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                  autoComplete="new-password"
                  required
                  className="mb-4"
                />

                {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

                <Button type="submit" className="w-full" disabled={accepting || !password}>
                  {accepting ? "Создаём…" : "Принять приглашение"}
                </Button>
              </form>
            ) : !preview.signed_in_as ? (
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
