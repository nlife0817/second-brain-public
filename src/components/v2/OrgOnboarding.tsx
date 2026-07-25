"use client";

// Экран для пользователя без организаций: создать свою или ждать приглашения.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/core/client";
import { useV2Store } from "@/lib/core/ui-store";

export function OrgOnboarding() {
  const { me, bootstrap } = useV2Store();
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать организацию");
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold">Создайте организацию</h1>
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
      </div>
    </div>
  );
}
