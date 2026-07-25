"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/core/client";
import type { ProjectWithMeta } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";

const COLORS = ["#6b7280", "#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6"];

export function CreateProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { orgId, refreshProjects } = useV2Store();
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[5]);
  const [visibility, setVisibility] = useState<"org" | "private">("org");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!orgId || !name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const project = await api.post<ProjectWithMeta>(`/orgs/${orgId}/projects`, {
        name: name.trim(),
        color,
        visibility,
      });
      await refreshProjects();
      onOpenChange(false);
      setName("");
      router.push(`/v2/projects/${project.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать проект");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новый проект</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Input
            autoFocus
            placeholder="Название проекта"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
          <div className="flex items-center gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={cn(
                  "size-6 rounded-full transition-transform",
                  color === c && "scale-110 ring-2 ring-ring ring-offset-2 ring-offset-background",
                )}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setVisibility("org")}
              className={cn(
                "flex-1 rounded-lg border p-2.5 text-left text-sm",
                visibility === "org" ? "border-primary bg-muted" : "border-border",
              )}
            >
              <p className="font-medium">Для организации</p>
              <p className="text-xs text-muted-foreground">Видят все сотрудники</p>
            </button>
            <button
              onClick={() => setVisibility("private")}
              className={cn(
                "flex-1 rounded-lg border p-2.5 text-left text-sm",
                visibility === "private" ? "border-primary bg-muted" : "border-border",
              )}
            >
              <p className="font-medium">Приватный</p>
              <p className="text-xs text-muted-foreground">Только приглашённые</p>
            </button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button onClick={() => void submit()} disabled={!name.trim() || saving}>
              {saving ? "Создание…" : "Создать"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
