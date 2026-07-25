"use client";

// Быстрый доступ к участникам проекта с доски. Полная настройка доступа —
// на экране /v2/projects/[id]/settings (вкладка «Доступ»).

import Link from "next/link";
import { Settings2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Project, ProjectMemberWithUser, ProjectRole } from "@/lib/core/types";
import { ProjectMembersEditor } from "./ProjectMembersEditor";

export function ProjectMembersDialog({
  open,
  onOpenChange,
  project,
  onChanged,
  settingsHref,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project & { my_role: ProjectRole | null; members: ProjectMemberWithUser[] };
  onChanged: () => void;
  /** Ссылка на экран настроек: путь различается на десктопе и мобильном. */
  settingsHref?: string;
}) {
  // effectiveProjectRole уже поднимает org owner/admin до project admin в открытых.
  const canManage = project.my_role === "admin";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Участники проекта</DialogTitle>
        </DialogHeader>
        <ProjectMembersEditor
          projectId={project.id}
          members={project.members}
          canManage={canManage}
          onChanged={onChanged}
        />
        {canManage && settingsHref && (
          <Link
            href={settingsHref}
            className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Settings2 className="size-3.5" />
            Настройки проекта: доступ, секции, параметры
          </Link>
        )}
      </DialogContent>
    </Dialog>
  );
}
