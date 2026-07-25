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
import { ProjectAccessPicker, type ProjectAccessValue } from "./ProjectAccessPicker";
import { PROJECT_COLORS } from "./project-icons";

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
  const [color, setColor] = useState(PROJECT_COLORS[5]);
  // Базовая роль сотрудников; менять её потом — в настройках проекта.
  const [defaultRole, setDefaultRole] = useState<ProjectAccessValue>("editor");
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
        default_role: defaultRole,
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
            {PROJECT_COLORS.map((c) => (
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
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Доступ сотрудников</p>
            <ProjectAccessPicker value={defaultRole} onChange={setDefaultRole} />
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
