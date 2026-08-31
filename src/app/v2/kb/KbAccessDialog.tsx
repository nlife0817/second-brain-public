"use client";

// Доступ к документу.
//
// Источников доступа два, и они взаимоисключающие: либо проекты, к которым
// привязан документ, либо поимённый список у «общего» документа. Третьего не
// заводим — иначе на вопрос «кто это видит» пришлось бы отвечать двумя
// правилами сразу.
//
// Настраивается всё это только на корне ветки: вложенные документы наследуют
// доступ, и у них диалог не открывается вовсе.

import { useCallback, useState } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar } from "@/components/v2/bits";
import { ProjectIcon } from "@/components/v2/project-icons";
import { api } from "@/lib/core/client";
import type {
  KbDocumentDetail,
  KbDocumentMemberWithUser,
  ProjectDefaultRole,
  ProjectRole,
} from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { useLoad } from "@/lib/core/use-load";
import { cn } from "@/lib/utils";

const ROLE_LABELS: Record<ProjectRole, string> = {
  viewer: "Только смотреть",
  commenter: "Комментировать",
  editor: "Может править",
  admin: "Полный доступ",
};

const BASE_ROLES: Array<{ value: ProjectDefaultRole | null; label: string; hint: string }> = [
  { value: null, label: "Только по списку", hint: "Документ видят лишь перечисленные ниже" },
  { value: "viewer", label: "Вся организация смотрит", hint: "Сотрудники видят, гости — нет" },
  { value: "commenter", label: "Вся организация комментирует", hint: "Сотрудники могут обсуждать" },
  { value: "editor", label: "Вся организация правит", hint: "Сотрудники могут менять текст" },
];

export function KbAccessDialog({
  open,
  onOpenChange,
  document: doc,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: KbDocumentDetail;
  onChanged: (next: KbDocumentDetail) => void;
}) {
  const orgId = useV2Store((s) => s.orgId);
  const projects = useV2Store((s) => s.projects);
  const members = useV2Store((s) => s.members);

  const [docMembers, setDocMembers] = useState<KbDocumentMemberWithUser[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const common = doc.project_ids.length === 0;

  const loadMembers = useCallback(async () => {
    if (!orgId || !open || !common) return;
    try {
      setDocMembers(
        await api.get<KbDocumentMemberWithUser[]>(`/orgs/${orgId}/kb/${doc.id}/members`),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить список");
    }
  }, [orgId, open, common, doc.id]);
  useLoad(loadMembers);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить доступ");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const toggleProject = (projectId: string) =>
    void run(async () => {
      if (!orgId) return;
      const next = doc.project_ids.includes(projectId)
        ? doc.project_ids.filter((id) => id !== projectId)
        : [...doc.project_ids, projectId];
      onChanged(
        await api.put<KbDocumentDetail>(`/orgs/${orgId}/kb/${doc.id}/projects`, {
          project_ids: next,
        }),
      );
    });

  const setBaseRole = (role: ProjectDefaultRole | null) =>
    void run(async () => {
      if (!orgId) return;
      onChanged(
        await api.put<KbDocumentDetail>(`/orgs/${orgId}/kb/${doc.id}/access`, {
          default_role: role,
        }),
      );
    });

  const setMember = (userId: string, role: ProjectRole | null) =>
    void run(async () => {
      if (!orgId) return;
      setDocMembers(
        await api.put<KbDocumentMemberWithUser[]>(`/orgs/${orgId}/kb/${doc.id}/members`, {
          user_id: userId,
          role,
        }),
      );
      setAdding(false);
    });

  const known = new Set(docMembers.map((m) => m.user_id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Доступ к документу</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <p className="rounded-lg bg-muted/60 p-2.5 text-xs leading-relaxed text-muted-foreground">
            {common ? (
              <>
                Документ живёт вне проектов. Его видят перечисленные ниже, автор и владелец
                организации. Привяжите его к проекту — и доступ будет решать проект.
              </>
            ) : (
              <>
                Доступ берётся <b className="font-semibold text-foreground">из проектов</b>: смотреть
                может каждый, кто видит хотя бы один из них, править — их редакторы. Персональный
                список нужен только документам без проекта.
              </>
            )}
          </p>

          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Проекты документа
            </div>
            <div className="flex flex-col gap-0.5">
              {projects.map((project) => {
                const on = doc.project_ids.includes(project.id);
                return (
                  <button
                    key={project.id}
                    disabled={busy}
                    onClick={() => toggleProject(project.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/60",
                      on && "font-medium",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-4 shrink-0 place-items-center rounded border",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-border",
                      )}
                    >
                      {on && <Check className="size-3" />}
                    </span>
                    <ProjectIcon name={project.icon} color={project.color} className="size-3.5" />
                    <span className="min-w-0 flex-1 truncate text-left">{project.name}</span>
                  </button>
                );
              })}
              {projects.length === 0 && (
                <p className="px-2 py-1 text-xs text-muted-foreground">Проектов пока нет</p>
              )}
            </div>
          </div>

          {common && (
            <>
              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Вся организация
                </div>
                <div className="flex flex-col gap-0.5">
                  {BASE_ROLES.map((option) => (
                    <button
                      key={option.label}
                      disabled={busy}
                      onClick={() => setBaseRole(option.value)}
                      className={cn(
                        "flex items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted/60",
                        doc.default_role === option.value && "bg-primary/10 font-medium text-primary",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        {option.label}
                        <span className="block text-xs font-normal text-muted-foreground">
                          {option.hint}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Персонально
                </div>
                <div className="flex flex-col">
                  {docMembers.map((member) => (
                    <div
                      key={member.user_id}
                      className="flex items-center gap-2 border-b border-border/60 py-1.5 text-sm last:border-b-0"
                    >
                      <Avatar
                        user={{
                          id: member.user_id,
                          email: member.email,
                          name: member.name,
                          avatar_url: member.avatar_url,
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate">{member.name || member.email}</span>
                      <select
                        value={member.role}
                        disabled={busy}
                        onChange={(e) => setMember(member.user_id, e.target.value as ProjectRole)}
                        className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
                      >
                        {(Object.keys(ROLE_LABELS) as ProjectRole[]).map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role]}
                          </option>
                        ))}
                      </select>
                      <button
                        disabled={busy}
                        onClick={() => setMember(member.user_id, null)}
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label="Убрать из списка"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  {docMembers.length === 0 && (
                    <p className="py-1 text-xs text-muted-foreground">
                      Никого, кроме автора и владельца организации
                    </p>
                  )}
                </div>

                {adding ? (
                  <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-border">
                    {members
                      .filter((m) => !known.has(m.user_id))
                      .map((m) => (
                        <button
                          key={m.user_id}
                          disabled={busy}
                          onClick={() => setMember(m.user_id, "viewer")}
                          className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-muted/60"
                        >
                          <Avatar
                            user={{
                              id: m.user_id,
                              email: m.email,
                              name: m.name,
                              avatar_url: m.avatar_url,
                            }}
                          />
                          <span className="min-w-0 flex-1 truncate">{m.name || m.email}</span>
                        </button>
                      ))}
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-2"
                    onClick={() => setAdding(true)}
                  >
                    <Plus className="size-3.5" />
                    Добавить человека
                  </Button>
                )}
              </div>
            </>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
          {busy && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Сохраняем…
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
