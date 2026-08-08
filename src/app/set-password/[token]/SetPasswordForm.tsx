"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-rules";

/**
 * Форма установки пароля.
 *
 * Имя спрашиваем только у тех, у кого его ещё нет: раньше оно приезжало из
 * профиля Google, а теперь взяться ему неоткуда.
 */
export function SetPasswordForm({
  token,
  email,
  name,
}: {
  token: string;
  email: string;
  name: string;
}) {
  const [fullName, setFullName] = useState(name);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = repeat.length > 0 && password !== repeat;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== repeat) {
      setError("Пароли не совпадают");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, name: fullName.trim() }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Не удалось задать пароль");
        setLoading(false);
        return;
      }
      // Роут уже поставил cookie сессии — идём внутрь полной навигацией.
      window.location.href = "/v2/my";
    } catch {
      setError("Сеть недоступна. Попробуйте ещё раз");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h1 className="font-heading text-xl font-semibold tracking-tight">Задайте пароль</h1>
      <p className="mt-2 mb-6 text-sm text-muted-foreground">
        Для входа под адресом <span className="font-medium text-foreground">{email}</span>
      </p>

      {!name && (
        <>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="name">
            Как вас зовут
          </label>
          <Input
            id="name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            className="mb-4"
          />
        </>
      )}

      <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="password">
        Пароль
      </label>
      <Input
        id="password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        required
        autoFocus={!!name}
        className="mb-1.5"
      />
      <p className="mb-4 text-xs text-muted-foreground">Не короче {PASSWORD_MIN_LENGTH} символов</p>

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
        className="mb-5"
      />

      <Button type="submit" disabled={loading || mismatch || !password} className="w-full">
        {loading ? "Сохраняем…" : "Сохранить и войти"}
      </Button>

      {(error || mismatch) && (
        <p className="mt-4 text-sm text-destructive">{error ?? "Пароли не совпадают"}</p>
      )}
    </form>
  );
}
