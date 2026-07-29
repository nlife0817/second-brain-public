"use client";

// Экран для пользователя без организаций: создать свою или ждать приглашения.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SignOutButton } from "@/components/v2/SignOutButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/core/client";
import type { UserBrief } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";

/**
 * `user` приходит из серверного рендера: у пользователя без организаций стор
 * пуст (наполнять его нечем), а почту показать надо.
 */
export function OrgOnboarding({ user }: { user?: UserBrief | null }) {
  const storeMe = useV2Store((s) => s.me);
  const bootstrap = useV2Store((s) => s.bootstrap);
  const me = storeMe ?? user ?? null;
  const router = useRouter();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.post("/orgs", { name: name.trim() });
      await bootstrap();
      // Данные экранов считает сервер — без обновления рендера первая страница
      // осталась бы пустой до перезагрузки вручную.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать организацию");
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Создайте организацию</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Вы вошли как {me?.email}. Организация — это пространство команды: проекты, задачи,
          участники и внешние подрядчики. Если вас должны были пригласить — попросите коллегу
          прислать ссылку-приглашение.
        </p>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void create()}
          placeholder="Название организации"
          className="mt-4"
        />
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <Button className="mt-3 w-full" onClick={() => void create()} disabled={!name.trim() || saving}>
          {saving ? "Создаём…" : "Создать организацию"}
        </Button>
        {/* Приглашение ждут в тот аккаунт, в который вошли: если адрес не тот,
            выйти надо прямо отсюда — других элементов на экране нет. */}
        <div className="mt-4 flex items-center justify-center border-t border-border pt-3">
          <SignOutButton variant="ghost" label="Выйти из аккаунта" />
        </div>
      </div>
    </div>
  );
}
