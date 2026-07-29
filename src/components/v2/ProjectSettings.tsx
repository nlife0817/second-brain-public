"use client";

// Настройки проекта: общие параметры, доступ сотрудников, архив и удаление.
// Общий экран для десктопа (/v2/projects/[id]/settings) и мобильного
// (/v2/m/projects/[id]/settings) — правила доступа к проекту должны выглядеть
// одинаково в обеих оболочках.

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ProjectMuteToggle } from "@/components/v2/ProjectMuteToggle";
import { api, ApiError } from "@/lib/core/client";
import { cachedGet, invalidate, seed } from "@/lib/core/query";
import type { Project, ProjectMemberWithUser, ProjectRole } from "@/lib/core/types";
import { useV2Store } from "@/lib/core/ui-store";
import { cn } from "@/lib/utils";
import { ProjectAccessPicker, type ProjectAccessValue } from "./ProjectAccessPicker";
import { ProjectMembersEditor } from "./ProjectMembersEditor";
import { PROJECT_COLORS, PROJECT_ICON_NAMES, ProjectIcon } from "./project-icons";

export type ProjectDetail = Project & {
  my_role: ProjectRole | null;
  members: ProjectMemberWithUser[];
};

export interface Team {
  id: string;
  name: string;
}

const TABS = [
  { id: "general", label: "Общие" },
  { id: "access", label: "Доступ" },
  { id: "danger", label: "Архив и удаление" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function ProjectSettings({
  projectId,
  initialProject,
  teams,
  /** Куда возвращаться после удаления проекта: доска исчезнет вместе с ним. */
  exitHref,
}: {
  projectId: string;
  initialProject: ProjectDetail;
  teams: Team[];
  exitHref: string;
}) {
  const router = useRouter();
  const { orgId, orgRole, refreshProjects } = useV2Store();
  const [project, setProject] = useState<ProjectDetail>(initialProject);
  const [tab, setTab] = useState<TabId>("general");
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Черновик общих параметров: правки применяются кнопкой, доступ — сразу
  // (там каждое действие самостоятельно и обратимо).
  const [draft, setDraft] = useState({
    name: initialProject.name,
    description: initialProject.description,
    color: initialProject.color,
    icon: initialProject.icon,
    teamId: initialProject.team_id ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const projectPath = orgId ? `/orgs/${orgId}/projects/${projectId}` : null;

  // Серверные данные — в тот же кэш, что читает доска: вернувшись на неё, экран
  // не пойдёт за проектом второй раз.
  useEffect(() => {
    if (projectPath) seed(projectPath, initialProject);
  }, [projectPath, initialProject]);

  const load = useCallback(async () => {
    if (!projectPath) return;
    try {
      // force: экран настроек всегда показывает актуальное состояние доступа —
      // после мутации кэшевая копия 30-секундной свежести здесь только вредит.
      const p = await cachedGet<ProjectDetail>(projectPath, { force: true });
      setProject(p);
      setDraft({
        name: p.name,
        description: p.description,
        color: p.color,
        icon: p.icon,
        teamId: p.team_id ?? "",
      });
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Проект недоступен");
    }
  }, [projectPath]);

  const canManage = project?.my_role === "admin";
  const canManageAccess = canManage && orgRole !== "guest";

  /**
   * Любая мутация здесь меняет и то, что показывает доска (роль, доступ),
   * поэтому кэш пути проекта сбрасывается вместе с перечитыванием.
   */
  async function call(fn: () => Promise<unknown>, after: () => Promise<void> | void = load) {
    try {
      await fn();
      setError(null);
      if (projectPath) invalidate(projectPath);
      await after();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "Ошибка");
    }
  }

  async function saveGeneral() {
    if (saving) return;
    setSaving(true);
    await call(
      () =>
        api.patch(`/orgs/${orgId}/projects/${projectId}`, {
          name: draft.name.trim(),
          description: draft.description,
          color: draft.color,
          icon: draft.icon,
          team_id: draft.teamId || null,
        }),
      async () => {
        await load();
        await refreshProjects();
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2000);
      },
    );
    setSaving(false);
  }

  async function setAccess(value: ProjectAccessValue) {
    if (value === project.default_role) return;
    // Список участников перечитываем целиком: закрытие проекта добавляет в него
    // исполнителей задач, иначе они потеряли бы доступ к своей работе.
    await call(() => api.patch(`/orgs/${orgId}/projects/${projectId}`, { default_role: value }), async () => {
      await load();
      await refreshProjects();
    });
  }

  async function removeProject() {
    if (deleting) return;
    setDeleting(true);
    try {
      await api.del(`/orgs/${orgId}/projects/${projectId}`);
      // Кэш сбрасывается целиком: задачи удалённого проекта разъехались по
      // спискам «Мои задачи» и «Все задачи», а его карточка лежит в кэше доски.
      invalidate();
      await refreshProjects();
      router.push(exitHref);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить проект");
      setDeleting(false);
    }
  }

  if (loadError) {
    return <p className="px-4 py-10 text-center text-sm text-destructive">{loadError}</p>;
  }

  const dirty =
    draft.name.trim() !== project.name ||
    draft.description !== project.description ||
    draft.color !== project.color ||
    draft.icon !== project.icon ||
    draft.teamId !== (project.team_id ?? "");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4 sm:px-6">
      {!canManage && (
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
          Настройки проекта меняет его администратор — вы видите их только для чтения.
        </p>
      )}

      <div className="flex gap-1.5 overflow-x-auto [-webkit-overflow-scrolling:touch]">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              tab === t.id
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {tab === "general" && (
        <>
          {/* Личная настройка внутри общих: заглушение видно только автору и
              доступно всем, включая гостя, — в отличие от полей ниже. */}
          <Card
            title="Уведомления"
            hint="Заглушённый проект перестаёт присылать уведомления вам; остальных участников это не касается"
          >
            <ProjectMuteToggle projectId={projectId} />
          </Card>

          <Card title="Название и описание">
            <div className="flex flex-col gap-3">
              <Input
                value={draft.name}
                disabled={!canManage}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Название проекта"
              />
              <Textarea
                value={draft.description}
                disabled={!canManage}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Зачем этот проект и что в нём считается сделанным"
                rows={3}
              />
            </div>
          </Card>

          <Card title="Внешний вид" hint="Цвет и иконка отличают проект в списках и в шапке доски">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                {PROJECT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    disabled={!canManage}
                    onClick={() => setDraft((d) => ({ ...d, color: c }))}
                    aria-label={`Цвет ${c}`}
                    className={cn(
                      "size-6 rounded-full transition-transform",
                      draft.color === c && "scale-110 ring-2 ring-ring ring-offset-2 ring-offset-background",
                      !canManage && "cursor-not-allowed opacity-60",
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PROJECT_ICON_NAMES.map((name) => (
                  <button
                    key={name}
                    type="button"
                    disabled={!canManage}
                    onClick={() => setDraft((d) => ({ ...d, icon: name }))}
                    aria-label={name}
                    className={cn(
                      "rounded-lg border p-2 transition-colors",
                      draft.icon === name ? "border-primary bg-muted" : "border-border",
                      canManage ? "hover:bg-muted/60" : "cursor-not-allowed opacity-60",
                    )}
                  >
                    <ProjectIcon name={name} color={draft.color} className="size-4" />
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {orgRole !== "guest" && (
            <Card title="Команда" hint="Группировка проектов организации; команды заводятся в настройках организации">
              <Select
                value={draft.teamId}
                onValueChange={(v) => setDraft((d) => ({ ...d, teamId: v ?? "" }))}
                disabled={!canManage}
              >
                <SelectTrigger size="sm" className="w-full sm:w-64">
                  <SelectValue placeholder="Без команды">
                    {teams.find((t) => t.id === draft.teamId)?.name ?? "Без команды"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Без команды</SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Card>
          )}

          {canManage && (
            <div className="flex items-center gap-3">
              <Button onClick={() => void saveGeneral()} disabled={!dirty || !draft.name.trim() || saving}>
                {saving ? "Сохранение…" : "Сохранить"}
              </Button>
              {saved && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Check className="size-3.5" />
                  Сохранено
                </span>
              )}
            </div>
          )}
        </>
      )}

      {tab === "access" && (
        <>
          <Card
            title="Доступ сотрудников"
            hint="Что проект открывает сотрудникам организации без персонального приглашения. Гости и подрядчики доступ отсюда не получают — только через список участников."
          >
            <ProjectAccessPicker
              value={project.default_role}
              onChange={(v) => void setAccess(v)}
              disabled={!canManageAccess}
            />
            {project.default_role === null ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Проект закрыт: его не видят даже владелец и администраторы организации, пока не появятся
                в списке участников.
              </p>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                Владелец и администраторы организации получают права администратора проекта, остальные
                сотрудники — выбранный уровень. При закрытии проекта сотрудники, назначенные на его задачи,
                автоматически попадут в участники, чтобы не потерять свою работу.
              </p>
            )}
            {canManage && !canManageAccess && (
              <p className="mt-3 text-xs text-muted-foreground">
                Доступом сотрудников управляют участники организации — гость этот параметр не меняет.
              </p>
            )}
          </Card>

          <Card
            title="Участники проекта"
            hint="Персональные роли: они сильнее общего доступа — и повышают, и понижают его."
          >
            <ProjectMembersEditor
              projectId={projectId}
              members={project.members}
              canManage={!!canManage}
              onChanged={() => void load()}
            />
          </Card>
        </>
      )}

      {tab === "danger" && (
        <>
          <Card
            title={project.archived_at ? "Проект в архиве" : "Архив"}
            hint="Архивный проект пропадает из списков и поиска, задачи и история остаются на месте"
          >
            <Button
              variant="outline"
              disabled={!canManage}
              onClick={() =>
                void call(
                  () =>
                    api.patch(`/orgs/${orgId}/projects/${projectId}`, {
                      archived: !project.archived_at,
                    }),
                  async () => {
                    await load();
                    await refreshProjects();
                  },
                )
              }
            >
              {project.archived_at ? "Вернуть из архива" : "Архивировать проект"}
            </Button>
          </Card>

          <Card
            title="Удаление проекта"
            hint="Удаляются сам проект, его секции, участники и кастомные поля. Задачи остаются: те, что лежали только здесь, вернутся авторам в инбокс."
          >
            <Button variant="destructive" disabled={!canManage} onClick={() => setDeleteOpen(true)}>
              <Trash2 className="size-4" />
              Удалить проект
            </Button>
          </Card>
        </>
      )}

      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          setDeleteOpen(open);
          if (!open) setDeleteConfirm("");
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить проект «{project.name}»?</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Действие необратимо. Введите название проекта, чтобы подтвердить.
            </p>
            <Input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={project.name}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
                Отмена
              </Button>
              <Button
                variant="destructive"
                disabled={deleteConfirm.trim() !== project.name || deleting}
                onClick={() => void removeProject()}
              >
                {deleting ? "Удаление…" : "Удалить"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
