"use client";

// Настройки организации: участники, приглашения, статусы, теги, кастомные поля.

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/core/client";
import type {
  CustomField,
  FieldType,
  Invitation,
  OrgRole,
  ProjectRole,
} from "@/lib/core/types";
import { useV2Store, useV2StoreApi } from "@/lib/core/ui-store";
import { Avatar } from "@/components/v2/bits";
import { PushToggle } from "@/components/v2/PushToggle";

const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Владелец",
  admin: "Администратор",
  member: "Сотрудник",
  guest: "Гость",
};

const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  admin: "Админ",
  editor: "Редактор",
  commenter: "Комментатор",
  viewer: "Наблюдатель",
};

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Текст",
  number: "Число",
  select: "Список",
  multi_select: "Мультисписок",
  date: "Дата",
  user: "Участник",
  checkbox: "Чекбокс",
  url: "Ссылка",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

interface Usage {
  plan: string;
  limits: { members: number; projects: number; guests: number; webhooks: number };
  usage: { members: number; projects: number; guests: number; webhooks: number };
}

interface Webhook {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  last_error: string | null;
}

interface Team {
  id: string;
  name: string;
  project_count: number;
}

interface AuditEvent {
  id: number;
  verb: string;
  created_at: string;
  actor: { name: string; email: string } | null;
  payload: Record<string, unknown>;
}

const PLAN_LABELS: Record<string, string> = {
  free: "Бесплатный",
  team: "Командный",
  business: "Бизнес",
};

/** Часть настроек, доступная администратору, — считается на сервере. */
export interface AdminInitial {
  usage: Usage | null;
  webhooks: Webhook[];
  teams: Team[];
  audit: AuditEvent[];
}

export interface SettingsInitial {
  fields: CustomField[];
  invitations: Invitation[];
  /** null для не-администратора: раздел просто не рисуется. */
  admin: AdminInitial | null;
}

/** Администрирование организации: тариф, вебхуки, команды, аудит, экспорт. */
function AdminSection({ orgId, initial }: { orgId: string | null; initial: AdminInitial }) {
  const [usage, setUsage] = useState<Usage | null>(initial.usage);
  const [webhooks, setWebhooks] = useState<Webhook[]>(initial.webhooks);
  const [teams, setTeams] = useState<Team[]>(initial.teams);
  const [audit, setAudit] = useState<AuditEvent[]>(initial.audit);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Серверные данные уже в состоянии — сеть нужна только после правок. */
  const loadedOnce = useRef(true);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const [u, w, t, a] = await Promise.all([
        api.get<Usage>(`/orgs/${orgId}/usage`),
        api.get<Webhook[]>(`/orgs/${orgId}/webhooks`),
        api.get<Team[]>(`/orgs/${orgId}/teams`),
        api.get<AuditEvent[]>(`/orgs/${orgId}/audit`),
      ]);
      setUsage(u);
      setWebhooks(w);
      setTeams(t);
      setAudit(a.slice(0, 15));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить настройки организации");
    }
  }, [orgId]);

  useEffect(() => {
    // Первый заход обходится серверными данными; на смену организации —
    // перечитываем.
    if (loadedOnce.current) {
      loadedOnce.current = false;
      return;
    }
    void load();
  }, [load]);

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
      setError(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  return (
    <>
      <Section title="Тариф и лимиты">
        {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
        {usage && (
          <div className="flex flex-col gap-2">
            <p className="text-sm">
              План: <span className="font-medium">{PLAN_LABELS[usage.plan] ?? usage.plan}</span>
            </p>
            {(["members", "guests", "projects", "webhooks"] as const).map((key) => {
              const labels = {
                members: "Участники",
                guests: "Гости",
                projects: "Проекты",
                webhooks: "Вебхуки",
              };
              const used = usage.usage[key];
              const limit = usage.limits[key];
              return (
                <div key={key} className="flex items-center gap-3 text-sm">
                  <span className="w-28 text-muted-foreground">{labels[key]}</span>
                  <div className="h-1.5 w-40 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${used >= limit ? "bg-destructive" : "bg-primary"}`}
                      style={{ width: `${limit ? Math.min(100, (used / limit) * 100) : 0}%` }}
                    />
                  </div>
                  <span className="tabular-nums text-muted-foreground">
                    {used} / {limit}
                  </span>
                </div>
              );
            })}
            <a
              href={`/api/v2/orgs/${orgId}/export`}
              className="mt-1 w-fit text-sm text-primary underline"
              download
            >
              Выгрузить все данные организации (JSON)
            </a>
          </div>
        )}
      </Section>

      <Section title="Команды">
        <div className="flex flex-col gap-1.5">
          {teams.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{t.name}</span>
              <span className="text-xs text-muted-foreground">{t.project_count} проектов</span>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => void run(() => api.del(`/orgs/${orgId}/teams/${t.id}`))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          <div className="mt-1 flex items-center gap-2">
            <Input
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Новая команда"
              className="h-8 w-56"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!teamName.trim()}
              onClick={() =>
                void run(async () => {
                  await api.post(`/orgs/${orgId}/teams`, { name: teamName.trim() });
                  setTeamName("");
                })
              }
            >
              Добавить
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Вебхуки">
        <div className="flex flex-col gap-2">
          {webhooks.map((w) => (
            <div key={w.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{w.url}</span>
              <span className="text-xs text-muted-foreground">
                {w.events.length === 0 ? "все события" : w.events.join(", ")}
              </span>
              {w.last_error && (
                <span className="max-w-40 truncate text-xs text-destructive" title={w.last_error}>
                  {w.last_error}
                </span>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => void run(() => api.del(`/orgs/${orgId}/webhooks/${w.id}`))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          {newSecret && (
            <div className="rounded-lg bg-muted px-3 py-2">
              <p className="text-xs text-muted-foreground">
                Секрет для проверки подписи (показывается один раз):
              </p>
              <code className="text-xs break-all">{newSecret}</code>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://example.com/hook"
              className="h-8 flex-1"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!webhookUrl.startsWith("https://")}
              onClick={() =>
                void run(async () => {
                  const res = await api.post<{ secret: string }>(`/orgs/${orgId}/webhooks`, {
                    url: webhookUrl,
                    events: [],
                  });
                  setNewSecret(res.secret);
                  setWebhookUrl("");
                })
              }
            >
              Добавить
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Каждое событие отправляется POST-запросом с подписью в заголовке X-SecondBrain-Signature
            (HMAC-SHA256 от тела запроса).
          </p>
        </div>
      </Section>

      <Section title="Журнал действий">
        <div className="flex flex-col gap-1">
          {audit.map((e) => (
            <p key={e.id} className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{e.actor?.name || e.actor?.email || "Система"}</span>{" "}
              {e.verb} ·{" "}
              {new Date(e.created_at).toLocaleString("ru-RU", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          ))}
          {audit.length === 0 && <p className="text-sm text-muted-foreground">Записей нет</p>}
        </div>
      </Section>
    </>
  );
}

export function SettingsClient({ initial }: { initial: SettingsInitial }) {
  const store = useV2Store();
  const storeApi = useV2StoreApi();
  const { orgId, orgRole, me, members, statuses, tags, projects } = store;
  const isAdmin = orgRole === "owner" || orgRole === "admin";
  // Теги и кастомные поля org-уровня доступны сотрудникам, но не гостям.
  const canManageTags = isAdmin || orgRole === "member";

  const [invites, setInvites] = useState<Invitation[]>(initial.invitations);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member" | "guest">("member");
  const [inviteProject, setInviteProject] = useState("");
  const [inviteProjectRole, setInviteProjectRole] = useState<ProjectRole>("editor");
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [fields, setFields] = useState<CustomField[]>(initial.fields);
  const [newStatus, setNewStatus] = useState("");
  const [newTag, setNewTag] = useState("");
  const [newField, setNewField] = useState("");
  const [newFieldType, setNewFieldType] = useState<FieldType>("text");
  const [newFieldOptions, setNewFieldOptions] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Поля живут в сторе (их читает карточка задачи) — правки отсюда должны
  // обновлять именно его, иначе карточка покажет устаревший набор.
  const loadExtras = useCallback(async () => {
    if (!orgId) return;
    const [fs, inv] = await Promise.all([
      api.get<CustomField[]>(`/orgs/${orgId}/fields`),
      isAdmin ? api.get<Invitation[]>(`/orgs/${orgId}/invitations`) : Promise.resolve([]),
    ]);
    setFields(fs);
    setInvites(inv);
    storeApi.getState().setFields(fs);
  }, [orgId, isAdmin, storeApi]);

  // Поля и приглашения пришли с сервера — перечитываем только после правок и
  // при смене организации.
  const extrasLoaded = useRef(true);
  useEffect(() => {
    if (extrasLoaded.current) {
      extrasLoaded.current = false;
      return;
    }
    void loadExtras();
  }, [loadExtras]);

  async function call(fn: () => Promise<unknown>, refresh?: () => Promise<void> | void) {
    try {
      await fn();
      setError(null);
      await refresh?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  async function createInvite() {
    if (!orgId || !inviteEmail.trim()) return;
    await call(async () => {
      const res = await api.post<{ invite_url: string }>(`/orgs/${orgId}/invitations`, {
        email: inviteEmail.trim(),
        org_role: inviteRole,
        project_grants:
          inviteRole === "guest" && inviteProject
            ? [{ project_id: inviteProject, role: inviteProjectRole }]
            : [],
      });
      setLastInviteUrl(res.invite_url);
      setInviteEmail("");
    }, loadExtras);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border px-6 py-3.5">
        <h1 className="text-base font-semibold">Настройки организации</h1>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <Section title={`Участники · ${members.length}`}>
            <div className="flex flex-col gap-2.5">
              {members.map((m) => (
                <div key={m.user_id} className="flex items-center gap-2.5">
                  <Avatar user={{ id: m.user_id, email: m.email, name: m.name, avatar_url: m.avatar_url }} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {m.name || m.email}
                      {me?.id === m.user_id && <span className="text-muted-foreground"> (вы)</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                  </div>
                  {isAdmin && m.user_id !== me?.id ? (
                    <>
                      <Select
                        value={m.role}
                        onValueChange={(v) =>
                          v &&
                          void call(
                            () => api.patch(`/orgs/${orgId}/members/${m.user_id}`, { role: v }),
                            store.refreshMembers,
                          )
                        }
                      >
                        <SelectTrigger size="sm" className="w-40">
                          <SelectValue>{ORG_ROLE_LABELS[m.role]}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(ORG_ROLE_LABELS) as OrgRole[])
                            // Владельца назначает только владелец — не показываем
                            // опцию, которую сервер всё равно отклонит.
                            .filter((r) => r !== "owner" || orgRole === "owner")
                            .map((r) => (
                              <SelectItem key={r} value={r}>
                                {ORG_ROLE_LABELS[r]}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Удалить из организации"
                        onClick={() => {
                          if (window.confirm(`Удалить ${m.email} из организации?`)) {
                            void call(() => api.del(`/orgs/${orgId}/members/${m.user_id}`), store.refreshMembers);
                          }
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs text-muted-foreground">{ORG_ROLE_LABELS[m.role]}</span>
                  )}
                </div>
              ))}
            </div>
          </Section>

          {isAdmin && (
            <Section title="Приглашения">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  placeholder="email@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-56"
                />
                <Select value={inviteRole} onValueChange={(v) => v && setInviteRole(v as typeof inviteRole)}>
                  <SelectTrigger size="sm" className="w-40">
                    <SelectValue>{ORG_ROLE_LABELS[inviteRole]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Сотрудник</SelectItem>
                    <SelectItem value="admin">Администратор</SelectItem>
                    <SelectItem value="guest">Гость (подрядчик)</SelectItem>
                  </SelectContent>
                </Select>
                {inviteRole === "guest" && (
                  <>
                    <Select value={inviteProject} onValueChange={(v) => setInviteProject(v ?? "")}>
                      <SelectTrigger size="sm" className="w-44">
                        <SelectValue placeholder="Проект для гостя">
                          {projects.find((p) => p.id === inviteProject)?.name ?? "Проект для гостя"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {projects.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={inviteProjectRole}
                      onValueChange={(v) => v && setInviteProjectRole(v as ProjectRole)}
                    >
                      <SelectTrigger size="sm" className="w-36">
                        <SelectValue>{PROJECT_ROLE_LABELS[inviteProjectRole]}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="editor">Редактор</SelectItem>
                        <SelectItem value="commenter">Комментатор</SelectItem>
                        <SelectItem value="viewer">Наблюдатель</SelectItem>
                      </SelectContent>
                    </Select>
                  </>
                )}
                <Button size="sm" onClick={() => void createInvite()} disabled={!inviteEmail.includes("@")}>
                  <Plus className="size-4" />
                  Пригласить
                </Button>
              </div>
              {lastInviteUrl && (
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
                  <code className="min-w-0 flex-1 truncate text-xs">{lastInviteUrl}</code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void navigator.clipboard.writeText(lastInviteUrl)}
                  >
                    <Copy className="size-3.5" />
                    Копировать
                  </Button>
                </div>
              )}
              {invites.length > 0 && (
                <div className="mt-3 flex flex-col gap-1.5">
                  {invites.map((i) => (
                    <div key={i.id} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">
                        {i.email}
                        <span className="text-xs text-muted-foreground"> · {ORG_ROLE_LABELS[i.org_role]}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        до {new Date(i.expires_at).toLocaleDateString("ru-RU")}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Отозвать"
                        onClick={() => void call(() => api.del(`/orgs/${orgId}/invitations/${i.id}`), loadExtras)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Ссылка-приглашение действует 14 дней. Отправьте её приглашённому — приняв её, он попадёт в
                организацию со своей ролью (гость — только в выбранные проекты).
              </p>
            </Section>
          )}

          <Section title="Уведомления на этом устройстве">
            <PushToggle />
          </Section>

          {isAdmin && initial.admin && <AdminSection orgId={orgId} initial={initial.admin} />}

          <Section title="Статусы задач">
            <div className="flex flex-col gap-1.5">
              {statuses.map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="flex-1 text-sm">{s.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.kind === "done" ? "завершает" : s.kind === "archived" ? "архив" : ""}
                  </span>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => {
                        if (window.confirm(`Удалить статус «${s.name}»? Задачи останутся без статуса.`)) {
                          void call(() => api.del(`/orgs/${orgId}/statuses/${s.id}`), store.refreshMeta);
                        }
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              {isAdmin && (
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    placeholder="Новый статус"
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value)}
                    className="h-8 w-56"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!newStatus.trim()}
                    onClick={() =>
                      void call(async () => {
                        await api.post(`/orgs/${orgId}/statuses`, { name: newStatus.trim() });
                        setNewStatus("");
                      }, store.refreshMeta)
                    }
                  >
                    Добавить
                  </Button>
                </div>
              )}
            </div>
          </Section>

          <Section title="Теги">
            <div className="flex flex-wrap items-center gap-2">
              {tags.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{ backgroundColor: `${t.color}1a`, color: t.color }}
                >
                  {t.name}
                  {canManageTags && (
                    <button
                      className="opacity-60 hover:opacity-100"
                      onClick={() => void call(() => api.del(`/orgs/${orgId}/tags/${t.id}`), store.refreshMeta)}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
              {canManageTags && (
                <Input
                  placeholder="Новый тег"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newTag.trim()) {
                      void call(async () => {
                        await api.post(`/orgs/${orgId}/tags`, { name: newTag.trim() });
                        setNewTag("");
                      }, store.refreshMeta);
                    }
                  }}
                  className="h-8 w-40"
                />
              )}
            </div>
          </Section>

          <Section title="Кастомные поля (для всей организации)">
            <div className="flex flex-col gap-1.5">
              {fields
                .filter((f) => !f.project_id)
                .map((f) => (
                  <div key={f.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1">{f.name}</span>
                    <span className="text-xs text-muted-foreground">{FIELD_TYPE_LABELS[f.type]}</span>
                    {canManageTags && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => {
                          if (window.confirm(`Удалить поле «${f.name}» со всеми значениями?`)) {
                            void call(() => api.del(`/orgs/${orgId}/fields/${f.id}`), loadExtras);
                          }
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              <div className={`mt-1 flex-wrap items-center gap-2 ${canManageTags ? "flex" : "hidden"}`}>
                <Input
                  placeholder="Название поля"
                  value={newField}
                  onChange={(e) => setNewField(e.target.value)}
                  className="h-8 w-48"
                />
                <Select value={newFieldType} onValueChange={(v) => v && setNewFieldType(v as FieldType)}>
                  <SelectTrigger size="sm" className="w-36">
                    <SelectValue>{FIELD_TYPE_LABELS[newFieldType]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {FIELD_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(newFieldType === "select" || newFieldType === "multi_select") && (
                  <Input
                    placeholder="Опции через запятую"
                    value={newFieldOptions}
                    onChange={(e) => setNewFieldOptions(e.target.value)}
                    className="h-8 w-56"
                  />
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!newField.trim()}
                  onClick={() =>
                    void call(async () => {
                      await api.post(`/orgs/${orgId}/fields`, {
                        name: newField.trim(),
                        type: newFieldType,
                        options:
                          newFieldType === "select" || newFieldType === "multi_select"
                            ? newFieldOptions
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean)
                                .map((label) => ({ label }))
                            : undefined,
                      });
                      setNewField("");
                      setNewFieldOptions("");
                    }, loadExtras)
                  }
                >
                  Добавить
                </Button>
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
