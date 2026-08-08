"use client";

// Свой пароль: задать первый или сменить существующий.
//
// Общий блок для десктопных и мобильных настроек. Состояние «пароль уже есть»
// приходит из списка участников (`has_password`) — своя строка там всегда есть,
// поэтому лишнего запроса ради одного флага не требуется.

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-rules";
import { api } from "@/lib/core/client";

export function PasswordSection({ hasPassword }: { hasPassword: boolean }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (next !== repeat) {
      setError("Пароли не совпадают");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.put("/me/password", { current_password: current, new_password: next });
      setCurrent("");
      setNext("");
      setRepeat("");
      setOpen(false);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить пароль");
    } finally {
      setSaving(false);
    }
  }

  // Признак приезжает из списка участников и после сохранения не перечитывается —
  // иначе первый заданный пароль оставлял бы форму раскрытой навсегда.
  const isSet = hasPassword || done;

  // Пароля нет — это не «настройка на потом»: сессия живёт 30 дней, и без
  // пароля человек после неё просто не войдёт. Поэтому форма сразу раскрыта,
  // а блок подсвечен.
  const expanded = open || !isSet;

  return (
    <div>
      {!isSet && (
        <p className="mb-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Пароль не задан. Задайте его сейчас — иначе войти после окончания текущей сессии будет
          нечем.
        </p>
      )}
      {done && (
        <p className="mb-3 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          Пароль сохранён.
        </p>
      )}

      {!expanded ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1 text-sm text-muted-foreground">
            Вход по адресу и паролю. Пароль задан.
          </p>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            <KeyRound className="size-4" />
            Сменить пароль
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
          {/* Текущий пароль спрашиваем только у того, у кого он есть: остальные —
              это вход, доставшийся от прежней схемы, подтверждать им нечем. */}
          {isSet && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="current-password">
                Текущий пароль
              </label>
              <Input
                id="current-password"
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="new-password">
              Новый пароль
            </label>
            <Input
              id="new-password"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              required
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Не короче {PASSWORD_MIN_LENGTH} символов
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="repeat-password">
              Повторите пароль
            </label>
            <Input
              id="repeat-password"
              type="password"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              autoComplete="new-password"
              required
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={saving || !next}>
              {saving ? "Сохраняем…" : "Сохранить"}
            </Button>
            {isSet && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
              >
                Отмена
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
