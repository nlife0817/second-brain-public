"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Параметры входа живут в строке запроса. Читаем их через `useSearchParams`, а
 * не из `window.location` в эффекте: эффект правил состояние сразу после
 * монтирования, то есть каждый показ экрана стоил лишнего прохода рендера ещё
 * до первой отрисовки.
 *
 * Страница статическая, поэтому `useSearchParams` обязан жить под `Suspense`.
 * Пока параметры неизвестны, показываем ту же карточку с умолчаниями — это и
 * есть обычный вход без «вы вышли».
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginCard nextPath="/" signedOut={false} />}>
      <LoginFromParams />
    </Suspense>
  );
}

function LoginFromParams() {
  const params = useSearchParams();
  // После выхода возвращать на закрытый экран нельзя: следующим войти может
  // другой человек, и «продолжить с того же места» — это чужое место.
  const signedOut = params.has("signedout");
  return <LoginCard nextPath={signedOut ? "/" : (params.get("next") ?? "/")} signedOut={signedOut} />;
}

function LoginCard({ nextPath, signedOut }: { nextPath: string; signedOut: boolean }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Не удалось войти");
        setLoading(false);
        return;
      }
      // Полная навигация, а не router.push: cookie сессии только что поставлена
      // ответом, и целевой экран должен рендериться сервером уже с ней.
      window.location.href = nextPath;
    } catch {
      setError("Сеть недоступна. Попробуйте ещё раз");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-border bg-card px-6 py-10 shadow-sm"
      >
        <h1 className="mb-2 font-heading text-2xl font-semibold tracking-tight">Задачи</h1>
        {signedOut && <p className="mb-1 text-sm font-medium">Вы вышли из аккаунта</p>}
        <p className="mb-6 text-sm text-muted-foreground">Войдите, чтобы продолжить.</p>

        <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="email">
          Email
        </label>
        <Input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          autoFocus
          required
          className="mb-4"
        />

        <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="password">
          Пароль
        </label>
        <Input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          className="mb-5"
        />

        <Button type="submit" disabled={loading || !email || !password} className="w-full">
          {loading ? "Входим…" : "Войти"}
        </Button>

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

        {/* Восстановления по почте нет — писем система не шлёт. Ссылку на
            установку пароля выдаёт владелец организации в настройках. */}
        <p className="mt-6 border-t border-border pt-4 text-xs text-muted-foreground">
          Забыли пароль или ещё не задали его? Попросите владельца организации выдать ссылку для
          установки пароля.
        </p>
      </form>
    </div>
  );
}
