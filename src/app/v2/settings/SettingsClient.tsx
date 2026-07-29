"use client";

// Настройки организации: участники (вместе с приглашениями и командами),
// справочники, журнал действий, выгрузка и вебхуки.
//
// Состав экрана зависит от роли, но зашит он не в код: владелец организации
// решает, что видят администраторы, сотрудники и гости (`settings-sections.ts`).
// Сам владелец видит всё — иначе он мог бы запереть себя. Настройка только
// сужает видимость: данные разделов по-прежнему отдаёт policy, поэтому «открыть
// сотруднику вебхуки» галочкой невозможно.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { Bell, Copy, Plus, Trash2 } from "lucide-react";
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
import {
  CONFIGURABLE_ROLES,
  ORG_ROLE_LABELS,
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from "@/lib/core/settings-sections";
import {
  CATEGORY_LABELS,
  deleteBlockMessage,
  fallbackStatusId,
  groupByCategory,
  isWorkingCategory,
  statusDeleteBlock,
} from "@/lib/core/status-model";
import { ORG_ROLE_RANK } from "@/lib/core/types";
import type {
  CoreEvent,
  CustomField,
  FieldType,
  Invitation,
  OrgRole,
  ProjectRole,
  StatusCategory,
} from "@/lib/core/types";
import { useV2Store, useV2StoreApi } from "@/lib/core/ui-store";
import { useLoad } from "@/lib/core/use-load";
import { AuditList } from "@/components/v2/AuditList";
import { Avatar, chipStyle } from "@/components/v2/bits";
import { OrgSwitcher } from "@/components/v2/OrgSwitcher";

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

/** Подзаголовок внутри раздела — «Приглашения» и «Команды» внутри участников. */
function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 mt-4 border-t border-border pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
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

export interface SettingsInitial {
  fields: CustomField[];
  invitations: Invitation[];
  teams: Team[];
  webhooks: Webhook[];
  audit: CoreEvent[];
  /** Разделы, доступные этой роли, — посчитаны на сервере. */
  sections: SettingsSectionId[];
  /** Настройка видимости целиком; приходит только владельцу — он её и правит. */
  sectionsConfig: Record<SettingsSectionId, OrgRole[]> | null;
}

export function SettingsClient({ initial }: { initial: SettingsInitial }) {
  const store = useV2Store();
  const storeApi = useV2StoreApi();
  const { orgId, orgRole, me, members, statuses, tags, projects } = store;
  const isOwner = orgRole === "owner";
  const isAdmin = isOwner || orgRole === "admin";
  // Теги и кастомные поля org-уровня доступны сотрудникам, но не гостям.
  const canManageTags = isAdmin || orgRole === "member";
  const has = (id: SettingsSectionId) => initial.sections.includes(id);

  const [invites, setInvites] = useState<Invitation[]>(initial.invitations);
  const [teams, setTeams] = useState<Team[]>(initial.teams);
  const [webhooks, setWebhooks] = useState<Webhook[]>(initial.webhooks);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member" | "guest">("member");
  const [inviteProject, setInviteProject] = useState("");
  const [inviteProjectRole, setInviteProjectRole] = useState<ProjectRole>("editor");
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [fields, setFields] = useState<CustomField[]>(initial.fields);
  // Своё поле на категорию: одна строка ввода на весь справочник не даёт
  // выбрать, куда именно добавляется статус.
  const [newStatus, setNewStatus] = useState<Partial<Record<StatusCategory, string>>>({});
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
  const reloadExtras = useCallback(() => {
    if (extrasLoaded.current) {
      extrasLoaded.current = false;
      return;
    }
    return loadExtras();
  }, [loadExtras]);
  useLoad(reloadExtras);

  async function call(fn: () => Promise<unknown>, refresh?: () => Promise<void> | void) {
    try {
      await fn();
      setError(null);
      await refresh?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  }

  const reloadTeams = useCallback(async () => {
    if (orgId) setTeams(await api.get<Team[]>(`/orgs/${orgId}/teams`));
  }, [orgId]);

  const reloadWebhooks = useCallback(async () => {
    if (orgId) setWebhooks(await api.get<Webhook[]>(`/orgs/${orgId}/webhooks`));
  }, [orgId]);

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
      <header className="flex items-center gap-3 border-b border-border px-6 py-3.5">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Настройки организации</h1>
        {orgRole && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {ORG_ROLE_LABELS[orgRole]}
          </span>
        )}
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          {/* Переключатель организаций переехал сюда из шапки сайдбара. */}
          <Section title="Организация">
            <OrgSwitcher />
          </Section>

          {has("members") && (
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
                              .filter((r) => r !== "owner" || isOwner)
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

              {isAdmin && (
                <>
                  <SubHeading>Приглашения</SubHeading>
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
                </>
              )}

              {canManageTags && (
                <>
                  <SubHeading>Команды</SubHeading>
                  <div className="flex flex-col gap-1.5">
                    {teams.map((t) => (
                      <div key={t.id} className="flex items-center gap-2 text-sm">
                        <span className="flex-1">{t.name}</span>
                        <span className="text-xs text-muted-foreground">{t.project_count} проектов</span>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => void call(() => api.del(`/orgs/${orgId}/teams/${t.id}`), reloadTeams)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                    {teams.length === 0 && <p className="text-xs text-muted-foreground">Команд пока нет</p>}
                    {isAdmin && (
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
                            void call(async () => {
                              await api.post(`/orgs/${orgId}/teams`, { name: teamName.trim() });
                              setTeamName("");
                            }, reloadTeams)
                          }
                        >
                          Добавить
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </Section>
          )}

          {/* Уведомления настраиваются в своём разделе: он личный и доступен
              любой роли, а состав этой страницы решает владелец организации. */}
          <Section title="Уведомления">
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex-1 text-sm text-muted-foreground">
                Доставка в этот браузер, устройства и типы событий
              </p>
              {/* nativeButton={false}: внутри ссылка, а не <button> — иначе Base UI
                  навешивает клавиатурные повадки кнопки поверх якоря и ругается. */}
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<Link href="/v2/settings/notifications" />}
              >
                <Bell className="size-4" />
                Открыть раздел
              </Button>
            </div>
          </Section>

          {has("statuses") && (
            <Section title="Статусы задач">
              <div className="flex flex-col gap-4">
                {groupByCategory(statuses).map(({ category, statuses: inCategory }) => (
                  <div key={category} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {CATEGORY_LABELS[category]}
                      </span>
                      <span className="text-[11px] text-muted-foreground/70">
                        {category === "archived"
                          ? "может пустовать; в карточке задачи такие статусы не показываются"
                          : category === "done"
                            ? "проставляет отметку о завершении"
                            : ""}
                      </span>
                    </div>

                    {inCategory.map((s) => {
                      const block = statusDeleteBlock(statuses, s.id);
                      return (
                        <div key={s.id} className="flex items-center gap-2">
                          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                          <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                          {s.is_default && (
                            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                              по умолчанию
                            </span>
                          )}
                          {isAdmin && !s.is_default && isWorkingCategory(s.category) && (
                            <Button
                              variant="ghost"
                              size="xs"
                              className="shrink-0 text-xs text-muted-foreground"
                              title="Новые задачи будут попадать в этот статус"
                              onClick={() =>
                                void call(
                                  () => api.patch(`/orgs/${orgId}/statuses/${s.id}`, { is_default: true }),
                                  store.refreshMeta,
                                )
                              }
                            >
                              Сделать основным
                            </Button>
                          )}
                          {isAdmin && (
                            // Кнопка не исчезает, а гаснет с объяснением: пропавшая
                            // кнопка читается как поломка, а не как правило.
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              className="shrink-0"
                              disabled={!!block}
                              title={block ? deleteBlockMessage(block, s.category) : "Удалить статус"}
                              onClick={() => {
                                const target = statuses.find(
                                  (x) => x.id === fallbackStatusId(statuses, s.id),
                                );
                                const where = target ? `«${target.name}»` : "статус по умолчанию";
                                if (window.confirm(`Удалить статус «${s.name}»? Задачи переедут в ${where}.`)) {
                                  void call(() => api.del(`/orgs/${orgId}/statuses/${s.id}`), store.refreshMeta);
                                }
                              }}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      );
                    })}

                    {isAdmin && (
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder={`Новый статус в «${CATEGORY_LABELS[category]}»`}
                          value={newStatus[category] ?? ""}
                          onChange={(e) => setNewStatus((prev) => ({ ...prev, [category]: e.target.value }))}
                          className="h-8 w-64"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!(newStatus[category] ?? "").trim()}
                          onClick={() =>
                            void call(async () => {
                              await api.post(`/orgs/${orgId}/statuses`, {
                                name: (newStatus[category] ?? "").trim(),
                                category,
                              });
                              setNewStatus((prev) => ({ ...prev, [category]: "" }));
                            }, store.refreshMeta)
                          }
                        >
                          Добавить
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {has("tags") && (
            <Section title="Теги">
              <div className="flex flex-wrap items-center gap-2">
                {tags.map((t) => (
                  <span
                    key={t.id}
                    className="tinted-chip inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                    style={chipStyle(t.color)}
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
          )}

          {has("fields") && (
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
          )}

          {has("audit") && (
            <Section title="Журнал действий">
              <AuditList events={initial.audit} />
              <Link
                href="/v2/settings/audit"
                className="mt-3 inline-block text-sm text-primary underline"
              >
                Посмотреть все
              </Link>
            </Section>
          )}

          {has("export") && (
            <Section title="Данные организации">
              <a href={`/api/v2/orgs/${orgId}/export`} className="text-sm text-primary underline" download>
                Выгрузить все данные организации (JSON)
              </a>
            </Section>
          )}

          {isOwner && initial.sectionsConfig && (
            <SectionsAccess
              orgId={orgId}
              initialConfig={initial.sectionsConfig}
              onError={setError}
            />
          )}

          {has("webhooks") && (
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
                      onClick={() => void call(() => api.del(`/orgs/${orgId}/webhooks/${w.id}`), reloadWebhooks)}
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
                      void call(async () => {
                        const res = await api.post<{ secret: string }>(`/orgs/${orgId}/webhooks`, {
                          url: webhookUrl,
                          events: [],
                        });
                        setNewSecret(res.secret);
                        setWebhookUrl("");
                      }, reloadWebhooks)
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
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Кто какие разделы видит. Доступно только владельцу: настройка решает, что
 * увидят администраторы, поэтому им её отдавать нельзя. Роль ниже порога
 * раздела отмечена как недоступная — policy всё равно не отдаст ей данные.
 */
function SectionsAccess({
  orgId,
  initialConfig,
  onError,
}: {
  orgId: string | null;
  initialConfig: Record<SettingsSectionId, OrgRole[]>;
  onError: (message: string | null) => void;
}) {
  const router = useRouter();
  const [config, setConfig] = useState(initialConfig);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggle(section: SettingsSectionId, role: OrgRole) {
    setSaved(false);
    setConfig((prev) => {
      const current = prev[section] ?? [];
      return {
        ...prev,
        [section]: current.includes(role) ? current.filter((r) => r !== role) : [...current, role],
      };
    });
  }

  async function save() {
    if (!orgId || saving) return;
    setSaving(true);
    try {
      await api.put(`/orgs/${orgId}/settings-sections`, { sections: config });
      onError(null);
      setSaved(true);
      // Состав разделов считает сервер — без обновления рендера экран остался
      // бы прежним до следующего перехода.
      router.refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Не удалось сохранить доступ к разделам");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Доступ к разделам настроек">
      <p className="mb-3 text-xs text-muted-foreground">
        Кто видит эти разделы. Владелец видит их всегда. Настройка только скрывает: раздел, открытый
        роли без прав на его данные, всё равно останется недоступным — такие ячейки отмечены прочерком.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="py-1 pr-3 text-left font-medium">Раздел</th>
              {CONFIGURABLE_ROLES.map((r) => (
                <th key={r} className="px-2 py-1 text-center font-medium">
                  {ORG_ROLE_LABELS[r]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SETTINGS_SECTIONS.map((section) => (
              <tr key={section.id} className="border-t border-border">
                <td className="py-1.5 pr-3">
                  <span className="block">{section.title}</span>
                  <span className="block text-xs text-muted-foreground">{section.hint}</span>
                </td>
                {CONFIGURABLE_ROLES.map((role) => {
                  const allowed = ORG_ROLE_RANK[role] >= ORG_ROLE_RANK[section.minRole];
                  return (
                    <td key={role} className="px-2 py-1.5 text-center">
                      {allowed ? (
                        <input
                          type="checkbox"
                          checked={(config[section.id] ?? []).includes(role)}
                          onChange={() => toggle(section.id, role)}
                          aria-label={`${section.title} — ${ORG_ROLE_LABELS[role]}`}
                          className="size-3.5 accent-primary"
                        />
                      ) : (
                        <span className="text-muted-foreground" title="Недоступно этой роли по правам">
                          —
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? "Сохраняю…" : "Сохранить"}
        </Button>
        {saved && <span className="text-xs text-muted-foreground">Сохранено</span>}
      </div>
    </Section>
  );
}
