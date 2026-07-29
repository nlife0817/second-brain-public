"use client";

// «Не беспокоить» для одного проекта — в его же настройках.
//
// Отдельный компонент, а не блок внутри ProjectSettings: тот про управление
// проектом и открыт не всем, а тишина — личная настройка каждого участника.
// Тот же список целиком продублирован в разделе уведомлений.

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { api } from "@/lib/core/client";
import { cachedGet, invalidate } from "@/lib/core/query";

const SETTINGS_PATH = "/notifications/settings";

export function ProjectMuteToggle({ projectId }: { projectId: string }) {
  const [muted, setMuted] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void cachedGet<{ muted_projects: string[] }>(SETTINGS_PATH)
      .then((res) => setMuted(res.muted_projects.includes(projectId)))
      .catch(() => setMuted(false));
  }, [projectId]);

  async function toggle(next: boolean) {
    setMuted(next);
    setError(null);
    try {
      await api.put(SETTINGS_PATH, { project_id: projectId, muted: next });
      invalidate(SETTINGS_PATH);
    } catch (e) {
      setMuted(!next);
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  }

  if (muted === null) return <p className="text-sm text-muted-foreground">Загрузка…</p>;

  return (
    <div className="flex items-center gap-2.5">
      {muted ? (
        <BellOff className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <Bell className="size-4 shrink-0 text-muted-foreground" />
      )}
      <label className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
        <Checkbox checked={muted} onCheckedChange={(checked) => void toggle(checked === true)} />
        Не беспокоить по этому проекту
      </label>
      {error && <span className="text-sm text-destructive">{error}</span>}
    </div>
  );
}
