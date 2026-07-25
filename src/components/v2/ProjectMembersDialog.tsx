"use client";

// Участники проекта: просмотр для всех, управление — для project admin.
// Именно здесь подрядчику (гостю) открывается доступ к проекту.

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/core/client";
import type { Project, ProjectMemberWithUser, ProjectRole } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { Avatar } from "./bits";

const ROLE_LABELS: Record<ProjectRole, string> = {
  admin: "Админ",
  editor: "Редактор",
  commenter: "Комментатор",
  viewer: "Наблюдатель",
};

export function ProjectMembersDialog({
  open,
  onOpenChange,
  project,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project & { my_role: ProjectRole | null; members: ProjectMemberWithUser[] };
  onChanged: () => void;
}) {
  const { orgId, members: orgMembers } = useV2Store();
  const [adding, setAdding] = useState("");
  const [error, setError] = useState<string | null>(null);

  // effectiveProjectRole уже поднимает org owner/admin до project admin в org-видимых.
  const canManage = project.my_role === "admin";

  const notInProject = orgMembers.filter(
    (m) => !project.members.some((pm) => pm.user_id === m.user_id),
  );

  async function call(fn: () => Promise<unknown>) {
    try {
      await fn();
      setError(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Участники проекта</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {project.members.map((m) => (
            <div key={m.user_id} className="flex items-center gap-2.5">
              <Avatar user={{ id: m.user_id, email: m.email, name: m.name, avatar_url: m.avatar_url }} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{m.name || m.email}</p>
                <p className="truncate text-xs text-muted-foreground">{m.email}</p>
              </div>
              {canManage ? (
                <>
                  <Select
                    value={m.role}
                    onValueChange={(v) =>
                      v &&
                      void call(() =>
                        api.patch(`/orgs/${orgId}/projects/${project.id}/members/${m.user_id}`, { role: v }),
                      )
                    }
                  >
                    <SelectTrigger size="sm" className="w-36">
                      <SelectValue>{ROLE_LABELS[m.role]}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(ROLE_LABELS) as ProjectRole[]).map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() =>
                      void call(() => api.del(`/orgs/${orgId}/projects/${project.id}/members/${m.user_id}`))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">{ROLE_LABELS[m.role]}</span>
              )}
            </div>
          ))}

          {canManage && notInProject.length > 0 && (
            <div className="mt-2 flex items-center gap-2 border-t border-border pt-3">
              <Select value={adding} onValueChange={(v) => setAdding(v ?? "")}>
                <SelectTrigger size="sm" className="flex-1">
                  <SelectValue placeholder="Добавить участника…">
                    {(() => {
                      const m = notInProject.find((x) => x.user_id === adding);
                      return m ? m.name || m.email : "Добавить участника…";
                    })()}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {notInProject.map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.name || m.email}
                      {m.role === "guest" ? " (гость)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!adding}
                onClick={() =>
                  void call(async () => {
                    await api.post(`/orgs/${orgId}/projects/${project.id}/members`, {
                      user_id: adding,
                      role: "editor",
                    });
                    setAdding("");
                  })
                }
              >
                Добавить
              </Button>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
