"use client";

import { useEffect, useState } from "react";

/** Сообщения по коду ошибки из ?error= (его ставит /auth/callback). */
const ERRORS: Record<string, string> = {
  denied: "Вход отменён.",
  state: "Сессия входа устарела. Попробуйте ещё раз.",
  oauth: "Не удалось войти через Google. Попробуйте ещё раз.",
};

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextPath, setNextPath] = useState<string>("/");
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // После выхода возвращать на закрытый экран нельзя: следующим войти может
    // другой человек, и «продолжить с того же места» — это чужое место.
    const wasSignedOut = params.has("signedout");
    setSignedOut(wasSignedOut);
    setNextPath(wasSignedOut ? "/" : (params.get("next") ?? "/"));
    const code = params.get("error");
    if (code) setError(ERRORS[code] ?? ERRORS.oauth);
  }, []);

  // Полноценная навигация, а не fetch: дальше идёт редирект на accounts.google.com,
  // а cookie с state и PKCE-верификатором ставит наш роут по пути.
  function signInWithGoogle() {
    setLoading(true);
    setError(null);
    window.location.href = `/api/auth/google?next=${encodeURIComponent(nextPath)}`;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm px-6 py-10 rounded-2xl border bg-card shadow-sm">
        <h1 className="text-2xl font-semibold mb-2">Задачи</h1>
        {signedOut && <p className="text-sm font-medium mb-1">Вы вышли из аккаунта</p>}
        <p className="text-sm text-muted-foreground mb-6">
          Войдите через Google, чтобы продолжить.
        </p>
        <button
          type="button"
          onClick={signInWithGoogle}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 rounded-lg border bg-background px-4 py-2.5 text-sm font-medium hover:bg-accent disabled:opacity-60 disabled:cursor-not-allowed transition"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden>
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          {loading ? "Перенаправляем…" : "Войти через Google"}
        </button>
        {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
      </div>
    </div>
  );
}
